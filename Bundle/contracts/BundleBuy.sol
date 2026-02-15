// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILens {
    function getAmountOut(address _token, uint256 _amountIn, bool _isBuy) 
        external view returns (address router, uint256 amountOut);
}

interface IRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }
    
    function buy(BuyParams calldata params) external payable;
}

/**
 * @title BundleBuy
 * @notice Bundle multiple buy transactions to different recipients in a single transaction
 * @dev Splits MON across multiple recipients for buying the same token
 */
contract BundleBuy {
    ILens public immutable lens;
    
    event BundleBuyExecuted(
        address indexed token,
        uint256 totalMon,
        uint256 recipientCount
    );
    
    error InvalidArrayLength();
    error InvalidMonSent();
    error BuyFailed(uint256 index);
    
    constructor(address _lens) {
        lens = ILens(_lens);
    }
    
    /**
     * @notice Execute bundle buy for multiple recipients
     * @param token Token to buy
     * @param recipients Array of recipient addresses
     * @param monAmounts Array of MON amounts for each recipient
     * @param slippageBps Slippage tolerance in basis points (100 = 1%)
     * @param deadline Transaction deadline
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
        
        // Execute buy for each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            (address router, uint256 expectedOut) = lens.getAmountOut(
                token,
                monAmounts[i],
                true
            );
            
            // Calculate minimum output with slippage
            uint256 amountOutMin = (expectedOut * (10000 - slippageBps)) / 10000;
            
            // Execute buy on the appropriate router
            IRouter.BuyParams memory params = IRouter.BuyParams({
                amountOutMin: amountOutMin,
                token: token,
                to: recipients[i],
                deadline: deadline
            });
            
            (bool success, ) = router.call{value: monAmounts[i]}(
                abi.encodeWithSelector(IRouter.buy.selector, params)
            );
            
            if (!success) {
                revert BuyFailed(i);
            }
        }
        
        emit BundleBuyExecuted(token, msg.value, recipients.length);
    }
    
    // Allow contract to receive MON
    receive() external payable {}
}
