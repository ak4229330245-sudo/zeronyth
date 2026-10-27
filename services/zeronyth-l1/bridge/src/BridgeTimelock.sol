// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title BridgeTimelock — unmodified OpenZeppelin TimelockController (owner of the vault and of every BridgeMinter).
/// @notice Relayer-set changes, chain config, guardian changes and unpause must be scheduled and wait `getMinDelay()`
/// (24h) before anyone can execute them; the canceller (guardian) can veto during the delay. Pause stays instant (guardian).
/// Deployed with minDelay 0 only for the one-shot handover batch (acceptOwnership + grant canceller + updateDelay(24h)).
contract BridgeTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
        TimelockController(minDelay, proposers, executors, admin) {}
}
