// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RewardPool
/// @notice Receives the validator share (default 80%) of gas fees and splits every deposit equally among
///         the current QBFT validator set (mirrored here by the admin/coordinator from
///         qbft_getValidatorsByBlockNumber). Anyone may trigger claim(v); funds always go to v.
contract RewardPool {
    error NotAdmin();
    error EmptySet();
    error Duplicate();
    error NothingToClaim();
    error TransferFailed();

    address public admin;
    address[] private validators;
    mapping(address => bool) public isValidator;
    uint256 public accPerValidator;      // cumulative wei per validator slot
    mapping(address => uint256) public debt;     // accPerValidator at last checkpoint
    mapping(address => uint256) public credited; // settled, unclaimed
    uint256 public dust;                 // remainder not divisible by n, carried to next deposit
    uint256 public totalReceived;
    uint256 public totalClaimed;

    event Deposit(address indexed from, uint256 amount, uint256 perValidator);
    event ValidatorsSet(address[] validators);
    event Claimed(address indexed validator, uint256 amount);

    constructor(address[] memory initial) {
        admin = msg.sender;
        _set(initial);
    }

    receive() external payable {
        totalReceived += msg.value;
        uint256 n = validators.length;
        uint256 total = msg.value + dust;
        uint256 per = total / n;
        dust = total - per * n;
        accPerValidator += per;
        emit Deposit(msg.sender, msg.value, per);
    }

    function setValidators(address[] calldata next) external {
        if (msg.sender != admin) revert NotAdmin();
        for (uint256 i = 0; i < validators.length; i++) {
            address v = validators[i];
            credited[v] += accPerValidator - debt[v];
            isValidator[v] = false;
        }
        _set(next);
    }

    function _set(address[] memory next) private {
        if (next.length == 0) revert EmptySet();
        delete validators;
        for (uint256 i = 0; i < next.length; i++) {
            if (isValidator[next[i]]) revert Duplicate();
            isValidator[next[i]] = true;
            debt[next[i]] = accPerValidator;
            validators.push(next[i]);
        }
        emit ValidatorsSet(next);
    }

    function pending(address v) public view returns (uint256) {
        return credited[v] + (isValidator[v] ? accPerValidator - debt[v] : 0);
    }

    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    /// @notice Permissionless: pays a validator's accrued share to the validator address itself
    ///         (validator node accounts start with no gas money, so a keeper can trigger it).
    function claim(address v) external {
        uint256 amount = pending(v);
        if (amount == 0) revert NothingToClaim();
        credited[v] = 0;
        if (isValidator[v]) debt[v] = accPerValidator;
        totalClaimed += amount;
        (bool ok, ) = v.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(v, amount);
    }
}
