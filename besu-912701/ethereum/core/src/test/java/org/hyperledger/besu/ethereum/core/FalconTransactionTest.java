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
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class FalconTransactionTest {

  private static final BigInteger CHAIN_ID = BigInteger.valueOf(912772);
  private static final Address RECIPIENT =
      Address.fromHexString("0x1111111111111111111111111111111111111111");

  private final SecureRandom random = SecureRandomProvider.publicSecureRandom();
  private AsymmetricCipherKeyPair keyPair;
  private byte[] publicKeyBytes;
  private Address expectedSender;

  @BeforeEach
  void setUp() {
    keyPair = Falcon1024TransactionCrypto.generateKeyPair(random);
    publicKeyBytes = Falcon1024TransactionCrypto.getPublicKeyBytes(keyPair);
    expectedSender = Address.wrap(Falcon1024TransactionCrypto.addressFromPublicKey(publicKeyBytes));
  }

  private Transaction.Builder baseBuilder() {
    return Transaction.builder()
        .type(TransactionType.FALCON1024)
        .nonce(0)
        .gasPrice(Wei.of(1_000_000_000L))
        .gasLimit(150_000)
        .to(RECIPIENT)
        .value(Wei.of(123_456_789L))
        .payload(Bytes.fromHexString("0xdeadbeef"))
        .chainId(CHAIN_ID);
  }

  private Transaction signAndBuild() {
    return baseBuilder()
        .signAndBuildFalcon(
            (FalconPrivateKeyParameters) keyPair.getPrivate(), publicKeyBytes, random);
  }

  @Test
  void signAndBuildFalconHappyPath() {
    final Transaction transaction = signAndBuild();

    assertThat(transaction.getType()).isEqualTo(TransactionType.FALCON1024);
    assertThat(transaction.getFalconPublicKey()).contains(Bytes.wrap(publicKeyBytes));
    assertThat(transaction.getFalconSignature()).isPresent();
    // Canonical encoded public key is 1793 bytes; Falcon-1024 signatures are variable
    // length, at most 1280 bytes for the compressed encoding (BouncyCastle 1.84).
    assertThat(publicKeyBytes.length).isEqualTo(1793);
    assertThat(publicKeyBytes[0]).isEqualTo((byte) 0x0a);
    assertThat(transaction.getFalconSignature().get().size())
        .isBetween(1000, Falcon1024TransactionCrypto.MAX_SIGNATURE_LENGTH);
    assertThat(transaction.getSender()).isEqualTo(expectedSender);
    // No ECDSA key is recovered from the dummy signature; the Falcon key is reported.
    assertThat(transaction.getPublicKey()).contains(Bytes.wrap(publicKeyBytes).toString());
  }

  @Test
  void encodeDecodeRoundtripPreservesFields() {
    final Transaction transaction = signAndBuild();

    for (final EncodingContext context :
        new EncodingContext[] {EncodingContext.POOLED_TRANSACTION, EncodingContext.BLOCK_BODY}) {
      final Bytes encoded = TransactionEncoder.encodeOpaqueBytes(transaction, context);
      assertThat(encoded.get(0)).isEqualTo((byte) 0x7E);

      final Transaction decoded = TransactionDecoder.decodeOpaqueBytes(encoded, context);
      assertThat(decoded.getType()).isEqualTo(TransactionType.FALCON1024);
      assertThat(decoded.getNonce()).isEqualTo(transaction.getNonce());
      assertThat(decoded.getGasPrice()).isEqualTo(transaction.getGasPrice());
      assertThat(decoded.getGasLimit()).isEqualTo(transaction.getGasLimit());
      assertThat(decoded.getTo()).isEqualTo(transaction.getTo());
      assertThat(decoded.getValue()).isEqualTo(transaction.getValue());
      assertThat(decoded.getPayload()).isEqualTo(transaction.getPayload());
      assertThat(decoded.getChainId()).isEqualTo(transaction.getChainId());
      assertThat(decoded.getFalconPublicKey()).isEqualTo(transaction.getFalconPublicKey());
      assertThat(decoded.getFalconSignature()).isEqualTo(transaction.getFalconSignature());
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
        .isEqualTo(Address.wrap(Falcon1024TransactionCrypto.addressFromPublicKey(publicKeyBytes)));
  }

  @Test
  void tamperedSignatureRejectedInSenderRecovery() {
    final Transaction transaction = signAndBuild();
    final byte[] tamperedSignature =
        transaction.getFalconSignature().orElseThrow().toArrayUnsafe().clone();
    tamperedSignature[100] ^= 1;

    final Transaction tampered =
        baseBuilder()
            .falconPublicKey(Bytes.wrap(publicKeyBytes))
            .falconSignature(Bytes.wrap(tamperedSignature))
            .build();

    assertThatThrownBy(tampered::getSender)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid Falcon-1024 signature");
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
        .hasMessageContaining("Invalid Falcon-1024 signature");
  }

  @Test
  void signatureForDifferentChainIdRejectedInSenderRecovery() {
    final Transaction transaction = signAndBuild();

    // Reuse the signature with a different chainId: the signed preimage covers the
    // chainId, so verification must fail (replay protection).
    final Transaction replayed =
        baseBuilder()
            .chainId(CHAIN_ID.add(BigInteger.ONE))
            .falconPublicKey(transaction.getFalconPublicKey().orElseThrow())
            .falconSignature(transaction.getFalconSignature().orElseThrow())
            .build();

    assertThatThrownBy(replayed::getSender)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid Falcon-1024 signature");
  }
}
