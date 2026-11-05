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
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Objects;

import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.pqc.crypto.falcon.FalconKeyGenerationParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconKeyPairGenerator;
import org.bouncycastle.pqc.crypto.falcon.FalconParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconSigner;

/**
 * Experimental Falcon-1024 primitive for a future, versioned QBFT consensus protocol.
 *
 * <p>This does not replace the existing Besu ECDSA signature paths by itself. It deliberately
 * domain-separates each consensus message from every other type, network and consensus round. Only
 * a distinct Falcon-only network/protocol version may use this encoding.
 */
public final class Falcon1024ConsensusCrypto {

  /** QBFT PROPOSAL. */
  public static final int PROPOSAL = 1;

  /** QBFT PREPARE. */
  public static final int PREPARE = 2;

  /** QBFT COMMIT. */
  public static final int COMMIT = 3;

  /** QBFT ROUND_CHANGE. */
  public static final int ROUND_CHANGE = 4;

  /** Block header finality/commit seal; never reuse the COMMIT message signature. */
  public static final int COMMIT_SEAL = 5;

  /**
   * Off-chain binding of a validator's ML-DSA-65 finality key to its Falcon validator address
   * (height 0, round 0, payload = binding hash). Never accepted by any QBFT verifier path.
   */
  public static final int PQ_BINDING = 6;

  private static final byte[] DOMAIN =
      "ZERONYTH/QBFT/FALCON-1024/V1\u0000".getBytes(StandardCharsets.US_ASCII);

  private Falcon1024ConsensusCrypto() {}

  /** Generates a new Falcon-1024 signing identity. Caller must securely persist its secret key. */
  public static AsymmetricCipherKeyPair generateKeyPair(final SecureRandom random) {
    Objects.requireNonNull(random, "random");
    final FalconKeyPairGenerator generator = new FalconKeyPairGenerator();
    generator.init(new FalconKeyGenerationParameters(random, FalconParameters.falcon_1024));
    return generator.generateKeyPair();
  }

  /**
   * Canonical signature input; never sign an unscoped block hash or raw message bytes.
   *
   * @param chainId genesis network's chain ID, not the p2p network ID
   * @param messageType one of the constants above
   * @param blockHeight QBFT sequence (block height)
   * @param round QBFT round, zero or greater
   * @param payloadHash 32-byte canonical hash of the existing QBFT payload or header
   */
  public static byte[] signingBytes(
      final long chainId,
      final int messageType,
      final long blockHeight,
      final int round,
      final byte[] payloadHash) {
    if (chainId <= 0
        || blockHeight < 0
        || round < 0
        || messageType < PROPOSAL
        || messageType > PQ_BINDING) {
      throw new IllegalArgumentException("Invalid consensus domain values");
    }
    Objects.requireNonNull(payloadHash, "payloadHash");
    if (payloadHash.length != 32) {
      throw new IllegalArgumentException("Expected 32-byte canonical payload hash");
    }
    final ByteBuffer result = ByteBuffer.allocate(DOMAIN.length + 8 + 4 + 8 + 4 + 32);
    return result
        .put(DOMAIN)
        .putLong(chainId)
        .putInt(messageType)
        .putLong(blockHeight)
        .putInt(round)
        .put(payloadHash)
        .array();
  }

  /** Signs the canonical scoped QBFT preimage with Falcon-1024. */
  public static byte[] sign(
      final FalconPrivateKeyParameters privateKey,
      final SecureRandom random,
      final byte[] signingBytes) {
    Objects.requireNonNull(privateKey, "privateKey");
    Objects.requireNonNull(random, "random");
    Objects.requireNonNull(signingBytes, "signingBytes");
    final FalconSigner signer = new FalconSigner();
    signer.init(true, new ParametersWithRandom(privateKey, random));
    return signer.generateSignature(Arrays.copyOf(signingBytes, signingBytes.length));
  }

  /** Verifies the canonical scoped preimage against an already allowlisted public key. */
  public static boolean verify(
      final FalconPublicKeyParameters publicKey,
      final byte[] signingBytes,
      final byte[] signature) {
    Objects.requireNonNull(publicKey, "publicKey");
    Objects.requireNonNull(signingBytes, "signingBytes");
    Objects.requireNonNull(signature, "signature");
    final FalconSigner signer = new FalconSigner();
    signer.init(false, publicKey);
    return signer.verifySignature(Arrays.copyOf(signingBytes, signingBytes.length), signature);
  }
}
