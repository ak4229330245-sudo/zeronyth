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

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.generators.SCrypt;
import org.bouncycastle.pqc.crypto.falcon.FalconParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;

/**
 * ZERONYTH Falcon-1024 consensus key file. EXPERIMENTAL; Falcon here is the BouncyCastle 1.84
 * implementation of NIST round-3 Falcon, NOT final FIPS 206 FN-DSA.
 *
 * <p>Two on-disk formats (both written with owner-only permissions 0600, never overwritten):
 *
 * <ul>
 *   <li>{@code falcon1024-v1}: legacy plain-text hex secret (f, g, F). Loading it can be refused
 *       with {@code BESU_FALCON1024_REQUIRE_ENCRYPTED=true}.
 *   <li>{@code falcon1024-enc-v1}: secret encrypted with AES-256-GCM under a key derived by scrypt
 *       (N=2^17, r=8, p=1) from a password. All header fields (format, KDF parameters, salt, nonce,
 *       address, public key) are authenticated as GCM associated data.
 * </ul>
 *
 * <p>Password source (first match): {@code BESU_FALCON1024_KEY_PASSWORD_FILE} (recommended, a file
 * readable only by the node user), then {@code BESU_FALCON1024_KEY_PASSWORD}. Secrets are never
 * printed; the CLI prints only format, address and public key.
 */
public final class Falcon1024KeyFile {
  /** Plain-text legacy format id. */
  public static final String FORMAT = "falcon1024-v1";

  /** Encrypted format id. */
  public static final String ENC_FORMAT = "falcon1024-enc-v1";

  /** Env var naming a password file. */
  public static final String ENV_PASSWORD_FILE = "BESU_FALCON1024_KEY_PASSWORD_FILE";

  /** Env var holding the password (discouraged; use the file). */
  public static final String ENV_PASSWORD = "BESU_FALCON1024_KEY_PASSWORD";

  /** Env var that, when "true", refuses plain-text key files. */
  public static final String ENV_REQUIRE_ENCRYPTED = "BESU_FALCON1024_REQUIRE_ENCRYPTED";

  static final int DEFAULT_SCRYPT_LOG_N = 17;
  static final int MIN_SCRYPT_LOG_N = 14;
  private static final int SCRYPT_R = 8;
  private static final int SCRYPT_P = 1;
  private static final int MIN_PASSWORD_BYTES = 12;
  private static final int GCM_TAG_BITS = 128;
  private static final FalconParameters PARAMS = FalconParameters.falcon_1024;

  private Falcon1024KeyFile() {}

  /**
   * Loaded key pair. {@link #toString()} never includes secret material.
   *
   * @param secret Falcon private key
   * @param pub Falcon public key
   */
  public record KeyPair(FalconPrivateKeyParameters secret, FalconPublicKeyParameters pub) {
    /**
     * Validator address = keccak256(pub)[12..32].
     *
     * @return 20-byte address
     */
    public byte[] address() {
      return Falcon1024ConsensusEnvelope.validatorAddress(pub.getH());
    }

    @Override
    public String toString() {
      return "Falcon1024KeyPair[address=0x" + HexFormat.of().formatHex(address()) + "]";
    }
  }

  /** Public, non-secret description of a key file. */
  public record Info(String format, boolean encrypted, String address, String publicKeyHex) {}

  // ---------------------------------------------------------------- generation

  private static KeyPair newKeyPair() {
    final AsymmetricCipherKeyPair kp =
        Falcon1024ConsensusCrypto.generateKeyPair(SecureRandomProvider.createSecureRandom());
    return new KeyPair(
        (FalconPrivateKeyParameters) kp.getPrivate(), (FalconPublicKeyParameters) kp.getPublic());
  }

  /**
   * Generates a key pair and writes it in the legacy PLAIN-TEXT format (0600); refuses to
   * overwrite. Prefer {@link #generateEncrypted(Path, byte[])}.
   *
   * @param path target file
   * @return the key pair
   * @throws IOException on IO failure or if the file exists
   */
  public static KeyPair generate(final Path path) throws IOException {
    final KeyPair pair = newKeyPair();
    writePlain(path, pair);
    return pair;
  }

  /**
   * Generates a key pair and writes it encrypted (0600); refuses to overwrite.
   *
   * @param path target file
   * @param password password bytes (not retained)
   * @return the key pair
   * @throws IOException on IO failure or if the file exists
   */
  public static KeyPair generateEncrypted(final Path path, final byte[] password)
      throws IOException {
    final KeyPair pair = newKeyPair();
    writeEncrypted(path, pair, password, DEFAULT_SCRYPT_LOG_N);
    return pair;
  }

  private static void writePlain(final Path path, final KeyPair pair) throws IOException {
    final HexFormat hex = HexFormat.of();
    final String body =
        "format="
            + FORMAT
            + "\npub="
            + hex.formatHex(pair.pub().getH())
            + "\nf="
            + hex.formatHex(pair.secret().getSpolyf())
            + "\ng="
            + hex.formatHex(pair.secret().getG())
            + "\nF="
            + hex.formatHex(pair.secret().getSpolyF())
            + "\n";
    createOwnerOnly(path, body);
  }

  /**
   * Writes {@code pair} encrypted under {@code password} (0600, no overwrite).
   *
   * @param path target
   * @param pair key pair
   * @param password password bytes (not retained)
   * @param scryptLogN scrypt cost (log2 N), at least 14
   * @throws IOException on IO failure or if the file exists
   */
  public static void writeEncrypted(
      final Path path, final KeyPair pair, final byte[] password, final int scryptLogN)
      throws IOException {
    if (password == null || password.length < MIN_PASSWORD_BYTES) {
      throw new IllegalArgumentException(
          "Falcon key password must be at least " + MIN_PASSWORD_BYTES + " bytes");
    }
    if (scryptLogN < MIN_SCRYPT_LOG_N || scryptLogN > 22) {
      throw new IllegalArgumentException("scrypt logN out of range");
    }
    final SecureRandom rnd = SecureRandomProvider.createSecureRandom();
    final byte[] salt = new byte[32];
    final byte[] nonce = new byte[12];
    rnd.nextBytes(salt);
    rnd.nextBytes(nonce);
    final HexFormat hex = HexFormat.of();
    final Map<String, String> header = new LinkedHashMap<>();
    header.put("format", ENC_FORMAT);
    header.put("bc-falcon", "round3-bcprov");
    header.put("kdf", "scrypt");
    header.put("logN", Integer.toString(scryptLogN));
    header.put("r", Integer.toString(SCRYPT_R));
    header.put("p", Integer.toString(SCRYPT_P));
    header.put("cipher", "aes-256-gcm");
    header.put("salt", hex.formatHex(salt));
    header.put("nonce", hex.formatHex(nonce));
    header.put("address", "0x" + hex.formatHex(pair.address()));
    header.put("pub", hex.formatHex(pair.pub().getH()));
    final byte[] plain = secretBlob(pair.secret());
    final byte[] key = deriveKey(password, salt, scryptLogN);
    final byte[] ct;
    try {
      ct = gcm(Cipher.ENCRYPT_MODE, key, nonce, aad(header), plain);
    } finally {
      Arrays.fill(plain, (byte) 0);
      Arrays.fill(key, (byte) 0);
    }
    final StringBuilder sb = new StringBuilder();
    header.forEach((k, v) -> sb.append(k).append('=').append(v).append('\n'));
    sb.append("ct=").append(hex.formatHex(ct)).append('\n');
    createOwnerOnly(path, sb.toString());
  }

  private static void createOwnerOnly(final Path path, final String body) throws IOException {
    Files.createFile(
        path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    Files.writeString(path, body, StandardCharsets.US_ASCII, StandardOpenOption.TRUNCATE_EXISTING);
  }

  // ---------------------------------------------------------------- loading

  /**
   * Loads a key file (either format) and self-checks it (sign + verify). Encrypted files take the
   * password from the environment (see class docs).
   *
   * @param path key file
   * @return the key pair
   * @throws IOException on IO failure
   * @throws IllegalArgumentException on malformed/inconsistent keys or a wrong password
   */
  public static KeyPair load(final Path path) throws IOException {
    return load(path, null);
  }

  /**
   * Loads a key file with an explicit password (null = take it from the environment when needed).
   *
   * @param path key file
   * @param password password or null
   * @return the key pair
   * @throws IOException on IO failure
   */
  public static KeyPair load(final Path path, final byte[] password) throws IOException {
    checkPermissions(path);
    final Map<String, String> kv = parse(path);
    final String format = kv.get("format");
    final KeyPair pair;
    if (FORMAT.equals(format)) {
      if ("true".equalsIgnoreCase(System.getenv(ENV_REQUIRE_ENCRYPTED))) {
        throw new IllegalArgumentException(
            "Plain-text Falcon key refused (" + ENV_REQUIRE_ENCRYPTED + "=true): " + path);
      }
      pair = loadPlain(kv);
    } else if (ENC_FORMAT.equals(format)) {
      final byte[] pw = password != null ? password.clone() : passwordFromEnv();
      try {
        pair = loadEncrypted(kv, pw, path);
      } finally {
        Arrays.fill(pw, (byte) 0);
      }
    } else {
      throw new IllegalArgumentException("Not a Falcon-1024 key file: " + path);
    }
    selfCheck(pair, path);
    return pair;
  }

  /**
   * Reads only public information (no password needed).
   *
   * @param path key file
   * @return info
   * @throws IOException on IO failure
   */
  public static Info info(final Path path) throws IOException {
    final Map<String, String> kv = parse(path);
    final String format = kv.get("format");
    if (!FORMAT.equals(format) && !ENC_FORMAT.equals(format)) {
      throw new IllegalArgumentException("Not a Falcon-1024 key file: " + path);
    }
    final byte[] pub = HexFormat.of().parseHex(kv.get("pub"));
    final String addr =
        "0x" + HexFormat.of().formatHex(Falcon1024ConsensusEnvelope.validatorAddress(pub));
    if (ENC_FORMAT.equals(format) && !addr.equalsIgnoreCase(kv.get("address"))) {
      throw new IllegalArgumentException("Key file address does not match its public key");
    }
    return new Info(format, ENC_FORMAT.equals(format), addr, kv.get("pub"));
  }

  private static void checkPermissions(final Path path) throws IOException {
    try {
      final Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path);
      for (final PosixFilePermission p : perms) {
        if (p.name().startsWith("GROUP") || p.name().startsWith("OTHERS")) {
          throw new IllegalArgumentException(
              "Falcon key file must not be accessible by group/others (chmod 600): " + path);
        }
      }
    } catch (final UnsupportedOperationException nonPosix) {
      // non-POSIX file system: cannot check
    }
  }

  private static Map<String, String> parse(final Path path) throws IOException {
    final List<String> lines = Files.readAllLines(path, StandardCharsets.US_ASCII);
    final Map<String, String> kv = new LinkedHashMap<>();
    for (final String line : lines) {
      final int i = line.indexOf('=');
      if (i > 0) {
        final String k = line.substring(0, i).trim();
        if (kv.put(k, line.substring(i + 1).trim()) != null) {
          throw new IllegalArgumentException("Duplicate field in Falcon key file: " + k);
        }
      }
    }
    return kv;
  }

  private static String required(final Map<String, String> kv, final String k) {
    final String v = kv.get(k);
    if (v == null || v.isEmpty()) {
      throw new IllegalArgumentException("Falcon key file missing field " + k);
    }
    return v;
  }

  private static KeyPair loadPlain(final Map<String, String> kv) {
    final HexFormat hex = HexFormat.of();
    final byte[] pub = hex.parseHex(required(kv, "pub"));
    final FalconPublicKeyParameters pubKey = new FalconPublicKeyParameters(PARAMS, pub);
    final byte[] f = hex.parseHex(required(kv, "f"));
    final byte[] g = hex.parseHex(required(kv, "g"));
    final byte[] bigF = hex.parseHex(required(kv, "F"));
    try {
      return new KeyPair(new FalconPrivateKeyParameters(PARAMS, f, g, bigF, pub), pubKey);
    } finally {
      Arrays.fill(f, (byte) 0);
      Arrays.fill(g, (byte) 0);
      Arrays.fill(bigF, (byte) 0);
    }
  }

  private static KeyPair loadEncrypted(
      final Map<String, String> kv, final byte[] password, final Path path) {
    final HexFormat hex = HexFormat.of();
    if (!"scrypt".equals(required(kv, "kdf"))
        || !"aes-256-gcm".equals(required(kv, "cipher"))
        || !Integer.toString(SCRYPT_R).equals(required(kv, "r"))
        || !Integer.toString(SCRYPT_P).equals(required(kv, "p"))) {
      throw new IllegalArgumentException("Unsupported Falcon key file KDF/cipher: " + path);
    }
    final int logN = Integer.parseInt(required(kv, "logN"));
    if (logN < MIN_SCRYPT_LOG_N || logN > 22) {
      throw new IllegalArgumentException("Falcon key file scrypt cost out of range: " + path);
    }
    final Map<String, String> header = new LinkedHashMap<>();
    for (final String k :
        List.of(
            "format",
            "bc-falcon",
            "kdf",
            "logN",
            "r",
            "p",
            "cipher",
            "salt",
            "nonce",
            "address",
            "pub")) {
      header.put(k, required(kv, k));
    }
    final byte[] salt = hex.parseHex(header.get("salt"));
    final byte[] nonce = hex.parseHex(header.get("nonce"));
    final byte[] pub = hex.parseHex(header.get("pub"));
    final byte[] key = deriveKey(password, salt, logN);
    final byte[] plain;
    try {
      plain = gcm(Cipher.DECRYPT_MODE, key, nonce, aad(header), hex.parseHex(required(kv, "ct")));
    } catch (final IllegalStateException e) {
      throw new IllegalArgumentException(
          "Cannot decrypt Falcon key file (wrong password or tampered file): " + path);
    } finally {
      Arrays.fill(key, (byte) 0);
    }
    try {
      final ByteBuffer in = ByteBuffer.wrap(plain);
      final byte[][] parts = new byte[3][];
      for (int i = 0; i < 3; i++) {
        final int len = Short.toUnsignedInt(in.getShort());
        parts[i] = new byte[len];
        in.get(parts[i]);
      }
      if (in.hasRemaining()) {
        throw new IllegalArgumentException("Trailing data in Falcon secret");
      }
      final KeyPair pair =
          new KeyPair(
              new FalconPrivateKeyParameters(PARAMS, parts[0], parts[1], parts[2], pub),
              new FalconPublicKeyParameters(PARAMS, pub));
      for (final byte[] p : parts) {
        Arrays.fill(p, (byte) 0);
      }
      final String addr = "0x" + hex.formatHex(pair.address());
      if (!addr.equalsIgnoreCase(header.get("address"))) {
        throw new IllegalArgumentException("Falcon key file address mismatch: " + path);
      }
      return pair;
    } finally {
      Arrays.fill(plain, (byte) 0);
    }
  }

  private static void selfCheck(final KeyPair pair, final Path path) {
    final byte[] canonical =
        Falcon1024ConsensusCrypto.signingBytes(
            1, Falcon1024ConsensusCrypto.PROPOSAL, 0, 0, new byte[32]);
    final byte[] sig =
        Falcon1024ConsensusCrypto.sign(
            pair.secret(), SecureRandomProvider.createSecureRandom(), canonical);
    if (!Falcon1024ConsensusCrypto.verify(pair.pub(), canonical, sig)) {
      throw new IllegalArgumentException("Falcon key file public/secret mismatch: " + path);
    }
  }

  // ---------------------------------------------------------------- crypto helpers

  private static byte[] secretBlob(final FalconPrivateKeyParameters sk) {
    final byte[] f = sk.getSpolyf();
    final byte[] g = sk.getG();
    final byte[] bigF = sk.getSpolyF();
    final ByteBuffer out = ByteBuffer.allocate(6 + f.length + g.length + bigF.length);
    out.putShort((short) f.length).put(f);
    out.putShort((short) g.length).put(g);
    out.putShort((short) bigF.length).put(bigF);
    Arrays.fill(f, (byte) 0);
    Arrays.fill(g, (byte) 0);
    Arrays.fill(bigF, (byte) 0);
    return out.array();
  }

  private static byte[] aad(final Map<String, String> header) {
    final StringBuilder sb = new StringBuilder();
    header.forEach((k, v) -> sb.append(k).append('=').append(v).append('\n'));
    return sb.toString().getBytes(StandardCharsets.US_ASCII);
  }

  private static byte[] deriveKey(final byte[] password, final byte[] salt, final int logN) {
    return SCrypt.generate(password, salt, 1 << logN, SCRYPT_R, SCRYPT_P, 32);
  }

  private static byte[] gcm(
      final int mode, final byte[] key, final byte[] nonce, final byte[] aad, final byte[] in) {
    try {
      final Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, nonce));
      c.updateAAD(aad);
      return c.doFinal(in);
    } catch (final GeneralSecurityException e) {
      throw new IllegalStateException("AES-GCM failure");
    }
  }

  /**
   * Reads the password from {@code BESU_FALCON1024_KEY_PASSWORD_FILE} or {@code
   * BESU_FALCON1024_KEY_PASSWORD}.
   *
   * @return password bytes (caller zeroes)
   * @throws IOException on IO failure
   */
  public static byte[] passwordFromEnv() throws IOException {
    return passwordFrom(ENV_PASSWORD_FILE, ENV_PASSWORD);
  }

  private static byte[] passwordFrom(final String fileVar, final String valueVar)
      throws IOException {
    final String file = System.getenv(fileVar);
    if (file != null && !file.isBlank()) {
      final Path p = Path.of(file);
      checkPermissions(p);
      byte[] raw = Files.readAllBytes(p);
      int end = raw.length;
      while (end > 0 && (raw[end - 1] == '\n' || raw[end - 1] == '\r')) {
        end--;
      }
      final byte[] pw = Arrays.copyOf(raw, end);
      Arrays.fill(raw, (byte) 0);
      return pw;
    }
    final String v = System.getenv(valueVar);
    if (v != null && !v.isEmpty()) {
      return v.getBytes(StandardCharsets.UTF_8);
    }
    throw new IllegalArgumentException(
        "Encrypted Falcon key needs a password: set " + fileVar + " (or " + valueVar + ")");
  }

  // ---------------------------------------------------------------- CLI

  private static void printInfo(final Info i) {
    System.out.println("format=" + i.format());
    System.out.println("encrypted=" + i.encrypted());
    System.out.println("address=" + i.address());
    System.out.println("pub=" + i.publicKeyHex());
  }

  /**
   * CLI. Prints only public data (format, address, public key); never secret material.
   *
   * <pre>
   *   generate &lt;file&gt;                 legacy plain-text (0600)
   *   generate-encrypted &lt;file&gt;       password from BESU_FALCON1024_KEY_PASSWORD_FILE
   *   encrypt &lt;plainIn&gt; &lt;encOut&gt;      re-wrap a plain key encrypted (input is NOT deleted)
   *   change-password &lt;in&gt; &lt;out&gt;     new password from BESU_FALCON1024_NEW_KEY_PASSWORD_FILE
   *   info &lt;file&gt;                     public info only, no password
   *   verify &lt;file&gt;                   decrypt + sign/verify self-check
   * </pre>
   *
   * @param args arguments
   * @throws Exception on failure
   */
  public static void main(final String[] args) throws Exception {
    final String cmd = args.length > 0 ? args[0] : "";
    switch (cmd) {
      case "generate" -> {
        need(args, 2);
        printInfo(infoOf(generate(Path.of(args[1])), FORMAT));
      }
      case "generate-encrypted" -> {
        need(args, 2);
        final byte[] pw = passwordFromEnv();
        try {
          printInfo(infoOf(generateEncrypted(Path.of(args[1]), pw), ENC_FORMAT));
        } finally {
          Arrays.fill(pw, (byte) 0);
        }
      }
      case "encrypt" -> {
        need(args, 3);
        final KeyPair kp = load(Path.of(args[1]), new byte[0]);
        final byte[] pw = passwordFromEnv();
        try {
          writeEncrypted(Path.of(args[2]), kp, pw, DEFAULT_SCRYPT_LOG_N);
        } finally {
          Arrays.fill(pw, (byte) 0);
        }
        load(Path.of(args[2]));
        printInfo(info(Path.of(args[2])));
      }
      case "change-password" -> {
        need(args, 3);
        final KeyPair kp = load(Path.of(args[1]));
        final byte[] pw =
            passwordFrom(
                "BESU_FALCON1024_NEW_KEY_PASSWORD_FILE", "BESU_FALCON1024_NEW_KEY_PASSWORD");
        try {
          writeEncrypted(Path.of(args[2]), kp, pw, DEFAULT_SCRYPT_LOG_N);
          load(Path.of(args[2]), pw);
        } finally {
          Arrays.fill(pw, (byte) 0);
        }
        printInfo(info(Path.of(args[2])));
      }
      case "info" -> {
        need(args, 2);
        printInfo(info(Path.of(args[1])));
      }
      case "verify" -> {
        need(args, 2);
        final KeyPair kp = load(Path.of(args[1]));
        final Info i = info(Path.of(args[1]));
        if (!i.address().equalsIgnoreCase("0x" + HexFormat.of().formatHex(kp.address()))) {
          throw new IllegalStateException("address mismatch");
        }
        printInfo(i);
        System.out.println("selfcheck=ok");
      }
      default -> {
        System.err.println(
            "usage: Falcon1024KeyFile generate|generate-encrypted|encrypt|change-password|info|verify ...");
        System.exit(2);
      }
    }
  }

  private static Info infoOf(final KeyPair kp, final String format) {
    final HexFormat hex = HexFormat.of();
    return new Info(
        format,
        ENC_FORMAT.equals(format),
        "0x" + hex.formatHex(kp.address()),
        hex.formatHex(kp.pub().getH()));
  }

  private static void need(final String[] args, final int n) {
    if (args.length != n) {
      System.err.println("wrong number of arguments");
      System.exit(2);
    }
  }
}
