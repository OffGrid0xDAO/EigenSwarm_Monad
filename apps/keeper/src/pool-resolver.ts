import { publicClient } from './client';
import { getEigenConfig, updateEigenConfigPool, updateEigenConfigLpPool } from './db';
import type { PoolInfo } from './swap-encoder';
import {
  WETH_ADDRESS,
  UNISWAP_V3_FACTORY,
  UNISWAP_V4_STATE_VIEW,
  UNISWAP_V4_POOL_MANAGER,
} from '@eigenswarm/shared';
import { keccak256, encodeAbiParameters, parseAbiParameters, decodeAbiParameters, createPublicClient, http, toHex } from 'viem';
import { base } from 'viem/chains';

// ── ABIs ────────────────────────────────────────────────────────────────

const V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const V3_POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'liquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
] as const;

// StateView for V4 pool state
const STATE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getSlot0',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLiquidity',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
] as const;

// PoolManager Initialize event for extracting V4 pool keys
const POOL_MANAGER_ABI = [
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// Common V3 fee tiers to check
const V3_FEE_TIERS = [10000, 3000, 500] as const;

// Fallback RPC endpoints for event queries when primary RPC fails
const FALLBACK_RPC_URLS = [
  'https://base-mainnet.public.blastapi.io',
  'https://base.meowrpc.com',
  'https://base.drpc.org',
];

// ── Cache Verification ──────────────────────────────────────────────────

async function verifyCachedPool(pool: PoolInfo): Promise<boolean> {
  try {
    if (pool.version === 'v3') {
      const [sqrtPriceX96] = await publicClient.readContract({
        address: pool.poolAddress as `0x${string}`,
        abi: V3_POOL_ABI,
        functionName: 'slot0',
      });
      return sqrtPriceX96 > 0n;
    } else {
      const poolId = pool.poolId ?? computeV4PoolId(
        pool.token0,
        pool.token1,
        pool.fee,
        pool.tickSpacing!,
        pool.hooks || ZERO_ADDRESS,
      );
      const [sqrtPriceX96] = await publicClient.readContract({
        address: UNISWAP_V4_STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });
      return sqrtPriceX96 > 0n;
    }
  } catch {
    return false;
  }
}

// ── DexScreener API ──────────────────────────────────────────────────────

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  protocol?: string;
  baseToken: { address: string };
  quoteToken: { address: string };
  liquidity?: { usd: number };
}

async function findPoolViaDexScreener(
  tokenAddress: `0x${string}`,
): Promise<{ version: 'v3' | 'v4'; poolId: string; liquidity: number } | null> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return null;

    const data = await response.json();
    const pairs: DexScreenerPair[] = data.pairs || [];

    // Filter for Uniswap pairs on Base
    const uniPairs = pairs.filter(
      (p) => p.chainId === 'base' && p.dexId === 'uniswap',
    );

    if (uniPairs.length === 0) return null;

    // Sort by liquidity descending, pick the best
    uniPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const best = uniPairs[0];

    // Detect V4 pools: DexScreener may return protocol "v4", "unknown", or omit it.
    // V4 pool IDs are bytes32 hashes (66 chars with 0x prefix), V3 addresses are 42 chars.
    const isV4 = best.protocol === 'v4' ||
      best.pairAddress.length === 66 ||
      (best.protocol !== 'v3' && best.quoteToken.address.toLowerCase() === WETH_ADDRESS.toLowerCase());
    const version = isV4 ? 'v4' : 'v3';

    return {
      version,
      poolId: best.pairAddress,
      liquidity: best.liquidity?.usd || 0,
    };
  } catch (error) {
    console.warn('[PoolResolver] DexScreener fetch failed:', (error as Error).message);
    return null;
  }
}

// ── Known Clanker V4 Hook Addresses ──────────────────────────────────────
// Clanker tokens use custom hooks with dynamic fees (0x800000).
// When the Initialize event query fails, we try these known configurations.
const KNOWN_CLANKER_HOOKS = [
  '0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC', // Clanker Static Hook V1
  '0x3609e894F94EedCDD131bEA2f3C3a31Fd149393B', // Clanker Hook V2
] as const;

const CLANKER_DYNAMIC_FEE = 8388608; // 0x800000
const CLANKER_TICK_SPACING = 200;

// ── V4 Pool Key Resolution ──────────────────────────────────────────────

async function resolveV4PoolKey(
  poolId: `0x${string}`,
  tokenAddress: `0x${string}`,
): Promise<PoolInfo | null> {
  // Strategy 1: Try known Clanker configurations (fast, no RPC needed for pool ID match)
  const pool = tryKnownClankerConfigs(poolId, tokenAddress);
  if (pool) return pool;

  // Strategy 2: Query Initialize event from chain (slower, may fail on public RPCs)
  return getV4PoolKeyFromEvent(poolId);
}

function tryKnownClankerConfigs(
  targetPoolId: `0x${string}`,
  tokenAddress: `0x${string}`,
): PoolInfo | null {
  // Clanker V4 pools use WETH as the base currency
  const isWethCurrency0 = WETH_ADDRESS.toLowerCase() < tokenAddress.toLowerCase();
  const currency0 = isWethCurrency0 ? WETH_ADDRESS : tokenAddress;
  const currency1 = isWethCurrency0 ? tokenAddress : WETH_ADDRESS;

  for (const hooks of KNOWN_CLANKER_HOOKS) {
    const computed = computeV4PoolId(
      currency0,
      currency1,
      CLANKER_DYNAMIC_FEE,
      CLANKER_TICK_SPACING,
      hooks as `0x${string}`,
    );

    if (computed.toLowerCase() === targetPoolId.toLowerCase()) {
      console.log(`[PoolResolver] Matched Clanker V4 pool via known hook ${hooks.slice(0, 10)}...`);
      return {
        version: 'v4',
        poolAddress: UNISWAP_V4_POOL_MANAGER,
        fee: CLANKER_DYNAMIC_FEE,
        tickSpacing: CLANKER_TICK_SPACING,
        hooks: hooks as `0x${string}`,
        token0: currency0,
        token1: currency1,
        poolId: targetPoolId,
        isWETHPair: true,
      };
    }
  }

  // Also try standard Uniswap V4 configs (no hooks) with WETH
  for (const config of [
    { fee: 9900, tickSpacing: 198 },   // EigenLP hook-free pool
    { fee: 3000, tickSpacing: 60 },
    { fee: 10000, tickSpacing: 200 },
    { fee: 500, tickSpacing: 10 },
  ]) {
    const computed = computeV4PoolId(currency0, currency1, config.fee, config.tickSpacing, ZERO_ADDRESS);
    if (computed.toLowerCase() === targetPoolId.toLowerCase()) {
      return {
        version: 'v4',
        poolAddress: UNISWAP_V4_POOL_MANAGER,
        fee: config.fee,
        tickSpacing: config.tickSpacing,
        hooks: ZERO_ADDRESS,
        token0: currency0,
        token1: currency1,
        poolId: targetPoolId,
        isWETHPair: true,
      };
    }
  }

  // Try native ETH as base too
  const nativeAddr = ZERO_ADDRESS;
  const isNativeCurrency0 = nativeAddr.toLowerCase() < tokenAddress.toLowerCase();
  const c0 = isNativeCurrency0 ? nativeAddr : tokenAddress;
  const c1 = isNativeCurrency0 ? tokenAddress : nativeAddr;

  for (const config of [
    { fee: 9900, tickSpacing: 198 },   // EigenLP hook-free pool
    { fee: 3000, tickSpacing: 60 },
    { fee: 10000, tickSpacing: 200 },
    { fee: 500, tickSpacing: 10 },
  ]) {
    const computed = computeV4PoolId(c0, c1, config.fee, config.tickSpacing, ZERO_ADDRESS);
    if (computed.toLowerCase() === targetPoolId.toLowerCase()) {
      return {
        version: 'v4',
        poolAddress: UNISWAP_V4_POOL_MANAGER,
        fee: config.fee,
        tickSpacing: config.tickSpacing,
        hooks: ZERO_ADDRESS,
        token0: c0,
        token1: c1,
        poolId: targetPoolId,
        isWETHPair: false,
      };
    }
  }

  return null;
}

async function getV4PoolKeyFromEvent(
  poolId: `0x${string}`,
): Promise<PoolInfo | null> {
  // Try primary RPC first, then fallbacks
  const rpcUrls = [
    process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    ...FALLBACK_RPC_URLS,
  ];

  // PoolManager deployed around block 24_000_000 on Base.
  const POOL_MANAGER_DEPLOY_BLOCK = 24_000_000n;

  // Initialize event topic0
  const INITIALIZE_TOPIC = keccak256(
    toHex('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
  );

  for (const rpcUrl of rpcUrls) {
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(rpcUrl),
      });

      // Use raw topics to avoid viem's bytes20/bytes32 decoding issue with indexed address params
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [{
          address: UNISWAP_V4_POOL_MANAGER,
          topics: [INITIALIZE_TOPIC, poolId],
          fromBlock: `0x${POOL_MANAGER_DEPLOY_BLOCK.toString(16)}`,
          toBlock: 'latest',
        }],
      });

      if (logs.length === 0) continue;

      const log = logs[0] as { topics: string[]; data: string };
      // Decode indexed topics: topic[2]=currency0, topic[3]=currency1 (padded to bytes32)
      const currency0 = ('0x' + (log.topics[2] || '').slice(26)) as `0x${string}`;
      const currency1 = ('0x' + (log.topics[3] || '').slice(26)) as `0x${string}`;

      // Decode non-indexed data using ABI decoder
      const decoded = decodeAbiParameters(
        parseAbiParameters('uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick'),
        log.data as `0x${string}`,
      );
      const fee = Number(decoded[0]);
      const tickSpacing = Number(decoded[1]);
      const hooks = decoded[2] as `0x${string}`;

      const isWETHPair =
        currency0.toLowerCase() === WETH_ADDRESS.toLowerCase() ||
        currency1.toLowerCase() === WETH_ADDRESS.toLowerCase();

      return {
        version: 'v4',
        poolAddress: UNISWAP_V4_POOL_MANAGER,
        fee,
        tickSpacing,
        hooks,
        token0: currency0,
        token1: currency1,
        poolId,
        isWETHPair,
      };
    } catch (error) {
      console.warn(`[PoolResolver] Initialize event query failed on ${rpcUrl}:`, (error as Error).message);
      continue;
    }
  }

  return null;
}

// ── Pool ID Computation ────────────────────────────────────────────────

function computeV4PoolId(
  currency0: `0x${string}`,
  currency1: `0x${string}`,
  fee: number,
  tickSpacing: number,
  hooks: `0x${string}`,
): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [currency0, currency1, fee, tickSpacing, hooks],
  );
  return keccak256(encoded);
}

// ── V3 Pool Resolution ──────────────────────────────────────────────────

async function findV3Pool(tokenAddress: `0x${string}`): Promise<PoolInfo | null> {
  for (const fee of V3_FEE_TIERS) {
    try {
      const poolAddress = await publicClient.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenAddress, WETH_ADDRESS, fee],
      });

      if (poolAddress && poolAddress !== ZERO_ADDRESS) {
        // Verify the pool has liquidity
        try {
          const liquidity = await publicClient.readContract({
            address: poolAddress,
            abi: V3_POOL_ABI,
            functionName: 'liquidity',
          });

          if (liquidity > 0n) {
            const isToken0 = tokenAddress.toLowerCase() < WETH_ADDRESS.toLowerCase();
            return {
              version: 'v3',
              poolAddress,
              fee,
              token0: isToken0 ? tokenAddress : WETH_ADDRESS,
              token1: isToken0 ? WETH_ADDRESS : tokenAddress,
            };
          }
        } catch {
          // Pool exists but can't read liquidity — skip
        }
      }
    } catch {
      // Factory call failed — try next fee tier
    }
  }
  return null;
}

// ── V4 Pool Resolution (Brute-force Fallback) ────────────────────────────

// Common V4 pool configurations to try as a last resort
const V4_FALLBACK_CONFIGS = [
  // Standard Uniswap V4 pools (native ETH, no hooks)
  { baseCurrency: ZERO_ADDRESS, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDRESS },
  { baseCurrency: ZERO_ADDRESS, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDRESS },
  { baseCurrency: ZERO_ADDRESS, fee: 500, tickSpacing: 10, hooks: ZERO_ADDRESS },
  // WETH-paired pools with no hooks
  { baseCurrency: WETH_ADDRESS, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDRESS },
  { baseCurrency: WETH_ADDRESS, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDRESS },
  { baseCurrency: WETH_ADDRESS, fee: 500, tickSpacing: 10, hooks: ZERO_ADDRESS },
] as const;

async function findV4PoolBruteForce(tokenAddress: `0x${string}`): Promise<PoolInfo | null> {
  for (const config of V4_FALLBACK_CONFIGS) {
    try {
      const baseAddr = config.baseCurrency as `0x${string}`;
      const isBaseCurrency0 = baseAddr.toLowerCase() < tokenAddress.toLowerCase();
      const currency0 = isBaseCurrency0 ? baseAddr : tokenAddress;
      const currency1 = isBaseCurrency0 ? tokenAddress : baseAddr;

      const poolId = computeV4PoolId(
        currency0,
        currency1,
        config.fee,
        config.tickSpacing,
        config.hooks as `0x${string}`,
      );

      const [sqrtPriceX96] = await publicClient.readContract({
        address: UNISWAP_V4_STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });

      // If sqrtPriceX96 is non-zero, the pool is initialized
      if (sqrtPriceX96 > 0n) {
        const isWETHPair = baseAddr.toLowerCase() === WETH_ADDRESS.toLowerCase();
        return {
          version: 'v4',
          poolAddress: UNISWAP_V4_POOL_MANAGER,
          fee: config.fee,
          tickSpacing: config.tickSpacing,
          hooks: config.hooks as `0x${string}`,
          token0: currency0,
          token1: currency1,
          poolId,
          isWETHPair,
        };
      }
    } catch {
      // Pool doesn't exist with this config — try next
    }
  }
  return null;
}

// ── Main Resolution Function ────────────────────────────────────────────

// In-memory cache to avoid redundant RPC calls within the same cycle
const poolCache = new Map<string, { pool: PoolInfo; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function resolvePool(
  tokenAddress: `0x${string}`,
  eigenId?: string,
): Promise<PoolInfo | null> {
  // Use eigen-specific cache key when eigenId is provided (LP pool varies per eigen)
  const cacheKey = eigenId ? `${eigenId}:${tokenAddress.toLowerCase()}` : tokenAddress.toLowerCase();

  // Check in-memory cache
  const cached = poolCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.pool;
  }

  // Check eigen config for both LP pool and cached Clanker pool
  if (eigenId) {
    const config = getEigenConfig(eigenId);

    // Prefer hook-free LP pool if eigen has one (100% fee capture)
    // First check stored lp_pool_id, then try computing it from token address
    const isZeroPoolId = !config?.lp_pool_id || /^0x0+$/.test(config.lp_pool_id);
    const storedLpPoolId = isZeroPoolId ? null : config.lp_pool_id;

    // Compute the expected LP pool ID (native ETH + token, fee=9900, tickSpacing=198, no hooks)
    const lpFee = config?.lp_pool_fee || 9900;
    const lpTickSpacing = config?.lp_pool_tick_spacing || 198;
    const computedLpPoolId = computeV4PoolId(ZERO_ADDRESS, tokenAddress, lpFee, lpTickSpacing, ZERO_ADDRESS);
    const lpPoolId = storedLpPoolId || computedLpPoolId;

    {
      const nativeAddr = ZERO_ADDRESS;
      const token0 = nativeAddr; // address(0) is always < any token address
      const token1 = tokenAddress;
      const lpPool: PoolInfo = {
        version: 'v4',
        poolAddress: UNISWAP_V4_POOL_MANAGER,
        fee: lpFee,
        tickSpacing: lpTickSpacing,
        hooks: ZERO_ADDRESS,
        token0,
        token1,
        poolId: lpPoolId as `0x${string}`,
        isWETHPair: false,
      };
      const isValid = await verifyCachedPool(lpPool);
      if (isValid) {
        // Persist the computed pool ID if it wasn't stored
        if (!storedLpPoolId && eigenId) {
          updateEigenConfigLpPool(eigenId, lpPoolId);
          console.log(`[PoolResolver] Stored computed LP pool ID for ${eigenId}: ${lpPoolId.slice(0, 16)}...`);
        }
        poolCache.set(cacheKey, { pool: lpPool, cachedAt: Date.now() });
        return lpPool;
      }
      console.log(`[PoolResolver] Hook-free LP pool for ${eigenId} is not initialized, falling back...`);
    }

    // Fall back to cached Clanker pool
    if (config?.pool_version && config.pool_fee !== null) {
      const isWETHPair = config.pool_version === 'v4' &&
        (config.pool_address || '').toLowerCase() !== ZERO_ADDRESS.toLowerCase();
      const baseCurrency = config.pool_version === 'v4'
        ? (isWETHPair ? WETH_ADDRESS : ZERO_ADDRESS)
        : WETH_ADDRESS;
      const isToken0 = tokenAddress.toLowerCase() < baseCurrency.toLowerCase();
      const pool: PoolInfo = {
        version: config.pool_version as 'v3' | 'v4',
        poolAddress: config.pool_address || UNISWAP_V4_POOL_MANAGER,
        fee: config.pool_fee,
        tickSpacing: config.pool_tick_spacing ?? undefined,
        hooks: (config.pool_hooks as `0x${string}`) ?? undefined,
        token0: isToken0 ? tokenAddress : baseCurrency,
        token1: isToken0 ? baseCurrency : tokenAddress,
        isWETHPair,
      };

      // Verify cached pool is still valid (non-zero sqrtPriceX96)
      const isValid = await verifyCachedPool(pool);
      if (isValid) {
        poolCache.set(cacheKey, { pool, cachedAt: Date.now() });
        return pool;
      }
      console.log(`[PoolResolver] Cached pool for ${eigenId} is stale (sqrtPrice=0), re-resolving...`);
    }
  }

  // 1. Try DexScreener discovery (most reliable for Clanker tokens)
  const dexResult = await findPoolViaDexScreener(tokenAddress);
  if (dexResult) {
    if (dexResult.version === 'v4') {
      // Resolve full pool key: tries known Clanker configs first, then Initialize event
      const pool = await resolveV4PoolKey(dexResult.poolId as `0x${string}`, tokenAddress);
      if (pool) {
        poolCache.set(cacheKey, { pool, cachedAt: Date.now() });
        if (eigenId) persistPoolToDb(eigenId, pool);
        return pool;
      }
    } else {
      // V3: poolId is the contract address
      const poolAddr = dexResult.poolId as `0x${string}`;
      try {
        const [sqrtPriceX96] = await publicClient.readContract({
          address: poolAddr,
          abi: V3_POOL_ABI,
          functionName: 'slot0',
        });
        if (sqrtPriceX96 > 0n) {
          // Determine fee by trying common tiers
          let fee = 3000; // default
          for (const feeTier of V3_FEE_TIERS) {
            try {
              const addr = await publicClient.readContract({
                address: UNISWAP_V3_FACTORY,
                abi: V3_FACTORY_ABI,
                functionName: 'getPool',
                args: [tokenAddress, WETH_ADDRESS, feeTier],
              });
              if (addr?.toLowerCase() === poolAddr.toLowerCase()) {
                fee = feeTier;
                break;
              }
            } catch { /* skip */ }
          }
          const isToken0 = tokenAddress.toLowerCase() < WETH_ADDRESS.toLowerCase();
          const pool: PoolInfo = {
            version: 'v3',
            poolAddress: poolAddr,
            fee,
            token0: isToken0 ? tokenAddress : WETH_ADDRESS,
            token1: isToken0 ? WETH_ADDRESS : tokenAddress,
          };
          poolCache.set(cacheKey, { pool, cachedAt: Date.now() });
          if (eigenId) persistPoolToDb(eigenId, pool);
          return pool;
        }
      } catch { /* fall through */ }
    }
  }

  // 2. Brute-force V4 fallback (for non-Clanker V4 pools)
  let pool = await findV4PoolBruteForce(tokenAddress);

  // 3. Fall back to V3
  if (!pool) {
    pool = await findV3Pool(tokenAddress);
  }

  if (!pool) return null;

  // Cache the result
  poolCache.set(cacheKey, { pool, cachedAt: Date.now() });
  if (eigenId) persistPoolToDb(eigenId, pool);
  return pool;
}

function persistPoolToDb(eigenId: string, pool: PoolInfo): void {
  updateEigenConfigPool(eigenId, {
    poolVersion: pool.version,
    poolFee: pool.fee,
    poolTickSpacing: pool.tickSpacing ?? null,
    poolHooks: pool.hooks ?? null,
    poolAddress: pool.poolAddress ?? null,
  });
}

export function clearPoolCache() {
  poolCache.clear();
}

export { V3_POOL_ABI, STATE_VIEW_ABI, computeV4PoolId, ZERO_ADDRESS };
