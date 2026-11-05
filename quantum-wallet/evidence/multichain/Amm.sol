// Minimal AMM for the LOCAL wallet swap E2E only (chain 912701 harness).
// Implements exactly the surface the wallet's src/core/swap.mjs uses:
// pair.getReserves()/token0, ERC20 balanceOf/allowance/approve/transfer,
// router swapExactZnytForToken(uint256,uint256) payable [0x61e5c3d8] and
// swapExactTokenForZnyt(uint256,uint256,uint256) [0xd4fe6995], with the
// constant-product 0.3%-fee quote the wallet computes. NOT production
// contracts — production uses the deployed SwapLab/ZnytAmm contracts.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Token {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract WZNYT is Token {
    constructor() Token("Wrapped ZNYT", "WZNYT") {}

    function deposit() external payable {
        totalSupply += msg.value;
        balanceOf[msg.sender] += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send");
        emit Transfer(msg.sender, address(0), amount);
    }

    receive() external payable {}
}

contract Pair {
    address public token0;
    address public token1;
    address public router;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }

    function setRouter(address r) external {
        require(router == address(0), "router set");
        router = r;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (
            uint112(Token(token0).balanceOf(address(this))),
            uint112(Token(token1).balanceOf(address(this))),
            0
        );
    }

    function payOut(address token, uint256 amount, address to) external {
        require(msg.sender == router, "router only");
        require(Token(token).transfer(to, amount), "payout");
    }
}

contract Router {
    WZNYT public wznyt;
    Token public token;
    Pair public pair;

    constructor(address w, address tk, address p) {
        wznyt = WZNYT(payable(w));
        token = Token(tk);
        pair = Pair(p);
    }

    function _quote(uint256 a, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        return (a * 997 * rOut) / (rIn * 1000 + a * 997);
    }

    function _reserves() internal view returns (uint256 rW, uint256 rT) {
        (uint112 a, uint112 b, ) = pair.getReserves();
        return (uint256(a), uint256(b)); // token0 = WZNYT in this deployment
    }

    function swapExactZnytForToken(uint256 minOut, uint256 deadline) external payable returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        (uint256 rW, uint256 rT) = _reserves();
        out = _quote(msg.value, rW, rT);
        require(out >= minOut, "minOut");
        wznyt.deposit{value: msg.value}();
        require(wznyt.transfer(address(pair), msg.value), "in");
        pair.payOut(address(token), out, msg.sender);
    }

    function swapExactTokenForZnyt(uint256 amountIn, uint256 minOut, uint256 deadline) external returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        (uint256 rW, uint256 rT) = _reserves();
        out = _quote(amountIn, rT, rW);
        require(out >= minOut, "minOut");
        require(token.transferFrom(msg.sender, address(pair), amountIn), "pull");
        pair.payOut(address(wznyt), out, address(this));
        wznyt.withdraw(out);
        (bool ok, ) = msg.sender.call{value: out}("");
        require(ok, "send");
    }

    receive() external payable {}
}
