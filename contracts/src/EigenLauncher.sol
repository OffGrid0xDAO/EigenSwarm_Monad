// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IEigenVaultLauncher {
    function createEigenFor(bytes32 eigenId, uint256 tradingFeeBps, address onBehalfOf) external payable;
    function createEigenForWithAgent(bytes32 eigenId, uint256 agentId, uint256 tradingFeeBps, address onBehalfOf) external payable;
}

interface IEigenLPLauncher {
    function seedPoolFor(
        bytes32 eigenId, address token, uint160 sqrtPriceX96,
        uint256 tokenAmount, address onBehalfOf
    ) external payable;
}

interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title EigenLauncher
/// @notice Atomic LP + Vault + ERC-8004 agent registration in a single transaction.
///         Replaces EigenBundler for launches that include 8004 agent minting.
///
///         Transaction flow:
///         1. Pull tokens from keeper → send to EigenLP
///         2. EigenLP.seedPoolFor() — create V4 pool + LP position
///         3. IdentityRegistry.register(agentURI) — mint 8004 NFT to this contract
///         4. EigenVault.createEigenForWithAgent() — create vault with agent binding
///         5. Transfer 8004 NFT from this contract to onBehalfOf (the user)
///         6. Refund excess ETH/tokens to caller
contract EigenLauncher is IERC721Receiver, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IEigenVaultLauncher public vault;
    IEigenLPLauncher public eigenLP;
    IIdentityRegistry public identityRegistry;

    /// @dev Captures the agent NFT ID from the onERC721Received callback during register().
    uint256 private _lastReceivedAgentId;

    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event EigenLPUpdated(address indexed oldLP, address indexed newLP);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    constructor(address _vault, address _eigenLP, address _identityRegistry) Ownable(msg.sender) {
        vault = IEigenVaultLauncher(_vault);
        eigenLP = IEigenLPLauncher(_eigenLP);
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    function setVault(address _vault) external onlyOwner {
        emit VaultUpdated(address(vault), _vault);
        vault = IEigenVaultLauncher(_vault);
    }

    function setEigenLP(address _eigenLP) external onlyOwner {
        emit EigenLPUpdated(address(eigenLP), _eigenLP);
        eigenLP = IEigenLPLauncher(_eigenLP);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        emit IdentityRegistryUpdated(address(identityRegistry), _identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    /// @notice Atomically seed LP pool, mint 8004 agent, and create vault with agent binding.
    /// @dev Caller must approve `tokenAmount` of `token` to this contract before calling.
    ///      msg.value must equal lpEth + vaultDepositEth.
    /// @param eigenId The eigen identifier (bytes32)
    /// @param token The ERC20 token address for the LP pool
    /// @param sqrtPriceX96 Initial price for the pool
    /// @param tokenAmount Amount of tokens to provide as LP liquidity
    /// @param tradingFeeBps Trading fee rate for the eigen (basis points)
    /// @param vaultDepositEth Amount of ETH to deposit into the vault
    /// @param agentURI JSON agent card URI for the 8004 registration
    /// @param onBehalfOf Address that will own the eigen and receive the 8004 NFT
    /// @return agentId The minted 8004 agent NFT ID
    function launch(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        uint256 tradingFeeBps,
        uint256 vaultDepositEth,
        string calldata agentURI,
        address onBehalfOf
    ) external payable nonReentrant returns (uint256 agentId) {
        require(msg.value >= vaultDepositEth, "Insufficient ETH");
        require(onBehalfOf != address(0), "Invalid owner");
        uint256 lpEth = msg.value - vaultDepositEth;
        require(lpEth > 0, "No ETH for LP");

        // 1. Pull tokens from caller and send directly to EigenLP
        IERC20(token).safeTransferFrom(msg.sender, address(eigenLP), tokenAmount);

        // 2. Seed LP pool (tokens already at eigenLP, send ETH portion)
        eigenLP.seedPoolFor{value: lpEth}(eigenId, token, sqrtPriceX96, tokenAmount, onBehalfOf);

        // 3. Mint 8004 agent NFT (minted to this contract via onERC721Received)
        _lastReceivedAgentId = 0;
        agentId = identityRegistry.register(agentURI);

        // 4. Create vault with agent binding (bundler owns the NFT at this point)
        vault.createEigenForWithAgent{value: vaultDepositEth}(eigenId, agentId, tradingFeeBps, onBehalfOf);

        // 5. Transfer 8004 NFT to the user
        identityRegistry.transferFrom(address(this), onBehalfOf, agentId);

        // 6. Refund any excess ETH returned by eigenLP
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // 7. Refund any excess tokens returned by eigenLP
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }
    }

    /// @notice Atomic LP seed + vault deposit WITHOUT 8004 agent registration.
    ///         Matches the old EigenBundler.launch() behavior for non-8004 launches.
    function launchWithoutAgent(
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

        // 1. Pull tokens from caller and send directly to EigenLP
        IERC20(token).safeTransferFrom(msg.sender, address(eigenLP), tokenAmount);

        // 2. Seed LP pool
        eigenLP.seedPoolFor{value: lpEth}(eigenId, token, sqrtPriceX96, tokenAmount, msg.sender);

        // 3. Create eigen in vault (address-based ownership)
        vault.createEigenFor{value: vaultDepositEth}(eigenId, tradingFeeBps, msg.sender);

        // 4. Refund excess ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // 5. Refund excess tokens
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }
    }

    // ── ERC721 Receiver ────────────────────────────────────────────────

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        _lastReceivedAgentId = tokenId;
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
