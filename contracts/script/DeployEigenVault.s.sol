// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenVault.sol";

contract DeployEigenVault is Script {
    // Default deploy fee: 5% (500 bps)
    uint256 constant DEPLOY_FEE_BPS = 500;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address keeperAddress = vm.envAddress("KEEPER_ADDRESS");
        address launcherAddr = vm.envAddress("EIGENLAUNCHER_ADDRESS");
        address UNISWAP_V3_ROUTER = vm.envAddress("UNISWAP_V3_ROUTER");
        address UNISWAP_V4_ROUTER = vm.envAddress("UNISWAP_V4_ROUTER");
        address IDENTITY_REGISTRY = vm.envAddress("IDENTITY_REGISTRY");

        vm.startBroadcast(deployerKey);

        EigenVault vault = new EigenVault(keeperAddress, DEPLOY_FEE_BPS, IDENTITY_REGISTRY);
        console.log("EigenVault deployed at:", address(vault));
        console.log("Keeper set to:", keeperAddress);
        console.log("Deploy fee:", DEPLOY_FEE_BPS, "bps");
        console.log("Identity Registry:", IDENTITY_REGISTRY);

        // Approve DEX routers
        vault.setRouterApproval(UNISWAP_V3_ROUTER, true);
        console.log("Approved V3 Router:", UNISWAP_V3_ROUTER);

        vault.setRouterApproval(UNISWAP_V4_ROUTER, true);
        console.log("Approved V4 Router:", UNISWAP_V4_ROUTER);

        // Set approved bundler (EigenLauncher)
        vault.setApprovedBundler(launcherAddr);
        console.log("Approved Bundler (EigenLauncher):", launcherAddr);

        vm.stopBroadcast();
    }
}
