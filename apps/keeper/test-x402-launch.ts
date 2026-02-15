/**
 * Test script: x402 token launch on Monad
 *
 * Uses the x402 SDK to sign a USDC payment and send it to the launch endpoint.
 * Uses the "micro" package (0.05 ETH volume, 1 USDC).
 */
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPaymentHeader } from 'x402/client';

const KEEPER_URL = process.env.KEEPER_BASE_URL || 'https://monad.eigenswarm.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error('KEEPER_PRIVATE_KEY not set');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log(`[Test] Using wallet: ${account.address}`);

async function main() {
  // Step 1: Get 402 payment requirements
  console.log(`[Test] Fetching payment requirements from ${KEEPER_URL}/api/services/token-launch...`);
  const discoverRes = await fetch(`${KEEPER_URL}/api/services/token-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId: 'micro' }), // 1 USDC = cheapest
  });

  if (discoverRes.status !== 402) {
    console.error(`[Test] Expected 402, got ${discoverRes.status}`);
    console.error(await discoverRes.text());
    process.exit(1);
  }

  const paymentRequired = await discoverRes.json();
  console.log(`[Test] Got 402 response:`);
  console.log(`  - Network: ${paymentRequired.accepts[0].network}`);
  console.log(`  - Amount: ${paymentRequired.accepts[0].amount} (${parseInt(paymentRequired.accepts[0].amount) / 1_000_000} USDC)`);
  console.log(`  - Asset: ${paymentRequired.accepts[0].asset}`);
  console.log(`  - PayTo: ${paymentRequired.accepts[0].payTo}`);

  // Step 2: Create x402 payment header (signs ERC-3009 TransferWithAuthorization)
  console.log(`\n[Test] Signing x402 payment...`);

  // Create a viem wallet client as the Signer
  const monadChain = {
    id: 10143,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  } as const;

  const walletClient = createWalletClient({
    account,
    chain: monadChain,
    transport: http('https://rpc.monad.xyz'),
  });

  try {
    const paymentHeader = await createPaymentHeader(
      walletClient as any,
      paymentRequired.x402Version,
      paymentRequired.accepts[0],
    );

    console.log(`[Test] Payment header created (${paymentHeader.length} chars)`);

    // Step 3: Send the launch request with payment
    console.log(`\n[Test] Sending launch request...`);
    const launchRes = await fetch(`${KEEPER_URL}/api/services/token-launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Payment-Signature': paymentHeader,
      },
      body: JSON.stringify({
        name: 'X402 Test Token',
        symbol: 'X402T',
        packageId: 'micro',
        class: 'sentinel',
        walletCount: 1,
        description: 'Testing x402 payment on Monad',
        chainId: 143,
      }),
    });

    const result = await launchRes.json();
    console.log(`\n[Test] Launch response (${launchRes.status}):`);
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error(`[Test] Payment signing failed:`, (err as Error).message);
    console.error(`[Test] This likely means the wallet doesn't have USDC on Monad or the network isn't supported by x402 SDK`);
  }
}

main().catch(console.error);
