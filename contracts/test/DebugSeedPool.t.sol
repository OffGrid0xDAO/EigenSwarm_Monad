// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/EigenLP.sol";

contract DebugSeedPoolTest is Test {
    address constant KEEPER = 0x42069c220DD72541C2C7Cb7620f2094f1601430A;
    address constant EIGENLP = 0xDA1495458E85Ff371574f61a383C8797CA420A30;
    address constant TOKEN = 0x500eaeb201c63C0D2238c3B0f38D5b170a0d05fa;

    bytes32 constant EIGEN_ID = 0x842a7f9037af0000000000000000000000000000000000000000000000000000;
    uint160 constant SQRT_PRICE = 7973992019920069639858231350894833;
    uint256 constant TOKEN_AMOUNT = 6005334889461479673435028;
    uint256 constant LP_ETH = 0.0003 ether;

    function test_seedPoolDirect() public {
        vm.createSelectFork("https://mainnet.base.org");
        vm.deal(KEEPER, 1 ether);

        vm.startPrank(KEEPER);

        // Approve tokens to EigenLP
        IERC20(TOKEN).approve(EIGENLP, TOKEN_AMOUNT);
        console.log("Allowance:", IERC20(TOKEN).allowance(KEEPER, EIGENLP));

        // Call seedPool directly
        EigenLP(payable(EIGENLP)).seedPool{value: LP_ETH}(
            EIGEN_ID,
            TOKEN,
            SQRT_PRICE,
            TOKEN_AMOUNT
        );

        vm.stopPrank();
        console.log("seedPool succeeded!");
    }
}
