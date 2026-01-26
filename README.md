# FarSend

**Multi-chain batch sender for ETH and ERC-20 tokens — built for Farcaster.**

🚀 **Live App**: [https://farsend.vercel.app/](https://farsend.vercel.app/)

---

## Overview

FarSend is a web-based batch sender that enables users to send ETH and ERC-20 tokens to multiple addresses in a single transaction across multiple Ethereum networks. Built as a Farcaster Mini App, FarSend streamlines token distributions for airdrops, community rewards, DAO payouts, and bulk transfers on Ethereum Mainnet, Base, Optimism, and Arbitrum.

---

## Key Features

### ✅ Batch Sending
- Send ETH or ERC-20 tokens to multiple addresses in one transaction
- Significantly reduce gas costs compared to individual transfers
- Streamline airdrops and reward distributions

### 🔗 Wallet Integration
- Connect with any Web3 wallet via Reown AppKit
- Non-custodial — your keys never leave your wallet
- Direct wallet-to-wallet transfers
- Automatic network detection and switching to Base

### 📊 Smart Input & Validation
- **Manual Entry**: Paste addresses and amounts line-by-line
- **CSV/JSON Upload**: Import recipient lists from files
- **Live Preview**: See parsed data before dispatching
- **Address Validation**: Automatic Ethereum address checksumming
- **Balance Checks**: Verify sufficient funds before sending

### 🎯 ERC-20 Token Support
- Send any ERC-20 token on Base
- Automatic token contract validation
- Built-in approval workflow for token spending
- Display token symbol and decimals

### 🌐 Farcaster Integration
- Native Farcaster Mini App
- Launch directly from Farcaster clients
- Optimized for mobile and desktop experiences

### 🎨 User Experience
- **Progress Stepper**: Visual workflow (Connect → Define → Dispatch)
- **Real-time Summaries**: See recipient count and total amounts
- **Transaction Tracking**: Direct links to BaseScan for all transactions
- **Success Celebrations**: Confetti animations on successful batches
- **Export Functionality**: Download recipient lists as CSV

---

## How It Works

1. **Connect Wallet**  
   Connect your Web3 wallet and ensure you're on Base Mainnet (Chain ID 8453)

2. **Define Token & Recipients**  
   - Select ETH or enter an ERC-20 token contract address
   - Input recipients manually or upload a CSV/JSON file
   - Format: `address, amount` per line

3. **Review & Dispatch**  
   - Review the summary (recipient count, total amount, token details)
   - For ERC-20 tokens, approve spending if needed
   - Click "Dispatch Batch" to send the transaction
   - Confirm in your wallet and wait for on-chain confirmation

---

## Technical Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript with Tailwind CSS
- **Web3 Library**: Ethers.js v6
- **Wallet Connection**: Reown AppKit (formerly WalletConnect)
- **Blockchain**: Base (Ethereum L2) - Chain ID 8453
- **Smart Contract**: Custom BaseBatchSender for gas-optimized batch transfers
- **Social Layer**: Farcaster Mini App SDK
- **Deployment**: Vercel

---

## Smart Contract

FarSend uses a deployed batch sender contract on Base Mainnet:

**Contract Address**: `0x8878b70a01bdda92ab8ea48dd7893b64c69298c0`

**Functions**:
- `disperseEther(address[] recipients, uint256[] amounts)` - Batch send ETH
- `disperseToken(address token, address[] recipients, uint256[] amounts)` - Batch send ERC-20 tokens

[View on BaseScan](https://basescan.org/address/0x8878b70a01bdda92ab8ea48dd7893b64c69298c0)

---

## Use Cases

### 🎁 Community Rewards
Distribute tokens to active community members for contributions, engagement, or participation

### 🪂 Airdrops
Send tokens to multiple addresses for marketing campaigns or token launches

### 💼 DAO Payouts
Pay contributors, grant recipients, or bounty hunters in bulk

### 🎨 Creator Rewards
Reward followers, supporters, or content creators on Farcaster

### 👥 Team Distributions
Distribute funds to team members for salaries, bonuses, or equity

### 🎮 Gaming Rewards
Batch send tokens or NFT currencies to game players

---

## File Format Examples

### CSV Format
```csv
Address,Amount
0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B,1.5
0x5B38Da6a701c568545dCfcB03FcB875f56beddC4,10.75
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb,0.25
```

### JSON Format
```json
[
  {
    "address": "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    "amount": 1.5
  },
  {
    "address": "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4",
    "amount": 10.75
  }
]
```

### Text Format (Space or Comma Separated)
```
0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B, 1.5
0x5B38Da6a701c568545dCfcB03FcB875f56beddC4 10.75
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb,0.25
```

---

## Security Features

- **Non-custodial**: Users maintain full control of their private keys
- **Client-side validation**: All address and amount validation happens in the browser
- **Balance verification**: Checks for sufficient ETH/token balance before dispatch
- **Approval workflow**: Explicit token approval step for ERC-20 transfers
- **Gas estimation**: Smart gas limit calculation with safety buffers
- **Transaction receipts**: Full on-chain verification of all transactions

---

## Development

### Local Setup

1. Clone the repository
```bash
git clone https://github.com/yourusername/farsend.git
cd farsend
```

2. Serve locally (any static file server works)
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

3. Open `http://localhost:8000` in your browser

### Configuration

The app automatically loads the Base contract configuration from `base.json`:

```json
{
  "address": "0x8878b70a01bdda92ab8ea48dd7893b64c69298c0",
  "abi": [...]
}
```

### Deployment

Deploy to Vercel:
```bash
vercel deploy
```

The app includes a `vercel.json` configuration for proper routing and redirects.

---

## Farcaster Mini App Integration

FarSend is registered as a Farcaster Mini App and can be launched directly from Farcaster clients.

**Manifest**: `/.well-known/farcaster.json`  
**App URL**: `https://farsend.vercel.app`  
**Splash Screen**: Custom animated loading screen with brand identity

---

## Gas Optimization

FarSend uses a custom batch sender contract that optimizes gas usage:

- **Single transaction**: All transfers execute in one on-chain transaction
- **Efficient loops**: Optimized Solidity loops for minimal gas overhead
- **No unnecessary storage**: Contract uses minimal state storage
- **Direct transfers**: ETH sent directly without intermediate steps

**Typical gas savings**: 40-60% compared to individual transfers for batches of 10+ recipients

---

## Browser Compatibility

- Chrome/Edge (v90+)
- Firefox (v88+)
- Safari (v14+)
- Brave (v1.24+)
- Mobile browsers with Web3 wallet support

---

## Roadmap

- [ ] Multi-chain support (Ethereum, Optimism, Arbitrum)
- [ ] NFT batch transfers
- [ ] Scheduled/recurring distributions
- [ ] Distribution analytics and history
- [ ] Advanced CSV mapping options
- [ ] Integration with token vesting schedules

---

## Support & Contact

- **Live App**: [farsend.vercel.app](https://farsend.vercel.app)
- **Farcaster**: [@dare1.eth](https://farcaster.xyz/dare1.eth)
- **Issues**: Open an issue on GitHub for bug reports or feature requests

---

## License

MIT License - see LICENSE file for details

---

## Acknowledgments

Built for the Farcaster and Base ecosystems with ❤️

Special thanks to:
- Farcaster team for the Mini App framework
- Base team for the L2 infrastructure
- Reown (WalletConnect) for wallet connectivity
- The Ethereum community for Web3 standards

---

**⚡ Start batch sending now**: [https://farsend.vercel.app/](https://farsend.vercel.app/)
