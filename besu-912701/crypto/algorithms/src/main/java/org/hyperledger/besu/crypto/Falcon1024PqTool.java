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

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.List;

/**
 * Helper for the off-chain ML-DSA-65 finality attester on a Falcon-QBFT chain. Prints only public
 * data (addresses, public signatures); never prints key material.
 *
 * <pre>
 * bind-sign &lt;falconKeyFile&gt; &lt;chainId&gt; &lt;hash32hex&gt;   -> Falcon PQ_BINDING envelope hex
 * serve   (stdin lines, one reply line each):
 *   seals &lt;chainId&gt; &lt;height&gt; &lt;round&gt; &lt;hash32hex&gt; &lt;seal1hex,seal2hex,...&gt; -> addr|x,...
 *   bind  &lt;chainId&gt; &lt;hash32hex&gt; &lt;envelopehex&gt;                              -> addr|x
 * </pre>
 */
public final class Falcon1024PqTool {
  private static final HexFormat HEX = HexFormat.of();

  private Falcon1024PqTool() {}

  private static byte[] hex(final String s) {
    return HEX.parseHex(s.startsWith("0x") ? s.substring(2) : s);
  }

  private static String verify(
      final byte[] env,
      final long chainId,
      final int type,
      final long h,
      final int r,
      final byte[] hash) {
    try {
      final Falcon1024ConsensusEnvelope.VerifiedMessage m =
          Falcon1024ConsensusEnvelope.decodeAndVerify(
              env, chainId, type, hash, List.of(Falcon1024ConsensusEnvelope.publicKeyOf(env)));
      if (m.blockHeight() != h || m.round() != r || m.chainId() != chainId) {
        return "x";
      }
      return "0x" + HEX.formatHex(m.authorAddress());
    } catch (final RuntimeException e) {
      return "x";
    }
  }

  /**
   * Entry point.
   *
   * @param args see class doc
   * @throws Exception on I/O error
   */
  public static void main(final String[] args) throws Exception {
    final PrintStream out = System.out;
    if (args.length == 4 && args[0].equals("bind-sign")) {
      final Falcon1024KeyFile.KeyPair kp = Falcon1024KeyFile.load(Path.of(args[1]));
      final byte[] env =
          Falcon1024ConsensusEnvelope.signAndEncode(
              kp.secret(),
              kp.pub(),
              SecureRandomProvider.createSecureRandom(),
              Long.parseLong(args[2]),
              Falcon1024ConsensusCrypto.PQ_BINDING,
              0,
              0,
              hex(args[3]));
      out.println("0x" + HEX.formatHex(env));
      return;
    }
    if (args.length == 1 && args[0].equals("serve")) {
      final BufferedReader in =
          new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
      String line;
      while ((line = in.readLine()) != null) {
        final String[] p = line.trim().split(" ", -1);
        try {
          if (p[0].equals("seals") && p.length == 6) {
            final long chainId = Long.parseLong(p[1]);
            final long h = Long.parseLong(p[2]);
            final int r = Integer.parseInt(p[3]);
            final byte[] hash = hex(p[4]);
            final StringBuilder sb = new StringBuilder();
            for (final String s : p[5].split(",", -1)) {
              if (sb.length() > 0) {
                sb.append(',');
              }
              sb.append(verify(hex(s), chainId, Falcon1024ConsensusCrypto.COMMIT_SEAL, h, r, hash));
            }
            out.println(sb);
          } else if (p[0].equals("bind") && p.length == 4) {
            out.println(
                verify(
                    hex(p[3]),
                    Long.parseLong(p[1]),
                    Falcon1024ConsensusCrypto.PQ_BINDING,
                    0,
                    0,
                    hex(p[2])));
          } else {
            out.println("ERR usage");
          }
        } catch (final RuntimeException e) {
          out.println("ERR " + e.getClass().getSimpleName());
        }
        out.flush();
      }
      return;
    }
    System.err.println("usage: bind-sign <falconKeyFile> <chainId> <hash32hex> | serve");
    System.exit(2);
  }
}
