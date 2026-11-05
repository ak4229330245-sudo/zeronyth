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
import java.util.Arrays;
import java.util.List;

import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;

/**
 * Independent smoke test for the Falcon primitive (no Gradle/JUnit required). Only the real Besu
 * protocol integration can establish end-to-end QBFT support.
 */
public final class Falcon1024ConsensusCryptoSelfTest {
  private Falcon1024ConsensusCryptoSelfTest() {}

  public static void main(final String[] args) {
    final SecureRandom random =
        org.hyperledger.besu.crypto.SecureRandomProvider.createSecureRandom();
    final AsymmetricCipherKeyPair validator = Falcon1024ConsensusCrypto.generateKeyPair(random);
    final FalconPrivateKeyParameters secret = (FalconPrivateKeyParameters) validator.getPrivate();
    final FalconPublicKeyParameters pub = (FalconPublicKeyParameters) validator.getPublic();
    System.out.println("Falcon-1024 raw public-key bytes: " + pub.getH().length);
    final FalconPublicKeyParameters outsider =
        (FalconPublicKeyParameters) Falcon1024ConsensusCrypto.generateKeyPair(random).getPublic();
    final byte[] hash = new byte[32];
    random.nextBytes(hash);

    for (int t = Falcon1024ConsensusCrypto.PROPOSAL;
        t <= Falcon1024ConsensusCrypto.COMMIT_SEAL;
        t++) {
      final int type = t;
      final byte[] canonical = Falcon1024ConsensusCrypto.signingBytes(9127, type, 313297, 0, hash);
      final byte[] signature = Falcon1024ConsensusCrypto.sign(secret, random, canonical);
      if (type == Falcon1024ConsensusCrypto.PROPOSAL) {
        System.out.println("Falcon-1024 example signature bytes: " + signature.length);
      }
      check(Falcon1024ConsensusCrypto.verify(pub, canonical, signature), "authentic signature");
      check(!Falcon1024ConsensusCrypto.verify(outsider, canonical, signature), "outsider key");
      final byte[] corrupt = Arrays.copyOf(signature, signature.length);
      corrupt[corrupt.length - 1] ^= 1;
      check(!Falcon1024ConsensusCrypto.verify(pub, canonical, corrupt), "tampered signature");
      final byte[] wrongChain = Falcon1024ConsensusCrypto.signingBytes(9128, type, 313297, 0, hash);
      check(!Falcon1024ConsensusCrypto.verify(pub, wrongChain, signature), "cross-chain replay");
      final byte[] wrongHeight =
          Falcon1024ConsensusCrypto.signingBytes(9127, type, 313298, 0, hash);
      check(!Falcon1024ConsensusCrypto.verify(pub, wrongHeight, signature), "height replay");
      final byte[] wrongRound = Falcon1024ConsensusCrypto.signingBytes(9127, type, 313297, 1, hash);
      check(!Falcon1024ConsensusCrypto.verify(pub, wrongRound, signature), "round replay");
      final int another = type == 5 ? 1 : type + 1;
      final byte[] wrongType =
          Falcon1024ConsensusCrypto.signingBytes(9127, another, 313297, 0, hash);
      check(!Falcon1024ConsensusCrypto.verify(pub, wrongType, signature), "message-type replay");
      final byte[] envelope =
          Falcon1024ConsensusEnvelope.signAndEncode(
              secret, pub, random, 9127, type, 313297, 0, hash);
      final Falcon1024ConsensusEnvelope.VerifiedMessage decoded =
          Falcon1024ConsensusEnvelope.decodeAndVerify(
              envelope, 9127, type, hash, List.of(pub.getH()));
      check(decoded.messageType() == type, "wire message type");
      check(decoded.blockHeight() == 313297, "wire block height");
      check(decoded.authorAddress().length == 20, "wire validator address");
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  envelope, 9128, type, hash, List.of(pub.getH())),
          "wire cross-chain replay");
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  envelope, 9127, another, hash, List.of(pub.getH())),
          "wire cross-message replay");
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  envelope, 9127, type, hash, List.of(outsider.getH())),
          "unauthorized signer");
      final byte[] modifiedWire = envelope.clone();
      modifiedWire[modifiedWire.length - 1] ^= 1;
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  modifiedWire, 9127, type, hash, List.of(pub.getH())),
          "wire signature forgery");
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  Arrays.copyOf(envelope, envelope.length - 1),
                  9127,
                  type,
                  hash,
                  List.of(pub.getH())),
          "truncated wire");
      reject(
          () ->
              Falcon1024ConsensusEnvelope.decodeAndVerify(
                  Arrays.copyOf(envelope, envelope.length + 1),
                  9127,
                  type,
                  hash,
                  List.of(pub.getH())),
          "trailing byte");
      System.out.println("PASS: Falcon-1024 consensus type " + type);
    }
  }

  private static void check(final boolean good, final String name) {
    if (!good) {
      throw new AssertionError("FAILED: " + name);
    }
  }

  private static void reject(final Runnable verification, final String name) {
    try {
      verification.run();
    } catch (final IllegalArgumentException expected) {
      return;
    }
    throw new AssertionError("FAILED: accepted " + name);
  }
}
