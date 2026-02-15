import type { EigenConfig } from './db';
import type { PoolInfo } from './swap-encoder';
import { publicClient, getKeeperAddress } from './client';
import { getWalletsForEigen } from './wallet-manager';
import {
  WETH_ADDRESS,
  UNISWAP_V4_POOL_MANAGER,
  UNISWAP_V4_UNIVERSAL_ROUTER,
  EIGENVAULT_ADDRESS,
} from '@eigenswarm/shared';
import { parseAbiItem } from 'viem';

// ── ABI Events ─────────────────────────────────────────────────────────

const V3_SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

const V4_SWAP_EVENT = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

// ── Constants ──────────────────────────────────────────────────────────

const MAX_LOOKBACK_BLOCKS = 100;

// Known router addresses that appear as sender in V4 swaps (not end users)
const KNOWN_ROUTER_ADDRESSES = new Set([
  UNISWAP_V4_UNIVERSAL_ROUTER.toLowerCase(),
]);

// ── Types ──────────────────────────────────────────────────────────────

export interface ExternalBuyResult {
  buyCount: number;
  totalBuyEth: number;
  latestBlock: number;
}

// ── Detection ──────────────────────────────────────────────────────────

/**
 * Detect external buys on the pool since the last scanned block.
 * Returns total external buy volume in ETH terms.
 */
export async function detectExternalBuys(
  config: EigenConfig,
  pool: PoolInfo,
  fromBlock: bigint,
): Promise<ExternalBuyResult> {
  const currentBlock = await publicClient.getBlockNumber();

  // Cap lookback to prevent huge queries
  const effectiveFrom = currentBlock - fromBlock > BigInt(MAX_LOOKBACK_BLOCKS)
    ? currentBlock - BigInt(MAX_LOOKBACK_BLOCKS)
    : fromBlock;

  if (effectiveFrom > currentBlock) {
    return { buyCount: 0, totalBuyEth: 0, latestBlock: Number(currentBlock) };
  }

  // Build set of addresses to exclude (keeper + sub-wallets + vault)
  const excludeAddresses = buildExcludeSet(config);

  // Determine WETH position in the pair
  const wethIsToken0 = pool.token0.toLowerCase() === WETH_ADDRESS.toLowerCase();

  let result: ExternalBuyResult;

  if (pool.version === 'v3') {
    result = await detectV3Buys(pool, effectiveFrom, currentBlock, wethIsToken0, excludeAddresses);
  } else {
    result = await detectV4Buys(pool, effectiveFrom, currentBlock, wethIsToken0, excludeAddresses);
  }

  // Always return the latest block we scanned
  result.latestBlock = Math.max(result.latestBlock, Number(currentBlock));
  return result;
}

function buildExcludeSet(config: EigenConfig): Set<string> {
  const exclude = new Set<string>();

  // Keeper address
  try {
    exclude.add(getKeeperAddress().toLowerCase());
  } catch {
    // KEEPER_PRIVATE_KEY not set — skip
  }

  // Vault address
  exclude.add(EIGENVAULT_ADDRESS.toLowerCase());

  // Sub-wallet addresses
  const wallets = getWalletsForEigen(config.eigen_id, config.wallet_count);
  for (const w of wallets) {
    exclude.add(w.address.toLowerCase());
  }

  // Known routers (for V4 exclusion)
  for (const addr of KNOWN_ROUTER_ADDRESSES) {
    exclude.add(addr);
  }

  return exclude;
}

// ── V3 Detection ───────────────────────────────────────────────────────

async function detectV3Buys(
  pool: PoolInfo,
  fromBlock: bigint,
  toBlock: bigint,
  wethIsToken0: boolean,
  excludeAddresses: Set<string>,
): Promise<ExternalBuyResult> {
  let buyCount = 0;
  let totalBuyEth = 0;

  try {
    const logs = await publicClient.getLogs({
      address: pool.poolAddress as `0x${string}`,
      event: V3_SWAP_EVENT,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      const { sender, recipient, amount0, amount1 } = log.args;

      // Skip our own trades
      if (sender && excludeAddresses.has(sender.toLowerCase())) continue;
      if (recipient && excludeAddresses.has(recipient.toLowerCase())) continue;

      // Determine if this is a buy (WETH entering the pool = someone buying tokens)
      // When WETH enters the pool, the WETH amount is positive
      const wethAmount = wethIsToken0 ? amount0 : amount1;
      if (wethAmount === undefined) continue;

      if (wethAmount > 0n) {
        // External buy detected — WETH entered the pool
        buyCount++;
        totalBuyEth += Number(wethAmount) / 1e18;
      }
    }
  } catch (error) {
    console.error('[ReactiveSell] V3 getLogs error:', (error as Error).message);
  }

  return { buyCount, totalBuyEth, latestBlock: Number(toBlock) };
}

// ── V4 Detection ───────────────────────────────────────────────────────

async function detectV4Buys(
  pool: PoolInfo,
  fromBlock: bigint,
  toBlock: bigint,
  wethIsToken0: boolean,
  excludeAddresses: Set<string>,
): Promise<ExternalBuyResult> {
  let buyCount = 0;
  let totalBuyEth = 0;

  try {
    const logs = await publicClient.getLogs({
      address: UNISWAP_V4_POOL_MANAGER as `0x${string}`,
      event: V4_SWAP_EVENT,
      args: pool.poolId ? { id: pool.poolId } : undefined,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      const { sender, amount0, amount1 } = log.args;

      // V4: sender is often the Universal Router, not the end user.
      // We exclude vault + all known router addresses + keeper sub-wallets.
      if (sender && excludeAddresses.has(sender.toLowerCase())) continue;

      const wethAmount = wethIsToken0 ? amount0 : amount1;
      if (wethAmount === undefined) continue;

      if (wethAmount > 0n) {
        buyCount++;
        totalBuyEth += Number(wethAmount) / 1e18;
      }
    }
  } catch (error) {
    console.error('[ReactiveSell] V4 getLogs error:', (error as Error).message);
  }

  return { buyCount, totalBuyEth, latestBlock: Number(toBlock) };
}
