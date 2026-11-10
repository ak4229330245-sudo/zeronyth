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

import org.hyperledger.besu.crypto.SignatureAlgorithm;
import org.hyperledger.besu.crypto.SignatureAlgorithmFactory;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Hash;
import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.datatypes.Wei;
import org.hyperledger.besu.ethereum.core.Transaction;
import org.hyperledger.besu.ethereum.rlp.RLP;
import org.hyperledger.besu.ethereum.rlp.RLPException;
import org.hyperledger.besu.ethereum.rlp.RLPInput;

import org.apache.tuweni.bytes.Bytes;

public class ZkTransactionDecoder {
  public static final int MAX_PROOF_PARAMS_LENGTH = 1024;
  public static final int MAX_PROOF_LENGTH = 131072;
  public static final int MAX_DATA_LENGTH = 524288;
  private static final SignatureAlgorithm SIGNATURE_ALGORITHM =
      SignatureAlgorithmFactory.getInstance();

  private ZkTransactionDecoder() {}

  public static Transaction decode(Bytes input) {
    RLPInput txRlp = RLP.input(input.slice(1));
    txRlp.enterList();
    Transaction.Builder builder =
        Transaction.builder()
            .type(TransactionType.ZKSTARK)
            .nonce(txRlp.readLongScalar())
            .gasPrice(Wei.of(txRlp.readUInt256Scalar()))
            .gasLimit(txRlp.readLongScalar())
            .to(txRlp.readBytes(v -> v.isEmpty() ? null : Address.wrap(v)))
            .value(Wei.of(txRlp.readUInt256Scalar()))
            .payload(readBounded(txRlp, 524288, "data"))
            .chainId(txRlp.readBigIntegerScalar())
            .zkProofParams(readBounded(txRlp, 1024, "proofParams"))
            .zkProof(readBounded(txRlp, 131072, "proof"))
            .rawRlp(txRlp.raw())
            .sizeForAnnouncement(input.size())
            .sizeForBlockInclusion(input.size())
            .hash(Hash.hash(input));
    byte recId = (byte) txRlp.readUnsignedByteScalar();
    if (recId != 0 && recId != 1) {
      throw new RLPException("ZK transaction v must be the y-parity (0 or 1), got " + recId);
    } else {
      Transaction transaction =
          builder
              .signature(
                  SIGNATURE_ALGORITHM.createSignature(
                      txRlp.readUInt256Scalar().toUnsignedBigInteger(),
                      txRlp.readUInt256Scalar().toUnsignedBigInteger(),
                      recId))
              .build();
      txRlp.leaveList();
      return transaction;
    }
  }

  private static Bytes readBounded(RLPInput txRlp, int maxSize, String field) {
    Bytes value = txRlp.readBytes();
    if (value.size() > maxSize) {
      throw new RLPException(
          "ZK transaction " + field + " exceeds maximum size " + maxSize + ": " + value.size());
    } else {
      return value;
    }
  }
}
