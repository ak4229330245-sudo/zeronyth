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

import java.math.BigInteger;
import java.util.Arrays;
import java.util.Objects;

import org.apache.tuweni.bytes.Bytes;

/**
 * Carrier for a Falcon-1024 consensus signature (a {@link Falcon1024ConsensusEnvelope} wire blob)
 * inside Besu's BFT data model, which is typed on {@link SECPSignature}.
 *
 * <p>This exists so the QBFT pipeline (SignedData, CommitPayload, BftExtraData seals) can carry a
 * Falcon envelope without a repository-wide type refactor. It is NOT an ECDSA signature: r, s and
 * recId are fixed to zero and must never be interpreted. Only {@link #encodedBytes()} is
 * meaningful. Verification is performed exclusively by the Falcon consensus scheme against a
 * locally recomputed domain (chain ID, message type, height, round, payload hash).
 */
public final class Falcon1024Signature extends SECPSignature {

  private final byte[] envelope;

  private Falcon1024Signature(final byte[] envelope) {
    super(BigInteger.ZERO, BigInteger.ZERO, (byte) 0);
    this.envelope = envelope;
  }

  /**
   * Wraps a structurally valid Falcon envelope. Does NOT verify the signature.
   *
   * @param envelope the envelope bytes
   * @return the carrier
   * @throws IllegalArgumentException when the bytes are not a structurally valid envelope
   */
  public static Falcon1024Signature fromEnvelope(final byte[] envelope) {
    Objects.requireNonNull(envelope, "envelope");
    Falcon1024ConsensusEnvelope.publicKeyOf(envelope); // structural validation
    return new Falcon1024Signature(envelope.clone());
  }

  /**
   * Decodes a carrier from wire bytes.
   *
   * @param bytes the bytes
   * @return the carrier
   */
  public static Falcon1024Signature decode(final Bytes bytes) {
    return fromEnvelope(bytes.toArrayUnsafe());
  }

  /**
   * Envelope bytes.
   *
   * @return a copy of the envelope
   */
  public byte[] envelope() {
    return envelope.clone();
  }

  @Override
  public Bytes encodedBytes() {
    return Bytes.wrap(envelope);
  }

  @Override
  public boolean equals(final Object other) {
    return other instanceof Falcon1024Signature that && Arrays.equals(envelope, that.envelope);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(envelope);
  }

  @Override
  public String toString() {
    return "Falcon1024Signature{bytes=" + envelope.length + "}";
  }
}
