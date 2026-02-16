/**
 * Test script: x402 token launch on Monad
 *
 * Manually signs ERC-3009 TransferWithAuthorization via EIP-712
 * because the x402 SDK (v0.7.3) doesn't have Monad in its hardcoded network list.
 *
 * Uses the "micro" package (0.05 ETH volume, 1 USDC).
 *
 * Reference: https://docs.monad.xyz/guides/x402-guide
 */
import 'dotenv/config';
import { createWalletClient, http, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const KEEPER_URL = process.env.KEEPER_BASE_URL || 'https://monad.eigenswarm.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error('KEEPER_PRIVATE_KEY not set');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log(`[Test] Using wallet: ${account.address}`);

const monadChain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
} as const;

async function main() {
  // ── Step 1: Get 402 payment requirements ──────────────────────────────
  console.log(`[Test] Fetching payment requirements from ${KEEPER_URL}/api/services/token-launch...`);
  const discoverRes = await fetch(`${KEEPER_URL}/api/services/token-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId: 'micro' }),
  });

  if (discoverRes.status !== 402) {
    console.error(`[Test] Expected 402, got ${discoverRes.status}`);
    console.error(await discoverRes.text());
    process.exit(1);
  }

  const paymentRequired = await discoverRes.json();
  const accepts = paymentRequired.accepts[0];
  console.log(`[Test] Got 402 response:`);
  console.log(`  - Network: ${accepts.network}`);
  console.log(`  - Amount: ${accepts.amount} (${parseInt(accepts.amount) / 1_000_000} USDC)`);
  console.log(`  - Asset: ${accepts.asset}`);
  console.log(`  - PayTo: ${accepts.payTo}`);
  console.log(`  - Extra: ${JSON.stringify(accepts.extra)}`);

  // ── Step 2: Sign ERC-3009 TransferWithAuthorization ───────────────────
  console.log(`\n[Test] Signing ERC-3009 TransferWithAuthorization...`);

  const walletClient = createWalletClient({
    account,
    chain: monadChain,
    transport: http(monadChain.rpcUrls.default.http[0]),
  });

  // ERC-3009 authorization parameters
  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(now - 600).toString();   // 10 min in the past (clock skew tolerance)
  const validBefore = BigInt(now + (accepts.maxTimeoutSeconds || 300)).toString();
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));

  const authorization = {
    from: account.address,
    to: accepts.payTo as `0x${string}`,
    value: BigInt(accepts.amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: nonce as `0x${string}`,
  };

  console.log(`  - from: ${authorization.from}`);
  console.log(`  - to: ${authorization.to}`);
  console.log(`  - value: ${authorization.value} (${Number(authorization.value) / 1_000_000} USDC)`);
  console.log(`  - validAfter: ${authorization.validAfter} (${new Date(Number(validAfter) * 1000).toISOString()})`);
  console.log(`  - validBefore: ${authorization.validBefore} (${new Date(Number(validBefore) * 1000).toISOString()})`);
  console.log(`  - nonce: ${nonce}`);

  // EIP-712 domain — must match the USDC contract's EIP-712 domain
  const domain = {
    name: accepts.extra?.name || 'USDC',
    version: accepts.extra?.version || '2',
    chainId: 10143,
    verifyingContract: accepts.asset as `0x${string}`,
  };

  console.log(`  - EIP-712 domain: ${JSON.stringify(domain)}`);

  // EIP-712 types for ERC-3009 TransferWithAuthorization
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;

  try {
    const signature = await walletClient.signTypedData({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    });

    console.log(`[Test] Signature: ${signature.slice(0, 20)}...${signature.slice(-10)}`);

    // ── Step 3: Build x402 payment payload ────────────────────────────────
    // Format matches x402 exact EVM scheme: base64(JSON({ x402Version, scheme, network, payload }))
    const paymentPayload = {
      x402Version: paymentRequired.x402Version,
      scheme: 'exact',
      network: accepts.network,
      payload: {
        signature,
        authorization: {
          from: account.address,
          to: accepts.payTo,
          value: accepts.amount,
          validAfter,
          validBefore,
          nonce,
        },
      },
    };

    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
    console.log(`[Test] Payment header created (${paymentHeader.length} chars)`);

    // ── Step 4: Send the launch request with payment ──────────────────────
    console.log(`\n[Test] Sending launch request with payment...`);
    const launchRes = await fetch(`${KEEPER_URL}/api/services/token-launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      },
      body: JSON.stringify({
        name: 'X402 Test Token',
        symbol: 'X402T',
        packageId: 'micro',
        class: 'sentinel',
        walletCount: 1,
        description: 'Testing x402 payment on Monad',
        chainId: 10143,
      }),
    });

    const result = await launchRes.json();
    console.log(`\n[Test] Launch response (${launchRes.status}):`);
    console.log(JSON.stringify(result, null, 2));

    if (launchRes.status === 200 || launchRes.status === 201) {
      console.log('\n✅ x402 payment + token launch succeeded!');
    } else {
      console.log('\n❌ Launch failed — see response above');
    }
  } catch (err) {
    console.error(`[Test] Failed:`, (err as Error).message);
    console.error((err as Error).stack);
  }
}

main().catch(console.error);
