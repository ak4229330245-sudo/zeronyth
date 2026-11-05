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

import static org.assertj.core.api.Assertions.assertThat;

import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.TransactionType;
import org.hyperledger.besu.datatypes.Wei;
import org.hyperledger.besu.ethereum.core.Transaction;
import org.hyperledger.besu.ethereum.transaction.TransactionInvalidReason;

import java.math.BigInteger;
import java.util.OptionalLong;

import org.apache.tuweni.bytes.Bytes;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Activation-gate semantics for the ZERONYTH PQ transaction types. The gate itself is pure:
 * these tests pin the boundary behavior that the pool and processor enforcement points rely
 * on. (The validator deliberately does not consult the gate; pool/processor tests and the
 * live E2E cover the enforcement points.)
 */
public class PqTxGateTest {

  private static final BigInteger CHAIN_ID = BigInteger.valueOf(912772);

  @AfterEach
  void tearDown() {
    PqTxGate.reset();
  }

  private Transaction transactionOfType(final TransactionType type) {
    // Sender derivation is never invoked by the gate, so the PQ transactions need no
    // key/signature material for these checks.
    final Transaction.Builder builder =
        Transaction.builder()
            .type(type)
            .nonce(0)
            .gasPrice(Wei.of(1_000_000_000L))
            .gasLimit(200_000)
            .to(Address.fromHexString("0x1111111111111111111111111111111111111111"))
            .value(Wei.ONE)
            .payload(Bytes.EMPTY)
            .chainId(CHAIN_ID);
    if (type == TransactionType.MLDSA65) {
      builder.mlDsaPublicKey(Bytes.wrap(new byte[1952])).mlDsaSignature(Bytes.wrap(new byte[3309]));
    } else if (type == TransactionType.FALCON1024) {
      builder
          .falconPublicKey(Bytes.wrap(new byte[1793]))
          .falconSignature(Bytes.wrap(new byte[1280]));
    }
    return builder.build();
  }

  @Test
  void pqTransactionsNeverActiveWhenActivationBlockAbsent() {
    PqTxGate.configure(OptionalLong.empty());
    for (final TransactionType type :
        new TransactionType[] {TransactionType.MLDSA65, TransactionType.FALCON1024}) {
      final Transaction tx = transactionOfType(type);
      assertThat(PqTxGate.isActiveAt(0)).isFalse();
      assertThat(PqTxGate.isActiveAt(Long.MAX_VALUE)).isFalse();
      assertThat(PqTxGate.checkActivation(tx, 1_000_000))
          .contains(TransactionInvalidReason.PQ_TRANSACTION_NOT_YET_ACTIVE);
    }
  }

  @Test
  void pqTransactionsActivateExactlyAtConfiguredBlock() {
    PqTxGate.configure(OptionalLong.of(5));
    for (final TransactionType type :
        new TransactionType[] {TransactionType.MLDSA65, TransactionType.FALCON1024}) {
      final Transaction tx = transactionOfType(type);
      assertThat(PqTxGate.checkActivation(tx, 4))
          .contains(TransactionInvalidReason.PQ_TRANSACTION_NOT_YET_ACTIVE);
      assertThat(PqTxGate.checkActivation(tx, 5)).isEmpty();
      assertThat(PqTxGate.checkActivation(tx, 6)).isEmpty();
      assertThat(PqTxGate.isActiveAt(4)).isFalse();
      assertThat(PqTxGate.isActiveAt(5)).isTrue();
    }
  }

  @Test
  void ecdsaTransactionsAreNeverGated() {
    final Transaction frontier = transactionOfType(TransactionType.FRONTIER);
    PqTxGate.configure(OptionalLong.empty());
    assertThat(PqTxGate.checkActivation(frontier, 0)).isEmpty();
    PqTxGate.configure(OptionalLong.of(5));
    assertThat(PqTxGate.checkActivation(frontier, 0)).isEmpty();
    assertThat(PqTxGate.checkActivation(frontier, 4)).isEmpty();
    assertThat(PqTxGate.checkActivation(frontier, 5)).isEmpty();
    assertThat(PqTxGate.isPqTransaction(TransactionType.FRONTIER)).isFalse();
    assertThat(PqTxGate.isPqTransaction(TransactionType.EIP1559)).isFalse();
    assertThat(PqTxGate.isPqTransaction(TransactionType.MLDSA65)).isTrue();
    assertThat(PqTxGate.isPqTransaction(TransactionType.FALCON1024)).isTrue();
  }
}
