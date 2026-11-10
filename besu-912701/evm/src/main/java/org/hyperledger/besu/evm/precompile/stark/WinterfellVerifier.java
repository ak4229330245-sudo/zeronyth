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
import java.util.TreeSet;

public final class WinterfellVerifier {
  private WinterfellVerifier() {}

  public static void verify(byte[] proofBytes, BigInteger pubRoot0, BigInteger pubRoot1)
      throws WinterfellVerifier.VerificationException {
    Proof p;
    try {
      p = Proof.parse(proofBytes);
    } catch (RuntimeException e) {
      throw new WinterfellVerifier.VerificationException(
          "proof deserialization failed: " + e.getMessage());
    }

    validateProfile(p);
    MerkleAir air = new MerkleAir(p.traceLength(), pubRoot0, pubRoot1);

    WinterfellVerifier.Channel ch;
    try {
      ch = buildChannel(p, air);
    } catch (RuntimeException e) {
      throw new WinterfellVerifier.VerificationException(
          "channel construction failed: " + e.getMessage());
    }

    performVerification(p, air, ch);
  }

  private static void validateProfile(Proof p) throws WinterfellVerifier.VerificationException {
    if (p.mainWidth != 7) {
      fail("trace width " + p.mainWidth + " != 7");
    }

    if (p.auxWidth != 0 || p.auxRands != 0) {
      fail("auxiliary trace segments not in profile");
    }

    if (p.traceMeta.length != 0) {
      fail("trace metadata not in profile");
    }

    byte[] expectedModulus = F128.toLeBytes(F128.MODULUS);
    if (!Arrays.equals(p.modulusBytes, expectedModulus)) {
      fail("base field modulus mismatch");
    }

    if (p.optNumQueries != 28) {
      fail("num_queries " + p.optNumQueries + " != 28");
    }

    if (p.optBlowup != 8) {
      fail("blowup " + p.optBlowup + " != 8");
    }

    if (p.optGrinding != 16) {
      fail("grinding " + p.optGrinding + " != 16");
    }

    if (p.optFieldExtension != 1) {
      fail("field extension != None");
    }

    if (p.optFriFolding != 8) {
      fail("fri folding " + p.optFriFolding + " != 8");
    }

    if (p.optFriRemainderMaxDegree != 31) {
      fail("fri remainder max degree != 31");
    }

    if (p.optBatchingConstraints != 0 || p.optBatchingDeep != 0) {
      fail("batching != Linear");
    }

    if (p.optNumPartitions != 1) {
      fail("partition count " + p.optNumPartitions + " != 1");
    }

    if (p.optHashRate != 1) {
      fail("partition hash rate " + p.optHashRate + " != 1");
    }

    if (p.numConstraints != 11L) {
      fail("num_constraints " + p.numConstraints + " != 11");
    }

    int l = p.traceLength();
    if (l < 16 || (l & l - 1) != 0) {
      fail("trace length not a power of two >= 16");
    }

    if (l % 8 != 0) {
      fail("trace length not a multiple of hash cycle");
    }

    if (p.numUniqueQueries < 1 || p.numUniqueQueries > p.optNumQueries) {
      fail("num_unique_queries out of range");
    }

    if (p.traceQueries.size() != 1) {
      fail("expected exactly 1 trace segment query set");
    }
  }

  private static void fail(String msg) throws WinterfellVerifier.VerificationException {
    throw new WinterfellVerifier.VerificationException(msg);
  }

  private static WinterfellVerifier.Channel buildChannel(Proof p, MerkleAir air) {
    WinterfellVerifier.Channel ch = new WinterfellVerifier.Channel();
    int numFriLayers = p.numFriLayers();
    Reader cr = new Reader(p.commitmentsBytes);
    ch.traceCommitment = cr.readDigest();
    ch.constraintCommitment = cr.readDigest();
    ch.friCommitments = new ArrayList<>();

    for (int i = 0; i < numFriLayers + 1; i++) {
      ch.friCommitments.add(cr.readDigest());
    }

    if (cr.hasMore()) {
      throw new IllegalArgumentException("unconsumed commitment bytes");
    }

    WinterfellVerifier.ParsedQueries tq =
        parseQueries(p.traceQueries.get(0), p.numUniqueQueries, 7, p.ldeDomainSize());
    ch.traceTable = tq.table;
    ch.traceProof = tq.proof;
    int numCols = air.numConstraintCompositionColumns();
    WinterfellVerifier.ParsedQueries cq =
        parseQueries(p.constraintQueries, p.numUniqueQueries, numCols, p.ldeDomainSize());
    ch.constraintTable = cq.table;
    ch.constraintProof = cq.proof;
    parseOod(p, air, ch);
    ch.friNumPartitions = 1 << p.friProof.numPartitionsPow;
    if (ch.friNumPartitions != 1) {
      throw new IllegalArgumentException("fri partitions != 1");
    }

    int remCount = p.friProof.remainder.length / 16;
    if (p.friProof.remainder.length % 16 != 0 || remCount == 0 || (remCount & remCount - 1) != 0) {
      throw new IllegalArgumentException("remainder element count not a power of two");
    }
    Reader rr = new Reader(p.friProof.remainder);
    ch.friRemainder = rr.readManyElements(remCount).toArray(new BigInteger[0]);
    ch.friLayerValues = new ArrayList<>();
    ch.friLayerProofs = new ArrayList<>();
    ch.friLayerLeafHashes = new ArrayList<>();
    int domain = p.ldeDomainSize();

    for (Proof.FriLayerRaw layer : p.friProof.layers) {
      domain /= p.optFriFolding;
      if (layer.values.length % (16 * p.optFriFolding) != 0) {
        throw new IllegalArgumentException("fri layer values not divisible into queries");
      }

      int groups = layer.values.length / (16 * p.optFriFolding);
      Reader vr = new Reader(layer.values);
      BigInteger[][] grouped = new BigInteger[groups][];
      byte[][] leaves = new byte[groups][];

      for (int g = 0; g < groups; g++) {
        grouped[g] = vr.readManyElements(p.optFriFolding).toArray(new BigInteger[0]);
        leaves[g] = Sha3.hashElements(grouped[g]);
      }

      Reader pr = new Reader(layer.paths);
      Merkle.BatchProof bp = Merkle.parseBatchProof(pr);
      if (pr.hasMore()) {
        throw new IllegalArgumentException("unconsumed fri layer proof bytes");
      }

      if (1 << bp.depth != domain) {
        throw new IllegalArgumentException("fri layer domain mismatch");
      }

      ch.friLayerValues.add(grouped);
      ch.friLayerProofs.add(bp);
      ch.friLayerLeafHashes.add(leaves);
    }

    if (p.friProof.layers.size() != numFriLayers) {
      throw new IllegalArgumentException(
          "fri layer count " + p.friProof.layers.size() + " != " + numFriLayers);
    }

    ch.powNonce = p.powNonce;
    return ch;
  }

  private static WinterfellVerifier.ParsedQueries parseQueries(
      Proof.QueriesRaw q, int numQueries, int width, int domainSize) {
    if (q.values.length != numQueries * width * 16) {
      throw new IllegalArgumentException("query values length mismatch");
    }

    WinterfellVerifier.ParsedQueries out = new WinterfellVerifier.ParsedQueries();
    Reader vr = new Reader(q.values);
    out.table = new BigInteger[numQueries][];

    for (int i = 0; i < numQueries; i++) {
      out.table[i] = vr.readManyElements(width).toArray(new BigInteger[0]);
    }

    Reader pr = new Reader(q.openingProof);
    out.proof = Merkle.parseBatchProof(pr);
    if (pr.hasMore()) {
      throw new IllegalArgumentException("unconsumed query proof bytes");
    }

    if (1 << out.proof.depth != domainSize) {
      throw new IllegalArgumentException("query proof domain mismatch");
    }

    return out;
  }

  private static void parseOod(Proof p, MerkleAir air, WinterfellVerifier.Channel ch) {
    int numCols = air.numConstraintCompositionColumns();
    Reader tr = new Reader(p.oodTraceStates);
    int frameSize = tr.readU8();
    if (frameSize != 2) {
      throw new IllegalArgumentException("ood trace frame size != 2");
    }

    List<BigInteger> trace = tr.readManyElements(14);
    if (tr.hasMore()) {
      throw new IllegalArgumentException("unconsumed ood trace bytes");
    }

    ch.oodTraceCurrent = trace.subList(0, 7).toArray(new BigInteger[0]);
    ch.oodTraceNext = trace.subList(7, 14).toArray(new BigInteger[0]);
    Reader qr = new Reader(p.oodQuotientStates);
    int qFrameSize = qr.readU8();
    if (qFrameSize != 2) {
      throw new IllegalArgumentException("ood quotient frame size != 2");
    }

    List<BigInteger> quot = qr.readManyElements(numCols * 2);
    if (qr.hasMore()) {
      throw new IllegalArgumentException("unconsumed ood quotient bytes");
    }

    ch.oodQuotientCurrent = quot.subList(0, numCols).toArray(new BigInteger[0]);
    ch.oodQuotientNext = quot.subList(numCols, numCols * 2).toArray(new BigInteger[0]);
  }

  private static void performVerification(Proof p, MerkleAir air, WinterfellVerifier.Channel ch)
      throws WinterfellVerifier.VerificationException {
    Coin coin = new Coin(p.coinSeedElements(air.root0, air.root1));
    coin.reseed(ch.traceCommitment);
    BigInteger[] ccTransition = new BigInteger[7];
    BigInteger[] ccBoundary = new BigInteger[4];

    for (int i = 0; i < ccTransition.length; i++) {
      ccTransition[i] = coin.draw();
    }

    for (int i = 0; i < ccBoundary.length; i++) {
      ccBoundary[i] = coin.draw();
    }

    coin.reseed(ch.constraintCommitment);
    BigInteger z = coin.draw();
    BigInteger eval1 =
        air.evaluateConstraints(ccTransition, ccBoundary, ch.oodTraceCurrent, ch.oodTraceNext, z);
    BigInteger eval2 = F128.ZERO;

    for (int i = 0; i < ch.oodQuotientCurrent.length; i++) {
      eval2 =
          F128.add(
              eval2, F128.mul(F128.pow(z, (long) i * p.traceLength()), ch.oodQuotientCurrent[i]));
    }

    if (!eval1.equals(eval2)) {
      fail("inconsistent OOD constraint evaluations");
    }

    List<BigInteger> oodEvals = new ArrayList<>();
    oodEvals.addAll(Arrays.asList(ch.oodTraceCurrent));
    oodEvals.addAll(Arrays.asList(ch.oodQuotientCurrent));
    oodEvals.addAll(Arrays.asList(ch.oodTraceNext));
    oodEvals.addAll(Arrays.asList(ch.oodQuotientNext));
    coin.reseed(Sha3.hashElements(oodEvals));
    int numCols = air.numConstraintCompositionColumns();
    BigInteger[] deepTrace = new BigInteger[7];
    BigInteger[] deepConstraints = new BigInteger[numCols];

    for (int i = 0; i < deepTrace.length; i++) {
      deepTrace[i] = coin.draw();
    }

    for (int i = 0; i < deepConstraints.length; i++) {
      deepConstraints[i] = coin.draw();
    }

    int maxDegreePlus1 = p.traceLength();
    List<BigInteger> alphas = new ArrayList<>();

    for (int depth = 0; depth < ch.friCommitments.size(); depth++) {
      coin.reseed(ch.friCommitments.get(depth));
      alphas.add(coin.draw());
      if (depth != ch.friCommitments.size() - 1 && maxDegreePlus1 % p.optFriFolding != 0) {
        fail("fri degree truncation at layer " + depth);
      }

      maxDegreePlus1 /= p.optFriFolding;
    }

    if (coin.checkLeadingZeros(ch.powNonce) < p.optGrinding) {
      fail("query seed proof of work not satisfied");
    }

    List<Integer> drawn = coin.drawIntegers(p.optNumQueries, p.ldeDomainSize(), ch.powNonce);
    TreeSet<Integer> uniq = new TreeSet<>(drawn);
    List<Integer> positions = new ArrayList<>(uniq);
    if (positions.size() != p.numUniqueQueries) {
      fail(
          "unique query count mismatch: derived "
              + positions.size()
              + " vs proof "
              + p.numUniqueQueries);
    }

    int[] posArr = positions.stream().mapToInt(Integer::intValue).toArray();
    List<byte[]> traceLeaves = new ArrayList<>();

    for (BigInteger[] row : ch.traceTable) {
      traceLeaves.add(Sha3.hashElements(row));
    }

    if (!Merkle.verifyMany(ch.traceCommitment, posArr, traceLeaves, ch.traceProof)) {
      fail("trace query does not match commitment");
    }

    List<byte[]> constraintLeaves = new ArrayList<>();

    for (BigInteger[] row : ch.constraintTable) {
      constraintLeaves.add(Sha3.hashElements(row));
    }

    if (!Merkle.verifyMany(ch.constraintCommitment, posArr, constraintLeaves, ch.constraintProof)) {
      fail("constraint query does not match commitment");
    }

    List<BigInteger> deepEvaluations =
        composeDeep(p, air, ch, positions, z, deepTrace, deepConstraints);
    friVerify(p, ch, alphas, deepEvaluations, positions);
  }

  private static List<BigInteger> composeDeep(
      Proof p,
      MerkleAir air,
      WinterfellVerifier.Channel ch,
      List<Integer> positions,
      BigInteger z,
      BigInteger[] ccTrace,
      BigInteger[] ccConstraints) {
    BigInteger gLde = F128.getRootOfUnity(MerkleAir.log2(p.ldeDomainSize()));
    BigInteger gTrace = F128.getRootOfUnity(MerkleAir.log2(p.traceLength()));
    BigInteger offset = F128.GENERATOR;
    BigInteger zNext = F128.mul(z, gTrace);
    int n = positions.size();
    BigInteger[] resultNum = new BigInteger[n];
    BigInteger[] resultDen = new BigInteger[n];

    for (int j = 0; j < n; j++) {
      BigInteger x = F128.mul(F128.pow(gLde, positions.get(j).intValue()), offset);
      BigInteger t1Num = F128.ZERO;
      BigInteger t2Num = F128.ZERO;

      for (int i = 0; i < 7; i++) {
        BigInteger value = ch.traceTable[j][i];
        t1Num = F128.add(t1Num, F128.mul(F128.sub(value, ch.oodTraceCurrent[i]), ccTrace[i]));
        t2Num = F128.add(t2Num, F128.mul(F128.sub(value, ch.oodTraceNext[i]), ccTrace[i]));
      }

      BigInteger t1Den = F128.sub(x, z);
      BigInteger t2Den = F128.sub(x, zNext);
      resultDen[j] = F128.mul(t1Den, t2Den);
      resultNum[j] = F128.add(F128.mul(t1Num, t2Den), F128.mul(t2Num, t1Den));
      BigInteger c1Num = F128.ZERO;
      BigInteger c2Num = F128.ZERO;

      for (int i = 0; i < ccConstraints.length; i++) {
        BigInteger value = ch.constraintTable[j][i];
        c1Num =
            F128.add(c1Num, F128.mul(F128.sub(value, ch.oodQuotientCurrent[i]), ccConstraints[i]));
        c2Num = F128.add(c2Num, F128.mul(F128.sub(value, ch.oodQuotientNext[i]), ccConstraints[i]));
      }

      resultNum[j] =
          F128.add(resultNum[j], F128.add(F128.mul(c1Num, t2Den), F128.mul(c2Num, t1Den)));
    }

    BigInteger[] invDen = Poly.batchInversion(resultDen);
    List<BigInteger> out = new ArrayList<>(n);

    for (int j = 0; j < n; j++) {
      out.add(F128.mul(resultNum[j], invDen[j]));
    }

    return out;
  }

  private static void friVerify(
      Proof p,
      WinterfellVerifier.Channel ch,
      List<BigInteger> alphas,
      List<BigInteger> evaluationsIn,
      List<Integer> positionsIn)
      throws WinterfellVerifier.VerificationException {
    int folding = p.optFriFolding;
    int domainSize = p.ldeDomainSize();
    int maxDegreePlus1 = p.traceLength();
    BigInteger domainGenerator = F128.getRootOfUnity(MerkleAir.log2(domainSize));
    BigInteger offset = F128.GENERATOR;
    BigInteger[] foldingRoots = new BigInteger[folding];

    for (int i = 0; i < folding; i++) {
      foldingRoots[i] = F128.pow(domainGenerator, (long) (domainSize / folding) * i);
    }

    List<Integer> positions = new ArrayList<>(positionsIn);
    List<BigInteger> evaluations = new ArrayList<>(evaluationsIn);
    int numLayers = p.numFriLayers();

    for (int depth = 0; depth < numLayers; depth++) {
      int targetSize = domainSize / folding;
      List<Integer> foldedPositions = new ArrayList<>();

      for (int pos : positions) {
        int fp = pos % targetSize;
        if (!foldedPositions.contains(fp)) {
          foldedPositions.add(fp);
        }
      }

      int[] idxArr = foldedPositions.stream().mapToInt(Integer::intValue).toArray();
      List<byte[]> leaves = Arrays.asList(ch.friLayerLeafHashes.get(depth));
      if (!Merkle.verifyMany(
          ch.friCommitments.get(depth), idxArr, leaves, ch.friLayerProofs.get(depth))) {
        fail("fri layer " + depth + " commitment mismatch");
      }

      BigInteger[][] layerValues = ch.friLayerValues.get(depth);
      int rowLength = targetSize;

      for (int k = 0; k < positions.size(); k++) {
        int posx = positions.get(k);
        int idx = foldedPositions.indexOf(posx % rowLength);
        BigInteger qv = layerValues[idx][posx / rowLength];
        if (!qv.equals(evaluations.get(k))) {
          fail("fri layer " + depth + " folding inconsistent");
        }
      }

      List<BigInteger> nextEvaluations = new ArrayList<>();

      for (int g = 0; g < foldedPositions.size(); g++) {
        BigInteger xe =
            F128.mul(F128.pow(domainGenerator, foldedPositions.get(g).intValue()), offset);
        BigInteger[] xs = new BigInteger[folding];

        for (int j = 0; j < folding; j++) {
          xs[j] = F128.mul(xe, foldingRoots[j]);
        }

        BigInteger[] poly = Poly.interpolate(xs, layerValues[g]);
        nextEvaluations.add(Poly.eval(poly, alphas.get(depth)));
      }

      evaluations = nextEvaluations;
      if (maxDegreePlus1 % folding != 0) {
        fail("fri degree truncation in query phase");
      }

      maxDegreePlus1 /= folding;
      domainSize /= folding;
      domainGenerator = F128.pow(domainGenerator, folding);
      positions = foldedPositions;
    }

    if (ch.friRemainder.length > maxDegreePlus1) {
      fail("remainder degree too high");
    }

    for (int kx = 0; kx < positions.size(); kx++) {
      BigInteger x = F128.mul(offset, F128.pow(domainGenerator, positions.get(kx).intValue()));
      BigInteger comp = Poly.evalHornerRev(ch.friRemainder, x);
      if (!comp.equals(evaluations.get(kx))) {
        fail("fri remainder folding invalid");
      }
    }
  }

  private static final class Channel {
    byte[] traceCommitment;
    byte[] constraintCommitment;
    List<byte[]> friCommitments;
    BigInteger[][] traceTable;
    Merkle.BatchProof traceProof;
    BigInteger[][] constraintTable;
    Merkle.BatchProof constraintProof;
    BigInteger[] oodTraceCurrent;
    BigInteger[] oodTraceNext;
    BigInteger[] oodQuotientCurrent;
    BigInteger[] oodQuotientNext;
    List<BigInteger[][]> friLayerValues;
    List<Merkle.BatchProof> friLayerProofs;
    List<byte[][]> friLayerLeafHashes;
    BigInteger[] friRemainder;
    int friNumPartitions;
    long powNonce;
  }

  private static final class ParsedQueries {
    BigInteger[][] table;
    Merkle.BatchProof proof;
  }

  public static final class VerificationException extends Exception {
    public VerificationException(String msg) {
      super(msg);
    }
  }
}
