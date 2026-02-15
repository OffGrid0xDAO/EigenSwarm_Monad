import 'dotenv/config';
import fs from 'fs';

/**
 * Tick-level backtest — uses on-chain swap events for exact price history.
 *
 * Strategy: Extract prices from ERC20 Transfer events in swap TXs.
 * This works for V3, V4, and any DEX — no sqrtPriceX96 decoding needed.
 *
 * 1. Discover pool pair (token + quote) via Transfer events in 1 sample TX
 * 2. Fetch all swap events for the pool
 * 3. For each swap TX, extract token/quote amounts → price
 * 4. Build tick timeline, run backtest
 */

const OHLCV_CACHE = '/tmp/tg-sniper-ohlcv-cache.json';
const TICK_CACHE = '/tmp/tg-sniper-tick-cache.json';
const SIGNALS_FILE = '/tmp/tg-sniper-30d-tradeable.json';
const QUOTE_PRICES_FILE = '/tmp/tg-sniper-quote-prices.json';
const OUTPUT = '/tmp/tg-sniper-30d-backtest-ticks.json';

const RPC_ENDPOINTS = [
  'https://base-rpc.publicnode.com',
  'https://base.llamarpc.com',
];
let rpcIdx = 0;

const V4_POOL_MANAGER = '0x498581fF718922c3f8e6A244956aF099B2652b2b'.toLowerCase();
const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const WETH = '0x4200000000000000000000000000000000000006'.toLowerCase();
const ZORA = '0x1111111111166b7fe7bd91427724b487980afc69'.toLowerCase();
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'.toLowerCase();

// Known base/quote tokens on Base
const KNOWN_QUOTES: Record<string, { symbol: string; decimals: number }> = {
  [WETH]: { symbol: 'WETH', decimals: 18 },
  [ZORA]: { symbol: 'ZORA', decimals: 18 },
  [USDC]: { symbol: 'USDC', decimals: 6 },
};

const BLOCK_RANGE = 49_000; // just under 50k limit
const RPC_DELAY_MS = 75;

interface Signal {
  addr: string; sender: string; chat: string; date: string;
  fdv: string | null; liq: number | null; chain: string | null; symbol: string | null;
}

interface OhlcvEntry {
  pool: string | null;
  symbol: string;
  candles: number[][];
  hourlyCandles?: number[][];
  fetchedAt: string;
}

interface Tick {
  ts: number;
  priceUsd: number;
  volume: number;
  side: 'buy' | 'sell';
  block: number;
}

interface TickCacheEntry {
  ticks: Tick[];
  quoteToken: string;   // address of quote token (WETH, ZORA, USDC, etc.)
  quoteSymbol: string;
  poolType: 'v3' | 'v4';
  fetchedAt: string;
}

// ── State ─────────────────────────────────────────────────────────────────

let ohlcvCache: Record<string, OhlcvEntry> = {};
let tickCache: Record<string, TickCacheEntry> = {};
let quotePrices: Record<string, { ts: number; price: number }[]> = {}; // hourly USD prices per quote token
let interrupted = false;
let totalRpcCalls = 0;
let rpcErrors = 0;
let latestBlock = 0;
let latestBlockTs = 0;
const blockTsCache = new Map<number, number>(); // block number → unix ts

// ── RPC ───────────────────────────────────────────────────────────────────

function getRpc(): string { return RPC_ENDPOINTS[rpcIdx % RPC_ENDPOINTS.length]; }
function rotateRpc() { rpcIdx++; }

async function rpc(method: string, params: any[]): Promise<any> {
  totalRpcCalls++;
  try {
    const res = await fetch(getRpc(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: totalRpcCalls }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json() as any;
    if (json.error) {
      rpcErrors++;
      if (json.error.message?.includes('block range') || json.error.message?.includes('rate')) rotateRpc();
      return null;
    }
    return json.result;
  } catch {
    rpcErrors++;
    rotateRpc();
    return null;
  }
}

// Batch RPC — send multiple calls in one HTTP request, fallback to sequential
async function rpcBatch(calls: { method: string; params: any[] }[]): Promise<(any | null)[]> {
  if (calls.length === 0) return [];
  totalRpcCalls += calls.length;
  try {
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', method: c.method, params: c.params, id: i + 1 }));
    const res = await fetch(getRpc(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json() as any[];
    if (!Array.isArray(json)) {
      // Batch not supported — fallback to sequential
      rpcErrors++;
      rotateRpc();
      const results: (any | null)[] = [];
      for (const c of calls) {
        results.push(await rpc(c.method, c.params));
        await sleep(RPC_DELAY_MS);
      }
      return results;
    }
    // Sort by id to maintain order
    json.sort((a: any, b: any) => a.id - b.id);
    return json.map((r: any) => {
      if (r.error) { rpcErrors++; return null; }
      return r.result;
    });
  } catch {
    rpcErrors++;
    rotateRpc();
    return calls.map(() => null);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Cache I/O ─────────────────────────────────────────────────────────────

function loadCaches() {
  try { if (fs.existsSync(OHLCV_CACHE)) ohlcvCache = JSON.parse(fs.readFileSync(OHLCV_CACHE, 'utf8')); } catch {}
  try { if (fs.existsSync(TICK_CACHE)) tickCache = JSON.parse(fs.readFileSync(TICK_CACHE, 'utf8')); } catch {}
  try { if (fs.existsSync(QUOTE_PRICES_FILE)) quotePrices = JSON.parse(fs.readFileSync(QUOTE_PRICES_FILE, 'utf8')); } catch {}
}

function saveTickCache() {
  fs.writeFileSync(TICK_CACHE, JSON.stringify(tickCache));
}

// ── Quote Token USD Prices ────────────────────────────────────────────────

function getQuoteUsd(quoteAddr: string, ts: number): number {
  const prices = quotePrices[quoteAddr];
  if (!prices || !prices.length) {
    // Fallback
    if (quoteAddr === WETH) return 2500;
    if (quoteAddr === USDC) return 1;
    if (quoteAddr === ZORA) return 0.02;
    return 0;
  }
  let best = prices[0], bestDist = Math.abs(best.ts - ts);
  for (const p of prices) {
    const d = Math.abs(p.ts - ts);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best.price;
}

async function fetchQuotePrices() {
  // Fetch WETH, ZORA, USDC hourly prices from CoinGecko
  const coins: Record<string, string> = {
    [WETH]: 'ethereum',
    [ZORA]: 'zora',
  };
  // USDC is always $1
  quotePrices[USDC] = [{ ts: 0, price: 1 }];

  for (const [addr, cgId] of Object.entries(coins)) {
    if (quotePrices[addr] && quotePrices[addr].length > 10) {
      console.log(`  ${KNOWN_QUOTES[addr]?.symbol || addr}: ${quotePrices[addr].length} cached prices`);
      continue;
    }
    try {
      console.log(`  Fetching ${KNOWN_QUOTES[addr]?.symbol || addr} prices...`);
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=30`,
        { signal: AbortSignal.timeout(15_000) }
      );
      const json = await res.json() as any;
      quotePrices[addr] = (json.prices || []).map((p: number[]) => ({
        ts: Math.floor(p[0] / 1000),
        price: p[1],
      }));
      console.log(`  ${KNOWN_QUOTES[addr]?.symbol}: ${quotePrices[addr].length} prices (${quotePrices[addr][0]?.price.toFixed(4)} - ${quotePrices[addr][quotePrices[addr].length - 1]?.price.toFixed(4)})`);
      await sleep(1500); // CoinGecko rate limit
    } catch (err) {
      console.error(`  Failed for ${cgId}:`, (err as Error).message);
    }
  }

  fs.writeFileSync(QUOTE_PRICES_FILE, JSON.stringify(quotePrices));
}

// ── Block <-> Timestamp ───────────────────────────────────────────────────

async function initLatestBlock() {
  // Retry across RPC endpoints
  for (let attempt = 0; attempt < RPC_ENDPOINTS.length * 2; attempt++) {
    const result = await rpc('eth_blockNumber', []);
    if (result) {
      latestBlock = parseInt(result, 16);
      if (!isNaN(latestBlock)) break;
    }
    console.log(`  eth_blockNumber failed on ${getRpc()}, rotating...`);
    rotateRpc();
    await sleep(500);
  }
  if (isNaN(latestBlock)) throw new Error('Failed to get latest block from all RPCs');

  const blockData = await rpc('eth_getBlockByNumber', ['0x' + latestBlock.toString(16), false]);
  latestBlockTs = blockData ? parseInt(blockData.timestamp, 16) : Math.floor(Date.now() / 1000);
  console.log(`Latest block: ${latestBlock} (${new Date(latestBlockTs * 1000).toISOString()}) via ${getRpc().split('/')[2]}`);
}

async function getBlockTs(blockNum: number): Promise<number> {
  const cached = blockTsCache.get(blockNum);
  if (cached) return cached;
  // Estimate from latest block (2s per block on Base)
  const estimate = latestBlockTs - (latestBlock - blockNum) * 2;
  const blockData = await rpc('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  const ts = blockData ? parseInt(blockData.timestamp, 16) : estimate;
  blockTsCache.set(blockNum, ts);
  return ts;
}

function tsToBlock(ts: number): number {
  const secsDiff = latestBlockTs - ts;
  return Math.max(0, latestBlock - Math.floor(secsDiff / 2));
}

// ── Pool Pair Discovery ───────────────────────────────────────────────────

interface PoolPair {
  quoteToken: string;
  quoteSymbol: string;
  quoteDecimals: number;
  tokenDecimals: number;
  tokenIsToken0: boolean; // true = our token is amount0 in Swap event
}

async function discoverPair(
  tokenAddr: string,
  pool: string,
  poolType: 'v3' | 'v4'
): Promise<PoolPair | null> {
  const tokenLC = tokenAddr.toLowerCase();

  if (poolType === 'v3') {
    // V3: read token0() and token1() from pool contract
    const t0 = await rpc('eth_call', [{ to: pool, data: '0x0dfe1681' }, 'latest']);
    const t1 = await rpc('eth_call', [{ to: pool, data: '0xd21220a7' }, 'latest']);
    if (!t0 || !t1) return null;

    const token0 = ('0x' + t0.slice(26)).toLowerCase();
    const token1 = ('0x' + t1.slice(26)).toLowerCase();
    const tokenIsToken0 = token0 === tokenLC;
    const quoteAddr = tokenIsToken0 ? token1 : token0;
    const quote = KNOWN_QUOTES[quoteAddr];

    // Get token decimals
    const decResult = await rpc('eth_call', [{ to: tokenLC, data: '0x313ce567' }, 'latest']);
    const tokenDecimals = decResult ? parseInt(decResult, 16) : 18;

    if (quote) {
      return { quoteToken: quoteAddr, quoteSymbol: quote.symbol, quoteDecimals: quote.decimals, tokenDecimals, tokenIsToken0 };
    }

    // Unknown quote — get its decimals and symbol
    const qdec = await rpc('eth_call', [{ to: quoteAddr, data: '0x313ce567' }, 'latest']);
    return {
      quoteToken: quoteAddr,
      quoteSymbol: 'UNKNOWN',
      quoteDecimals: qdec ? parseInt(qdec, 16) : 18,
      tokenDecimals,
      tokenIsToken0,
    };
  }

  // V4: Find a recent swap TX and check Transfer events
  // Try 5 time windows: last day, 3d ago, 7d ago, 14d ago, 30d ago
  let swapLogs: any[] | null = null;
  for (const daysBack of [0, 3, 7, 14, 29]) {
    const to = latestBlock - daysBack * BLOCK_RANGE;
    const from = Math.max(0, to - BLOCK_RANGE + 1);
    if (from <= 0) break;
    swapLogs = await rpc('eth_getLogs', [{
      address: V4_POOL_MANAGER,
      topics: [V4_SWAP_TOPIC, pool],
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
    }]);
    if (swapLogs && swapLogs.length > 0) break;
    await sleep(RPC_DELAY_MS);
  }

  if (!swapLogs || swapLogs.length === 0) return null;

  // Get receipt of last swap
  const txHash = swapLogs[swapLogs.length - 1].transactionHash;
  const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!receipt) return null;

  // Find Transfer events involving PoolManager
  const transfers = (receipt.logs || []).filter(
    (l: any) => l.topics[0] === TRANSFER_TOPIC
  );

  // Find which tokens flow to/from PoolManager (besides our token)
  const pmAddr = V4_POOL_MANAGER;
  const otherTokens = new Set<string>();
  for (const t of transfers) {
    const from = ('0x' + t.topics[1].slice(26)).toLowerCase();
    const to = ('0x' + t.topics[2].slice(26)).toLowerCase();
    const tAddr = t.address.toLowerCase();
    if ((from === pmAddr || to === pmAddr) && tAddr !== tokenLC) {
      otherTokens.add(tAddr);
    }
  }

  // Prefer known quote tokens
  let quoteAddr: string | null = null;
  for (const known of [WETH, ZORA, USDC]) {
    if (otherTokens.has(known)) { quoteAddr = known; break; }
  }
  if (!quoteAddr && otherTokens.size > 0) {
    quoteAddr = [...otherTokens][0];
  }
  if (!quoteAddr) return null;

  const quote = KNOWN_QUOTES[quoteAddr];
  const decResult = await rpc('eth_call', [{ to: tokenLC, data: '0x313ce567' }, 'latest']);
  const tokenDecimals = decResult ? parseInt(decResult, 16) : 18;

  // V4 pools sort currencies by address — lower address = currency0
  const tokenIsToken0 = tokenLC.toLowerCase() < quoteAddr.toLowerCase();

  if (quote) {
    return { quoteToken: quoteAddr, quoteSymbol: quote.symbol, quoteDecimals: quote.decimals, tokenDecimals, tokenIsToken0 };
  }

  const qdec = await rpc('eth_call', [{ to: quoteAddr, data: '0x313ce567' }, 'latest']);
  return {
    quoteToken: quoteAddr,
    quoteSymbol: 'UNKNOWN',
    quoteDecimals: qdec ? parseInt(qdec, 16) : 18,
    tokenDecimals,
    tokenIsToken0,
  };
}

// ── Fetch Ticks for One Pool ──────────────────────────────────────────────

// Decode signed int256 from 32-byte hex
function decodeInt256(hex: string): bigint {
  const val = BigInt('0x' + hex);
  // If highest bit is set, it's negative (two's complement)
  return val >= (1n << 255n) ? val - (1n << 256n) : val;
}

async function fetchTicksForPool(
  tokenAddr: string,
  pool: string,
  poolType: 'v3' | 'v4',
  pair: PoolPair,
  fromBlock: number,
  toBlock: number
): Promise<Tick[]> {
  const ticks: Tick[] = [];

  // Build all chunk queries
  const allSwapLogs: any[] = [];
  const chunks: { fromHex: string; toHex: string }[] = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_RANGE) {
    const end = Math.min(start + BLOCK_RANGE - 1, toBlock);
    chunks.push({ fromHex: '0x' + start.toString(16), toHex: '0x' + end.toString(16) });
  }

  // Batch getLogs — 5 per HTTP request
  const BATCH_SIZE = 5;
  for (let i = 0; i < chunks.length && !interrupted; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const calls = batch.map(c => ({
      method: 'eth_getLogs',
      params: [poolType === 'v4'
        ? { address: V4_POOL_MANAGER, topics: [V4_SWAP_TOPIC, pool], fromBlock: c.fromHex, toBlock: c.toHex }
        : { address: pool, topics: [V3_SWAP_TOPIC], fromBlock: c.fromHex, toBlock: c.toHex }
      ],
    }));

    const results = await rpcBatch(calls);
    for (const logs of results) {
      if (logs && Array.isArray(logs) && logs.length > 0) {
        allSwapLogs.push(...logs);
      }
    }

    if (chunks.length > 10) {
      process.stdout.write(`${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} `);
    }
    await sleep(RPC_DELAY_MS);
  }

  if (allSwapLogs.length === 0) return [];

  // Use estimated timestamps (Base has consistent 2s blocks)
  // Much faster than fetching each block — accuracy within a few seconds
  const estimateTs = (block: number) => latestBlockTs - (latestBlock - block) * 2;

  // Decode each swap event directly — no receipt needed!
  for (const log of allSwapLogs) {
    const block = parseInt(log.blockNumber, 16);
    const ts = estimateTs(block);
    const data = log.data.slice(2); // remove '0x'

    let tokenAmt: number;
    let quoteAmt: number;
    let side: 'buy' | 'sell';

    if (poolType === 'v3') {
      // V3 Swap data: amount0 (int256), amount1 (int256), sqrtPriceX96, liquidity, tick
      const amount0 = decodeInt256(data.slice(0, 64));
      const amount1 = decodeInt256(data.slice(64, 128));

      const rawToken = pair.tokenIsToken0 ? amount0 : amount1;
      const rawQuote = pair.tokenIsToken0 ? amount1 : amount0;

      // Positive = into pool (user pays), Negative = out of pool (user receives)
      tokenAmt = Number(rawToken < 0n ? -rawToken : rawToken) / (10 ** pair.tokenDecimals);
      quoteAmt = Number(rawQuote < 0n ? -rawQuote : rawQuote) / (10 ** pair.quoteDecimals);

      // Token leaving pool (negative) = buy; token entering pool (positive) = sell
      side = rawToken < 0n ? 'buy' : 'sell';
    } else {
      // V4 Swap data: amount0 (int128), amount1 (int128), sqrtPriceX96, liquidity, tick, fee
      // Note: sender is indexed (topic[2]), so data starts with amount0
      const amount0 = decodeInt256(data.slice(0, 64));
      const amount1 = decodeInt256(data.slice(64, 128));

      const rawToken = pair.tokenIsToken0 ? amount0 : amount1;
      const rawQuote = pair.tokenIsToken0 ? amount1 : amount0;

      tokenAmt = Number(rawToken < 0n ? -rawToken : rawToken) / (10 ** pair.tokenDecimals);
      quoteAmt = Number(rawQuote < 0n ? -rawQuote : rawQuote) / (10 ** pair.quoteDecimals);

      side = rawToken < 0n ? 'buy' : 'sell';
    }

    if (tokenAmt <= 0 || quoteAmt <= 0) continue;

    const priceInQuote = quoteAmt / tokenAmt;
    const quoteUsd = getQuoteUsd(pair.quoteToken, ts);
    const priceUsd = priceInQuote * quoteUsd;
    const volume = quoteAmt * quoteUsd;

    if (priceUsd > 0 && isFinite(priceUsd)) {
      ticks.push({ ts, priceUsd, volume, side, block });
    }
  }

  return ticks.sort((a, b) => a.ts - b.ts);
}

// ── Main Fetch Loop ───────────────────────────────────────────────────────

// How many hours of swap data to fetch after signal
const WINDOW_HOURS = 48;
const WINDOW_BLOCKS = Math.ceil((WINDOW_HOURS * 3600) / 2); // 2s/block on Base

async function fetchAllTicks(signals: Signal[]) {
  const seen = new Set<string>();
  const tokens: { addr: string; pool: string; type: 'v3' | 'v4'; signalTs: number }[] = [];

  for (const sig of signals) {
    if (seen.has(sig.addr)) continue;
    seen.add(sig.addr);
    const entry = ohlcvCache[sig.addr] || ohlcvCache[sig.addr.toLowerCase()];
    if (!entry || !entry.pool) continue;
    if (tickCache[sig.addr]) continue;
    const type = entry.pool.length === 66 ? 'v4' as const : 'v3' as const;
    const sigTs = Math.floor(new Date(sig.date).getTime() / 1000);
    tokens.push({ addr: sig.addr, pool: entry.pool, type, signalTs: sigTs });
  }

  const v3 = tokens.filter(t => t.type === 'v3').length;
  const v4 = tokens.filter(t => t.type === 'v4').length;
  const cached = Object.values(tickCache).filter(v => v.ticks.length > 0).length;
  console.log(`\nTick fetch: ${tokens.length} to go (${v3} V3, ${v4} V4, ${cached} already cached)`);
  console.log(`Strategy: fetch swaps in ${WINDOW_HOURS}h window after signal (${Math.ceil(WINDOW_BLOCKS / BLOCK_RANGE)} chunks/pool)\n`);

  let fetched = 0, skipped = 0, withTicks = 0;
  const startTime = Date.now();

  for (let i = 0; i < tokens.length && !interrupted; i++) {
    const t = tokens[i];
    const sym = (ohlcvCache[t.addr]?.symbol || '???').slice(0, 12);
    process.stdout.write(`  [${i + 1}/${tokens.length}] ${sym.padEnd(14)} `);

    // Signal time → block range: 1h before signal to 48h after
    const fromBlock = tsToBlock(t.signalTs - 3600);
    const toBlock = Math.min(latestBlock, fromBlock + WINDOW_BLOCKS);

    // Single getLogs for the window (fits in 2 chunks max)
    let swapLogs: any[] | null = null;

    if (toBlock - fromBlock <= BLOCK_RANGE) {
      // Fits in 1 call
      if (t.type === 'v4') {
        swapLogs = await rpc('eth_getLogs', [{
          address: V4_POOL_MANAGER, topics: [V4_SWAP_TOPIC, t.pool],
          fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16),
        }]);
      } else {
        swapLogs = await rpc('eth_getLogs', [{
          address: t.pool, topics: [V3_SWAP_TOPIC],
          fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16),
        }]);
      }
      await sleep(RPC_DELAY_MS);
    } else {
      // 2 chunks via batch
      const mid = fromBlock + BLOCK_RANGE;
      const calls = [
        { method: 'eth_getLogs', params: [t.type === 'v4'
          ? { address: V4_POOL_MANAGER, topics: [V4_SWAP_TOPIC, t.pool], fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + (mid - 1).toString(16) }
          : { address: t.pool, topics: [V3_SWAP_TOPIC], fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + (mid - 1).toString(16) }
        ]},
        { method: 'eth_getLogs', params: [t.type === 'v4'
          ? { address: V4_POOL_MANAGER, topics: [V4_SWAP_TOPIC, t.pool], fromBlock: '0x' + mid.toString(16), toBlock: '0x' + toBlock.toString(16) }
          : { address: t.pool, topics: [V3_SWAP_TOPIC], fromBlock: '0x' + mid.toString(16), toBlock: '0x' + toBlock.toString(16) }
        ]},
      ];
      const results = await rpcBatch(calls);
      swapLogs = [];
      for (const r of results) {
        if (r && Array.isArray(r)) swapLogs.push(...r);
      }
      await sleep(RPC_DELAY_MS);
    }

    if (!swapLogs || swapLogs.length === 0) {
      process.stdout.write(`[0 swaps]\n`);
      tickCache[t.addr] = { ticks: [], quoteToken: '', quoteSymbol: 'NO_SWAPS', poolType: t.type, fetchedAt: new Date().toISOString() };
      skipped++;
      // Save periodically
      if ((fetched + skipped) % 50 === 0) { saveTickCache(); }
      continue;
    }

    process.stdout.write(`[${swapLogs.length} swaps] `);

    // Discover pair from one of the swap TXs
    const pair = await discoverPair(t.addr, t.pool, t.type);
    if (!pair || pair.quoteSymbol === 'UNKNOWN') {
      process.stdout.write(`[${pair?.quoteSymbol || 'no pair'}]\n`);
      tickCache[t.addr] = { ticks: [], quoteToken: pair?.quoteToken || '', quoteSymbol: pair?.quoteSymbol || 'NO_PAIR', poolType: t.type, fetchedAt: new Date().toISOString() };
      skipped++;
      continue;
    }

    process.stdout.write(`[${pair.quoteSymbol}] `);

    // Decode swap events into ticks
    const estimateTs = (block: number) => latestBlockTs - (latestBlock - block) * 2;
    const ticks: Tick[] = [];

    for (const log of swapLogs) {
      const block = parseInt(log.blockNumber, 16);
      const ts = estimateTs(block);
      const data = log.data.slice(2);
      if (data.length < 128) continue; // need at least amount0 + amount1

      let tokenAmt: number, quoteAmt: number, side: 'buy' | 'sell';

      try {
        if (t.type === 'v3') {
          const amount0 = decodeInt256(data.slice(0, 64));
          const amount1 = decodeInt256(data.slice(64, 128));
          const rawToken = pair.tokenIsToken0 ? amount0 : amount1;
          const rawQuote = pair.tokenIsToken0 ? amount1 : amount0;
          tokenAmt = Number(rawToken < 0n ? -rawToken : rawToken) / (10 ** pair.tokenDecimals);
          quoteAmt = Number(rawQuote < 0n ? -rawQuote : rawQuote) / (10 ** pair.quoteDecimals);
          side = rawToken < 0n ? 'buy' : 'sell';
        } else {
          const amount0 = decodeInt256(data.slice(0, 64));
          const amount1 = decodeInt256(data.slice(64, 128));
          const rawToken = pair.tokenIsToken0 ? amount0 : amount1;
          const rawQuote = pair.tokenIsToken0 ? amount1 : amount0;
          tokenAmt = Number(rawToken < 0n ? -rawToken : rawToken) / (10 ** pair.tokenDecimals);
          quoteAmt = Number(rawQuote < 0n ? -rawQuote : rawQuote) / (10 ** pair.quoteDecimals);
          side = rawToken < 0n ? 'buy' : 'sell';
        }
      } catch { continue; }

      if (tokenAmt <= 0 || quoteAmt <= 0) continue;
      const priceInQuote = quoteAmt / tokenAmt;
      const quoteUsd = getQuoteUsd(pair.quoteToken, ts);
      const priceUsd = priceInQuote * quoteUsd;
      if (priceUsd > 0 && isFinite(priceUsd)) {
        ticks.push({ ts, priceUsd, volume: quoteAmt * quoteUsd, side, block });
      }
    }

    ticks.sort((a, b) => a.ts - b.ts);
    tickCache[t.addr] = { ticks, quoteToken: pair.quoteToken, quoteSymbol: pair.quoteSymbol, poolType: t.type, fetchedAt: new Date().toISOString() };
    fetched++;
    if (ticks.length > 0) withTicks++;
    process.stdout.write(`→ ${ticks.length} ticks\n`);

    if ((fetched + skipped) % 50 === 0) {
      saveTickCache();
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const rate = ((fetched + skipped) / Math.max(0.1, parseFloat(elapsed))).toFixed(1);
      console.log(`  [saved — ${withTicks} w/ticks, ${fetched - withTicks} empty, ${skipped} skipped, ${rate}/min, ${totalRpcCalls} calls, ${rpcErrors} errs]`);
    }
  }

  saveTickCache();
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nDone: ${withTicks} with ticks, ${fetched - withTicks} empty, ${skipped} skipped in ${elapsed}m | ${totalRpcCalls} calls | ${rpcErrors} errors`);
}

// ── Backtest ──────────────────────────────────────────────────────────────

function backtestTick(sig: Signal, ticks: Tick[], sl: number, tp: number) {
  const sigTs = Math.floor(new Date(sig.date).getTime() / 1000);
  const entryTick = ticks.find(t => t.ts >= sigTs);
  if (!entryTick || entryTick.priceUsd <= 0) return null;

  const entry = entryTick.priceUsd;
  let maxGain = 0, maxDD = 0, hoursToMax = 0, hoursToMin = 0;
  let exitPct = 0, exitReason = 'HOLD', exitHours = 0;
  let exited = false;

  for (const tick of ticks) {
    if (tick.ts < sigTs) continue;
    const h = (tick.ts - sigTs) / 3600;
    const pct = ((tick.priceUsd - entry) / entry) * 100;

    if (pct > maxGain) { maxGain = pct; hoursToMax = h; }
    if (pct < maxDD) { maxDD = pct; hoursToMin = h; }

    if (!exited) {
      if (pct >= tp) { exitPct = tp; exitReason = 'TP'; exitHours = h; exited = true; }
      else if (pct <= sl) { exitPct = sl; exitReason = 'SL'; exitHours = h; exited = true; }
      else if (h >= 24 && Math.abs(pct) <= 10) { exitPct = pct; exitReason = 'FLAT'; exitHours = h; exited = true; }
    }
  }

  if (!exited && ticks.length > 0) {
    const last = ticks[ticks.length - 1];
    exitPct = ((last.priceUsd - entry) / entry) * 100;
    exitHours = (last.ts - sigTs) / 3600;
  }

  return {
    addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
    symbol: ohlcvCache[sig.addr]?.symbol || '???', entryPrice: entry,
    entryTime: new Date(entryTick.ts * 1000).toISOString(),
    currentPrice: ticks[ticks.length - 1]?.priceUsd || entry,
    maxGainPct: +maxGain.toFixed(2), maxDrawdownPct: +maxDD.toFixed(2),
    hoursToMax: +hoursToMax.toFixed(2), hoursToMin: +hoursToMin.toFixed(2),
    exitPct: +exitPct.toFixed(2), exitReason,
    exitHours: +exitHours.toFixed(2),
    pnlUsdc: +(exitPct / 100 * 100).toFixed(2),
    tickCount: ticks.filter(t => t.ts >= sigTs).length,
    hasData: true, source: 'ticks' as const,
  };
}

// ── Summary ───────────────────────────────────────────────────────────────

function printSummary(R: any[]) {
  if (!R.length) return;
  const $ = (n: number) => n.toFixed(2);
  const withData = R.filter((r: any) => r.hasData);
  const noData = R.filter((r: any) => !r.hasData);
  const W = R.filter((r: any) => r.pnlUsdc > 0);
  const L = R.filter((r: any) => r.pnlUsdc < 0);
  const T = R.reduce((s: number, r: any) => s + r.pnlUsdc, 0);

  console.log('\n' + '='.repeat(60));
  console.log('  TICK-LEVEL BACKTEST — SL -30% / TP +50% / Flat 24h');
  console.log('='.repeat(60));
  console.log(`\nTotal: ${R.length} unique tokens @ $100 each`);
  console.log(`With tick data: ${withData.length} | No data: ${noData.length}`);
  console.log(`\nTotal P&L: $${$(T)} | WR: ${(W.length / R.length * 100).toFixed(1)}%`);
  console.log(`Wins: ${W.length} (avg $${$(W.length ? W.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / W.length : 0)})`);
  console.log(`Losses: ${L.length} (avg $${$(L.length ? L.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / L.length : 0)})`);

  if (withData.length) {
    const avgTicks = withData.reduce((s: number, r: any) => s + (r.tickCount || 0), 0) / withData.length;
    console.log(`Avg ticks per token: ${avgTicks.toFixed(0)}`);
  }

  console.log('\n-- Exit Reasons --');
  const byR = new Map<string, { n: number; pnl: number }>();
  for (const r of R) { const s = byR.get(r.exitReason) || { n: 0, pnl: 0 }; s.n++; s.pnl += r.pnlUsdc; byR.set(r.exitReason, s); }
  for (const [k, v] of [...byR.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k}: ${v.n} (${(v.n / R.length * 100).toFixed(0)}%), $${$(v.pnl)}`);

  console.log('\n-- By Chat --');
  const byC = new Map<string, { n: number; pnl: number; w: number }>();
  for (const r of R) { const s = byC.get(r.chat) || { n: 0, pnl: 0, w: 0 }; s.n++; s.pnl += r.pnlUsdc; if (r.pnlUsdc > 0) s.w++; byC.set(r.chat, s); }
  for (const [k, v] of [...byC.entries()].sort((a, b) => b[1].pnl - a[1].pnl))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%`);

  console.log('\n-- Top 10 Pumps --');
  for (const r of [...withData].sort((a: any, b: any) => b.maxGainPct - a.maxGainPct).slice(0, 10))
    console.log(`  ${r.symbol} +${r.maxGainPct.toFixed(0)}% in ${r.hoursToMax.toFixed(1)}h | exit: ${r.exitReason} ${r.exitPct.toFixed(0)}%`);

  console.log('\n-- Time to Exit --');
  const tpExits = withData.filter((r: any) => r.exitReason === 'TP');
  const slExits = withData.filter((r: any) => r.exitReason === 'SL');
  if (tpExits.length) {
    const avg = tpExits.reduce((s: number, r: any) => s + r.exitHours, 0) / tpExits.length;
    const med = tpExits.map((r: any) => r.exitHours).sort((a: number, b: number) => a - b)[Math.floor(tpExits.length / 2)];
    console.log(`  TP: avg ${avg.toFixed(1)}h, median ${med.toFixed(1)}h (${tpExits.length} trades)`);
  }
  if (slExits.length) {
    const avg = slExits.reduce((s: number, r: any) => s + r.exitHours, 0) / slExits.length;
    const med = slExits.map((r: any) => r.exitHours).sort((a: number, b: number) => a - b)[Math.floor(slExits.length / 2)];
    console.log(`  SL: avg ${avg.toFixed(1)}h, median ${med.toFixed(1)}h (${slExits.length} trades)`);
  }
}

// ── SL/TP Sweep ───────────────────────────────────────────────────────────

function runSweep(signals: Signal[]) {
  const CONTEXT_FILE = '/tmp/tg-sniper-context-analysis.json';
  interface Ctx { addr: string; repostCount: number; uniqueMentioners: number; }
  let ctxMap = new Map<string, Ctx>();
  try {
    if (fs.existsSync(CONTEXT_FILE)) {
      const data: Ctx[] = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
      for (const c of data) ctxMap.set(c.addr, c);
    }
  } catch {}

  type T = { sig: Signal; ticks: Tick[]; hc: boolean };
  const testable: T[] = [];
  const seen = new Set<string>();
  for (const sig of signals) {
    if (seen.has(sig.addr)) continue;
    seen.add(sig.addr);
    const tc = tickCache[sig.addr];
    if (!tc || tc.ticks.length === 0) continue;
    const ctx = ctxMap.get(sig.addr);
    testable.push({ sig, ticks: tc.ticks, hc: ctx ? (ctx.repostCount >= 2 || ctx.uniqueMentioners >= 3) : false });
  }

  const hi = testable.filter(t => t.hc), lo = testable.filter(t => !t.hc);
  console.log(`\n  Testable: ${testable.length} (${hi.length} high-conv, ${lo.length} normal)\n`);

  const $$ = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(0);

  for (const [label, group] of [['HIGH CONVICTION', hi], ['NORMAL', lo], ['ALL', testable]] as [string, T[]][]) {
    if (!group.length) continue;
    console.log(`\n  -- ${label} (${group.length}) --`);
    console.log(`  ${'SL'.padStart(6)} ${'TP'.padStart(6)} | ${'N'.padStart(4)} ${'WR'.padStart(7)} ${'Avg'.padStart(8)} ${'Total'.padStart(10)} | ${'TPs'.padStart(4)} ${'SLs'.padStart(4)} ${'Flat'.padStart(4)} ${'Hold'.padStart(4)}`);

    for (const sl of [-5, -10, -15, -20, -30, -50]) {
      for (const tp of [30, 50, 100, 150, 200]) {
        const res = group.map(t => backtestTick(t.sig, t.ticks, sl, tp)).filter(Boolean) as any[];
        if (!res.length) continue;
        const w = res.filter(r => r.pnlUsdc > 0).length;
        const tot = res.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
        const avg = tot / res.length;
        const tps = res.filter(r => r.exitReason === 'TP').length;
        const sls = res.filter(r => r.exitReason === 'SL').length;
        const flat = res.filter(r => r.exitReason === 'FLAT').length;
        const hold = res.filter(r => r.exitReason === 'HOLD').length;
        console.log(`  ${$$(sl).padStart(6)} ${$$(tp).padStart(6)} | ${String(res.length).padStart(4)} ${(w / res.length * 100).toFixed(1).padStart(6)}% ${('$' + avg.toFixed(1)).padStart(8)} ${('$' + tot.toFixed(0)).padStart(10)} | ${String(tps).padStart(4)} ${String(sls).padStart(4)} ${String(flat).padStart(4)} ${String(hold).padStart(4)}`);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

process.on('SIGINT', () => { interrupted = true; console.log('\nInterrupted — saving...'); saveTickCache(); });
process.on('SIGTERM', () => { interrupted = true; saveTickCache(); });

async function main() {
  loadCaches();
  const cached = Object.values(tickCache).filter(v => v.ticks.length > 0).length;
  console.log(`OHLCV cache: ${Object.keys(ohlcvCache).length} | Tick cache: ${cached} tokens`);

  const signals: Signal[] = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
  console.log(`Signals: ${signals.length}`);

  // Step 1: Quote prices
  console.log('\nFetching quote token USD prices...');
  await fetchQuotePrices();

  // Step 2: Latest block
  await initLatestBlock();

  // Step 3: Fetch ticks
  await fetchAllTicks(signals);
  if (interrupted) return;

  // Step 4: Run backtest
  console.log('\n\n' + '#'.repeat(60));
  console.log('  TICK-LEVEL BACKTEST RESULTS');
  console.log('#'.repeat(60));

  const results: any[] = [];
  const seen = new Set<string>();
  for (const sig of signals) {
    if (seen.has(sig.addr)) continue;
    seen.add(sig.addr);
    const tc = tickCache[sig.addr];
    if (tc && tc.ticks.length > 0) {
      const r = backtestTick(sig, tc.ticks, -30, 50);
      if (r) { results.push(r); continue; }
    }
    results.push({
      addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
      symbol: ohlcvCache[sig.addr]?.symbol || 'NO_DATA',
      entryPrice: 0, currentPrice: 0, maxGainPct: 0, maxDrawdownPct: -100,
      hoursToMax: 0, hoursToMin: 0, exitPct: -30, exitReason: 'NO_DATA',
      exitHours: 0, pnlUsdc: -30, tickCount: 0, hasData: false, source: 'none',
    });
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  printSummary(results);

  // Step 5: SL/TP sweep
  console.log('\n\n' + '#'.repeat(60));
  console.log('  SL/TP PARAMETER SWEEP (tick-level)');
  console.log('#'.repeat(60));
  runSweep(signals);
}

main().catch(err => { console.error(err); saveTickCache(); process.exit(1); });
