// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/EigenAtomicLauncher.sol";

interface ISetApprovedBundler {
    function setApprovedBundler(address _bundler) external;
}

contract DeployEigenAtomicLauncher is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        address bondingCurveRouter = 0x6F6B8F1a20703309951a5127c45B49b1CD981A22;
        address eigenLPAddr        = 0xEf8b421B15Dd0Aa59392431753029A184F3eEc54;
        address vaultAddr          = 0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b;
        uint256 initialDeployFee   = 10 ether; // 10 MON (nad.fun deploy fee)

        vm.startBroadcast(deployerKey);

        EigenAtomicLauncher launcher = new EigenAtomicLauncher(
            bondingCurveRouter,
            eigenLPAddr,
            vaultAddr,
            initialDeployFee
        );
        console.log("EigenAtomicLauncher deployed at:", address(launcher));
        console.log("BondingCurveRouter:", bondingCurveRouter);
        console.log("EigenLP:", eigenLPAddr);
        console.log("Vault:", vaultAddr);
        console.log("Deploy fee:", initialDeployFee);

        // NOTE: setApprovedBundler must be called manually after deployment:
        //   cast send <VAULT> "setApprovedBundler(address)" <LAUNCHER> ...
        //   cast send <EIGENLP> "setApprovedBundler(address)" <LAUNCHER> ...

        vm.stopBroadcast();
    }
}
