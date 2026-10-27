// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title DevVesting — developer allocation (13% = 13,000,000 ZNYT) with a 1-year cliff then 3-year linear release.
/// @notice Nothing is releasable before start+cliff. After the cliff, vested = total * (t - cliffEnd) / linear,
///         fully vested at start + cliff + linear (4 years). The other 2% of supply is unlocked at genesis separately.
///         No admin, no revocation, no early withdrawal.
contract DevVesting {
    error NothingToRelease();
    error TransferFailed();
    address public immutable beneficiary;
    uint64 public immutable start;
    uint64 public immutable cliff;    // 365 days
    uint64 public immutable linear;   // 3 * 365 days
    uint256 public released;
    event Released(uint256 amount, uint256 totalReleased);

    constructor(address beneficiary_, uint64 start_, uint64 cliff_, uint64 linear_) payable {
        beneficiary = beneficiary_; start = start_; cliff = cliff_; linear = linear_;
    }
    receive() external payable {}

    function totalAllocation() public view returns (uint256) { return address(this).balance + released; }
    function vestedAt(uint64 t) public view returns (uint256) {
        uint64 cliffEnd = start + cliff;
        if (t < cliffEnd) return 0;
        if (t >= cliffEnd + linear) return totalAllocation();
        return (totalAllocation() * (t - cliffEnd)) / linear;
    }
    function releasable() public view returns (uint256) { return vestedAt(uint64(block.timestamp)) - released; }
    /// @notice Anyone may trigger; funds always go to the beneficiary.
    function release() external {
        uint256 a = releasable(); if (a == 0) revert NothingToRelease();
        released += a;
        (bool ok, ) = beneficiary.call{value: a}(""); if (!ok) revert TransferFailed();
        emit Released(a, released);
    }
}
