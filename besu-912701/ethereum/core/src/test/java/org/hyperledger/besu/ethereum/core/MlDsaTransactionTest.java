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

import org.hyperledger.besu.crypto.MlDsa65TransactionCrypto;
import org.hyperledger.besu.crypto.SecureRandomProvider;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Hash;
import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.datatypes.Wei;
import org.hyperledger.besu.ethereum.core.encoding.EncodingContext;
import org.hyperledger.besu.ethereum.core.encoding.TransactionDecoder;
import org.hyperledger.besu.ethereum.core.encoding.TransactionEncoder;

import java.math.BigInteger;
import java.security.SecureRandom;

import org.apache.tuweni.bytes.Bytes;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class MlDsaTransactionTest {

  private static final BigInteger CHAIN_ID = BigInteger.valueOf(912770);
  private static final Address RECIPIENT =
      Address.fromHexString("0x1111111111111111111111111111111111111111");

  private final SecureRandom random = SecureRandomProvider.publicSecureRandom();
  private AsymmetricCipherKeyPair keyPair;
  private byte[] publicKeyBytes;
  private Address expectedSender;

  @BeforeEach
  void setUp() {
    keyPair = MlDsa65TransactionCrypto.generateKeyPair(random);
    publicKeyBytes = MlDsa65TransactionCrypto.getPublicKeyBytes(keyPair);
    expectedSender = Address.wrap(MlDsa65TransactionCrypto.addressFromPublicKey(publicKeyBytes));
  }

  private Transaction.Builder baseBuilder() {
    return Transaction.builder()
        .type(TransactionType.MLDSA65)
        .nonce(0)
        .gasPrice(Wei.of(1_000_000_000L))
        .gasLimit(21_000)
        .to(RECIPIENT)
        .value(Wei.of(123_456_789L))
        .payload(Bytes.fromHexString("0xdeadbeef"))
        .chainId(CHAIN_ID);
  }

  private Transaction signAndBuild() {
    return baseBuilder()
        .signAndBuildMlDsa(
            (MLDSAPrivateKeyParameters) keyPair.getPrivate(), publicKeyBytes, random);
  }

  @Test
  void signAndBuildMlDsaHappyPath() {
    final Transaction transaction = signAndBuild();

    assertThat(transaction.getType()).isEqualTo(TransactionType.MLDSA65);
    assertThat(transaction.getMlDsaPublicKey()).contains(Bytes.wrap(publicKeyBytes));
    assertThat(transaction.getMlDsaSignature()).isPresent();
    // ML-DSA-65 signatures are 3309 bytes, public keys 1952 bytes
    assertThat(transaction.getMlDsaSignature().get().size()).isEqualTo(3309);
    assertThat(publicKeyBytes.length).isEqualTo(1952);
    assertThat(transaction.getSender()).isEqualTo(expectedSender);
    // No ECDSA key is recovered from the dummy signature; the ML-DSA key is reported.
    assertThat(transaction.getPublicKey()).contains(Bytes.wrap(publicKeyBytes).toString());
  }

  @Test
  void encodeDecodeRoundtripPreservesFields() {
    final Transaction transaction = signAndBuild();

    for (final EncodingContext context :
        new EncodingContext[] {EncodingContext.POOLED_TRANSACTION, EncodingContext.BLOCK_BODY}) {
      final Bytes encoded = TransactionEncoder.encodeOpaqueBytes(transaction, context);
      assertThat(encoded.get(0)).isEqualTo((byte) 0x7F);

      final Transaction decoded = TransactionDecoder.decodeOpaqueBytes(encoded, context);
      assertThat(decoded.getType()).isEqualTo(TransactionType.MLDSA65);
      assertThat(decoded.getNonce()).isEqualTo(transaction.getNonce());
      assertThat(decoded.getGasPrice()).isEqualTo(transaction.getGasPrice());
      assertThat(decoded.getGasLimit()).isEqualTo(transaction.getGasLimit());
      assertThat(decoded.getTo()).isEqualTo(transaction.getTo());
      assertThat(decoded.getValue()).isEqualTo(transaction.getValue());
      assertThat(decoded.getPayload()).isEqualTo(transaction.getPayload());
      assertThat(decoded.getChainId()).isEqualTo(transaction.getChainId());
      assertThat(decoded.getMlDsaPublicKey()).isEqualTo(transaction.getMlDsaPublicKey());
      assertThat(decoded.getMlDsaSignature()).isEqualTo(transaction.getMlDsaSignature());
      assertThat(decoded.getHash()).isEqualTo(Hash.hash(encoded));
      assertThat(decoded.getHash()).isEqualTo(transaction.getHash());
      assertThat(decoded.getSizeForAnnouncement()).isEqualTo(encoded.size());
      assertThat(decoded.getSizeForBlockInclusion()).isEqualTo(encoded.size());
      // Re-encoding the decoded transaction reproduces the exact wire bytes.
      assertThat(TransactionEncoder.encodeOpaqueBytes(decoded, context)).isEqualTo(encoded);
    }
  }

  @Test
  void senderRecoveryMatchesAddressFromPublicKey() {
    final Transaction transaction = signAndBuild();
    final Bytes encoded =
        TransactionEncoder.encodeOpaqueBytes(transaction, EncodingContext.POOLED_TRANSACTION);
    final Transaction decoded =
        TransactionDecoder.decodeOpaqueBytes(encoded, EncodingContext.POOLED_TRANSACTION);

    assertThat(decoded.getSender()).isEqualTo(expectedSender);
    assertThat(decoded.getSender())
        .isEqualTo(Address.wrap(MlDsa65TransactionCrypto.addressFromPublicKey(publicKeyBytes)));
  }

  @Test
  void tamperedSignatureRejectedInSenderRecovery() {
    final Transaction transaction = signAndBuild();
    final byte[] tamperedSignature =
        transaction.getMlDsaSignature().orElseThrow().toArrayUnsafe().clone();
    tamperedSignature[100] ^= 1;

    final Transaction tampered =
        baseBuilder()
            .mlDsaPublicKey(Bytes.wrap(publicKeyBytes))
            .mlDsaSignature(Bytes.wrap(tamperedSignature))
            .build();

    assertThatThrownBy(tampered::getSender)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid ML-DSA-65 signature");
  }

  @Test
  void tamperedWireBytesRejectedInSenderRecovery() {
    final Transaction transaction = signAndBuild();
    final Bytes encoded =
        TransactionEncoder.encodeOpaqueBytes(transaction, EncodingContext.POOLED_TRANSACTION);
    // The signature is the last RLP field, so the final byte is a signature byte.
    final byte[] tamperedBytes = encoded.toArrayUnsafe().clone();
    tamperedBytes[tamperedBytes.length - 1] ^= 1;

    final Transaction decoded =
        TransactionDecoder.decodeOpaqueBytes(
            Bytes.wrap(tamperedBytes), EncodingContext.POOLED_TRANSACTION);

    assertThatThrownBy(decoded::getSender)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid ML-DSA-65 signature");
  }

  @Test
  void signatureForDifferentChainIdRejectedInSenderRecovery() {
    final Transaction transaction = signAndBuild();

    // Reuse the signature with a different chainId: the signed preimage covers the
    // chainId, so verification must fail (replay protection).
    final Transaction replayed =
        baseBuilder()
            .chainId(CHAIN_ID.add(BigInteger.ONE))
            .mlDsaPublicKey(transaction.getMlDsaPublicKey().orElseThrow())
            .mlDsaSignature(transaction.getMlDsaSignature().orElseThrow())
            .build();

    assertThatThrownBy(replayed::getSender)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid ML-DSA-65 signature");
  }
}
