// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenLP.sol";

contract DeployEigenLP is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address POOL_MANAGER = vm.envAddress("POOL_MANAGER");
        address POSITION_MANAGER = vm.envAddress("POSITION_MANAGER");

        vm.startBroadcast(deployerKey);

        EigenLP lp = new EigenLP(POOL_MANAGER, POSITION_MANAGER);
        console.log("EigenLP deployed at:", address(lp));
        console.log("PoolManager:", POOL_MANAGER);
        console.log("PositionManager:", POSITION_MANAGER);

        vm.stopBroadcast();
    }
}
