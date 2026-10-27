// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ZnytBridgeVault} from "../src/ZnytBridgeVault.sol";
import {BridgeMinter} from "../src/BridgeMinter.sol";
import {BridgeAttestation} from "../src/BridgeAttestation.sol";
import {BridgeAttestationBoard} from "../src/BridgeAttestationBoard.sol";
import {BridgeTimelock} from "../src/BridgeTimelock.sol";

/// 3-of-4 relayer set, coordinator-free signature board, and the 24h timelock handover of owner rights.
contract DecentralTest is Test {
    uint256 constant ZNYT = 9127;
    uint256 constant BASE = 84532;
    uint256[4] pks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA11), uint256(0xD00D)];
    address[] rel;
    address admin = address(0x0A);
    address guardian = address(0x6A);
    address alice = address(0xA1);
    ZnytBridgeVault vault;
    BridgeMinter minter;
    BridgeAttestationBoard board;
    BridgeTimelock tl;

    function setUp() public {
        vm.warp(1_793_000_000);
        for (uint256 i; i < 4; ++i) rel.push(vm.addr(pks[i]));
        for (uint256 i; i < 4; ++i) for (uint256 j = i + 1; j < 4; ++j) if (rel[j] < rel[i]) { (rel[i], rel[j]) = (rel[j], rel[i]); (pks[i], pks[j]) = (pks[j], pks[i]); }
        address[] memory old = new address[](3); old[0] = rel[0]; old[1] = rel[1]; old[2] = rel[2];
        vm.chainId(ZNYT);
        vault = new ZnytBridgeVault(admin, guardian, old, 2);
        board = new BridgeAttestationBoard();
        vm.chainId(BASE);
        minter = new BridgeMinter(admin, guardian, old, 2, ZNYT, address(vault), 0.01 ether, 10_000 ether, 100_000 ether);
        vm.chainId(ZNYT);
        vm.startPrank(admin);
        vault.setChain(BASE, true, address(minter), 0.01 ether, 10_000 ether, 100_000 ether);
        vault.setRelayers(rel, 3);         // rotation 2-of-3 -> 3-of-4 (done by admin before the handover)
        minter.setRelayers(rel, 3);
        vm.stopPrank();
        vm.deal(alice, 1000 ether);
        // timelock: proposer admin, executor anyone, no admin role; handover batch at delay 0, then 24h
        address[] memory p = new address[](1); p[0] = admin;
        address[] memory e = new address[](1); e[0] = address(0);
        tl = new BridgeTimelock(0, p, e, address(0));
        vm.prank(admin); vault.transferOwnership(address(tl));
        address[] memory t = new address[](3); t[0] = address(tl); t[1] = address(vault); t[2] = address(tl);
        bytes[] memory d = new bytes[](3);
        d[0] = abi.encodeCall(tl.grantRole, (tl.CANCELLER_ROLE(), guardian));
        d[1] = abi.encodeWithSignature("acceptOwnership()");
        d[2] = abi.encodeCall(tl.updateDelay, (1 days));
        uint256[] memory v = new uint256[](3);
        vm.prank(admin); tl.scheduleBatch(t, v, d, 0, keccak256("handover"), 0);
        tl.executeBatch(t, v, d, 0, keccak256("handover")); // executor = anyone
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }
    function _r(address a) internal pure returns (bytes32) { return bytes32(uint256(uint160(a))); }

    function test_handoverState() public view {
        assertEq(vault.owner(), address(tl));
        assertEq(tl.getMinDelay(), 1 days);
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), guardian));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), admin));
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), address(0)));
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(vault.threshold(), 3);
    }

    function test_threeOfFourAndBoardGossip() public {
        vm.prank(alice); uint256 n = vault.lock{value: 1 ether}(BASE, _r(alice));
        bytes32 dg = vault.attestationDigest(ZNYT, address(vault), BASE, address(minter), n, _r(alice), 1 ether);
        // relayers post to the board themselves; poster must be the signer
        for (uint256 i; i < 3; ++i) { vm.prank(rel[i]); board.attest(dg, _sig(pks[i], dg), hex"01"); }
        vm.prank(rel[3]); vm.expectRevert(BridgeAttestationBoard.BadSignature.selector); board.attest(dg, _sig(pks[0], dg), "");
        vm.prank(rel[0]); vm.expectRevert(BridgeAttestationBoard.AlreadyAttested.selector); board.attest(dg, _sig(pks[0], dg), "");
        vm.chainId(BASE);
        bytes[] memory two = new bytes[](2); two[0] = _sig(pks[0], dg); two[1] = _sig(pks[1], dg);
        vm.expectRevert(BridgeAttestation.NotEnoughSignatures.selector); minter.mint(n, _r(alice), 1 ether, two);
        bytes[] memory three = new bytes[](3); three[0] = _sig(pks[1], dg); three[1] = _sig(pks[2], dg); three[2] = _sig(pks[3], dg);
        vm.prank(address(0xBEEF)); minter.mint(n, _r(alice), 1 ether, three); // any address can submit
        assertEq(minter.token().balanceOf(alice), 1 ether);
    }

    function test_registerOperator() public {
        vm.prank(rel[0]); board.registerOperator("ZeroLayer box r0", "box", new bytes(1952));
        assertEq(board.registered().length, 1);
        vm.expectRevert(BridgeAttestationBoard.BadOperator.selector); board.registerOperator("x", "y", new bytes(10));
    }

    function test_adminCannotActInstantly() public {
        address[] memory two = new address[](3); two[0] = address(1); two[1] = address(2); two[2] = address(3);
        vm.prank(admin); vm.expectRevert(); vault.setRelayers(two, 2);
        bytes memory call = abi.encodeCall(vault.setRelayers, (two, 2));
        vm.prank(admin); tl.schedule(address(vault), 0, call, 0, bytes32("swap"), 1 days);
        vm.expectRevert(); tl.execute(address(vault), 0, call, 0, bytes32("swap"));
        vm.warp(block.timestamp + 1 days);
        tl.execute(address(vault), 0, call, 0, bytes32("swap"));
        assertEq(vault.threshold(), 2);
    }

    function test_guardianVetoAndInstantPause() public {
        address[] memory two = new address[](3); two[0] = address(1); two[1] = address(2); two[2] = address(3);
        bytes memory call = abi.encodeCall(vault.setRelayers, (two, 2));
        vm.prank(admin); tl.schedule(address(vault), 0, call, 0, bytes32("evil"), 1 days);
        bytes32 id = tl.hashOperation(address(vault), 0, call, 0, bytes32("evil"));
        vm.prank(guardian); tl.cancel(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(); tl.execute(address(vault), 0, call, 0, bytes32("evil"));
        vm.prank(guardian); vault.pause();
        assertTrue(vault.paused());
        vm.prank(admin); vm.expectRevert(); vault.unpause();
        bytes memory up = abi.encodeCall(vault.unpause, ());
        vm.prank(admin); tl.schedule(address(vault), 0, up, 0, bytes32("unpause"), 1 days);
        vm.warp(block.timestamp + 1 days);
        tl.execute(address(vault), 0, up, 0, bytes32("unpause"));
        assertFalse(vault.paused());
    }

    function test_delayCannotBeShortenedByProposer() public {
        vm.prank(admin); vm.expectRevert(); tl.updateDelay(0);
        bytes memory call = abi.encodeCall(tl.updateDelay, (0));
        vm.prank(admin); vm.expectRevert(); tl.schedule(address(tl), 0, call, 0, 0, 1 hours); // below min delay
    }
}
