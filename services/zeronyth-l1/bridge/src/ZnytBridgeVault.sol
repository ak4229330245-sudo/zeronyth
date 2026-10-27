// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BridgeAttestation} from "./BridgeAttestation.sol";
import {DailyCaps} from "./DailyCaps.sol";

/// @title ZnytBridgeVault (ZERONYTH testnet, chain 9127) — TESTNET ONLY, NOT AUDITED
/// @notice Locks native ZNYT for a destination chain; releases it when M-of-N relayers attest a burn on that chain.
/// Multi-chain: one vault, each destination chain has its own minter address, caps and outstanding balance.
/// A destination chain can never release more ZNYT than was locked towards it (per-chain outstanding), so one
/// compromised remote chain cannot drain the ZNYT locked for the others.
contract ZnytBridgeVault is Ownable2Step, Pausable, ReentrancyGuard, BridgeAttestation, DailyCaps {
    struct ChainConfig {
        bool enabled;        // new locks towards this chain allowed
        address minter;      // BridgeMinter on that chain (non-EVM: 20-byte program id stand-in, see docs)
        uint128 minAmount;   // per-tx minimum
        uint128 maxAmount;   // per-tx cap
        uint256 dailyCap;    // daily cap, applied separately to locks and to releases
    }

    uint256 private constant RELEASE_KEY_OFFSET = 1 << 128; // dailyVolume key space for releases

    address public guardian;
    uint256 public nextNonce;                       // outbound transfer nonce (global across chains)
    uint256 public totalLocked;                     // ZNYT currently backing wZNYT on all chains (+ in flight)
    mapping(uint256 => ChainConfig) public chains;
    mapping(uint256 => uint256) public outstanding; // chainId => locked towards chain - released from chain
    mapping(uint256 => mapping(uint256 => bool)) public processed; // srcChainId => srcNonce => released
    mapping(address => uint256) public pendingWithdrawals; // if a native transfer to the recipient reverted
    uint256[] internal _chainIds;

    event Locked(uint256 indexed nonce, uint256 indexed dstChainId, address indexed sender, bytes32 recipient, uint256 amount);
    event Released(uint256 indexed srcChainId, uint256 indexed srcNonce, address indexed recipient, uint256 amount, bool paid);
    event ChainSet(uint256 indexed chainId, bool enabled, address minter, uint256 minAmount, uint256 maxAmount, uint256 dailyCap);
    event GuardianSet(address guardian);
    event Withdrawn(address indexed recipient, uint256 amount);

    error UnknownChain(uint256 chainId);
    error ChainDisabled(uint256 chainId);
    error BadAmount();
    error BadRecipient();
    error AlreadyProcessed();
    error ExceedsOutstanding();
    error NotGuardian();
    error TransferFailed();

    constructor(address owner_, address guardian_, address[] memory relayers_, uint256 threshold_) Ownable(owner_) {
        guardian = guardian_;
        _setRelayers(relayers_, threshold_);
        emit GuardianSet(guardian_);
    }

    // ---------------------------------------------------------------- user

    /// @notice Lock native ZNYT; wZNYT is minted to `recipient` on `dstChainId` after relayer attestation.
    /// @param recipient destination address as bytes32 (EVM: left-padded 20-byte address).
    function lock(uint256 dstChainId, bytes32 recipient) external payable whenNotPaused nonReentrant returns (uint256 nonce) {
        ChainConfig memory c = chains[dstChainId];
        if (c.minter == address(0)) revert UnknownChain(dstChainId);
        if (!c.enabled) revert ChainDisabled(dstChainId);
        if (recipient == bytes32(0)) revert BadRecipient();
        if (msg.value < c.minAmount || msg.value > c.maxAmount) revert BadAmount();
        _useDaily(dstChainId, msg.value, c.dailyCap);
        nonce = nextNonce++;
        totalLocked += msg.value;
        outstanding[dstChainId] += msg.value;
        emit Locked(nonce, dstChainId, msg.sender, recipient, msg.value);
    }

    /// @notice Release ZNYT for a burn on `srcChainId` (anyone may submit; relayer signatures authorise it).
    function release(uint256 srcChainId, uint256 srcNonce, address recipient, uint256 amount, bytes[] calldata sigs)
        external whenNotPaused nonReentrant
    {
        ChainConfig memory c = chains[srcChainId];
        if (c.minter == address(0)) revert UnknownChain(srcChainId);
        if (processed[srcChainId][srcNonce]) revert AlreadyProcessed();
        if (recipient == address(0)) revert BadRecipient();
        if (amount == 0 || amount > c.maxAmount) revert BadAmount();
        if (amount > outstanding[srcChainId]) revert ExceedsOutstanding();
        _checkSignatures(attestationDigest(srcChainId, c.minter, block.chainid, address(this), srcNonce,
            bytes32(uint256(uint160(recipient))), amount), sigs);
        _useDaily(RELEASE_KEY_OFFSET + srcChainId, amount, c.dailyCap);
        processed[srcChainId][srcNonce] = true;
        outstanding[srcChainId] -= amount;
        totalLocked -= amount;
        (bool ok,) = recipient.call{value: amount, gas: 50_000}("");
        if (!ok) pendingWithdrawals[recipient] += amount;
        emit Released(srcChainId, srcNonce, recipient, amount, ok);
    }

    function withdrawPending() external nonReentrant {
        uint256 a = pendingWithdrawals[msg.sender];
        if (a == 0) revert BadAmount();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: a}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, a);
    }

    // ---------------------------------------------------------------- views

    function chainIds() external view returns (uint256[] memory) { return _chainIds; }
    function releasedToday(uint256 chainId) external view returns (uint256) { return dailyVolume[RELEASE_KEY_OFFSET + chainId][today()]; }
    function lockedToday(uint256 chainId) external view returns (uint256) { return dailyVolume[chainId][today()]; }

    // ---------------------------------------------------------------- admin

    function setChain(uint256 chainId, bool enabled, address minter, uint128 minAmount, uint128 maxAmount, uint256 dailyCap) external onlyOwner {
        if (chainId == block.chainid || minter == address(0) || minAmount == 0 || maxAmount < minAmount || dailyCap < maxAmount) revert BadAmount();
        if (chains[chainId].minter == address(0)) _chainIds.push(chainId);
        // the minter address is fixed once set: changing it would let a new contract release the old chain's outstanding ZNYT
        else if (chains[chainId].minter != minter) revert BadRecipient();
        chains[chainId] = ChainConfig(enabled, minter, minAmount, maxAmount, dailyCap);
        emit ChainSet(chainId, enabled, minter, minAmount, maxAmount, dailyCap);
    }

    function setRelayers(address[] calldata list, uint256 newThreshold) external onlyOwner { _setRelayers(list, newThreshold); }
    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianSet(g); }

    /// @notice Emergency stop: the guardian or the owner can pause; only the owner can unpause.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }
    function unpause() external onlyOwner { _unpause(); }

    /// @dev plain transfers are rejected so that every ZNYT in the vault is accounted for by a Locked event.
    receive() external payable { revert BadAmount(); }
}
