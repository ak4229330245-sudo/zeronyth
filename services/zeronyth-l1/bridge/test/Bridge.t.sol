// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ZnytBridgeVault} from "../src/ZnytBridgeVault.sol";
import {BridgeMinter} from "../src/BridgeMinter.sol";
import {WrappedZnyt} from "../src/WrappedZnyt.sol";
import {BridgeAttestation} from "../src/BridgeAttestation.sol";
import {DailyCaps} from "../src/DailyCaps.sol";

contract Rejecter { receive() external payable { revert(); } }

/// Both bridge sides are exercised in one EVM by switching block.chainid (9127 <-> 84532 / 421614).
contract BridgeTest is Test {
    uint256 constant ZNYT = 9127;
    uint256 constant BASE = 84532;
    uint256 constant ARB = 421614;
    uint256[3] pks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA11)];
    address[] rel;
    address owner = address(0x0A);
    address guardian = address(0x6A);
    address alice = address(0xA1);
    ZnytBridgeVault vault;
    BridgeMinter minter;   // "Base Sepolia"
    WrappedZnyt w;

    function setUp() public {
        for (uint256 i; i < 3; ++i) rel.push(vm.addr(pks[i]));
        // sort relayer list ascending (signatures must be sorted by signer)
        for (uint256 i; i < 3; ++i) for (uint256 j = i + 1; j < 3; ++j) if (rel[j] < rel[i]) { (rel[i], rel[j]) = (rel[j], rel[i]); (pks[i], pks[j]) = (pks[j], pks[i]); }
        vm.chainId(ZNYT);
        vault = new ZnytBridgeVault(owner, guardian, rel, 2);
        bytes32 salt = keccak256("ZERONYTH_BRIDGE_V1/minter");
        vm.chainId(BASE);
        minter = new BridgeMinter{salt: salt}(owner, guardian, rel, 2, ZNYT, address(vault), 0.01 ether, 10_000 ether, 100_000 ether);
        w = minter.token();
        vm.chainId(ZNYT);
        vm.startPrank(owner);
        vault.setChain(BASE, true, address(minter), 0.01 ether, 10_000 ether, 100_000 ether);
        vm.stopPrank();
        vm.deal(alice, 1_000_000 ether);
    }

    function _sigs(bytes32 digest, uint256 a, uint256 b) internal view returns (bytes[] memory s) {
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(digest);
        s = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pks[a], h); s[0] = abi.encodePacked(r, ss, v);
        (v, r, ss) = vm.sign(pks[b], h); s[1] = abi.encodePacked(r, ss, v);
    }
    function _r(address a) internal pure returns (bytes32) { return bytes32(uint256(uint160(a))); }

    function _lockAndMint(uint256 amount) internal returns (uint256 n) {
        vm.chainId(ZNYT);
        vm.prank(alice);
        n = vault.lock{value: amount}(BASE, _r(alice));
        vm.chainId(BASE);
        bytes32 d = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), amount);
        minter.mint(n, _r(alice), amount, _sigs(d, 0, 1));
    }

    function test_roundTrip() public {
        uint256 n = _lockAndMint(100 ether);
        assertEq(w.balanceOf(alice), 100 ether);
        assertEq(vault.totalLocked(), 100 ether);
        assertEq(vault.outstanding(BASE), 100 ether);
        assertEq(address(vault).balance, 100 ether);
        // burn back 40
        vm.prank(alice);
        uint256 bn = minter.burn(40 ether, alice);
        assertEq(w.totalSupply(), 60 ether);
        vm.chainId(ZNYT);
        uint256 before = alice.balance;
        bytes32 d = vault.attestationDigest(BASE, address(minter), ZNYT, address(vault), bn, _r(alice), 40 ether);
        vault.release(BASE, bn, alice, 40 ether, _sigs(d, 1, 2));
        assertEq(alice.balance - before, 40 ether);
        assertEq(vault.totalLocked(), 60 ether);
        assertEq(vault.outstanding(BASE), 60 ether);
        assertEq(n, 0);
        // invariant: supply on Base <= outstanding towards Base
        assertLe(w.totalSupply(), vault.outstanding(BASE));
    }

    function test_replayMintRejected() public {
        uint256 n = _lockAndMint(5 ether);
        bytes32 d = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 5 ether);
        bytes[] memory s = _sigs(d, 0, 1);
        vm.expectRevert(BridgeMinter.AlreadyProcessed.selector);
        minter.mint(n, _r(alice), 5 ether, s);
    }

    function test_replayReleaseRejected() public {
        _lockAndMint(5 ether);
        vm.prank(alice); uint256 bn = minter.burn(1 ether, alice);
        vm.chainId(ZNYT);
        bytes32 d = vault.attestationDigest(BASE, address(minter), ZNYT, address(vault), bn, _r(alice), 1 ether);
        bytes[] memory s = _sigs(d, 0, 2);
        vault.release(BASE, bn, alice, 1 ether, s);
        vm.expectRevert(ZnytBridgeVault.AlreadyProcessed.selector);
        vault.release(BASE, bn, alice, 1 ether, s);
    }

    function test_crossChainReplayRejected() public {
        // On real chains the minter has the SAME address everywhere (CREATE2), so the attestation must bind dstChainId:
        // a valid Base attestation replayed on another chain id (same contract address) must fail.
        vm.chainId(ZNYT);
        vm.prank(alice); uint256 n = vault.lock{value: 3 ether}(BASE, _r(alice));
        bytes32 dBase = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 3 ether);
        bytes[] memory s = _sigs(dBase, 0, 1);
        vm.chainId(ARB);
        vm.expectRevert(); // recovers to a non-relayer because block.chainid differs
        minter.mint(n, _r(alice), 3 ether, s);
        vm.chainId(BASE);
        minter.mint(n, _r(alice), 3 ether, s); // the same signatures are valid on the intended chain
        assertEq(w.balanceOf(alice), 3 ether);
    }

    function test_wrongSignerRejected() public {
        vm.chainId(ZNYT);
        vm.prank(alice); uint256 n = vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.chainId(BASE);
        bytes32 d = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 1 ether);
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(d);
        uint256 evil = 0xBAD;
        bytes[] memory s = _sigs(d, 0, 1);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(evil, h);
        address evilAddr = vm.addr(evil);
        // put the evil signature in the sorted position
        if (evilAddr > rel[0]) s[1] = abi.encodePacked(r, ss, v); else s[0] = abi.encodePacked(r, ss, v);
        vm.expectRevert(abi.encodeWithSelector(BridgeAttestation.SignerNotRelayer.selector, evilAddr));
        minter.mint(n, _r(alice), 1 ether, s);
    }

    function test_duplicateOrSingleSignerRejected() public {
        vm.chainId(ZNYT);
        vm.prank(alice); uint256 n = vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.chainId(BASE);
        bytes32 d = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 1 ether);
        vm.expectRevert(BridgeAttestation.SignersNotSorted.selector);
        minter.mint(n, _r(alice), 1 ether, _sigs(d, 0, 0));
        bytes[] memory one = new bytes[](1);
        one[0] = _sigs(d, 0, 1)[0];
        vm.expectRevert(BridgeAttestation.NotEnoughSignatures.selector);
        minter.mint(n, _r(alice), 1 ether, one);
    }

    function test_tamperedAmountRejected() public {
        vm.chainId(ZNYT);
        vm.prank(alice); uint256 n = vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.chainId(BASE);
        bytes32 d = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 1 ether);
        bytes[] memory s = _sigs(d, 0, 1);
        vm.expectRevert();
        minter.mint(n, _r(alice), 2 ether, s);
    }

    function test_caps() public {
        vm.chainId(ZNYT);
        vm.startPrank(alice);
        vm.expectRevert(ZnytBridgeVault.BadAmount.selector);
        vault.lock{value: 10_001 ether}(BASE, _r(alice));
        vm.expectRevert(ZnytBridgeVault.BadAmount.selector);
        vault.lock{value: 0.001 ether}(BASE, _r(alice));
        for (uint256 i; i < 10; ++i) vault.lock{value: 10_000 ether}(BASE, _r(alice));
        vm.expectRevert(abi.encodeWithSelector(DailyCaps.DailyCapExceeded.selector, BASE, 100_001 ether, 100_000 ether));
        vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.warp(block.timestamp + 1 days);
        vault.lock{value: 1 ether}(BASE, _r(alice)); // next day ok
        vm.expectRevert(abi.encodeWithSelector(ZnytBridgeVault.UnknownChain.selector, ARB));
        vault.lock{value: 1 ether}(ARB, _r(alice));
        vm.stopPrank();
    }

    function test_releaseCannotExceedOutstanding() public {
        _lockAndMint(2 ether);
        vm.chainId(ZNYT);
        // relayers (even if all colluded) cannot release more than was locked towards this chain
        bytes32 d = vault.attestationDigest(BASE, address(minter), ZNYT, address(vault), 77, _r(alice), 3 ether);
        bytes[] memory s = _sigs(d, 0, 1);
        vm.expectRevert(ZnytBridgeVault.ExceedsOutstanding.selector);
        vault.release(BASE, 77, alice, 3 ether, s);
    }

    function test_pause() public {
        vm.chainId(ZNYT);
        vm.expectRevert(ZnytBridgeVault.NotGuardian.selector);
        vm.prank(alice); vault.pause();
        vm.prank(guardian); vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice); vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.expectRevert(); // guardian cannot unpause
        vm.prank(guardian); vault.unpause();
        vm.prank(owner); vault.unpause();
        vm.prank(alice); vault.lock{value: 1 ether}(BASE, _r(alice));
        vm.chainId(BASE);
        vm.prank(guardian); minter.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        minter.mint(0, _r(alice), 1 ether, new bytes[](0));
    }

    function test_onlyMinterCanMint() public {
        vm.expectRevert(WrappedZnyt.OnlyMinter.selector);
        w.mint(alice, 1);
        vm.expectRevert(WrappedZnyt.OnlyMinter.selector);
        w.burnFrom(alice, 1);
        assertEq(w.decimals(), 18);
        assertEq(w.symbol(), "wZNYT");
    }

    function test_minterAddressFixed() public {
        vm.chainId(ZNYT);
        vm.prank(owner);
        vm.expectRevert(ZnytBridgeVault.BadRecipient.selector);
        vault.setChain(BASE, true, address(0xdead), 1, 2, 3);
        vm.prank(alice);
        vm.expectRevert();
        vault.setChain(ARB, true, address(0xdead), 1, 2, 3);
    }

    function test_plainTransferRejectedAndPendingWithdraw() public {
        vm.chainId(ZNYT);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        // a recipient that rejects ZNYT gets a pull-credit instead of blocking the release
        Rejecter rj = new Rejecter();
        _lockAndMint(1 ether);
        vm.chainId(BASE);
        vm.prank(alice); uint256 bn = minter.burn(1 ether, address(rj));
        vm.chainId(ZNYT);
        bytes32 d = vault.attestationDigest(BASE, address(minter), ZNYT, address(vault), bn, _r(address(rj)), 1 ether);
        vault.release(BASE, bn, address(rj), 1 ether, _sigs(d, 0, 1));
        assertEq(vault.pendingWithdrawals(address(rj)), 1 ether);
    }

    function test_relayerConfigNeedsMajority() public {
        address[] memory l = new address[](3);
        (l[0], l[1], l[2]) = (address(1), address(2), address(3));
        vm.prank(owner);
        vm.expectRevert(BridgeAttestation.BadRelayerConfig.selector);
        vault.setRelayers(l, 1);
    }

    function testFuzz_invariantSupplyLeLocked(uint96 a, uint96 b) public {
        uint256 amt = bound(uint256(a), 0.01 ether, 10_000 ether);
        _lockAndMint(amt);
        uint256 back = bound(uint256(b), 0.01 ether, amt);
        vm.prank(alice); minter.burn(back, alice);
        assertLe(w.totalSupply(), vault.outstanding(BASE));
        assertEq(vault.totalLocked(), address(vault).balance);
    }
}
