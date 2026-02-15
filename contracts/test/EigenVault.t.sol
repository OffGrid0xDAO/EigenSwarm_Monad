// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/EigenVault.sol";

contract MockRouter {
    receive() external payable {}
    fallback() external payable {}
}

contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }
    function setOwner(uint256 agentId, address owner_) external {
        owners[agentId] = owner_;
    }
    function mint(address to, uint256 agentId) external {
        owners[agentId] = to;
    }
    function transferFrom(address from, address to, uint256 agentId) external {
        require(owners[agentId] == from, "Not owner");
        owners[agentId] = to;
    }
}

contract EigenVaultTest is Test {
    EigenVault vault;
    MockRouter router;
    MockIdentityRegistry registry;

    address owner = address(this);
    address keeper = address(0xBEEF);
    address user = address(0xCAFE);

    bytes32 eigenId = keccak256("test-eigen-1");

    uint256 constant DEPLOY_FEE_BPS = 500; // 5%
    uint256 constant TRADING_FEE_BPS = 300; // 3%

    receive() external payable {}

    function setUp() public {
        registry = new MockIdentityRegistry();
        vault = new EigenVault(keeper, DEPLOY_FEE_BPS, address(registry));
        router = new MockRouter();
        vault.setRouterApproval(address(router), true);
    }

    // ── Helper ────────────────────────────────────────────────────────

    function _createEigen(uint256 amount) internal {
        vm.deal(user, amount);
        vm.prank(user);
        vault.createEigen{value: amount}(eigenId, TRADING_FEE_BPS);
    }

    // ── Deploy Fee Tests ──────────────────────────────────────────────

    function test_createEigen_deductsDeployFee() public {
        uint256 depositAmount = 1 ether;
        uint256 expectedFee = depositAmount * DEPLOY_FEE_BPS / 10000; // 0.05 ETH
        uint256 expectedDeposit = depositAmount - expectedFee; // 0.95 ETH

        _createEigen(depositAmount);

        assertEq(vault.eigenBalances(eigenId), expectedDeposit);
        assertEq(vault.balances(eigenId, user), expectedDeposit);
        assertEq(vault.pendingProtocolFees(), expectedFee);
        assertEq(vault.eigenFeeRateBps(eigenId), TRADING_FEE_BPS);
    }

    function test_createEigen_zeroDeployFee() public {
        EigenVault noFeeVault = new EigenVault(keeper, 0, address(registry));
        vm.deal(user, 1 ether);
        vm.prank(user);
        noFeeVault.createEigen{value: 1 ether}(eigenId, TRADING_FEE_BPS);
        assertEq(noFeeVault.eigenBalances(eigenId), 1 ether);
    }

    function test_createEigen_rejectsTradingFeeTooHigh() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert("Trading fee too high");
        vault.createEigen{value: 1 ether}(eigenId, 1001); // > MAX_TRADING_FEE_BPS
    }

    function test_setDeployFee_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        vault.setDeployFee(100);
    }

    function test_setDeployFee_respectsMaxCap() public {
        vm.expectRevert("Deploy fee too high");
        vault.setDeployFee(2001);
    }

    // ── Fee Accrual Tests ─────────────────────────────────────────────

    function test_executeBuy_accruesFee() public {
        _createEigen(1 ether);

        uint256 buyAmount = 0.1 ether;
        uint256 expectedFeeAccrued = buyAmount * TRADING_FEE_BPS / 10000; // 0.0003 ETH

        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", buyAmount);

        assertEq(vault.feeOwed(eigenId), expectedFeeAccrued);
    }

    function test_feeAccrual_accumulates() public {
        _createEigen(1 ether);

        // 3 buys of 0.1 ETH each
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(keeper);
            vault.executeBuy(eigenId, address(router), "", 0.1 ether);

            // Return ETH so balance is available for next buy
            vm.deal(keeper, 0.1 ether);
            vm.prank(keeper);
            vault.returnEth{value: 0.1 ether}(eigenId);
        }

        uint256 expectedFee = 3 * (0.1 ether * TRADING_FEE_BPS / 10000);
        assertEq(vault.feeOwed(eigenId), expectedFee);
    }

    function test_zeroTradingFee_accruesNothing() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vault.createEigen{value: 1 ether}(eigenId, 0); // 0% trading fee

        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);

        assertEq(vault.feeOwed(eigenId), 0);
    }

    // ── Withdraw Net Balance Tests ────────────────────────────────────

    function test_withdraw_limitedToNetBalance() public {
        _createEigen(1 ether);

        uint256 eigenBal = vault.eigenBalances(eigenId); // 0.95 ETH

        // Buy to accrue some fees
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);

        // Return ETH
        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.1 ether}(eigenId);

        // feeOwed = 0.1 * 300 / 10000 = 0.003 ETH
        uint256 owed = vault.feeOwed(eigenId);
        uint256 balance = vault.eigenBalances(eigenId);
        uint256 netBalance = balance - owed;

        // Try to withdraw more than net balance
        vm.prank(user);
        vm.expectRevert("Exceeds net balance");
        vault.withdraw(eigenId, balance); // full balance exceeds net

        // Withdraw net balance should work
        uint256 userBalBefore = user.balance;
        vm.prank(user);
        vault.withdraw(eigenId, netBalance);
        assertEq(user.balance - userBalBefore, netBalance);
    }

    function test_getNetBalance_accurate() public {
        _createEigen(1 ether);

        uint256 eigenBal = vault.eigenBalances(eigenId);
        assertEq(vault.getNetBalance(eigenId), eigenBal); // no fees yet

        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);

        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.1 ether}(eigenId);

        uint256 owed = vault.feeOwed(eigenId);
        assertEq(vault.getNetBalance(eigenId), eigenBal - owed);
    }

    function test_withdraw_worksOnSuspendedEigen() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.suspend(eigenId);

        uint256 netBal = vault.getNetBalance(eigenId);
        uint256 userBalBefore = user.balance;

        vm.prank(user);
        vault.withdraw(eigenId, 0.5 ether);

        assertEq(user.balance - userBalBefore, 0.5 ether);
    }

    // ── Terminate Fee Settlement Tests ────────────────────────────────

    function test_terminate_settlesFeesToPendingProtocolFees() public {
        _createEigen(1 ether);

        // Execute some trades to accrue fees
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.2 ether);
        vm.deal(keeper, 0.2 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.2 ether}(eigenId);

        uint256 owed = vault.feeOwed(eigenId); // 0.2 * 300 / 10000 = 0.006 ETH
        uint256 balanceBeforeTerminate = vault.eigenBalances(eigenId);
        uint256 expectedUserPayout = balanceBeforeTerminate - owed;
        uint256 pendingBefore = vault.pendingProtocolFees();

        uint256 userBalBefore = user.balance;

        vm.prank(user);
        vault.terminate(eigenId);

        // Fees route to pendingProtocolFees (delta check — deploy fee already in there)
        assertEq(vault.pendingProtocolFees() - pendingBefore, owed, "Trading fees should be added to pendingProtocolFees");
        assertEq(user.balance - userBalBefore, expectedUserPayout, "User should receive balance minus fees");
        assertEq(vault.feeOwed(eigenId), 0, "feeOwed should be reset");
        assertTrue(vault.eigenTerminated(eigenId));

        // Owner claims all protocol fees (deploy + trading)
        uint256 totalPending = vault.pendingProtocolFees();
        uint256 ownerBalBefore = owner.balance;
        vault.claimProtocolFees();
        assertEq(owner.balance - ownerBalBefore, totalPending, "Owner should receive all fees via claim");
        assertEq(vault.pendingProtocolFees(), 0, "pendingProtocolFees should be cleared");
    }

    function test_terminate_feeOwedExceedsBalance() public {
        // Create eigen with high fee rate and small balance
        vm.deal(user, 0.1 ether);
        vm.prank(user);
        vault.createEigen{value: 0.1 ether}(eigenId, 1000); // 10% fee

        uint256 eigenBal = vault.eigenBalances(eigenId); // 0.095 ETH

        // Execute many buy/sell cycles to accrue more fees than balance
        // Warp time between cycles to start fresh epochs
        uint256 currentTime = block.timestamp + 3601;
        for (uint256 i = 0; i < 10; i++) {
            uint256 buyAmt = eigenBal > 0.01 ether ? 0.01 ether : eigenBal;
            if (vault.eigenBalances(eigenId) < buyAmt) break;

            currentTime += 3601;
            vm.warp(currentTime);

            vm.prank(keeper);
            vault.executeBuy(eigenId, address(router), "", buyAmt);

            vm.deal(keeper, buyAmt);
            vm.prank(keeper);
            vault.returnEth{value: buyAmt}(eigenId);
        }

        uint256 balance = vault.eigenBalances(eigenId);
        uint256 owed = vault.feeOwed(eigenId);

        // Terminate — fee is capped at balance, user gets remainder
        uint256 userBalBefore = user.balance;
        uint256 pendingBefore = vault.pendingProtocolFees();

        vm.prank(user);
        vault.terminate(eigenId);

        uint256 pendingDelta = vault.pendingProtocolFees() - pendingBefore;
        uint256 userReceived = user.balance - userBalBefore;

        assertEq(pendingDelta + userReceived, balance, "Total payout should equal balance");
        assertTrue(pendingDelta <= owed, "Fee collected should not exceed owed");
        assertEq(vault.feeOwed(eigenId), 0);
    }

    // ── Manual collectFee Tests ───────────────────────────────────────

    function test_collectFee_collectsAccruedFees() public {
        _createEigen(1 ether);

        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.2 ether);
        vm.deal(keeper, 0.2 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.2 ether}(eigenId);

        uint256 owed = vault.feeOwed(eigenId);
        assertTrue(owed > 0);

        uint256 ownerBalBefore = owner.balance;
        vault.collectFee(eigenId);

        assertEq(owner.balance - ownerBalBefore, owed);
        assertEq(vault.feeOwed(eigenId), 0);
    }

    function test_collectFee_onlyOwner() public {
        _createEigen(1 ether);
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);
        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.1 ether}(eigenId);

        vm.prank(user);
        vm.expectRevert();
        vault.collectFee(eigenId);
    }

    function test_collectFee_revertsWhenNoFeesOwed() public {
        _createEigen(1 ether);
        vm.expectRevert("No fees owed");
        vault.collectFee(eigenId);
    }

    // ── Router Whitelist Tests ────────────────────────────────────────

    function test_executeBuy_requiresApprovedRouter() public {
        _createEigen(1 ether);
        vm.prank(keeper);
        vm.expectRevert("Router not approved");
        vault.executeBuy(eigenId, address(0xDEAD), "", 0.1 ether);
    }

    function test_setRouterApproval_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        vault.setRouterApproval(address(0x123), true);
    }

    // ── Termination Guard Tests ───────────────────────────────────────

    function test_returnEth_blockedOnTerminatedEigen() public {
        _createEigen(1 ether);
        vm.prank(user);
        vault.terminate(eigenId);

        vm.deal(keeper, 0.5 ether);
        vm.prank(keeper);
        vm.expectRevert("Eigen terminated");
        vault.returnEth{value: 0.5 ether}(eigenId);
    }

    function test_withdraw_blockedOnTerminatedEigen() public {
        _createEigen(1 ether);
        vm.prank(user);
        vault.terminate(eigenId);

        vm.prank(user);
        vm.expectRevert("Eigen terminated");
        vault.withdraw(eigenId, 0.1 ether);
    }

    function test_resume_blockedOnTerminatedEigen() public {
        _createEigen(1 ether);
        vm.prank(user);
        vault.terminate(eigenId);

        vm.prank(user);
        vm.expectRevert("Eigen terminated");
        vault.resume(eigenId);
    }

    function test_deposit_blockedOnTerminatedEigen() public {
        _createEigen(1 ether);
        vm.prank(user);
        vault.terminate(eigenId);

        vm.deal(user, 0.5 ether);
        vm.prank(user);
        vm.expectRevert("Eigen not active");
        vault.deposit{value: 0.5 ether}(eigenId);
    }

    // ── Tracked Balance & Rescue Tests ────────────────────────────────

    function test_rescueETH_recoversExcess() public {
        vm.deal(address(0xBBBB), 1 ether);
        vm.prank(address(0xBBBB));
        (bool ok, ) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);

        uint256 ownerBalBefore = owner.balance;
        vault.rescueETH();
        assertEq(owner.balance - ownerBalBefore, 1 ether);
    }

    function test_rescueETH_cannotTakeTrackedFunds() public {
        _createEigen(1 ether);
        vm.expectRevert("No excess ETH");
        vault.rescueETH();
    }

    // ── Full Lifecycle Test ───────────────────────────────────────────

    function test_fullLifecycle() public {
        // 1. User creates eigen with 1 ETH (5% deploy fee → 0.95 deposited, 3% trading fee)
        _createEigen(1 ether);
        assertEq(vault.eigenBalances(eigenId), 0.95 ether);
        assertEq(vault.feeOwed(eigenId), 0);

        // 2. Keeper buys 0.1 ETH → fee accrues
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);
        uint256 fee1 = 0.1 ether * 300 / 10000; // 0.003 ETH
        assertEq(vault.feeOwed(eigenId), fee1);

        // 3. Keeper returns ETH from sell
        vm.deal(keeper, 0.15 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.15 ether}(eigenId);
        assertEq(vault.eigenBalances(eigenId), 1 ether); // 0.95 - 0.1 + 0.15

        // 4. Another buy → more fee accrued
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.2 ether);
        uint256 fee2 = 0.2 ether * 300 / 10000;
        assertEq(vault.feeOwed(eigenId), fee1 + fee2);

        // Return ETH
        vm.deal(keeper, 0.2 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.2 ether}(eigenId);

        // 5. User suspends — can still withdraw net balance
        vm.prank(user);
        vault.suspend(eigenId);

        uint256 netBal = vault.getNetBalance(eigenId);
        vm.prank(user);
        vault.withdraw(eigenId, 0.2 ether);

        // 6. User resumes
        vm.prank(user);
        vault.resume(eigenId);

        // 7. User terminates — fees go to pendingProtocolFees, remainder to user
        uint256 pendingFeesBefore = vault.pendingProtocolFees();
        uint256 userBalBefore = user.balance;
        uint256 balBeforeTerm = vault.eigenBalances(eigenId);
        uint256 owedBeforeTerm = vault.feeOwed(eigenId);

        vm.prank(user);
        vault.terminate(eigenId);

        // Fees from terminate added to any already-pending fees (from earlier withdraw settlement)
        assertEq(vault.pendingProtocolFees(), pendingFeesBefore + owedBeforeTerm, "Fees in pendingProtocolFees");
        assertEq(user.balance - userBalBefore, balBeforeTerm - owedBeforeTerm, "User gets remainder");
        assertTrue(vault.eigenTerminated(eigenId));
        assertEq(vault.feeOwed(eigenId), 0);

        // Owner claims all protocol fees
        uint256 totalPendingFees = vault.pendingProtocolFees();
        uint256 ownerBalBefore = owner.balance;
        vault.claimProtocolFees();
        assertEq(owner.balance - ownerBalBefore, totalPendingFees, "Owner gets fees via claim");

        // 8. Post-termination: returnEth blocked
        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vm.expectRevert("Eigen terminated");
        vault.returnEth{value: 0.1 ether}(eigenId);
    }

    // ── keeperTerminate Tests ─────────────────────────────────────────

    function test_keeperTerminate_sendsFundsToOwner() public {
        _createEigen(1 ether);

        // Accrue some fees via a buy
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);
        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.1 ether}(eigenId);

        uint256 owed = vault.feeOwed(eigenId);
        uint256 balance = vault.eigenBalances(eigenId);
        uint256 expectedUserPayout = balance - owed;
        uint256 pendingBefore = vault.pendingProtocolFees();

        uint256 userBalBefore = user.balance;
        uint256 keeperBalBefore = keeper.balance;

        vm.prank(keeper);
        vault.keeperTerminate(eigenId);

        // Funds go to owner (user), NOT to keeper
        assertEq(user.balance - userBalBefore, expectedUserPayout, "Funds should go to eigen owner");
        assertEq(keeper.balance, keeperBalBefore, "Keeper should not receive funds");
        assertTrue(vault.eigenTerminated(eigenId));
        assertEq(vault.feeOwed(eigenId), 0);
        assertEq(vault.eigenBalances(eigenId), 0);
        assertEq(vault.pendingProtocolFees() - pendingBefore, owed, "Fees should go to pendingProtocolFees");
    }

    function test_keeperTerminate_feesSettledCorrectly() public {
        _createEigen(1 ether);

        // Execute multiple buys to accrue fees
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.2 ether);
        vm.deal(keeper, 0.2 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.2 ether}(eigenId);

        uint256 owed = vault.feeOwed(eigenId);
        uint256 balance = vault.eigenBalances(eigenId);
        uint256 pendingBefore = vault.pendingProtocolFees();

        vm.prank(keeper);
        vault.keeperTerminate(eigenId);

        uint256 pendingDelta = vault.pendingProtocolFees() - pendingBefore;
        assertEq(pendingDelta, owed, "Trading fees should be settled to pendingProtocolFees");
    }

    function test_keeperTerminate_revertsIfNotKeeper() public {
        _createEigen(1 ether);

        vm.prank(user);
        vm.expectRevert("Not keeper");
        vault.keeperTerminate(eigenId);
    }

    function test_keeperTerminate_revertsIfAlreadyTerminated() public {
        _createEigen(1 ether);

        vm.prank(keeper);
        vault.keeperTerminate(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Already terminated");
        vault.keeperTerminate(eigenId);
    }

    // ── keeperWithdraw Tests ──────────────────────────────────────────

    function test_keeperWithdraw_sendsToOwner() public {
        _createEigen(1 ether);

        uint256 netBalance = vault.getNetBalance(eigenId);
        uint256 withdrawAmount = 0.3 ether;

        uint256 userBalBefore = user.balance;
        uint256 keeperBalBefore = keeper.balance;

        vm.prank(keeper);
        vault.keeperWithdraw(eigenId, withdrawAmount);

        assertEq(user.balance - userBalBefore, withdrawAmount, "Funds should go to eigen owner");
        assertEq(keeper.balance, keeperBalBefore, "Keeper should not receive funds");
        assertFalse(vault.eigenTerminated(eigenId), "Should not terminate");
    }

    function test_keeperWithdraw_revertsIfNotKeeper() public {
        _createEigen(1 ether);

        vm.prank(user);
        vm.expectRevert("Not keeper");
        vault.keeperWithdraw(eigenId, 0.1 ether);
    }

    function test_keeperWithdraw_revertsIfTerminated() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.terminate(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Eigen terminated");
        vault.keeperWithdraw(eigenId, 0.1 ether);
    }

    function test_keeperWithdraw_revertsIfExceedsNetBalance() public {
        _createEigen(1 ether);

        // Accrue fees
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.1 ether);
        vm.deal(keeper, 0.1 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.1 ether}(eigenId);

        uint256 balance = vault.eigenBalances(eigenId);

        // Try withdrawing full balance (exceeds net due to fees)
        vm.prank(keeper);
        vm.expectRevert("Exceeds net balance");
        vault.keeperWithdraw(eigenId, balance);
    }

    function test_keeperWithdraw_revertsIfLockedForTransfer() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.lockForTransfer(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Locked for transfer");
        vault.keeperWithdraw(eigenId, 0.1 ether);
    }

    // ── Security: keeperTerminate guards (Vuln 1 & 2 fixes) ──────────

    function test_keeperTerminate_revertsIfLockedForTransfer() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.lockForTransfer(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Locked for transfer");
        vault.keeperTerminate(eigenId);
    }

    function test_keeperTerminate_revertsIfBalanceNotMigrated() public {
        // Create eigen with agent NFT
        uint256 agentId = 42;
        registry.mint(user, agentId);

        vm.deal(user, 1 ether);
        vm.prank(user);
        vault.createEigenWithAgent{value: 1 ether}(eigenId, agentId, 500);

        // Simulate NFT transfer: registry now reports a different owner
        address newOwner = address(0xD00D);
        registry.transferFrom(user, newOwner, agentId);

        // getEigenOwner now returns newOwner, but _getBalanceHolder still returns user
        // keeperTerminate should revert because migration hasn't happened
        vm.prank(keeper);
        vm.expectRevert("Balance migration required");
        vault.keeperTerminate(eigenId);
    }

    // ── keeperWithdrawAll Tests ────────────────────────────────────────

    function test_keeperWithdrawAll_withdrawsNetBalance() public {
        _createEigen(1 ether);

        // Accrue fees
        vm.prank(keeper);
        vault.executeBuy(eigenId, address(router), "", 0.2 ether);
        vm.deal(keeper, 0.2 ether);
        vm.prank(keeper);
        vault.returnEth{value: 0.2 ether}(eigenId);

        uint256 userBalBefore = user.balance;
        uint256 netBal = vault.getNetBalance(eigenId);

        vm.prank(keeper);
        uint256 withdrawn = vault.keeperWithdrawAll(eigenId);

        // Withdrawn amount should match net balance (after fee settlement)
        assertGt(withdrawn, 0, "Should withdraw something");
        assertEq(user.balance - userBalBefore, withdrawn, "Funds should go to eigen owner");
        assertEq(vault.eigenBalances(eigenId), vault.feeOwed(eigenId), "Only owed fees remain");
    }

    function test_keeperWithdrawAll_revertsIfNoBalance() public {
        _createEigen(1 ether);

        // Withdraw everything first via keeper
        vm.prank(keeper);
        vault.keeperWithdrawAll(eigenId);

        vm.prank(keeper);
        vm.expectRevert("No balance to withdraw");
        vault.keeperWithdrawAll(eigenId);
    }

    function test_keeperWithdrawAll_revertsIfNotKeeper() public {
        _createEigen(1 ether);

        vm.prank(user);
        vm.expectRevert("Not keeper");
        vault.keeperWithdrawAll(eigenId);
    }

    function test_keeperWithdrawAll_revertsIfTerminated() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.terminate(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Eigen terminated");
        vault.keeperWithdrawAll(eigenId);
    }

    function test_keeperWithdrawAll_revertsIfLockedForTransfer() public {
        _createEigen(1 ether);

        vm.prank(user);
        vault.lockForTransfer(eigenId);

        vm.prank(keeper);
        vm.expectRevert("Locked for transfer");
        vault.keeperWithdrawAll(eigenId);
    }
}
