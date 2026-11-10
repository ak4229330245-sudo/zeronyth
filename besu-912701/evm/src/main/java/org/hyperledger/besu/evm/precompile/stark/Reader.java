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

public final class Reader {
  private final byte[] data;
  private int pos;

  public Reader(byte[] data) {
    this.data = data;
    this.pos = 0;
  }

  public int position() {
    return this.pos;
  }

  public int remaining() {
    return this.data.length - this.pos;
  }

  public boolean hasMore() {
    return this.pos < this.data.length;
  }

  public int readU8() {
    this.need(1);
    return this.data[this.pos++] & 0xFF;
  }

  public int peekU8() {
    this.need(1);
    return this.data[this.pos] & 0xFF;
  }

  public int readU16() {
    this.need(2);
    int v = this.data[this.pos] & 255 | (this.data[this.pos + 1] & 255) << 8;
    this.pos += 2;
    return v;
  }

  public long readU32() {
    this.need(4);
    long v = 0L;

    for (int i = 0; i < 4; i++) {
      v |= (long) (this.data[this.pos + i] & 255) << 8 * i;
    }

    this.pos += 4;
    return v;
  }

  public long readU64() {
    this.need(8);
    long v = 0L;

    for (int i = 0; i < 8; i++) {
      v |= (long) (this.data[this.pos + i] & 255) << 8 * i;
    }

    this.pos += 8;
    return v;
  }

  public byte[] readBytes(int n) {
    this.need(n);
    byte[] out = new byte[n];
    System.arraycopy(this.data, this.pos, out, 0, n);
    this.pos += n;
    return out;
  }

  public long readUsize() {
    int first = this.peekU8();
    int length = Integer.numberOfTrailingZeros(first) + 1;
    if (length == 9) {
      this.readU8();
      return this.readU64();
    } else {
      byte[] enc = this.readBytes(length);
      long v = 0L;

      for (int i = 0; i < length; i++) {
        v |= (long) (enc[i] & 255) << 8 * i;
      }

      return v >>> length;
    }
  }

  public byte[] readVecU8() {
    long len = this.readUsize();
    if (len > this.remaining()) {
      throw new IllegalArgumentException("vec length exceeds input");
    } else {
      return this.readBytes((int) len);
    }
  }

  public BigInteger readElement() {
    this.need(16);
    BigInteger v = F128.fromLeBytesOrNull(this.data, this.pos);
    if (v == null) {
      throw new IllegalArgumentException("field element >= modulus at " + this.pos);
    } else {
      this.pos += 16;
      return v;
    }
  }

  public List<BigInteger> readManyElements(int n) {
    List<BigInteger> out = new ArrayList<>(n);

    for (int i = 0; i < n; i++) {
      out.add(this.readElement());
    }

    return out;
  }

  public byte[] readDigest() {
    return this.readBytes(32);
  }

  private void need(int n) {
    if (this.remaining() < n) {
      throw new IllegalArgumentException("unexpected end of input");
    }
  }
}
