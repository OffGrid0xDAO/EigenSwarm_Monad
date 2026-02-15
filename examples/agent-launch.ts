/**
 * Agent-Launched Market Maker — Complete Flow
 *
 * This script demonstrates the full lifecycle of an agent creating
 * and managing a market-making eigen via the EigenSwarm SDK:
 *
 *   1. Health check
 *   2. Verify token has a trading pool
 *   3. Buy volume package (x402 payment)
 *   4. Monitor the eigen
 *   5. Take profit
 *
 * Prerequisites:
 *   - An API key (get one via POST /api/agent/keys with EIP-191 signature)
 *   - USDC on Monad (or another supported chain) for x402 payment
 *
 * Usage:
 *   EIGENSWARM_API_KEY=esk_... TOKEN_ADDRESS=0x... npx tsx examples/agent-launch.ts
 */

import { EigenSwarmClient } from '@eigenswarm/sdk';
import type { BuyVolumeResult, PaymentRequiredResponse } from '@eigenswarm/sdk';

// ── Configuration ─────────────────────────────────────────────────────

const KEEPER_URL = process.env.EIGENSWARM_KEEPER_URL || 'http://localhost:3001';
const API_KEY = process.env.EIGENSWARM_API_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PACKAGE_ID = process.env.PACKAGE_ID || 'starter';

// In a real agent, this would be the tx hash from sending USDC on-chain
const PAYMENT_TX_HASH = process.env.PAYMENT_TX_HASH;

if (!API_KEY) {
  console.error('Set EIGENSWARM_API_KEY environment variable');
  process.exit(1);
}

if (!TOKEN_ADDRESS) {
  console.error('Set TOKEN_ADDRESS environment variable');
  process.exit(1);
}

const client = new EigenSwarmClient({
  keeperUrl: KEEPER_URL,
  apiKey: API_KEY,
  chainId: 143, // Monad
});

// ── Helpers ───────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPaymentRequired(data: BuyVolumeResult | PaymentRequiredResponse): data is PaymentRequiredResponse {
  return 'amount' in data && 'recipient' in data;
}

// ── Main Flow ─────────────────────────────────────────────────────────

async function main() {
  // Step 1: Health check
  console.log('1. Checking keeper health...');
  const health = await client.health();
  console.log(`   Keeper status: ${health.status}`);

  // Step 2: Verify token
  console.log(`\n2. Verifying token ${TOKEN_ADDRESS}...`);
  const tokenInfo = await client.verifyToken(TOKEN_ADDRESS!);
  if (!tokenInfo.valid) {
    console.error(`   Token verification failed — no pool found`);
    process.exit(1);
  }
  console.log(`   Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
  console.log(`   Pool: ${tokenInfo.pool ? tokenInfo.pool.version : 'none'}`);

  // Step 3: Buy volume
  console.log(`\n3. Purchasing ${PACKAGE_ID} volume package...`);

  if (!PAYMENT_TX_HASH) {
    // Step 3a: Get payment instructions (402 response)
    const paymentInfo = await client.buyVolume(TOKEN_ADDRESS!, PACKAGE_ID);

    if (isPaymentRequired(paymentInfo)) {
      console.log('   Payment required:');
      console.log(`   Amount: ${paymentInfo.amount} USDC`);
      console.log(`   Recipient: ${paymentInfo.recipient}`);
      console.log(`   Chain: ${paymentInfo.chain}`);
      console.log(`\n   Send USDC, then re-run with PAYMENT_TX_HASH=0x...`);
      process.exit(0);
    }
  }

  // Step 3b: Submit payment proof and create eigen
  const result = await client.buyVolume(TOKEN_ADDRESS!, PACKAGE_ID, PAYMENT_TX_HASH);

  if (isPaymentRequired(result)) {
    console.error('   Unexpected 402 — payment may have been rejected');
    process.exit(1);
  }

  const buyResult = result as BuyVolumeResult;
  console.log(`   Eigen created: ${buyResult.eigenId}`);
  console.log(`   Status: ${buyResult.status}`);
  console.log(`   Volume: ${buyResult.ethVolume} ETH`);
  console.log(`   Funded: ${buyResult.funding.funded}`);

  if (!buyResult.funding.funded) {
    console.log(`\n   Eigen needs funding. Use the fund endpoint:`);
    console.log(`   POST /api/agent/eigens/${buyResult.eigenId}/fund`);
  }

  // Step 4: Monitor
  console.log(`\n4. Monitoring eigen...`);
  const eigenId = buyResult.eigenId;

  for (let i = 0; i < 5; i++) {
    await sleep(10_000);

    const eigens = await client.listEigens();
    const eigen = eigens.data.find((e) => e.eigenId === eigenId);
    if (!eigen) {
      console.log(`   [${i + 1}] Eigen not found in list yet`);
      continue;
    }

    console.log(
      `   [${i + 1}] Status: ${eigen.status} | Buys: ${eigen.stats.totalBuys} | Sells: ${eigen.stats.totalSells} | P&L: ${eigen.stats.totalRealizedPnl.toFixed(6)} ETH`,
    );

    // Step 5: Take profit if we have realized gains
    if (eigen.stats.totalRealizedPnl > 0 && eigen.stats.totalSells > 0) {
      console.log(`\n5. Taking profit (50%)...`);
      const tp = await client.takeProfit(eigenId, 50);
      console.log(`   Take profit status: ${tp.status}`);
      break;
    }
  }

  console.log('\nDone. Eigen will continue trading until volume target is met or liquidated.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
