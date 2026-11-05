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
package org.hyperledger.besu.ethereum.core.encoding;

import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Hash;
import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.datatypes.Wei;
import org.hyperledger.besu.ethereum.core.Transaction;
import org.hyperledger.besu.ethereum.rlp.RLP;
import org.hyperledger.besu.ethereum.rlp.RLPException;
import org.hyperledger.besu.ethereum.rlp.RLPInput;

import org.apache.tuweni.bytes.Bytes;

/**
 * Decoder for ML-DSA-65 native transactions (type 0x7F).
 *
 * <p>Wire format: {@code 0x7F || rlp([nonce, gasPrice, gasLimit, to, value, data, chainId,
 * publicKey, signature])}. ML-DSA-65 (FIPS 204) has fixed-size keys and signatures — 1952-byte
 * public key, 3309-byte signature — and both are enforced exactly at decode time so malformed
 * or oversized payloads are rejected before they can reach the transaction pool (DoS hygiene).
 */
public class MlDsaTransactionDecoder {

  /** ML-DSA-65 public key length in bytes (FIPS 204). */
  public static final int PUBLIC_KEY_LENGTH = 1952;

  /** ML-DSA-65 signature length in bytes (FIPS 204). */
  public static final int SIGNATURE_LENGTH = 3309;

  private MlDsaTransactionDecoder() {
    // private constructor
  }

  public static Transaction decode(final Bytes input) {
    final RLPInput txRlp = RLP.input(input.slice(1)); // Skip the transaction type byte
    txRlp.enterList();
    final Transaction.Builder builder =
        Transaction.builder()
            .type(TransactionType.MLDSA65)
            .nonce(txRlp.readLongScalar())
            .gasPrice(Wei.of(txRlp.readUInt256Scalar()))
            .gasLimit(txRlp.readLongScalar())
            .to(txRlp.readBytes(v -> v.isEmpty() ? null : Address.wrap(v)))
            .value(Wei.of(txRlp.readUInt256Scalar()))
            .payload(txRlp.readBytes())
            .chainId(txRlp.readBigIntegerScalar())
            .mlDsaPublicKey(readFixedSize(txRlp, PUBLIC_KEY_LENGTH, "public key"))
            .mlDsaSignature(readFixedSize(txRlp, SIGNATURE_LENGTH, "signature"))
            .rawRlp(txRlp.raw())
            .sizeForAnnouncement(input.size())
            .sizeForBlockInclusion(input.size())
            .hash(Hash.hash(input));
    txRlp.leaveList();
    return builder.build();
  }

  private static Bytes readFixedSize(
      final RLPInput txRlp, final int expectedSize, final String fieldName) {
    final Bytes value = txRlp.readBytes();
    if (value.size() != expectedSize) {
      throw new RLPException(
          "ML-DSA-65 transaction "
              + fieldName
              + " must be "
              + expectedSize
              + " bytes, got "
              + value.size());
    }
    return value;
  }
}
