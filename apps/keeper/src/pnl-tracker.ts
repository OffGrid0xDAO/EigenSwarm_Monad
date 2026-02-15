import {
  getTokenPosition,
  getTokenPositionsByEigen,
  upsertTokenPosition,
  getTradeStats,
  type TokenPosition,
} from './db';
import { getTokenPriceWithFallback } from './price-oracle';
import type { PoolInfo } from './swap-encoder';

// ── Types ────────────────────────────────────────────────────────────────

export interface PositionSummary {
  eigenId: string;
  tokenAddress: string;
  tokenBalance: string;
  entryPriceEth: number;
  currentPriceEth: number;
  totalCostEth: number;
  currentValueEth: number;
  unrealizedPnlEth: number;
  unrealizedPnlPercent: number;
  realizedPnlEth: number;
  totalPnlEth: number;
  winRate: number;
  tradeCount: number;
}

// ── Position Updates ────────────────────────────────────────────────────

/**
 * Update the position after a buy trade.
 * Computes weighted average entry price.
 */
export function updatePositionOnBuy(
  eigenId: string,
  walletAddress: string,
  tokenAddress: string,
  tokenAmountRaw: bigint,
  ethSpent: number,
  priceEth: number,
): void {
  const existing = getTokenPosition(eigenId, tokenAddress, walletAddress);

  if (existing && BigInt(existing.amount_raw) > 0n) {
    // Weighted average entry price
    const existingAmount = BigInt(existing.amount_raw);
    const newTotal = existingAmount + tokenAmountRaw;
    const existingCost = existing.total_cost_eth;
    const newTotalCost = existingCost + ethSpent;

    // Weighted avg: (existingCost + ethSpent) / (existingTokens + newTokens) but in ETH/token
    const newEntryPrice = newTotalCost / (Number(newTotal) * 1e-18 || 1);

    upsertTokenPosition({
      eigenId,
      tokenAddress,
      walletAddress,
      amountRaw: newTotal.toString(),
      entryPriceEth: newEntryPrice,
      totalCostEth: newTotalCost,
    });
  } else {
    upsertTokenPosition({
      eigenId,
      tokenAddress,
      walletAddress,
      amountRaw: tokenAmountRaw.toString(),
      entryPriceEth: priceEth,
      totalCostEth: ethSpent,
    });
  }
}

/**
 * Update the position after a sell trade.
 * Returns the realized P&L in ETH.
 */
export function updatePositionOnSell(
  eigenId: string,
  walletAddress: string,
  tokenAddress: string,
  tokenAmountSold: bigint,
  ethReceived: number,
  sellPriceEth: number,
): number {
  const existing = getTokenPosition(eigenId, tokenAddress, walletAddress);
  if (!existing) return 0;

  const existingAmount = BigInt(existing.amount_raw);
  if (existingAmount <= 0n) return 0;

  // Realized P&L = (sellPrice - entryPrice) * tokensSold (in token-denominated ETH)
  const tokensSoldDecimal = Number(tokenAmountSold) * 1e-18;
  const realizedPnl = (sellPriceEth - existing.entry_price_eth) * tokensSoldDecimal;

  const remainingAmount = existingAmount - tokenAmountSold;
  const costReduction = existing.total_cost_eth * (Number(tokenAmountSold) / Number(existingAmount));
  const remainingCost = existing.total_cost_eth - costReduction;

  if (remainingAmount <= 0n) {
    // Position fully closed
    upsertTokenPosition({
      eigenId,
      tokenAddress,
      walletAddress,
      amountRaw: '0',
      entryPriceEth: 0,
      totalCostEth: 0,
    });
  } else {
    // Partial close — entry price stays the same
    upsertTokenPosition({
      eigenId,
      tokenAddress,
      walletAddress,
      amountRaw: remainingAmount.toString(),
      entryPriceEth: existing.entry_price_eth,
      totalCostEth: remainingCost,
    });
  }

  return realizedPnl;
}

// ── Position Summaries ──────────────────────────────────────────────────

/**
 * Get a complete position summary for an eigen, aggregating across all wallets.
 */
export async function getPositionSummary(
  eigenId: string,
  pool: PoolInfo | null,
): Promise<PositionSummary | null> {
  const positions = getTokenPositionsByEigen(eigenId);
  if (positions.length === 0) return null;

  let totalTokens = 0n;
  let totalCost = 0;
  let tokenAddress = '';

  for (const pos of positions) {
    const amount = BigInt(pos.amount_raw);
    totalTokens += amount;
    totalCost += pos.total_cost_eth;
    tokenAddress = pos.token_address;
  }

  if (totalTokens <= 0n) return null;

  const entryPrice = positions[0]!.entry_price_eth;
  const currentPrice = await getTokenPriceWithFallback(tokenAddress as `0x${string}`, pool);
  const tokensDecimal = Number(totalTokens) * 1e-18;
  const currentValue = tokensDecimal * currentPrice;
  const unrealizedPnl = currentValue - totalCost;
  const unrealizedPnlPercent = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;

  const stats = getTradeStats(eigenId);
  const totalTrades = stats.totalBuys + stats.totalSells;
  const winRate = totalTrades > 0 ? (stats.winCount / totalTrades) * 100 : 0;

  return {
    eigenId,
    tokenAddress,
    tokenBalance: totalTokens.toString(),
    entryPriceEth: entryPrice,
    currentPriceEth: currentPrice,
    totalCostEth: totalCost,
    currentValueEth: currentValue,
    unrealizedPnlEth: unrealizedPnl,
    unrealizedPnlPercent,
    realizedPnlEth: stats.totalRealizedPnl,
    totalPnlEth: stats.totalRealizedPnl + unrealizedPnl,
    winRate,
    tradeCount: totalTrades,
  };
}

/**
 * Get aggregated token balance for an eigen across all wallets.
 */
export function getAggregatedPosition(eigenId: string, tokenAddress: string): {
  totalAmount: bigint;
  entryPrice: number;
  totalCost: number;
} {
  const positions = getTokenPositionsByEigen(eigenId).filter(
    (p) => p.token_address.toLowerCase() === tokenAddress.toLowerCase(),
  );

  let totalAmount = 0n;
  let totalCost = 0;

  for (const pos of positions) {
    totalAmount += BigInt(pos.amount_raw);
    totalCost += pos.total_cost_eth;
  }

  const entryPrice = positions.length > 0 ? positions[0]!.entry_price_eth : 0;

  return { totalAmount, entryPrice, totalCost };
}
