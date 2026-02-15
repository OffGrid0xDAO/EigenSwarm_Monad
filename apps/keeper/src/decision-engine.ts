import type { PoolInfo } from './swap-encoder';
import type { EigenConfig, TokenPosition } from './db';
import { getTokenPriceWithFallback } from './price-oracle';
import { getAggregatedPosition } from './pnl-tracker';
import { fetchRecentTrades } from './ponder';
import { getWalletsForEigen } from './wallet-manager';
import { getTokenBalance } from './sell-executor';
import { detectExternalBuys } from './reactive-sell';
import { updateReactiveSellBlock } from './db';
import { publicClient } from './client';

// ── Types ────────────────────────────────────────────────────────────────

export type TradeDecisionType = 'buy' | 'sell' | 'profit_take' | 'reactive_sell';

export interface TradeDecision {
  type: TradeDecisionType;
  ethAmount?: bigint;     // for buys (wei)
  tokenAmount?: bigint;   // for sells (raw)
  reason: string;
}

export interface EigenState {
  eigenId: string;         // short form "ES-xxxx" for DB operations
  bytes32Id: string;       // keccak256 hash for on-chain vault calls
  owner: string;
  ethBalance: number;      // vault ETH balance
  tradeCount: number;
  config: EigenConfig;
  pool: PoolInfo | null;
}

// ── Phase Detection ──────────────────────────────────────────────────────

// Minimum ETH to consider deployment still in progress (enough for one meaningful buy)
const MIN_DEPLOY_THRESHOLD = 0.001;

/**
 * Detect if this eigen is still in the deployment phase.
 *
 * Smarter logic to avoid getting stuck:
 * - If NO wallets have tokens → deploying (fresh eigen)
 * - If some wallets have tokens AND enough ETH remains → deploying (still filling)
 * - If some wallets have tokens but NOT enough ETH → NOT deploying (transition to market making)
 */
export async function getDeploymentState(
  eigen: EigenState,
): Promise<{ deploying: boolean; emptyWalletIndices: number[] }> {
  const wallets = getWalletsForEigen(eigen.eigenId, eigen.config.wallet_count);
  const tokenAddress = eigen.config.token_address as `0x${string}`;
  const emptyIndices: number[] = [];

  for (const wallet of wallets) {
    try {
      const balance = await getTokenBalance(tokenAddress, wallet.address);
      if (balance <= 0n) {
        emptyIndices.push(wallet.index);
      }
    } catch {
      // If we can't check, assume empty (will get a buy attempt)
      emptyIndices.push(wallet.index);
    }
  }

  const walletsWithTokens = wallets.length - emptyIndices.length;

  let deploying: boolean;
  if (emptyIndices.length === 0) {
    // All wallets filled — deployment complete
    deploying = false;
  } else if (walletsWithTokens === 0) {
    // Fresh eigen — no wallets have tokens yet
    deploying = true;
  } else if (eigen.ethBalance > MIN_DEPLOY_THRESHOLD) {
    // Some wallets filled, still have ETH to deploy more
    deploying = true;
  } else {
    // Some wallets filled but not enough ETH to continue deploying — transition to market making
    deploying = false;
  }

  return {
    deploying,
    emptyWalletIndices: emptyIndices,
  };
}

// ── Decision Logic ──────────────────────────────────────────────────────

const MIN_TRADE_ETH = 0; // disabled for testing — allow dust trades

/**
 * Phase-aware trade decision engine.
 * Evaluated in order:
 * 1. Stop-loss (highest priority — bypasses timing)
 * 2. Profit-take (bypasses timing)
 * 3. Deployment burst (skip timing, buy into empty wallets)
 * 4. Timing check (market making only)
 * 5. Market making (ratio-based buy/sell alternation)
 */
export async function decideTradeAction(
  eigen: EigenState,
): Promise<TradeDecision | null> {
  const { config, pool } = eigen;

  // Skip if no token configured
  if (!config.token_address) return null;

  // Skip if suspended
  if (config.status === 'suspended') return null;

  // Get current position
  const position = getAggregatedPosition(eigen.eigenId, config.token_address);
  const hasPosition = position.totalAmount > 0n;

  // Get current price for P&L calculations
  let currentPrice = 0;
  if (hasPosition && pool) {
    currentPrice = await getTokenPriceWithFallback(config.token_address as `0x${string}`, pool);
  }

  // Calculate unrealized P&L if we have a position
  if (hasPosition && currentPrice > 0 && position.totalCost > 0) {
    const tokensDecimal = Number(position.totalAmount) * 1e-18;
    const currentValue = tokensDecimal * currentPrice;
    const unrealizedPnl = currentValue - position.totalCost;
    const unrealizedPnlPercent = (unrealizedPnl / position.totalCost) * 100;

    // 1. STOP-LOSS CHECK (highest priority — bypasses timing)
    if (unrealizedPnlPercent <= -config.stop_loss) {
      return {
        type: 'sell',
        tokenAmount: position.totalAmount,
        reason: `stop_loss_triggered: ${unrealizedPnlPercent.toFixed(1)}% <= -${config.stop_loss}%`,
      };
    }

    // 2. PROFIT-TAKE CHECK (bypasses timing)
    if (unrealizedPnlPercent >= config.profit_target) {
      const profitValue = currentValue - position.totalCost;
      const profitTokens = BigInt(Math.floor((profitValue / currentPrice) * 1e18));
      if (profitTokens > 0n) {
        return {
          type: 'profit_take',
          tokenAmount: profitTokens,
          reason: `profit_target_reached: ${unrealizedPnlPercent.toFixed(1)}% >= ${config.profit_target}%`,
        };
      }
    }
  }

  // 2.5. REACTIVE SELL MODE
  if (config.reactive_sell_mode === 1 && pool) {
    const fromBlock = config.reactive_sell_last_block
      ? BigInt(config.reactive_sell_last_block) + 1n
      : await publicClient.getBlockNumber();

    const externalBuys = await detectExternalBuys(config, pool, fromBlock);

    // Always update last scanned block
    if (externalBuys.latestBlock > (config.reactive_sell_last_block || 0)) {
      updateReactiveSellBlock(eigen.eigenId, externalBuys.latestBlock);
    }

    if (externalBuys.buyCount > 0 && externalBuys.totalBuyEth > 0 && currentPrice > 0) {
      const mirrorPct = config.reactive_sell_pct / 100;
      const sellEthValue = externalBuys.totalBuyEth * mirrorPct;
      const tokensToSell = sellEthValue / currentPrice;
      const tokenAmount = BigInt(Math.floor(tokensToSell * 1e18));
      const cappedAmount = tokenAmount > position.totalAmount ? position.totalAmount : tokenAmount;

      if (cappedAmount > 0n) {
        return {
          type: 'reactive_sell',
          tokenAmount: cappedAmount,
          reason: `reactive_sell: ${externalBuys.buyCount} buys (${externalBuys.totalBuyEth.toFixed(6)} ETH) → selling ${(mirrorPct * 100).toFixed(0)}%`,
        };
      }
    }

    // When reactive mode is ON and ETH is sufficient, skip market making — only sell into buys
    // But if ETH is critically low, fall through to market making to sell tokens and replenish
    const MIN_ETH_FOR_REACTIVE_ONLY = 0.0001;
    if (eigen.ethBalance >= MIN_ETH_FOR_REACTIVE_ONLY) {
      return null;
    }
    // ETH too low — skip deployment & timing checks, go straight to market making to sell tokens
    console.log(`[Decision] ${eigen.eigenId}: reactive mode low ETH (${eigen.ethBalance.toFixed(6)}), falling through to sell tokens`);
    return marketMakingDecision(eigen, position, currentPrice);
  }

  // 3. DEPLOYMENT PHASE CHECK (skip timing)
  const deployState = await getDeploymentState(eigen);
  if (deployState.deploying) {
    const emptyCount = deployState.emptyWalletIndices.length;
    const ethPerWallet = eigen.ethBalance * 0.8 / emptyCount;

    if (ethPerWallet < MIN_TRADE_ETH) {
      console.log(`[Decision] ${eigen.eigenId}: deployment phase but insufficient ETH (${eigen.ethBalance.toFixed(6)} / ${emptyCount} wallets = ${ethPerWallet.toFixed(6)})`);
      return null;
    }

    return {
      type: 'buy',
      ethAmount: BigInt(Math.floor(ethPerWallet * 1e18)),
      reason: `deployment_burst: ${emptyCount} empty wallets, ${ethPerWallet.toFixed(6)} ETH each`,
    };
  }

  // 4. TIMING CHECK (market making only — deployment skips this)
  const tooSoon = await isTooSoonToTrade(eigen);
  if (tooSoon) return null;

  // 5. MARKET MAKING DECISION (ratio-based buy/sell)
  return marketMakingDecision(eigen, position, currentPrice);
}

// ── Market Making ────────────────────────────────────────────────────────

function marketMakingDecision(
  eigen: EigenState,
  position: { totalAmount: bigint; totalCost: number },
  currentPrice: number,
): TradeDecision | null {
  const tokensDecimal = Number(position.totalAmount) * 1e-18;
  const tokenValue = currentPrice > 0 ? tokensDecimal * currentPrice : 0;
  const totalValue = eigen.ethBalance + tokenValue;

  if (totalValue <= 0) return null;

  const tokenRatio = tokenValue / totalValue;

  // Random order size percentage
  const pctMin = eigen.config.order_size_pct_min || 8;
  const pctMax = eigen.config.order_size_pct_max || 15;
  const randomPct = pctMin + Math.random() * (pctMax - pctMin);

  // Direction decision with dead band
  // >90% always sell, <70% always buy, 70-90% ratio-based with small bias
  let direction: 'buy' | 'sell';

  if (tokenRatio > 0.90) {
    direction = 'sell';
  } else if (tokenRatio < 0.70) {
    direction = 'buy';
  } else {
    // Middle zone: lean based on ratio
    direction = tokenRatio > 0.80 ? 'sell' : 'buy';
  }

  if (direction === 'buy') {
    const ethAmount = eigen.ethBalance * (randomPct / 100);
    if (ethAmount >= MIN_TRADE_ETH) {
      return {
        type: 'buy',
        ethAmount: BigInt(Math.floor(ethAmount * 1e18)),
        reason: `market_making_buy: ratio=${(tokenRatio * 100).toFixed(1)}% size=${randomPct.toFixed(1)}%`,
      };
    }

    // Can't afford to buy — only fall through to sell if overweight on tokens.
    // If ratio < 50%, selling would worsen the imbalance — just wait for more ETH.
    if (position.totalAmount <= 0n || tokenRatio < 0.50) return null;
  }

  // Sell a percentage of total tokens
  const tokenAmount = position.totalAmount * BigInt(Math.floor(randomPct * 100)) / 10000n;
  if (tokenAmount <= 0n) return null;

  return {
    type: 'sell',
    tokenAmount,
    reason: `market_making_sell: ratio=${(tokenRatio * 100).toFixed(1)}% size=${randomPct.toFixed(1)}%`,
  };
}

// ── Timing Check ─────────────────────────────────────────────────────────

async function isTooSoonToTrade(eigen: EigenState): Promise<boolean> {
  const secondsBetween = 3600 / eigen.config.trade_frequency;

  try {
    const recentTrades = await fetchRecentTrades(eigen.bytes32Id, 1);
    if (recentTrades.length > 0) {
      const lastTradeTime = recentTrades[0]!.timestamp;
      const elapsed = (Date.now() / 1000) - lastTradeTime;
      if (elapsed < secondsBetween) return true;
    }
  } catch {
    // Ponder unavailable — skip timing check
  }

  return false;
}
