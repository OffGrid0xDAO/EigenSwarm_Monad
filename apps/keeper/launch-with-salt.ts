/**
 * Launch a new token via EigenAtomicLauncher using nad.fun's full API flow:
 *   1. Upload image → image_uri
 *   2. Upload metadata → metadata_uri (used as tokenURI in create())
 *   3. Mine salt → { salt, address } ending in 7777
 *   4. Call atomicLaunch() with salt + metadata_uri
 *
 * Usage: cd apps/keeper && npx tsx launch-with-salt.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  formatEther,
  parseEther,
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Config ──────────────────────────────────────────────────────────────

const TOKEN_NAME = 'EigenSwarm';
const TOKEN_SYMBOL = 'EIGEN';
const TOKEN_DESCRIPTION = 'EigenSwarm — autonomous AI agent swarm on Monad. Atomic token creation + V4 LP + vault in one tx.';

const DEPLOYER_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
if (!DEPLOYER_KEY) throw new Error('KEEPER_PRIVATE_KEY not set');

const ATOMIC_LAUNCHER = '0x9920E8900a154Da216d56F005156FA354835CDAE' as const;
const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);

// nad.fun mainnet API
const NADFUN_API = 'https://api.nadapp.net';

// Amounts
const DEV_BUY_MON = parseEther('1');        // 1 MON for dev buy on bonding curve
const LP_MON = parseEther('1');              // 1 MON for V4 LP
const VAULT_DEPOSIT_MON = parseEther('0.1'); // 0.1 MON for vault deposit
const DEPLOY_FEE = parseEther('10');         // nad.fun deploy fee
const TOTAL = DEPLOY_FEE + DEV_BUY_MON + LP_MON + VAULT_DEPOSIT_MON;

// V4 pool params
const SQRT_PRICE_X96 = 6086388714034984549068811796480n; // ~5900 tokens/MON
const TRADING_FEE_BPS = 500n; // 5%

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
});

const publicClient = createPublicClient({ chain: monad, transport: http() });
const walletClient = createWalletClient({
  account: DEPLOYER,
  chain: monad,
  transport: http(),
});

// ── nad.fun API Functions ───────────────────────────────────────────────

async function uploadImage(imageBuffer: Buffer, contentType: string): Promise<{ imageUri: string; isNsfw: boolean }> {
  console.log(`  Uploading image (${imageBuffer.length} bytes, ${contentType})...`);
  const response = await fetch(`${NADFUN_API}/metadata/image`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: imageBuffer,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Image upload failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`  Image URI: ${data.image_uri}`);
  return { imageUri: data.image_uri, isNsfw: data.is_nsfw };
}

async function uploadMetadata(params: {
  imageUri: string;
  name: string;
  symbol: string;
  description: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}): Promise<{ metadataUri: string }> {
  console.log(`  Uploading metadata...`);
  const response = await fetch(`${NADFUN_API}/metadata/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_uri: params.imageUri,
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      website: params.website ?? null,
      twitter: params.twitter ?? null,
      telegram: params.telegram ?? null,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Metadata upload failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`  Metadata URI: ${data.metadata_uri}`);
  return { metadataUri: data.metadata_uri };
}

async function mineSalt(params: {
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}): Promise<{ salt: `0x${string}`; address: `0x${string}` }> {
  console.log(`  Mining salt for creator=${params.creator.slice(0, 10)}...`);
  const response = await fetch(`${NADFUN_API}/token/salt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      metadata_uri: params.metadataUri,
    }),
    signal: AbortSignal.timeout(60000), // Salt mining can take a while
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Salt mining failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`  Salt: ${data.salt}`);
  console.log(`  Predicted address: ${data.address}`);
  return {
    salt: data.salt as `0x${string}`,
    address: data.address as `0x${string}`,
  };
}

// ── Generate a simple placeholder image ─────────────────────────────────

function generatePlaceholderSvg(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="50%" style="stop-color:#16213e"/>
        <stop offset="100%" style="stop-color:#0f3460"/>
      </linearGradient>
      <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#e94560"/>
        <stop offset="100%" style="stop-color:#533483"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)" rx="64"/>
    <circle cx="256" cy="200" r="80" fill="none" stroke="url(#glow)" stroke-width="4"/>
    <circle cx="256" cy="200" r="40" fill="url(#glow)" opacity="0.3"/>
    <circle cx="256" cy="200" r="8" fill="#e94560"/>
    <circle cx="200" cy="260" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <circle cx="312" cy="260" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <circle cx="256" cy="310" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <line x1="256" y1="200" x2="200" y2="260" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="256" y1="200" x2="312" y2="260" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="256" y1="200" x2="256" y2="310" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="200" y1="260" x2="312" y2="260" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <line x1="200" y1="260" x2="256" y2="310" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <line x1="312" y1="260" x2="256" y2="310" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <text x="256" y="420" font-family="monospace" font-size="48" font-weight="bold" fill="white" text-anchor="middle">EIGEN</text>
    <text x="256" y="460" font-family="monospace" font-size="18" fill="#e94560" text-anchor="middle" opacity="0.8">EigenSwarm</text>
  </svg>`;
  return Buffer.from(svg);
}

// ── EigenAtomicLauncher ABI ─────────────────────────────────────────────

const ATOMIC_LAUNCHER_ABI = [
  {
    type: 'function',
    name: 'atomicLaunch',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'tokenURI', type: 'string' },
      { name: 'salt', type: 'bytes32' },
      { name: 'actionId', type: 'uint8' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'eigenId', type: 'bytes32' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tradingFeeBps', type: 'uint256' },
      { name: 'devBuyMon', type: 'uint256' },
      { name: 'lpMon', type: 'uint256' },
      { name: 'vaultDepositMon', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [{ name: 'token', type: 'address' }],
    stateMutability: 'payable',
  },
] as const;

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== EigenSwarm Atomic Launch with nad.fun API ===\n');

  const balance = await publicClient.getBalance({ address: DEPLOYER.address });
  console.log(`Deployer: ${DEPLOYER.address}`);
  console.log(`Balance: ${formatEther(balance)} MON`);
  console.log(`Required: ${formatEther(TOTAL)} MON\n`);

  if (balance < TOTAL + parseEther('0.5')) {
    console.error('Insufficient balance!');
    return;
  }

  // Step 1: Upload image to nad.fun
  console.log('Step 1: Upload image to nad.fun...');
  const imageBuffer = generatePlaceholderSvg();
  const { imageUri } = await uploadImage(imageBuffer, 'image/svg+xml');

  // Step 2: Upload metadata to nad.fun
  console.log('\nStep 2: Upload metadata to nad.fun...');
  const { metadataUri } = await uploadMetadata({
    imageUri,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: TOKEN_DESCRIPTION,
    website: 'https://eigenswarm.com',
    twitter: 'https://x.com/eigenswarm',
  });

  // Step 3: Mine salt
  // IMPORTANT: creator must be the EigenAtomicLauncher address
  // because it's the one calling BondingCurveRouter.create()
  console.log('\nStep 3: Mine salt from nad.fun...');
  const { salt, address: predictedAddress } = await mineSalt({
    creator: ATOMIC_LAUNCHER,  // The contract that calls create()
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    metadataUri,
  });

  console.log(`  Predicted token: ${predictedAddress}`);
  console.log(`  Ends in 7777: ${predictedAddress.toLowerCase().endsWith('7777')}\n`);

  // Step 4: Generate eigenId
  const eigenIdStr = `eigen-${TOKEN_SYMBOL.toLowerCase()}-${Date.now()}`;
  const eigenId = keccak256(toHex(eigenIdStr));
  console.log(`Step 4: EigenId: ${eigenIdStr} → ${eigenId}\n`);

  // Step 5: Call atomicLaunch
  console.log('Step 5: Calling atomicLaunch...');
  console.log(`  Token: ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
  console.log(`  TokenURI (metadata): ${metadataUri}`);
  console.log(`  Salt: ${salt}`);
  console.log(`  DevBuy: ${formatEther(DEV_BUY_MON)} MON`);
  console.log(`  LP: ${formatEther(LP_MON)} MON`);
  console.log(`  Vault: ${formatEther(VAULT_DEPOSIT_MON)} MON`);

  const hash = await walletClient.writeContract({
    address: ATOMIC_LAUNCHER,
    abi: ATOMIC_LAUNCHER_ABI,
    functionName: 'atomicLaunch',
    args: [
      TOKEN_NAME,
      TOKEN_SYMBOL,
      metadataUri,  // Use nad.fun metadata URI as tokenURI
      salt,
      1, // actionId (nad.fun official)
      0n, // minTokensOut
      eigenId,
      SQRT_PRICE_X96,
      TRADING_FEE_BPS,
      DEV_BUY_MON,
      LP_MON,
      VAULT_DEPOSIT_MON,
      DEPLOYER.address,
    ],
    value: TOTAL,
    gas: 10_000_000n,
  });

  console.log(`\n  TX sent: ${hash}`);
  console.log('  Waiting for receipt...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Status: ${receipt.status}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);

  if (receipt.status === 'success') {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  SUCCESS!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Token: ${predictedAddress}`);
    console.log(`  Name: ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
    console.log(`  EigenId: ${eigenIdStr}`);
    console.log(`  nad.fun: https://nad.fun/tokens/${predictedAddress}`);
    console.log(`  Monadscan: https://monadscan.com/token/${predictedAddress}`);
    console.log(`  TX: https://monadscan.com/tx/${hash}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log('Next steps:');
    console.log(`  1. Update keeper DB: eigenId=${eigenIdStr}, token=${predictedAddress}`);
    console.log(`  2. Fund sub-wallets with MON for market making`);
    console.log(`  3. Keeper will auto-trade on next cycle`);
  } else {
    console.error('\n=== FAILED ===');
    console.log(`TX: https://monadscan.com/tx/${hash}`);
  }
}

main().catch(console.error);
