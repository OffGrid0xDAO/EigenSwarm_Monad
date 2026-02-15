import { getPriceSnapshots, getTradesByEigen, type PriceSnapshot, type TradeRecord } from './db';

// ── Types ────────────────────────────────────────────────────────────────

export interface MarketContext {
  recentPrices: { price: number; timestamp: string }[];
  recentTrades: { type: string; amount: number; pnl: number }[];
  volatility: number;
  externalBuyVolume: number;
}

// ── Context Builder ──────────────────────────────────────────────────────

/**
 * Build market context for AI evaluation from local SQLite data.
 *
 * Gathers:
 * - Last 12 price snapshots (~1 hour of 5-min data)
 * - Last 10 trades for the eigen
 * - Simple volatility (annualized std dev of returns)
 * - External buy volume from recent reactive sell trades
 */
export function buildMarketContext(
  eigenId: string,
  tokenAddress: string,
  externalBuyEth: number = 0,
): MarketContext {
  // Price history: last 12 snapshots (most recent first from DB, reverse for chronological)
  const snapshots = getPriceSnapshots(tokenAddress, undefined, 12);
  const recentPrices = snapshots.map((s: PriceSnapshot) => ({
    price: s.price_eth,
    timestamp: s.created_at,
  }));

  // Recent trades for this eigen (last 10)
  const trades = getTradesByEigen(eigenId, 10);
  const recentTrades = trades.map((t: TradeRecord) => ({
    type: t.type,
    amount: parseFloat(t.eth_amount) * 1e-18, // wei to ETH
    pnl: t.pnl_realized,
  }));

  // Compute volatility from price returns
  const volatility = computeVolatility(recentPrices.map((p) => p.price));

  return {
    recentPrices,
    recentTrades,
    volatility,
    externalBuyVolume: externalBuyEth,
  };
}

// ── Volatility Calculation ───────────────────────────────────────────────

/**
 * Compute annualized volatility from a series of prices.
 * Uses log returns and annualizes assuming 5-min intervals (105,120 periods/year).
 * Returns 0 if insufficient data.
 */
function computeVolatility(prices: number[]): number {
  if (prices.length < 3) return 0;

  // Compute log returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1]! > 0 && prices[i]! > 0) {
      returns.push(Math.log(prices[i]! / prices[i - 1]!));
    }
  }

  if (returns.length < 2) return 0;

  // Standard deviation of returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  // Annualize: 5-min intervals → 12 per hour → 288 per day → 105,120 per year
  const periodsPerYear = 105_120;
  return stdDev * Math.sqrt(periodsPerYear) * 100; // as percentage
}
