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

public final class Coin {
  private byte[] seed;
  private long counter;

  public Coin(List<BigInteger> seedElements) {
    this.seed = Sha3.hashElements(seedElements);
    this.counter = 0L;
  }

  private byte[] next() {
    this.counter++;
    return Sha3.mergeWithInt(this.seed, this.counter);
  }

  public void reseed(byte[] data) {
    this.seed = Sha3.merge(this.seed, data);
    this.counter = 0L;
  }

  public BigInteger draw() {
    for (int i = 0; i < 1000; i++) {
      byte[] value = this.next();
      BigInteger el = F128.fromLeBytesOrNull(value, 0);
      if (el != null) {
        return el;
      }
    }

    throw new IllegalStateException("failed to draw field element after 1000 tries");
  }

  public int checkLeadingZeros(long value) {
    byte[] newSeed = Sha3.mergeWithInt(this.seed, value);
    long head = 0L;

    for (int i = 0; i < 8; i++) {
      head |= (long) (newSeed[i] & 255) << 8 * i;
    }

    return Long.numberOfTrailingZeros(head);
  }

  public List<Integer> drawIntegers(int numValues, int domainSize, long nonce) {
    this.seed = Sha3.mergeWithInt(this.seed, nonce);
    this.counter = 0L;
    long mask = domainSize - 1L;
    List<Integer> values = new ArrayList<>(numValues);

    for (int i = 0; i < 1000 && values.size() < numValues; i++) {
      byte[] bytes = this.next();
      long v = 0L;

      for (int j = 0; j < 8; j++) {
        v |= (long) (bytes[j] & 255) << 8 * j;
      }

      values.add((int) (v & mask));
    }

    if (values.size() < numValues) {
      throw new IllegalStateException("failed to draw integers");
    } else {
      return values;
    }
  }
}
