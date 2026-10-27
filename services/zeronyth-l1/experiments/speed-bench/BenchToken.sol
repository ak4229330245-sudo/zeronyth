// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
// Benchmark-only contracts (worthless, test chain only).
// BenchToken: minimal ERC20-style transfer. BenchPool: Uniswap-v2-like constant-product swap over internal
// balances of two tokens (reads 2 reserves, writes 2 reserves + 2 balances, emits an event) -> swap-like gas profile.
contract BenchToken {
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function mint(address[] calldata to, uint256 amt) external { for (uint i = 0; i < to.length; i++) balanceOf[to[i]] += amt; }
    function transfer(address to, uint256 v) external returns (bool) {
        uint256 b = balanceOf[msg.sender]; require(b >= v, "bal");
        unchecked { balanceOf[msg.sender] = b - v; } balanceOf[to] += v; emit Transfer(msg.sender, to, v); return true;
    }
}
contract BenchPool {
    uint112 public r0 = 1e24; uint112 public r1 = 1e24;
    mapping(address => uint256) public b0; mapping(address => uint256) public b1;
    event Swap(address indexed who, bool zeroForOne, uint256 inAmt, uint256 outAmt);
    function seed(address[] calldata to, uint256 amt) external { for (uint i = 0; i < to.length; i++) { b0[to[i]] += amt; b1[to[i]] += amt; } }
    function swap(uint256 inAmt, bool zeroForOne) external returns (uint256 out) {
        (uint256 x, uint256 y) = zeroForOne ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 inFee = inAmt * 997; out = (inFee * y) / (x * 1000 + inFee); require(out > 0, "out");
        if (zeroForOne) { require(b0[msg.sender] >= inAmt, "bal"); b0[msg.sender] -= inAmt; b1[msg.sender] += out; r0 = uint112(x + inAmt); r1 = uint112(y - out); }
        else { require(b1[msg.sender] >= inAmt, "bal"); b1[msg.sender] -= inAmt; b0[msg.sender] += out; r1 = uint112(x + inAmt); r0 = uint112(y - out); }
        emit Swap(msg.sender, zeroForOne, inAmt, out);
    }
}
