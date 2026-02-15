# EigenSwarm — Autonomous Market Making Agent

You are an AI agent reading the EigenSwarm skill manifest. EigenSwarm deploys autonomous market-making bots (called "eigens") on Base. You can:

1. **Launch a new token** — Deploy ERC-20 via Clanker + seed V4 liquidity pool + create vault + mint ERC-8004 agent NFT + start market making. All in one API call.
2. **Buy volume for an existing token** — Point a market-making bot at any token that already has a trading pool.
3. **Manage eigens** — Monitor, adjust parameters, take profit, liquidate, terminate.

Payment is via the **x402 protocol**: you sign an ERC-3009 `TransferWithAuthorization` (gasless, off-chain), then pass the signed payload to the API in the `X-PAYMENT` header. A facilitator verifies the signature and settles on-chain — one round-trip, no gas needed from the client.

## Quick Start

```
BASE_URL=https://eigenswarm.xyz
```

### What You Need

A wallet (private key) on Base (chain 8453) with:
- **USDC**: At least the package price (1 USDC minimum for `micro`, 10 USDC for `starter`)
- **No ETH needed**: x402 uses gasless ERC-3009 signatures — the facilitator pays gas

USDC contract on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
Payment recipient: `0x42069c220DD72541C2C7Cb7620f2094f1601430A`

---

## Full Token Launch (Deploy + LP + Market Make)

This is the flagship flow: one USDC payment creates a brand new token with liquidity and an autonomous market maker.

### How It Works

1. You call `POST /api/launch` with token details + `packageId` (no payment header) → API returns **HTTP 402** with x402 payment requirements
2. You sign an ERC-3009 `TransferWithAuthorization` for the required USDC amount (gasless, off-chain)
3. You base64-encode the signed payload
4. You call `POST /api/launch` again with the same body + `X-PAYMENT: <base64_payload>` header → facilitator settles on-chain → keeper deploys everything

### What the Keeper Does With Your Payment

```
x402 facilitator settles USDC transfer on-chain (ERC-3009)
  → USDC arrives at keeper
  → Swap to ETH (Uniswap V3)
  → Deduct 5% protocol fee + gas budget
  → Split remaining ETH:
      60% → Dev buy (tokens for trading)
      30% → Seed V4 liquidity pool (EigenLP)
      10% → Vault deposit (ongoing volume generation)
  → Deploy token via Clanker
  → Create EigenLP liquidity position
  → Create EigenVault
  → Mint ERC-8004 agent identity NFT
  → Register eigen config → market making starts automatically
```

### Launch Parameters

```json
{
  "name": "MyToken",
  "symbol": "MTK",
  "description": "A cool token for testing",
  "image": "https://example.com/logo.png",
  "packageId": "starter",
  "class": "operator",
  "feeType": "static",
  "walletCount": 3,
  "allocation": {
    "devBuyPct": 60,
    "liquidityPct": 30,
    "volumePct": 10
  }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Token name (max 64 chars) |
| `symbol` | Yes | — | Token symbol (max 16 chars, auto-uppercased) |
| `description` | No | `""` | Token description (max 500 chars) |
| `image` | No | — | URL to token logo image |
| `packageId` | Yes (for USDC) | — | Which volume package to purchase |
| `class` | No | `"operator"` | Agent class: `sentinel`, `operator`, `architect`, `sovereign` |
| `feeType` | No | `"static"` | Clanker pool fee type: `"static"` or `"dynamic"` |
| `walletCount` | No | Class min | Number of sub-wallets for trading (class determines range) |
| `allocation.devBuyPct` | No | 60 | % of ETH for dev buy |
| `allocation.liquidityPct` | No | 30 | % of ETH for LP pool |
| `allocation.volumePct` | No | 10 | % of ETH for vault (trading capital) |

Allocation percentages must sum to 100.

### Agent Classes

| Class | Min Deposit | Wallets | Volume/Day | Trades/Hr |
|-------|------------|---------|------------|-----------|
| sentinel | Lowest | 2-5 | Low | 4-12 |
| operator | Medium | 3-10 | Medium | 8-30 |
| architect | Higher | 5-15 | High | 15-60 |
| sovereign | Highest | 10-20 | Very High | 30-200 |

For testing, use `operator` class with `starter` package (10 USDC).

### Complete Launch Script (TypeScript/viem)

```typescript
import { createPublicClient, createWalletClient, http, encodePacked, keccak256, toHex, hexToBytes, numberToHex, pad } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const KEEPER = 'https://eigenswarm.xyz';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

// --- Setup ---
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const launchParams = {
  name: 'MyToken',
  symbol: 'MTK',
  description: 'An autonomous market-made token',
  packageId: 'starter', // 10 USDC
  class: 'operator',
};

// --- Step 1: Get x402 payment requirements ---
console.log('Step 1: Requesting payment requirements...');
const res402 = await fetch(`${KEEPER}/api/launch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(launchParams),
});

if (res402.status !== 402) {
  throw new Error(`Expected 402, got ${res402.status}: ${await res402.text()}`);
}

const paymentRequired = await res402.json();
const requirements = paymentRequired.accepts[0];
console.log(`Payment required: ${Number(requirements.maxAmountRequired) / 1e6} USDC to ${requirements.payTo}`);

// --- Step 2: Sign ERC-3009 TransferWithAuthorization (gasless) ---
console.log('Step 2: Signing ERC-3009 authorization...');
const nonce = keccak256(toHex(Date.now().toString() + Math.random().toString()));
const validAfter = 0n;
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

const signature = await walletClient.signTypedData({
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: USDC,
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.maxAmountRequired),
    validAfter,
    validBefore,
    nonce,
  },
});

// Build x402 payment payload and base64-encode it
const paymentPayload = {
  x402Version: 2,
  resource: { url: `${KEEPER}/api/launch`, description: '', mimeType: 'application/json' },
  accepted: requirements,
  payload: {
    signature,
    authorization: {
      from: account.address,
      to: requirements.payTo,
      value: requirements.maxAmountRequired,
      validAfter: '0',
      validBefore: validBefore.toString(),
      nonce,
    },
  },
};

const xPayment = btoa(JSON.stringify(paymentPayload));
console.log('Authorization signed (gasless, no on-chain tx).');

// --- Step 3: Submit signed payment → full launch ---
console.log('Step 3: Submitting x402 payment, launching token...');
const launchRes = await fetch(`${KEEPER}/api/launch`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PAYMENT': xPayment,
  },
  body: JSON.stringify(launchParams),
});

const result = await launchRes.json();

if (!launchRes.ok) {
  throw new Error(`Launch failed: ${result.error}`);
}

console.log('Launch successful!');
console.log(`  Token: ${result.tokenAddress} ($${result.tokenSymbol})`);
console.log(`  Eigen ID: ${result.eigenId}`);
console.log(`  Pool ID: ${result.poolId || 'pending'}`);
console.log(`  Agent 8004 ID: ${result.agent8004Id || 'none'}`);
console.log(`  Status: ${result.status}`);
console.log(`  Deploy TX: ${result.txHashes.deploy}`);

// --- Step 4: Monitor ---
console.log('\nMonitoring...');
const eigen = await fetch(`${KEEPER}/api/eigens/${result.eigenId}`).then(r => r.json());
console.log(`  Balance: ${eigen.data?.balance || '0'} wei`);
console.log(`  Trades: ${eigen.data?.tradeCount || 0}`);
```

### Launch with curl (x402 requires EIP-712 signing)

```bash
KEEPER=https://eigenswarm.xyz

# Step 1: Get x402 payment requirements
curl -s -X POST $KEEPER/api/launch \
  -H "Content-Type: application/json" \
  -d '{"name":"MyToken","symbol":"MTK","packageId":"starter","class":"operator"}'
# → 402 with { x402Version: 2, accepts: [{ scheme: "exact", network: "base", ... }] }

# Step 2+3: Sign ERC-3009 + submit (requires viem/ethers — see TypeScript example above)
# curl cannot sign EIP-712 messages. Use the TypeScript example or any x402-compatible client.
# The @x402/fetch package wraps fetch() with automatic x402 payment handling:
#   import { wrapFetch } from '@x402/fetch';
#   const x402fetch = wrapFetch(fetch, walletClient);
#   const result = await x402fetch(`${KEEPER}/api/launch`, { method: 'POST', body: ... });
```

### Launch Response

```json
{
  "success": true,
  "tokenAddress": "0x...",
  "tokenSymbol": "MTK",
  "eigenId": "ES-abc123",
  "agent8004Id": "42",
  "poolId": "0x...",
  "allocation": {
    "totalEth": "0.005",
    "devBuyEth": "0.003",
    "liquidityEth": "0.0015",
    "volumeEth": "0.0005"
  },
  "txHashes": {
    "swap": "0x...",
    "deploy": "0x...",
    "lp": "0x..."
  },
  "fees": {
    "protocolFee": "0.00025",
    "protocolFeeBps": 500,
    "gasBudget": "0.0003",
    "walletCount": 3,
    "deployableEth": "0.00425"
  },
  "status": "active"
}
```

Status will be:
- `active` — fully deployed and trading
- `pending_lp` — token deployed but LP seeding failed (can retry)

---

## Buy Volume for Existing Token (x402)

If a token already has a trading pool, you can deploy a market maker on it without launching a new token.

### Step-by-Step

```bash
# 1. Verify the token has a pool
curl -s $KEEPER/api/tokens/0xTOKEN_ADDRESS/verify
# Check: valid=true, pool is not null

# 2. Get x402 payment requirements (returns 402)
curl -s -X POST $KEEPER/api/agents/buy-volume \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress":"0xTOKEN","packageId":"micro"}'
# → 402 with { x402Version: 2, accepts: [{ scheme: "exact", maxAmountRequired: "1000000", ... }] }

# 3. Sign ERC-3009 TransferWithAuthorization (gasless) and base64-encode
# 4. Submit signed x402 payload → eigen created
# (Requires EIP-712 signing — see TypeScript example below)
```

### TypeScript Example

```typescript
import { createWalletClient, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const KEEPER = 'https://eigenswarm.xyz';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const TOKEN_ADDRESS = '0x...'; // Token you want to market-make

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// 1. Verify token
const tokenInfo = await fetch(`${KEEPER}/api/tokens/${TOKEN_ADDRESS}/verify`).then(r => r.json());
if (!tokenInfo.data?.valid || !tokenInfo.data?.pool) {
  throw new Error('Token has no trading pool');
}

// 2. Get x402 payment requirements
const res402 = await fetch(`${KEEPER}/api/agents/buy-volume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tokenAddress: TOKEN_ADDRESS, packageId: 'micro' }),
});
const paymentRequired = await res402.json();
const requirements = paymentRequired.accepts[0];

// 3. Sign ERC-3009 authorization (gasless, no on-chain tx)
const nonce = keccak256(toHex(Date.now().toString() + Math.random().toString()));
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

const signature = await walletClient.signTypedData({
  domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: 0n,
    validBefore,
    nonce,
  },
});

const paymentPayload = {
  x402Version: 2,
  resource: { url: `${KEEPER}/api/agents/buy-volume`, description: '', mimeType: 'application/json' },
  accepted: requirements,
  payload: {
    signature,
    authorization: {
      from: account.address, to: requirements.payTo,
      value: requirements.maxAmountRequired,
      validAfter: '0', validBefore: validBefore.toString(), nonce,
    },
  },
};
const xPayment = btoa(JSON.stringify(paymentPayload));

// 4. Submit x402 payment → eigen created
const result = await fetch(`${KEEPER}/api/agents/buy-volume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-PAYMENT': xPayment },
  body: JSON.stringify({ tokenAddress: TOKEN_ADDRESS, packageId: 'micro' }),
}).then(r => r.json());

console.log(`Eigen ${result.eigenId} is ${result.status}`);
```

---

## Volume Packages

| id | ETH volume | Price | Duration |
|----|-----------|-------|----------|
| micro | 0.05 ETH | 1 USDC | 24h |
| mini | 0.1 ETH | 2 USDC | 24h |
| starter | 1 ETH | 10 USDC | 24h |
| growth | 5 ETH | 40 USDC | 24h |
| pro | 20 ETH | 120 USDC | 24h |
| whale | 100 ETH | 500 USDC | 24h |

```bash
# Check current pricing
curl -s $KEEPER/api/pricing
```

---

## Monitoring & Management

### Read-Only Endpoints (no auth required)

```bash
# Eigen status + config
curl -s $KEEPER/api/eigens/{eigenId}

# All eigens (optionally filter by owner)
curl -s $KEEPER/api/eigens?owner=0xADDRESS

# Trade history
curl -s $KEEPER/api/eigens/{eigenId}/trades?limit=50

# P&L summary
curl -s $KEEPER/api/eigens/{eigenId}/pnl

# Price history
curl -s $KEEPER/api/eigens/{eigenId}/price-history?range=1d

# Sub-wallets
curl -s $KEEPER/api/eigens/{eigenId}/wallets

# Keeper health
curl -s $KEEPER/api/health
```

### Authentication: API Key Creation

All management endpoints require an API key (`X-API-KEY` header). You create one by signing a message with your wallet (EIP-191). This is a **one-time setup** — store the key, it cannot be retrieved again.

#### Step 1: Sign the message

The message format is:
```
EigenSwarm Register
eigenId: agent-key
owner: <your_address_lowercase>
timestamp: <unix_seconds>
```

Sign this message with your wallet using EIP-191 (`personal_sign`). The timestamp must be within the last 5 minutes.

#### Step 2: Create the key

```bash
curl -s -X POST $KEEPER/api/agent/keys \
  -H "Content-Type: application/json" \
  -d '{
    "ownerAddress": "0xYOUR_ADDRESS",
    "signature": "0xYOUR_EIP191_SIGNATURE",
    "timestamp": 1700000000,
    "label": "my-agent"
  }'
```

Response (201):
```json
{
  "success": true,
  "apiKey": "esk_abc123...",
  "prefix": "esk_abc12345",
  "label": "my-agent",
  "rateLimit": 60,
  "warning": "Store this key securely. It cannot be retrieved after this response."
}
```

Save the `apiKey` value. Use it as `X-API-KEY` header for all management calls below.

#### TypeScript Example (viem)

```typescript
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const timestamp = Math.floor(Date.now() / 1000);
const message = `EigenSwarm Register\neigenId: agent-key\nowner: ${account.address.toLowerCase()}\ntimestamp: ${timestamp}`;
const signature = await account.signMessage({ message });

const res = await fetch(`${KEEPER}/api/agent/keys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerAddress: account.address,
    signature,
    timestamp,
    label: 'my-agent',
  }),
});
const { apiKey } = await res.json();
// Store apiKey securely — use as X-API-KEY header from now on
```

#### Manage Your Keys

```bash
# List your keys
curl -s $KEEPER/api/agent/keys -H "X-API-KEY: esk_..."

# Revoke a key by prefix
curl -s -X DELETE $KEEPER/api/agent/keys/esk_abc12345 -H "X-API-KEY: esk_..."
```

---

### Management (requires API key)

```bash
# List your eigens
curl -s $KEEPER/api/agent/eigens -H "X-API-KEY: esk_..."

# Adjust config
curl -s -X PATCH $KEEPER/api/agent/eigens/{eigenId} \
  -H "X-API-KEY: esk_..." \
  -H "Content-Type: application/json" \
  -d '{"config": {"volumeTarget": 2, "tradeFrequency": 50}}'

# Take profit (sell % of token positions, keep eigen running)
curl -s -X POST $KEEPER/api/agent/eigens/{eigenId}/take-profit \
  -H "X-API-KEY: esk_..." \
  -H "Content-Type: application/json" \
  -d '{"percent": 50}'

# Withdraw vault ETH to owner wallet
curl -s -X POST $KEEPER/api/agent/eigens/{eigenId}/withdraw \
  -H "X-API-KEY: esk_..." \
  -H "Content-Type: application/json" \
  -d '{"amount": "0.01"}'
# Use "all" to withdraw entire net balance:
# -d '{"amount": "all"}'

# Terminate (sell all tokens + settle fees + send remaining ETH to owner)
curl -s -X POST $KEEPER/api/agent/eigens/{eigenId}/terminate \
  -H "X-API-KEY: esk_..."

# Liquidate (sell all tokens, same as terminate but only sets status)
curl -s -X POST $KEEPER/api/agent/eigens/{eigenId}/liquidate \
  -H "X-API-KEY: esk_..."

# Fund a pending eigen (same x402 flow — sign ERC-3009 + base64-encode)
curl -s -X POST $KEEPER/api/agent/eigens/{eigenId}/fund \
  -H "X-API-KEY: esk_..." \
  -H "X-PAYMENT: <base64_x402_payload>" \
  -H "Content-Type: application/json" \
  -d '{"packageId": "micro"}'
```

### Adjustable Parameters

| Parameter | Description | Range |
|-----------|-------------|-------|
| `volumeTarget` | ETH volume per day | 0.1 - 200 |
| `tradeFrequency` | Trades per hour | 1 - 200 |
| `orderSizePctMin` | Min trade size (% of balance) | 1 - 50 |
| `orderSizePctMax` | Max trade size (% of balance) | 5 - 80 |
| `spreadWidth` | Spread width (%) | 0.1 - 10 |
| `profitTarget` | Profit target (%) | 1 - 500 |
| `stopLoss` | Stop loss (%) | 1 - 100 |
| `slippageBps` | Max slippage (basis points) | 10 - 1000 |
| `reactiveSellMode` | Mirror external buys (0=off, 1=on) | 0 or 1 |
| `reactiveSellPct` | % of detected buy to mirror-sell | 1 - 100 |

---

## Payment Details (x402 Protocol)

- **Protocol**: x402 (ERC-3009 `TransferWithAuthorization`)
- **Token**: USDC (6 decimals)
- **Network**: Base (`base` / chain 8453)
- **USDC on Base**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **Pay to**: `0x42069c220DD72541C2C7Cb7620f2094f1601430A`
- **Facilitator**: `https://x402.org/facilitator` (Coinbase-hosted, fee-free)
- **Gasless**: Client signs off-chain, facilitator pays gas for settlement
- **Owner**: Automatically set to the ERC-3009 signer address

### How x402 Payment Works

1. Request a protected resource (no `X-PAYMENT` header) → get **HTTP 402** with `{ x402Version, accepts: [PaymentRequirements] }`
2. Sign an ERC-3009 `TransferWithAuthorization` using EIP-712 (no gas, no on-chain tx)
3. Build a `PaymentPayload` with the signature + authorization details
4. Base64-encode the payload and send as `X-PAYMENT` header
5. Keeper sends payload to facilitator → facilitator verifies signature + balance → settles on-chain → USDC transferred
6. Each signed payload is single-use (deduplication via payload hash)

---

## Error Handling

| HTTP | Meaning | Action |
|------|---------|--------|
| 402 | Payment required | Sign x402 payload, then retry with `X-PAYMENT` header |
| 400 | Bad request | Check parameters (name, symbol, packageId, etc.) |
| 403 | Unauthorized | Signature invalid or not the eigen owner |
| 404 | Not found | Eigen ID doesn't exist |
| 409 | Conflict | Payment payload already used (each signed authorization is single-use) |
| 429 | Rate limited | Wait 60 seconds and retry |
| 500 | Server error | Payment is auto-released on failure — safe to retry |

If a launch fails after payment verification, the payment lock is released (`deletePayment`) so you can retry with the same signed payload or sign a new one.

---

## Frontend Dashboard

After launching, view your eigens at: `https://eigenswarm.com/app`

Connect the same wallet that signed the x402 payment authorization to see your agents, trades, P&L, and manage them through the UI.

---

## Workflow Summary for AI Agents

```
0. SETUP (one-time):
   Sign EIP-191 message with your wallet
   POST /api/agent/keys  →  get API key (esk_...)
   Store the key — use X-API-KEY header for all management calls

1. Decide: Launch new token? or Buy volume for existing token?

2. If LAUNCH NEW TOKEN:
   POST /api/launch  (no X-PAYMENT)  →  get 402 + x402 payment requirements
   Sign ERC-3009 TransferWithAuthorization (gasless)
   Base64-encode the signed payload
   POST /api/launch  (with X-PAYMENT: base64_payload)  →  get token + eigen + pool

3. If BUY VOLUME:
   GET /api/tokens/{address}/verify  →  check valid + pool exists
   POST /api/agents/buy-volume  (no X-PAYMENT)  →  get 402
   Sign ERC-3009 TransferWithAuthorization (gasless)
   POST /api/agents/buy-volume  (with X-PAYMENT: base64_payload)  →  get eigenId

4. MONITOR:
   GET /api/eigens/{eigenId}  →  status, balance, trades
   GET /api/eigens/{eigenId}/pnl  →  P&L breakdown

5. MANAGE (optional):
   PATCH /api/agent/eigens/{eigenId}  →  adjust parameters
   POST /api/agent/eigens/{eigenId}/take-profit  →  sell tokens, keep running
   POST /api/agent/eigens/{eigenId}/withdraw  →  withdraw vault ETH to owner
   POST /api/agent/eigens/{eigenId}/terminate  →  sell all + settle fees + send ETH to owner
   POST /api/agent/eigens/{eigenId}/liquidate  →  sell all tokens (status change only)
```
