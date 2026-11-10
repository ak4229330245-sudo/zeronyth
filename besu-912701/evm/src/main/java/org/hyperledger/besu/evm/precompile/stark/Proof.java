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
import java.util.List;

public final class Proof {
  public int mainWidth;
  public int auxWidth;
  public int auxRands;
  public int logTraceLength;
  public byte[] traceMeta;
  public byte[] modulusBytes;
  public int optNumQueries;
  public int optBlowup;
  public int optGrinding;
  public int optFieldExtension;
  public int optFriFolding;
  public int optFriRemainderMaxDegree;
  public int optBatchingConstraints;
  public int optBatchingDeep;
  public int optNumPartitions;
  public int optHashRate;
  public long numConstraints;
  public int numUniqueQueries;
  public byte[] commitmentsBytes;
  public List<Proof.QueriesRaw> traceQueries = new ArrayList<>();
  public Proof.QueriesRaw constraintQueries;
  public byte[] oodTraceStates;
  public byte[] oodQuotientStates;
  public Proof.FriProofRaw friProof;
  public long powNonce;

  public int traceLength() {
    return 1 << this.logTraceLength;
  }

  public int ldeDomainSize() {
    return this.traceLength() * this.optBlowup;
  }

  public static Proof parse(byte[] bytes) {
    Reader r = new Reader(bytes);
    Proof p = new Proof();
    p.mainWidth = r.readU8();
    p.auxWidth = r.readU8();
    p.auxRands = r.readU8();
    p.logTraceLength = r.readU8();
    int metaLen = r.readU16();
    p.traceMeta = r.readBytes(metaLen);
    int modLen = r.readU8();
    p.modulusBytes = r.readBytes(modLen);
    p.optNumQueries = r.readU8();
    p.optBlowup = r.readU8();
    p.optGrinding = r.readU8();
    p.optFieldExtension = r.readU8();
    p.optFriFolding = r.readU8();
    p.optFriRemainderMaxDegree = r.readU8();
    p.optBatchingConstraints = r.readU8();
    p.optBatchingDeep = r.readU8();
    p.optNumPartitions = r.readU8();
    p.optHashRate = r.readU8();
    p.numConstraints = r.readUsize();
    p.numUniqueQueries = r.readU8();
    int commitmentsLen = r.readU16();
    p.commitmentsBytes = r.readBytes(commitmentsLen);
    int numSegments = p.auxWidth > 0 ? 2 : 1;

    for (int i = 0; i < numSegments; i++) {
      p.traceQueries.add(readQueries(r));
    }

    p.constraintQueries = readQueries(r);
    int oodTraceLen = r.readU16();
    p.oodTraceStates = r.readBytes(oodTraceLen);
    int oodQuotLen = r.readU16();
    p.oodQuotientStates = r.readBytes(oodQuotLen);
    Proof.FriProofRaw fri = new Proof.FriProofRaw();
    int nLayers = r.readU8();

    for (int i = 0; i < nLayers; i++) {
      Proof.FriLayerRaw l = new Proof.FriLayerRaw();
      long vlen = r.readU32();
      l.values = r.readBytes((int) vlen);
      long plen = r.readU32();
      l.paths = r.readBytes((int) plen);
      fri.layers.add(l);
    }

    int remLen = r.readU16();
    fri.remainder = r.readBytes(remLen);
    fri.numPartitionsPow = r.readU8();
    p.friProof = fri;
    p.powNonce = r.readU64();
    if (r.hasMore()) {
      throw new IllegalArgumentException("trailing bytes after proof: " + r.remaining());
    } else {
      return p;
    }
  }

  private static Proof.QueriesRaw readQueries(Reader r) {
    Proof.QueriesRaw q = new Proof.QueriesRaw();
    q.values = r.readVecU8();
    q.openingProof = r.readVecU8();
    return q;
  }

  public List<BigInteger> coinSeedElements(BigInteger pubRoot0, BigInteger pubRoot1) {
    List<BigInteger> out = new ArrayList<>();
    int numAuxSegments = this.auxWidth > 0 ? 1 : 0;
    int buf = this.mainWidth;
    buf = buf << 8 | numAuxSegments;
    if (numAuxSegments == 1) {
      buf = buf << 8 | this.auxWidth;
      buf = buf << 8 | this.auxRands;
    }

    out.add(BigInteger.valueOf(buf));
    out.add(BigInteger.valueOf(this.traceLength()));
    if (this.traceMeta.length > 0) {
      for (int off = 0; off < this.traceMeta.length; off += 15) {
        int n = Math.min(15, this.traceMeta.length - off);
        byte[] chunk = new byte[n];
        System.arraycopy(this.traceMeta, off, chunk, 0, n);
        out.add(F128.fromBytesWithPadding(chunk));
      }
    }

    int half = this.modulusBytes.length / 2;
    byte[] m1 = new byte[half];
    byte[] m2 = new byte[this.modulusBytes.length - half];
    System.arraycopy(this.modulusBytes, 0, m1, 0, half);
    System.arraycopy(this.modulusBytes, half, m2, 0, m2.length);
    out.add(F128.fromBytesWithPadding(m1));
    out.add(F128.fromBytesWithPadding(m2));
    out.add(BigInteger.valueOf(this.numConstraints));
    int obuf = this.optFieldExtension;
    obuf = obuf << 8 | this.optFriFolding;
    obuf = obuf << 8 | this.optFriRemainderMaxDegree;
    obuf = obuf << 8 | this.optBlowup;
    out.add(BigInteger.valueOf(obuf));
    out.add(BigInteger.valueOf(this.optGrinding));
    out.add(BigInteger.valueOf(this.optNumQueries));
    out.add(pubRoot0);
    out.add(pubRoot1);
    return out;
  }

  public int numFriLayers() {
    int domain = this.ldeDomainSize();
    int maxRemainder = (this.optFriRemainderMaxDegree + 1) * this.optBlowup;

    int result;
    for (result = 0; domain > maxRemainder; result++) {
      domain /= this.optFriFolding;
    }

    return result;
  }

  public static final class FriLayerRaw {
    public byte[] values;
    public byte[] paths;
  }

  public static final class FriProofRaw {
    public List<Proof.FriLayerRaw> layers = new ArrayList<>();
    public byte[] remainder;
    public int numPartitionsPow;
  }

  public static final class QueriesRaw {
    public byte[] values;
    public byte[] openingProof;
  }
}
