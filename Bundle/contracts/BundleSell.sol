// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface ILens {
    function getAmountOut(address _token, uint256 _amountIn, bool _isBuy)
        external view returns (address router, uint256 amountOut);
}

interface IRouterSell {
    struct SellParams {
        uint256 amountIn;
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }
    function sell(SellParams calldata params) external;
}

/**
 * @title BundleSell
 * @notice Pull tokens from multiple wallets and sell in one transaction.
 * Use bundleSell() when wallets have already approved this contract (each wallet needs MON for gas).
 * Use bundleSellWithPermits() with EIP-2612 permit signatures so only the caller needs MON for gas.
 */
contract BundleSell {
    ILens public immutable lens;

    event BundleSellExecuted(address indexed token, uint256 totalTokens, uint256 sellerCount, uint256 monToRecipient);

    error InvalidArrayLength();
    error TransferFailed(uint256 index);
    error SellFailed();
    error MONTransferFailed();

    constructor(address _lens) {
        lens = ILens(_lens);
    }

    /**
     * @notice Pull tokens from each `froms[i]` (must have approved this contract for `amounts[i]`), then sell combined amount in one go. MON goes to msg.sender.
     * @param token Token to sell
     * @param froms Addresses that approved this contract (the bundle wallets)
     * @param amounts Amount to pull from each
     * @param slippageBps Slippage in basis points (100 = 1%)
     * @param deadline Deadline for the router sell
     */
    function bundleSell(
        address token,
        address[] calldata froms,
        uint256[] calldata amounts,
        uint256 slippageBps,
        uint256 deadline
    ) external {
        if (froms.length == 0 || froms.length != amounts.length) revert InvalidArrayLength();

        uint256 total;
        for (uint256 i = 0; i < froms.length; i++) {
            if (amounts[i] == 0) continue;
            bool ok = IERC20(token).transferFrom(froms[i], address(this), amounts[i]);
            if (!ok) revert TransferFailed(i);
            total += amounts[i];
        }
        if (total == 0) return;

        (address router, uint256 expectedMon) = lens.getAmountOut(token, total, false);
        uint256 amountOutMin = (expectedMon * (10000 - slippageBps)) / 10000;

        IERC20(token).approve(router, total);

        (bool success, ) = router.call(
            abi.encodeWithSelector(
                IRouterSell.sell.selector,
                IRouterSell.SellParams({
                    amountIn: total,
                    amountOutMin: amountOutMin,
                    token: token,
                    to: msg.sender,
                    deadline: deadline
                })
            )
        );
        if (!success) revert SellFailed();

        uint256 monBalance = address(this).balance;
        if (monBalance > 0) {
            (bool sent, ) = msg.sender.call{value: monBalance}("");
            if (!sent) revert MONTransferFailed();
        }

        emit BundleSellExecuted(token, total, froms.length, expectedMon);
    }

    /**
     * @notice Same as bundleSell but uses EIP-2612 permits so bundle wallets need no MON for gas. Caller pays gas and receives MON.
     * @param token Token (must support permit)
     * @param froms Addresses signing the permits (bundle wallets)
     * @param amounts Amount each allows this contract to pull
     * @param permitDeadline Deadline for all permits (same for each)
     * @param v,r,s Permit signature components (one per from)
     * @param slippageBps Slippage in basis points
     * @param deadline Deadline for the router sell
     */
    function bundleSellWithPermits(
        address token,
        address[] calldata froms,
        uint256[] calldata amounts,
        uint256 permitDeadline,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 slippageBps,
        uint256 deadline
    ) external {
        uint256 n = froms.length;
        if (n == 0 || n != amounts.length || n != v.length || n != r.length || n != s.length) revert InvalidArrayLength();

        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] == 0) continue;
            IERC20Permit(token).permit(froms[i], address(this), amounts[i], permitDeadline, v[i], r[i], s[i]);
        }

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] == 0) continue;
            bool ok = IERC20(token).transferFrom(froms[i], address(this), amounts[i]);
            if (!ok) revert TransferFailed(i);
            total += amounts[i];
        }
        if (total == 0) return;

        (address router, uint256 expectedMon) = lens.getAmountOut(token, total, false);
        uint256 amountOutMin = (expectedMon * (10000 - slippageBps)) / 10000;

        IERC20(token).approve(router, total);

        (bool success, ) = router.call(
            abi.encodeWithSelector(
                IRouterSell.sell.selector,
                IRouterSell.SellParams({
                    amountIn: total,
                    amountOutMin: amountOutMin,
                    token: token,
                    to: msg.sender,
                    deadline: deadline
                })
            )
        );
        if (!success) revert SellFailed();

        uint256 monBalance = address(this).balance;
        if (monBalance > 0) {
            (bool sent, ) = msg.sender.call{value: monBalance}("");
            if (!sent) revert MONTransferFailed();
        }

        emit BundleSellExecuted(token, total, n, expectedMon);
    }
}
