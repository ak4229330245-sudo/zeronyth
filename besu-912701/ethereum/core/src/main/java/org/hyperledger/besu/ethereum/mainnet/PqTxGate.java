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
package org.hyperledger.besu.ethereum.mainnet;

import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.ethereum.core.Transaction;
import org.hyperledger.besu.ethereum.transaction.TransactionInvalidReason;

import java.util.Optional;
import java.util.OptionalLong;

/**
 * Activation gate for the ZERONYTH post-quantum native transaction types (Falcon-1024, 0x7E and
 * ML-DSA-65, 0x7F).
 *
 * <p>The gate is driven by the genesis configuration key {@code pqTxActivationBlock}:
 *
 * <ul>
 *   <li>key absent — PQ transactions are <b>never</b> active on this chain;
 *   <li>key present with value {@code N} — PQ transactions become valid for blocks {@code >= N}
 *       (and for transaction-pool admission once the chain head is at block {@code N - 1}).
 * </ul>
 *
 * <p>Enforcement points: transaction-pool admission (which also backs {@code
 * eth_sendRawTransaction}) and block execution in {@link MainnetTransactionProcessor}, which
 * covers block import validation as well as block creation. ECDSA and all other transaction
 * types are completely unaffected by the gate.
 *
 * <p>The configured value is process-wide: a Besu process serves exactly one chain, whose
 * protocol schedule is created once at startup ({@code ProtocolScheduleBuilder} calls {@link
 * #configure(OptionalLong)}). Tests may reconfigure or {@link #reset()} freely.
 */
public final class PqTxGate {

  private static volatile OptionalLong activationBlock = OptionalLong.empty();

  private PqTxGate() {
    // utility class
  }

  /** Records the activation block from the genesis configuration. */
  public static void configure(final OptionalLong pqTxActivationBlock) {
    activationBlock = pqTxActivationBlock;
  }

  /** Clears the configuration (PQ transactions inactive). Intended for tests. */
  public static void reset() {
    activationBlock = OptionalLong.empty();
  }

  /** The configured activation block, if any. */
  public static OptionalLong activationBlock() {
    return activationBlock;
  }

  /** Whether the given transaction type is a gated post-quantum type. */
  public static boolean isPqTransaction(final TransactionType type) {
    return type == TransactionType.MLDSA65 || type == TransactionType.FALCON1024;
  }

  /** Whether PQ transactions are active for the given block number. */
  public static boolean isActiveAt(final long blockNumber) {
    return activationBlock.isPresent() && blockNumber >= activationBlock.getAsLong();
  }

  /**
   * Checks a transaction against the gate for the given block number.
   *
   * @param transaction the transaction to check
   * @param blockNumber the number of the block the transaction would be executed in
   * @return the invalid reason if the transaction is a PQ transaction that is not yet active,
   *     otherwise empty
   */
  public static Optional<TransactionInvalidReason> checkActivation(
      final Transaction transaction, final long blockNumber) {
    if (isPqTransaction(transaction.getType()) && !isActiveAt(blockNumber)) {
      return Optional.of(TransactionInvalidReason.PQ_TRANSACTION_NOT_YET_ACTIVE);
    }
    return Optional.empty();
  }
}
