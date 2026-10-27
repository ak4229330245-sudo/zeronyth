// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title BridgeAttestationBoard (ZERONYTH testnet, chain 9127) — TESTNET ONLY, NOT AUDITED
/// @notice Public, coordinator-free gossip for bridge relayer signatures. Every relayer posts its own ECDSA (+ ML-DSA-65)
/// signature over a transfer digest here; ANY relayer (or anyone) can read the Attested events, pick `threshold`
/// signatures from the current on-chain relayer set and submit the mint/release itself. The board holds no funds and
/// grants no rights: the vault / minters still verify every signature against their own relayer set.
/// The poster must be the ECDSA signer, so an Attested event is always attributable to the key that signed.
/// Operators also announce themselves here (label, machine, ML-DSA-65 public key) — the registration step for joining.
contract BridgeAttestationBoard {
    struct Operator { string label; string machine; bytes32 mldsaPkHash; uint64 registeredAt; uint64 updatedAt; }

    mapping(address => Operator) public operators;
    address[] internal _registered;
    mapping(bytes32 => mapping(address => bool)) public attested; // digest => signer => posted

    event Attested(bytes32 indexed digest, address indexed signer, bytes ecdsaSig, bytes mldsaSig);
    event OperatorRegistered(address indexed relayer, string label, string machine, bytes mldsaPublicKey);

    error BadSignature();
    error AlreadyAttested();
    error BadOperator();

    /// @param ecdsaSig EIP-191 signature of `digest` by msg.sender; @param mldsaSig ML-DSA-65 signature (audit, off-chain verified)
    function attest(bytes32 digest, bytes calldata ecdsaSig, bytes calldata mldsaSig) external {
        if (ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), ecdsaSig) != msg.sender) revert BadSignature();
        if (attested[digest][msg.sender]) revert AlreadyAttested();
        attested[digest][msg.sender] = true;
        emit Attested(digest, msg.sender, ecdsaSig, mldsaSig);
    }

    /// @notice Register / update the caller as a relayer operator candidate. Being registered does NOT make a key a
    /// relayer: the relayer set of each contract changes only through its owner (a 24h TimelockController).
    function registerOperator(string calldata label, string calldata machine, bytes calldata mldsaPublicKey) external {
        if (bytes(label).length == 0 || bytes(label).length > 64 || bytes(machine).length > 64 || mldsaPublicKey.length != 1952) revert BadOperator();
        Operator storage o = operators[msg.sender];
        if (o.registeredAt == 0) { o.registeredAt = uint64(block.timestamp); _registered.push(msg.sender); }
        o.label = label; o.machine = machine; o.mldsaPkHash = sha256(mldsaPublicKey); o.updatedAt = uint64(block.timestamp);
        emit OperatorRegistered(msg.sender, label, machine, mldsaPublicKey);
    }

    function registered() external view returns (address[] memory) { return _registered; }
}
