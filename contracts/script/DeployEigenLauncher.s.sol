// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenLauncher.sol";

interface ISetApprovedBundler {
    function setApprovedBundler(address _bundler) external;
}

contract DeployEigenLauncher is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address vaultAddr = vm.envAddress("EIGENVAULT_ADDRESS");
        address eigenLPAddr = vm.envAddress("EIGENLP_ADDRESS");
        address IDENTITY_REGISTRY = vm.envAddress("IDENTITY_REGISTRY");

        vm.startBroadcast(deployerKey);

        EigenLauncher launcher = new EigenLauncher(vaultAddr, eigenLPAddr, IDENTITY_REGISTRY);
        console.log("EigenLauncher deployed at:", address(launcher));
        console.log("Vault:", vaultAddr);
        console.log("EigenLP:", eigenLPAddr);
        console.log("Identity Registry:", IDENTITY_REGISTRY);

        // Approve launcher as bundler on both contracts
        ISetApprovedBundler(vaultAddr).setApprovedBundler(address(launcher));
        console.log("Approved launcher on EigenVault");

        ISetApprovedBundler(eigenLPAddr).setApprovedBundler(address(launcher));
        console.log("Approved launcher on EigenLP");

        vm.stopBroadcast();
    }
}
