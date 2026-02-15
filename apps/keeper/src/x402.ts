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

// ── x402 Payment Requirements ─────────────────────────────────────────

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: number;
  accepts: PaymentRequirements[];
}

export function buildPaymentRequirements(pkg: VolumePackage, endpoint: string, network: 'monad' | 'base' = 'monad'): PaymentRequirements {
  const amountBaseUnits = (pkg.priceUSDC * 1_000_000).toString();
  return {
    scheme: 'exact',
    network,
    maxAmountRequired: amountBaseUnits,
    resource: endpoint,
    description: `EigenSwarm ${pkg.id} package: ${pkg.ethVolume} ETH volume over ${pkg.duration}`,
    mimeType: 'application/json',
    payTo: X402_PAY_TO,
    maxTimeoutSeconds: 300,
    asset: network === 'monad' ? USDC_MONAD : USDC_BASE,
  };
}

export function build402Response(pkg: VolumePackage, endpoint: string, network: 'monad' | 'base' = 'monad'): X402PaymentRequired {
  return {
    x402Version: 2,
    accepts: [buildPaymentRequirements(pkg, endpoint, network)],
  };
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
      from: '0xTEST0000000000000000000000000000deadbeef',
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
    // Step 1: Verify
    console.log(`[x402] Calling facilitator verify: ${FACILITATOR_URL}/verify`);
    const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeaders?.verify || {}),
      },
      body: JSON.stringify({
        paymentHeader: xPaymentHeader,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!verifyRes.ok) {
      const errText = await verifyRes.text().catch(() => 'unknown');
      return { valid: false, from: '', amount: 0, error: `Facilitator verify failed (${verifyRes.status}): ${errText}` };
    }

    const verifyResult: VerifyResponse = await verifyRes.json();
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
        paymentHeader: xPaymentHeader,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!settleRes.ok) {
      const errText = await settleRes.text().catch(() => 'unknown');
      return { valid: false, from: verifyResult.payer || '', amount: 0, error: `Facilitator settle failed (${settleRes.status}): ${errText}` };
    }

    const settleResult: SettleResponse = await settleRes.json();
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
