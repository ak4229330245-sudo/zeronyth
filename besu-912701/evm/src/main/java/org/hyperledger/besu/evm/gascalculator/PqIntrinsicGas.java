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

/**
 * Intrinsic gas surcharge for the ZERONYTH post-quantum native transaction types (Falcon-1024,
 * type 0x7E, and ML-DSA-65, type 0x7F).
 *
 * <p>A PQ transaction carries its full public key and signature inside the transaction body —
 * several kilobytes that every node must receive, store in the block, and cryptographically
 * verify before execution. The surcharge has two components, charged on the scheme's canonical
 * envelope sizes:
 *
 * <ul>
 *   <li><b>Byte component</b> — (public key + signature) bytes priced at the EIP-2028
 *       non-zero calldata byte rate of 16 gas/byte. PQ key/signature material is high-entropy
 *       (effectively never zero bytes), so the non-zero rate applies to the whole envelope.
 *       Falcon-1024: 1793-byte encoded public key + a 1462-byte signature envelope bound =
 *       3255 bytes → 52,080 gas (the Falcon-1024 maximum compressed signature is 1280 bytes —
 *       confirmed empirically against BouncyCastle 1.84, max 1280 over 400 signatures — so the
 *       envelope bound retains margin). ML-DSA-65: 1952-byte public key + 3309-byte signature
 *       = 5261 bytes → 84,176 gas.
 *   <li><b>Verification component</b> — one signature verification, priced against the
 *       ecrecover yardstick (3000 gas for a native secp256k1 recovery, ~70 µs class). Measured
 *       BouncyCastle 1.84 verification times on the reference build VM (JDK 25): Falcon-1024 ≈
 *       0.71 ms, ML-DSA-65 ≈ 0.98 ms — roughly 10× and 14× the native ecrecover cost — giving
 *       30,000 gas for Falcon-1024 and 42,000 gas for ML-DSA-65.
 * </ul>
 *
 * <p>Total surcharge: Falcon-1024 82,080 gas; ML-DSA-65 126,176 gas (a plain PQ transfer
 * therefore costs 103,080 / 147,176 gas intrinsic in total). ECDSA and all other transaction
 * types are charged exactly as before — this method returns 0 for them.
 */
public final class PqIntrinsicGas {

  /** Gas per byte of PQ public-key/signature envelope (EIP-2028 non-zero byte rate). */
  public static final long GAS_PER_ENVELOPE_BYTE = 16L;

  /** Canonical Falcon-1024 envelope: 1793-byte public key + 1462-byte signature bound. */
  public static final long FALCON1024_ENVELOPE_BYTES = 1793L + 1462L;

  /** Canonical ML-DSA-65 envelope: 1952-byte public key + 3309-byte signature (FIPS 204). */
  public static final long MLDSA65_ENVELOPE_BYTES = 1952L + 3309L;

  /** Falcon-1024 signature verification component. */
  public static final long FALCON1024_VERIFICATION_GAS = 30_000L;

  /** ML-DSA-65 signature verification component. */
  public static final long MLDSA65_VERIFICATION_GAS = 42_000L;

  /** Total intrinsic surcharge for a Falcon-1024 transaction. */
  public static final long FALCON1024_SURCHARGE =
      FALCON1024_ENVELOPE_BYTES * GAS_PER_ENVELOPE_BYTE + FALCON1024_VERIFICATION_GAS;

  /** Total intrinsic surcharge for an ML-DSA-65 transaction. */
  public static final long MLDSA65_SURCHARGE =
      MLDSA65_ENVELOPE_BYTES * GAS_PER_ENVELOPE_BYTE + MLDSA65_VERIFICATION_GAS;

  private PqIntrinsicGas() {
    // utility class
  }

  /**
   * The PQ intrinsic surcharge for the given transaction: the scheme constant for PQ types, 0
   * for every other type.
   */
  public static long surcharge(final Transaction transaction) {
    final TransactionType type = transaction.getType();
    if (type == TransactionType.FALCON1024) {
      return FALCON1024_SURCHARGE;
    }
    if (type == TransactionType.MLDSA65) {
      return MLDSA65_SURCHARGE;
    }
    return 0L;
  }
}
