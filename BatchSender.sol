// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title BatchSender
/// @notice Batch-send ETH and ERC-20 tokens to multiple recipients in one transaction
/// @dev This is the canonical contract. It is intentionally immutable and stateless:
///      it has no owner, no upgrade path, and no withdraw function. It can never
///      move funds except to the exact recipients the caller specifies, which makes
///      it safe for users to send to. Deploy once per chain; the ABI is identical
///      across all deployments (see public/chains.json), so every address works with
///      the same frontend without redeploying existing chains.
contract BatchSender {
    /// @notice Batch-send native ETH to multiple recipients
    /// @param recipients List of recipient addresses
    /// @param amounts List of amounts in wei (must match recipients length)
    function disperseEther(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable {
        uint256 count = recipients.length;
        require(amounts.length == count, "Length mismatch");

        uint256 total = msg.value;
        uint256 sum = 0;

        for (uint256 i = 0; i < count; i++) {
            uint256 amount = amounts[i];
            sum += amount;
            (bool ok, ) = recipients[i].call{ value: amount }("");
            require(ok, "ETH transfer failed");
        }

        // Refund any leftover ETH
        if (sum < total) {
            (bool r, ) = msg.sender.call{ value: total - sum }("");
            require(r, "Refund failed");
        }
    }

    /// @notice Batch-send an ERC-20 token to multiple recipients
    /// @param token Address of the ERC-20 token contract
    /// @param recipients List of recipient addresses
    /// @param amounts List of token amounts (must match recipients length)
    function disperseToken(
        IERC20 token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 count = recipients.length;
        require(amounts.length == count, "Length mismatch");

        // Calculate total amount to pull
        uint256 total = 0;
        for (uint256 i = 0; i < count; i++) {
            total += amounts[i];
        }

        // Transfer tokens from sender to this contract
        require(token.transferFrom(msg.sender, address(this), total),
                "TransferFrom failed");

        // Distribute to recipients
        uint256 sent = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 amt = amounts[i];
            sent += amt;
            require(token.transfer(recipients[i], amt),
                    "Token transfer failed");
        }

        // Refund any leftover tokens
        if (sent < total) {
            require(token.transfer(msg.sender, total - sent),
                    "Refund failed");
        }
    }
}
