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

import org.hyperledger.besu.crypto.Falcon1024TransactionCrypto;
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
 * Decoder for Falcon-1024 native transactions (type 0x7E).
 *
 * <p>Wire format: {@code 0x7E || rlp([nonce, gasPrice, gasLimit, to, value, data, chainId,
 * publicKey, signature])}. The public key must be the canonical 1793-byte encoded form and the
 * signature must not exceed {@link Falcon1024TransactionCrypto#MAX_SIGNATURE_LENGTH} bytes; both
 * are enforced at decode time so malformed or oversized payloads are rejected before they can
 * reach the transaction pool (DoS hygiene).
 */
public class FalconTransactionDecoder {

  private FalconTransactionDecoder() {
    // private constructor
  }

  public static Transaction decode(final Bytes input) {
    final RLPInput txRlp = RLP.input(input.slice(1)); // Skip the transaction type byte
    txRlp.enterList();
    final Transaction.Builder builder =
        Transaction.builder()
            .type(TransactionType.FALCON1024)
            .nonce(txRlp.readLongScalar())
            .gasPrice(Wei.of(txRlp.readUInt256Scalar()))
            .gasLimit(txRlp.readLongScalar())
            .to(txRlp.readBytes(v -> v.isEmpty() ? null : Address.wrap(v)))
            .value(Wei.of(txRlp.readUInt256Scalar()))
            .payload(txRlp.readBytes())
            .chainId(txRlp.readBigIntegerScalar())
            .falconPublicKey(readPublicKey(txRlp))
            .falconSignature(readSignature(txRlp))
            .rawRlp(txRlp.raw())
            .sizeForAnnouncement(input.size())
            .sizeForBlockInclusion(input.size())
            .hash(Hash.hash(input));
    txRlp.leaveList();
    return builder.build();
  }

  private static Bytes readPublicKey(final RLPInput txRlp) {
    final Bytes publicKey = txRlp.readBytes();
    if (publicKey.size() != Falcon1024TransactionCrypto.PUBLIC_KEY_LENGTH) {
      throw new RLPException(
          "Falcon-1024 transaction public key must be "
              + Falcon1024TransactionCrypto.PUBLIC_KEY_LENGTH
              + " bytes (canonical encoded form), got "
              + publicKey.size());
    }
    return publicKey;
  }

  private static Bytes readSignature(final RLPInput txRlp) {
    final Bytes signature = txRlp.readBytes();
    if (signature.isEmpty()
        || signature.size() > Falcon1024TransactionCrypto.MAX_SIGNATURE_LENGTH) {
      throw new RLPException(
          "Falcon-1024 transaction signature must be between 1 and "
              + Falcon1024TransactionCrypto.MAX_SIGNATURE_LENGTH
              + " bytes, got "
              + signature.size());
    }
    return signature;
  }
}
