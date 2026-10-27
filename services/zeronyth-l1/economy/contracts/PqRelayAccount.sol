// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PqRelayAccount (TEST CHAIN ONLY, research)
/// @notice Account controlled by an ML-DSA-65 key whose signatures are verified OFF-CHAIN by a relayer, which also
///         pays the gas and is reimbursed `fee` from the account. The full 3309-byte signature is put in calldata of
///         every execute(), and the public key is emitted once at creation, so ANYONE can re-verify every action from
///         chain data alone (audit). HONEST LIMITS: the EVM does not verify ML-DSA here (no precompile; a Solidity
///         verifier would cost millions of gas). A malicious relayer could submit an action without a valid signature;
///         that is detectable after the fact but not prevented. To bound that trust, value moved per UTC day is capped
///         on-chain (dailyLimit), and the relayer can be replaced only by the account itself (i.e. a PQ-signed action).
contract PqRelayAccount {
    bytes32 public constant DOMAIN = keccak256("ZERONYTH-PQ-RELAY-v1");
    uint256 public constant SIG_LEN = 3309;      // ML-DSA-65 signature length
    bytes32 public immutable pqKeyHash;          // keccak256(1952-byte ML-DSA-65 public key)
    uint256 public immutable dailyLimit;         // max wei leaving the account per day (value + fee)
    address public relayer;
    uint256 public nonce;
    uint256 public spentDay; uint256 public spentToday;

    event PqKey(bytes publicKey);
    event Executed(uint256 indexed nonce, bytes32 intent, bytes32 sigHash, address to, uint256 value, uint256 fee, bool ok);
    event RelayerChanged(address relayer);

    error NotRelayer(); error Expired(); error BadSigLen(); error BadKey(); error OverDailyLimit(); error FeeFailed(); error NotSelf();

    constructor(bytes memory publicKey, address relayer_, uint256 dailyLimit_) payable {
        if (publicKey.length != 1952) revert BadKey();
        pqKeyHash = keccak256(publicKey); relayer = relayer_; dailyLimit = dailyLimit_;
        emit PqKey(publicKey); emit RelayerChanged(relayer_);
    }
    receive() external payable {}

    /// @notice The exact 32-byte intent the ML-DSA-65 key signs (message = DOMAIN-prefixed, see relayer).
    function intentHash(uint256 n, address to, uint256 value, bytes calldata data, uint256 fee, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), n, to, value, keccak256(data), fee, deadline));
    }

    function execute(address to, uint256 value, bytes calldata data, uint256 fee, uint256 deadline, bytes calldata sig)
        external returns (bool ok)
    {
        if (msg.sender != relayer) revert NotRelayer();
        if (block.timestamp > deadline) revert Expired();
        if (sig.length != SIG_LEN) revert BadSigLen();
        uint256 n = nonce++;
        bytes32 intent = intentHash(n, to, value, data, fee, deadline);
        uint256 day = block.timestamp / 1 days;
        if (day != spentDay) { spentDay = day; spentToday = 0; }
        spentToday += value + fee;
        if (spentToday > dailyLimit) revert OverDailyLimit();
        if (fee > 0) { (bool f, ) = relayer.call{value: fee}(""); if (!f) revert FeeFailed(); }
        (ok, ) = to.call{value: value}(data);
        emit Executed(n, intent, keccak256(sig), to, value, fee, ok);
    }

    function setRelayer(address r) external { if (msg.sender != address(this)) revert NotSelf(); relayer = r; emit RelayerChanged(r); }
}
