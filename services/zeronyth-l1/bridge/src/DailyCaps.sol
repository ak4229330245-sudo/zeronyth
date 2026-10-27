// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Per-key (chain) daily volume accounting in UTC days.
abstract contract DailyCaps {
    mapping(uint256 => mapping(uint256 => uint256)) public dailyVolume; // key => day => amount
    error DailyCapExceeded(uint256 key, uint256 used, uint256 cap);

    function today() public view returns (uint256) { return block.timestamp / 1 days; }

    function _useDaily(uint256 key, uint256 amount, uint256 cap) internal {
        uint256 d = today();
        uint256 used = dailyVolume[key][d] + amount;
        if (used > cap) revert DailyCapExceeded(key, used, cap);
        dailyVolume[key][d] = used;
    }
}
