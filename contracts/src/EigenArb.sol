// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice nad.fun DEX Router interface (graduated tokens)
interface INadFunDexRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    struct SellParams {
        uint256 amountIn;
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buy(BuyParams calldata params) external payable returns (uint256 amountOut);
    function sell(SellParams calldata params) external returns (uint256 amountOut);
}

/// @notice Universal Router interface (V4 swaps)
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title EigenArb
/// @notice Atomic arbitrage between nad.fun DEX and Uniswap V4 pools.
///         Executes buy on the cheaper venue and sell on the more expensive
///         venue in a single transaction. Reverts if no profit is made.
contract EigenArb is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    IUniversalRouter public immutable universalRouter;

    // Permit2 (canonical address on all chains)
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    event ArbExecuted(
        address indexed token,
        uint8 direction, // 0 = buy nad.fun sell V4, 1 = buy V4 sell nad.fun
        uint256 amountIn,
        uint256 profit
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _universalRouter) {
        owner = msg.sender;
        universalRouter = IUniversalRouter(_universalRouter);
    }

    /// @notice Arb: buy tokens on nad.fun (cheaper), sell on V4 (more expensive).
    /// @param token The ERC20 token to arb
    /// @param nadRouter The nad.fun router to use (bonding curve or DEX)
    /// @param minProfit Minimum MON profit required or the tx reverts
    /// @param nadFunMinTokens Min tokens out from nad.fun buy (slippage protection)
    /// @param v4SellCommands Pre-encoded Universal Router commands for the V4 sell
    /// @param v4SellInputs Pre-encoded Universal Router inputs for the V4 sell
    function arbBuyNadSellV4(
        address token,
        address nadRouter,
        uint256 minProfit,
        uint256 nadFunMinTokens,
        bytes calldata v4SellCommands,
        bytes[] calldata v4SellInputs
    ) external payable onlyOwner nonReentrant {
        uint256 monBefore = address(this).balance - msg.value;

        // 1. Buy tokens on nad.fun with MON
        //    Use balance diff since bonding curve router returns void while DEX router returns uint256
        uint256 deadline = block.timestamp + 300;
        uint256 tokenBalBefore = IERC20(token).balanceOf(address(this));
        (bool success,) = nadRouter.call{value: msg.value}(
            abi.encodeWithSelector(
                INadFunDexRouter.buy.selector,
                INadFunDexRouter.BuyParams({
                    amountOutMin: nadFunMinTokens,
                    token: token,
                    to: address(this),
                    deadline: deadline
                })
            )
        );
        require(success, "NadFun buy failed");
        uint256 tokensReceived = IERC20(token).balanceOf(address(this)) - tokenBalBefore;
        require(tokensReceived > 0, "NadFun buy returned 0 tokens");

        // 2. Approve token → Permit2 → Universal Router for V4 sell
        _ensureApprovals(token, tokensReceived);

        // 3. Sell tokens on V4 via Universal Router (encoded calldata from keeper)
        universalRouter.execute(v4SellCommands, v4SellInputs, deadline);

        // 4. Verify profit
        uint256 monAfter = address(this).balance;
        require(monAfter >= monBefore + minProfit, "Insufficient profit");

        emit ArbExecuted(token, 0, msg.value, monAfter - monBefore);
    }

    /// @notice Arb: buy tokens on V4 (cheaper), sell on nad.fun (more expensive).
    /// @param token The ERC20 token to arb
    /// @param nadRouter The nad.fun router to use (bonding curve or DEX)
    /// @param minProfit Minimum MON profit required or the tx reverts
    /// @param v4BuyCommands Pre-encoded Universal Router commands for the V4 buy
    /// @param v4BuyInputs Pre-encoded Universal Router inputs for the V4 buy
    /// @param nadFunMinMon Min MON out from nad.fun sell (slippage protection)
    function arbBuyV4SellNad(
        address token,
        address nadRouter,
        uint256 minProfit,
        bytes calldata v4BuyCommands,
        bytes[] calldata v4BuyInputs,
        uint256 nadFunMinMon
    ) external payable onlyOwner nonReentrant {
        uint256 monBefore = address(this).balance - msg.value;

        // 1. Buy tokens on V4 via Universal Router (sends MON as value)
        uint256 deadline = block.timestamp + 300;
        uint256 tokenBalBefore = IERC20(token).balanceOf(address(this));
        universalRouter.execute{value: msg.value}(v4BuyCommands, v4BuyInputs, deadline);
        uint256 tokensReceived = IERC20(token).balanceOf(address(this)) - tokenBalBefore;
        require(tokensReceived > 0, "V4 buy returned 0 tokens");

        // 2. Approve token for nad.fun sell
        IERC20(token).forceApprove(nadRouter, tokensReceived);

        // 3. Sell tokens on nad.fun
        //    Use low-level call since bonding curve router returns void while DEX router returns uint256
        (bool sellSuccess,) = nadRouter.call(
            abi.encodeWithSelector(
                INadFunDexRouter.sell.selector,
                INadFunDexRouter.SellParams({
                    amountIn: tokensReceived,
                    amountOutMin: nadFunMinMon,
                    token: token,
                    to: address(this),
                    deadline: deadline
                })
            )
        );
        require(sellSuccess, "NadFun sell failed");

        // 4. Verify profit
        uint256 monAfter = address(this).balance;
        require(monAfter >= monBefore + minProfit, "Insufficient profit");

        emit ArbExecuted(token, 1, msg.value, monAfter - monBefore);
    }

    /// @dev Ensure token approvals for V4 sell path: token → Permit2 → UniversalRouter
    function _ensureApprovals(address token, uint256 amount) internal {
        // ERC20 → Permit2
        uint256 p2Allowance = IERC20(token).allowance(address(this), PERMIT2);
        if (p2Allowance < amount) {
            IERC20(token).forceApprove(PERMIT2, type(uint256).max);
        }

        // Permit2 → Universal Router (use IPermit2 approve)
        // We set max allowance with far-future expiration
        IPermit2(PERMIT2).approve(token, address(universalRouter), type(uint160).max, type(uint48).max);
    }

    /// @notice Withdraw MON profits
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        (bool sent,) = owner.call{value: balance}("");
        require(sent, "Transfer failed");
    }

    /// @notice Withdraw stuck tokens
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner, balance);
        }
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    receive() external payable {}
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}
