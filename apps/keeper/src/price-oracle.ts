import { publicClient } from './client';
import { insertPriceSnapshot, getAllTokenPositions, getLatestPrice } from './db';
import { V3_POOL_ABI, STATE_VIEW_ABI, computeV4PoolId } from './pool-resolver';
import type { PoolInfo } from './swap-encoder';
import { UNISWAP_V4_STATE_VIEW, WETH_ADDRESS } from '@eigenswarm/shared';

// ── Price from sqrtPriceX96 ─────────────────────────────────────────────

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;

/**
 * Convert sqrtPriceX96 to a token price in ETH.
 * price = (sqrtPriceX96 ** 2) / (2 ** 192) gives token1/token0.
 * We need to figure out which direction to return based on token ordering.
 */
function sqrtPriceToTokenPriceEth(
  sqrtPriceX96: bigint,
  tokenAddress: `0x${string}`,
  token0: `0x${string}`,
  _token1: `0x${string}`,
  version: 'v3' | 'v4',
): number {
  if (sqrtPriceX96 === 0n) return 0;

  // price = (sqrtPriceX96^2) / 2^192 = token1 per token0
  const priceNum = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);

  // Determine if the token is token0 — works for both V3 and V4,
  // regardless of whether the base is native ETH (address(0)) or WETH
  const isTokenToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();

  if (isTokenToken0) {
    // price = base per token = priceNum (this is what we want: ETH/WETH per token)
    return priceNum;
  } else {
    // price = token per base = priceNum, we want base per token = 1/price
    return priceNum > 0 ? 1 / priceNum : 0;
  }
}

// ── Get Price from V3 Pool ──────────────────────────────────────────────

async function getV3Price(pool: PoolInfo): Promise<number> {
  try {
    const result = await publicClient.readContract({
      address: pool.poolAddress as `0x${string}`,
      abi: V3_POOL_ABI,
      functionName: 'slot0',
    });

    const sqrtPriceX96 = result[0];
    const tokenAddress = pool.token0.toLowerCase() === WETH_ADDRESS.toLowerCase()
      ? pool.token1
      : pool.token0;

    return sqrtPriceToTokenPriceEth(sqrtPriceX96, tokenAddress, pool.token0, pool.token1, 'v3');
  } catch (error) {
    console.error('[PriceOracle] V3 price fetch failed:', (error as Error).message);
    return 0;
  }
}

// ── Get Price from V4 Pool ──────────────────────────────────────────────

async function getV4Price(pool: PoolInfo, tokenAddress: `0x${string}`): Promise<number> {
  try {
    // Use pre-resolved poolId when available (from DexScreener + Initialize event)
    const poolId = pool.poolId ?? computeV4PoolId(
      pool.token0,
      pool.token1,
      pool.fee,
      pool.tickSpacing!,
      pool.hooks || ('0x0000000000000000000000000000000000000000' as `0x${string}`),
    );

    const result = await publicClient.readContract({
      address: UNISWAP_V4_STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [poolId],
    });

    const sqrtPriceX96 = result[0];
    return sqrtPriceToTokenPriceEth(sqrtPriceX96, tokenAddress, pool.token0, pool.token1, 'v4');
  } catch (error) {
    console.error('[PriceOracle] V4 price fetch failed:', (error as Error).message);
    return 0;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function getTokenPriceEth(
  tokenAddress: `0x${string}`,
  pool: PoolInfo,
): Promise<number> {
  if (pool.version === 'v3') {
    return getV3Price(pool);
  }
  return getV4Price(pool, tokenAddress);
}

/**
 * Take price snapshots for all tokens with active positions.
 * Called periodically (e.g., every 5 minutes) from the main loop.
 */
export async function snapshotAllPrices(
  resolvePoolFn: (token: `0x${string}`) => Promise<PoolInfo | null>,
): Promise<void> {
  const positions = getAllTokenPositions();
  const seenTokens = new Set<string>();

  for (const pos of positions) {
    const tokenLower = pos.token_address.toLowerCase();
    if (seenTokens.has(tokenLower)) continue;
    seenTokens.add(tokenLower);

    try {
      const pool = await resolvePoolFn(pos.token_address as `0x${string}`);
      if (!pool) continue;

      const price = await getTokenPriceEth(pos.token_address as `0x${string}`, pool);
      if (price > 0) {
        insertPriceSnapshot(pos.token_address, price, 'pool');
      }
    } catch (error) {
      console.error(`[PriceOracle] Snapshot failed for ${pos.token_address}:`, (error as Error).message);
    }
  }
}

const MAX_PRICE_STALENESS_MS = 3 * 60 * 1000; // 3 minutes — reject stale prices quickly to avoid trading on outdated data

/**
 * Get the latest cached price for a token, falling back to on-chain query.
 * Returns 0 if the cached snapshot is stale (older than 3 minutes).
 */
export async function getTokenPriceWithFallback(
  tokenAddress: `0x${string}`,
  pool: PoolInfo | null,
): Promise<number> {
  // Try live price first
  if (pool) {
    const livePrice = await getTokenPriceEth(tokenAddress, pool);
    if (livePrice > 0) return livePrice;
  }

  // Fall back to latest snapshot with staleness check
  const snapshot = getLatestPrice(tokenAddress);
  if (!snapshot?.price_eth) return 0;

  const snapshotTime = new Date(snapshot.created_at).getTime();
  if (Date.now() - snapshotTime > MAX_PRICE_STALENESS_MS) {
    console.warn(`[PriceOracle] Stale price snapshot for ${tokenAddress} (age: ${Math.round((Date.now() - snapshotTime) / 1000)}s)`);
    return 0;
  }

  return snapshot.price_eth;
}
