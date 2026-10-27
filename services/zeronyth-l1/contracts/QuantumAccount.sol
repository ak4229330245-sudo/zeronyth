// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title QuantumAccount
/// @notice Hybrid-ready account metadata and delayed guardian recovery example.
/// @dev PQC verification is intentionally externalized until an audited verifier/precompile exists.
///      This contract does not make ordinary EVM transactions quantum-resistant by itself.
contract QuantumAccount {
    error NotOwner();
    error NotGuardian();
    error ZeroAddress();
    error InvalidThreshold();
    error DuplicateGuardian();
    error InvalidRecovery();
    error AlreadyApproved();
    error NotEnoughApprovals();
    error DelayActive();
    error InvalidDelay();
    error EmptyPQCKeyHash();
    error SameOwner();
    error OwnerCannotBeGuardian();

    address public owner;
    bytes32 public pqcPublicKeyHash;
    uint64 public recoveryDelay;
    uint256 public recoveryNonce;
    uint256 public ownerEpoch;
    uint256 public recoveryConfigEpoch;

    mapping(address => bool) public guardian;
    uint256 public guardianCount;
    uint256 public threshold;

    struct Recovery {
        address proposedOwner;
        bytes32 proposedPQCKeyHash;
        uint64 executableAt;
        uint256 approvals;
        uint256 ownerEpoch;
        uint256 recoveryConfigEpoch;
        bool executed;
        bool cancelled;
    }

    mapping(uint256 => Recovery) public recoveries;
    mapping(uint256 => mapping(address => bool)) public approved;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event PQCKeyRotated(bytes32 indexed oldHash, bytes32 indexed newHash);
    event GuardianUpdated(address indexed guardian, bool enabled);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event RecoveryDelayUpdated(uint64 oldDelay, uint64 newDelay);
    event RecoveryStarted(
        uint256 indexed id,
        address indexed proposedOwner,
        bytes32 indexed proposedPQCKeyHash,
        uint64 executableAt
    );
    event RecoveryApproved(uint256 indexed id, address indexed guardian);
    event RecoveryCancelled(uint256 indexed id);
    event RecoveryExecuted(uint256 indexed id, address indexed newOwner, bytes32 indexed newPQCKeyHash);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender == owner || !guardian[msg.sender]) revert NotGuardian();
        _;
    }

    constructor(
        address _owner,
        bytes32 _pqcPublicKeyHash,
        address[] memory guardians,
        uint256 _threshold,
        uint64 _delay
    ) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_pqcPublicKeyHash == bytes32(0)) revert EmptyPQCKeyHash();
        if (_threshold == 0 || _threshold > guardians.length) revert InvalidThreshold();
        if (_delay == 0) revert InvalidDelay();

        owner = _owner;
        pqcPublicKeyHash = _pqcPublicKeyHash;
        threshold = _threshold;
        recoveryDelay = _delay;

        for (uint256 i = 0; i < guardians.length; i++) {
            address g = guardians[i];
            if (g == address(0)) revert ZeroAddress();
            if (g == _owner) revert OwnerCannotBeGuardian();
            if (guardian[g]) revert DuplicateGuardian();
            guardian[g] = true;
            guardianCount++;
            emit GuardianUpdated(g, true);
        }
    }

    /// @notice Transfer control and rotate the PQC metadata commitment atomically.
    function transferOwnership(address newOwner, bytes32 newPQCKeyHash) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner) revert SameOwner();
        if (guardian[newOwner]) revert OwnerCannotBeGuardian();
        if (newPQCKeyHash == bytes32(0)) revert EmptyPQCKeyHash();

        address oldOwner = owner;
        bytes32 oldPQCKeyHash = pqcPublicKeyHash;
        owner = newOwner;
        pqcPublicKeyHash = newPQCKeyHash;
        ownerEpoch++;

        emit OwnershipTransferred(oldOwner, newOwner);
        emit PQCKeyRotated(oldPQCKeyHash, newPQCKeyHash);
    }

    function rotatePQCKey(bytes32 newHash) external onlyOwner {
        if (newHash == bytes32(0)) revert EmptyPQCKeyHash();
        bytes32 old = pqcPublicKeyHash;
        pqcPublicKeyHash = newHash;
        emit PQCKeyRotated(old, newHash);
    }

    function setGuardian(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (account == owner) revert OwnerCannotBeGuardian();
        if (guardian[account] == enabled) return;

        if (enabled) {
            guardian[account] = true;
            guardianCount++;
        } else {
            uint256 nextCount = guardianCount - 1;
            if (threshold > nextCount) revert InvalidThreshold();
            guardian[account] = false;
            guardianCount = nextCount;
        }

        recoveryConfigEpoch++;
        emit GuardianUpdated(account, enabled);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > guardianCount) revert InvalidThreshold();
        if (newThreshold == threshold) return;
        uint256 old = threshold;
        threshold = newThreshold;
        recoveryConfigEpoch++;
        emit ThresholdUpdated(old, newThreshold);
    }

    function setRecoveryDelay(uint64 newDelay) external onlyOwner {
        if (newDelay == 0) revert InvalidDelay();
        if (newDelay == recoveryDelay) return;
        uint64 old = recoveryDelay;
        recoveryDelay = newDelay;
        recoveryConfigEpoch++;
        emit RecoveryDelayUpdated(old, newDelay);
    }

    function startRecovery(address proposedOwner, bytes32 proposedPQCKeyHash) external onlyGuardian returns (uint256 id) {
        if (proposedOwner == address(0)) revert ZeroAddress();
        if (proposedOwner == owner) revert SameOwner();
        if (guardian[proposedOwner]) revert OwnerCannotBeGuardian();
        if (proposedPQCKeyHash == bytes32(0)) revert EmptyPQCKeyHash();

        id = ++recoveryNonce;
        uint64 executableAt = uint64(block.timestamp) + recoveryDelay;
        recoveries[id] = Recovery({
            proposedOwner: proposedOwner,
            proposedPQCKeyHash: proposedPQCKeyHash,
            executableAt: executableAt,
            approvals: 1,
            ownerEpoch: ownerEpoch,
            recoveryConfigEpoch: recoveryConfigEpoch,
            executed: false,
            cancelled: false
        });
        approved[id][msg.sender] = true;
        emit RecoveryStarted(id, proposedOwner, proposedPQCKeyHash, executableAt);
        emit RecoveryApproved(id, msg.sender);
    }

    function approveRecovery(uint256 id) external onlyGuardian {
        Recovery storage r = _activeRecovery(id);
        if (approved[id][msg.sender]) revert AlreadyApproved();
        approved[id][msg.sender] = true;
        r.approvals++;
        emit RecoveryApproved(id, msg.sender);
    }

    function cancelRecovery(uint256 id) external onlyOwner {
        Recovery storage r = recoveries[id];
        if (r.proposedOwner == address(0) || r.executed || r.cancelled) revert InvalidRecovery();
        r.cancelled = true;
        emit RecoveryCancelled(id);
    }

    function executeRecovery(uint256 id) external {
        Recovery storage r = _activeRecovery(id);
        if (r.approvals < threshold) revert NotEnoughApprovals();
        if (block.timestamp < r.executableAt) revert DelayActive();

        r.executed = true;
        address oldOwner = owner;
        bytes32 oldPQCKeyHash = pqcPublicKeyHash;
        owner = r.proposedOwner;
        pqcPublicKeyHash = r.proposedPQCKeyHash;
        ownerEpoch++;

        emit OwnershipTransferred(oldOwner, owner);
        emit PQCKeyRotated(oldPQCKeyHash, pqcPublicKeyHash);
        emit RecoveryExecuted(id, owner, pqcPublicKeyHash);
    }

    function isRecoveryActive(uint256 id) external view returns (bool) {
        Recovery storage r = recoveries[id];
        return r.proposedOwner != address(0)
            && !r.executed
            && !r.cancelled
            && r.ownerEpoch == ownerEpoch
            && r.recoveryConfigEpoch == recoveryConfigEpoch;
    }

    function _activeRecovery(uint256 id) internal view returns (Recovery storage r) {
        r = recoveries[id];
        if (
            r.proposedOwner == address(0)
                || r.executed
                || r.cancelled
                || r.ownerEpoch != ownerEpoch
                || r.recoveryConfigEpoch != recoveryConfigEpoch
        ) revert InvalidRecovery();
    }
}
