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
package org.hyperledger.besu.consensus.qbft.core.payload;

import org.hyperledger.besu.consensus.common.bft.ConsensusRoundIdentifier;
import org.hyperledger.besu.consensus.common.bft.payload.Payload;
import org.hyperledger.besu.consensus.qbft.core.messagedata.QbftV1;
import org.hyperledger.besu.crypto.Falcon1024ConsensusCrypto;
import org.hyperledger.besu.crypto.Falcon1024ConsensusEnvelope;
import org.hyperledger.besu.crypto.Falcon1024ConsensusEnvelope.VerifiedMessage;
import org.hyperledger.besu.datatypes.Hash;

import java.security.SecureRandom;
import java.util.Collection;

import org.bouncycastle.pqc.crypto.falcon.FalconPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.falcon.FalconPublicKeyParameters;

/**
 * Falcon-1024 authenticator for Besu's actual QBFT Payload objects.
 *
 * <p>All four native QBFT payload classes implement Payload. This adapter binds the existing
 * canonical RLP payload hash to the new signed-envelope format. It is an integration building
 * block, NOT YET plugged into Besu's MessageFactory, QbftMessageDecoder, or block-header seals.
 * Those paths must all switch atomically on a separate experimental protocol version.
 */
public final class FalconQbftPayloadAuthenticator {
  private FalconQbftPayloadAuthenticator() {}

  public static byte[] sign(
      final Payload payload,
      final FalconPrivateKeyParameters secret,
      final FalconPublicKeyParameters pub,
      final SecureRandom random,
      final long chainId) {
    final ConsensusRoundIdentifier round = payload.getRoundIdentifier();
    return Falcon1024ConsensusEnvelope.signAndEncode(
        secret,
        pub,
        random,
        chainId,
        mapNativeMessageCode(payload.getMessageType()),
        round.getSequenceNumber(),
        round.getRoundNumber(),
        payload.hashForSignature().getBytes().toArray());
  }

  public static VerifiedMessage verify(
      final Payload decodedNativePayload,
      final byte[] signedEnvelope,
      final long expectedChainId,
      final Collection<byte[]> allowedValidatorPublicKeys) {
    final VerifiedMessage signed =
        Falcon1024ConsensusEnvelope.decodeAndVerify(
            signedEnvelope,
            expectedChainId,
            mapNativeMessageCode(decodedNativePayload.getMessageType()),
            decodedNativePayload.hashForSignature().getBytes().toArray(),
            allowedValidatorPublicKeys);
    final ConsensusRoundIdentifier round = decodedNativePayload.getRoundIdentifier();
    if (signed.blockHeight() != round.getSequenceNumber()
        || signed.round() != round.getRoundNumber()) {
      throw new IllegalArgumentException("Falcon envelope does not match native QBFT round");
    }
    return signed;
  }

  /**
   * Commit seals are signed over Besu's actual committed-seal hash, distinct from COMMIT messages.
   * Block-header serialization/verification must still be integrated separately.
   */
  public static byte[] signCommitSeal(
      final Hash committedSealHash,
      final ConsensusRoundIdentifier round,
      final FalconPrivateKeyParameters secret,
      final FalconPublicKeyParameters pub,
      final SecureRandom random,
      final long chainId) {
    return Falcon1024ConsensusEnvelope.signAndEncode(
        secret,
        pub,
        random,
        chainId,
        Falcon1024ConsensusCrypto.COMMIT_SEAL,
        round.getSequenceNumber(),
        round.getRoundNumber(),
        committedSealHash.getBytes().toArray());
  }

  private static int mapNativeMessageCode(final int code) {
    return switch (code) {
      case QbftV1.PROPOSAL -> Falcon1024ConsensusCrypto.PROPOSAL;
      case QbftV1.PREPARE -> Falcon1024ConsensusCrypto.PREPARE;
      case QbftV1.COMMIT -> Falcon1024ConsensusCrypto.COMMIT;
      case QbftV1.ROUND_CHANGE -> Falcon1024ConsensusCrypto.ROUND_CHANGE;
      default -> throw new IllegalArgumentException("Unsupported native QBFT message type");
    };
  }
}
