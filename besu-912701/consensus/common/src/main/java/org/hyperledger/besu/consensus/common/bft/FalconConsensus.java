/*
 * Copyright contributors to Besu.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
package org.hyperledger.besu.consensus.common.bft;

import org.hyperledger.besu.consensus.common.bft.payload.Payload;
import org.hyperledger.besu.crypto.Falcon1024ConsensusCrypto;
import org.hyperledger.besu.crypto.Falcon1024ConsensusEnvelope;
import org.hyperledger.besu.crypto.Falcon1024KeyFile;
import org.hyperledger.besu.crypto.Falcon1024Signature;
import org.hyperledger.besu.crypto.SECPPublicKey;
import org.hyperledger.besu.crypto.SECPSignature;
import org.hyperledger.besu.crypto.SecureRandomProvider;
import org.hyperledger.besu.crypto.SignatureAlgorithmFactory;
import org.hyperledger.besu.cryptoservices.NodeKey;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Hash;
import org.hyperledger.besu.ethereum.core.Util;

import java.security.SecureRandom;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ZERONYTH Falcon-1024 QBFT consensus signature scheme switch.
 *
 * <p>Disabled (default): upstream secp256k1 behaviour, byte-for-byte unchanged.
 *
 * <p>Enabled (genesis {@code "qbft": {"falcon1024": true}}): EVERY QBFT consensus signature
 * (PROPOSAL, PREPARE, COMMIT, ROUND_CHANGE messages and block commit seals) is a Falcon-1024
 * envelope; ECDSA consensus signatures are rejected. Validator identity = keccak256(Falcon public
 * key)[12..32]. Since Falcon has no public-key recovery, the public key travels in the envelope;
 * the derived address is then authorized by the normal BFT validator-set checks (a key that does
 * not hash to an active validator address is rejected). The signed preimage is domain-separated by
 * local chain ID, message type, height, round and the locally recomputed payload / committed-seal
 * hash; envelope header fields are only cross-checked, never trusted.
 *
 * <p>Transaction (EVM wallet) signatures and the devp2p transport key are NOT affected.
 */
public final class FalconConsensus {
  private static final Logger LOG = LoggerFactory.getLogger(FalconConsensus.class);

  // QBFT v1 message codes (QbftV1 in qbft-core), mapped to Falcon domain constants.
  private static final int QBFT_PROPOSAL = 0x12;
  private static final int QBFT_PREPARE = 0x13;
  private static final int QBFT_COMMIT = 0x14;
  private static final int QBFT_ROUND_CHANGE = 0x15;

  /** Chain IDs on which Falcon mode must never start (ZERONYTH production). */
  public static final java.util.Set<Long> PRODUCTION_CHAIN_IDS = java.util.Set.of(9127L);

  private static volatile long chainId = 0L;
  private static final Map<SECPPublicKey, Falcon1024KeyFile.KeyPair> LOCAL_KEYS =
      new ConcurrentHashMap<>();
  private static final SecureRandom RANDOM = SecureRandomProvider.createSecureRandom();

  private FalconConsensus() {}

  /**
   * Enables Falcon-only consensus for this process.
   *
   * @param networkChainId genesis chain ID used in the signature domain
   */
  public static void enable(final long networkChainId) {
    if (networkChainId <= 0) {
      throw new IllegalArgumentException("Falcon QBFT requires a positive chain ID");
    }
    if (PRODUCTION_CHAIN_IDS.contains(networkChainId)) {
      throw new IllegalStateException(
          "Falcon-1024 QBFT is refused on production chain "
              + networkChainId
              + " (experimental mode; requires a new genesis/chain ID and owner approval)");
    }
    chainId = networkChainId;
    LOG.info("ZERONYTH Falcon-1024 QBFT consensus ENABLED for chainId={}", networkChainId);
  }

  /** Disables Falcon mode and forgets local keys (tests only). */
  public static void reset() {
    chainId = 0L;
    LOCAL_KEYS.clear();
  }

  /**
   * Whether Falcon-only mode is active.
   *
   * @return true when enabled
   */
  public static boolean isEnabled() {
    return chainId > 0;
  }

  /**
   * Binds a Falcon consensus key to the local node (keyed by its devp2p secp256k1 public key).
   *
   * @param nodeKey the node key
   * @param keyPair the Falcon key pair
   */
  public static void bindLocalKey(final NodeKey nodeKey, final Falcon1024KeyFile.KeyPair keyPair) {
    LOCAL_KEYS.put(nodeKey.getPublicKey(), keyPair);
  }

  private static Falcon1024KeyFile.KeyPair keyFor(final NodeKey nodeKey) {
    final Falcon1024KeyFile.KeyPair kp = LOCAL_KEYS.get(nodeKey.getPublicKey());
    if (kp == null) {
      throw new IllegalStateException("Falcon QBFT enabled but no Falcon key bound to node key");
    }
    return kp;
  }

  /**
   * Consensus (validator) address of the local node.
   *
   * @param nodeKey the node key
   * @return Falcon-derived address when enabled, else secp256k1 address
   */
  public static Address consensusAddress(final NodeKey nodeKey) {
    if (!isEnabled()) {
      return Util.publicKeyToAddress(nodeKey.getPublicKey());
    }
    return Address.wrap(Bytes.wrap(keyFor(nodeKey).address()));
  }

  private static int purposeOf(final int messageCode) {
    return switch (messageCode) {
      case QBFT_PROPOSAL -> Falcon1024ConsensusCrypto.PROPOSAL;
      case QBFT_PREPARE -> Falcon1024ConsensusCrypto.PREPARE;
      case QBFT_COMMIT -> Falcon1024ConsensusCrypto.COMMIT;
      case QBFT_ROUND_CHANGE -> Falcon1024ConsensusCrypto.ROUND_CHANGE;
      default ->
          throw new IllegalArgumentException(
              "Message code not permitted in Falcon QBFT: " + messageCode);
    };
  }

  private static SECPSignature falconSign(
      final NodeKey nodeKey, final int purpose, final long height, final int round, final Hash h) {
    final Falcon1024KeyFile.KeyPair kp = keyFor(nodeKey);
    return Falcon1024Signature.fromEnvelope(
        Falcon1024ConsensusEnvelope.signAndEncode(
            kp.secret(),
            kp.pub(),
            RANDOM,
            chainId,
            purpose,
            height,
            round,
            h.getBytes().toArrayUnsafe()));
  }

  /**
   * Signs a consensus message payload.
   *
   * @param nodeKey local node key
   * @param payload payload
   * @return signature (Falcon carrier when enabled)
   */
  public static SECPSignature signPayload(final NodeKey nodeKey, final Payload payload) {
    if (!isEnabled()) {
      return nodeKey.sign(Bytes32.wrap(payload.hashForSignature().getBytes()));
    }
    final ConsensusRoundIdentifier r = payload.getRoundIdentifier();
    return falconSign(
        nodeKey,
        purposeOf(payload.getMessageType()),
        r.getSequenceNumber(),
        r.getRoundNumber(),
        payload.hashForSignature());
  }

  /**
   * Creates a block commit seal.
   *
   * @param nodeKey local node key
   * @param height block number
   * @param round round
   * @param commitHash committed-seal hash
   * @return seal
   */
  public static SECPSignature signCommitSeal(
      final NodeKey nodeKey, final long height, final int round, final Hash commitHash) {
    if (!isEnabled()) {
      return nodeKey.sign(Bytes32.wrap(commitHash.getBytes()));
    }
    return falconSign(nodeKey, Falcon1024ConsensusCrypto.COMMIT_SEAL, height, round, commitHash);
  }

  private static Address falconVerify(
      final SECPSignature sig,
      final int purpose,
      final long height,
      final int round,
      final Hash h) {
    if (!(sig instanceof Falcon1024Signature falcon)) {
      LOG.debug("Rejected non-Falcon consensus signature in Falcon-only mode");
      return null;
    }
    try {
      final byte[] wire = falcon.envelope();
      final byte[] pub = Falcon1024ConsensusEnvelope.publicKeyOf(wire);
      final Falcon1024ConsensusEnvelope.VerifiedMessage v =
          Falcon1024ConsensusEnvelope.decodeAndVerify(
              wire, chainId, purpose, h.getBytes().toArrayUnsafe(), List.of(pub));
      if (v.blockHeight() != height || v.round() != round) {
        LOG.debug("Falcon envelope height/round mismatch");
        return null;
      }
      return Address.wrap(Bytes.wrap(v.authorAddress()));
    } catch (final IllegalArgumentException e) {
      LOG.debug("Invalid Falcon consensus signature: {}", e.getMessage());
      return null;
    }
  }

  /**
   * Authenticates a message signature and returns its author.
   *
   * @param sig signature
   * @param payload payload
   * @return author address, or null when invalid
   */
  public static Address authorOf(final SECPSignature sig, final Payload payload) {
    final Hash h = payload.hashForSignature();
    if (!isEnabled()) {
      return Util.signatureToAddress(sig, h);
    }
    final int purpose;
    try {
      purpose = purposeOf(payload.getMessageType());
    } catch (final IllegalArgumentException e) {
      return null;
    }
    final ConsensusRoundIdentifier r = payload.getRoundIdentifier();
    return falconVerify(sig, purpose, r.getSequenceNumber(), r.getRoundNumber(), h);
  }

  /**
   * Authenticates a commit seal and returns its creator.
   *
   * @param seal seal
   * @param height block number
   * @param round round
   * @param commitHash committed-seal hash
   * @return creator, or null when invalid
   */
  public static Address commitSealAuthor(
      final SECPSignature seal, final long height, final int round, final Hash commitHash) {
    if (!isEnabled()) {
      return Util.signatureToAddress(seal, commitHash);
    }
    return falconVerify(seal, Falcon1024ConsensusCrypto.COMMIT_SEAL, height, round, commitHash);
  }

  /**
   * Decodes a consensus signature from wire bytes.
   *
   * @param bytes bytes
   * @return signature
   */
  public static SECPSignature decodeSignature(final Bytes bytes) {
    if (!isEnabled()) {
      return SignatureAlgorithmFactory.getInstance().decodeSignature(bytes);
    }
    return Falcon1024Signature.decode(bytes);
  }
}
