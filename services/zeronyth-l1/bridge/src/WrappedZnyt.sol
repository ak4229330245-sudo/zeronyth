// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title WrappedZnyt (wZNYT) — TESTNET ONLY, no monetary value
/// @notice 18-decimal ERC-20 representing ZNYT locked in ZnytBridgeVault on ZERONYTH (chain 9127).
/// Only its BridgeMinter (the deployer, fixed forever) can mint or burn.
contract WrappedZnyt is ERC20, ERC20Permit {
    address public immutable minter;
    error OnlyMinter();

    constructor() ERC20("Wrapped ZNYT (ZERONYTH testnet)", "wZNYT") ERC20Permit("Wrapped ZNYT (ZERONYTH testnet)") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _burn(from, amount);
    }
}
