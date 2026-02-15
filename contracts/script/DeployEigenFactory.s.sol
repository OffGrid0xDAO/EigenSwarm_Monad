// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenFactory.sol";

contract DeployEigenFactory is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address launcherAddr = vm.envAddress("EIGENLAUNCHER_ADDRESS");

        vm.startBroadcast(deployerKey);

        EigenFactory factory = new EigenFactory(launcherAddr);
        console.log("EigenFactory deployed at:", address(factory));
        console.log("Launcher:", launcherAddr);

        vm.stopBroadcast();
    }
}
