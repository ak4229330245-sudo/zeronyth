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
import java.util.Arrays;
import java.util.List;

public final class Poly {
  private Poly() {}

  public static BigInteger eval(BigInteger[] coeffs, BigInteger x) {
    BigInteger acc = F128.ZERO;

    for (int i = coeffs.length - 1; i >= 0; i--) {
      acc = F128.add(F128.mul(acc, x), coeffs[i]);
    }

    return acc;
  }

  public static BigInteger evalHornerRev(BigInteger[] coeffsStoredOrder, BigInteger x) {
    BigInteger acc = F128.ZERO;

    for (BigInteger c : coeffsStoredOrder) {
      acc = F128.add(F128.mul(acc, x), c);
    }

    return acc;
  }

  public static BigInteger[] interpolate(BigInteger[] xs, BigInteger[] ys) {
    int n = xs.length;
    BigInteger[] result = new BigInteger[n];
    Arrays.fill(result, F128.ZERO);

    for (int i = 0; i < n; i++) {
      BigInteger[] basis = new BigInteger[] {F128.ONE};
      BigInteger denom = F128.ONE;

      for (int j = 0; j < n; j++) {
        if (j == i) {
          continue;
        }
        denom = F128.mul(denom, F128.sub(xs[i], xs[j]));
        basis = multiplyByLinear(basis, F128.neg(xs[j]));
      }

      BigInteger scale = F128.div(ys[i], denom);

      for (int k = 0; k < basis.length; k++) {
        result[k] = F128.add(result[k], F128.mul(basis[k], scale));
      }
    }

    return result;
  }

  private static BigInteger[] multiplyByLinear(BigInteger[] p, BigInteger negRoot) {
    BigInteger[] out = new BigInteger[p.length + 1];
    Arrays.fill(out, F128.ZERO);

    for (int i = 0; i < p.length; i++) {
      out[i] = F128.add(out[i], F128.mul(p[i], negRoot));
      out[i + 1] = F128.add(out[i + 1], p[i]);
    }

    return out;
  }

  public static BigInteger[] interpolateOnRoots(BigInteger[] values) {
    int n = values.length;
    int logN = Integer.numberOfTrailingZeros(n);
    BigInteger omegaInv = F128.inv(F128.getRootOfUnity(logN));
    BigInteger nInv = F128.inv(BigInteger.valueOf(n));
    BigInteger[] coeffs = new BigInteger[n];

    for (int j = 0; j < n; j++) {
      BigInteger sum = F128.ZERO;

      for (int t = 0; t < n; t++) {
        BigInteger w = F128.pow(omegaInv, (long) t * j);
        sum = F128.add(sum, F128.mul(values[t], w));
      }

      coeffs[j] = F128.mul(sum, nInv);
    }

    return coeffs;
  }

  public static BigInteger[] batchInversion(BigInteger[] values) {
    int n = values.length;
    BigInteger[] prefix = new BigInteger[n];
    BigInteger acc = F128.ONE;

    for (int i = 0; i < n; i++) {
      prefix[i] = acc;
      acc = F128.mul(acc, values[i]);
    }

    BigInteger invAcc = F128.inv(acc);
    BigInteger[] out = new BigInteger[n];

    for (int i = n - 1; i >= 0; i--) {
      out[i] = F128.mul(prefix[i], invAcc);
      invAcc = F128.mul(invAcc, values[i]);
    }

    return out;
  }

  public static BigInteger[] powerSeries(BigInteger alpha, int n) {
    BigInteger[] out = new BigInteger[n];
    BigInteger cur = F128.ONE;

    for (int i = 0; i < n; i++) {
      out[i] = cur;
      cur = F128.mul(cur, alpha);
    }

    return out;
  }

  public static List<BigInteger> toList(BigInteger[] a) {
    return Arrays.asList(a);
  }
}
