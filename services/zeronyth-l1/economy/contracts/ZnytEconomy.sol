// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ZnytEconomy (testnet, valueless native ZNYT only)
/// @notice Provider registry + verified-work rewards (native ZNYT + AI credits) + 10-day subscriptions with escrow.
/// @dev Heavy cryptography (ML-DSA-65 declarations/receipts) is verified off-chain by the coordinator, which
///      anchors the commitment (declHash / receiptsRoot) here. The coordinator is a trusted role on this testnet;
///      users are protected from a stalled coordinator by refundUnsettled().
interface IEmissionPool { function release() external returns (uint256); function giveBack() external payable; }

contract ZnytEconomy {
    error NotAdmin();
    error NotCoordinator();
    error BadShares();
    error NotRegistered();
    error NotAttested();
    error BadKind();
    error WrongPrice();
    error BadEpoch();
    error LengthMismatch();
    error OverBudget();
    error NotOpen();
    error TooEarly();
    error NotPayer();
    error BadBps();
    error ZeroWeight();
    error TransferFailed();
    error Nothing();
    error InsufficientCredits();

    uint8 public constant KIND_VPS = 0;
    uint8 public constant KIND_AI = 1;
    uint16 public constant BPS = 10_000;

    uint64 public immutable period;  // 10 days in production deployments
    uint64 public immutable grace;   // after period end, payer can self-refund an unsettled payment

    address public admin;
    address public coordinator;

    struct Provider {
        bool registered;
        bool attested;
        uint16 l1Bps;
        uint16 aiBps;
        uint16 rentalBps;
        uint64 registeredAt;
        bytes32 pqKeyHash;   // keccak256(ML-DSA-65 public key)
        bytes32 declHash;    // keccak256(canonical signed resource declaration)
        uint256 aiCredits;
        uint256 pendingZnyt;
        uint256 earnedZnyt;
        uint256 l1Units;
        uint256 aiUnits;
        uint256 rentalUnits;
    }

    enum Status { None, Open, Settled, Refunded }

    struct Payment {
        address payer;
        uint8 kind;
        Status status;
        uint64 start;
        uint64 end;
        uint256 amount;
    }

    mapping(address => Provider) public providers;
    address[] public providerList;
    mapping(uint8 => uint256) public price;                        // wei per 10-day period
    mapping(address => mapping(uint8 => uint64)) public expiry;    // access expiry per user & kind
    Payment[] public payments;

    uint256 public rewardBudget;    // ZNYT available for work-epoch rewards
    uint256 public escrowed;        // ZNYT held for open payments
    uint256 public lastEpoch;
    uint256 public totalWorkRewards;
    uint256 public totalServicePaid;
    uint256 public totalRefunded;

    // ---- emission (reward pool) ----
    address public emission;                   // EmissionPool (30M ZNYT, 15%/yr of remaining)
    uint16[3] public emissionSplit = [4000, 3000, 3000];   // L1 / AI / VPS-rental buckets of each epoch's emission
    uint16 public capBps = 2500;               // max share of ONE bucket a single participant can take per epoch
    uint256 public totalEmissionPaid;
    uint256 public totalEmissionReturned;

    event ProviderRegistered(address indexed provider, bytes32 pqKeyHash, bytes32 declHash, uint16 l1Bps, uint16 aiBps, uint16 rentalBps);
    event ProviderAttested(address indexed provider, bytes32 declHash);
    event RewardsFunded(address indexed from, uint256 amount);
    event WorkEpoch(uint256 indexed epoch, bytes32 receiptsRoot, uint256 budget, uint256 totalWeightedUnits, uint256 creditPerUnit);
    event WorkCredited(uint256 indexed epoch, address indexed provider, uint256 l1Units, uint256 aiUnits, uint256 rentalUnits, uint256 znyt, uint256 credits);
    event Subscribed(uint256 indexed paymentId, address indexed payer, uint8 kind, uint256 amount, uint64 start, uint64 end);
    event Settled(uint256 indexed paymentId, uint256 toProviders, uint256 refunded);
    event Refunded(uint256 indexed paymentId, uint256 amount);
    event Withdrawn(address indexed provider, uint256 amount);
    event CreditsConsumed(address indexed account, uint256 amount, bytes32 ref);
    event PriceSet(uint8 kind, uint256 price);
    event EmissionEpoch(uint256 indexed epoch, bytes32 receiptsRoot, uint256 released, uint256[3] buckets, uint256 paid, uint256 returned);
    event EmissionParams(address emission, uint16[3] split, uint16 capBps);

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier onlyCoordinator() { if (msg.sender != coordinator) revert NotCoordinator(); _; }

    constructor(address coordinator_, uint64 period_, uint64 grace_, uint256 vpsPrice, uint256 aiPrice) {
        admin = msg.sender;
        coordinator = coordinator_;
        period = period_;
        grace = grace_;
        price[KIND_VPS] = vpsPrice;
        price[KIND_AI] = aiPrice;
    }

    // ---------------------------------------------------------------- providers
    function registerProvider(bytes32 pqKeyHash, bytes32 declHash, uint16 l1Bps, uint16 aiBps, uint16 rentalBps) external {
        if (uint256(l1Bps) + aiBps + rentalBps != BPS) revert BadShares();
        Provider storage p = providers[msg.sender];
        if (!p.registered) { providerList.push(msg.sender); p.registered = true; p.registeredAt = uint64(block.timestamp); }
        p.attested = false;  // any change needs a fresh coordinator attestation of the ML-DSA declaration
        p.pqKeyHash = pqKeyHash;
        p.declHash = declHash;
        p.l1Bps = l1Bps; p.aiBps = aiBps; p.rentalBps = rentalBps;
        emit ProviderRegistered(msg.sender, pqKeyHash, declHash, l1Bps, aiBps, rentalBps);
    }

    /// @notice Coordinator verified the ML-DSA-65 + ECDSA signed declaration off-chain and that it matches declHash.
    function attestProvider(address provider, bytes32 declHash) external onlyCoordinator {
        Provider storage p = providers[provider];
        if (!p.registered) revert NotRegistered();
        if (p.declHash != declHash) revert NotAttested();
        p.attested = true;
        emit ProviderAttested(provider, declHash);
    }

    function providerCount() external view returns (uint256) { return providerList.length; }

    // ---------------------------------------------------------------- verified work rewards
    function fundRewards() external payable {
        rewardBudget += msg.value;
        emit RewardsFunded(msg.sender, msg.value);
    }

    /// @notice Credits one epoch of independently verified work. ZNYT is split pro-rata by weighted units
    ///         (l1 + ai + rental), AI credits = units * creditPerUnit. receiptsRoot commits to the signed receipts.
    function submitWorkEpoch(
        uint256 epoch, address[] calldata who, uint256[] calldata l1, uint256[] calldata ai, uint256[] calldata rental,
        bytes32 receiptsRoot, uint256 budget, uint256 creditPerUnit
    ) external onlyCoordinator {
        if (epoch != lastEpoch + 1) revert BadEpoch();
        uint256 n = who.length;
        if (l1.length != n || ai.length != n || rental.length != n) revert LengthMismatch();
        if (budget > rewardBudget) revert OverBudget();
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            if (!providers[who[i]].attested) revert NotAttested();
            total += l1[i] + ai[i] + rental[i];
        }
        lastEpoch = epoch;
        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            Provider storage p = providers[who[i]];
            uint256 units = l1[i] + ai[i] + rental[i];
            uint256 share = total == 0 ? 0 : (budget * units) / total;
            uint256 credits = units * creditPerUnit;
            p.pendingZnyt += share;
            p.earnedZnyt += share;
            p.aiCredits += credits;
            p.l1Units += l1[i]; p.aiUnits += ai[i]; p.rentalUnits += rental[i];
            paid += share;
            emit WorkCredited(epoch, who[i], l1[i], ai[i], rental[i], share, credits);
        }
        rewardBudget -= paid;
        totalWorkRewards += paid;
        emit WorkEpoch(epoch, receiptsRoot, budget, total, creditPerUnit);
    }

    /// @notice One epoch of on-chain emission: pulls what EmissionPool released for the elapsed time, splits it into
    ///         L1 / AI / rental buckets (default 40/30/30), pays each bucket pro-rata to verified work units in that
    ///         category, capped at capBps of the bucket per participant. Uncapped remainder and empty buckets go back
    ///         to the pool. AI credits = total units * creditPerUnit (as in submitWorkEpoch).
    function submitEmissionEpoch(
        uint256 epoch, address[] calldata who, uint256[] calldata l1, uint256[] calldata ai, uint256[] calldata rental,
        bytes32 receiptsRoot, uint256 creditPerUnit
    ) external onlyCoordinator {
        if (epoch != lastEpoch + 1) revert BadEpoch();
        uint256 n = who.length;
        if (l1.length != n || ai.length != n || rental.length != n) revert LengthMismatch();
        lastEpoch = epoch;
        uint256 released = IEmissionPool(emission).release();
        uint256[3] memory tot;
        for (uint256 i = 0; i < n; i++) {
            if (!providers[who[i]].attested) revert NotAttested();
            tot[0] += l1[i]; tot[1] += ai[i]; tot[2] += rental[i];
        }
        uint256[3] memory bucket;
        bucket[0] = (released * emissionSplit[0]) / BPS; bucket[1] = (released * emissionSplit[1]) / BPS;
        bucket[2] = released - bucket[0] - bucket[1];
        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            uint256 share = _capped(bucket[0], l1[i], tot[0]) + _capped(bucket[1], ai[i], tot[1]) + _capped(bucket[2], rental[i], tot[2]);
            Provider storage p = providers[who[i]];
            uint256 credits = (l1[i] + ai[i] + rental[i]) * creditPerUnit;
            p.pendingZnyt += share; p.earnedZnyt += share; p.aiCredits += credits;
            p.l1Units += l1[i]; p.aiUnits += ai[i]; p.rentalUnits += rental[i];
            paid += share;
            emit WorkCredited(epoch, who[i], l1[i], ai[i], rental[i], share, credits);
        }
        uint256 back = released - paid;
        totalEmissionPaid += paid; totalWorkRewards += paid; totalEmissionReturned += back;
        if (back > 0) IEmissionPool(emission).giveBack{value: back}();
        emit EmissionEpoch(epoch, receiptsRoot, released, bucket, paid, back);
    }

    function _capped(uint256 bucket, uint256 units, uint256 total) internal view returns (uint256) {
        if (total == 0 || units == 0) return 0;
        uint256 s = (bucket * units) / total; uint256 cap = (bucket * capBps) / BPS;
        return s < cap ? s : cap;
    }

    /// @notice Only the EmissionPool sends plain ZNYT here (release()).
    receive() external payable { if (msg.sender != emission) revert NotAdmin(); }

    function setEmission(address e, uint16[3] calldata split, uint16 cap) external onlyAdmin {
        if (uint256(split[0]) + split[1] + split[2] != BPS || cap == 0 || cap > BPS) revert BadShares();
        emission = e; emissionSplit = split; capBps = cap;
        emit EmissionParams(e, split, cap);
    }

    /// @notice AI gateway charges provider/user AI credits (free quota earned by contributing).
    function consumeCredits(address account, uint256 amount, bytes32 ref) external onlyCoordinator {
        Provider storage p = providers[account];
        if (p.aiCredits < amount) revert InsufficientCredits();
        p.aiCredits -= amount;
        emit CreditsConsumed(account, amount, ref);
    }

    function withdraw() external {
        Provider storage p = providers[msg.sender];
        uint256 amount = p.pendingZnyt;
        if (amount == 0) revert Nothing();
        p.pendingZnyt = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- 10-day subscriptions + escrow
    /// @notice One payment = `period` (10 days) of access. Renewals extend from the current expiry.
    function subscribe(uint8 kind) external payable returns (uint256 id) {
        if (kind > KIND_AI) revert BadKind();
        if (msg.value != price[kind] || msg.value == 0) revert WrongPrice();
        uint64 nowTs = uint64(block.timestamp);
        uint64 cur = expiry[msg.sender][kind];
        uint64 start = cur > nowTs ? cur : nowTs;
        uint64 end = start + period;
        expiry[msg.sender][kind] = end;
        id = payments.length;
        payments.push(Payment(msg.sender, kind, Status.Open, start, end, msg.value));
        escrowed += msg.value;
        emit Subscribed(id, msg.sender, kind, msg.value, start, end);
    }

    function isActive(address user, uint8 kind) external view returns (bool) {
        return expiry[user][kind] > block.timestamp;
    }

    function paymentCount() external view returns (uint256) { return payments.length; }

    /// @notice Pay the providers that actually served this payment (weights from verified usage receipts);
    ///         refundBps goes back to the payer (e.g. provider downtime / failed service).
    function settlePayment(uint256 id, address[] calldata who, uint256[] calldata weights, uint16 refundBps) external onlyCoordinator {
        Payment storage pay = payments[id];
        if (pay.status != Status.Open) revert NotOpen();
        if (who.length != weights.length) revert LengthMismatch();
        if (refundBps > BPS) revert BadBps();
        uint256 refund = (pay.amount * refundBps) / BPS;
        uint256 toProviders = pay.amount - refund;
        uint256 totalW;
        for (uint256 i = 0; i < who.length; i++) {
            if (!providers[who[i]].attested) revert NotAttested();
            totalW += weights[i];
        }
        if (toProviders > 0 && totalW == 0) revert ZeroWeight();
        pay.status = Status.Settled;
        escrowed -= pay.amount;
        uint256 paid;
        for (uint256 i = 0; i < who.length; i++) {
            uint256 share = i + 1 == who.length ? toProviders - paid : (toProviders * weights[i]) / totalW;
            providers[who[i]].pendingZnyt += share;
            providers[who[i]].earnedZnyt += share;
            paid += share;
        }
        totalServicePaid += toProviders;
        if (refund > 0) {
            totalRefunded += refund;
            (bool ok, ) = pay.payer.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
        emit Settled(id, toProviders, refund);
    }

    /// @notice Safety valve: if the coordinator never settles, the payer gets everything back after end + grace.
    function refundUnsettled(uint256 id) external {
        Payment storage pay = payments[id];
        if (pay.status != Status.Open) revert NotOpen();
        if (msg.sender != pay.payer) revert NotPayer();
        if (block.timestamp <= uint256(pay.end) + grace) revert TooEarly();
        pay.status = Status.Refunded;
        escrowed -= pay.amount;
        totalRefunded += pay.amount;
        (bool ok, ) = pay.payer.call{value: pay.amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(id, pay.amount);
    }

    // ---------------------------------------------------------------- admin
    function setPrice(uint8 kind, uint256 p) external onlyAdmin {
        if (kind > KIND_AI) revert BadKind();
        price[kind] = p;
        emit PriceSet(kind, p);
    }

    function setCoordinator(address c) external onlyAdmin { coordinator = c; }
    function setAdmin(address a) external onlyAdmin { admin = a; }
}
