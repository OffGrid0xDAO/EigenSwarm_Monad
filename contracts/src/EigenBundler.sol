// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IEigenVault {
    function createEigenFor(bytes32 eigenId, uint256 tradingFeeBps, address onBehalfOf) external payable;
}

interface IEigenLP {
    function seedPoolFor(
        bytes32 eigenId, address token, uint160 sqrtPriceX96,
        uint256 tokenAmount, address onBehalfOf
    ) external payable;
}

/// @title EigenBundler
/// @notice Bundles seedPool + createEigen into a single atomic transaction.
///         User approves tokens to this contract, then calls launch() once.
///         If any step fails, the entire transaction reverts — no stranded funds.
contract EigenBundler is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IEigenVault public immutable vault;
    IEigenLP public immutable eigenLP;

    constructor(address _vault, address _eigenLP) {
        vault = IEigenVault(_vault);
        eigenLP = IEigenLP(_eigenLP);
    }

    /// @notice Atomically seed an LP pool and create an eigen in the vault.
    /// @dev Caller must approve `tokenAmount` of `token` to this contract before calling.
    ///      msg.value must equal lpEth + vaultDepositEth.
    /// @param eigenId The eigen identifier (bytes32)
    /// @param token The ERC20 token address for the LP pool
    /// @param sqrtPriceX96 Initial price for the pool
    /// @param tokenAmount Amount of tokens to provide as LP liquidity
    /// @param tradingFeeBps Trading fee rate for the eigen (basis points)
    /// @param vaultDepositEth Amount of ETH to deposit into the vault for the eigen
    function launch(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        uint256 tradingFeeBps,
        uint256 vaultDepositEth
    ) external payable nonReentrant {
        require(msg.value >= vaultDepositEth, "Insufficient ETH");
        uint256 lpEth = msg.value - vaultDepositEth;
        require(lpEth > 0, "No ETH for LP");

        // 1. Pull tokens from user and send directly to EigenLP
        IERC20(token).safeTransferFrom(msg.sender, address(eigenLP), tokenAmount);

        // 2. Seed LP pool (tokens already at eigenLP, send ETH portion)
        eigenLP.seedPoolFor{value: lpEth}(eigenId, token, sqrtPriceX96, tokenAmount, msg.sender);

        // 3. Create eigen in vault (send vault deposit ETH)
        vault.createEigenFor{value: vaultDepositEth}(eigenId, tradingFeeBps, msg.sender);

        // 4. Refund any excess ETH returned by eigenLP
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // 5. Refund any excess tokens returned by eigenLP
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }
    }

    receive() external payable {}
}
