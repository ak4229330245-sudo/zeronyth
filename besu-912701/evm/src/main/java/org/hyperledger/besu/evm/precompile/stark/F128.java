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

public final class F128 {
  public static final BigInteger MODULUS =
      new BigInteger("340282366920938463463374557953744961537");
  public static final BigInteger ZERO = BigInteger.ZERO;
  public static final BigInteger ONE = BigInteger.ONE;
  public static final BigInteger GENERATOR = BigInteger.valueOf(3L);
  public static final BigInteger TWO_ADIC_ROOT =
      new BigInteger("23953097886125630542083529559205016746");

  private F128() {}

  public static BigInteger add(BigInteger a, BigInteger b) {
    BigInteger r = a.add(b);
    return r.compareTo(MODULUS) >= 0 ? r.subtract(MODULUS) : r;
  }

  public static BigInteger sub(BigInteger a, BigInteger b) {
    BigInteger r = a.subtract(b);
    return r.signum() < 0 ? r.add(MODULUS) : r;
  }

  public static BigInteger neg(BigInteger a) {
    return a.signum() == 0 ? a : MODULUS.subtract(a);
  }

  public static BigInteger mul(BigInteger a, BigInteger b) {
    return a.multiply(b).mod(MODULUS);
  }

  public static BigInteger inv(BigInteger a) {
    if (a.signum() == 0) {
      throw new ArithmeticException("inverse of zero");
    } else {
      return a.modInverse(MODULUS);
    }
  }

  public static BigInteger div(BigInteger a, BigInteger b) {
    return mul(a, inv(b));
  }

  public static BigInteger pow(BigInteger a, BigInteger e) {
    return a.modPow(e, MODULUS);
  }

  public static BigInteger pow(BigInteger a, long e) {
    return a.modPow(BigInteger.valueOf(e), MODULUS);
  }

  public static BigInteger getRootOfUnity(int log2Size) {
    if (log2Size < 0 || log2Size > 40) {
      throw new IllegalArgumentException("log2 size " + log2Size);
    }
    if (log2Size == 0) {
      return ONE;
    }
    // TWO_ADIC_ROOT has order 2^40
    return pow(TWO_ADIC_ROOT, BigInteger.ONE.shiftLeft(40 - log2Size));
  }

  public static byte[] toLeBytes(BigInteger v) {
    byte[] be = v.toByteArray();
    byte[] out = new byte[16];

    for (int i = 0; i < be.length && i < 16; i++) {
      out[i] = be[be.length - 1 - i];
    }

    return out;
  }

  public static BigInteger fromLeBytesOrNull(byte[] b, int off) {
    byte[] be = new byte[16];

    for (int i = 0; i < 16; i++) {
      be[i] = b[off + 15 - i];
    }

    BigInteger v = new BigInteger(1, be);
    return v.compareTo(MODULUS) < 0 ? v : null;
  }

  public static BigInteger fromBytesWithPadding(byte[] bytes) {
    byte[] be = new byte[bytes.length];

    for (int i = 0; i < bytes.length; i++) {
      be[i] = bytes[bytes.length - 1 - i];
    }

    return new BigInteger(1, be).mod(MODULUS);
  }
}
