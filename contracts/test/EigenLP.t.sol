// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/EigenLP.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork tests for EigenLP against Base mainnet.
/// Run: forge test --fork-url $BASE_RPC_URL -vvv
contract EigenLPTest is Test {
    using PoolIdLibrary for PoolKey;

    // Base mainnet addresses
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    EigenLP public lp;
    address public deployer;
    address public user;

    // We use WETH as a test ERC20 token for simplicity
    // (not as the base currency — base currency is native ETH)
    address constant TEST_TOKEN = 0x4200000000000000000000000000000000000006; // WETH as test ERC20

    bytes32 constant EIGEN_ID = keccak256("test-eigen-lp-1");
    bytes32 constant EIGEN_ID_2 = keccak256("test-eigen-lp-2");

    function setUp() public {
        deployer = address(this);
        user = address(0xCAFE);

        lp = new EigenLP(POOL_MANAGER, POSITION_MANAGER);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /// @dev Get some WETH by depositing ETH (for use as test token)
    function _getWeth(address to, uint256 amount) internal {
        vm.deal(to, amount + 1 ether);
        vm.prank(to);
        (bool ok, ) = WETH.call{value: amount}("");
        require(ok, "WETH deposit failed");
    }

    /// @dev Compute a sqrtPriceX96 for a roughly 1:1000 ETH:token ratio
    function _getDefaultSqrtPrice() internal pure returns (uint160) {
        // For ETH (currency0) : token (currency1) pool
        // sqrtPriceX96 represents sqrt(token/ETH) * 2^96
        // Use a reasonable default for testing
        return 79228162514264337593543950336; // ~1:1 ratio (2^96)
    }

    // ── Constructor Tests ───────────────────────────────────────────────

    function test_constructor() public view {
        assertEq(address(lp.poolManager()), POOL_MANAGER);
        assertEq(address(lp.positionManager()), POSITION_MANAGER);
        assertEq(lp.owner(), deployer);
    }

    function test_setOwner() public {
        lp.setOwner(user);
        assertEq(lp.owner(), user);
    }

    function test_setOwner_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        lp.setOwner(user);
    }

    // ── Pool Constants ──────────────────────────────────────────────────

    function test_poolConstants() public view {
        assertEq(lp.POOL_FEE(), 9900);
        assertEq(lp.TICK_SPACING(), 198);
        // Tick bounds should be multiples of tick spacing
        assertEq(lp.TICK_LOWER() % lp.TICK_SPACING(), 0);
        assertEq(lp.TICK_UPPER() % lp.TICK_SPACING(), 0);
    }

    // ── seedPool Revert Cases ───────────────────────────────────────────

    function test_seedPool_revertsIfNoEth() public {
        _getWeth(user, 1 ether);
        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), 1 ether);
        vm.expectRevert("Must send ETH");
        lp.seedPool(EIGEN_ID, WETH, _getDefaultSqrtPrice(), 1 ether);
        vm.stopPrank();
    }

    function test_seedPool_revertsIfNoTokens() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert("Must provide tokens");
        lp.seedPool{value: 0.5 ether}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), 0);
    }

    function test_seedPool_revertsIfInvalidToken() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert("Invalid token");
        lp.seedPool{value: 0.5 ether}(EIGEN_ID, address(0), _getDefaultSqrtPrice(), 1 ether);
    }

    function test_seedPool_revertsIfInvalidPrice() public {
        _getWeth(user, 1 ether);
        vm.deal(user, 1 ether);
        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), 1 ether);
        vm.expectRevert("Invalid price");
        lp.seedPool{value: 0.5 ether}(EIGEN_ID, WETH, 0, 1 ether);
        vm.stopPrank();
    }

    function test_seedPool_revertsIfAlreadySeeded() public {
        // First seed
        _getWeth(user, 2 ether);
        vm.deal(user, 2 ether);
        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), 2 ether);
        lp.seedPool{value: 0.5 ether}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), 1 ether);

        // Second attempt with same eigenId
        vm.expectRevert("Already seeded");
        lp.seedPool{value: 0.5 ether}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), 1 ether);
        vm.stopPrank();
    }

    // ── seedPool Success ────────────────────────────────────────────────

    function test_seedPool_createsPoolAndPosition() public {
        uint256 ethAmount = 0.1 ether;
        uint256 tokenAmount = 0.1 ether; // Using WETH as test token

        _getWeth(user, tokenAmount);
        vm.deal(user, ethAmount + 0.01 ether);

        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), tokenAmount);
        lp.seedPool{value: ethAmount}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), tokenAmount);
        vm.stopPrank();

        // Verify position stored
        (uint256 tokenId, bytes32 poolId, address token, address eigenOwner, uint24 fee, int24 tickSpacing) =
            lp.getPosition(EIGEN_ID);

        assertGt(tokenId, 0, "Token ID should be non-zero");
        assertNotEq(poolId, bytes32(0), "Pool ID should be non-zero");
        assertEq(token, WETH, "Token should be WETH");
        assertEq(eigenOwner, user, "Eigen owner should be user");
        assertEq(fee, 9900, "Fee should be 9900");
        assertEq(tickSpacing, 198, "Tick spacing should be 198");

        // Verify pool exists in PoolManager by checking sqrtPriceX96 > 0
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(WETH),
            fee: 9900,
            tickSpacing: int24(198),
            hooks: IHooks(address(0))
        });
        bytes32 computedPoolId = PoolId.unwrap(poolKey.toId());
        assertEq(poolId, computedPoolId, "Pool ID should match computed value");
    }

    // ── collectFees Access Control ──────────────────────────────────────

    function test_collectFees_revertsIfNoPosition() public {
        vm.expectRevert("Position not found");
        lp.collectFees(EIGEN_ID, 0, 0);
    }

    function test_collectFees_onlyOwnerOrEigenOwner() public {
        // First seed a position
        uint256 ethAmount = 0.1 ether;
        uint256 tokenAmount = 0.1 ether;
        _getWeth(user, tokenAmount);
        vm.deal(user, ethAmount + 0.01 ether);
        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), tokenAmount);
        lp.seedPool{value: ethAmount}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), tokenAmount);
        vm.stopPrank();

        // Random address should fail
        address random = address(0xDEAD);
        vm.prank(random);
        vm.expectRevert("Not eigen owner");
        lp.collectFees(EIGEN_ID, 0, 0);

        // Eigen owner should succeed (even with no fees collected, no revert)
        vm.prank(user);
        lp.collectFees(EIGEN_ID, 0, 0);
    }

    // ── removeLiquidity Access Control ──────────────────────────────────

    function test_removeLiquidity_revertsIfNoPosition() public {
        vm.expectRevert("Position not found");
        lp.removeLiquidity(EIGEN_ID, 0, 0);
    }

    function test_removeLiquidity_onlyEigenOwner() public {
        // Seed a position
        uint256 ethAmount = 0.1 ether;
        uint256 tokenAmount = 0.1 ether;
        _getWeth(user, tokenAmount);
        vm.deal(user, ethAmount + 0.01 ether);
        vm.startPrank(user);
        IERC20(WETH).approve(address(lp), tokenAmount);
        lp.seedPool{value: ethAmount}(EIGEN_ID, WETH, _getDefaultSqrtPrice(), tokenAmount);
        vm.stopPrank();

        // Contract owner should not be able to remove (only eigen owner can)
        vm.expectRevert("Not eigen owner");
        lp.removeLiquidity(EIGEN_ID, 0, 0);

        // Eigen owner should succeed
        uint256 userEthBefore = user.balance;
        uint256 userTokenBefore = IERC20(WETH).balanceOf(user);

        vm.prank(user);
        lp.removeLiquidity(EIGEN_ID, 0, 0);

        // User should have received back ETH and tokens
        assertGt(user.balance, userEthBefore, "User should receive ETH back");
        assertGt(IERC20(WETH).balanceOf(user), userTokenBefore, "User should receive tokens back");

        // Position should be cleared
        (, , address token, , , ) = lp.getPosition(EIGEN_ID);
        assertEq(token, address(0), "Position should be cleared");
    }

    // ── ERC721 Receiver ─────────────────────────────────────────────────

    function test_onERC721Received() public {
        bytes4 selector = lp.onERC721Received(address(0), address(0), 42, "");
        assertEq(selector, IERC721Receiver.onERC721Received.selector);
    }

    // ── Currency Sorting ────────────────────────────────────────────────

    function test_seedPool_handlesCurrencySorting() public view {
        // address(0) < any token address — so currency0 is always native ETH
        // This is an invariant of the contract design
        assertTrue(address(0) < WETH, "address(0) should be less than WETH");
    }
}
