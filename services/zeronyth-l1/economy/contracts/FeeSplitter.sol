// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Destroys exactly msg.value native ZNYT: a contract created and SELFDESTRUCTed to itself in the
///         same transaction deletes its balance (pre-Cancun and EIP-6780 semantics). No account receives it,
///         so total supply decreases.
contract Incinerator {
    constructor() payable {
        selfdestruct(payable(address(this)));
    }
}

/// @title FeeSplitter
/// @notice Set as the QBFT `miningbeneficiary` (via a block-number transition). Every block's gas fees are
///         credited here by the protocol; `distribute()` burns `burnBps` (default 2000 = 20%) and forwards the
///         rest (default 80%) to the validator RewardPool.
contract FeeSplitter {
    error NotAdmin();
    error BadBps();
    error ZeroAddress();
    error PoolTransferFailed();

    uint16 public constant MAX_BPS = 10_000;
    address public admin;
    address public rewardPool;
    uint16 public burnBps;
    uint256 public totalBurned;
    uint256 public totalToPool;

    event Distributed(uint256 indexed blockNumber, uint256 amount, uint256 burned, uint256 toPool, uint16 burnBps);
    event BurnBpsChanged(uint16 oldBps, uint16 newBps);
    event RewardPoolChanged(address oldPool, address newPool);
    event AdminChanged(address oldAdmin, address newAdmin);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address pool, uint16 bps) {
        if (pool == address(0)) revert ZeroAddress();
        if (bps > MAX_BPS) revert BadBps();
        admin = msg.sender;
        rewardPool = pool;
        burnBps = bps;
    }

    receive() external payable {}

    /// @notice Permissionless: anyone (the coordinator keeper) may trigger the split of accumulated fees.
    function distribute() external returns (uint256 burned, uint256 toPool) {
        uint256 amount = address(this).balance;
        if (amount == 0) return (0, 0);
        burned = (amount * burnBps) / MAX_BPS;
        toPool = amount - burned;
        totalBurned += burned;
        totalToPool += toPool;
        if (burned > 0) new Incinerator{value: burned}();
        if (toPool > 0) {
            (bool ok, ) = rewardPool.call{value: toPool}("");
            if (!ok) revert PoolTransferFailed();
        }
        emit Distributed(block.number, amount, burned, toPool, burnBps);
    }

    function setBurnBps(uint16 bps) external onlyAdmin {
        if (bps > MAX_BPS) revert BadBps();
        emit BurnBpsChanged(burnBps, bps);
        burnBps = bps;
    }

    function setRewardPool(address pool) external onlyAdmin {
        if (pool == address(0)) revert ZeroAddress();
        emit RewardPoolChanged(rewardPool, pool);
        rewardPool = pool;
    }

    function setAdmin(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, next);
        admin = next;
    }
}
