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
package org.hyperledger.besu.consensus.qbft;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.hyperledger.besu.consensus.common.bft.BftBlockHashing;
import org.hyperledger.besu.consensus.common.bft.BftBlockInterface;
import org.hyperledger.besu.consensus.common.bft.BftExtraData;
import org.hyperledger.besu.consensus.common.bft.ConsensusRoundIdentifier;
import org.hyperledger.besu.consensus.common.bft.FalconConsensus;
import org.hyperledger.besu.consensus.common.bft.Vote;
import org.hyperledger.besu.consensus.common.bft.payload.SignedData;
import org.hyperledger.besu.consensus.qbft.core.messagewrappers.Commit;
import org.hyperledger.besu.consensus.qbft.core.messagewrappers.Prepare;
import org.hyperledger.besu.consensus.qbft.core.payload.CommitPayload;
import org.hyperledger.besu.consensus.qbft.core.payload.PreparePayload;
import org.hyperledger.besu.crypto.Falcon1024KeyFile;
import org.hyperledger.besu.crypto.Falcon1024Signature;
import org.hyperledger.besu.crypto.SECPSignature;
import org.hyperledger.besu.cryptoservices.NodeKey;
import org.hyperledger.besu.cryptoservices.NodeKeyUtils;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.datatypes.Hash;
import org.hyperledger.besu.ethereum.core.BlockHeader;
import org.hyperledger.besu.ethereum.core.BlockHeaderTestFixture;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** End-to-end Falcon-1024 QBFT signature data-flow through real Besu codecs and wrappers. */
public class FalconQbftConsensusTest {
  private static final long CHAIN_ID = 91270;
  private static final int N = 4;
  @TempDir static Path keyDir;
  private static final List<NodeKey> NODE_KEYS = new ArrayList<>();
  private static final List<Falcon1024KeyFile.KeyPair> FALCON = new ArrayList<>();
  private final QbftExtraDataCodec codec = new QbftExtraDataCodec();

  @BeforeAll
  static void keys() throws Exception {
    for (int i = 0; i < N; i++) {
      final Path p = keyDir.resolve("falcon" + i + ".key");
      Falcon1024KeyFile.generate(p);
      FALCON.add(Falcon1024KeyFile.load(p)); // exercises persistence round trip
      NODE_KEYS.add(NodeKeyUtils.generate());
    }
  }

  @BeforeEach
  void enable() {
    FalconConsensus.reset();
    FalconConsensus.enable(CHAIN_ID);
    for (int i = 0; i < N; i++) {
      FalconConsensus.bindLocalKey(NODE_KEYS.get(i), FALCON.get(i));
    }
  }

  @AfterEach
  void reset() {
    FalconConsensus.reset();
  }

  private static Address addr(final int i) {
    return FalconConsensus.consensusAddress(NODE_KEYS.get(i));
  }

  private List<Address> validators() {
    final List<Address> v = new ArrayList<>();
    for (int i = 0; i < N; i++) {
      v.add(addr(i));
    }
    return v.stream().sorted().toList();
  }

  @Test
  void validatorAddressIsKeccakOfFalconPublicKey() {
    final Address expected = Address.wrap(Bytes.wrap(FALCON.get(0).address()));
    assertThat(addr(0)).isEqualTo(expected);
    assertThat(FALCON.get(0).pub().getH()).hasSize(1792);
  }

  @Test
  void prepareMessageRoundTripsAndAuthenticatesAuthor() {
    final PreparePayload payload =
        new PreparePayload(new ConsensusRoundIdentifier(7, 1), Hash.hash(Bytes.of(1, 2, 3)));
    final SECPSignature sig = FalconConsensus.signPayload(NODE_KEYS.get(1), payload);
    assertThat(sig).isInstanceOf(Falcon1024Signature.class);
    final Prepare prepare = new Prepare(SignedData.create(payload, sig));
    final Bytes wire = prepare.encode();
    final Prepare decoded = Prepare.decode(wire);
    assertThat(decoded.getAuthor()).isEqualTo(addr(1));
    assertThat(decoded.getRoundIdentifier()).isEqualTo(new ConsensusRoundIdentifier(7, 1));
    assertThat(wire.size()).isGreaterThan(1792 + 600).isLessThan(4000);
  }

  @Test
  void tamperedPayloadOrSignatureIsRejected() {
    final PreparePayload payload =
        new PreparePayload(new ConsensusRoundIdentifier(7, 1), Hash.hash(Bytes.of(1)));
    final SECPSignature sig = FalconConsensus.signPayload(NODE_KEYS.get(0), payload);
    // signature replayed onto other round / other digest
    assertThatThrownBy(
            () ->
                SignedData.create(
                    new PreparePayload(new ConsensusRoundIdentifier(7, 2), Hash.hash(Bytes.of(1))),
                    sig))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                SignedData.create(
                    new PreparePayload(new ConsensusRoundIdentifier(7, 1), Hash.hash(Bytes.of(2))),
                    sig))
        .isInstanceOf(IllegalArgumentException.class);
    // flip a bit inside the Falcon signature bytes
    final byte[] env = ((Falcon1024Signature) sig).envelope();
    env[env.length - 5] ^= 0x01;
    final SECPSignature bad = Falcon1024Signature.fromEnvelope(env);
    assertThatThrownBy(() -> SignedData.create(payload, bad))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void prepareSignatureCannotBeReplayedAsCommitOrOnOtherChain() {
    final ConsensusRoundIdentifier r = new ConsensusRoundIdentifier(9, 0);
    final Hash digest = Hash.hash(Bytes.of(9));
    final SECPSignature prepSig =
        FalconConsensus.signPayload(NODE_KEYS.get(2), new PreparePayload(r, digest));
    final SECPSignature seal =
        FalconConsensus.signCommitSeal(NODE_KEYS.get(2), 9, 0, Hash.hash(Bytes.of(8)));
    final CommitPayload commit = new CommitPayload(r, digest, seal);
    assertThatThrownBy(() -> SignedData.create(commit, prepSig))
        .isInstanceOf(IllegalArgumentException.class);

    final PreparePayload p = new PreparePayload(r, digest);
    final SECPSignature s = FalconConsensus.signPayload(NODE_KEYS.get(2), p);
    FalconConsensus.enable(CHAIN_ID + 1);
    assertThatThrownBy(() -> SignedData.create(p, s)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void ecdsaConsensusSignaturesAreRejectedInFalconMode() {
    final PreparePayload payload =
        new PreparePayload(new ConsensusRoundIdentifier(3, 0), Hash.hash(Bytes.of(3)));
    final SECPSignature ecdsa =
        NODE_KEYS.get(0).sign(Bytes32.wrap(payload.hashForSignature().getBytes()));
    assertThatThrownBy(() -> SignedData.create(payload, ecdsa))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> FalconConsensus.decodeSignature(ecdsa.encodedBytes()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void commitMessageCarriesFalconSealAndRoundTrips() {
    final ConsensusRoundIdentifier r = new ConsensusRoundIdentifier(11, 0);
    final Hash commitHash = Hash.hash(Bytes.of(11));
    final SECPSignature seal = FalconConsensus.signCommitSeal(NODE_KEYS.get(3), 11, 0, commitHash);
    final CommitPayload payload = new CommitPayload(r, Hash.hash(Bytes.of(12)), seal);
    final Commit commit =
        new Commit(
            SignedData.create(payload, FalconConsensus.signPayload(NODE_KEYS.get(3), payload)));
    final Commit decoded = Commit.decode(commit.encode());
    assertThat(decoded.getAuthor()).isEqualTo(addr(3));
    assertThat(decoded.getCommitSeal()).isEqualTo(seal);
    assertThat(FalconConsensus.commitSealAuthor(decoded.getCommitSeal(), 11, 0, commitHash))
        .isEqualTo(addr(3));
    assertThat(FalconConsensus.commitSealAuthor(decoded.getCommitSeal(), 11, 1, commitHash))
        .isNull();
  }

  private BlockHeader sealedHeader(final long number, final int round, final int... signers) {
    final BftExtraData unsealed =
        new BftExtraData(
            Bytes.wrap(new byte[32]), List.of(), Optional.empty(), round, validators());
    final BlockHeaderTestFixture fixture = new BlockHeaderTestFixture();
    fixture.number(number).extraData(codec.encode(unsealed));
    final BlockHeader unsealedHeader = fixture.buildHeader();
    final Hash sealHash =
        new BftBlockHashing(codec).calculateDataHashForCommittedSeal(unsealedHeader, unsealed);
    final List<SECPSignature> seals = new ArrayList<>();
    for (final int s : signers) {
      seals.add(FalconConsensus.signCommitSeal(NODE_KEYS.get(s), number, round, sealHash));
    }
    final BftExtraData sealed =
        new BftExtraData(Bytes.wrap(new byte[32]), seals, Optional.empty(), round, validators());
    fixture.extraData(codec.encode(sealed));
    return fixture.buildHeader();
  }

  @Test
  void blockHeaderCommittedSealsAreFalconAndRecoverCommitters() {
    final BlockHeader header = sealedHeader(20, 0, 0, 1, 2);
    final BftExtraData decoded = codec.decode(header);
    assertThat(decoded.getSeals()).hasSize(3).allMatch(s -> s instanceof Falcon1024Signature);
    final List<Address> committers = new BftBlockInterface(codec).getCommitters(header);
    assertThat(committers).containsExactlyInAnyOrder(addr(0), addr(1), addr(2));
    assertThat(new BftBlockHashing(codec).recoverCommitterAddresses(header, decoded))
        .containsExactlyInAnyOrder(addr(0), addr(1), addr(2));
    assertThat(header.getExtraData().size()).isGreaterThan(3 * 3000);
  }

  @Test
  void sealsFromOtherHeightAreNotCountedAsCommitters() {
    // Seal produced for block 21 copied into block 22's header
    final BlockHeader h21 = sealedHeader(21, 0, 0);
    final BftExtraData e21 = codec.decode(h21);
    final BftExtraData forged =
        new BftExtraData(
            Bytes.wrap(new byte[32]), e21.getSeals(), Optional.empty(), 0, validators());
    final BlockHeader h22 =
        new BlockHeaderTestFixture().number(22).extraData(codec.encode(forged)).buildHeader();
    assertThat(new BftBlockInterface(codec).getCommitters(h22)).containsOnlyNulls();
  }

  private BlockHeader votingHeader(
      final long number, final Optional<Vote> vote, final int... signers) {
    final BftExtraData unsealed =
        new BftExtraData(Bytes.wrap(new byte[32]), List.of(), vote, 0, validators());
    final BlockHeaderTestFixture fixture = new BlockHeaderTestFixture();
    fixture.number(number).coinbase(addr(signers[0])).extraData(codec.encode(unsealed));
    final Hash sealHash =
        new BftBlockHashing(codec)
            .calculateDataHashForCommittedSeal(fixture.buildHeader(), unsealed);
    final List<SECPSignature> seals = new ArrayList<>();
    for (final int s : signers) {
      seals.add(FalconConsensus.signCommitSeal(NODE_KEYS.get(s), number, 0, sealHash));
    }
    fixture.extraData(
        codec.encode(new BftExtraData(Bytes.wrap(new byte[32]), seals, vote, 0, validators())));
    return fixture.buildHeader();
  }

  private static BlockHeader rebuild(final BlockHeader h, final Bytes extra) {
    return new BlockHeaderTestFixture()
        .number(h.getNumber())
        .coinbase(h.getCoinbase())
        .extraData(extra)
        .buildHeader();
  }

  @Test
  void falconModeIsRefusedOnProductionChain9127() {
    FalconConsensus.reset();
    assertThatThrownBy(() -> FalconConsensus.enable(9127))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("9127");
    assertThat(FalconConsensus.isEnabled()).isFalse();
  }

  @Test
  void validatorVoteIsCoveredByFalconCommitSeals() {
    final Address candidate = Address.fromHexString("0x00000000000000000000000000000000000000aa");
    final BlockHeader header = votingHeader(30, Optional.of(Vote.authVote(candidate)), 0, 1, 2);
    final BftBlockInterface bi = new BftBlockInterface(codec);
    assertThat(bi.getCommitters(header)).containsExactlyInAnyOrder(addr(0), addr(1), addr(2));
    assertThat(bi.extractVoteFromHeader(header)).isPresent();
    assertThat(bi.extractVoteFromHeader(header).get().getRecipient()).isEqualTo(candidate);
    assertThat(bi.extractVoteFromHeader(header).get().isAuthVote()).isTrue();

    // Same seals, vote flipped add->drop, or recipient changed: no seal may verify any more.
    final BftExtraData orig = codec.decode(header);
    for (final Vote forged :
        List.of(
            Vote.dropVote(candidate),
            Vote.authVote(Address.fromHexString("0x00000000000000000000000000000000000000bb")))) {
      final BftExtraData tampered =
          new BftExtraData(
              orig.getVanityData(), orig.getSeals(), Optional.of(forged), 0, validators());
      final BlockHeader h = rebuild(header, codec.encode(tampered));
      assertThat(bi.getCommitters(h)).containsOnlyNulls();
    }
    // Vote removed entirely
    final BftExtraData noVote =
        new BftExtraData(orig.getVanityData(), orig.getSeals(), Optional.empty(), 0, validators());
    assertThat(bi.getCommitters(rebuild(header, codec.encode(noVote)))).containsOnlyNulls();
  }

  @Test
  void sealFromUnregisteredFalconKeyIsNotAValidatorCommitter() throws Exception {
    final Falcon1024KeyFile.KeyPair rogue =
        Falcon1024KeyFile.generate(keyDir.resolve("rogue-" + System.nanoTime() + ".key"));
    final NodeKey rogueNode = NodeKeyUtils.generate();
    FalconConsensus.bindLocalKey(rogueNode, rogue);
    final Address rogueAddr = FalconConsensus.consensusAddress(rogueNode);
    assertThat(validators()).doesNotContain(rogueAddr);
    final BftExtraData unsealed =
        new BftExtraData(Bytes.wrap(new byte[32]), List.of(), Optional.empty(), 0, validators());
    final BlockHeaderTestFixture fixture = new BlockHeaderTestFixture();
    fixture.number(40).extraData(codec.encode(unsealed));
    final Hash sealHash =
        new BftBlockHashing(codec)
            .calculateDataHashForCommittedSeal(fixture.buildHeader(), unsealed);
    final SECPSignature rogueSeal = FalconConsensus.signCommitSeal(rogueNode, 40, 0, sealHash);
    fixture.extraData(
        codec.encode(
            new BftExtraData(
                Bytes.wrap(new byte[32]), List.of(rogueSeal), Optional.empty(), 0, validators())));
    final List<Address> committers =
        new BftBlockInterface(codec).getCommitters(fixture.buildHeader());
    // The seal is cryptographically valid but its author is outside the validator set, so the
    // header validation rule (committers subset of validators) rejects it.
    assertThat(committers).containsExactly(rogueAddr);
    assertThat(validators()).doesNotContainAnyElementsOf(committers);
  }

  @Test
  void sealSignedForAnotherChainIdIsNotCounted() {
    FalconConsensus.enable(CHAIN_ID + 1);
    final BlockHeader foreign = sealedHeader(50, 0, 0, 1, 2);
    FalconConsensus.enable(CHAIN_ID);
    assertThat(new BftBlockInterface(codec).getCommitters(foreign)).containsOnlyNulls();
  }
}
