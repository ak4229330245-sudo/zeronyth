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

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

public final class Sha3 {
  private Sha3() {}

  public static byte[] hash(byte[] data) {
    try {
      return MessageDigest.getInstance("SHA3-256").digest(data);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA3-256 unavailable", e);
    }
  }

  public static byte[] merge(byte[] a, byte[] b) {
    byte[] both = new byte[64];
    System.arraycopy(a, 0, both, 0, 32);
    System.arraycopy(b, 0, both, 32, 32);
    return hash(both);
  }

  public static byte[] mergeMany(List<byte[]> digests) {
    byte[] all = new byte[digests.size() * 32];

    for (int i = 0; i < digests.size(); i++) {
      System.arraycopy(digests.get(i), 0, all, i * 32, 32);
    }

    return hash(all);
  }

  public static byte[] mergeWithInt(byte[] seed, long value) {
    byte[] data = new byte[40];
    System.arraycopy(seed, 0, data, 0, 32);

    for (int i = 0; i < 8; i++) {
      data[32 + i] = (byte) (value >>> 8 * i);
    }

    return hash(data);
  }

  public static byte[] hashElements(List<BigInteger> elements) {
    byte[] all = new byte[elements.size() * 16];

    for (int i = 0; i < elements.size(); i++) {
      System.arraycopy(F128.toLeBytes(elements.get(i)), 0, all, i * 16, 16);
    }

    return hash(all);
  }

  public static byte[] hashElements(BigInteger[] elements) {
    byte[] all = new byte[elements.length * 16];

    for (int i = 0; i < elements.length; i++) {
      System.arraycopy(F128.toLeBytes(elements[i]), 0, all, i * 16, 16);
    }

    return hash(all);
  }
}
