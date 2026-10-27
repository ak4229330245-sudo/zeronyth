// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Commitment registry for future zk-proof integration.
/// @dev Stores domain-separated commitments only. It does NOT provide zero-knowledge privacy by itself.
contract PrivateCommitment {
    error EmptyCommitment();
    error CommitmentAlreadyUsed();

    mapping(bytes32 => bool) public used;

    event CommitmentPublished(bytes32 indexed commitment, address indexed publisher);

    function commitmentFor(address publisher, bytes32 payloadHash, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), publisher, payloadHash, salt));
    }

    function publish(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (used[commitment]) revert CommitmentAlreadyUsed();
        used[commitment] = true;
        emit CommitmentPublished(commitment, msg.sender);
    }
}
