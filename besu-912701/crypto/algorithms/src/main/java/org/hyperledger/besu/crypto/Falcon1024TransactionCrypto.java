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
import java.util.Arrays;
import java.util.Objects;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.pqc.crypto.falcon.FalconKeyGenerationParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconKeyPairGenerator;
import org.bouncycastle.pqc.crypto.falcon.FalconParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconSigner;

/**
 * Falcon-1024 primitives for native post-quantum transactions (transaction type 0x7E). Mirror of
 * {@link MlDsa65TransactionCrypto} with the Falcon algorithm.
 *
 * <p><b>Canonical public-key form.</b> Two byte forms of a BouncyCastle 1.84 Falcon-1024 public
 * key exist in this codebase: the raw {@code h} polynomial (1792 bytes, {@code
 * FalconPublicKeyParameters.getH()}), which the QBFT consensus envelope uses, and the encoded
 * form, which prepends a 1-byte header (the Falcon {@code log n} byte, 0x0a for Falcon-1024) to
 * {@code h} and is therefore <b>1793 bytes</b>. (BouncyCastle 1.84's {@code
 * FalconPublicKeyParameters} has no {@code getEncoded()} method, so the encoded form is
 * constructed here as {@code 0x0a || h}; it matches the noble/Falcon reference encoding used by
 * the ZERONYTH JS tooling.) For transactions this class uses the <b>encoded form (1793
 * bytes)</b> consistently: it is what {@link #getPublicKeyBytes} returns, what travels in the
 * transaction RLP, what {@link #addressFromPublicKey} hashes, and what {@link
 * #publicKeyFromBytes} accepts (it also accepts the raw 1792-byte {@code h} form by treating it
 * as already headerless). The two forms must never be mixed for the same account: an address
 * derived from the encoded form differs from one derived from {@code h}. {@code
 * Falcon1024TransactionCryptoTest} pins the encoded length.
 *
 * <p>Addresses are derived as the last 20 bytes of keccak256(publicKey). Signatures are over a
 * domain-separated message that includes chainId for replay protection.
 */
public final class Falcon1024TransactionCrypto {

  /** Falcon parameter set used for every transaction key in this scheme. */
  public static final FalconParameters PARAMETERS = FalconParameters.falcon_1024;

  /** Length of the raw Falcon-1024 {@code h} polynomial. */
  public static final int RAW_PUBLIC_KEY_LENGTH = 1792;

  /** Length of the canonical (encoded) Falcon-1024 public key used by transactions: 1 + 1792. */
  public static final int PUBLIC_KEY_LENGTH = RAW_PUBLIC_KEY_LENGTH + 1;

  /**
   * Maximum accepted length of a Falcon-1024 signature in bytes. Falcon signatures are
   * variable-length (typically ~1.2-1.5 KB for Falcon-1024). The bound mirrors the production
   * {@code Falcon1024ConsensusEnvelope} limit (2048) so that no signature BouncyCastle can
   * produce for a valid key is ever rejected, while still bounding decoder/pool memory.
   */
  public static final int MAX_SIGNATURE_LENGTH = 2048;

  /** Domain separation for transaction signatures. */
  public static final Bytes DOMAIN = Bytes.fromHexString("0x5a45524f4e5954482f46414c434f4e2d313032342f54582f5631"); // "ZERONYTH/FALCON-1024/TX/V1"

  private Falcon1024TransactionCrypto() {}

  public static AsymmetricCipherKeyPair generateKeyPair(final SecureRandom random) {
    Objects.requireNonNull(random, "random");
    final FalconKeyPairGenerator generator = new FalconKeyPairGenerator();
    generator.init(new FalconKeyGenerationParameters(random, PARAMETERS));
    return generator.generateKeyPair();
  }

  /** Header byte of the encoded form: the Falcon {@code log n} value (10 for Falcon-1024). */
  public static final byte ENCODED_HEADER_BYTE = (byte) 0x0a;

  /** Canonical encoded public key bytes (1793 bytes; see class documentation). */
  public static byte[] getPublicKeyBytes(final AsymmetricCipherKeyPair keyPair) {
    return getPublicKeyBytes((FalconPublicKeyParameters) keyPair.getPublic());
  }

  /** Canonical encoded public key bytes (1793 bytes; see class documentation). */
  public static byte[] getPublicKeyBytes(final FalconPublicKeyParameters pub) {
    final byte[] h = pub.getH();
    final byte[] encoded = new byte[PUBLIC_KEY_LENGTH];
    encoded[0] = ENCODED_HEADER_BYTE;
    System.arraycopy(h, 0, encoded, 1, h.length);
    return encoded;
  }

  /**
   * Sign the given message bytes (already domain-separated and including chainId). Unlike ML-DSA,
   * the BouncyCastle Falcon signer takes the whole message in {@code generateSignature}.
   */
  public static byte[] sign(
      final byte[] message, final FalconPrivateKeyParameters privateKey, final SecureRandom random) {
    final FalconSigner signer = new FalconSigner();
    signer.init(true, new ParametersWithRandom(privateKey, random));
    return signer.generateSignature(Arrays.copyOf(message, message.length));
  }

  public static boolean verify(
      final byte[] message, final byte[] signature, final FalconPublicKeyParameters publicKey) {
    final FalconSigner signer = new FalconSigner();
    signer.init(false, publicKey);
    return signer.verifySignature(Arrays.copyOf(message, message.length), signature);
  }

  /**
   * Reconstructs public-key parameters from the canonical encoded form (1793 bytes). The raw
   * 1792-byte {@code h} form is also accepted and used as-is.
   */
  public static FalconPublicKeyParameters publicKeyFromBytes(final byte[] encoded) {
    Objects.requireNonNull(encoded, "encoded");
    if (encoded.length == PUBLIC_KEY_LENGTH) {
      return new FalconPublicKeyParameters(
          PARAMETERS, Arrays.copyOfRange(encoded, 1, encoded.length));
    }
    if (encoded.length == RAW_PUBLIC_KEY_LENGTH) {
      return new FalconPublicKeyParameters(PARAMETERS, encoded);
    }
    throw new IllegalArgumentException(
        "Expected " + PUBLIC_KEY_LENGTH + "-byte encoded Falcon-1024 public key");
  }

  /**
   * Derive Ethereum-style address from the canonical encoded Falcon-1024 public key: last 20 bytes
   * of keccak256(pubkey).
   */
  public static Bytes addressFromPublicKey(final byte[] publicKey) {
    final Bytes32 hash = Hash.keccak256(Bytes.wrap(publicKey));
    return hash.slice(12); // last 20 bytes
  }
}
