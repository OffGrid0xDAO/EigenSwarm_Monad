// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FundWallets
 * @notice Send native MON to multiple addresses in one transaction. Caller sends msg.value = recipients.length * amountEach.
 */
contract FundWallets {
    error InvalidValue();
    error TransferFailed(uint256 index);

    /**
     * @param recipients Addresses to receive MON
     * @param amountEach Amount of MON (in wei) to send to each recipient. msg.value must equal recipients.length * amountEach.
     */
    function fund(address[] calldata recipients, uint256 amountEach) external payable {
        uint256 n = recipients.length;
        if (n == 0) return;
        if (msg.value != n * amountEach) revert InvalidValue();
        for (uint256 i = 0; i < n; i++) {
            (bool ok, ) = recipients[i].call{ value: amountEach }("");
            if (!ok) revert TransferFailed(i);
        }
    }
}
