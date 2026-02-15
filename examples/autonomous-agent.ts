/**
 * Autonomous Market-Making Agent — Full x402 Flow
 *
 * This agent autonomously:
 *   1. Checks keeper health & treasury
 *   2. Verifies the target token has a trading pool
 *   3. Requests payment instructions (402)
 *   4. Sends USDC on-chain (Monad) — the x402 payment
 *   5. Submits the tx hash as proof → eigen is created & funded
 *   6. Monitors trades and P&L
 *
 * No human in the loop. The agent pays for itself.
 *
 * Modes:
 *   - Default (buy-volume): Market-make an existing token
 *   - Launch (--launch):    Deploy a NEW token + LP + market maker in one shot
 *
 * Requirements:
 *   - AGENT_PRIVATE_KEY: Private key with USDC + gas MON on Monad
 *   - TOKEN_ADDRESS: Token to market-make (buy-volume mode only)
 *   - TOKEN_NAME / TOKEN_SYMBOL: Token details (launch mode only)
 *
 * Usage:
 *   # Buy volume for existing token:
 *   AGENT_PRIVATE_KEY=0x... TOKEN_ADDRESS=0x... npx tsx examples/autonomous-agent.ts
 *
 *   # Launch new token:
 *   AGENT_PRIVATE_KEY=0x... TOKEN_NAME="My Token" TOKEN_SYMBOL="MTK" npx tsx examples/autonomous-agent.ts --launch
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
// Monad chain definition (not in viem/chains yet)
const monad = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
} as const;

// ── Configuration ─────────────────────────────────────────────────────

const KEEPER_URL = process.env.EIGENSWARM_KEEPER_URL || 'https://api.eigenswarm.xyz';
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PACKAGE_ID = process.env.PACKAGE_ID || 'micro';
const API_KEY = process.env.EIGENSWARM_API_KEY;
const LAUNCH_MODE = process.argv.includes('--launch');
const TOKEN_NAME = process.env.TOKEN_NAME;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL;

// Monad USDC
const USDC_ADDRESS = '0x754704Bc059F8C67012fEd69BC8a327a5aafb603' as const;
const USDC_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ── Validation ────────────────────────────────────────────────────────

if (!PRIVATE_KEY) {
  console.error('AGENT_PRIVATE_KEY required');
  process.exit(1);
}
if (LAUNCH_MODE) {
  if (!TOKEN_NAME || !TOKEN_SYMBOL) {
    console.error('TOKEN_NAME and TOKEN_SYMBOL required for --launch mode');
    process.exit(1);
  }
} else {
  if (!TOKEN_ADDRESS) {
    console.error('TOKEN_ADDRESS required (or use --launch mode with TOKEN_NAME and TOKEN_SYMBOL)');
    process.exit(1);
  }
}

// ── Setup wallet ──────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: monad, transport: http() });
const walletClient = createWalletClient({ account, chain: monad, transport: http() });

console.log(`Agent wallet: ${account.address}`);
console.log(`Keeper:       ${KEEPER_URL}`);
console.log(`Mode:         ${LAUNCH_MODE ? 'launch' : 'buy-volume'}`);
if (LAUNCH_MODE) {
  console.log(`Token:        ${TOKEN_NAME} ($${TOKEN_SYMBOL})`);
} else {
  console.log(`Token:        ${TOKEN_ADDRESS}`);
}
console.log(`Package:      ${PACKAGE_ID}`);
console.log('');

// ── Helpers ───────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function keeperGet(path: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['X-API-KEY'] = API_KEY;
  const res = await fetch(`${KEEPER_URL}${path}`, { headers });
  return res.json();
}

async function keeperPost(
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-KEY'] = API_KEY;
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const res = await fetch(`${KEEPER_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

// ── Main Flow ─────────────────────────────────────────────────────────

async function main() {
  // ── 1. Preflight checks ─────────────────────────────────────────────

  console.log('[1] Preflight checks...');

  const [ethBalance, usdcBalance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);

  console.log(`    MON:  ${formatUnits(ethBalance, 18)} MON`);
  console.log(`    USDC: ${formatUnits(usdcBalance, 6)} USDC`);

  if (ethBalance < parseUnits('0.0001', 18)) {
    console.error('    Not enough MON for gas. Need ~0.0001 MON on Monad.');
    process.exit(1);
  }

  // ── 2. Health check ─────────────────────────────────────────────────

  console.log('\n[2] Keeper health...');
  const health = await keeperGet('/api/health');
  console.log(`    Status: ${health.status}`);
  if (health.gas) {
    console.log(`    Keeper MON: ${formatUnits(BigInt(health.gas.keeperBalance), 18)}`);
  }

  // ── 3. Get payment instructions & execute ─────────────────────────

  let eigenId: string;

  if (LAUNCH_MODE) {
    // ── LAUNCH MODE: Deploy new token + LP + eigen ─────────────────

    console.log(`\n[3] Requesting launch payment instructions...`);
    const launchBody = {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      packageId: PACKAGE_ID,
      description: process.env.TOKEN_DESCRIPTION || '',
      image: process.env.TOKEN_IMAGE || '',
    };

    const { status: s402, data: paymentData } = await keeperPost('/api/launch', launchBody);

    if (s402 !== 402) {
      console.error(`    Expected 402, got ${s402}:`, paymentData);
      process.exit(1);
    }

    const payment = paymentData.payment;
    const usdcAmount = parseUnits(payment.amount, 6);
    const recipient = payment.recipient as `0x${string}`;

    console.log(`    Send ${payment.amount} USDC to ${recipient}`);

    if (usdcBalance < usdcAmount) {
      console.error(`    Insufficient USDC. Have ${formatUnits(usdcBalance, 6)}, need ${payment.amount}`);
      process.exit(1);
    }

    console.log(`\n[4] Sending ${payment.amount} USDC on Monad...`);
    const txHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [recipient, usdcAmount],
    });
    console.log(`    TX: ${txHash}`);
    console.log(`    Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`    Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);

    if (receipt.status !== 'success') {
      console.error('    USDC transfer failed on-chain');
      process.exit(1);
    }

    console.log(`\n[5] Submitting launch payment proof...`);
    const { status: createStatus, data: createData } = await keeperPost(
      '/api/launch',
      launchBody,
      { 'X-PAYMENT': txHash },
    );

    console.log(`    Status: ${createStatus}`);

    if (createStatus !== 201) {
      console.error('    Launch failed:', createData);
      process.exit(1);
    }

    eigenId = createData.eigenId;
    console.log(`    Token deployed: ${createData.tokenAddress}`);
    console.log(`    Eigen created: ${eigenId}`);
    console.log(`    Pool ID: ${createData.poolId}`);
    console.log(`    Allocation: devBuy=${createData.allocation?.devBuyEth} ETH, LP=${createData.allocation?.liquidityEth} ETH, volume=${createData.allocation?.volumeEth} ETH`);
    console.log(`    Status: ${createData.status}`);

  } else {
    // ── BUY-VOLUME MODE: Market-make existing token ────────────────

    console.log(`\n[3] Verifying token ${TOKEN_ADDRESS}...`);
    const tokenInfo = await keeperGet(`/api/tokens/${TOKEN_ADDRESS}/verify`);
    const token = tokenInfo.data;

    if (!token?.valid) {
      console.error('    Token is not valid or has no pool');
      process.exit(1);
    }

    console.log(`    ${token.name} (${token.symbol})`);
    console.log(`    Pool: ${token.pool?.version} @ ${token.pool?.address}`);
    console.log(`    Price: ${token.price} ETH`);

    console.log(`\n[4] Requesting payment instructions...`);
    const { status: s402, data: paymentData } = await keeperPost('/api/agents/buy-volume', {
      tokenAddress: TOKEN_ADDRESS,
      packageId: PACKAGE_ID,
    });

    if (s402 !== 402) {
      console.error(`    Expected 402, got ${s402}:`, paymentData);
      process.exit(1);
    }

    const payment = paymentData.payment;
    const usdcAmount = parseUnits(payment.amount, 6);
    const recipient = payment.recipient as `0x${string}`;

    console.log(`    Send ${payment.amount} USDC to ${recipient}`);

    if (usdcBalance < usdcAmount) {
      console.error(`    Insufficient USDC. Have ${formatUnits(usdcBalance, 6)}, need ${payment.amount}`);
      process.exit(1);
    }

    console.log(`\n[5] Sending ${payment.amount} USDC on Monad...`);
    const txHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [recipient, usdcAmount],
    });
    console.log(`    TX: ${txHash}`);
    console.log(`    Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`    Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);

    if (receipt.status !== 'success') {
      console.error('    USDC transfer failed on-chain');
      process.exit(1);
    }

    console.log(`\n[6] Submitting payment proof...`);
    const { status: createStatus, data: createData } = await keeperPost(
      '/api/agents/buy-volume',
      {
        tokenAddress: TOKEN_ADDRESS,
        packageId: PACKAGE_ID,
      },
      { 'X-PAYMENT': txHash },
    );

    console.log(`    Status: ${createStatus}`);

    if (createStatus !== 201) {
      console.error('    Eigen creation failed:', createData);
      process.exit(1);
    }

    eigenId = createData.eigenId;
    console.log(`    Eigen created: ${eigenId}`);
    console.log(`    Volume: ${createData.ethVolume} ETH`);
    console.log(`    Status: ${createData.status}`);
    console.log(`    Funded: ${createData.funding?.funded}`);

    if (createData.funding?.error) {
      console.log(`    Fund error: ${createData.funding.error}`);
    }
  }

  // ── 7. Monitor trades ───────────────────────────────────────────────

  console.log(`\n[7] Monitoring (checking every 30s)...\n`);

  for (let i = 0; i < 20; i++) {
    await sleep(30_000);

    const eigen = await keeperGet(`/api/eigens/${eigenId}`);
    const trades = await keeperGet(`/api/eigens/${eigenId}/trades?limit=5`);
    const tradeCount = trades.data?.length || 0;

    const d = eigen.data || {};
    console.log(
      `    [${String(i + 1).padStart(2)}] status=${d.config?.status || d.status || '?'} ` +
      `trades=${tradeCount} ` +
      `buys=${d.pnl?.totalBuys || 0} sells=${d.pnl?.totalSells || 0} ` +
      `pnl=${(d.pnl?.totalRealizedPnl || 0).toFixed(6)} ETH`,
    );

    if (tradeCount > 0) {
      const last = trades.data[0];
      console.log(`         Last trade: ${last.type} ${last.eth_amount} wei @ ${last.price_eth} ETH`);
    }
  }

  console.log(`\nDone. Eigen ${eigenId} is trading autonomously.`);
  console.log(`Monitor: ${KEEPER_URL}/api/eigens/${eigenId}/trades`);
}

main().catch((err) => {
  console.error('\nFatal:', err.message || err);
  process.exit(1);
});
