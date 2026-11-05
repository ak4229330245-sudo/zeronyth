/*
 * Copyright contributors to Besu.
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
package org.hyperledger.besu.crypto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Strict Falcon-1024 finality-seal quorum verification for a distinct experimental QBFT network.
 *
 * <p>This verifies validator signatures on an independently calculated committed-seal hash. It does
 * not replace the consensus rules, block-header codec or the actual Besu commit validator. Do not
 * feed it a hash supplied by an untrusted wire message without recomputing that hash.
 */
public final class Falcon1024CommitQuorum {
  private Falcon1024CommitQuorum() {}

  /** Minimum distinct validators required to finalize a QBFT block. */
  public static int requiredSeals(final int validatorCount) {
    if (validatorCount <= 0) {
      throw new IllegalArgumentException("QBFT validator set cannot be empty");
    }
    return (int) ((2L * validatorCount) / 3L + 1L);
  }

  /**
   * Fail-closed quorum verification. Every supplied seal must be authentic, authorized, unique, and
   * scoped to exactly the expected chain, block and round. Duplicate/foreign seals cannot
   * contribute to a quorum, even when they are presented alongside valid seals.
   */
  public static boolean verify(
      final Collection<byte[]> seals,
      final Collection<byte[]> authorizedValidatorKeys,
      final long expectedChainId,
      final long expectedBlockHeight,
      final int expectedRound,
      final byte[] independentlyComputedCommittedSealHash) {
    Objects.requireNonNull(seals, "seals");
    Objects.requireNonNull(authorizedValidatorKeys, "authorizedValidatorKeys");
    Objects.requireNonNull(independentlyComputedCommittedSealHash, "committedSealHash");
    if (independentlyComputedCommittedSealHash.length != 32
        || expectedChainId <= 0
        || expectedBlockHeight < 0
        || expectedRound < 0) {
      throw new IllegalArgumentException("Invalid expected finality context");
    }

    // Reject duplicate validator keys, including bytewise equal keys in distinct arrays.
    final Set<ByteBuffer> seenKeys = new HashSet<>();
    final Set<ByteBuffer> seenAddresses = new HashSet<>();
    final List<byte[]> allowlist = new ArrayList<>();
    for (final byte[] key : authorizedValidatorKeys) {
      if (key == null
          || key.length != 1792
          || !seenKeys.add(ByteBuffer.wrap(key))
          || !seenAddresses.add(
              ByteBuffer.wrap(Falcon1024ConsensusEnvelope.validatorAddress(key)))) {
        throw new IllegalArgumentException("Invalid or duplicate Falcon validator identity");
      }
      allowlist.add(key.clone());
    }
    final int required = requiredSeals(allowlist.size());
    if (seals.size() < required || seals.size() > allowlist.size()) {
      return false;
    }

    final Set<ByteBuffer> verifiedAuthors = new HashSet<>();
    for (final byte[] seal : seals) {
      try {
        final Falcon1024ConsensusEnvelope.VerifiedMessage verified =
            Falcon1024ConsensusEnvelope.decodeAndVerify(
                seal,
                expectedChainId,
                Falcon1024ConsensusCrypto.COMMIT_SEAL,
                independentlyComputedCommittedSealHash,
                allowlist);
        if (verified.blockHeight() != expectedBlockHeight
            || verified.round() != expectedRound
            || !verifiedAuthors.add(ByteBuffer.wrap(verified.authorAddress()))) {
          return false;
        }
      } catch (final IllegalArgumentException invalidSeal) {
        return false;
      }
    }
    return verifiedAuthors.size() >= required;
  }
}
