// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BridgeAttestation} from "./BridgeAttestation.sol";
import {DailyCaps} from "./DailyCaps.sol";
import {WrappedZnyt} from "./WrappedZnyt.sol";

/// @title BridgeMinter — deployed with identical bytecode + args on every EVM testnet (CREATE2 => same address)
/// @notice Mints wZNYT when M-of-N relayers attest a Locked event on the ZERONYTH vault; burns wZNYT to bridge back.
/// TESTNET ONLY, NOT AUDITED.
contract BridgeMinter is Ownable2Step, Pausable, ReentrancyGuard, BridgeAttestation, DailyCaps {
    uint256 private constant MINT_KEY = 0;
    uint256 private constant BURN_KEY = 1;

    WrappedZnyt public immutable token;
    uint256 public immutable srcChainId;  // ZERONYTH chain id (9127)
    address public immutable srcVault;    // ZnytBridgeVault on ZERONYTH

    address public guardian;
    uint256 public minAmount;
    uint256 public maxAmount;
    uint256 public dailyCap;
    uint256 public nextNonce;  // outbound (burn) nonce on this chain
    mapping(uint256 => bool) public processed; // vault nonce => minted

    event Minted(uint256 indexed srcNonce, address indexed recipient, uint256 amount);
    event Burned(uint256 indexed nonce, address indexed sender, address indexed recipient, uint256 amount);
    event LimitsSet(uint256 minAmount, uint256 maxAmount, uint256 dailyCap);
    event GuardianSet(address guardian);

    error AlreadyProcessed();
    error BadAmount();
    error BadRecipient();
    error NotGuardian();

    constructor(address owner_, address guardian_, address[] memory relayers_, uint256 threshold_, uint256 srcChainId_,
        address srcVault_, uint256 minAmount_, uint256 maxAmount_, uint256 dailyCap_) Ownable(owner_) {
        token = new WrappedZnyt();
        srcChainId = srcChainId_;
        srcVault = srcVault_;
        guardian = guardian_;
        _setRelayers(relayers_, threshold_);
        _setLimits(minAmount_, maxAmount_, dailyCap_);
        emit GuardianSet(guardian_);
    }

    /// @notice Mint wZNYT for a ZNYT lock (anyone may submit; relayer signatures authorise it).
    function mint(uint256 srcNonce, bytes32 recipient, uint256 amount, bytes[] calldata sigs) external whenNotPaused nonReentrant {
        if (processed[srcNonce]) revert AlreadyProcessed();
        if (uint256(recipient) >> 160 != 0 || recipient == bytes32(0)) revert BadRecipient();
        if (amount == 0 || amount > maxAmount) revert BadAmount();
        _checkSignatures(attestationDigest(srcChainId, srcVault, block.chainid, address(this), srcNonce, recipient, amount), sigs);
        _useDaily(MINT_KEY, amount, dailyCap);
        processed[srcNonce] = true;
        token.mint(address(uint160(uint256(recipient))), amount);
        emit Minted(srcNonce, address(uint160(uint256(recipient))), amount);
    }

    /// @notice Burn wZNYT to receive ZNYT on ZERONYTH at `recipient`.
    function burn(uint256 amount, address recipient) external whenNotPaused nonReentrant returns (uint256 nonce) {
        if (recipient == address(0)) revert BadRecipient();
        if (amount < minAmount || amount > maxAmount) revert BadAmount();
        _useDaily(BURN_KEY, amount, dailyCap);
        token.burnFrom(msg.sender, amount);
        nonce = nextNonce++;
        emit Burned(nonce, msg.sender, recipient, amount);
    }

    function mintedToday() external view returns (uint256) { return dailyVolume[MINT_KEY][today()]; }
    function burnedToday() external view returns (uint256) { return dailyVolume[BURN_KEY][today()]; }

    function setLimits(uint256 min_, uint256 max_, uint256 daily_) external onlyOwner { _setLimits(min_, max_, daily_); }
    function _setLimits(uint256 min_, uint256 max_, uint256 daily_) internal {
        if (min_ == 0 || max_ < min_ || daily_ < max_) revert BadAmount();
        (minAmount, maxAmount, dailyCap) = (min_, max_, daily_);
        emit LimitsSet(min_, max_, daily_);
    }
    function setRelayers(address[] calldata list, uint256 newThreshold) external onlyOwner { _setRelayers(list, newThreshold); }
    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianSet(g); }
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }
    function unpause() external onlyOwner { _unpause(); }
}
