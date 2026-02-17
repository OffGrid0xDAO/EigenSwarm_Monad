// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenArb.sol";

contract DeployEigenArb is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address universalRouter = vm.envAddress("UNISWAP_V4_ROUTER");

        vm.startBroadcast(deployerKey);

        EigenArb arb = new EigenArb(universalRouter);
        console.log("EigenArb deployed at:", address(arb));
        console.log("Universal Router:", universalRouter);

        vm.stopBroadcast();
    }
}
