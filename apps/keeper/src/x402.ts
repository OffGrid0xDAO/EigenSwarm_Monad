import crypto from 'crypto';
import { PROTOCOL_FEE_BPS, GAS_BUDGET_PER_WALLET, CLASS_CONFIGS } from '@eigenswarm/shared';
import { createFacilitatorConfig } from '@coinbase/x402';
import { getPublicClient } from './client';

if (process.env.X402_TEST_MODE === 'true') {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('FATAL: X402_TEST_MODE=true is only allowed when NODE_ENV=development or NODE_ENV=test. Refusing to start.');
  }
  console.warn('⚠️  WARNING: X402_TEST_MODE is enabled. Payment verification is BYPASSED. Do NOT use in production.');
}

const X402_PAY_TO_RAW = process.env.X402_PAY_TO || process.env.X402_PAYMENT_ADDRESS;
if (!X402_PAY_TO_RAW) {
  throw new Error('FATAL: X402_PAY_TO or X402_PAYMENT_ADDRESS must be set in environment variables.');
}
const X402_PAY_TO: string = X402_PAY_TO_RAW;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_MONAD = '0x754704Bc059F8C67012fEd69BC8a327a5aafb603';

// ── Facilitator Setup ─────────────────────────────────────────────────
// If CDP API keys are present → use Coinbase CDP facilitator (production, fee-free on Base)
// Otherwise → fall back to public x402.org facilitator

const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

const MONAD_FACILITATOR_URL = 'https://x402-facilitator.molandak.org';

const facilitatorConfig = CDP_API_KEY_ID && CDP_API_KEY_SECRET
  ? createFacilitatorConfig(CDP_API_KEY_ID, CDP_API_KEY_SECRET)
  : { url: process.env.X402_FACILITATOR_URL || MONAD_FACILITATOR_URL };

const FACILITATOR_URL = facilitatorConfig.url || MONAD_FACILITATOR_URL;
const getAuthHeaders = facilitatorConfig.createAuthHeaders || null;

if (CDP_API_KEY_ID && CDP_API_KEY_SECRET) {
  console.log(`[x402] Using CDP facilitator: ${FACILITATOR_URL} (key: ${CDP_API_KEY_ID.slice(0, 8)}...)`);
} else {
  console.log(`[x402] Using Monad facilitator: ${FACILITATOR_URL}`);
}

// ── Volume Packages ───────────────────────────────────────────────────

export interface VolumePackage {
  id: string;
  ethVolume: number;
  priceUSDC: number;
  duration: string;
}

export const VOLUME_PACKAGES: VolumePackage[] = [
  { id: 'micro', ethVolume: 0.05, priceUSDC: 1, duration: '24h' },
  { id: 'mini', ethVolume: 0.1, priceUSDC: 2, duration: '24h' },
  { id: 'starter', ethVolume: 1, priceUSDC: 10, duration: '24h' },
  { id: 'growth', ethVolume: 5, priceUSDC: 40, duration: '24h' },
  { id: 'pro', ethVolume: 20, priceUSDC: 120, duration: '24h' },
  { id: 'whale', ethVolume: 100, priceUSDC: 500, duration: '24h' },
];

export function getPackage(id: string): VolumePackage | undefined {
  return VOLUME_PACKAGES.find((p) => p.id === id);
}

// ── x402 v2 Payment Requirements ──────────────────────────────────────

const KEEPER_BASE_URL = process.env.KEEPER_BASE_URL || 'https://monad.eigenswarm.xyz';

/**
 * Payment requirements — includes both v2 SDK fields and v1 facilitator fields.
 * - `amount` is read by the x402 client SDK (v2 PaymentRequirements type)
 * - `maxAmountRequired` is read by the facilitator verify/settle endpoints
 * - `resource`, `description`, `mimeType` are facilitator-required metadata
 */
export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  amount: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: Record<string, unknown>;
}

/** v2 402 response body */
export interface X402PaymentRequired {
  x402Version: 2;
  accepts: PaymentRequirements[];
  resource: { url: string; description: string; mimeType: string };
  extensions?: Record<string, unknown>;
}

export function buildPaymentRequirements(pkg: VolumePackage, endpoint: string, network: 'monad' | 'base' = 'monad'): PaymentRequirements {
  const amountBaseUnits = (pkg.priceUSDC * 1_000_000).toString();
  const resourceUrl = `${KEEPER_BASE_URL}${endpoint}`;
  const description = `EigenSwarm ${pkg.id} package: ${pkg.ethVolume} ETH volume over ${pkg.duration}`;
  return {
    scheme: 'exact',
    network: network === 'monad' ? 'eip155:10143' : 'eip155:8453',
    amount: amountBaseUnits,
    maxAmountRequired: amountBaseUnits,
    resource: resourceUrl,
    description,
    mimeType: 'application/json',
    payTo: X402_PAY_TO,
    maxTimeoutSeconds: 300,
    asset: network === 'monad' ? USDC_MONAD : USDC_BASE,
    extra: {
      name: 'USD Coin',
      version: '2',
    },
  };
}

export function build402Response(
  pkg: VolumePackage,
  endpoint: string,
  network: 'monad' | 'base' = 'monad',
  extensions?: Record<string, unknown>,
): X402PaymentRequired {
  const requirements = buildPaymentRequirements(pkg, endpoint, network);
  return {
    x402Version: 2,
    accepts: [requirements],
    resource: {
      url: requirements.resource,
      description: requirements.description,
      mimeType: requirements.mimeType,
    },
    ...(extensions ? { extensions } : {}),
  };
}

// ── Bazaar Discovery Extensions ───────────────────────────────────────
// Each service gets its own bazaar extension for x402scan resource discovery.

function makeBazaarExtension(input: Record<string, unknown>, inputSchema: Record<string, unknown>, outputExample: Record<string, unknown>, outputSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    bazaar: {
      info: {
        input: { type: 'http', bodyType: 'json', body: input },
        output: { type: 'json', example: outputExample },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
              bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
              body: inputSchema,
            },
            required: ['type', 'bodyType', 'body'],
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              example: { type: 'object', ...outputSchema },
            },
            required: ['type'],
          },
        },
        required: ['input'],
      },
    },
  };
}

// Token Launch — deploy new token on nad.fun + start autonomous market making
export const BAZAAR_EXTENSIONS = makeBazaarExtension(
  { name: 'MyToken', symbol: 'MTK', packageId: 'starter', class: 'operator', walletCount: 10, description: 'Autonomous market-making agent' },
  {
    properties: {
      name: { type: 'string', description: 'Token name' },
      symbol: { type: 'string', description: 'Token ticker symbol (2-10 chars)' },
      packageId: { type: 'string', enum: ['micro', 'mini', 'starter', 'growth', 'pro', 'whale'], description: 'Volume package' },
      class: { type: 'string', enum: ['sentinel', 'operator', 'architect', 'sovereign'], description: 'Agent class (determines wallet count range)' },
      walletCount: { type: 'number', description: 'Number of sub-wallets for market making' },
      description: { type: 'string', description: 'Agent description' },
      imageUrl: { type: 'string', description: 'Token logo URL' },
      chainId: { type: 'number', description: 'Target chain (10143=Monad)' },
    },
    required: ['name', 'symbol', 'packageId'],
  },
  { success: true, eigenId: '0x...', tokenAddress: '0x...', poolAddress: '0x...', agent8004Id: '...' },
  { properties: { success: { type: 'boolean' }, eigenId: { type: 'string' }, tokenAddress: { type: 'string' }, poolAddress: { type: 'string' }, agent8004Id: { type: 'string' } } },
);

// Market Making — start autonomous trading on an existing token
export const MARKET_MAKING_EXTENSIONS = makeBazaarExtension(
  { tokenAddress: '0x...', packageId: 'starter', class: 'operator', walletCount: 5 },
  {
    properties: {
      tokenAddress: { type: 'string', description: 'Token contract address to market-make' },
      packageId: { type: 'string', enum: ['micro', 'mini', 'starter', 'growth', 'pro', 'whale'], description: 'Volume package — determines ETH volume and USDC price' },
      class: { type: 'string', enum: ['sentinel', 'operator', 'architect', 'sovereign'], description: 'Agent class — determines number of sub-wallets' },
      walletCount: { type: 'number', description: 'Number of sub-wallets for trading (must be within class range)' },
      chainId: { type: 'number', description: 'Chain ID (10143=Monad)' },
    },
    required: ['tokenAddress', 'packageId'],
  },
  { success: true, eigenId: '0x...', tokenAddress: '0x...', walletsCreated: 5, walletsFunded: 5, monPerWallet: '0.2', status: 'active' },
  { properties: { success: { type: 'boolean' }, eigenId: { type: 'string' }, tokenAddress: { type: 'string' }, walletsCreated: { type: 'number' }, walletsFunded: { type: 'number' }, monPerWallet: { type: 'string' }, status: { type: 'string' } } },
);

// Fund Eigen — add more volume budget to an existing market-making agent
export const FUND_EXTENSIONS = makeBazaarExtension(
  { eigenId: '0x...', packageId: 'growth' },
  {
    properties: {
      eigenId: { type: 'string', description: 'Eigen ID (token address) to fund' },
      packageId: { type: 'string', enum: ['micro', 'mini', 'starter', 'growth', 'pro', 'whale'], description: 'Volume package to add' },
    },
    required: ['eigenId', 'packageId'],
  },
  { success: true, eigenId: '0x...', addedVolumeEth: '5', totalVolumeEth: '6', walletsFunded: 5 },
  { properties: { success: { type: 'boolean' }, eigenId: { type: 'string' }, addedVolumeEth: { type: 'string' }, totalVolumeEth: { type: 'string' }, walletsFunded: { type: 'number' } } },
);

// ── x402 Response Headers ────────────────────────────────────────────

/**
 * Base64-encode a PaymentRequired object for the PAYMENT-REQUIRED response header.
 * x402 v2 clients read this header instead of the JSON body.
 */
export function encode402Header(paymentRequired: X402PaymentRequired): string {
  return Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
}

/**
 * Build the 402 response headers (compatible with both v1 and v2 x402 clients).
 * v1 clients read the JSON body; v2 clients read the PAYMENT-REQUIRED header.
 */
export function build402Headers(paymentRequired: X402PaymentRequired): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': encode402Header(paymentRequired),
  };
}

/**
 * Extract the payment payload from request headers.
 * Supports both v2 (PAYMENT-SIGNATURE) and v1 (X-PAYMENT) header names.
 */
export function getPaymentHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
  return (headers['payment-signature'] || headers['x-payment']) as string | undefined;
}

// ── x402 Facilitator Client ───────────────────────────────────────────

interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: string;
}

export interface PaymentVerification {
  valid: boolean;
  from: string;
  amount: number;
  settleTxHash?: string;
  error?: string;
}

/**
 * Verify and settle a payment via the x402 facilitator (CDP or public).
 *
 * 1. POST /verify — check ERC-3009 signature + payer balance
 * 2. POST /settle — execute TransferWithAuthorization on-chain
 *
 * When CDP keys are configured, auth headers are included automatically.
 * In test mode (X402_TEST_MODE=true), skips facilitator and returns mock success.
 */
export async function verifyAndSettlePayment(
  xPaymentHeader: string,
  paymentRequirements: PaymentRequirements,
  network: 'monad' | 'base' = 'monad',
): Promise<PaymentVerification> {
  if (process.env.X402_TEST_MODE === 'true') {
    const amountUsdc = parseInt(paymentRequirements.maxAmountRequired) / 1_000_000;
    console.log(`[x402] TEST MODE — auto-approving payment for ${amountUsdc} USDC`);
    return {
      valid: true,
      from: '0xdead000000000000000000000000000000000402',
      amount: amountUsdc,
      settleTxHash: '0xTEST_SETTLE_TX',
    };
  }

  // Resolve auth headers if CDP keys are configured
  let authHeaders: { verify: Record<string, string>; settle: Record<string, string> } | null = null;
  if (getAuthHeaders) {
    try {
      authHeaders = await getAuthHeaders();
    } catch (err) {
      console.warn(`[x402] Failed to create CDP auth headers: ${(err as Error).message}`);
    }
  }

  try {
    // Decode the base64 payment signature header into a PaymentPayload object
    const paymentPayload = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString('utf-8'));

    // Step 1: Verify
    console.log(`[x402] Calling facilitator verify: ${FACILITATOR_URL}/verify`);
    const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeaders?.verify || {}),
      },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    // Parse response — facilitator may return 400 with a valid isValid:false response
    const verifyBody = await verifyRes.text();
    let verifyResult: VerifyResponse;
    try {
      verifyResult = JSON.parse(verifyBody);
    } catch {
      return { valid: false, from: '', amount: 0, error: `Facilitator verify failed (${verifyRes.status}): ${verifyBody}` };
    }

    if (!verifyResult.isValid) {
      return {
        valid: false,
        from: verifyResult.payer || '',
        amount: 0,
        error: verifyResult.invalidReason || verifyResult.invalidMessage || 'Payment verification failed',
      };
    }

    console.log(`[x402] Verification passed — payer: ${verifyResult.payer}`);

    // Step 2: Settle
    console.log(`[x402] Calling facilitator settle: ${FACILITATOR_URL}/settle`);
    const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeaders?.settle || {}),
      },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const settleBody = await settleRes.text();
    let settleResult: SettleResponse;
    try {
      settleResult = JSON.parse(settleBody);
    } catch {
      return { valid: false, from: verifyResult.payer || '', amount: 0, error: `Facilitator settle failed (${settleRes.status}): ${settleBody}` };
    }
    if (!settleResult.success) {
      return {
        valid: false,
        from: settleResult.payer || verifyResult.payer || '',
        amount: 0,
        error: settleResult.errorReason || settleResult.errorMessage || 'Settlement failed',
      };
    }

    const amountUsdc = parseInt(paymentRequirements.maxAmountRequired) / 1_000_000;
    console.log(`[x402] Settlement success — tx: ${settleResult.transaction}, payer: ${settleResult.payer}, amount: ${amountUsdc} USDC`);

    return {
      valid: true,
      from: settleResult.payer || verifyResult.payer || '',
      amount: amountUsdc,
      settleTxHash: settleResult.transaction,
    };
  } catch (error) {
    console.error(`[x402] Facilitator error:`, (error as Error).message);

    // Monad fallback: verify USDC Transfer on-chain when facilitator doesn't support Monad
    if (network === 'monad') {
      console.log(`[x402] Attempting Monad on-chain USDC verification fallback...`);
      try {
        return await verifyMonadUsdcOnChain(xPaymentHeader, paymentRequirements);
      } catch (fallbackError) {
        console.error(`[x402] Monad on-chain fallback also failed:`, (fallbackError as Error).message);
      }
    }

    return { valid: false, from: '', amount: 0, error: `Facilitator error: ${(error as Error).message}` };
  }
}

/**
 * Monad on-chain USDC verification fallback.
 * Parses the payment header as a tx hash and verifies ERC20 Transfer logs
 * to confirm USDC was sent to X402_PAY_TO with sufficient amount.
 */
async function verifyMonadUsdcOnChain(
  xPaymentHeader: string,
  paymentRequirements: PaymentRequirements,
): Promise<PaymentVerification> {
  const client = getPublicClient(143);
  const txHash = xPaymentHeader.startsWith('0x') ? xPaymentHeader : `0x${xPaymentHeader}`;

  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== 'success') {
    return { valid: false, from: '', amount: 0, error: 'Transaction failed on-chain' };
  }

  // Parse ERC20 Transfer(from, to, amount) logs
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const expectedTo = X402_PAY_TO.toLowerCase().replace('0x', '').padStart(64, '0');
  const expectedAmount = BigInt(paymentRequirements.maxAmountRequired);

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === USDC_MONAD.toLowerCase() &&
      log.topics[0] === transferTopic &&
      log.topics[2]?.toLowerCase() === `0x${expectedTo}`
    ) {
      const transferAmount = BigInt(log.data);
      if (transferAmount >= expectedAmount) {
        const from = '0x' + (log.topics[1]?.slice(26) || '');
        const amountUsdc = Number(transferAmount) / 1_000_000;
        console.log(`[x402] Monad on-chain verification success — from=${from}, amount=${amountUsdc} USDC, tx=${txHash}`);
        return {
          valid: true,
          from,
          amount: amountUsdc,
          settleTxHash: txHash,
        };
      }
    }
  }

  return { valid: false, from: '', amount: 0, error: 'No matching USDC Transfer found on Monad' };
}

/**
 * Derive a deterministic dedup key from the X-PAYMENT header payload.
 * Used as the primary key in used_payments instead of a tx hash.
 */
export function derivePaymentKey(xPaymentHeader: string): string {
  return crypto.createHash('sha256').update(xPaymentHeader).digest('hex');
}

// ── Pricing Response ──────────────────────────────────────────────────

export function getPricingResponse() {
  const walletPricing: Record<string, { walletRange: [number, number]; minDeposit: number; gasBudgetPerWallet: string }> = {};
  for (const [name, config] of Object.entries(CLASS_CONFIGS)) {
    walletPricing[name] = {
      walletRange: config.walletCountRange,
      minDeposit: config.minDeposit,
      gasBudgetPerWallet: GAS_BUDGET_PER_WALLET,
    };
  }
  return {
    x402Version: 2,
    packages: VOLUME_PACKAGES,
    paymentToken: 'USDC',
    paymentProtocol: 'x402',
    facilitator: CDP_API_KEY_ID ? 'cdp' : 'public',
    network: 'monad',
    asset: USDC_MONAD,
    payTo: X402_PAY_TO,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    protocolFeePercent: `${PROTOCOL_FEE_BPS / 100}%`,
    walletPricing,
  };
}
