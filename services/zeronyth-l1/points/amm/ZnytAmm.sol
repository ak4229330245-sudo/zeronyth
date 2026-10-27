// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// ZERONYTH public-testnet AMM (chain 9127). Test assets only, no monetary value. Not externally audited; it follows the
// Uniswap V2 constant-product pattern: the pair (SwapLabPair, reused unchanged from experiments/swap-lab) keeps the
// 0.30% fee x*y=k check, MINIMUM_LIQUIDITY lock and reentrancy lock; this file adds WZNYT (WETH9 pattern) and a
// native-ZNYT router so users swap/provide liquidity with plain ZNYT from their own wallet. No admin, no custody,
// no upgrade, no fee switch. Every output goes to msg.sender (no third-party recipients).
import "./SwapLab.sol";

contract WZNYT {
    string public constant name = "Wrapped ZNYT (testnet)";
    string public constant symbol = "WZNYT";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Approval(address indexed src, address indexed guy, uint256 wad);
    event Transfer(address indexed src, address indexed dst, uint256 wad);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);
    receive() external payable { deposit(); }
    function deposit() public payable { balanceOf[msg.sender] += msg.value; emit Deposit(msg.sender, msg.value); }
    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "balance");
        balanceOf[msg.sender] -= wad;
        emit Withdrawal(msg.sender, wad);
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "send failed");
    }
    function totalSupply() external view returns (uint256) { return address(this).balance; }
    function approve(address guy, uint256 wad) external returns (bool) { allowance[msg.sender][guy] = wad; emit Approval(msg.sender, guy, wad); return true; }
    function transfer(address dst, uint256 wad) external returns (bool) { return transferFrom(msg.sender, dst, wad); }
    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad, "balance");
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "allowance");
            allowance[src][msg.sender] -= wad;
        }
        balanceOf[src] -= wad; balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }
}

/// Faucetable test token (zETH / zUSDT / zUSDC / zBTC / zSOL, see tokens.json): no monetary value. Anyone can claim `claimAmount` once per `cooldown`.
/// The deployer gets a one-time `initialMint` to seed the testnet pool. No owner, no admin mint afterwards.
contract ZTestToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    string public constant notice = "ZERONYTH testnet token. No monetary value. Not redeemable.";
    uint256 public totalSupply;
    uint256 public immutable claimAmount;
    uint256 public immutable cooldown;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastClaim;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 claimAmount_, uint256 cooldown_, uint256 initialMint) {
        name = name_; symbol = symbol_; decimals = decimals_; claimAmount = claimAmount_; cooldown = cooldown_;
        if (initialMint > 0) _mint(msg.sender, initialMint);
    }
    function nextClaimAt(address a) external view returns (uint256) { return lastClaim[a] == 0 ? 0 : lastClaim[a] + cooldown; }
    function claim() external {
        require(lastClaim[msg.sender] == 0 || block.timestamp >= lastClaim[msg.sender] + cooldown, "claim cooldown");
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, claimAmount);
    }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; emit Approval(msg.sender, spender, value); return true; }
    function transfer(address to, uint256 value) external returns (bool) { _transfer(msg.sender, to, value); return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender]; require(a >= value, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value); return true;
    }
    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "zero recipient"); require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value; balanceOf[to] += value; emit Transfer(from, to, value);
    }
    function _mint(address to, uint256 value) private { totalSupply += value; balanceOf[to] += value; emit Transfer(address(0), to, value); }
}

contract ZnytAmmRouter {
    WZNYT public immutable wznyt;
    ZTestToken public immutable token;   // zETH / zUSDT / zUSDC (test)
    SwapLabPair public immutable pair;
    bool private immutable znytIs0;
    uint256 private unlocked = 1;
    modifier lock() { require(unlocked == 1, "locked"); unlocked = 0; _; unlocked = 1; }
    modifier live(uint256 deadline) { require(block.timestamp <= deadline, "expired"); _; }

    constructor(address payable wznyt_, address token_, address pair_) {
        wznyt = WZNYT(wznyt_); token = ZTestToken(token_); pair = SwapLabPair(pair_);
        require((pair.token0() == wznyt_ && pair.token1() == token_) || (pair.token0() == token_ && pair.token1() == wznyt_), "pair mismatch");
        znytIs0 = pair.token0() == wznyt_;
    }
    receive() external payable { require(msg.sender == address(wznyt), "no direct ZNYT"); }

    function reserves() public view returns (uint256 rZnyt, uint256 rToken) {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (rZnyt, rToken) = znytIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "bad amounts");
        uint256 inFee = amountIn * 997;
        return inFee * reserveOut / (reserveIn * 1000 + inFee);
    }
    function quoteZnytToToken(uint256 znytIn) external view returns (uint256) { (uint256 a, uint256 b) = reserves(); return getAmountOut(znytIn, a, b); }
    function quoteTokenToZnyt(uint256 tokenIn) external view returns (uint256) { (uint256 a, uint256 b) = reserves(); return getAmountOut(tokenIn, b, a); }

    /// msg.value = max ZNYT; tokenDesired = max test token (approve the router first). Unused ZNYT is refunded.
    function addLiquidity(uint256 tokenDesired, uint256 tokenMin, uint256 znytMin, uint256 deadline)
        external payable lock live(deadline) returns (uint256 znytUsed, uint256 tokenUsed, uint256 liquidity)
    {
        (uint256 rz, uint256 rt) = reserves();
        if (rz == 0 && rt == 0) { (znytUsed, tokenUsed) = (msg.value, tokenDesired); }
        else {
            uint256 tOpt = msg.value * rt / rz;
            if (tOpt <= tokenDesired) { require(tOpt >= tokenMin, "token min"); (znytUsed, tokenUsed) = (msg.value, tOpt); }
            else { uint256 zOpt = tokenDesired * rz / rt; require(zOpt <= msg.value && zOpt >= znytMin, "znyt min"); (znytUsed, tokenUsed) = (zOpt, tokenDesired); }
        }
        require(znytUsed > 0 && tokenUsed > 0, "zero amounts");
        require(token.transferFrom(msg.sender, address(pair), tokenUsed), "token pull");
        wznyt.deposit{value: znytUsed}();
        require(wznyt.transfer(address(pair), znytUsed), "wrap");
        liquidity = pair.mint(msg.sender);
        if (msg.value > znytUsed) _sendZnyt(msg.sender, msg.value - znytUsed);
    }
    /// Approve the router for the LP token first.
    function removeLiquidity(uint256 liquidity, uint256 znytMin, uint256 tokenMin, uint256 deadline)
        external lock live(deadline) returns (uint256 znytOut, uint256 tokenOut)
    {
        require(pair.transferFrom(msg.sender, address(pair), liquidity), "lp pull");
        (uint256 a0, uint256 a1) = pair.burn(address(this));
        (znytOut, tokenOut) = znytIs0 ? (a0, a1) : (a1, a0);
        require(znytOut >= znytMin && tokenOut >= tokenMin, "slippage");
        require(token.transfer(msg.sender, tokenOut), "token send");
        wznyt.withdraw(znytOut);
        _sendZnyt(msg.sender, znytOut);
    }
    function swapExactZnytForToken(uint256 minOut, uint256 deadline) external payable lock live(deadline) returns (uint256 out) {
        (uint256 rz, uint256 rt) = reserves();
        out = getAmountOut(msg.value, rz, rt); require(out >= minOut, "slippage");
        wznyt.deposit{value: msg.value}();
        require(wznyt.transfer(address(pair), msg.value), "wrap");
        if (znytIs0) pair.swap(0, out, msg.sender); else pair.swap(out, 0, msg.sender);
    }
    /// Approve the router for the test token first.
    function swapExactTokenForZnyt(uint256 amountIn, uint256 minOut, uint256 deadline) external lock live(deadline) returns (uint256 out) {
        (uint256 rz, uint256 rt) = reserves();
        out = getAmountOut(amountIn, rt, rz); require(out >= minOut, "slippage");
        require(token.transferFrom(msg.sender, address(pair), amountIn), "token pull");
        if (znytIs0) pair.swap(out, 0, address(this)); else pair.swap(0, out, address(this));
        wznyt.withdraw(out);
        _sendZnyt(msg.sender, out);
    }
    function _sendZnyt(address to, uint256 v) private { (bool ok, ) = to.call{value: v}(""); require(ok, "send failed"); }
}
