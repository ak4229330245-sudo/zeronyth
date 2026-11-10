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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TreeMap;
import java.util.TreeSet;

public final class Merkle {
  private Merkle() {}

  public static Merkle.BatchProof parseBatchProof(Reader r) {
    int depth = r.readU8();
    long numVecs = r.readUsize();
    List<List<byte[]>> nodes = new ArrayList<>();

    for (long i = 0L; i < numVecs; i++) {
      long n = r.readUsize();
      List<byte[]> vec = new ArrayList<>();

      for (long j = 0L; j < n; j++) {
        vec.add(r.readDigest());
      }

      nodes.add(vec);
    }

    return new Merkle.BatchProof(depth, nodes);
  }

  public static boolean verifyMany(
      byte[] root, int[] indexes, List<byte[]> leaves, Merkle.BatchProof proof) {
    try {
      byte[] computed = getRoot(proof, indexes, leaves);
      return Arrays.equals(computed, root);
    } catch (RuntimeException e) {
      return false;
    }
  }

  static byte[] getRoot(Merkle.BatchProof proof, int[] indexes, List<byte[]> leaves) {
    if (indexes.length == 0) {
      throw new IllegalArgumentException("too few leaf indexes");
    }

    int numLeaves = 1 << proof.depth;
    TreeMap<Integer, Integer> indexMap = new TreeMap<>();

    for (int i = 0; i < indexes.length; i++) {
      if (indexes[i] >= numLeaves) {
        throw new IllegalArgumentException("leaf index out of bounds");
      }

      if (indexMap.put(indexes[i], i) != null) {
        throw new IllegalArgumentException("duplicate leaf index");
      }
    }

    TreeSet<Integer> normSet = new TreeSet<>();

    for (int idx : indexes) {
      normSet.add(idx - (idx & 1));
    }

    List<Integer> norm = new ArrayList<>(normSet);
    if (norm.size() != proof.nodes.size()) {
      throw new IllegalArgumentException("invalid proof (node vector count)");
    }

    TreeMap<Integer, byte[]> v = new TreeMap<>();
    int offset = 1 << proof.depth;
    List<Integer> nextIndexes = new ArrayList<>();
    List<Integer> proofPointers = new ArrayList<>();

    for (int i = 0; i < norm.size(); i++) {
      int index = norm.get(i);
      byte[] buf0;
      byte[] buf1;
      Integer i1 = indexMap.get(index);
      if (i1 != null) {
        if (leaves.size() <= i1) {
          throw new IllegalArgumentException("invalid proof");
        }

        buf0 = leaves.get(i1);
        Integer i2 = indexMap.get(index + 1);
        if (i2 != null) {
          if (leaves.size() <= i2) {
            throw new IllegalArgumentException("invalid proof");
          }

          buf1 = leaves.get(i2);
          proofPointers.add(0);
        } else {
          if (proof.nodes.get(i).isEmpty()) {
            throw new IllegalArgumentException("invalid proof");
          }

          buf1 = proof.nodes.get(i).get(0);
          proofPointers.add(1);
        }
      } else {
        if (proof.nodes.get(i).isEmpty()) {
          throw new IllegalArgumentException("invalid proof");
        }

        buf0 = proof.nodes.get(i).get(0);
        Integer i2 = indexMap.get(index + 1);
        if (i2 != null) {
          if (leaves.size() <= i2) {
            throw new IllegalArgumentException("invalid proof");
          }
          buf1 = leaves.get(i2);
        } else {
          throw new IllegalArgumentException("invalid proof");
        }
        proofPointers.add(1);
      }

      byte[] parent = Sha3.merge(buf0, buf1);
      int parentIndex = offset + index >> 1;
      v.put(parentIndex, parent);
      nextIndexes.add(parentIndex);
    }

    for (int level = 1; level < proof.depth; level++) {
      List<Integer> cur = new ArrayList<>(nextIndexes);
      nextIndexes.clear();

      for (int i = 0; i < cur.size(); i++) {
        int nodeIndex = cur.get(i);
        int siblingIndex = nodeIndex ^ 1;
        byte[] sibling;
        if (i + 1 < cur.size() && cur.get(i + 1) == siblingIndex) {
          sibling = v.get(siblingIndex);
          if (sibling == null) {
            throw new IllegalArgumentException("invalid proof");
          }

          i++;
        } else {
          int pointer = proofPointers.get(i);
          if (proof.nodes.get(i).size() <= pointer) {
            throw new IllegalArgumentException("invalid proof");
          }

          sibling = proof.nodes.get(i).get(pointer);
          proofPointers.set(i, pointer + 1);
        }

        byte[] node = v.get(nodeIndex);
        if (node == null) {
          throw new IllegalArgumentException("invalid proof");
        }

        byte[] parent =
            (nodeIndex & 1) != 0 ? Sha3.merge(sibling, node) : Sha3.merge(node, sibling);
        int parentIndex = nodeIndex >> 1;
        v.put(parentIndex, parent);
        nextIndexes.add(parentIndex);
      }
    }

    byte[] root = v.remove(1);
    if (root == null) {
      throw new IllegalArgumentException("invalid proof");
    }

    return root;
  }

  public static final class BatchProof {
    public final int depth;
    public final List<List<byte[]>> nodes;

    BatchProof(int depth, List<List<byte[]>> nodes) {
      this.depth = depth;
      this.nodes = nodes;
    }
  }
}
