/**
 * x402 PRODUCTION Test — Real USDC on Base
 *
 * Tests the full x402 payment flow against the live keeper.
 *
 * Prerequisites:
 *   - You have USDC on Base (1-2 USDC)
 *   - The keeper is running at the production URL
 *   - The keeper wallet has ETH on Base for treasury funding
 *
 * Usage:
 *   Step 1 — See payment instructions:
 *     npx tsx test-x402-prod.ts
 *
 *   Step 2 — After sending USDC, submit the tx hash:
 *     npx tsx test-x402-prod.ts 0xYourUsdcTransferTxHash
 */

// ── Configuration ────────────────────────────────────────────────────────

const KEEPER_URL = process.env.KEEPER_URL || 'https://api.eigenswarm.xyz';
const TOKEN_ADDRESS = '0x42069d11A2CC72388a2e06210921E839Cfbd3280';
const PACKAGE_ID = 'micro'; // 1 USDC → 0.05 ETH volume

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const txHash = process.argv.find((a) => a.startsWith('0x'));

  console.log('========================================');
  console.log('  EigenSwarm x402 Production Test');
  console.log('========================================\n');
  console.log(`Keeper:  ${KEEPER_URL}`);
  console.log(`Token:   ${TOKEN_ADDRESS}`);
  console.log(`Package: ${PACKAGE_ID}`);
  console.log('');

  // ── Health Check ──────────────────────────────────────────────────

  console.log('[1/5] Checking keeper health...');
  try {
    const health = await fetchJson('GET', '/api/health');
    console.log(`  Status:  ${health.status || 'OK'}`);
    console.log(`  Keeper:  ${health.keeperAddress || 'N/A'}`);
    console.log(`  Balance: ${health.keeperBalance || 'N/A'} ETH`);
  } catch (e) {
    console.error(`  FAILED: ${(e as Error).message}`);
    console.error('  Is the keeper running at', KEEPER_URL, '?');
    process.exit(1);
  }

  // ── Pricing ───────────────────────────────────────────────────────

  console.log('\n[2/5] Fetching pricing...');
  const pricing = await fetchJson('GET', '/api/pricing');
  const pkg = pricing.packages?.find((p: { id: string }) => p.id === PACKAGE_ID);
  if (!pkg) {
    console.error(`  Package "${PACKAGE_ID}" not found!`);
    console.error('  Available:', pricing.packages?.map((p: { id: string }) => p.id).join(', '));
    process.exit(1);
  }
  console.log(`  Package:  ${pkg.id}`);
  console.log(`  Price:    ${pkg.priceUSDC} USDC`);
  console.log(`  Volume:   ${pkg.ethVolume} ETH`);
  console.log(`  Duration: ${pkg.duration}`);
  console.log(`  Pay to:   ${pricing.paymentAddress}`);

  // ── Treasury ──────────────────────────────────────────────────────

  console.log('\n[3/5] Checking treasury...');
  try {
    const treasury = await fetchJson('GET', '/api/treasury');
    console.log(`  ETH Balance:    ${treasury.ethBalance} ETH`);
    console.log(`  Can fund eigen: ${treasury.canFundEigens}`);
    if (!treasury.canFundEigens) {
      console.warn('  WARNING: Treasury may not have enough ETH to fund the eigen!');
      console.warn('  The keeper wallet needs ETH to call createEigenFor() on the vault.');
    }
  } catch {
    console.log('  (treasury endpoint not available — skipping)');
  }

  if (!txHash) {
    // ── Step 4: Get Payment Instructions ────────────────────────────

    console.log('\n[4/5] Requesting payment instructions (402)...');
    const res = await fetchRaw('POST', '/api/agents/buy-volume', {
      tokenAddress: TOKEN_ADDRESS,
      packageId: PACKAGE_ID,
    });

    if (res.status === 402) {
      const body = await res.json();
      const payment = body.payment;

      console.log('\n  ╔══════════════════════════════════════════════╗');
      console.log('  ║         PAYMENT INSTRUCTIONS                 ║');
      console.log('  ╠══════════════════════════════════════════════╣');
      console.log(`  ║  Send:  ${payment.amount} USDC`);
      console.log(`  ║  To:    ${payment.recipient}`);
      console.log(`  ║  Chain: Base (${payment.chain})`);
      console.log(`  ║  Token: ${payment.token}`);
      console.log('  ╚══════════════════════════════════════════════╝');
      console.log('');
      console.log('  Next steps:');
      console.log(`  1. Send ${payment.amount} USDC to ${payment.recipient} on Base`);
      console.log('  2. Wait for the tx to confirm');
      console.log('  3. Re-run this script with the tx hash:');
      console.log('');
      console.log(`     npx tsx test-x402-prod.ts 0xYourTxHash`);
      console.log('');
    } else {
      const body = await res.json();
      console.log(`  Unexpected status ${res.status}:`, JSON.stringify(body, null, 2));
    }

    return;
  }

  // ── Step 4: Submit Payment ────────────────────────────────────────

  console.log(`\n[4/5] Submitting payment tx: ${txHash.slice(0, 20)}...`);

  const res = await fetchRaw('POST', '/api/agents/buy-volume', {
    tokenAddress: TOKEN_ADDRESS,
    packageId: PACKAGE_ID,
  }, {
    'X-PAYMENT': txHash,
  });

  const body = await res.json();
  console.log(`  Status: ${res.status}`);

  if (res.status === 201 && body.success) {
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║           EIGEN CREATED!                     ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║  Eigen ID:   ${body.eigenId}`);
    console.log(`  ║  Chain:      ${body.chainId}`);
    console.log(`  ║  Package:    ${body.package}`);
    console.log(`  ║  Volume:     ${body.ethVolume} ETH`);
    console.log(`  ║  Status:     ${body.status}`);
    console.log(`  ║  Paid:       ${body.paidAmount} USDC by ${body.paidBy?.slice(0, 10)}...`);
    console.log('  ║');
    console.log(`  ║  Funding:    ${body.funding?.funded ? 'YES' : 'NO'}`);
    if (body.funding?.fundingTx) {
      console.log(`  ║  Fund TX:    ${body.funding.fundingTx.slice(0, 20)}...`);
    }
    if (body.funding?.error) {
      console.log(`  ║  Fund Error: ${body.funding.error}`);
    }
    console.log('  ╚══════════════════════════════════════════════╝');

    // ── Step 5: Verify Eigen ──────────────────────────────────────

    console.log(`\n[5/5] Verifying eigen ${body.eigenId}...`);
    try {
      const eigen = await fetchJson('GET', `/api/eigens/${body.eigenId}`);
      console.log(`  Found:   yes`);
      console.log(`  Token:   ${eigen.data?.token_address || eigen.data?.tokenAddress || 'N/A'}`);
      console.log(`  Status:  ${eigen.data?.status || 'N/A'}`);
      console.log(`  Class:   ${eigen.data?.class || 'N/A'}`);
    } catch {
      console.log('  (eigen not found via API — may need time to sync)');
    }

    console.log('\n  The keeper will start market-making this token');
    console.log('  on the next trade cycle (every 15s by default).');
    console.log(`\n  Monitor: GET ${KEEPER_URL}/api/eigens/${body.eigenId}/trades`);
    console.log(`  P&L:     GET ${KEEPER_URL}/api/eigens/${body.eigenId}/pnl`);
  } else if (res.status === 402) {
    console.log('\n  Payment verification FAILED:');
    console.log(`  Error: ${body.error}`);
    console.log(`  Details: ${body.details}`);
    console.log('\n  Common issues:');
    console.log('  - Tx not confirmed yet (wait a few seconds and retry)');
    console.log('  - USDC was sent to wrong address');
    console.log('  - USDC amount too low');
    console.log('  - Tx older than 1 hour');
  } else if (res.status === 409) {
    console.log('\n  Payment already used (replay protection working correctly)');
  } else {
    console.log('\n  Error:', JSON.stringify(body, null, 2));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function fetchJson(method: string, path: string): Promise<any> {
  const res = await fetch(`${KEEPER_URL}${path}`, { method });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchRaw(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetch(`${KEEPER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
}

main().catch((e) => {
  console.error('\nTest failed:', e.message);
  process.exit(1);
});
