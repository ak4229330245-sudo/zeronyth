// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title EmissionPool — holds the participant reward pool (30% of supply = 30,000,000 ZNYT).
/// @notice Each year releases `annualBps` (15%) of the pool REMAINING at the start of that year, pro-rata in time
///         (year 1 = 4.5M ≈ 12,329/day, year 2 = 3.825M, ...). Geometric decay: floor(r*15%) < r for every r > 0,
///         so the pool never reaches zero. There is NO admin withdrawal: funds can only leave via release() to the
///         economy contract (which pays verified work) and unpaid/capped amounts come back via giveBack().
contract EmissionPool {
    error NotBeneficiary();
    error AlreadyStarted();
    error NotStarted();
    error TransferFailed();

    uint16 public constant BPS = 10_000;
    uint16 public immutable annualBps;      // 1500 = 15% of remaining per year
    uint64 public immutable yearSeconds;    // 365 days in production; shorter only in time-simulation test deployments
    address public immutable beneficiary;   // ZnytEconomy (pays verified work)
    address public immutable starter;

    uint64 public startTime;
    uint64 public lastAccrual;
    uint64 public yearIndex;               // year currently accruing (0-based)
    uint256 public yearStartRemaining;     // pool balance (net of accrued) when the current year started
    uint256 public totalReleased;
    uint256 public totalReturned;

    event Started(uint64 startTime, uint256 pool);
    event YearRolled(uint64 indexed year, uint256 remainingAtStart, uint256 allowance);
    event Released(uint64 fromTs, uint64 toTs, uint256 amount, uint256 remaining);
    event Returned(uint256 amount);
    event Funded(address indexed from, uint256 amount);

    constructor(address beneficiary_, uint64 yearSeconds_, uint16 annualBps_) {
        beneficiary = beneficiary_; yearSeconds = yearSeconds_; annualBps = annualBps_; starter = msg.sender;
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    /// @notice Lock in the funded pool and start the schedule (callable once, by the deployer).
    function start() external {
        if (msg.sender != starter) revert NotBeneficiary();
        if (startTime != 0) revert AlreadyStarted();
        startTime = uint64(block.timestamp); lastAccrual = startTime; yearStartRemaining = address(this).balance;
        emit Started(startTime, yearStartRemaining);
        emit YearRolled(0, yearStartRemaining, allowanceOf(yearStartRemaining));
    }

    function allowanceOf(uint256 remaining) public view returns (uint256) { return (remaining * annualBps) / BPS; }
    function remaining() external view returns (uint256) { return address(this).balance; }
    function currentAllowance() external view returns (uint256) { return allowanceOf(yearStartRemaining); }
    /// @notice ZNYT released per day at the current year's rate.
    function dailyEmission() external view returns (uint256) { return (allowanceOf(yearStartRemaining) * 1 days) / yearSeconds; }

    /// @dev Walk year boundaries from lastAccrual to `to`. Returns amount due and the resulting year state.
    function _accrue(uint64 to) internal view returns (uint256 due, uint64 yi, uint256 ysr) {
        yi = yearIndex; ysr = yearStartRemaining; uint64 t = lastAccrual;
        uint256 bal = address(this).balance;
        for (uint256 guard = 0; t < to && guard < 64; guard++) {
            uint64 yearEnd = startTime + (yi + 1) * yearSeconds;
            uint64 segEnd = to < yearEnd ? to : yearEnd;
            // elapsed-in-year based accounting avoids per-segment rounding drift: accrued(y, t) = A * (t - yStart) / Y
            uint64 yStart = yearEnd - yearSeconds;
            uint256 a = allowanceOf(ysr);
            due += (a * (segEnd - yStart)) / yearSeconds - (a * (t - yStart)) / yearSeconds;
            t = segEnd;
            if (t == yearEnd) { yi += 1; ysr = bal - due; }   // next year: 15% of what is left (incl. returned funds)
        }
    }

    function pendingRelease() external view returns (uint256 due) {
        if (startTime == 0) return 0; (due, , ) = _accrue(uint64(block.timestamp));
    }

    /// @notice Sends everything accrued since the last call to the economy contract.
    function release() external returns (uint256 due) {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (startTime == 0) revert NotStarted();
        uint64 nowTs = uint64(block.timestamp); uint64 fromTs = lastAccrual;
        uint64 yi0 = yearIndex; uint64 yi; uint256 ysr;
        (due, yi, ysr) = _accrue(nowTs);
        lastAccrual = nowTs;
        if (yi != yi0) { yearIndex = yi; yearStartRemaining = ysr; emit YearRolled(yi, ysr, allowanceOf(ysr)); }
        totalReleased += due;
        if (due > 0) { (bool ok, ) = beneficiary.call{value: due}(""); if (!ok) revert TransferFailed(); }
        emit Released(fromTs, nowTs, due, address(this).balance);
    }

    /// @notice Capped / unclaimed emission goes back into the pool (re-emitted in later years).
    function giveBack() external payable { totalReturned += msg.value; emit Returned(msg.value); }
}
