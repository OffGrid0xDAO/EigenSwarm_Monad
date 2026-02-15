// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/EigenAtomicLauncher.sol";
import "../src/EigenLP.sol";

contract TestAtomicLaunch is Test {
    address constant DEPLOYER = 0xA7708f216B35A8cCAF7c39486ACFba4934613263;
    address constant BONDING_CURVE_ROUTER = 0x6F6B8F1a20703309951a5127c45B49b1CD981A22;
    address constant POOL_MANAGER = 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e;
    address constant POSITION_MANAGER = 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016;
    address constant EIGENVAULT = 0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b;

    EigenLP newEigenLP;
    EigenAtomicLauncher launcher;

    function setUp() public {
        vm.deal(DEPLOYER, 100 ether);
        vm.startPrank(DEPLOYER);

        // Deploy fresh EigenLP with nextTokenId fix
        newEigenLP = new EigenLP(POOL_MANAGER, POSITION_MANAGER);
        console.log("Fresh EigenLP deployed at:", address(newEigenLP));

        // Set vault on EigenLP
        newEigenLP.setEigenVault(EIGENVAULT);

        // Deploy fresh EigenAtomicLauncher pointing to new EigenLP
        launcher = new EigenAtomicLauncher(
            BONDING_CURVE_ROUTER,
            address(newEigenLP),
            EIGENVAULT,
            10 ether
        );
        console.log("EigenAtomicLauncher deployed at:", address(launcher));

        // Set launcher as approved bundler on new EigenLP
        newEigenLP.setApprovedBundler(address(launcher));

        // Set launcher as approved bundler on EigenVault
        // (DEPLOYER is owner of EigenVault on mainnet fork)
        ISetApprovedBundler(EIGENVAULT).setApprovedBundler(address(launcher));

        vm.stopPrank();
    }

    function testAtomicLaunch() public {
        vm.startPrank(DEPLOYER);

        bytes32 salt = keccak256("test-salt-v5");
        bytes32 eigenId = keccak256("test-eigen-v5");
        uint160 sqrtPriceX96 = 6086388714034984549068811796480; // ~5900 tokens/MON

        console.log("Starting atomicLaunch...");

        address token = launcher.atomicLaunch{value: 12.1 ether}(
            "EigenTestV5",
            "ETV5",
            "https://eigenswarm.com/test",
            salt,
            1,    // actionId
            0,    // minTokensOut
            eigenId,
            sqrtPriceX96,
            500,  // tradingFeeBps
            1 ether,   // devBuyMon
            1 ether,   // lpMon
            0.1 ether, // vaultDepositMon
            DEPLOYER
        );

        console.log("Token created at:", token);

        // Verify: LP position exists
        (uint256 tokenId,, address lpToken,,,) = newEigenLP.getPosition(eigenId);
        console.log("LP tokenId:", tokenId);
        console.log("LP token:", lpToken);
        assertGt(tokenId, 0, "LP position should have a token ID");
        assertEq(lpToken, token, "LP token should match created token");

        vm.stopPrank();
    }
}

interface ISetApprovedBundler {
    function setApprovedBundler(address _bundler) external;
}
