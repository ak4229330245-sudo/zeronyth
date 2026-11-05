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

import org.hyperledger.besu.ethereum.core.Transaction;
import org.hyperledger.besu.ethereum.rlp.RLPOutput;

/** Encoder for Falcon-1024 native transactions (type 0x7E, ZERONYTH signature-role swap 案C). */
public class FalconTransactionEncoder {

  public static void encode(final Transaction transaction, final RLPOutput out) {
    out.startList();
    out.writeLongScalar(transaction.getNonce());
    out.writeUInt256Scalar(transaction.getGasPrice().orElseThrow());
    out.writeLongScalar(transaction.getGasLimit());
    out.writeBytes(transaction.getTo().map(a -> a.getBytes()).orElse(org.apache.tuweni.bytes.Bytes.EMPTY));
    out.writeUInt256Scalar(transaction.getValue());
    out.writeBytes(transaction.getPayload());
    out.writeBigIntegerScalar(transaction.getChainId().orElseThrow());
    out.writeBytes(transaction.getFalconPublicKey().orElseThrow());
    out.writeBytes(transaction.getFalconSignature().orElseThrow());
    out.endList();
  }
}
