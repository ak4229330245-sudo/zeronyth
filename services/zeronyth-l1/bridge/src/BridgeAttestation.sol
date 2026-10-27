// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title BridgeAttestation
/// @notice Shared message format + M-of-N relayer ECDSA check used by both bridge sides.
/// Every relayer ALSO signs the same digest with ML-DSA-65 off-chain; those post-quantum signatures are kept in a public
/// log (EVM chains cannot cheaply verify ML-DSA, so they are NOT checked on-chain).
/// digest = keccak256(abi.encode(TAG, srcChainId, srcContract, dstChainId, dstContract, nonce, recipient, amount))
/// signed as an EIP-191 personal message. srcChainId/dstChainId/contracts/nonce give replay protection across chains,
/// contracts and transfers.
abstract contract BridgeAttestation {
    bytes32 public constant TAG = keccak256("ZERONYTH_BRIDGE_V1");
    uint256 public constant MAX_RELAYERS = 16;

    mapping(address => bool) public isRelayer;
    address[] internal _relayers;
    uint256 public threshold;

    event RelayersSet(address[] relayers, uint256 threshold);

    error BadRelayerConfig();
    error NotEnoughSignatures();
    error SignerNotRelayer(address signer);
    error SignersNotSorted();

    function relayers() external view returns (address[] memory) { return _relayers; }

    function attestationDigest(uint256 srcChainId, address srcContract, uint256 dstChainId, address dstContract,
        uint256 nonce, bytes32 recipient, uint256 amount) public pure returns (bytes32) {
        return keccak256(abi.encode(TAG, srcChainId, srcContract, dstChainId, dstContract, nonce, recipient, amount));
    }

    function _setRelayers(address[] memory list, uint256 newThreshold) internal {
        if (list.length == 0 || list.length > MAX_RELAYERS || newThreshold == 0 || newThreshold > list.length) revert BadRelayerConfig();
        // a majority is required so that a single key can never attest alone (testnet: 2-of-3)
        if (newThreshold * 2 <= list.length) revert BadRelayerConfig();
        for (uint256 i; i < _relayers.length; ++i) isRelayer[_relayers[i]] = false;
        delete _relayers;
        for (uint256 i; i < list.length; ++i) {
            address r = list[i];
            if (r == address(0) || isRelayer[r]) revert BadRelayerConfig();
            isRelayer[r] = true;
            _relayers.push(r);
        }
        threshold = newThreshold;
        emit RelayersSet(list, newThreshold);
    }

    /// @dev signatures must come from distinct relayers, ordered by strictly ascending signer address.
    function _checkSignatures(bytes32 digest, bytes[] calldata sigs) internal view {
        if (sigs.length < threshold) revert NotEnoughSignatures();
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(digest);
        address last;
        for (uint256 i; i < sigs.length; ++i) {
            address s = ECDSA.recover(h, sigs[i]);
            if (s <= last) revert SignersNotSorted();
            if (!isRelayer[s]) revert SignerNotRelayer(s);
            last = s;
        }
    }
}
