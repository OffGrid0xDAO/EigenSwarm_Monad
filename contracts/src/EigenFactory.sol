// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IEigenLauncherFactory {
    function launch(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        uint256 tradingFeeBps,
        uint256 vaultDepositEth,
        string calldata agentURI,
        address onBehalfOf
    ) external payable returns (uint256 agentId);
}

/// @title EigenFactory
/// @notice Atomic token deployment + LP + vault + ERC-8004 agent in a single transaction.
///         Eliminates the front-running window between Clanker deploy and LP seed.
///
///         Transaction flow (all in one tx):
///         1. Call Clanker factory with pre-encoded calldata → deploys token + pool + dev buy
///         2. Tokens from dev buy land in this contract (devBuy.recipient = this)
///         3. Forward tokens + ETH to EigenLauncher.launch() → seeds LP + vault + 8004
///         4. Refund excess ETH/tokens to caller
contract EigenFactory is IERC721Receiver, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IEigenLauncherFactory public launcher;

    event LauncherUpdated(address indexed oldLauncher, address indexed newLauncher);

    constructor(address _launcher) Ownable(msg.sender) {
        launcher = IEigenLauncherFactory(_launcher);
    }

    function setLauncher(address _launcher) external onlyOwner {
        emit LauncherUpdated(address(launcher), _launcher);
        launcher = IEigenLauncherFactory(_launcher);
    }

    /// @notice Atomically deploy a token via Clanker and launch LP + vault + 8004 agent.
    /// @dev The keeper builds the Clanker calldata off-chain using the SDK's getDeployTransaction(),
    ///      setting devBuy.recipient to this contract. The sqrtPriceX96 is pre-calculated
    ///      from the known initial tick + dev buy impact.
    ///
    /// @param clankerFactory Address of the Clanker V4 factory
    /// @param clankerCalldata Pre-encoded deployToken() calldata (from SDK)
    /// @param clankerEthValue ETH for the Clanker dev buy (forwarded to factory)
    /// @param expectedToken Predicted token address (CREATE2, from SDK)
    /// @param sqrtPriceX96 Initial price for EigenLP pool (pre-calculated by keeper)
    /// @param eigenId Eigen identifier (bytes32)
    /// @param tradingFeeBps Trading fee rate (basis points)
    /// @param vaultDepositEth ETH to deposit into the vault for market making
    /// @param agentURI JSON agent card for ERC-8004 registration
    /// @param onBehalfOf Address that will own the eigen + 8004 NFT
    /// @return tokenAddress The deployed token address
    /// @return agentId The minted 8004 agent NFT ID
    function deployAndLaunch(
        address clankerFactory,
        bytes calldata clankerCalldata,
        uint256 clankerEthValue,
        address expectedToken,
        uint160 sqrtPriceX96,
        bytes32 eigenId,
        uint256 tradingFeeBps,
        uint256 vaultDepositEth,
        string calldata agentURI,
        address onBehalfOf
    ) external payable nonReentrant onlyOwner returns (address tokenAddress, uint256 agentId) {
        require(msg.value >= clankerEthValue + vaultDepositEth, "Insufficient ETH");
        require(onBehalfOf != address(0), "Invalid owner");
        uint256 lpEth = msg.value - clankerEthValue - vaultDepositEth;
        require(lpEth > 0, "No ETH for LP");

        // 1. Deploy token via Clanker factory (creates token + pool + dev buy atomically)
        (bool success, bytes memory returnData) = clankerFactory.call{value: clankerEthValue}(clankerCalldata);
        require(success, "Clanker deploy failed");

        // Decode the returned token address from deployToken()
        tokenAddress = abi.decode(returnData, (address));

        // Sanity check: verify against predicted address
        if (expectedToken != address(0)) {
            require(tokenAddress == expectedToken, "Token address mismatch");
        }

        // 2. Get tokens from dev buy (devBuy.recipient was set to this contract)
        uint256 tokenBal = IERC20(tokenAddress).balanceOf(address(this));
        require(tokenBal > 0, "No tokens from dev buy");

        // 3. Approve tokens to EigenLauncher
        IERC20(tokenAddress).forceApprove(address(launcher), tokenBal);

        // 4. Atomic LP + vault + 8004 via EigenLauncher
        agentId = launcher.launch{value: lpEth + vaultDepositEth}(
            eigenId,
            tokenAddress,
            sqrtPriceX96,
            tokenBal,
            tradingFeeBps,
            vaultDepositEth,
            agentURI,
            onBehalfOf
        );

        // 5. Refund excess ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // 6. Refund excess tokens
        uint256 remainingTokens = IERC20(tokenAddress).balanceOf(address(this));
        if (remainingTokens > 0) {
            IERC20(tokenAddress).safeTransfer(msg.sender, remainingTokens);
        }
    }

    // ── ERC721 Receiver (for 8004 NFT pass-through) ─────────────────────

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
