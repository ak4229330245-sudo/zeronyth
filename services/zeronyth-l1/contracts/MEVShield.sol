// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Commit/reveal primitive that hides intent until reveal.
/// @dev This is not a full encrypted mempool or proposer/builder MEV solution.
contract MEVShield {
    error BadWindow();
    error EmptyCommitment();
    error CommitmentExists();
    error NoCommitment();
    error TooEarly();
    error Expired();

    mapping(address => mapping(bytes32 => uint64)) public committedAt;
    uint64 public immutable minDelay;
    uint64 public immutable maxDelay;

    event Committed(address indexed sender, bytes32 indexed commitment, uint64 atBlock);
    event Revealed(address indexed sender, bytes32 indexed commitment, bytes payload);
    event CommitmentCancelled(address indexed sender, bytes32 indexed commitment);
    event ExpiredCommitmentCleared(address indexed sender, bytes32 indexed commitment);

    constructor(uint64 _minDelay, uint64 _maxDelay) {
        if (_minDelay == 0 || _maxDelay <= _minDelay) revert BadWindow();
        minDelay = _minDelay;
        maxDelay = _maxDelay;
    }

    function commitmentFor(address sender, bytes calldata payload, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), sender, payload, salt));
    }

    function commit(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (committedAt[msg.sender][commitment] != 0) revert CommitmentExists();
        committedAt[msg.sender][commitment] = uint64(block.number);
        emit Committed(msg.sender, commitment, uint64(block.number));
    }

    function reveal(bytes calldata payload, bytes32 salt) external {
        bytes32 commitment = commitmentFor(msg.sender, payload, salt);
        uint64 committedBlock = committedAt[msg.sender][commitment];
        if (committedBlock == 0) revert NoCommitment();
        if (block.number < committedBlock + minDelay) revert TooEarly();
        if (block.number > committedBlock + maxDelay) revert Expired();

        delete committedAt[msg.sender][commitment];
        emit Revealed(msg.sender, commitment, payload);
    }

    function cancel(bytes32 commitment) external {
        if (committedAt[msg.sender][commitment] == 0) revert NoCommitment();
        delete committedAt[msg.sender][commitment];
        emit CommitmentCancelled(msg.sender, commitment);
    }

    function clearExpired(bytes32 commitment) external {
        uint64 committedBlock = committedAt[msg.sender][commitment];
        if (committedBlock == 0) revert NoCommitment();
        if (block.number <= committedBlock + maxDelay) revert TooEarly();
        delete committedAt[msg.sender][commitment];
        emit ExpiredCommitmentCleared(msg.sender, commitment);
    }
}
