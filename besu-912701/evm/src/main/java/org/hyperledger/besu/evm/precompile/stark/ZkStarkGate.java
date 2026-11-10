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
package org.hyperledger.besu.evm.precompile.stark;

import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.TransactionType;

import java.util.Optional;
import java.util.OptionalLong;

public final class ZkStarkGate {
  private static volatile OptionalLong precompileActivationBlock = OptionalLong.empty();
  private static volatile OptionalLong txActivationBlock = OptionalLong.empty();
  private static volatile Optional<Address> poolAddress = Optional.empty();

  private ZkStarkGate() {}

  public static void configure(
      OptionalLong zkPrecompileActivationBlock,
      OptionalLong zkTxActivationBlock,
      Optional<Address> zkPoolAddress) {
    precompileActivationBlock = zkPrecompileActivationBlock;
    txActivationBlock = zkTxActivationBlock;
    poolAddress = zkPoolAddress;
  }

  public static void reset() {
    precompileActivationBlock = OptionalLong.empty();
    txActivationBlock = OptionalLong.empty();
    poolAddress = Optional.empty();
  }

  public static boolean isPrecompileActiveAt(long blockNumber) {
    return precompileActivationBlock.isPresent()
        && blockNumber >= precompileActivationBlock.getAsLong();
  }

  public static boolean isTxActiveAt(long blockNumber) {
    return txActivationBlock.isPresent() && blockNumber >= txActivationBlock.getAsLong();
  }

  public static OptionalLong precompileActivationBlock() {
    return precompileActivationBlock;
  }

  public static OptionalLong txActivationBlock() {
    return txActivationBlock;
  }

  public static Optional<Address> poolAddress() {
    return poolAddress;
  }

  public static Optional<ZkStarkGate.Violation> check(
      TransactionType transactionType,
      Optional<Address> to,
      boolean valueIsZero,
      long blockNumber) {
    if (transactionType != TransactionType.ZKSTARK) {
      return Optional.empty();
    }
    if (!isTxActiveAt(blockNumber)) {
      return Optional.of(ZkStarkGate.Violation.NOT_YET_ACTIVE);
    }
    if (poolAddress.isEmpty() || to.isEmpty() || !to.get().equals(poolAddress.get())) {
      return Optional.of(ZkStarkGate.Violation.INVALID_TARGET);
    }
    if (!valueIsZero) {
      return Optional.of(ZkStarkGate.Violation.NONZERO_VALUE);
    }
    return Optional.empty();
  }

  public static enum Violation {
    NOT_YET_ACTIVE,
    INVALID_TARGET,
    NONZERO_VALUE;
  }
}
