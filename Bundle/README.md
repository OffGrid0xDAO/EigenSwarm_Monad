# nad.fun Bundler

A modern tool for launching tokens and executing bundle buys on [nad.fun](https://nad.fun) - the Monad blockchain launchpad.

## Features

- **Launch & Distribute**: Create a token on nad.fun and send it to multiple wallets in **one transaction**
- Single flow: token details + distribution list → one click
- Clean, professional UI (DM Sans, subtle grid, card-based layout)
- Seamless wallet integration for Monad (Chain ID: 143)

## Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Web3**: wagmi + viem
- **Smart Contracts**: Solidity (LaunchAndBundleBuy – launch + multi-recipient buy in one tx)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- MetaMask or another EVM wallet
- MON tokens on Monad mainnet

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview
```

### Supabase (logos + launch history)

The UI uses **Supabase** for:

- **Logo uploads** – images are stored in Supabase Storage (bucket `logos`) and the public URL is used as the token URI.
- **Launch records** – after a successful launch, the token details and recipient list are saved to a `launches` table.

1. Create a project at [supabase.com](https://supabase.com) and add to your `.env`:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
2. In Supabase Dashboard → **SQL Editor**, run the script `supabase/schema.sql` to create the `launches` table and the `logos` storage bucket (with public read + anon upload).
3. Restart the dev server. Logo upload and launch persistence will use your Supabase project.

## Smart Contract Deployment

### LaunchAndBundleBuy (recommended)

One transaction: create token and distribute to N recipients.

**Location**: `contracts/LaunchAndBundleBuy.sol`

#### Deploy with Foundry

```bash
# Constructor: (lens, bondingCurveRouter)
forge create --rpc-url https://rpc.monad.xyz \
  --private-key YOUR_PRIVATE_KEY \
  --constructor-args 0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea 0x6F6B8F1a20703309951a5127c45B49b1CD981A22 \
  contracts/LaunchAndBundleBuy.sol:LaunchAndBundleBuy
```

#### After deployment

Update `src/lib/contracts.ts`:

```typescript
LAUNCH_AND_BUNDLE_BUY: '0xYourDeployedAddress', // set this
```

## Contract Addresses (Monad Mainnet)

- **Lens**: `0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea`
- **BondingCurveRouter**: `0x6F6B8F1a20703309951a5127c45B49b1CD981A22`
- **DexRouter**: `0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137`
- **WMON**: `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`

## Usage

### Launch & Distribute (one transaction)

1. Connect your wallet (Monad, Chain ID 143).
2. Fill in **Token details**: name, symbol, token URI (image/metadata URL).
3. Add **Distribution** rows: recipient address + MON amount per recipient (use “Split equally” if needed).
4. Set slippage tolerance (default 1%).
5. Click **Launch & Distribute** and confirm. One tx creates the token and sends it to all listed wallets.

## Development

### Project Structure

```
bundlerMonad/
├── src/
│   ├── components/     # React components (Layout, WalletConnect)
│   ├── pages/          # Page components (LaunchToken, BundleBuy)
│   ├── lib/            # Config, contracts, and utilities
│   ├── abis/           # Contract ABIs
│   ├── App.tsx         # Main app component
│   └── main.tsx        # Entry point
├── contracts/          # Solidity contracts
│   └── BundleBuy.sol   # Bundle buy contract
├── tailwind.config.js  # Tailwind configuration
└── vite.config.ts      # Vite configuration
```

### Key Files

- `src/lib/config.ts` - Wagmi configuration for Monad
- `src/lib/chains.ts` - Monad chain definition
- `src/lib/contracts.ts` - Contract addresses and ABIs
- `contracts/BundleBuy.sol` - Multi-recipient buy contract

## How It Works

### Token Launch

1. User provides token details and optional initial buy
2. App calls `BondingCurveRouter.create()` with 10 MON deploy fee
3. Token is created with bonding curve
4. If initial buy is provided, tokens are purchased immediately

### Bundle Buy

1. User specifies token and multiple recipients with MON amounts
2. App validates all addresses and amounts
3. Calls `BundleBuy.bundleBuy()` with total MON amount
4. Contract splits MON and executes individual buys to each recipient
5. Uses Lens contract to determine optimal router (bonding curve or DEX)

## Resources

- [nad.fun Documentation](https://nad-fun.gitbook.io/nad.fun)
- [nad.fun Contracts & ABI](https://github.com/Naddotfun/contract-v3-abi)
- [Monad Documentation](https://docs.monad.xyz)

## License

MIT
