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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.SecureRandom;
import java.util.Arrays;

import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;
import org.junit.jupiter.api.Test;

class Falcon1024ConsensusCryptoTest {

  @Test
  void authenticFalcon1024RoundTripAndReplaySeparation() {
    final SecureRandom random =
        org.hyperledger.besu.crypto.SecureRandomProvider.createSecureRandom();
    final AsymmetricCipherKeyPair validator = Falcon1024ConsensusCrypto.generateKeyPair(random);
    final FalconPrivateKeyParameters secret = (FalconPrivateKeyParameters) validator.getPrivate();
    final FalconPublicKeyParameters publicKey = (FalconPublicKeyParameters) validator.getPublic();
    final byte[] payloadHash = new byte[32];
    random.nextBytes(payloadHash);

    for (int messageType = Falcon1024ConsensusCrypto.PROPOSAL;
        messageType <= Falcon1024ConsensusCrypto.COMMIT_SEAL;
        messageType++) {
      final byte[] signingBytes =
          Falcon1024ConsensusCrypto.signingBytes(9127, messageType, 123, 2, payloadHash);
      final byte[] signature = Falcon1024ConsensusCrypto.sign(secret, random, signingBytes);
      assertThat(Falcon1024ConsensusCrypto.verify(publicKey, signingBytes, signature)).isTrue();

      final byte[] altered = Arrays.copyOf(signingBytes, signingBytes.length);
      altered[altered.length - 1] ^= 1;
      assertThat(Falcon1024ConsensusCrypto.verify(publicKey, altered, signature)).isFalse();
      assertThat(
              Falcon1024ConsensusCrypto.verify(
                  publicKey,
                  Falcon1024ConsensusCrypto.signingBytes(9128, messageType, 123, 2, payloadHash),
                  signature))
          .isFalse();
      assertThat(
              Falcon1024ConsensusCrypto.verify(
                  publicKey,
                  Falcon1024ConsensusCrypto.signingBytes(9127, messageType, 124, 2, payloadHash),
                  signature))
          .isFalse();
      assertThat(
              Falcon1024ConsensusCrypto.verify(
                  publicKey,
                  Falcon1024ConsensusCrypto.signingBytes(9127, messageType, 123, 3, payloadHash),
                  signature))
          .isFalse();
      final int differentType =
          messageType == Falcon1024ConsensusCrypto.COMMIT_SEAL
              ? Falcon1024ConsensusCrypto.COMMIT
              : messageType + 1;
      assertThat(
              Falcon1024ConsensusCrypto.verify(
                  publicKey,
                  Falcon1024ConsensusCrypto.signingBytes(9127, differentType, 123, 2, payloadHash),
                  signature))
          .isFalse();
    }
  }

  @Test
  void rejectsMalformedSigningDomain() {
    assertThatThrownBy(() -> Falcon1024ConsensusCrypto.signingBytes(0, 1, 1, 0, new byte[32]))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Falcon1024ConsensusCrypto.signingBytes(9127, 7, 1, 0, new byte[32]))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Falcon1024ConsensusCrypto.signingBytes(9127, 1, 1, 0, new byte[31]))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void pqBindingEnvelopeIsNeverAcceptedAsConsensusSeal() {
    final java.security.SecureRandom rnd = SecureRandomProvider.createSecureRandom();
    final org.bouncycastle.crypto.AsymmetricCipherKeyPair kp =
        Falcon1024ConsensusCrypto.generateKeyPair(rnd);
    final org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters pub =
        (org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters) kp.getPublic();
    final byte[] hash = new byte[32];
    hash[0] = 7;
    final byte[] env =
        Falcon1024ConsensusEnvelope.signAndEncode(
            (org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters) kp.getPrivate(),
            pub,
            rnd,
            912701,
            Falcon1024ConsensusCrypto.PQ_BINDING,
            0,
            0,
            hash);
    final java.util.List<byte[]> allowed = java.util.List.of(pub.getH());
    org.assertj.core.api.Assertions.assertThat(
            Falcon1024ConsensusEnvelope.decodeAndVerify(
                    env, 912701, Falcon1024ConsensusCrypto.PQ_BINDING, hash, allowed)
                .round())
        .isZero();
    for (int t = Falcon1024ConsensusCrypto.PROPOSAL;
        t <= Falcon1024ConsensusCrypto.COMMIT_SEAL;
        t++) {
      final int type = t;
      assertThatThrownBy(
              () -> Falcon1024ConsensusEnvelope.decodeAndVerify(env, 912701, type, hash, allowed))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }
}
