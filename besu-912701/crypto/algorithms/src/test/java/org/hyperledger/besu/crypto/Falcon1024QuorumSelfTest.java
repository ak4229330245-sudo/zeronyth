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

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;

/** Simulated 3-of-4 Falcon-1024 signer/quorum smoke test, NOT a running Besu QBFT network. */
public final class Falcon1024QuorumSelfTest {
  private Falcon1024QuorumSelfTest() {}

  public static void main(final String[] args) {
    final SecureRandom random =
        org.hyperledger.besu.crypto.SecureRandomProvider.createSecureRandom();
    final List<AsymmetricCipherKeyPair> validators = new ArrayList<>();
    final List<byte[]> allowlist = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      final AsymmetricCipherKeyPair keyPair = Falcon1024ConsensusCrypto.generateKeyPair(random);
      validators.add(keyPair);
      allowlist.add(((FalconPublicKeyParameters) keyPair.getPublic()).getH());
    }
    final byte[] canonicalCommitHash = new byte[32];
    random.nextBytes(canonicalCommitHash);

    // Simulate one validator being down: the other three sign a unique commit seal.
    final List<byte[]> seals = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      final AsymmetricCipherKeyPair kp = validators.get(i);
      seals.add(
          Falcon1024ConsensusEnvelope.signAndEncode(
              (FalconPrivateKeyParameters) kp.getPrivate(),
              (FalconPublicKeyParameters) kp.getPublic(),
              random,
              9127,
              Falcon1024ConsensusCrypto.COMMIT_SEAL,
              313298,
              0,
              canonicalCommitHash));
    }
    require(quorum(seals, allowlist, canonicalCommitHash), "3-of-4 simulated quorum");
    System.out.println("PASS: simulated Falcon-only 3-of-4 quorum (1 validator offline)");

    // Two offline: honest 2-of-4 must not finalize.
    require(!quorum(seals.subList(0, 2), allowlist, canonicalCommitHash), "2-of-4 rejected");
    System.out.println("PASS: simulated 2-of-4 rejected");

    // Duplicates never count toward a quorum, regardless of signature bytes.
    final List<byte[]> duplicates = List.of(seals.get(0), seals.get(0), seals.get(1));
    require(!quorum(duplicates, allowlist, canonicalCommitHash), "duplicate seals rejected");
    System.out.println("PASS: duplicate validator seal cannot increase quorum");

    // A nonmember's valid cryptographic signature must not count.
    final AsymmetricCipherKeyPair outsider = Falcon1024ConsensusCrypto.generateKeyPair(random);
    final byte[] outsiderSeal =
        Falcon1024ConsensusEnvelope.signAndEncode(
            (FalconPrivateKeyParameters) outsider.getPrivate(),
            (FalconPublicKeyParameters) outsider.getPublic(),
            random,
            9127,
            Falcon1024ConsensusCrypto.COMMIT_SEAL,
            313298,
            0,
            canonicalCommitHash);
    require(
        !quorum(List.of(seals.get(0), seals.get(1), outsiderSeal), allowlist, canonicalCommitHash),
        "outsider rejected");
    System.out.println("PASS: nonmember signature rejected");

    require(
        !Falcon1024CommitQuorum.verify(seals, allowlist, 9127, 313299, 0, canonicalCommitHash),
        "old-block replay rejected");
    require(
        !Falcon1024CommitQuorum.verify(seals, allowlist, 9127, 313298, 1, canonicalCommitHash),
        "old-round replay rejected");
    require(
        !Falcon1024CommitQuorum.verify(seals, allowlist, 9128, 313298, 0, canonicalCommitHash),
        "cross-chain replay rejected");
    System.out.println("PASS: committed seals rejected on another height, round or chain");

    try {
      Falcon1024CommitQuorum.verify(
          seals,
          List.of(allowlist.get(0), allowlist.get(0), allowlist.get(1), allowlist.get(2)),
          9127,
          313298,
          0,
          canonicalCommitHash);
      throw new AssertionError("duplicate genesis validator keys accepted");
    } catch (final IllegalArgumentException expected) {
      System.out.println("PASS: duplicate validator public keys rejected at registry boundary");
    }
  }

  private static boolean quorum(
      final List<byte[]> seals, final List<byte[]> authorizedKeys, final byte[] commitHash) {
    return Falcon1024CommitQuorum.verify(seals, authorizedKeys, 9127, 313298, 0, commitHash);
  }

  private static void require(final boolean condition, final String message) {
    if (!condition) {
      throw new AssertionError("FAILED: " + message);
    }
  }
}
