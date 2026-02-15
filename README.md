# EigenSwarm

**Autonomous market-making agents on Monad.**

Deploy AI-driven agents that trade any token on [nad.fun](https://nad.fun) bonding curves and Uniswap V4 pools — or launch a brand new token with a market maker attached in a single atomic transaction. Agents register as on-chain identities via **ERC-8004** and can pay for themselves using the **x402** payment protocol, enabling fully autonomous, no-human-in-the-loop market making.

> Built for the [MOLTIVERSE Hackathon](https://moltiverse.dev/) on Monad.

---

## What It Does

### Autonomous Market Making
Each agent ("eigen") is an autonomous market maker that:
- Operates from an on-chain vault (EigenVault) with isolated funds
- Controls 1-50 sub-wallets to distribute trading activity
- Executes buy/sell cycles on bonding curves (nad.fun) and Uniswap V4 pools
- Tracks P&L, win rate, and volume in real-time
- Seeds and compounds Uniswap V4 LP positions for fee revenue
- Handles graduation automatically when a nad.fun token migrates to DEX

### ERC-8004: Trustless Agent Identity
Agents register as NFTs on the ERC-8004 Identity Registry, giving each one:
- A verifiable on-chain identity (`agentId` as an NFT token ID)
- A published agent card with trading stats, service endpoints, and class
- Daily reputation signals posted to the Reputation Registry
- Transferable ownership — transfer the NFT, transfer the agent

### x402: Agent-to-Agent Payments
The x402 payment protocol lets any agent (or human) pay for market-making services using USDC — no wallet connection or contract interaction required:

1. Request the keeper API → get a `402 Payment Required` response with USDC amount and recipient
2. Send USDC on Monad (or Base) via a simple ERC-20 transfer
3. Re-submit the request with the tx hash as proof → eigen is created and auto-funded from the keeper treasury

This means an AI agent with a wallet can autonomously deploy market makers for tokens it discovers, pay for them, and monitor their performance — all via HTTP.

### Atomic Token Launch on nad.fun
Launch a new token with market making in a single transaction:
- Deploy token on nad.fun bonding curve
- Execute initial dev buy
- Seed Uniswap V4 LP position
- Spin up an autonomous market-making agent

Or attach a market maker to any existing nad.fun token — just provide the token address and a volume package.

---

## Architecture

```
                    ┌──────────────────┐
                    │   Frontend (web)  │  Next.js 14 / React / Tailwind
                    │   port 3000       │  Privy auth + wagmi
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Keeper Service   │  Node.js / TypeScript
                    │  port 3001        │  Trading engine + API + x402
                    └──┬─────┬─────┬───┘
                       │     │     │
              ┌────────▼┐ ┌──▼───┐ ├──────────────────┐
              │ Indexer  │ │Vault │ │ nad.fun Bonding   │
              │ (Ponder) │ │ + LP │ │ Curve + Uniswap   │
              └──────────┘ └──────┘ └──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   Monad (L1)     │  400ms blocks
                    │   Chain ID: 143  │
                    └──────────────────┘
```

### Monorepo Structure

```
eigenswarm/
├── apps/
│   ├── web/             # Next.js frontend — dashboard, deploy, launch, monitoring
│   ├── keeper/          # Core service — trading engine, x402 payments, ERC-8004
│   ├── indexer/         # Ponder indexer — on-chain event aggregation (GraphQL)
│   └── tg-sniper/       # Telegram bot — trade alerts and monitoring
├── packages/
│   ├── sdk/             # TypeScript SDK — client library for the keeper API
│   └── shared/          # Shared types, ABIs, chain configs, constants
├── contracts/           # Solidity smart contracts (Forge)
│   ├── EigenVault.sol       # Holds deposits, manages eigen accounts, tracks fees
│   ├── EigenLP.sol          # Seeds and manages Uniswap V4 LP positions
│   ├── EigenAtomicLauncher.sol  # One-tx: create token + LP + vault on nad.fun
│   ├── EigenLauncher.sol    # Creates eigens in vault with initial funding
│   └── EigenFactory.sol     # Token factory (Base)
└── examples/
    ├── autonomous-agent.ts  # Full x402 flow — agent pays for itself
    └── agent-launch.ts      # SDK-based launch with monitoring
```

---

## Agent Classes

| Class | Label | Volume/Day | Trades/Hr | Order Size | Wallets | Min Deposit | Fee |
|-------|-------|-----------|-----------|-----------|---------|-------------|-----|
| `sentinel` | Lite | 0.5–2 ETH | 1–30 | 0.001–0.01 ETH | 1–5 | 0.001 ETH | 3% |
| `operator` | Core | 2–10 ETH | 5–40 | 0.01–0.1 ETH | 5–20 | 0.01 ETH | 4% |
| `architect` | Pro | 10–30 ETH | 10–50 | 0.1–0.5 ETH | 20–40 | 0.05 ETH | 5% |
| `sovereign` | Ultra | 30–100+ ETH | 30–100 | 0.5–2 ETH | 40–50 | 0.1 ETH | 5% |

---

## x402 Volume Packages

| Package | Volume | Price (USDC) |
|---------|--------|-------------|
| `micro` | 0.05 ETH | 1 |
| `mini` | 0.1 ETH | 2 |
| `starter` | 1 ETH | 10 |
| `growth` | 5 ETH | 40 |
| `pro` | 20 ETH | 120 |
| `whale` | 100 ETH | 500 |

---

## Quick Start

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Monad RPC access

### Install & Run

```bash
# Clone
git clone https://github.com/your-org/EigenSwarm_Monad.git
cd EigenSwarm_Monad

# Install
pnpm install

# Run all apps (web + keeper + indexer)
pnpm dev
```

- **Frontend**: http://localhost:3000
- **Keeper API**: http://localhost:3001

### Environment Variables

Create `apps/web/.env.local`:
```env
NEXT_PUBLIC_EIGENVAULT_ADDRESS=0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b
NEXT_PUBLIC_EIGENLP_ADDRESS=0xEf8b421B15Dd0Aa59392431753029A184F3eEc54
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_KEEPER_API_URL=http://localhost:3001
```

Create `apps/keeper/.env`:
```env
PRIVATE_KEY=0x...              # Keeper wallet private key
MONAD_RPC_URL=https://rpc.monad.xyz
X402_PAY_TO=0x...              # Address to receive USDC payments
```

---

## SDK Usage

```typescript
import { EigenSwarmClient } from '@eigenswarm/sdk';

const client = new EigenSwarmClient({
  keeperUrl: 'https://api.eigenswarm.xyz',
  apiKey: 'esk_abc123...',
  chainId: 143, // Monad
});

// Deploy a market maker on any nad.fun token
const result = await client.buyVolume(
  '0x...tokenAddress',
  'starter',       // 1 ETH volume, 10 USDC
  '0x...usdcTxHash' // proof of USDC payment
);

console.log(`Eigen ${result.eigenId} is now trading`);

// Monitor P&L
const pnl = await client.getPnL(result.eigenId);
console.log(`Realized: ${pnl.totalRealizedPnl} ETH`);

// Take profit
await client.takeProfit(result.eigenId, 50); // sell 50% of positions
```

### Launch a New Token + Market Maker

```typescript
const launch = await client.launch({
  name: 'My Token',
  symbol: 'MTK',
  packageId: 'growth',
  description: 'A token with built-in market making',
}, '0x...usdcTxHash');

console.log(`Token: ${launch.tokenAddress}`);
console.log(`Pool: ${launch.poolId}`);
console.log(`Eigen: ${launch.eigenId}`);
```

---

## Autonomous Agent Example

An agent that pays for itself — no human in the loop:

```bash
# Market-make an existing nad.fun token
AGENT_PRIVATE_KEY=0x... \
TOKEN_ADDRESS=0x... \
npx tsx examples/autonomous-agent.ts

# Launch a brand new token with market making
AGENT_PRIVATE_KEY=0x... \
TOKEN_NAME="My Token" \
TOKEN_SYMBOL="MTK" \
npx tsx examples/autonomous-agent.ts --launch
```

The agent will:
1. Check its USDC + MON balance
2. Verify the keeper is healthy
3. Request payment instructions (HTTP 402)
4. Send USDC on-chain as payment
5. Submit proof → eigen is created and funded
6. Monitor trades and P&L every 30 seconds

---

## Smart Contracts

Deployed on **Monad (Chain ID: 143)**:

| Contract | Address |
|----------|---------|
| EigenVault | `0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b` |
| EigenLP | `0xEf8b421B15Dd0Aa59392431753029A184F3eEc54` |
| EigenAtomicLauncher | `0x9920E8900a154Da216d56F005156FA354835CDAE` |

Also deployed on **Base (Chain ID: 8453)**:

| Contract | Address |
|----------|---------|
| EigenVault | `0x3aD2b12AE0Fe4bB4e0B0F92624d8D4D87da57a58` |
| EigenLP | `0xDA1495458E85Ff371574f61a383C8797CA420A30` |

---

## ERC-8004 Integration

Each eigen can optionally register as an ERC-8004 Trustless Agent:

- **Identity Registry**: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- **Reputation Registry**: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

The agent card published on-chain includes:
```json
{
  "name": "ES-a1f2",
  "class": "operator",
  "status": "active",
  "services": [
    { "type": "web", "url": "https://eigenswarm.xyz/app/eigen/ES-a1f2" },
    { "type": "api", "url": "https://api.eigenswarm.xyz/api/eigens/ES-a1f2" }
  ],
  "stats": {
    "winRate": 0.73,
    "totalTrades": 142,
    "realizedPnl": "1.82"
  }
}
```

Reputation signals are posted daily, making agent performance transparent and verifiable on-chain.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Keeper health and gas status |
| `GET` | `/api/pricing` | Volume packages and payment info |
| `GET` | `/api/chains` | Supported chains |
| `POST` | `/api/agents/buy-volume` | Purchase volume (x402 flow) |
| `POST` | `/api/launch` | Launch token + LP + eigen (x402 flow) |
| `GET` | `/api/eigens/:id` | Get eigen status and config |
| `GET` | `/api/eigens/:id/trades` | Trade history |
| `GET` | `/api/eigens/:id/pnl` | P&L breakdown |
| `GET` | `/api/eigens/:id/positions` | Current token positions |
| `POST` | `/api/agent/eigens/:id/take-profit` | Sell positions |
| `POST` | `/api/agent/eigens/:id/liquidate` | Full liquidation |
| `POST` | `/api/agent/eigens/:id/fund` | Fund eigen (x402) |
| `POST` | `/api/agent/keys` | Get API key (EIP-191 signature) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Monad (L1, 400ms blocks), Base |
| Smart Contracts | Solidity, Forge |
| Backend | Node.js, TypeScript, better-sqlite3 |
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Auth | Privy, WalletConnect, wagmi |
| DEX | Uniswap V4, nad.fun bonding curves |
| Indexing | Ponder (GraphQL) |
| Agent Identity | ERC-8004 (Identity + Reputation Registry) |
| Payments | x402 protocol (USDC) |
| Monorepo | Turborepo, pnpm workspaces |

---

## How It Works (Flow)

```
User / AI Agent
      │
      ├── 1. POST /api/agents/buy-volume  (or /api/launch)
      │       → 402: "Send 10 USDC to 0x..."
      │
      ├── 2. Send USDC on-chain (Monad)
      │
      ├── 3. POST /api/agents/buy-volume  + X-PAYMENT: 0xtxhash
      │       → 201: { eigenId: "ES-a1f2", status: "active" }
      │
      │   ┌─── Keeper auto-funds eigen from treasury ───┐
      │   │                                               │
      │   │   EigenVault ←── ETH deposit                 │
      │   │       │                                       │
      │   │       ├── Sub-wallet 1 → buy on nad.fun      │
      │   │       ├── Sub-wallet 2 → sell on nad.fun     │
      │   │       ├── Sub-wallet 3 → buy on Uniswap V4  │
      │   │       └── ...                                 │
      │   │                                               │
      │   │   EigenLP ←── Seed V4 liquidity position     │
      │   │       └── Compound fees                       │
      │   │                                               │
      │   │   ERC-8004 ←── Register agent identity       │
      │   │       └── Post daily reputation signals       │
      │   └───────────────────────────────────────────────┘
      │
      ├── 4. GET /api/eigens/ES-a1f2/pnl
      │       → { realizedPnl: 0.31, winRate: 0.73 }
      │
      └── 5. POST /api/agent/eigens/ES-a1f2/take-profit
              → Sells positions, ETH returned to vault
```

---

## License

MIT
