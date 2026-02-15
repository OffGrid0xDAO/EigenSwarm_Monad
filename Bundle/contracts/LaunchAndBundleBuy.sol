// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILens {
    function getAmountOut(address _token, uint256 _amountIn, bool _isBuy)
        external view returns (address router, uint256 amountOut);
}

interface IBondingCurveRouter {
    struct TokenCreationParams {
        string name;
        string symbol;
        string tokenURI;
        uint256 amountOut;
        bytes32 salt;
        uint8 actionId;
    }
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }
    function create(TokenCreationParams calldata params) external payable returns (address token, address pool);
    function buy(BuyParams calldata params) external payable;
}

/**
 * @title LaunchAndBundleBuy
 * @notice Single contract: launch + distribute in one tx, or bundle buy for an existing token.
 * Uses nad.fun BONDING_CURVE_ROUTER.create() and Lens.getAmountOut + router.buy() (native MON).
 * Nad.fun docs: they only support tokens launched via their frontend or official API; create()
 * may revert or tokens may not appear on their site if called from third-party contracts.
 */
contract LaunchAndBundleBuy {
    ILens public immutable lens;
    IBondingCurveRouter public immutable bondingCurveRouter;
    uint256 public constant DEPLOY_FEE = 10 ether; // 10 MON

    event TokenLaunchedAndDistributed(
        address indexed token,
        address indexed creator,
        uint256 recipientCount,
        uint256 totalDistributed
    );

    event BundleBuyExecuted(
        address indexed token,
        uint256 totalMon,
        uint256 recipientCount
    );

    error InvalidArrayLength();
    error InvalidValue();
    error InvalidMonSent();
    error CreateFailed();
    error BuyFailed(uint256 index);

    constructor(address _lens, address _bondingCurveRouter) {
        lens = ILens(_lens);
        bondingCurveRouter = IBondingCurveRouter(_bondingCurveRouter);
    }

    /**
     * @notice Launch a token and buy for multiple recipients in one transaction
     * @param name Token name
     * @param symbol Token symbol
     * @param tokenURI Metadata URI (use nad.fun API metadata URI for official support)
     * @param salt Salt from nad.fun API mineSalt (or random for non-official)
     * @param actionId Use 1 when using nad.fun official API flow, 0 otherwise
     * @param recipients Recipient addresses
     * @param monAmounts MON amount per recipient
     * @param slippageBps Slippage in basis points (100 = 1%)
     * @param deadline Deadline timestamp
     */
    function launchAndDistribute(
        string calldata name,
        string calldata symbol,
        string calldata tokenURI,
        bytes32 salt,
        uint8 actionId,
        address[] calldata recipients,
        uint256[] calldata monAmounts,
        uint256 slippageBps,
        uint256 deadline
    ) external payable {
        if (recipients.length == 0 || recipients.length != monAmounts.length) {
            revert InvalidArrayLength();
        }

        uint256 totalBuy = 0;
        for (uint256 i = 0; i < monAmounts.length; i++) {
            totalBuy += monAmounts[i];
        }

        if (msg.value != DEPLOY_FEE + totalBuy) {
            revert InvalidValue();
        }

        // 1. Create token (no initial buy - we distribute to recipients instead)
        (address token, ) = bondingCurveRouter.create{value: DEPLOY_FEE}(
            IBondingCurveRouter.TokenCreationParams({
                name: name,
                symbol: symbol,
                tokenURI: tokenURI,
                amountOut: 0,
                salt: salt,
                actionId: actionId
            })
        );

        if (token == address(0)) revert CreateFailed();

        // 2. Buy for each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            (address router, uint256 expectedOut) = lens.getAmountOut(token, monAmounts[i], true);
            uint256 amountOutMin = (expectedOut * (10000 - slippageBps)) / 10000;

            (bool success, ) = router.call{value: monAmounts[i]}(
                abi.encodeWithSelector(
                    IBondingCurveRouter.buy.selector,
                    IBondingCurveRouter.BuyParams({
                        amountOutMin: amountOutMin,
                        token: token,
                        to: recipients[i],
                        deadline: deadline
                    })
                )
            );

            if (!success) revert BuyFailed(i);
        }

        emit TokenLaunchedAndDistributed(token, msg.sender, recipients.length, totalBuy);
    }

    /**
     * @notice Bundle buy: buy an existing token for multiple recipients in one transaction
     * @param token Existing token address
     * @param recipients Recipient addresses
     * @param monAmounts MON amount per recipient
     * @param slippageBps Slippage in basis points (100 = 1%)
     * @param deadline Deadline timestamp
     */
    function bundleBuy(
        address token,
        address[] calldata recipients,
        uint256[] calldata monAmounts,
        uint256 slippageBps,
        uint256 deadline
    ) external payable {
        if (recipients.length == 0 || recipients.length != monAmounts.length) {
            revert InvalidArrayLength();
        }

        uint256 totalRequired = 0;
        for (uint256 i = 0; i < monAmounts.length; i++) {
            totalRequired += monAmounts[i];
        }

        if (msg.value != totalRequired) {
            revert InvalidMonSent();
        }

        for (uint256 i = 0; i < recipients.length; i++) {
            (address router, uint256 expectedOut) = lens.getAmountOut(token, monAmounts[i], true);
            uint256 amountOutMin = (expectedOut * (10000 - slippageBps)) / 10000;

            (bool success, ) = router.call{value: monAmounts[i]}(
                abi.encodeWithSelector(
                    IBondingCurveRouter.buy.selector,
                    IBondingCurveRouter.BuyParams({
                        amountOutMin: amountOutMin,
                        token: token,
                        to: recipients[i],
                        deadline: deadline
                    })
                )
            );

            if (!success) revert BuyFailed(i);
        }

        emit BundleBuyExecuted(token, msg.value, recipients.length);
    }

    receive() external payable {}
}
