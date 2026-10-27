// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Lab {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @notice Valueless local test asset. Any address may claim once; no admin exists.
contract SwapTestToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    uint256 public constant CLAIM_AMOUNT = 10_000 ether;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public claimed;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function claim() external {
        require(!claimed[msg.sender], "already claimed");
        claimed[msg.sender] = true;
        totalSupply += CLAIM_AMOUNT;
        balanceOf[msg.sender] += CLAIM_AMOUNT;
        emit Transfer(address(0), msg.sender, CLAIM_AMOUNT);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= value, "allowance");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= value, "balance");
        balanceOf[from] = balance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @notice Single fixed pair LP token. Only the fixed router may update reserves.
contract SwapLabPair {
    string public constant name = "ZERONYTH Swap Lab LP";
    string public constant symbol = "ZLP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    uint256 private constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private unlocked = 1;
    address public immutable token0;
    address public immutable token1;
    address private immutable deployer;
    address public router;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 public blockTimestampLast;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Sync(uint112 reserve0, uint112 reserve1);
    event Mint(address indexed sender, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed sender, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(address indexed sender, address indexed to, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out);

    modifier onlyRouter() { require(msg.sender == router, "router only"); _; }
    modifier lock() {
        require(unlocked == 1, "locked");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address a, address b) {
        require(a != address(0) && b != address(0) && a != b, "invalid addresses");
        (token0, token1) = a < b ? (a, b) : (b, a);
        deployer = msg.sender;
    }

    function setRouter(address router_) external {
        require(msg.sender == deployer && router == address(0) && router_ != address(0), "router already set");
        router = router_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= value, "allowance");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to) external onlyRouter lock returns (uint256 liquidity) {
        uint256 amount0 = IERC20Lab(token0).balanceOf(address(this)) - reserve0;
        uint256 amount1 = IERC20Lab(token1).balanceOf(address(this)) - reserve1;
        if (totalSupply == 0) {
            uint256 root = _sqrt(amount0 * amount1);
            require(root > MINIMUM_LIQUIDITY, "initial liquidity too small");
            liquidity = root - MINIMUM_LIQUIDITY;
            _mint(address(0x000000000000000000000000000000000000dEaD), MINIMUM_LIQUIDITY);
        } else {
            require(reserve0 != 0 && reserve1 != 0, "empty reserves");
            uint256 l0 = amount0 * totalSupply / reserve0;
            uint256 l1 = amount1 * totalSupply / reserve1;
            liquidity = l0 < l1 ? l0 : l1;
        }
        require(liquidity != 0, "zero liquidity");
        _mint(to, liquidity);
        _update();
        emit Mint(msg.sender, to, amount0, amount1, liquidity);
    }

    function burn(address to) external onlyRouter lock returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = balanceOf[address(this)];
        uint256 supply = totalSupply;
        require(liquidity > 0 && supply > 0, "zero liquidity");
        amount0 = liquidity * IERC20Lab(token0).balanceOf(address(this)) / supply;
        amount1 = liquidity * IERC20Lab(token1).balanceOf(address(this)) / supply;
        require(amount0 > 0 && amount1 > 0, "zero output");
        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        _update();
        emit Burn(msg.sender, to, amount0, amount1, liquidity);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external onlyRouter lock {
        require(amount0Out > 0 || amount1Out > 0, "zero output");
        require(amount0Out < reserve0 && amount1Out < reserve1, "insufficient reserves");
        _safeTransfer(token0, to, amount0Out);
        _safeTransfer(token1, to, amount1Out);
        uint256 balance0_ = IERC20Lab(token0).balanceOf(address(this));
        uint256 balance1_ = IERC20Lab(token1).balanceOf(address(this));
        uint256 amount0In = balance0_ > uint256(reserve0) - amount0Out ? balance0_ - (uint256(reserve0) - amount0Out) : 0;
        uint256 amount1In = balance1_ > uint256(reserve1) - amount1Out ? balance1_ - (uint256(reserve1) - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "no input");
        uint256 adjusted0 = balance0_ * 1000 - amount0In * 3;
        uint256 adjusted1 = balance1_ * 1000 - amount1In * 3;
        require(adjusted0 * adjusted1 >= uint256(reserve0) * uint256(reserve1) * 1_000_000, "constant product");
        _update();
        emit Swap(msg.sender, to, amount0In, amount1In, amount0Out, amount1Out);
    }

    function _update() private {
        uint256 b0 = IERC20Lab(token0).balanceOf(address(this));
        uint256 b1 = IERC20Lab(token1).balanceOf(address(this));
        require(b0 <= type(uint112).max && b1 <= type(uint112).max, "reserve overflow");
        reserve0 = uint112(b0);
        reserve1 = uint112(b1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "zero recipient");
        require(balanceOf[from] >= value, "LP balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) private {
        balanceOf[to] += value;
        totalSupply += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Lab.transfer.selector, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "token transfer failed");
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) z = 1;
    }
}

/// @notice Fixed one-pair router, 0.30% pool fee, exact-input swaps only.
contract SwapLabRouter {
    SwapTestToken public immutable tokenA;
    SwapTestToken public immutable tokenB;
    SwapLabPair public immutable pair;
    uint256 private unlocked = 1;
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
        pair.swap(inputIs0 ? amountOut : 0, inputIs0 ? 0 : amountOut, to);
        tokenOut;
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
