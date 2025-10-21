# FarSend

**One-line summary:**  
A privacy-focused Farcaster + Base MiniApp concept for batch sending ETH and ERC-20 tokens to multiple addresses using Zamz FHE encryption.

---

## Overview

FarSend is an early-stage idea for a privacy-preserving web application that enables users to send ETH and ERC-20 tokens to multiple addresses in one transaction — ideal for airdrops, community rewards, or bulk payouts — while using Zamz FHE (Fully Homomorphic Encryption) to keep transfer details private on-chain.

The concept combines multi-send functionality with advanced encryption to ensure that no one can see which address received what amount, making it a privacy-first solution for token distribution within the Farcaster and Base ecosystems.

---

## Detailed Description

**FarSend is currently at the concept stage — not yet built.**

The idea is to create a simple, privacy-preserving web app that allows users to send ETH and ERC-20 tokens to multiple addresses at once, directly from their wallet, without exposing sensitive transfer details on-chain.

The core concept combines:

- **Multi-send functionality** (like Disperse or reward tools) for airdrops, rewards, or distribution payouts, and
- **Zamz FHE (Fully Homomorphic Encryption)** to make each transaction private and unlinkable, ensuring that no one can see which address received what amount.

FarSend would work as a **MiniApp inside the Farcaster and Base ecosystems**, meaning users could open it directly through their Farcaster client or Base MiniApp environment — making token distributions easy and native to the social graph.

---

## Key Features (Planned)

All features listed below are **planned for future development** — none are currently implemented.

### 🔹 Batch Sending
- Send ETH or tokens to many addresses in one transaction
- Reduce gas costs compared to individual transfers
- Streamline airdrops and reward distribution

### 🔹 Privacy Layer via Zamz FHE
- Encrypt amounts and recipient details so transfers remain private on-chain
- No observer can link sender, receiver, or amount
- Unlinkable transactions for maximum privacy

### 🔹 Client-Side Execution
- Non-custodial, browser-based signing — user keys never leave their wallet
- No intermediary custody of funds
- Direct wallet-to-wallet transfers

### 🔹 CSV Upload & Smart Distribution
- Import recipient lists from CSV files
- Preview batch before sending
- Validate addresses and amounts before execution

### 🔹 Farcaster Integration
- Allow login via Farcaster identity
- Future: reward drops for followers or channels
- Native integration with Farcaster social graph

### 🔹 Base L2 Support
- Optimized for low-gas bulk sending on Base
- Fast confirmation times
- Cost-effective for large-scale distributions

### 🔹 Future Add-ons
- Distribution tracking and history
- Selective proof disclosure
- Analytics dashboards for distribution insights

---

## Privacy & Security Goals

When built, FarSend aims to provide:

- **Encrypted Transactions**: All transactions encrypted with FHE so observers can't link sender, receiver, or amount
- **Full User Custody**: Users keep full custody of their wallets at all times
- **No Centralized Data Storage**: No centralized server holds private data — all encryption/decryption happens locally
- **Optional Proof Generation**: Ability to verify distributions without revealing full details
- **Unlinkable Transfers**: Each transfer is cryptographically unlinkable from others

---

## Technical Stack (Proposed)

When development begins, the planned technical stack includes:

- **Frontend**: React/Next.js for the web interface
- **Blockchain**: Base (Ethereum L2) for low-cost transactions
- **Privacy Layer**: Zamz SDK for FHE implementation
- **Wallet Integration**: WalletConnect, RainbowKit, or similar
- **Social Layer**: Farcaster protocol integration
- **Smart Contracts**: Solidity contracts for batch sending with FHE encryption

---

## Current Status

🚧 **Still an idea / prototype planning phase**

- ❌ No code, prototype, or website yet
- ❌ No MVP or active development
- 📋 Currently designing architecture and FHE integration flow using Zamz SDK
- 📋 Exploring deployment as a Farcaster + Base MiniApp under the name FarSend
- 📋 Researching best practices for FHE implementation in batch transactions

**This project is in early ideation and has not yet entered the development phase.**

---

## Vision & Impact

FarSend aims to become the go-to privacy layer for reward and payout automation in the Farcaster ecosystem — making it easy for communities, DAOs, and apps to send funds to many users **securely, privately, and natively** within social crypto platforms.

### Potential Use Cases

- **Community Rewards**: Distribute tokens to active community members privately
- **Airdrops**: Send tokens to multiple addresses without revealing distribution details
- **DAO Payouts**: Pay contributors while maintaining privacy of compensation amounts
- **Creator Rewards**: Reward followers or content creators on Farcaster
- **Team Distributions**: Distribute funds to team members without public disclosure

### Long-Term Goals

- Become the standard for private, bulk token distribution on Base
- Enable privacy-preserving financial operations within social networks
- Support the growth of privacy-conscious crypto communities
- Integrate deeply with Farcaster's social graph for seamless distributions
- Provide analytics and insights while maintaining user privacy

---

## Base Batches Application Details

**Website**: None (idea stage; no live site or company yet)

**Project Status**: Concept/Idea Stage

**Short Description**:  
FarSend is an early-stage idea for a privacy-focused Farcaster + Base MiniApp that lets users send ETH and ERC-20 tokens to multiple addresses in one go — for airdrops, community rewards, or payouts — using Zamz FHE to hide who sent what to whom.

**Detailed Description**:  
FarSend is currently at the concept stage, not yet built. The idea is to create a simple, privacy-preserving web app that allows users to send ETH and ERC-20 tokens to multiple addresses at once, directly from their wallet, without exposing sensitive transfer details on-chain. The core concept combines multi-send functionality with Zamz FHE encryption to ensure private, unlinkable transactions within the Farcaster and Base ecosystems.

---

## Contact & Collaboration

This is an early-stage concept. If you're interested in collaborating, contributing ideas, or providing feedback, please open an issue or reach out through GitHub.

---

*Note: This README describes a concept that has not yet been built. All features, capabilities, and technical details represent planned functionality, not current implementation.*
