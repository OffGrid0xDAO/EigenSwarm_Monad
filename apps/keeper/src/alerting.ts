import { formatEther } from 'viem';

// ── Alert Types ─────────────────────────────────────────────────────────

export type AlertLevel = 'info' | 'warn' | 'critical';

export type AlertEvent =
  | 'trade_executed'
  | 'high_spend_rate'
  | 'keeper_gas_low'
  | 'keeper_gas_critical'
  | 'consecutive_sell_failures'
  | 'vault_refill'
  | 'cycle_complete';

export interface Alert {
  level: AlertLevel;
  event: AlertEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Webhook Config ──────────────────────────────────────────────────────

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

// ── Spend Tracking ──────────────────────────────────────────────────────

// Default: alert when spend rate exceeds 30% of vault per hour
// (well before the 50% on-chain epoch limit)
const SPEND_RATE_THRESHOLD_PCT = parseFloat(process.env.SPEND_RATE_THRESHOLD_PCT || '30');

interface HourlySpend {
  totalSpentWei: bigint;
  vaultBalanceWei: bigint; // snapshot at hour start
  windowStart: number;     // epoch ms
}

// eigenId -> hourly spend window
const spendTrackers = new Map<string, HourlySpend>();

const HOUR_MS = 60 * 60 * 1000;

// ── Core Alert Function ─────────────────────────────────────────────────

export function emitAlert(level: AlertLevel, event: AlertEvent, data: Record<string, unknown>): void {
  const alert: Alert = {
    level,
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  // Structured JSON to stdout
  const prefix = level === 'critical' ? '[ALERT CRITICAL]'
    : level === 'warn' ? '[ALERT WARN]'
    : '[ALERT]';
  console.log(`${prefix} ${JSON.stringify(alert)}`);

  // Fire-and-forget webhook if configured
  if (ALERT_WEBHOOK_URL && (level === 'warn' || level === 'critical')) {
    sendWebhook(alert).catch(() => {});
  }
}

async function sendWebhook(alert: Alert): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Webhook failures are non-fatal
  }
}

// ── Spend Rate Tracking ─────────────────────────────────────────────────

/**
 * Record a trade spend and check if the spend rate exceeds the threshold.
 * Returns true if the alert was triggered.
 */
export function trackSpend(eigenId: string, ethSpentWei: bigint, vaultBalanceWei: bigint): boolean {
  const now = Date.now();
  let tracker = spendTrackers.get(eigenId);

  // Reset window if expired or first use
  if (!tracker || (now - tracker.windowStart) > HOUR_MS) {
    tracker = {
      totalSpentWei: 0n,
      vaultBalanceWei,
      windowStart: now,
    };
    spendTrackers.set(eigenId, tracker);
  }

  tracker.totalSpentWei += ethSpentWei;

  // Update vault balance snapshot if higher (deposits during window)
  if (vaultBalanceWei > tracker.vaultBalanceWei) {
    tracker.vaultBalanceWei = vaultBalanceWei;
  }

  // Check threshold
  if (tracker.vaultBalanceWei > 0n) {
    const spentPct = Number(tracker.totalSpentWei * 10000n / tracker.vaultBalanceWei) / 100;
    if (spentPct >= SPEND_RATE_THRESHOLD_PCT) {
      emitAlert('critical', 'high_spend_rate', {
        eigenId,
        spentPct: spentPct.toFixed(1),
        totalSpentEth: formatEther(tracker.totalSpentWei),
        vaultBalanceEth: formatEther(tracker.vaultBalanceWei),
        thresholdPct: SPEND_RATE_THRESHOLD_PCT,
        windowMinutes: Math.round((now - tracker.windowStart) / 60000),
      });
      return true;
    }
  }

  return false;
}

// ── Structured Trade Log ────────────────────────────────────────────────

export function logTrade(params: {
  eigenId: string;
  type: string;
  ethAmount: bigint;
  tokenAmount?: bigint;
  tokenSymbol?: string;
  txHash: string;
  walletAddress?: string;
  reason?: string;
}): void {
  emitAlert('info', 'trade_executed', {
    eigenId: params.eigenId,
    type: params.type,
    ethAmountEth: formatEther(params.ethAmount),
    tokenAmount: params.tokenAmount ? params.tokenAmount.toString() : undefined,
    tokenSymbol: params.tokenSymbol,
    txHash: params.txHash,
    walletAddress: params.walletAddress?.slice(0, 10),
    reason: params.reason,
  });
}

// ── Keeper Gas Alert ────────────────────────────────────────────────────

export function alertKeeperGas(keeperAddress: string, balanceWei: bigint, level: 'low' | 'critical'): void {
  emitAlert(
    level === 'critical' ? 'critical' : 'warn',
    level === 'critical' ? 'keeper_gas_critical' : 'keeper_gas_low',
    {
      keeperAddress,
      balanceEth: formatEther(balanceWei),
    },
  );
}

// ── Consecutive Failure Alert ───────────────────────────────────────────

export function alertConsecutiveFailures(eigenId: string, failures: number, lastError: string): void {
  emitAlert('warn', 'consecutive_sell_failures', {
    eigenId,
    consecutiveFailures: failures,
    lastError: lastError.slice(0, 200),
  });
}
