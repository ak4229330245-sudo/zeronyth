// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// ZERONYTH testnet token/token router (zX/zY pools). A copy of experiments/swap-lab/SwapLab.sol's SwapLabRouter with
// one fix: SwapLabRouter.swapExactInput asked the pair for the *input* token as output
// (pair.swap(inputIs0 ? amountOut : 0, ...)), so every token->token swap reverted ("insufficient reserves") or would
// have failed the K check. Here the output side is the other token. Pairs are the unchanged SwapLabPair.
import "SwapLab.sol";

contract ZnytTokenRouter {
    SwapTestToken public immutable tokenA;
    SwapTestToken public immutable tokenB;
    SwapLabPair public immutable pair;
    uint256 private unlocked = 1;
    event Swap(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address to);
    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;

    modifier lock() {
        require(unlocked == 1, "locked");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address a, address b, address pair_) {
        require(a != address(0) && b != address(0) && a != b && pair_ != address(0), "invalid addresses");
        tokenA = SwapTestToken(a);
        tokenB = SwapTestToken(b);
        pair = SwapLabPair(pair_);
        require(pair.router() == address(this), "pair router mismatch");
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "insufficient input");
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        return amountInWithFee * reserveOut / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    function addLiquidity(uint256 amountA, uint256 amountB, uint256 minLiquidity, uint256 deadline)
        external lock returns (uint256 liquidity, uint256 usedA, uint256 usedB)
    {
        require(block.timestamp <= deadline, "expired");
        require(amountA > 0 && amountB > 0, "zero amount");
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        if (pair.totalSupply() != 0) {
            (address t0,) = _tokens();
            uint256 reserveA = address(tokenA) == t0 ? reserve0 : reserve1;
            uint256 reserveB = address(tokenA) == t0 ? reserve1 : reserve0;
            require(reserveA != 0 && reserveB != 0, "empty reserves");
            if (amountA * reserveB > amountB * reserveA) {
                amountA = amountB * reserveA / reserveB;
            } else {
                amountB = amountA * reserveB / reserveA;
            }
            require(amountA > 0 && amountB > 0, "zero optimal amount");
        }
        _safeTransferFrom(address(tokenA), msg.sender, address(pair), amountA);
        _safeTransferFrom(address(tokenB), msg.sender, address(pair), amountB);
        liquidity = pair.mint(msg.sender);
        require(liquidity >= minLiquidity, "liquidity below minimum");
        usedA = amountA;
        usedB = amountB;
    }

    function swapExactInput(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external lock returns (uint256 amountOut)
    {
        require(block.timestamp <= deadline, "expired");
        require(to != address(0) && to != address(pair) && amountIn > 0, "invalid swap");
        (uint112 r0, uint112 r1,) = pair.getReserves();
        address tokenOut;
        uint256 reserveIn;
        uint256 reserveOut;
        bool inputIs0 = tokenIn == pair.token0();
        require(inputIs0 || tokenIn == pair.token1(), "unsupported token");
        if (inputIs0) { reserveIn = r0; reserveOut = r1; tokenOut = pair.token1(); }
        else { reserveIn = r1; reserveOut = r0; tokenOut = pair.token0(); }
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= minOut, "output below minimum");
        _safeTransferFrom(tokenIn, msg.sender, address(pair), amountIn);
        pair.swap(inputIs0 ? 0 : amountOut, inputIs0 ? amountOut : 0, to); // FIX: output is the *other* token
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    function removeLiquidity(uint256 liquidity, uint256 minA, uint256 minB, uint256 deadline)
        external lock returns (uint256 amountA, uint256 amountB)
    {
        require(block.timestamp <= deadline, "expired");
        require(liquidity > 0, "zero liquidity");
        _safeTransferFrom(address(pair), msg.sender, address(pair), liquidity);
        (uint256 amount0, uint256 amount1) = pair.burn(msg.sender);
        (address t0,) = _tokens();
        if (address(tokenA) == t0) { amountA = amount0; amountB = amount1; }
        else { amountA = amount1; amountB = amount0; }
        require(amountA >= minA && amountB >= minB, "output below minimum");
    }

    function _tokens() private view returns (address, address) { return (pair.token0(), pair.token1()); }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Lab.transferFrom.selector, from, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "token transfer failed");
    }
}
