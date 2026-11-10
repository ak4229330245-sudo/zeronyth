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

import org.hyperledger.besu.evm.frame.MessageFrame;
import org.hyperledger.besu.evm.precompile.PrecompiledContract;

import java.math.BigInteger;

import jakarta.validation.constraints.NotNull;
import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;

public class StarkVerifyPrecompiledContract implements PrecompiledContract {
  public static final long BASE_GAS = 1500000L;
  public static final long PER_BYTE_GAS = 64L;
  public static final int MAX_INPUT_SIZE = 65568;
  private static final Bytes OUTPUT_VALID = Bytes32.leftPad(Bytes.of(1));
  private static final Bytes OUTPUT_INVALID = Bytes32.ZERO;

  @Override
  public String getName() {
    return "STARKVERIFY";
  }

  @Override
  public long gasRequirement(Bytes input) {
    return 1500000L + 64L * input.size();
  }

  @NotNull
  @Override
  public PrecompiledContract.PrecompileContractResult computePrecompile(
      final Bytes input, @NotNull final MessageFrame messageFrame) {
    if (!ZkStarkGate.isPrecompileActiveAt(messageFrame.getBlockValues().getNumber())) {
      return PrecompiledContract.PrecompileContractResult.success(OUTPUT_INVALID);
    }
    // input = proof || root0 (16 bytes LE) || root1 (16 bytes LE)
    if (input.size() < 33 || input.size() > MAX_INPUT_SIZE) {
      return PrecompiledContract.PrecompileContractResult.success(OUTPUT_INVALID);
    }
    final byte[] raw = input.toArrayUnsafe();
    final int proofLength = raw.length - 32;
    final byte[] proof = new byte[proofLength];
    System.arraycopy(raw, 0, proof, 0, proofLength);
    final BigInteger root0 = F128.fromLeBytesOrNull(raw, proofLength);
    final BigInteger root1 = F128.fromLeBytesOrNull(raw, proofLength + 16);
    if (root0 == null || root1 == null) {
      return PrecompiledContract.PrecompileContractResult.success(OUTPUT_INVALID);
    }
    try {
      WinterfellVerifier.verify(proof, root0, root1);
      return PrecompiledContract.PrecompileContractResult.success(OUTPUT_VALID);
    } catch (WinterfellVerifier.VerificationException e) {
      return PrecompiledContract.PrecompileContractResult.success(OUTPUT_INVALID);
    }
  }
}
