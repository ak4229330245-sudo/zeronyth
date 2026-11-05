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

import java.security.SecureRandom;
import java.util.Objects;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAKeyGenerationParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAKeyPairGenerator;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPublicKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSASigner;

/**
 * ML-DSA-65 (FIPS 204) primitives for native post-quantum transactions.
 *
 * <p>Addresses are derived as the last 20 bytes of keccak256(publicKey). Signatures are over a
 * domain-separated message that includes chainId for replay protection.
 */
public final class MlDsa65TransactionCrypto {

  public static final MLDSAParameters PARAMETERS = MLDSAParameters.ml_dsa_65;

  /** Domain separation for transaction signatures. */
  public static final Bytes DOMAIN = Bytes.fromHexString("0x5a45524f4e5954482f4d4c2d4453412d36352f54582f5631"); // "ZERONYTH/ML-DSA-65/TX/V1"

  private MlDsa65TransactionCrypto() {}

  public static AsymmetricCipherKeyPair generateKeyPair(final SecureRandom random) {
    Objects.requireNonNull(random, "random");
    final MLDSAKeyPairGenerator generator = new MLDSAKeyPairGenerator();
    generator.init(new MLDSAKeyGenerationParameters(random, PARAMETERS));
    return generator.generateKeyPair();
  }

  public static byte[] getPublicKeyBytes(final AsymmetricCipherKeyPair keyPair) {
    final MLDSAPublicKeyParameters pub = (MLDSAPublicKeyParameters) keyPair.getPublic();
    return pub.getEncoded();
  }

  public static byte[] getPrivateKeyBytes(final AsymmetricCipherKeyPair keyPair) {
    final MLDSAPrivateKeyParameters priv = (MLDSAPrivateKeyParameters) keyPair.getPrivate();
    return priv.getEncoded();
  }

  /**
   * Sign the given message bytes (already domain-separated and including chainId).
   */
  public static byte[] sign(final byte[] message, final MLDSAPrivateKeyParameters privateKey, final SecureRandom random) {
    final MLDSASigner signer = new MLDSASigner();
    signer.init(true, new ParametersWithRandom(privateKey, random));
    signer.update(message, 0, message.length);
    try {
      return signer.generateSignature();
    } catch (final org.bouncycastle.crypto.CryptoException e) {
      throw new IllegalStateException("ML-DSA-65 signature generation failed", e);
    }
  }

  public static boolean verify(final byte[] message, final byte[] signature, final MLDSAPublicKeyParameters publicKey) {
    final MLDSASigner verifier = new MLDSASigner();
    verifier.init(false, publicKey);
    verifier.update(message, 0, message.length);
    return verifier.verifySignature(signature);
  }

  public static MLDSAPublicKeyParameters publicKeyFromBytes(final byte[] encoded) {
    return new MLDSAPublicKeyParameters(PARAMETERS, encoded);
  }

  public static MLDSAPrivateKeyParameters privateKeyFromBytes(final byte[] encoded) {
    return new MLDSAPrivateKeyParameters(PARAMETERS, encoded);
  }

  /**
   * Derive Ethereum-style address from ML-DSA-65 public key: last 20 bytes of keccak256(pubkey).
   */
  public static Bytes addressFromPublicKey(final byte[] publicKey) {
    final Bytes32 hash = Hash.keccak256(Bytes.wrap(publicKey));
    return hash.slice(12); // last 20 bytes
  }
}
