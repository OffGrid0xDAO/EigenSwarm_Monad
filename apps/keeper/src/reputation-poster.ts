/**
 * ERC-8004 Reputation Poster.
 *
 * Posts daily trading performance signals to the 8004 Reputation Registry
 * for eigens that have an 8004 agent identity.
 *
 * Signals:
 *   - volume/daily:      Daily ETH volume × 100
 *   - pnl/daily:         Daily P&L in basis points
 *   - win-rate/cumul:    Cumulative win rate in basis points
 *   - uptime/daily:      Uptime percentage in basis points
 */

import {
  ERC8004_REPUTATION_REGISTRY,
  REPUTATION_REGISTRY_8004_ABI,
} from '@eigenswarm/shared';
import { getPublicClient, getWalletClient } from './client';
import {
  getEigensWithAgent8004,
  getTradeStats,
  getTradesByEigen,
  insertReputationPost,
  initReputationPostsTable,
} from './db';
import { encodeTag, updateAgentCard, isErc8004Enabled } from './erc8004';

const BASE_CHAIN_ID = 143;

/**
 * Post daily reputation signals for all active eigens with 8004 identities.
 */
export async function postDailyReputationSignals(): Promise<void> {
  if (!isErc8004Enabled()) return;

  // Ensure reputation_posts table exists
  initReputationPostsTable();

  const eigens = getEigensWithAgent8004();
  if (eigens.length === 0) {
    console.log('[Reputation] No eigens with 8004 identity to post for');
    return;
  }

  console.log(`[Reputation] Posting signals for ${eigens.length} eigens`);

  for (const eigen of eigens) {
    try {
      await postSignalsForEigen(eigen.eigen_id, eigen.agent_8004_id!, eigen.chain_id);
    } catch (error) {
      console.error(`[Reputation] Failed to post for ${eigen.eigen_id}:`, (error as Error).message);
    }
  }
}

async function postSignalsForEigen(
  eigenId: string,
  agent8004Id: string,
  chainId: number,
): Promise<void> {
  const stats = getTradeStats(eigenId);
  const totalTrades = stats.totalBuys + stats.totalSells;

  // Skip eigens with no meaningful activity
  if (totalTrades === 0) return;

  // Calculate daily volume from last 24h trades
  const recentTrades = getTradesByEigen(eigenId, 10000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let dailyVolumeWei = 0n;
  let dailyPnl = 0;
  for (const trade of recentTrades) {
    if (trade.created_at >= oneDayAgo) {
      dailyVolumeWei += BigInt(trade.eth_amount);
      dailyPnl += trade.pnl_realized;
    }
  }

  // Skip if no daily activity
  const dailyVolumeEth = Number(dailyVolumeWei) / 1e18;
  if (dailyVolumeEth < 0.001 && dailyPnl === 0) return;

  const winRate = (stats.winCount + stats.lossCount) > 0
    ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
    : 0;

  const walletClient = getWalletClient(chainId);
  const publicClientInstance = getPublicClient(chainId);

  // Define signals to post
  const signals: { tag1: string; tag2: string; value: number }[] = [
    {
      tag1: 'volume',
      tag2: 'daily',
      value: Math.round(dailyVolumeEth * 100), // ETH volume × 100
    },
    {
      tag1: 'pnl',
      tag2: 'daily',
      value: Math.round(dailyPnl * 10000), // P&L in bps
    },
    {
      tag1: 'win-rate',
      tag2: 'cumulative',
      value: Math.round(winRate * 100), // Win rate in bps
    },
    {
      tag1: 'uptime',
      tag2: 'daily',
      value: 10000, // 100% uptime (in bps) — active eigens are always running
    },
  ];

  for (const signal of signals) {
    // Skip zero-value signals (except uptime)
    if (signal.value === 0 && signal.tag1 !== 'uptime') continue;

    try {
      const txHash = await walletClient.writeContract({
        address: ERC8004_REPUTATION_REGISTRY as `0x${string}`,
        abi: REPUTATION_REGISTRY_8004_ABI,
        functionName: 'giveFeedback',
        args: [
          BigInt(agent8004Id),
          encodeTag(signal.tag1),
          encodeTag(signal.tag2),
          BigInt(signal.value),
        ],
      });

      // Wait for confirmation
      await publicClientInstance.waitForTransactionReceipt({ hash: txHash });

      // Record in DB
      insertReputationPost({
        eigenId,
        agent8004Id,
        chainId,
        tag1: signal.tag1,
        tag2: signal.tag2,
        value: signal.value,
        txHash,
      });

      console.log(`[Reputation] Posted ${signal.tag1}/${signal.tag2}=${signal.value} for ${eigenId} (tx: ${txHash})`);
    } catch (error) {
      console.warn(`[Reputation] Failed to post ${signal.tag1}/${signal.tag2} for ${eigenId}:`, (error as Error).message);
    }
  }

  // Update the agent card with latest stats
  try {
    await updateAgentCard(eigenId, chainId);
  } catch (error) {
    console.warn(`[Reputation] Failed to update agent card for ${eigenId}:`, (error as Error).message);
  }
}
