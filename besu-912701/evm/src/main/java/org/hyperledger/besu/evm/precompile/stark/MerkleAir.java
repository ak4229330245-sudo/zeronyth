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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class MerkleAir {
  public static final int TRACE_WIDTH = 7;
  public static final int NUM_TRANSITION_CONSTRAINTS = 7;
  public static final int NUM_ASSERTIONS = 4;
  public static final int HASH_CYCLE_LEN = 8;
  public static final int HASH_STATE_WIDTH = 6;
  public final int traceLength;
  public final BigInteger root0;
  public final BigInteger root1;
  private final List<BigInteger[]> periodicPolys = new ArrayList<>();

  public MerkleAir(int traceLength, BigInteger root0, BigInteger root1) {
    this.traceLength = traceLength;
    this.root0 = root0;
    this.root1 = root1;
    BigInteger[] mask = new BigInteger[8];

    for (int i = 0; i < 8; i++) {
      mask[i] = i < 7 ? F128.ONE : F128.ZERO;
    }

    this.periodicPolys.add(Poly.interpolateOnRoots(mask));

    for (int j = 0; j < 12; j++) {
      BigInteger[] col = new BigInteger[8];

      for (int i = 0; i < 8; i++) {
        col[i] = RescueConsts.ARK_FLAT[i * 12 + j];
      }

      this.periodicPolys.add(Poly.interpolateOnRoots(col));
    }
  }

  public int numConstraintCompositionColumns() {
    int l = this.traceLength;
    int degHash = 5 * (l - 1) + l / 8 * 7;
    int degBit = 2 * (l - 1);
    int highest = Math.max(degHash, degBit);
    int divisorDegree = l - 1;
    int cols = (highest - divisorDegree + l - 1) / l;
    return Math.max(cols, 1);
  }

  public BigInteger[] periodicValuesAt(BigInteger x) {
    BigInteger arg = F128.pow(x, this.traceLength / 8);
    BigInteger[] out = new BigInteger[this.periodicPolys.size()];

    for (int i = 0; i < out.length; i++) {
      out[i] = Poly.eval(this.periodicPolys.get(i), arg);
    }

    return out;
  }

  private static void sbox(BigInteger[] s) {
    for (int i = 0; i < 6; i++) {
      s[i] = F128.pow(s[i], 5L);
    }
  }

  private static void mds(BigInteger[] s, BigInteger[] table) {
    BigInteger[] result = new BigInteger[6];

    for (int i = 0; i < 6; i++) {
      BigInteger acc = F128.ZERO;

      for (int j = 0; j < 6; j++) {
        acc = F128.add(acc, F128.mul(table[i * 6 + j], s[j]));
      }

      result[i] = acc;
    }

    System.arraycopy(result, 0, s, 0, 6);
  }

  private static void enforceRound(
      BigInteger[] result,
      BigInteger[] current,
      BigInteger[] next,
      BigInteger[] ark,
      BigInteger flag) {
    BigInteger[] step1 = new BigInteger[6];
    System.arraycopy(current, 0, step1, 0, 6);
    sbox(step1);
    mds(step1, RescueConsts.MDS);

    for (int i = 0; i < 6; i++) {
      step1[i] = F128.add(step1[i], ark[i]);
    }

    BigInteger[] step2 = new BigInteger[6];
    System.arraycopy(next, 0, step2, 0, 6);

    for (int i = 0; i < 6; i++) {
      step2[i] = F128.sub(step2[i], ark[6 + i]);
    }

    mds(step2, RescueConsts.INV_MDS);
    sbox(step2);

    for (int i = 0; i < 6; i++) {
      result[i] = F128.add(result[i], F128.mul(flag, F128.sub(step2[i], step1[i])));
    }
  }

  public BigInteger[] evaluateTransition(
      BigInteger[] current, BigInteger[] next, BigInteger[] periodicValues) {
    BigInteger[] result = new BigInteger[7];
    Arrays.fill(result, F128.ZERO);
    BigInteger hashFlag = periodicValues[0];
    BigInteger[] ark = new BigInteger[12];
    System.arraycopy(periodicValues, 1, ark, 0, 12);
    BigInteger[] curState = new BigInteger[6];
    BigInteger[] nextState = new BigInteger[6];
    System.arraycopy(current, 0, curState, 0, 6);
    System.arraycopy(next, 0, nextState, 0, 6);
    enforceRound(result, curState, nextState, ark, hashFlag);
    BigInteger hashInitFlag = F128.sub(F128.ONE, hashFlag);
    BigInteger bit = next[6];
    BigInteger notBit = F128.sub(F128.ONE, bit);
    result[0] =
        F128.add(
            result[0], F128.mul(F128.mul(hashInitFlag, notBit), F128.sub(current[0], next[0])));
    result[1] =
        F128.add(
            result[1], F128.mul(F128.mul(hashInitFlag, notBit), F128.sub(current[1], next[1])));
    result[2] =
        F128.add(result[2], F128.mul(F128.mul(hashInitFlag, bit), F128.sub(current[0], next[2])));
    result[3] =
        F128.add(result[3], F128.mul(F128.mul(hashInitFlag, bit), F128.sub(current[1], next[3])));
    result[4] = F128.add(result[4], F128.mul(hashInitFlag, next[4]));
    result[5] = F128.add(result[5], F128.mul(hashInitFlag, next[5]));
    result[6] = F128.sub(F128.mul(current[6], current[6]), current[6]);
    return result;
  }

  public BigInteger evaluateConstraints(
      BigInteger[] transitionCoeffs,
      BigInteger[] boundaryCoeffs,
      BigInteger[] frameCurrent,
      BigInteger[] frameNext,
      BigInteger x) {
    BigInteger[] periodic = this.periodicValuesAt(x);
    BigInteger[] tEvals = this.evaluateTransition(frameCurrent, frameNext, periodic);
    BigInteger sum = F128.ZERO;

    for (int i = 0; i < tEvals.length; i++) {
      sum = F128.add(sum, F128.mul(transitionCoeffs[i], tEvals[i]));
    }

    BigInteger g = F128.getRootOfUnity(log2(this.traceLength));
    BigInteger tDivisor =
        F128.div(
            F128.sub(F128.pow(x, this.traceLength), F128.ONE),
            F128.sub(x, F128.pow(g, this.traceLength - 1)));
    BigInteger result = F128.div(sum, tDivisor);
    BigInteger numA = F128.ZERO;
    numA = F128.add(numA, F128.mul(boundaryCoeffs[0], F128.sub(frameCurrent[0], this.root0)));
    numA = F128.add(numA, F128.mul(boundaryCoeffs[1], F128.sub(frameCurrent[1], this.root1)));
    result = F128.add(result, F128.div(numA, F128.sub(x, F128.pow(g, this.traceLength - 1))));
    BigInteger numB = F128.ZERO;
    numB = F128.add(numB, F128.mul(boundaryCoeffs[2], frameCurrent[4]));
    numB = F128.add(numB, F128.mul(boundaryCoeffs[3], frameCurrent[5]));
    BigInteger divB = F128.sub(F128.pow(x, this.traceLength / 8), F128.ONE);
    result = F128.add(result, F128.div(numB, divB));
    return result;
  }

  static int log2(int v) {
    return Integer.numberOfTrailingZeros(v);
  }
}
