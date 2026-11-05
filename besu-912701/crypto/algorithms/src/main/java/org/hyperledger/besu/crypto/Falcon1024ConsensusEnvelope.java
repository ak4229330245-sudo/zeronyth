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
package org.hyperledger.besu.crypto;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collection;
import java.util.Objects;

import org.bouncycastle.crypto.digests.KeccakDigest;
import org.bouncycastle.pqc.crypto.falcon.FalconParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;

/**
 * Versioned, strict Falcon-1024 consensus-authentication envelope.
 *
 * <p>This envelope authenticates the canonical hash of an actual QBFT payload; it does not encode
 * the payload itself, nor implement QBFT transport/finality. Validators MUST recompute the payload
 * hash and independently check block height, round, and 3-of-4 quorum. The authorized public-key
 * registry MUST be anchored to the intended genesis/validator set.
 *
 * <p>Wire v1: magic(4), version(1), messageType(1), chainId(8), height(8), round(4),
 * payloadHash(32), keySize(2), Falcon1024-key(1792), signatureSize(2), Falcon-signature. The
 * encoder is intended exclusively for an explicitly versioned experimental QBFT network.
 */
public final class Falcon1024ConsensusEnvelope {
  private static final byte[] MAGIC = {'Z', 'Q', 'B', 'F'};
  private static final byte VERSION = 1;
  private static final int HEADER_SIZE = MAGIC.length + 1 + 1 + 8 + 8 + 4 + 32 + 2;
  private static final int PUBLIC_KEY_LENGTH = 1792;
  private static final int MAX_SIGNATURE_LENGTH = 2048;

  private Falcon1024ConsensusEnvelope() {}

  /** Sign a QBFT message's canonical 32-byte payload or block-header hash. */
  public static byte[] signAndEncode(
      final FalconPrivateKeyParameters secret,
      final FalconPublicKeyParameters pub,
      final SecureRandom random,
      final long chainId,
      final int messageType,
      final long blockHeight,
      final int round,
      final byte[] payloadHash) {
    Objects.requireNonNull(pub, "pub");
    Objects.requireNonNull(secret, "secret");
    final byte[] publicKey = pub.getH();
    if (publicKey.length != PUBLIC_KEY_LENGTH) {
      throw new IllegalArgumentException("Expected Falcon-1024 public key");
    }
    final byte[] canonical =
        Falcon1024ConsensusCrypto.signingBytes(
            chainId, messageType, blockHeight, round, payloadHash);
    final byte[] signature = Falcon1024ConsensusCrypto.sign(secret, random, canonical);
    if (signature.length == 0 || signature.length > MAX_SIGNATURE_LENGTH) {
      throw new IllegalStateException("Unexpected Falcon-1024 signature length");
    }
    // Do not permit a caller to pair an unrelated public key with a private key.
    if (!Falcon1024ConsensusCrypto.verify(pub, canonical, signature)) {
      throw new IllegalArgumentException("Falcon public/private key mismatch");
    }
    final ByteBuffer out =
        ByteBuffer.allocate(HEADER_SIZE + publicKey.length + 2 + signature.length);
    out.put(MAGIC);
    out.put(VERSION);
    out.put((byte) messageType);
    out.putLong(chainId);
    out.putLong(blockHeight);
    out.putInt(round);
    out.put(payloadHash);
    out.putShort((short) publicKey.length);
    out.put(publicKey);
    out.putShort((short) signature.length);
    out.put(signature);
    return out.array();
  }

  /**
   * Decode, authorize the exact Falcon-1024 public key, and verify the real payload hash.
   *
   * @param expectedPayloadHash independently computed from the decoded QBFT payload/header
   * @param allowedPublicKeys exact 1792-byte public keys of the genesis/active validators
   * @throws IllegalArgumentException for all malformed or unauthorized messages
   */
  public static VerifiedMessage decodeAndVerify(
      final byte[] wire,
      final long expectedChainId,
      final int expectedMessageType,
      final byte[] expectedPayloadHash,
      final Collection<byte[]> allowedPublicKeys) {
    Objects.requireNonNull(wire, "wire");
    Objects.requireNonNull(expectedPayloadHash, "expectedPayloadHash");
    Objects.requireNonNull(allowedPublicKeys, "allowedPublicKeys");
    if (wire.length < HEADER_SIZE + PUBLIC_KEY_LENGTH + 2 + 1
        || wire.length > HEADER_SIZE + PUBLIC_KEY_LENGTH + 2 + MAX_SIGNATURE_LENGTH) {
      throw new IllegalArgumentException("Invalid Falcon envelope size");
    }

    final ByteBuffer in = ByteBuffer.wrap(wire);
    for (final byte b : MAGIC) {
      if (in.get() != b) {
        throw new IllegalArgumentException("Not a Falcon QBFT v1 envelope");
      }
    }
    if (in.get() != VERSION) {
      throw new IllegalArgumentException("Unsupported Falcon QBFT protocol version");
    }
    final int messageType = Byte.toUnsignedInt(in.get());
    final long chainId = in.getLong();
    final long blockHeight = in.getLong();
    final int round = in.getInt();
    final byte[] payloadHash = new byte[32];
    in.get(payloadHash);
    final int publicKeyLength = Short.toUnsignedInt(in.getShort());
    if (publicKeyLength != PUBLIC_KEY_LENGTH || in.remaining() < PUBLIC_KEY_LENGTH + 2 + 1) {
      throw new IllegalArgumentException("Invalid Falcon-1024 public key length");
    }
    final byte[] publicKey = new byte[PUBLIC_KEY_LENGTH];
    in.get(publicKey);
    final int signatureLength = Short.toUnsignedInt(in.getShort());
    if (signatureLength == 0
        || signatureLength > MAX_SIGNATURE_LENGTH
        || signatureLength != in.remaining()) {
      throw new IllegalArgumentException("Invalid Falcon-1024 signature length or trailing data");
    }
    final byte[] signature = new byte[signatureLength];
    in.get(signature);

    if (chainId != expectedChainId
        || messageType != expectedMessageType
        || !MessageDigest.isEqual(payloadHash, expectedPayloadHash)) {
      throw new IllegalArgumentException("Falcon QBFT message domain or payload mismatch");
    }

    boolean authorized = false;
    for (final byte[] accepted : allowedPublicKeys) {
      // Check exact key, not a self-asserted signer address.
      if (accepted != null && accepted.length == PUBLIC_KEY_LENGTH) {
        authorized |= MessageDigest.isEqual(publicKey, accepted);
      }
    }
    if (!authorized) {
      throw new IllegalArgumentException("Unknown Falcon QBFT validator key");
    }
    final FalconPublicKeyParameters publicKeyParameters =
        new FalconPublicKeyParameters(FalconParameters.falcon_1024, publicKey);
    final byte[] canonical;
    try {
      canonical =
          Falcon1024ConsensusCrypto.signingBytes(
              chainId, messageType, blockHeight, round, payloadHash);
      if (!Falcon1024ConsensusCrypto.verify(publicKeyParameters, canonical, signature)) {
        throw new IllegalArgumentException("Invalid Falcon QBFT signature");
      }
    } catch (final RuntimeException malformedSignature) {
      throw new IllegalArgumentException(
          "Invalid Falcon QBFT signature/domain", malformedSignature);
    }
    return new VerifiedMessage(
        messageType, chainId, blockHeight, round, validatorAddress(publicKey), payloadHash);
  }

  /**
   * Structurally parses an envelope and returns the embedded Falcon-1024 public key. Performs NO
   * signature verification and NO authorization; callers must verify with {@link #decodeAndVerify}
   * and then check the derived address against the active validator set.
   *
   * @param wire envelope bytes
   * @return copy of the embedded 1792-byte public key
   * @throws IllegalArgumentException for malformed envelopes
   */
  public static byte[] publicKeyOf(final byte[] wire) {
    Objects.requireNonNull(wire, "wire");
    if (wire.length < HEADER_SIZE + PUBLIC_KEY_LENGTH + 2 + 1
        || wire.length > HEADER_SIZE + PUBLIC_KEY_LENGTH + 2 + MAX_SIGNATURE_LENGTH) {
      throw new IllegalArgumentException("Invalid Falcon envelope size");
    }
    final ByteBuffer in = ByteBuffer.wrap(wire);
    for (final byte b : MAGIC) {
      if (in.get() != b) {
        throw new IllegalArgumentException("Not a Falcon QBFT v1 envelope");
      }
    }
    if (in.get() != VERSION) {
      throw new IllegalArgumentException("Unsupported Falcon QBFT protocol version");
    }
    in.position(HEADER_SIZE - 2);
    final int publicKeyLength = Short.toUnsignedInt(in.getShort());
    if (publicKeyLength != PUBLIC_KEY_LENGTH) {
      throw new IllegalArgumentException("Invalid Falcon-1024 public key length");
    }
    final byte[] publicKey = new byte[PUBLIC_KEY_LENGTH];
    in.get(publicKey);
    final int signatureLength = Short.toUnsignedInt(in.getShort());
    if (signatureLength == 0 || signatureLength != in.remaining()) {
      throw new IllegalArgumentException("Invalid Falcon-1024 signature length or trailing data");
    }
    return publicKey;
  }

  /**
   * Derives a new validator address from its Falcon public key for a NEW experimental genesis.
   * These addresses are not compatible with existing secp256k1 validator addresses.
   */
  public static byte[] validatorAddress(final byte[] publicKey) {
    Objects.requireNonNull(publicKey, "publicKey");
    if (publicKey.length != PUBLIC_KEY_LENGTH) {
      throw new IllegalArgumentException("Expected Falcon-1024 raw public key");
    }
    final KeccakDigest hash = new KeccakDigest(256);
    hash.update(publicKey, 0, publicKey.length);
    final byte[] digest = new byte[32];
    hash.doFinal(digest, 0);
    return Arrays.copyOfRange(digest, 12, 32);
  }

  /** Proof of successful verification, not directly constructible by callers. */
  public static final class VerifiedMessage {
    private final int messageType;
    private final long chainId;
    private final long blockHeight;
    private final int round;
    private final byte[] authorAddress;
    private final byte[] payloadHash;

    private VerifiedMessage(
        final int messageType,
        final long chainId,
        final long blockHeight,
        final int round,
        final byte[] authorAddress,
        final byte[] payloadHash) {
      this.messageType = messageType;
      this.chainId = chainId;
      this.blockHeight = blockHeight;
      this.round = round;
      this.authorAddress = authorAddress.clone();
      this.payloadHash = payloadHash.clone();
    }

    public int messageType() {
      return messageType;
    }

    public long chainId() {
      return chainId;
    }

    public long blockHeight() {
      return blockHeight;
    }

    public int round() {
      return round;
    }

    public byte[] authorAddress() {
      return authorAddress.clone();
    }

    public byte[] payloadHash() {
      return payloadHash.clone();
    }
  }
}
