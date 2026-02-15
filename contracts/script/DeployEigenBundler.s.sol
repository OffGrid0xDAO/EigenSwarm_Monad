// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenBundler.sol";

interface ISetApprovedBundler {
    function setApprovedBundler(address _bundler) external;
}

contract DeployEigenBundler is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address vaultAddr = vm.envAddress("EIGENVAULT_ADDRESS");
        address eigenLPAddr = vm.envAddress("EIGENLP_ADDRESS");

        vm.startBroadcast(deployerKey);

        EigenBundler bundler = new EigenBundler(vaultAddr, eigenLPAddr);
        console.log("EigenBundler deployed at:", address(bundler));
        console.log("Vault:", vaultAddr);
        console.log("EigenLP:", eigenLPAddr);

        // Approve bundler on both contracts
        ISetApprovedBundler(vaultAddr).setApprovedBundler(address(bundler));
        console.log("Approved bundler on EigenVault");

        ISetApprovedBundler(eigenLPAddr).setApprovedBundler(address(bundler));
        console.log("Approved bundler on EigenLP");

        vm.stopBroadcast();
    }
}
