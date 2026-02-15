/**
 * On-chain recovery module.
 *
 * When the keeper starts with an empty SQLite DB and Ponder is still syncing,
 * this module scans EigenCreated events directly from the vault contract to
 * discover all eigens. It also queries current on-chain state (owner, balance,
 * active status) so the API can return data immediately.
 */

import { formatEther, parseAbiItem } from 'viem';
import { publicClient } from './client';
import { EIGENVAULT_ABI, EIGENVAULT_ADDRESS } from '@eigenswarm/shared';
import type { PonderEigen } from './ponder';

const VAULT_ADDRESS = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
const VAULT_ABI = EIGENVAULT_ABI;
const START_BLOCK = BigInt(process.env.EIGENVAULT_START_BLOCK || '42039040');

// Cached on-chain eigens — refreshed periodically or on demand
let cachedOnChainEigens: PonderEigen[] = [];
let lastScanBlock = 0n;
let scanInProgress = false;

/**
 * Scan EigenCreated events from the vault contract and query current state.
 * Returns PonderEigen-compatible objects for use as fallback data.
 */
export async function discoverEigensFromChain(): Promise<PonderEigen[]> {
  if (scanInProgress) return cachedOnChainEigens;
  scanInProgress = true;

  try {
    const currentBlock = await publicClient.getBlockNumber();

    // Scan EigenCreated events from start block (chunked to avoid RPC limits)
    const CHUNK_SIZE = 10_000n;
    const logs: any[] = [];
    for (let from = START_BLOCK; from <= currentBlock; from += CHUNK_SIZE) {
      const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;
      const chunk = await publicClient.getLogs({
        address: VAULT_ADDRESS,
        event: parseAbiItem('event EigenCreated(bytes32 indexed eigenId, address indexed owner, uint256 feeRateBps)'),
        fromBlock: from,
        toBlock: to,
      });
      if (chunk.length > 0) logs.push(...chunk as any);
    }

    if (logs.length === 0) {
      console.log('[Recovery] No EigenCreated events found on-chain');
      scanInProgress = false;
      return [];
    }

    console.log(`[Recovery] Found ${logs.length} EigenCreated events on-chain`);

    // For each eigen, query current on-chain state
    const eigens: PonderEigen[] = [];

    for (const log of logs) {
      const eigenId = log.args.eigenId!;
      const owner = log.args.owner!;
      const feeRateBps = log.args.feeRateBps!;

      try {
        const [info, netBalance, terminated] = await Promise.all([
          publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VAULT_ABI,
            functionName: 'getEigenInfo',
            args: [eigenId],
          }) as Promise<[string, boolean, bigint]>,
          publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VAULT_ABI,
            functionName: 'getNetBalance',
            args: [eigenId],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: VAULT_ABI,
            functionName: 'eigenTerminated',
            args: [eigenId],
          }) as Promise<boolean>,
        ]);

        const [, active, balance] = info;

        let status = 'ACTIVE';
        if (terminated) status = 'TERMINATED';
        else if (!active) status = 'SUSPENDED';

        // Get block timestamp for createdAt
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });

        eigens.push({
          id: eigenId,
          owner: owner,
          status,
          balance: balance.toString(),
          totalDeposited: '0', // Not available from direct query
          totalWithdrawn: '0',
          totalTraded: '0',
          totalFees: '0',
          feeRateBps: Number(feeRateBps),
          feeOwed: '0',
          tradeCount: 0,
          createdAt: Number(block.timestamp),
        });

        console.log(`[Recovery] Eigen ${eigenId.slice(0, 10)}... owner=${owner.slice(0, 8)}... balance=${formatEther(balance)} ETH status=${status}`);
      } catch (error) {
        console.warn(`[Recovery] Failed to query eigen ${eigenId.slice(0, 10)}...:`, (error as Error).message);
      }
    }

    cachedOnChainEigens = eigens;
    lastScanBlock = currentBlock;
    console.log(`[Recovery] Discovered ${eigens.length} eigens from on-chain data`);

    return eigens;
  } catch (error) {
    console.error('[Recovery] On-chain scan failed:', (error as Error).message);
    return cachedOnChainEigens;
  } finally {
    scanInProgress = false;
  }
}

/**
 * Get cached on-chain eigens (non-blocking).
 * Returns empty array if no scan has been performed yet.
 */
export function getCachedOnChainEigens(): PonderEigen[] {
  return cachedOnChainEigens;
}

/**
 * Check if we have cached on-chain data.
 */
export function hasOnChainData(): boolean {
  return cachedOnChainEigens.length > 0;
}
