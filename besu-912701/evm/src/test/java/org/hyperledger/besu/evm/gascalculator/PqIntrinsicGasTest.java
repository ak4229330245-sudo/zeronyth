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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Transaction;
import org.hyperledger.besu.datatypes.TransactionType;

import java.util.Optional;

import org.apache.tuweni.bytes.Bytes;
import org.junit.jupiter.api.Test;

/**
 * Pins the ZERONYTH PQ intrinsic gas schedule: the per-scheme surcharge constants, their
 * application in the Frontier calculator (inherited by Berlin through Osaka), the Amsterdam
 * calculator, and the guarantee that non-PQ transactions are charged exactly as before.
 */
public class PqIntrinsicGasTest {

  private Transaction transactionOfType(final TransactionType type) {
    final Transaction transaction = mock(Transaction.class);
    when(transaction.getType()).thenReturn(type);
    when(transaction.getPayload()).thenReturn(Bytes.EMPTY);
    when(transaction.getPayloadZeroBytes()).thenReturn(0L);
    when(transaction.getTo())
        .thenAnswer(inv -> Optional.of(Address.fromHexString("0x1111111111111111111111111111111111111111")));
    when(transaction.getSender()).thenReturn(Address.ZERO);
    when(transaction.getValue()).thenReturn(org.hyperledger.besu.datatypes.Wei.ZERO);
    when(transaction.isContractCreation()).thenReturn(false);
    when(transaction.getAccessList()).thenReturn(Optional.empty());
    return transaction;
  }

  @Test
  void surchargeScheduleConstants() {
    // Byte component at 16 gas/byte over the canonical envelope sizes.
    assertThat(PqIntrinsicGas.FALCON1024_ENVELOPE_BYTES).isEqualTo(3255L);
    assertThat(PqIntrinsicGas.MLDSA65_ENVELOPE_BYTES).isEqualTo(5261L);
    assertThat(PqIntrinsicGas.FALCON1024_SURCHARGE).isEqualTo(3255L * 16 + 30_000L);
    assertThat(PqIntrinsicGas.MLDSA65_SURCHARGE).isEqualTo(5261L * 16 + 42_000L);
    assertThat(PqIntrinsicGas.FALCON1024_SURCHARGE).isEqualTo(82_080L);
    assertThat(PqIntrinsicGas.MLDSA65_SURCHARGE).isEqualTo(126_176L);
  }

  @Test
  void surchargeIsZeroForNonPqTypes() {
    for (final TransactionType type :
        new TransactionType[] {
          TransactionType.FRONTIER,
          TransactionType.ACCESS_LIST,
          TransactionType.EIP1559,
          TransactionType.BLOB,
          TransactionType.DELEGATE_CODE
        }) {
      assertThat(PqIntrinsicGas.surcharge(transactionOfType(type))).isZero();
    }
    assertThat(PqIntrinsicGas.surcharge(transactionOfType(TransactionType.FALCON1024)))
        .isEqualTo(PqIntrinsicGas.FALCON1024_SURCHARGE);
    assertThat(PqIntrinsicGas.surcharge(transactionOfType(TransactionType.MLDSA65)))
        .isEqualTo(PqIntrinsicGas.MLDSA65_SURCHARGE);
  }

  @Test
  void frontierCalculatorAddsSurchargeToPlainTransfer() {
    final GasCalculator frontier = new FrontierGasCalculator();
    assertThat(
            frontier.transactionIntrinsicGasCost(transactionOfType(TransactionType.FRONTIER), 0L))
        .isEqualTo(21_000L);
    assertThat(
            frontier.transactionIntrinsicGasCost(
                transactionOfType(TransactionType.FALCON1024), 0L))
        .isEqualTo(21_000L + PqIntrinsicGas.FALCON1024_SURCHARGE);
    assertThat(
            frontier.transactionIntrinsicGasCost(transactionOfType(TransactionType.MLDSA65), 0L))
        .isEqualTo(21_000L + PqIntrinsicGas.MLDSA65_SURCHARGE);
  }

  @Test
  void berlinThroughOsakaCalculatorsInheritTheSurcharge() {
    for (final GasCalculator calculator :
        new GasCalculator[] {
          new BerlinGasCalculator(),
          new LondonGasCalculator(),
          new ShanghaiGasCalculator(),
          new CancunGasCalculator(),
          new PragueGasCalculator(),
          new OsakaGasCalculator()
        }) {
      final long ecdsaCost =
          calculator.transactionIntrinsicGasCost(transactionOfType(TransactionType.FRONTIER), 0L);
      final long falconCost =
          calculator.transactionIntrinsicGasCost(
              transactionOfType(TransactionType.FALCON1024), 0L);
      final long mlDsaCost =
          calculator.transactionIntrinsicGasCost(transactionOfType(TransactionType.MLDSA65), 0L);
      assertThat(falconCost - ecdsaCost).isEqualTo(PqIntrinsicGas.FALCON1024_SURCHARGE);
      assertThat(mlDsaCost - ecdsaCost).isEqualTo(PqIntrinsicGas.MLDSA65_SURCHARGE);
    }
  }

  @Test
  void amsterdamCalculatorAddsTheSameSurcharge() {
    final GasCalculator amsterdam = new AmsterdamGasCalculator();
    final long ecdsaCost =
        amsterdam.transactionIntrinsicGasCost(transactionOfType(TransactionType.FRONTIER), 0L);
    final long falconCost =
        amsterdam.transactionIntrinsicGasCost(transactionOfType(TransactionType.FALCON1024), 0L);
    final long mlDsaCost =
        amsterdam.transactionIntrinsicGasCost(transactionOfType(TransactionType.MLDSA65), 0L);
    assertThat(falconCost - ecdsaCost).isEqualTo(PqIntrinsicGas.FALCON1024_SURCHARGE);
    assertThat(mlDsaCost - ecdsaCost).isEqualTo(PqIntrinsicGas.MLDSA65_SURCHARGE);
  }
}
