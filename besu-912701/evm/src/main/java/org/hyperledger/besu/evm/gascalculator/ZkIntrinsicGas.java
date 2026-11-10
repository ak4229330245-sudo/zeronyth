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
package org.hyperledger.besu.evm.gascalculator;

import org.hyperledger.besu.datatypes.Transaction;
import org.hyperledger.besu.datatypes.TransactionType;

public final class ZkIntrinsicGas {
  public static final long GAS_PER_ENVELOPE_BYTE = 16L;

  private ZkIntrinsicGas() {}

  public static long surcharge(Transaction transaction) {
    if (transaction.getType() == TransactionType.ZKSTARK) {
      return GAS_PER_ENVELOPE_BYTE * transaction.getSizeForBlockInclusion();
    }
    return 0L;
  }
}
