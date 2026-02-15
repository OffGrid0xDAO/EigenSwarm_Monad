// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IPositionManager} from "v4-periphery/interfaces/IPositionManager.sol";
import {IMulticall_v4} from "v4-periphery/interfaces/IMulticall_v4.sol";
import {IPoolInitializer_v4} from "v4-periphery/interfaces/IPoolInitializer_v4.sol";
import {Actions} from "v4-periphery/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title EigenVault interface (minimal — for ownership resolution)
interface IEigenVault {
    function getEigenOwner(bytes32 eigenId) external view returns (address);
    function eigenAgentId(bytes32 eigenId) external view returns (uint256);
}

/// @title EigenLP
/// @notice Creates hook-free Uniswap V4 LP positions for EigenSwarm agents.
///         LP fees from these pools go 100% to the position holder (this contract),
///         bypassing the Clanker 40/40/20 fee split.
contract EigenLP is IERC721Receiver, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────

    uint24 public constant POOL_FEE = 9900; // 0.99%
    int24 public constant TICK_SPACING = 198;

    // Full-range tick bounds (must be multiples of TICK_SPACING)
    int24 public constant TICK_LOWER = -887238; // Largest multiple of 198 <= -887272
    int24 public constant TICK_UPPER = 887238;  // Largest multiple of 198 <= 887272

    // Permit2 (canonical address on all chains)
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ── Immutables ─────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;

    // ── State ──────────────────────────────────────────────────────────

    address public owner;

    struct LPPosition {
        uint256 tokenId;     // PositionManager NFT ID
        PoolKey poolKey;
        bytes32 poolId;
        address token;
        address eigenOwner;
        bytes32 eigenId;
    }

    mapping(bytes32 => LPPosition) public positions; // eigenId => position
    mapping(bytes32 => bool) public autoCompoundEnabled; // eigenId => opt-in for keeper compounding

    // Transient storage for capturing token ID from onERC721Received callback
    uint256 private _lastReceivedTokenId;

    // ── Events ─────────────────────────────────────────────────────────

    event PoolSeeded(bytes32 indexed eigenId, address indexed token, bytes32 poolId, uint256 tokenId);
    event FeesCollected(bytes32 indexed eigenId, uint256 ethAmount, uint256 tokenAmount);
    event FeesCompounded(bytes32 indexed eigenId, uint256 ethCompounded, uint256 tokenCompounded);
    event LiquidityRemoved(bytes32 indexed eigenId, uint256 ethAmount, uint256 tokenAmount);
    event OwnerUpdated(address indexed newOwner);
    event AutoCompoundUpdated(bytes32 indexed eigenId, bool enabled);
    event BundlerUpdated(address indexed bundler);
    event VaultUpdated(address indexed vault);

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyEigenOwnerOrOwner(bytes32 eigenId) {
        require(msg.sender == _resolveEigenOwner(eigenId) || msg.sender == owner, "Not authorized");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────

    constructor(address _poolManager, address _positionManager) {
        poolManager = IPoolManager(_poolManager);
        positionManager = IPositionManager(_positionManager);
        owner = msg.sender;
    }

    // ── Admin ──────────────────────────────────────────────────────────

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "Invalid owner");
        owner = _owner;
        emit OwnerUpdated(_owner);
    }

    // ── Bundler & Vault ────────────────────────────────────────────────

    address public approvedBundler;
    address public eigenVault; // Optional: when set, seedPoolConcentrated verifies vault ownership
    IEigenVault public eigenVaultRef; // When set, ownership follows vault NFT resolution

    /// @notice Approve a bundler contract to call seedPoolFor
    function setApprovedBundler(address _bundler) external onlyOwner {
        approvedBundler = _bundler;
        emit BundlerUpdated(_bundler);
    }

    /// @notice Set the EigenVault V1 address for ownership verification on seedPoolConcentrated.
    function setEigenVault(address _vault) external onlyOwner {
        eigenVault = _vault;
        emit VaultUpdated(_vault);
    }

    /// @notice Set the EigenVault address for dynamic NFT-based ownership resolution.
    ///         Cannot be set to address(0) once configured — would expose stale LP ownership.
    function setEigenVaultRef(address _vault) external onlyOwner {
        require(_vault != address(0), "Cannot clear vault ref");
        eigenVaultRef = IEigenVault(_vault);
    }

    /// @notice Opt in or out of keeper-initiated auto-compounding for an LP position.
    function setAutoCompound(bytes32 eigenId, bool enabled) external {
        require(msg.sender == _resolveEigenOwner(eigenId), "Not eigen owner");
        autoCompoundEnabled[eigenId] = enabled;
        emit AutoCompoundUpdated(eigenId, enabled);
    }

    // ── Ownership Resolution ────────────────────────────────────────

    /// @notice Resolve the current owner of an eigen's LP position.
    ///         If eigenVaultRef is set, ownership follows the vault's NFT-based
    ///         resolution dynamically. Otherwise falls back to the static
    ///         pos.eigenOwner stored at seed time.
    function _resolveEigenOwner(bytes32 eigenId) internal view returns (address) {
        if (address(eigenVaultRef) != address(0)) {
            try eigenVaultRef.getEigenOwner(eigenId) returns (address vaultOwner) {
                if (vaultOwner != address(0)) {
                    return vaultOwner;
                }
            } catch {
                // Vault call failed — fall through to static owner
            }
        }
        return positions[eigenId].eigenOwner;
    }

    // ── Core Functions ─────────────────────────────────────────────────

    /// @notice Create a hook-free V4 pool and seed it with initial liquidity.
    /// @dev Caller sends ETH + approves tokens to this contract before calling.
    ///      Uses native ETH (address(0)) as currency0 since address(0) < any token address.
    /// @param eigenId The eigen identifier (bytes32)
    /// @param token The ERC20 token address
    /// @param sqrtPriceX96 Initial price for the pool (should match Clanker pool price)
    /// @param tokenAmount Amount of tokens to provide as liquidity
    function seedPool(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount
    ) external payable nonReentrant {
        require(positions[eigenId].token == address(0), "Already seeded");
        require(msg.value > 0, "Must send ETH");
        require(tokenAmount > 0, "Must provide tokens");
        require(token != address(0), "Invalid token");
        require(sqrtPriceX96 > 0, "Invalid price");

        // Transfer tokens from caller
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Build pool key: native ETH (address(0)) as currency0, token as currency1
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Approve tokens via Permit2 (V4 PositionManager pulls tokens through Permit2)
        require(tokenAmount <= type(uint160).max, "Token amount exceeds Permit2 limit");
        IERC20(token).forceApprove(PERMIT2, tokenAmount);
        IPermit2(PERMIT2).approve(token, address(positionManager), uint160(tokenAmount), uint48(block.timestamp + 60));

        // Execute multicall (initializePool + mint position)
        _executeSeedMulticall(poolKey, sqrtPriceX96, tokenAmount);

        // Store position
        uint256 tokenId = _getLastTokenId();
        positions[eigenId] = LPPosition({
            tokenId: tokenId,
            poolKey: poolKey,
            poolId: PoolId.unwrap(poolKey.toId()),
            token: token,
            eigenOwner: msg.sender,
            eigenId: eigenId
        });

        // Refund any excess ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // Refund any excess tokens
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }

        emit PoolSeeded(eigenId, token, PoolId.unwrap(poolKey.toId()), tokenId);
    }

    /// @notice Create a hook-free V4 pool on behalf of another address. Only callable by the approved bundler.
    /// @dev Bundler transfers tokens to this contract before calling. Refunds go back to msg.sender (bundler).
    function seedPoolFor(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        address onBehalfOf
    ) external payable nonReentrant {
        require(msg.sender == approvedBundler, "Not bundler");
        require(positions[eigenId].token == address(0), "Already seeded");
        require(msg.value > 0, "Must send ETH");
        require(tokenAmount > 0, "Must provide tokens");
        require(token != address(0), "Invalid token");
        require(sqrtPriceX96 > 0, "Invalid price");
        require(onBehalfOf != address(0), "Invalid owner");

        // Tokens already transferred to this contract by bundler

        // Build pool key: native ETH (address(0)) as currency0, token as currency1
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Approve tokens via Permit2 (V4 PositionManager pulls tokens through Permit2)
        require(tokenAmount <= type(uint160).max, "Token amount exceeds Permit2 limit");
        IERC20(token).forceApprove(PERMIT2, tokenAmount);
        IPermit2(PERMIT2).approve(token, address(positionManager), uint160(tokenAmount), uint48(block.timestamp + 60));

        // Capture next token ID before mint (V4 PositionManager uses _mint, not _safeMint)
        uint256 tokenId = positionManager.nextTokenId();

        // Execute multicall (initializePool + mint position)
        _executeSeedMulticall(poolKey, sqrtPriceX96, tokenAmount);

        // Store position with onBehalfOf as owner
        positions[eigenId] = LPPosition({
            tokenId: tokenId,
            poolKey: poolKey,
            poolId: PoolId.unwrap(poolKey.toId()),
            token: token,
            eigenOwner: onBehalfOf,
            eigenId: eigenId
        });

        // Refund excess ETH to bundler (who will forward to user)
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        // Refund excess tokens to bundler
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }

        emit PoolSeeded(eigenId, token, PoolId.unwrap(poolKey.toId()), tokenId);
    }

    /// @notice Create a hook-free V4 pool with concentrated liquidity (custom tick bounds).
    /// @dev For "add LP later" flow — uses caller-specified tick bounds instead of full range.
    ///      Tick bounds must be multiples of TICK_SPACING (198).
    function seedPoolConcentrated(
        bytes32 eigenId,
        address token,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        int24 tickLower,
        int24 tickUpper
    ) external payable nonReentrant {
        require(positions[eigenId].token == address(0), "Already seeded");
        // Verify caller owns this eigenId (uses vault NFT resolution if available)
        address resolvedOwner = _resolveEigenOwner(eigenId);
        require(resolvedOwner == msg.sender, "Not eigen owner");
        require(msg.value > 0, "Must send ETH");
        require(tokenAmount > 0, "Must provide tokens");
        require(token != address(0), "Invalid token");
        require(sqrtPriceX96 > 0, "Invalid price");
        require(tickLower < tickUpper, "Invalid tick range");
        require(tickLower % TICK_SPACING == 0, "tickLower not aligned");
        require(tickUpper % TICK_SPACING == 0, "tickUpper not aligned");

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Approve tokens via Permit2 (V4 PositionManager pulls tokens through Permit2)
        require(tokenAmount <= type(uint160).max, "Token amount exceeds Permit2 limit");
        IERC20(token).forceApprove(PERMIT2, tokenAmount);
        IPermit2(PERMIT2).approve(token, address(positionManager), uint160(tokenAmount), uint48(block.timestamp + 60));

        // Capture next token ID before mint (V4 PositionManager uses _mint, not _safeMint)
        uint256 tokenId = positionManager.nextTokenId();

        _executeConcentratedSeedMulticall(poolKey, sqrtPriceX96, tokenAmount, tickLower, tickUpper);

        positions[eigenId] = LPPosition({
            tokenId: tokenId,
            poolKey: poolKey,
            poolId: PoolId.unwrap(poolKey.toId()),
            token: token,
            eigenOwner: msg.sender,
            eigenId: eigenId
        });

        // Refund excess
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenBalance);
        }

        emit PoolSeeded(eigenId, token, PoolId.unwrap(poolKey.toId()), tokenId);
    }

    /// @notice Collect accumulated LP fees from a position. Only the eigenOwner can claim.
    /// @dev Uses DECREASE_LIQUIDITY with 0 liquidity delta to collect fees.
    ///      Fees always go to the eigenOwner — keeper/owner cannot claim LP fees.
    function collectFees(bytes32 eigenId, uint128 amount0Min, uint128 amount1Min) external nonReentrant {
        LPPosition storage pos = positions[eigenId];
        require(pos.token != address(0), "Position not found");
        address resolvedOwner = _resolveEigenOwner(eigenId);
        require(msg.sender == resolvedOwner, "Not eigen owner");

        uint256 ethBefore = address(this).balance;
        uint256 tokenBefore = IERC20(pos.token).balanceOf(address(this));

        // Decrease liquidity by 0 to collect fees
        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );

        bytes[] memory actionParams = new bytes[](2);

        // DECREASE_LIQUIDITY params: (uint256 tokenId, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes hookData)
        actionParams[0] = abi.encode(
            pos.tokenId,
            uint256(0),     // 0 liquidity = collect fees only
            amount0Min,     // amount0Min
            amount1Min,     // amount1Min
            bytes("")       // hookData
        );

        // TAKE_PAIR params: (Currency currency0, Currency currency1, address recipient)
        actionParams[1] = abi.encode(
            pos.poolKey.currency0,
            pos.poolKey.currency1,
            address(this)
        );

        bytes memory unlockData = abi.encode(actions, actionParams);
        uint256 deadline = block.timestamp + 300;

        positionManager.modifyLiquidities(unlockData, deadline);

        // Calculate collected amounts
        uint256 ethCollected = address(this).balance - ethBefore;
        uint256 tokenCollected = IERC20(pos.token).balanceOf(address(this)) - tokenBefore;

        // Send to resolved owner (follows NFT if vault is set)
        if (ethCollected > 0) {
            (bool sent, ) = resolvedOwner.call{value: ethCollected}("");
            require(sent, "ETH transfer failed");
        }
        if (tokenCollected > 0) {
            IERC20(pos.token).safeTransfer(resolvedOwner, tokenCollected);
        }

        emit FeesCollected(eigenId, ethCollected, tokenCollected);
    }

    /// @notice Compound accumulated fees back into the LP position (atomic).
    /// @dev Uses DECREASE_LIQUIDITY(0) to collect fees as deltas, then
    ///      INCREASE_LIQUIDITY_FROM_DELTAS to reinvest them in one modifyLiquidities call.
    ///      Callable by eigenOwner directly, or by contract owner (keeper) if autoCompound is enabled.
    function compoundFees(bytes32 eigenId) external nonReentrant onlyEigenOwnerOrOwner(eigenId) {
        LPPosition storage pos = positions[eigenId];
        require(pos.token != address(0), "Position not found");
        // Keeper (owner) can only compound if eigenOwner opted in
        if (msg.sender != _resolveEigenOwner(eigenId)) {
            require(autoCompoundEnabled[eigenId], "Auto-compound not enabled");
        }

        uint256 ethBefore = address(this).balance;
        uint256 tokenBefore = IERC20(pos.token).balanceOf(address(this));

        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.INCREASE_LIQUIDITY_FROM_DELTAS),
            uint8(Actions.CLOSE_CURRENCY),
            uint8(Actions.CLOSE_CURRENCY)
        );

        bytes[] memory actionParams = new bytes[](4);

        // DECREASE_LIQUIDITY(0) = collect fees only, no liquidity removed
        actionParams[0] = abi.encode(pos.tokenId, uint256(0), uint128(0), uint128(0), bytes(""));

        // INCREASE_LIQUIDITY_FROM_DELTAS — reads fee deltas from previous action
        actionParams[1] = abi.encode(pos.tokenId, uint128(0), uint128(0), bytes(""));

        // CLOSE_CURRENCY for each currency (refunds dust back to this contract)
        actionParams[2] = abi.encode(pos.poolKey.currency0);
        actionParams[3] = abi.encode(pos.poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, actionParams), block.timestamp + 300);

        uint256 ethAfter = address(this).balance;
        uint256 tokenAfter = IERC20(pos.token).balanceOf(address(this));

        uint256 ethCompounded = ethBefore > ethAfter ? ethBefore - ethAfter : 0;
        uint256 tokenCompounded = tokenBefore > tokenAfter ? tokenBefore - tokenAfter : 0;

        emit FeesCompounded(eigenId, ethCompounded, tokenCompounded);
    }

    /// @notice Remove all liquidity and burn the position NFT.
    function removeLiquidity(bytes32 eigenId, uint128 amount0Min, uint128 amount1Min) external nonReentrant {
        LPPosition storage pos = positions[eigenId];
        require(pos.token != address(0), "Position not found");
        address resolvedOwner = _resolveEigenOwner(eigenId);
        require(msg.sender == resolvedOwner, "Not eigen owner");

        uint256 ethBefore = address(this).balance;
        uint256 tokenBefore = IERC20(pos.token).balanceOf(address(this));

        // Burn position (automatically decreases liquidity to 0)
        bytes memory actions = abi.encodePacked(
            uint8(Actions.BURN_POSITION),
            uint8(Actions.TAKE_PAIR)
        );

        bytes[] memory actionParams = new bytes[](2);

        // BURN_POSITION params: (uint256 tokenId, uint128 amount0Min, uint128 amount1Min, bytes hookData)
        actionParams[0] = abi.encode(
            pos.tokenId,
            amount0Min,     // amount0Min
            amount1Min,     // amount1Min
            bytes("")       // hookData
        );

        // TAKE_PAIR params: (Currency currency0, Currency currency1, address recipient)
        actionParams[1] = abi.encode(
            pos.poolKey.currency0,
            pos.poolKey.currency1,
            address(this)
        );

        bytes memory unlockData = abi.encode(actions, actionParams);
        uint256 deadline = block.timestamp + 300;

        positionManager.modifyLiquidities(unlockData, deadline);

        // Calculate received amounts
        uint256 ethReceived = address(this).balance - ethBefore;
        uint256 tokenReceived = IERC20(pos.token).balanceOf(address(this)) - tokenBefore;

        address tokenAddr = pos.token;

        // Clear position
        delete positions[eigenId];

        // Send to resolved owner (follows NFT if vault is set)
        if (ethReceived > 0) {
            (bool sent, ) = resolvedOwner.call{value: ethReceived}("");
            require(sent, "ETH transfer failed");
        }
        if (tokenReceived > 0) {
            IERC20(tokenAddr).safeTransfer(resolvedOwner, tokenReceived);
        }

        emit LiquidityRemoved(eigenId, ethReceived, tokenReceived);
    }

    // ── View Functions ─────────────────────────────────────────────────

    /// @notice Get position details for an eigen.
    function getPosition(bytes32 eigenId) external view returns (
        uint256 tokenId,
        bytes32 poolId,
        address token,
        address eigenOwner,
        uint24 fee,
        int24 tickSpacing
    ) {
        LPPosition storage pos = positions[eigenId];
        return (
            pos.tokenId,
            pos.poolId,
            pos.token,
            pos.eigenOwner,
            pos.poolKey.fee,
            pos.poolKey.tickSpacing
        );
    }

    // ── Internal ───────────────────────────────────────────────────────

    /// @dev Build and execute the multicall that initializes the pool and mints the LP position.
    function _executeSeedMulticall(
        PoolKey memory poolKey,
        uint160 sqrtPriceX96,
        uint256 tokenAmount
    ) internal {
        bytes[] memory calls = new bytes[](2);

        // Call 1: Initialize pool
        calls[0] = abi.encodeCall(
            IPoolInitializer_v4.initializePool,
            (poolKey, sqrtPriceX96)
        );

        // Call 2: Mint position
        calls[1] = _buildMintCall(poolKey, sqrtPriceX96, tokenAmount);

        IMulticall_v4(address(positionManager)).multicall{value: msg.value}(calls);
    }

    /// @dev Build the modifyLiquidities call for minting a full-range position.
    function _buildMintCall(
        PoolKey memory poolKey,
        uint160 sqrtPriceX96,
        uint256 tokenAmount
    ) internal view returns (bytes memory) {
        uint256 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            msg.value,
            tokenAmount
        );
        require(liquidity > 0, "Zero liquidity");

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.CLOSE_CURRENCY),
            uint8(Actions.CLOSE_CURRENCY)
        );

        bytes[] memory actionParams = new bytes[](4);
        actionParams[0] = abi.encode(
            poolKey, TICK_LOWER, TICK_UPPER, liquidity,
            uint128(msg.value), uint128(tokenAmount),
            address(this), bytes("")
        );
        actionParams[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        actionParams[2] = abi.encode(poolKey.currency0);
        actionParams[3] = abi.encode(poolKey.currency1);

        return abi.encodeCall(
            IPositionManager.modifyLiquidities,
            (abi.encode(actions, actionParams), block.timestamp + 300)
        );
    }

    /// @dev Build and execute the multicall that initializes a concentrated liquidity pool.
    function _executeConcentratedSeedMulticall(
        PoolKey memory poolKey, uint160 sqrtPriceX96, uint256 tokenAmount,
        int24 tickLower, int24 tickUpper
    ) internal {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IPoolInitializer_v4.initializePool, (poolKey, sqrtPriceX96));
        calls[1] = _buildConcentratedMintCall(poolKey, sqrtPriceX96, tokenAmount, tickLower, tickUpper);
        IMulticall_v4(address(positionManager)).multicall{value: msg.value}(calls);
    }

    /// @dev Build the modifyLiquidities call for minting a concentrated position.
    function _buildConcentratedMintCall(
        PoolKey memory poolKey, uint160 sqrtPriceX96, uint256 tokenAmount,
        int24 tickLower, int24 tickUpper
    ) internal view returns (bytes memory) {
        uint256 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            msg.value, tokenAmount
        );
        require(liquidity > 0, "Zero liquidity");

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR),
            uint8(Actions.CLOSE_CURRENCY), uint8(Actions.CLOSE_CURRENCY)
        );
        bytes[] memory actionParams = new bytes[](4);
        actionParams[0] = abi.encode(
            poolKey, tickLower, tickUpper, liquidity,
            uint128(msg.value), uint128(tokenAmount), address(this), bytes("")
        );
        actionParams[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        actionParams[2] = abi.encode(poolKey.currency0);
        actionParams[3] = abi.encode(poolKey.currency1);

        return abi.encodeCall(
            IPositionManager.modifyLiquidities,
            (abi.encode(actions, actionParams), block.timestamp + 300)
        );
    }

    /// @dev Legacy: was used with onERC721Received callback.
    ///      Now uses positionManager.nextTokenId() before mint instead,
    ///      because V4 PositionManager uses _mint() not _safeMint().
    function _getLastTokenId() internal view returns (uint256) {
        require(_lastReceivedTokenId > 0, "No token received");
        return _lastReceivedTokenId;
    }

    // ── ERC721 Receiver ────────────────────────────────────────────────

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        // Capture token ID from PositionManager mint callback
        _lastReceivedTokenId = tokenId;
        return IERC721Receiver.onERC721Received.selector;
    }

    // ── Receive ETH ────────────────────────────────────────────────────

    receive() external payable {}
}
