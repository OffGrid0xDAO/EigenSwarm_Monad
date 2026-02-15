# EigenSwarm

**Democratizing institutional-grade market making on Monad.**

> Built for the [MOLTIVERSE Hackathon](https://moltiverse.dev/) | Agent+Token Track | Monad x nad.fun

---

## The Problem

Volume is the lifeblood of any chain. But across DeFi, the vast majority of tokens suffer from **stale orderbooks, thin liquidity, and dead markets**. Professional market makers serve only the top 1% of tokens — those with enough capital to pay six-figure retainers. Everyone else gets nothing: wide spreads, zero depth, and tokens that look abandoned within hours of launch.

On Monad, with 400ms blocks and sub-cent gas, we finally have infrastructure fast enough for real market making at scale. But without accessible MM tooling, most tokens launched on nad.fun still face the same liquidity desert. Creators launch, buy their own bags, and watch volume flatline.

**The result: Monad's throughput advantage goes underutilized, and nad.fun tokens die on the vine.**

## The Solution

EigenSwarm gives **every token on Monad access to autonomous market-making agents** — the same buy/sell cycling, spread capture, and liquidity provision that institutional MMs provide, but available to anyone for as little as 1 USDC.

Deploy an agent. It trades. It earns. It registers its own on-chain identity. It can even pay for itself.

No retainers. No whitelists. No humans in the loop.

---

## Why Monad Needs This

| Problem | EigenSwarm Solution |
|---------|-------------------|
| Tokens launch on nad.fun with no sustained volume | Agents generate continuous buy/sell activity from minute one |
| Thin liquidity = high slippage = users leave | Multi-wallet agents create depth across bonding curves and V4 pools |
| Volume is the #1 chain health metric; stale markets hurt Monad's story | EigenSwarm turns every token into an active market, boosting chain-wide volume |
| Market making is gatekept behind institutional capital | Anyone can deploy an agent for 1 USDC (micro package) — fully democratized |
| Token graduation from bonding curve to DEX kills momentum | Agents auto-detect graduation and seamlessly transition to Uniswap V4 trading |
| No way to verify if a "market maker" is legit | ERC-8004 agent identity + on-chain reputation = transparent, verifiable performance |

---

## Hackathon Alignment

EigenSwarm is purpose-built for the MOLTIVERSE thesis: **what happens when AI agents can transact at scale on a high-performance blockchain.**

### Agent+Token Track
- Agents launch tokens on **nad.fun** with atomic market maker deployment (one transaction: token + LP + agent)
- Agents generate real volume and community activity — turning creator fees into agent economy revenue
- Building in public: live dashboard at eigenswarm.xyz showing agent P&L, trades, and volume in real-time

### Agent-to-Agent Coordination (A2A)
- Any AI agent can autonomously discover EigenSwarm, pay via **x402**, and deploy a market maker — **no API keys, no human approval, just an HTTP request and a USDC transfer**
- Agents register as verifiable on-chain entities via **ERC-8004** (Identity Registry + Reputation Registry) — discoverable and composable by other agents
- Daily reputation signals make agent performance transparent: win rate, volume, P&L — all on-chain

### Key Technologies Used
- **Monad** (L1, 400ms blocks) — coordination layer for agent trading
- **nad.fun** — token launch platform with bonding curves + graduation to Uniswap V4
- **x402** — HTTP payment protocol enabling machine-to-machine payments (USDC)
- **ERC-8004** — trustless agent identity standard (NFT-based identity + reputation registries)
- **Uniswap V4** — LP position management and post-graduation trading

---

## What It Does

### Autonomous Market Making
Each agent ("eigen") is an autonomous market maker that:
- Operates from an on-chain vault (EigenVault) with isolated funds
- Controls 1–50 sub-wallets to distribute trading activity across addresses
- Executes buy/sell cycles on nad.fun bonding curves and Uniswap V4 pools
- Tracks P&L, win rate, and volume in real-time
- Seeds and compounds Uniswap V4 LP positions for fee revenue
- Auto-detects graduation and transitions from bonding curve to DEX trading

### ERC-8004: Trustless Agent Identity
Agents register as NFTs on the ERC-8004 Identity Registry, giving each one:
- A verifiable on-chain identity (`agentId` as an NFT token ID)
- A published agent card with trading stats, service endpoints, and class
- Daily reputation signals posted to the Reputation Registry — transparent and verifiable
- Transferable ownership — transfer the NFT, transfer the agent

### x402: Autonomous Agent Payments
The x402 payment protocol lets any agent (or human) pay for market-making services using USDC — no wallet connection, no contract interaction, no API key required:

1. Request the keeper API → get a `402 Payment Required` response with USDC amount and recipient
2. Send USDC on Monad via a simple ERC-20 transfer
3. Re-submit the request with the tx hash as proof → eigen is created and auto-funded

An AI agent with a wallet can autonomously discover EigenSwarm, pay for a market maker, deploy it on any nad.fun token, and monitor its performance — all via HTTP. This is agent-to-agent commerce running on Monad.

### Atomic Token Launch on nad.fun
Launch a new token with market making in a single atomic transaction:
- Deploy token on nad.fun bonding curve
- Execute initial dev buy
- Seed Uniswap V4 LP position
- Spin up an autonomous market-making agent

Or attach a market maker to **any existing nad.fun token** — just provide the token address and pick a volume package.

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
