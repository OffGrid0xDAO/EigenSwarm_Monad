// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IEigenVaultLauncher {
    function createEigenFor(bytes32 eigenId, uint256 tradingFeeBps, address onBehalfOf) external payable;
}

interface IEigenLPLauncher {
    function seedPoolFor(
        bytes32 eigenId, address token, uint160 sqrtPriceX96,
        uint256 tokenAmount, address onBehalfOf
    ) external payable;
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

/// @title EigenAtomicLauncher
/// @notice Atomic token creation on nad.fun + V4 LP seeding + EigenVault creation in one tx.
///
///         Transaction flow:
///         1. BondingCurveRouter.create{value: deployFee}(params) → create token on bonding curve
///         2. BondingCurveRouter.buy{value: devBuyMon}(to: this) → buy tokens via bonding curve
///         3. Transfer all tokens from this contract to EigenLP
///         4. EigenLP.seedPoolFor{value: lpMon}() → create V4 pool + LP position
///         5. EigenVault.createEigenFor{value: vaultDepositMon}() → create vault (address-based ownership)
///         6. Refund excess MON + tokens to msg.sender
contract EigenAtomicLauncher is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IBondingCurveRouter public bondingCurveRouter;
    IEigenLPLauncher public eigenLP;
    IEigenVaultLauncher public vault;
    uint256 public deployFee;

    event AtomicLaunch(
        address indexed token,
        bytes32 indexed eigenId,
        address indexed onBehalfOf,
        uint256 devBuyMon,
        uint256 lpMon,
        uint256 vaultDepositMon
    );
    event BondingCurveRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event EigenLPUpdated(address indexed oldLP, address indexed newLP);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event DeployFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(
        address _bondingCurveRouter,
        address _eigenLP,
        address _vault,
        uint256 _deployFee
    ) Ownable(msg.sender) {
        bondingCurveRouter = IBondingCurveRouter(_bondingCurveRouter);
        eigenLP = IEigenLPLauncher(_eigenLP);
        vault = IEigenVaultLauncher(_vault);
        deployFee = _deployFee;
    }

    // ── Admin setters ────────────────────────────────────────────────────

    function setBondingCurveRouter(address _bondingCurveRouter) external onlyOwner {
        emit BondingCurveRouterUpdated(address(bondingCurveRouter), _bondingCurveRouter);
        bondingCurveRouter = IBondingCurveRouter(_bondingCurveRouter);
    }

    function setEigenLP(address _eigenLP) external onlyOwner {
        emit EigenLPUpdated(address(eigenLP), _eigenLP);
        eigenLP = IEigenLPLauncher(_eigenLP);
    }

    function setVault(address _vault) external onlyOwner {
        emit VaultUpdated(address(vault), _vault);
        vault = IEigenVaultLauncher(_vault);
    }

    function setDeployFee(uint256 _deployFee) external onlyOwner {
        emit DeployFeeUpdated(deployFee, _deployFee);
        deployFee = _deployFee;
    }

    // ── Core ─────────────────────────────────────────────────────────────

    /// @notice Atomically create a token on nad.fun, seed V4 LP, and create an EigenVault.
    /// @param name Token name for nad.fun
    /// @param symbol Token symbol for nad.fun
    /// @param tokenURI Metadata URI for nad.fun
    /// @param salt Salt for nad.fun token creation (from mineSalt API or random)
    /// @param actionId 1 for nad.fun official flow, 0 otherwise
    /// @param minTokensOut Minimum tokens from dev buy (slippage protection, 0 to skip)
    /// @param eigenId Unique identifier for the Eigen vault + LP position
    /// @param sqrtPriceX96 Initial price for the V4 pool
    /// @param tradingFeeBps Trading fee for the vault in basis points (e.g. 500 = 5%)
    /// @param devBuyMon MON to spend buying tokens via bonding curve
    /// @param lpMon MON for the ETH side of V4 LP
    /// @param vaultDepositMon MON to deposit into the vault
    /// @param onBehalfOf Address that will own the vault + LP position
    /// @return token The address of the created token
    function atomicLaunch(
        string calldata name,
        string calldata symbol,
        string calldata tokenURI,
        bytes32 salt,
        uint8 actionId,
        uint256 minTokensOut,
        bytes32 eigenId,
        uint160 sqrtPriceX96,
        uint256 tradingFeeBps,
        uint256 devBuyMon,
        uint256 lpMon,
        uint256 vaultDepositMon,
        address onBehalfOf
    ) external payable nonReentrant returns (address token) {
        require(onBehalfOf != address(0), "Invalid owner");
        require(msg.value >= deployFee + devBuyMon + lpMon + vaultDepositMon, "Insufficient MON");
        require(devBuyMon > 0, "No MON for dev buy");
        require(lpMon > 0, "No MON for LP");

        // 1. Create token on nad.fun bonding curve (deploy fee only, no buy)
        (token, ) = bondingCurveRouter.create{value: deployFee}(
            IBondingCurveRouter.TokenCreationParams({
                name: name,
                symbol: symbol,
                tokenURI: tokenURI,
                amountOut: 0,
                salt: salt,
                actionId: actionId
            })
        );
        require(token != address(0), "Token creation failed");

        // 2. Buy tokens on bonding curve → tokens sent to address(this)
        bondingCurveRouter.buy{value: devBuyMon}(
            IBondingCurveRouter.BuyParams({
                amountOutMin: minTokensOut,
                token: token,
                to: address(this),
                deadline: block.timestamp
            })
        );

        // 3. Transfer all bought tokens to EigenLP for pool seeding
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        require(tokenBalance > 0, "No tokens from buy");
        IERC20(token).safeTransfer(address(eigenLP), tokenBalance);

        // 4. Seed V4 LP pool (tokens already at eigenLP)
        eigenLP.seedPoolFor{value: lpMon}(eigenId, token, sqrtPriceX96, tokenBalance, onBehalfOf);

        // 5. Create vault with address-based ownership (no 8004 agent)
        vault.createEigenFor{value: vaultDepositMon}(eigenId, tradingFeeBps, onBehalfOf);

        // 6. Refund excess MON
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "MON refund failed");
        }

        // 7. Refund any leftover tokens (shouldn't happen, but safety)
        uint256 remainingTokens = IERC20(token).balanceOf(address(this));
        if (remainingTokens > 0) {
            IERC20(token).safeTransfer(msg.sender, remainingTokens);
        }

        emit AtomicLaunch(token, eigenId, onBehalfOf, devBuyMon, lpMon, vaultDepositMon);
    }

    /// @notice Rescue stuck tokens (emergency only)
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue stuck MON (emergency only)
    function rescueMon(address to, uint256 amount) external onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "MON rescue failed");
    }

    receive() external payable {}
}
