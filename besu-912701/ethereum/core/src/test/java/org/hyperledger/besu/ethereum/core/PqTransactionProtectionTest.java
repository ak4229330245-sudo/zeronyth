/*
 * Copyright contributors to Hyperledger Besu.
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
package org.hyperledger.besu.ethereum.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.hyperledger.besu.crypto.Falcon1024TransactionCrypto;
import org.hyperledger.besu.crypto.KeyPair;
import org.hyperledger.besu.crypto.MlDsa65TransactionCrypto;
import org.hyperledger.besu.crypto.SecureRandomProvider;
import org.hyperledger.besu.crypto.SignatureAlgorithmFactory;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.datatypes.Wei;
import org.hyperledger.besu.ethereum.core.encoding.EncodingContext;
import org.hyperledger.besu.ethereum.core.encoding.TransactionDecoder;
import org.hyperledger.besu.ethereum.core.encoding.TransactionEncoder;
import org.hyperledger.besu.ethereum.rlp.BytesValueRLPOutput;
import org.hyperledger.besu.ethereum.rlp.RLPException;

import java.math.BigInteger;
import java.security.SecureRandom;

import org.apache.tuweni.bytes.Bytes;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * PQ-account protection and wire-format hygiene for the ZERONYTH PQ transaction types.
 *
 * <p>The core design constraint under test: sender derivation is scheme-bound. A transaction of
 * type 0x7E can only ever derive its sender from a Falcon-1024 key/signature pair, a transaction
 * of type 0x7F only from an ML-DSA-65 pair, and an ECDSA signature — even one made with key
 * material related to a PQ account — can never operate a PQ account. There is no cross-scheme
 * fallback anywhere in sender recovery.
 */
public class PqTransactionProtectionTest {

  private static final BigInteger CHAIN_ID = BigInteger.valueOf(912772);
  private static final Address RECIPIENT =
      Address.fromHexString("0x2222222222222222222222222222222222222222");

  private final SecureRandom random = SecureRandomProvider.publicSecureRandom();
  private AsymmetricCipherKeyPair mlDsaKeyPair;
  private byte[] mlDsaPublicKeyBytes;
  private Address mlDsaAddress;
  private AsymmetricCipherKeyPair falconKeyPair;
  private byte[] falconPublicKeyBytes;
  private Address falconAddress;

  @BeforeEach
  void setUp() {
    mlDsaKeyPair = MlDsa65TransactionCrypto.generateKeyPair(random);
    mlDsaPublicKeyBytes = MlDsa65TransactionCrypto.getPublicKeyBytes(mlDsaKeyPair);
    mlDsaAddress = Address.wrap(MlDsa65TransactionCrypto.addressFromPublicKey(mlDsaPublicKeyBytes));
    falconKeyPair = Falcon1024TransactionCrypto.generateKeyPair(random);
    falconPublicKeyBytes = Falcon1024TransactionCrypto.getPublicKeyBytes(falconKeyPair);
    falconAddress =
        Address.wrap(Falcon1024TransactionCrypto.addressFromPublicKey(falconPublicKeyBytes));
  }

  private Transaction mlDsaTransaction() {
    return Transaction.builder()
        .type(TransactionType.MLDSA65)
        .nonce(0)
        .gasPrice(Wei.of(1_000_000_000L))
        .gasLimit(200_000)
        .to(RECIPIENT)
        .value(Wei.ONE)
        .payload(Bytes.EMPTY)
        .chainId(CHAIN_ID)
        .signAndBuildMlDsa(
            (MLDSAPrivateKeyParameters) mlDsaKeyPair.getPrivate(), mlDsaPublicKeyBytes, random);
  }

  private Transaction falconTransaction() {
    return Transaction.builder()
        .type(TransactionType.FALCON1024)
        .nonce(0)
        .gasPrice(Wei.of(1_000_000_000L))
        .gasLimit(200_000)
        .to(RECIPIENT)
        .value(Wei.ONE)
        .payload(Bytes.EMPTY)
        .chainId(CHAIN_ID)
        .signAndBuildFalcon(
            (FalconPrivateKeyParameters) falconKeyPair.getPrivate(), falconPublicKeyBytes, random);
  }

  // ---------- type-byte spoofing ----------

  @Test
  void falconWireBytesRelabeledAsMlDsaAreRejected() {
    final Bytes falconRaw =
        TransactionEncoder.encodeOpaqueBytes(falconTransaction(), EncodingContext.POOLED_TRANSACTION);
    final byte[] spoofed = falconRaw.toArrayUnsafe().clone();
    spoofed[0] = (byte) 0x7F; // relabel Falcon (0x7E) as ML-DSA (0x7F)
    // The 1793-byte Falcon public key is not a valid 1952-byte ML-DSA key: the ML-DSA
    // decoder's exact-size enforcement rejects the spoofed transaction outright.
    assertThatThrownBy(
            () ->
                TransactionDecoder.decodeOpaqueBytes(
                    Bytes.wrap(spoofed), EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class)
        .hasMessageContaining("ML-DSA-65");
  }

  @Test
  void mlDsaWireBytesRelabeledAsFalconAreRejected() {
    final Bytes mlDsaRaw =
        TransactionEncoder.encodeOpaqueBytes(mlDsaTransaction(), EncodingContext.POOLED_TRANSACTION);
    final byte[] spoofed = mlDsaRaw.toArrayUnsafe().clone();
    spoofed[0] = (byte) 0x7E; // relabel ML-DSA (0x7F) as Falcon (0x7E)
    // The 1952-byte ML-DSA public key is not the canonical 1793-byte Falcon key form.
    assertThatThrownBy(
            () ->
                TransactionDecoder.decodeOpaqueBytes(
                    Bytes.wrap(spoofed), EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class)
        .hasMessageContaining("Falcon-1024");
  }

  // ---------- cross-scheme signature transplant ----------

  @Test
  void mlDsaSignatureDoesNotAuthenticateUnderFalconType() {
    final Transaction mlDsaTx = mlDsaTransaction();
    final Transaction transplant =
        Transaction.builder()
            .type(TransactionType.FALCON1024)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(200_000)
            .to(RECIPIENT)
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID)
            .falconPublicKey(mlDsaTx.getMlDsaPublicKey().orElseThrow())
            .falconSignature(mlDsaTx.getMlDsaSignature().orElseThrow())
            .build();
    // Sender derivation must fail: an ML-DSA key/signature is meaningless under Falcon.
    assertThatThrownBy(transplant::getSender)
        .isInstanceOfAny(IllegalStateException.class, IllegalArgumentException.class);
  }

  @Test
  void falconSignatureDoesNotAuthenticateUnderMlDsaType() {
    final Transaction falconTx = falconTransaction();
    final Transaction transplant =
        Transaction.builder()
            .type(TransactionType.MLDSA65)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(200_000)
            .to(RECIPIENT)
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID)
            .mlDsaPublicKey(falconTx.getFalconPublicKey().orElseThrow())
            .mlDsaSignature(falconTx.getFalconSignature().orElseThrow())
            .build();
    assertThatThrownBy(transplant::getSender)
        .isInstanceOfAny(IllegalStateException.class, IllegalArgumentException.class);
  }

  // ---------- ECDSA cannot operate a PQ account ----------

  @Test
  void pqTypedTransactionWithoutPqFieldsCannotDeriveSender() {
    // A PQ-typed transaction that carries only an ECDSA signature (no embedded PQ public
    // key / PQ signature) has no sender: recovery is scheme-bound and never falls back to
    // ECDSA recovery for PQ types.
    final org.hyperledger.besu.crypto.SECPSignature ecdsaSignature =
        new org.hyperledger.besu.crypto.SECPSignature(
            BigInteger.ONE, BigInteger.ONE, (byte) 0);
    final Transaction mlDsaShell =
        Transaction.builder()
            .type(TransactionType.MLDSA65)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(200_000)
            .to(RECIPIENT)
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID)
            .signature(ecdsaSignature)
            .build();
    // Sender derivation fails closed. (Depending on whether the hash or the sender is
    // computed first, the failure surfaces either as the encoder's NoSuchElementException
    // for the absent public key or as computeSender's IllegalStateException; both prove
    // there is no path from an ECDSA signature to a PQ sender.)
    assertThatThrownBy(mlDsaShell::getSender)
        .isInstanceOfAny(IllegalStateException.class, java.util.NoSuchElementException.class);

    final Transaction falconShell =
        Transaction.builder()
            .type(TransactionType.FALCON1024)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(200_000)
            .to(RECIPIENT)
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID)
            .signature(ecdsaSignature)
            .build();
    assertThatThrownBy(falconShell::getSender)
        .isInstanceOfAny(IllegalStateException.class, java.util.NoSuchElementException.class);
  }

  @Test
  void ecdsaAccountIsDistinctFromPqAccounts() {
    // An ECDSA transaction signed by an ordinary ECDSA key derives the ECDSA account
    // address, which is neither PQ account: holding an ECDSA key gives no control over
    // Falcon or ML-DSA accounts.
    final KeyPair ecdsaKeys =
        SignatureAlgorithmFactory.getInstance()
            .createKeyPair(
                org.hyperledger.besu.crypto.SECPPrivateKey.create(
                    org.apache.tuweni.bytes.Bytes32.fromHexString(
                        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"),
                    "ECDSA"));
    final Transaction ecdsaTx =
        Transaction.builder()
            .type(TransactionType.FRONTIER)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(21_000)
            .to(RECIPIENT)
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID)
            .signAndBuild(ecdsaKeys);
    assertThat(ecdsaTx.getSender()).isNotEqualTo(mlDsaAddress);
    assertThat(ecdsaTx.getSender()).isNotEqualTo(falconAddress);
    // And the two PQ schemes derive different addresses for different keys.
    assertThat(mlDsaAddress).isNotEqualTo(falconAddress);
  }

  // ---------- decoder size enforcement (DoS hygiene) ----------

  private Bytes pqWire(final byte type, final Bytes publicKey, final Bytes signature) {
    final BytesValueRLPOutput out = new BytesValueRLPOutput();
    out.startList();
    out.writeLongScalar(0);
    out.writeUInt256Scalar(Wei.of(1_000_000_000L));
    out.writeLongScalar(200_000);
    out.writeBytes(RECIPIENT.getBytes());
    out.writeUInt256Scalar(Wei.ONE);
    out.writeBytes(Bytes.EMPTY);
    out.writeBigIntegerScalar(CHAIN_ID);
    out.writeBytes(publicKey);
    out.writeBytes(signature);
    out.endList();
    return Bytes.concatenate(Bytes.of(type), out.encoded());
  }

  @Test
  void mlDsaDecoderRejectsUndersizedPublicKey() {
    final Bytes wire =
        pqWire((byte) 0x7F, Bytes.wrap(new byte[100]), Bytes.wrap(new byte[3309]));
    assertThatThrownBy(
            () -> TransactionDecoder.decodeOpaqueBytes(wire, EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class);
  }

  @Test
  void mlDsaDecoderRejectsOversizedSignature() {
    final Bytes wire =
        pqWire((byte) 0x7F, Bytes.wrap(new byte[1952]), Bytes.wrap(new byte[3310]));
    assertThatThrownBy(
            () -> TransactionDecoder.decodeOpaqueBytes(wire, EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class);
  }

  @Test
  void falconDecoderRejectsRawFormPublicKey() {
    // The 1792-byte raw h form is not accepted on the wire; only the canonical
    // 1793-byte encoded form is, so an account has exactly one wire representation.
    final Bytes wire =
        pqWire((byte) 0x7E, Bytes.wrap(new byte[1792]), Bytes.wrap(new byte[1280]));
    assertThatThrownBy(
            () -> TransactionDecoder.decodeOpaqueBytes(wire, EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class);
  }

  @Test
  void falconDecoderRejectsOversizedSignature() {
    final Bytes wire =
        pqWire(
            (byte) 0x7E,
            Bytes.wrap(new byte[1793]),
            Bytes.wrap(new byte[Falcon1024TransactionCrypto.MAX_SIGNATURE_LENGTH + 1]));
    assertThatThrownBy(
            () -> TransactionDecoder.decodeOpaqueBytes(wire, EncodingContext.POOLED_TRANSACTION))
        .isInstanceOf(RLPException.class);
  }
}
