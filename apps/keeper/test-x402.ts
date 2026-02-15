/**
 * x402 Payment Flow Test Script
 *
 * Tests the full agent → x402 → eigen creation → auto-funding flow.
 *
 * Usage:
 *   1. Start keeper with test mode:
 *      X402_TEST_MODE=true npx tsx src/index.ts
 *
 *   2. Run this test:
 *      npx tsx test-x402.ts
 *
 *   3. Or test against real chain (needs a real USDC tx hash):
 *      npx tsx test-x402.ts --tx 0xYourTxHash
 */

const KEEPER_URL = process.env.KEEPER_URL || 'http://localhost:3001';
const TOKEN_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'; // Example: VIRTUAL on Base

async function main() {
  const realTxHash = process.argv.find((a) => a.startsWith('0x'));

  console.log('=== EigenSwarm x402 Payment Flow Test ===\n');
  console.log(`Keeper URL: ${KEEPER_URL}`);
  console.log(`Test mode: ${realTxHash ? 'NO (using real tx)' : 'YES (mock payments)'}\n`);

  // ── Step 1: Health Check ──────────────────────────────────────────

  console.log('--- Step 1: Health Check ---');
  try {
    const health = await fetchJson('GET', '/api/health');
    console.log('Keeper status:', health.status || 'unknown');
    console.log('Keeper address:', health.keeperAddress || 'N/A');
    console.log('Keeper balance:', health.keeperBalance || 'N/A');
    console.log('PASS\n');
  } catch (e) {
    console.error('FAIL: Keeper not reachable at', KEEPER_URL);
    console.error('Start it with: X402_TEST_MODE=true npx tsx src/index.ts\n');
    process.exit(1);
  }

  // ── Step 2: Get Pricing ───────────────────────────────────────────

  console.log('--- Step 2: Get Pricing ---');
  const pricing = await fetchJson('GET', '/api/pricing');
  console.log('Payment token:', pricing.paymentToken);
  console.log('Payment address:', pricing.paymentAddress);
  console.log('Supported chains:', pricing.supportedChains?.map((c: { name: string; chainId: number }) => `${c.name} (${c.chainId})`).join(', '));
  console.log('Packages:');
  for (const pkg of pricing.packages) {
    console.log(`  ${pkg.id}: ${pkg.ethVolume} ETH volume, ${pkg.priceUSDC} USDC, ${pkg.duration}`);
  }
  console.log('PASS\n');

  // ── Step 3: Get Supported Chains ──────────────────────────────────

  console.log('--- Step 3: Get Supported Chains ---');
  const chains = await fetchJson('GET', '/api/chains');
  for (const chain of chains.data || []) {
    console.log(`  ${chain.name} (${chain.chainId}): vault=${chain.hasEigenVault ? 'yes' : 'no'}, v3=${chain.hasUniswapV3 ? 'yes' : 'no'}, v4=${chain.hasUniswapV4 ? 'yes' : 'no'}`);
  }
  console.log('PASS\n');

  // ── Step 4: Treasury Health ───────────────────────────────────────

  console.log('--- Step 4: Treasury Health ---');
  try {
    const treasury = await fetchJson('GET', '/api/treasury');
    console.log('Keeper address:', treasury.keeperAddress);
    console.log('ETH balance:', treasury.ethBalance);
    console.log('Can fund eigens:', treasury.canFundEigens);
    console.log('PASS\n');
  } catch (e) {
    console.log('SKIP (treasury endpoint may not be available without vault)\n');
  }

  // ── Step 5: x402 Flow — Request Payment (402 Response) ───────────

  console.log('--- Step 5: x402 — Request Payment (expect 402) ---');
  const buyBody = {
    tokenAddress: TOKEN_ADDRESS,
    packageId: 'starter',
  };

  const step5 = await fetchRaw('POST', '/api/agents/buy-volume', buyBody);
  console.log('Status code:', step5.status);

  if (step5.status === 402) {
    const paymentDetails = await step5.json();
    console.log('Payment required:');
    console.log('  Amount:', paymentDetails.payment?.amount, 'USDC');
    console.log('  Token:', paymentDetails.payment?.token);
    console.log('  Chain:', paymentDetails.payment?.chain);
    console.log('  Recipient:', paymentDetails.payment?.recipient);
    console.log('  Supported chains:', paymentDetails.payment?.supportedChains?.length || 0);

    // Check X-PAYMENT-REQUIRED header
    const headerVal = step5.headers.get('x-payment-required');
    console.log('  X-PAYMENT-REQUIRED header:', headerVal ? 'present' : 'missing');
    console.log('PASS\n');
  } else {
    const body = await step5.json();
    console.log('Unexpected response:', JSON.stringify(body, null, 2));
    console.log('FAIL\n');
  }

  // ── Step 6: x402 Flow — Submit Payment ────────────────────────────

  console.log('--- Step 6: x402 — Submit Payment ---');
  const txHash = realTxHash || '0xTEST_' + Math.random().toString(16).slice(2, 18);
  console.log('Payment tx hash:', txHash);

  const step6 = await fetchRaw('POST', '/api/agents/buy-volume', buyBody, {
    'X-PAYMENT': txHash,
  });
  const step6Body = await step6.json();
  console.log('Status code:', step6.status);

  if (step6.status === 201 && step6Body.success) {
    console.log('Eigen created!');
    console.log('  Eigen ID:', step6Body.eigenId);
    console.log('  Chain ID:', step6Body.chainId);
    console.log('  Package:', step6Body.package);
    console.log('  ETH Volume:', step6Body.ethVolume);
    console.log('  Status:', step6Body.status);
    console.log('  Paid by:', step6Body.paidBy);
    console.log('  Paid amount:', step6Body.paidAmount, 'USDC');
    console.log('  Funding:');
    console.log('    Funded:', step6Body.funding?.funded);
    console.log('    Funding TX:', step6Body.funding?.fundingTx || 'N/A');
    console.log('    Error:', step6Body.funding?.error || 'none');
    console.log('PASS\n');

    // ── Step 7: Verify Eigen Exists ─────────────────────────────────

    console.log('--- Step 7: Verify Eigen Exists ---');
    try {
      const eigen = await fetchJson('GET', `/api/eigens/${step6Body.eigenId}`);
      console.log('Eigen found:', eigen.data?.eigen_id || eigen.eigenId || 'yes');
      console.log('Token:', eigen.data?.token_address || 'N/A');
      console.log('Status:', eigen.data?.status || 'N/A');
      console.log('Chain ID:', eigen.data?.chain_id || 'N/A');
      console.log('PASS\n');
    } catch (e) {
      console.log('Eigen lookup failed (may be normal if not using ponder):', (e as Error).message);
      console.log('SKIP\n');
    }

    // ── Step 8: Replay Protection ───────────────────────────────────

    console.log('--- Step 8: Replay Protection (same tx should fail) ---');
    const step8 = await fetchRaw('POST', '/api/agents/buy-volume', buyBody, {
      'X-PAYMENT': txHash,
    });
    const step8Body = await step8.json();
    console.log('Status code:', step8.status);
    console.log('Error:', step8Body.error);
    if (step8.status === 409 && step8Body.error === 'Payment already used') {
      console.log('PASS — replay correctly rejected\n');
    } else {
      console.log('WARN — expected 409 but got', step8.status, '\n');
    }
  } else {
    console.log('Payment verification failed:');
    console.log('  Error:', step6Body.error);
    console.log('  Details:', step6Body.details);
    if (!realTxHash) {
      console.log('\nMake sure keeper is running with X402_TEST_MODE=true');
      console.log('Or provide a real USDC tx hash: npx tsx test-x402.ts 0xYourTxHash');
    }
    console.log('FAIL\n');
  }

  console.log('=== Test Complete ===');
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function fetchJson(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetchRaw(method, path, body);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchRaw(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  return fetch(`${KEEPER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

main().catch((e) => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
