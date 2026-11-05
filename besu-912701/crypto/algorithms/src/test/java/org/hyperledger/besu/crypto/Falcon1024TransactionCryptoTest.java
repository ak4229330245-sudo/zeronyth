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

import java.security.SecureRandom;

import org.apache.tuweni.bytes.Bytes;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;
import org.junit.jupiter.api.Test;

class Falcon1024TransactionCryptoTest {

  @Test
  void keyGenSignVerifyAddress() {
    final SecureRandom random = SecureRandomProvider.publicSecureRandom();
    final AsymmetricCipherKeyPair kp = Falcon1024TransactionCrypto.generateKeyPair(random);
    final FalconPublicKeyParameters pubParams = (FalconPublicKeyParameters) kp.getPublic();
    final FalconPrivateKeyParameters privParams = (FalconPrivateKeyParameters) kp.getPrivate();

    // Pins the BC 1.84 behaviour this class documents: the canonical transaction public key is
    // the encoded form (1-byte Falcon header + 1792-byte h polynomial).
    final byte[] pub = Falcon1024TransactionCrypto.getPublicKeyBytes(kp);
    assertThat(pub).hasSize(Falcon1024TransactionCrypto.PUBLIC_KEY_LENGTH);
    assertThat(pubParams.getH()).hasSize(Falcon1024TransactionCrypto.RAW_PUBLIC_KEY_LENGTH);
    assertThat(Falcon1024TransactionCrypto.publicKeyFromBytes(pub).getH())
        .isEqualTo(pubParams.getH());

    final Bytes message = Bytes.fromHexString("0x01020304");
    final byte[] sig =
        Falcon1024TransactionCrypto.sign(message.toArrayUnsafe(), privParams, random);

    assertThat(Falcon1024TransactionCrypto.verify(message.toArrayUnsafe(), sig, pubParams))
        .isTrue();
    // verification also works through the reconstructed-from-wire public key
    assertThat(
            Falcon1024TransactionCrypto.verify(
                message.toArrayUnsafe(),
                sig,
                Falcon1024TransactionCrypto.publicKeyFromBytes(pub)))
        .isTrue();

    // tamper with the message and with the signature
    assertThat(
            Falcon1024TransactionCrypto.verify(
                Bytes.fromHexString("0x01020305").toArrayUnsafe(), sig, pubParams))
        .isFalse();
    final byte[] bad = sig.clone();
    bad[bad.length - 1] ^= 1;
    assertThat(Falcon1024TransactionCrypto.verify(message.toArrayUnsafe(), bad, pubParams))
        .isFalse();

    final Bytes address = Falcon1024TransactionCrypto.addressFromPublicKey(pub);
    assertThat(address.size()).isEqualTo(20);
  }
}
