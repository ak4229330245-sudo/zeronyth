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

import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.HexFormat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class Falcon1024KeyFileTest {
  private static final byte[] PW = "correct horse battery staple".getBytes(StandardCharsets.UTF_8);
  @TempDir Path dir;

  private static String secretHex(final Falcon1024KeyFile.KeyPair kp) {
    return HexFormat.of().formatHex(kp.secret().getSpolyF());
  }

  @Test
  void encryptedRoundTripKeepsKeyAndHidesSecret() throws Exception {
    final Path plain = dir.resolve("plain.key");
    final Falcon1024KeyFile.KeyPair kp = Falcon1024KeyFile.generate(plain);
    final Path enc = dir.resolve("enc.key");
    Falcon1024KeyFile.writeEncrypted(enc, kp, PW, 14);

    assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(enc)))
        .isEqualTo("rw-------");
    final String body = Files.readString(enc);
    assertThat(body).contains("format=falcon1024-enc-v1").contains("bc-falcon=round3-bcprov");
    // no secret polynomial (or a long fragment of it) in the encrypted file
    final String sk = secretHex(kp);
    assertThat(body).doesNotContain(sk.substring(0, 64)).doesNotContain(sk.substring(200, 264));
    assertThat(kp.toString()).doesNotContain(sk.substring(0, 16)).startsWith("Falcon1024KeyPair");

    final Falcon1024KeyFile.KeyPair back = Falcon1024KeyFile.load(enc, PW);
    assertThat(back.pub().getH()).isEqualTo(kp.pub().getH());
    assertThat(secretHex(back)).isEqualTo(sk);
    final Falcon1024KeyFile.Info info = Falcon1024KeyFile.info(enc);
    assertThat(info.encrypted()).isTrue();
    assertThat(info.address()).isEqualTo("0x" + HexFormat.of().formatHex(kp.address()));
  }

  @Test
  void defaultCostGenerateEncryptedLoads() throws Exception {
    final Path enc = dir.resolve("gen.key");
    final Falcon1024KeyFile.KeyPair kp = Falcon1024KeyFile.generateEncrypted(enc, PW);
    assertThat(Files.readString(enc)).contains("logN=17");
    assertThat(Falcon1024KeyFile.load(enc, PW).address()).isEqualTo(kp.address());
  }

  @Test
  void wrongPasswordIsRejectedWithoutLeakingIt() throws Exception {
    final Path enc = dir.resolve("enc.key");
    Falcon1024KeyFile.writeEncrypted(enc, Falcon1024KeyFile.generate(dir.resolve("p")), PW, 14);
    assertThatThrownBy(
            () -> Falcon1024KeyFile.load(enc, "wrong password!!".getBytes(StandardCharsets.UTF_8)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("wrong password or tampered")
        .hasMessageNotContaining("wrong password!!");
  }

  @Test
  void tamperedHeaderOrCiphertextIsRejected() throws Exception {
    final Path enc = dir.resolve("enc.key");
    final Falcon1024KeyFile.KeyPair other = Falcon1024KeyFile.generate(dir.resolve("o"));
    Falcon1024KeyFile.writeEncrypted(enc, Falcon1024KeyFile.generate(dir.resolve("p")), PW, 14);
    final String body = Files.readString(enc);
    // swap the public key (AAD) for another valid key -> GCM must fail
    final String pubLine = body.lines().filter(l -> l.startsWith("pub=")).findFirst().orElseThrow();
    final String swapped =
        body.replace(pubLine, "pub=" + HexFormat.of().formatHex(other.pub().getH()));
    final Path t1 = dir.resolve("t1.key");
    Files.writeString(t1, swapped);
    Files.setPosixFilePermissions(t1, PosixFilePermissions.fromString("rw-------"));
    assertThatThrownBy(() -> Falcon1024KeyFile.load(t1, PW))
        .isInstanceOf(IllegalArgumentException.class);
    // flip one ciphertext nibble
    final String ctLine = body.lines().filter(l -> l.startsWith("ct=")).findFirst().orElseThrow();
    final char c = ctLine.charAt(40);
    final String flipped =
        body.replace(
            ctLine, ctLine.substring(0, 40) + (c == '0' ? '1' : '0') + ctLine.substring(41));
    final Path t2 = dir.resolve("t2.key");
    Files.writeString(t2, flipped);
    Files.setPosixFilePermissions(t2, PosixFilePermissions.fromString("rw-------"));
    assertThatThrownBy(() -> Falcon1024KeyFile.load(t2, PW))
        .isInstanceOf(IllegalArgumentException.class);
    // downgrade of KDF cost is detected (AAD) or refused (range)
    final Path t3 = dir.resolve("t3.key");
    Files.writeString(t3, body.replace("logN=14", "logN=15"));
    Files.setPosixFilePermissions(t3, PosixFilePermissions.fromString("rw-------"));
    assertThatThrownBy(() -> Falcon1024KeyFile.load(t3, PW))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void weakPasswordOverwriteAndLoosePermissionsAreRefused() throws Exception {
    final Path p = dir.resolve("p.key");
    final Falcon1024KeyFile.KeyPair kp = Falcon1024KeyFile.generate(p);
    assertThatThrownBy(
            () ->
                Falcon1024KeyFile.writeEncrypted(
                    dir.resolve("x"), kp, "short".getBytes(StandardCharsets.UTF_8), 14))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Falcon1024KeyFile.writeEncrypted(p, kp, PW, 14))
        .isInstanceOf(FileAlreadyExistsException.class);
    assertThatThrownBy(() -> Falcon1024KeyFile.generate(p))
        .isInstanceOf(FileAlreadyExistsException.class);
    Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-r--r--"));
    assertThatThrownBy(() -> Falcon1024KeyFile.load(p))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("chmod 600");
  }

  @Test
  void backupCopyRestoresSameValidatorIdentity() throws Exception {
    final Path enc = dir.resolve("enc.key");
    final Falcon1024KeyFile.KeyPair kp = Falcon1024KeyFile.generate(dir.resolve("p"));
    Falcon1024KeyFile.writeEncrypted(enc, kp, PW, 14);
    final Path backup = dir.resolve("backup.key");
    Files.copy(enc, backup);
    Files.delete(enc);
    final Falcon1024KeyFile.KeyPair restored = Falcon1024KeyFile.load(backup, PW);
    assertThat(restored.address()).isEqualTo(kp.address());
    final byte[] msg =
        Falcon1024ConsensusCrypto.signingBytes(
            912701, Falcon1024ConsensusCrypto.COMMIT_SEAL, 5, 0, new byte[32]);
    final byte[] sig =
        Falcon1024ConsensusCrypto.sign(
            restored.secret(), SecureRandomProvider.createSecureRandom(), msg);
    assertThat(Falcon1024ConsensusCrypto.verify(kp.pub(), msg, sig)).isTrue();
  }
}
