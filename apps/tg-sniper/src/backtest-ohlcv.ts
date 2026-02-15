import 'dotenv/config';
import fs from 'fs';

/**
 * Proper backtest using GeckoTerminal OHLCV for ALL tokens.
 *
 * Phase 1: Batch pool discovery via multi-token endpoint (30 per call) — ~125 calls
 * Phase 2: Fetch OHLCV only for tokens that have pools — ~1500 calls
 * Total: ~1625 calls vs ~7500 with old approach
 *
 * Persistent cache + save-on-interrupt.
 */

const INPUT = '/tmp/tg-sniper-30d-tradeable.json';
const OUTPUT = '/tmp/tg-sniper-30d-backtest-ohlcv.json';
const CACHE_FILE = '/tmp/tg-sniper-ohlcv-cache.json';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

interface Signal {
  addr: string; sender: string; chat: string; date: string;
  fdv: string | null; liq: number | null; chain: string | null; symbol: string | null;
}

interface CacheEntry {
  pool: string | null;
  symbol: string;
  candles: number[][]; // [ts, o, h, l, c, v]
  fetchedAt: string;
}

// ── Rate Limiter ────────────────────────────────────────────────────────

let lastReq = 0;
let consecutiveErrors = 0;
let totalCalls = 0;
let total429s = 0;
let successCount = 0;

async function geckoFetch(url: string): Promise<any> {
  // 7.5s base delay — stays safely under GeckoTerminal ~10 req/min limit
  const baseDelay = 7500 + (consecutiveErrors * 15000);
  const wait = baseDelay - (Date.now() - lastReq);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastReq = Date.now();
  totalCalls++;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' }
    });

    if (res.status === 429) {
      consecutiveErrors++;
      total429s++;
      const backoff = Math.min(30 + consecutiveErrors * 10, 90);
      process.stdout.write(` [429 #${total429s} wait ${backoff}s]`);
      await new Promise(r => setTimeout(r, backoff * 1000));
      return geckoFetch(url); // retry
    }

    // Only decrement every 3 successes to avoid oscillation
    successCount++;
    if (successCount >= 3 && consecutiveErrors > 0) { consecutiveErrors--; successCount = 0; }
    if (!res.ok) return null;
    return res.json();
  } catch {
    consecutiveErrors++;
    return null;
  }
}

// ── Cache ───────────────────────────────────────────────────────────────

let cache: Record<string, CacheEntry> = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const withCandles = Object.values(cache).filter(c => c.candles.length > 0).length;
      const noPool = Object.values(cache).filter(c => c.pool === null).length;
      const withPool = Object.values(cache).filter(c => c.pool !== null).length;
      console.log(`Cache: ${Object.keys(cache).length} entries (${withCandles} with candles, ${withPool} with pool, ${noPool} no pool)`);
    }
  } catch {}
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

// ── Phase 1: Batch Pool Discovery ───────────────────────────────────────

async function batchDiscoverPools(addrs: string[]) {
  const needPool = addrs.filter(a => !cache[a] || cache[a].pool === undefined);
  if (!needPool.length) return;

  const batches: string[][] = [];
  for (let i = 0; i < needPool.length; i += 30) {
    batches.push(needPool.slice(i, i + 30));
  }

  console.log(`Phase 1: Batch pool discovery — ${needPool.length} tokens in ${batches.length} batches of 30`);
  const startTime = Date.now();

  for (let i = 0; i < batches.length && !interrupted; i++) {
    const batch = batches[i];
    const joined = batch.join(',');
    process.stdout.write(`\r  [${((i + 1) / batches.length * 100).toFixed(0)}%] batch ${i + 1}/${batches.length} (${batch.length} tokens)  `);

    const data = await geckoFetch(`${GECKO_BASE}/networks/base/tokens/multi/${joined}?include=top_pools`);

    // Parse response — tokens found get their pool, tokens not found get null
    const found = new Set<string>();
    if (data?.data) {
      // Build pool map from included
      const poolMap = new Map<string, string>(); // pool_id -> pool_address
      for (const inc of (data.included || [])) {
        if (inc.attributes?.address) {
          poolMap.set(inc.id, inc.attributes.address);
        }
      }

      for (const token of data.data) {
        const addr = token.attributes?.address?.toLowerCase();
        if (!addr) continue;
        found.add(addr);

        const poolRef = token.relationships?.top_pools?.data?.[0];
        const poolAddr = poolRef ? poolMap.get(poolRef.id) : null;
        const symbol = token.attributes?.symbol || '?';

        // Only set pool info if we don't already have candle data
        if (!cache[addr] || !cache[addr].candles?.length) {
          cache[addr] = {
            pool: poolAddr || null,
            symbol,
            candles: cache[addr]?.candles || [],
            fetchedAt: new Date().toISOString()
          };
        }
      }
    }

    // Mark not-found tokens as NO_POOL
    for (const addr of batch) {
      const lower = addr.toLowerCase();
      if (!found.has(lower) && !cache[lower] && !cache[addr]) {
        cache[addr] = { pool: null, symbol: 'NO_POOL', candles: [], fetchedAt: new Date().toISOString() };
      }
    }

    // Save every 10 batches
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      saveCache();
      const withPool = Object.values(cache).filter(c => c.pool !== null).length;
      const noPool = Object.values(cache).filter(c => c.pool === null).length;
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      process.stdout.write(`\n  [saved — ${withPool} with pool, ${noPool} no pool, ${elapsed}m elapsed]\n`);
    }
  }

  const withPool = Object.values(cache).filter(c => c.pool !== null).length;
  const noPool = Object.values(cache).filter(c => c.pool === null).length;
  console.log(`\nPhase 1 done: ${withPool} tokens have pools, ${noPool} have no pool\n`);
}

// ── Phase 2: Fetch OHLCV ────────────────────────────────────────────────

async function fetchOHLCV(addrs: string[]) {
  // Only fetch OHLCV for tokens that have a pool but no candles yet
  const needOhlcv = addrs.filter(a => {
    const entry = cache[a] || cache[a.toLowerCase()];
    return entry && entry.pool && entry.candles.length === 0;
  });

  if (!needOhlcv.length) {
    console.log('Phase 2: All OHLCV data already cached');
    return;
  }

  console.log(`Phase 2: Fetch OHLCV for ${needOhlcv.length} tokens with pools`);
  const startTime = Date.now();

  for (let i = 0; i < needOhlcv.length && !interrupted; i++) {
    const addr = needOhlcv[i];
    const entry = cache[addr] || cache[addr.toLowerCase()];
    if (!entry?.pool) continue;

    process.stdout.write(`\r  [${((i + 1) / needOhlcv.length * 100).toFixed(0)}%] ${i + 1}/${needOhlcv.length} — ${entry.symbol || addr.slice(0, 12)}  `);

    const ohlcv = await geckoFetch(`${GECKO_BASE}/networks/base/pools/${entry.pool}/ohlcv/day?aggregate=1&limit=45`);
    const candles = ohlcv?.data?.attributes?.ohlcv_list || [];

    entry.candles = candles;
    entry.fetchedAt = new Date().toISOString();
    cache[addr] = entry;

    process.stdout.write(candles.length > 0 ? `[${candles.length}d]` : '[0d]');

    // Save every 25 tokens
    if ((i + 1) % 25 === 0 || i === needOhlcv.length - 1) {
      saveCache();
      const withCandles = Object.values(cache).filter(c => c.candles.length > 0).length;
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const rate = ((i + 1) / (elapsed as any)).toFixed(1);
      process.stdout.write(`\n  [saved — ${withCandles} with candles, ${rate}/min, ${elapsed}m elapsed]\n`);
    }
  }

  const withCandles = Object.values(cache).filter(c => c.candles.length > 0).length;
  console.log(`\nPhase 2 done: ${withCandles} tokens with OHLCV data\n`);
}

// ── Backtest Logic ──────────────────────────────────────────────────────

function backtest(sig: Signal, entry: CacheEntry) {
  const candles = entry.candles;
  if (!candles.length) return null;

  const sigTs = Math.floor(new Date(sig.date).getTime() / 1000);
  const sigDay = sig.date.slice(0, 10);

  // Find entry price: OPEN on signal day
  let entryPrice: number | null = null;
  for (const c of candles) {
    if (new Date(c[0] * 1000).toISOString().slice(0, 10) === sigDay) {
      entryPrice = c[1]; // open
      break;
    }
  }

  // Fallback: closest candle within 2 days
  if (!entryPrice) {
    let best: [number, number] | null = null;
    for (const c of candles) {
      const d = Math.abs(c[0] - sigTs);
      if (!best || d < best[0]) best = [d, c[1]];
    }
    if (best && best[0] < 172800) entryPrice = best[1];
  }

  if (!entryPrice || entryPrice === 0) return null;

  // Simulate strategy on candles AFTER entry
  const SL = -30, TP = 50;
  const after = candles.filter(c => c[0] >= sigTs).sort((a, b) => a[0] - b[0]);

  let maxGain = 0, maxDD = 0, daysToMax = 0, daysToMin = 0;
  let exitPct = 0, exitReason = 'NO_DATA', exitDay = 0;
  let exited = false;

  for (const c of after) {
    const daysSince = (c[0] - sigTs) / 86400;
    const highPct = ((c[2] - entryPrice) / entryPrice) * 100;
    const lowPct = ((c[3] - entryPrice) / entryPrice) * 100;
    const closePct = ((c[4] - entryPrice) / entryPrice) * 100;

    if (highPct > maxGain) { maxGain = highPct; daysToMax = Math.round(daysSince); }
    if (lowPct < maxDD) { maxDD = lowPct; daysToMin = Math.round(daysSince); }

    if (!exited) {
      if (highPct >= TP) {
        exitPct = TP; exitReason = 'TP'; exitDay = Math.round(daysSince); exited = true;
      } else if (lowPct <= SL) {
        exitPct = SL; exitReason = 'SL'; exitDay = Math.round(daysSince); exited = true;
      } else if (daysSince >= 1 && Math.abs(closePct) <= 10) {
        exitPct = closePct; exitReason = 'FLAT'; exitDay = Math.round(daysSince); exited = true;
      }
    }
  }

  if (!exited && after.length > 0) {
    const last = after[after.length - 1];
    exitPct = ((last[4] - entryPrice) / entryPrice) * 100;
    exitReason = 'HOLD';
    exitDay = Math.round((last[0] - sigTs) / 86400);
  }

  const currentPrice = after.length ? after.sort((a, b) => b[0] - a[0])[0][4] : entryPrice;

  return {
    addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
    symbol: entry.symbol, entryPrice,
    fdvAtSignal: sig.fdv,
    currentPrice,
    pctNow: ((currentPrice - entryPrice) / entryPrice) * 100,
    maxGainPct: maxGain, maxDrawdownPct: maxDD,
    daysToMax, daysToMin,
    exitPct, exitReason, exitDay,
    pnlUsdc: exitPct / 100 * 100, // $100 position
    hasCandles: true,
  };
}

// ── Summary ─────────────────────────────────────────────────────────────

function printSummary(R: any[]) {
  if (!R.length) return;
  const $ = (n: number) => n.toFixed(2);

  const withData = R.filter((r: any) => r.hasCandles);
  const noData = R.filter((r: any) => !r.hasCandles);

  const T = R.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
  const W = R.filter((r: any) => r.pnlUsdc > 0), L = R.filter((r: any) => r.pnlUsdc < 0);

  console.log('\n' + '═'.repeat(60));
  console.log('  OHLCV BACKTEST — SL -30% / TP +50% / Flat 1d ±10%');
  console.log('═'.repeat(60));
  console.log(`\nTotal: ${R.length} signals @ $100`);
  console.log(`With OHLCV data: ${withData.length} | No pool/data (assumed SL): ${noData.length}`);
  console.log(`\nTotal P&L: $${$(T)} | WR: ${(W.length / R.length * 100).toFixed(1)}%`);
  console.log(`Wins: ${W.length} (avg $${$(W.length ? W.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / W.length : 0)})`);
  console.log(`Losses: ${L.length} (avg $${$(L.length ? L.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / L.length : 0)})`);

  if (withData.length) {
    const dp = withData.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
    const dw = withData.filter((r: any) => r.pnlUsdc > 0);
    console.log(`\n── With OHLCV Data Only ──`);
    console.log(`P&L: $${$(dp)} | WR: ${(dw.length / withData.length * 100).toFixed(1)}%`);
  }

  console.log('\n── Exit Reasons ──');
  const byR = new Map<string, { n: number; pnl: number }>();
  for (const r of R) { const s = byR.get(r.exitReason) || { n: 0, pnl: 0 }; s.n++; s.pnl += r.pnlUsdc; byR.set(r.exitReason, s); }
  for (const [k, v] of [...byR.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k}: ${v.n} (${(v.n / R.length * 100).toFixed(0)}%), $${$(v.pnl)}`);

  console.log('\n── By Chat ──');
  const byC = new Map<string, { n: number; pnl: number; w: number }>();
  for (const r of R) { const s = byC.get(r.chat) || { n: 0, pnl: 0, w: 0 }; s.n++; s.pnl += r.pnlUsdc; if (r.pnlUsdc > 0) s.w++; byC.set(r.chat, s); }
  for (const [k, v] of [...byC.entries()].sort((a, b) => b[1].pnl - a[1].pnl))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%, $/trade: $${$(v.pnl / v.n)}`);

  console.log('\n── Top 30 Senders by P&L ──');
  const byS = new Map<string, { n: number; pnl: number; w: number; tp: number }>();
  for (const r of R) { const s = byS.get(r.sender) || { n: 0, pnl: 0, w: 0, tp: 0 }; s.n++; s.pnl += r.pnlUsdc; if (r.pnlUsdc > 0) s.w++; if (r.exitReason === 'TP') s.tp++; byS.set(r.sender, s); }
  for (const [k, v] of [...byS.entries()].sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 30))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%, TPs: ${v.tp}, $/trade: $${$(v.pnl / v.n)}`);

  console.log('\n── Bottom 15 Senders ──');
  for (const [k, v] of [...byS.entries()].filter(([, v]) => v.n >= 3).sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 15))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%`);

  console.log('\n── Top 10 Biggest Pumps (max gain after signal) ──');
  for (const r of [...withData].sort((a: any, b: any) => b.maxGainPct - a.maxGainPct).slice(0, 10))
    console.log(`  ${r.symbol} +${r.maxGainPct.toFixed(0)}% in ${r.daysToMax}d | ${r.chat} by ${r.sender} | ${r.signalDate.slice(0, 10)}`);

  console.log('\n── P&L by Signal-Time FDV ──');
  function parseFDV(f: string | null): number {
    if (!f) return 0;
    const m: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
    const match = f.replace(/[,$]/g, '').match(/([\d.]+)\s*([KMB])?/i);
    return match ? parseFloat(match[1]) * (match[2] ? m[match[2].toUpperCase()] || 1 : 1) : 0;
  }
  for (const [label, min, max] of [['<$10K', 0, 1e4], ['$10K-$50K', 1e4, 5e4], ['$50K-$100K', 5e4, 1e5], ['$100K-$500K', 1e5, 5e5], ['$500K+', 5e5, Infinity], ['No FDV', -1, 0]] as [string, number, number][]) {
    const b = min === -1 ? R.filter((r: any) => !r.fdvAtSignal || parseFDV(r.fdvAtSignal) === 0) : R.filter((r: any) => { const f = parseFDV(r.fdvAtSignal); return f > 0 && f >= min && f < max; });
    if (!b.length) continue;
    const pnl = b.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
    const wr = b.filter((r: any) => r.pnlUsdc > 0).length / b.length * 100;
    console.log(`  ${label}: ${b.length} trades, $${$(pnl)}, WR: ${wr.toFixed(0)}%`);
  }

  console.log('\n── Weekly P&L ──');
  const byW = new Map<string, { n: number; pnl: number }>();
  for (const r of R) { const d = new Date(r.signalDate); const ws = new Date(d); ws.setDate(d.getDate() - d.getDay()); const w = ws.toISOString().slice(0, 10); const s = byW.get(w) || { n: 0, pnl: 0 }; s.n++; s.pnl += r.pnlUsdc; byW.set(w, s); }
  for (const [w, s] of [...byW.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    console.log(`  ${w}: ${String(s.n).padStart(4)} trades, ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(0).padStart(7)}`);

  const mx = withData.filter((r: any) => r.maxGainPct > 50);
  if (mx.length) {
    const avgPeak = mx.reduce((s: number, r: any) => s + r.daysToMax, 0) / mx.length;
    console.log(`\nTokens that pumped >50%: ${mx.length} (${(mx.length / withData.length * 100).toFixed(0)}% of tokens with data)`);
    console.log(`Avg days to peak for >50% pumpers: ${avgPeak.toFixed(1)}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

let interrupted = false;

function save(results: any[]) {
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  saveCache();
  console.log(`\nSaved ${results.length} results to ${OUTPUT}`);
  console.log(`API stats: ${totalCalls} calls, ${total429s} rate limits hit`);
  printSummary(results);
}

process.on('SIGINT', () => { interrupted = true; console.log('\n\nInterrupted — saving cache...'); saveCache(); });
process.on('SIGTERM', () => { interrupted = true; saveCache(); });

async function main() {
  loadCache();
  const signals: Signal[] = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const uniqueAddrs = [...new Set(signals.map(s => s.addr))];
  console.log(`Signals: ${signals.length} | Unique addresses: ${uniqueAddrs.length}\n`);

  // Phase 1: Batch pool discovery (30 tokens per API call)
  await batchDiscoverPools(uniqueAddrs);
  if (interrupted) { saveCache(); return; }

  // Phase 2: Fetch OHLCV for tokens with pools
  await fetchOHLCV(uniqueAddrs);
  if (interrupted) { saveCache(); return; }

  // Phase 3: Run backtest
  console.log('Phase 3: Running backtest...\n');
  const results: any[] = [];

  for (const sig of signals) {
    const entry = cache[sig.addr] || cache[sig.addr.toLowerCase()];

    if (!entry || entry.pool === null || entry.candles.length === 0) {
      results.push({
        addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
        symbol: entry?.symbol || 'NO_DATA', entryPrice: 0, fdvAtSignal: sig.fdv,
        currentPrice: 0, pctNow: -100,
        maxGainPct: 0, maxDrawdownPct: -100, daysToMax: 0, daysToMin: 0,
        exitPct: -30, exitReason: 'NO_DATA_SL', exitDay: 0, pnlUsdc: -30,
        hasCandles: false,
      });
      continue;
    }

    const result = backtest(sig, entry);
    if (result) {
      results.push(result);
    } else {
      results.push({
        addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
        symbol: entry.symbol, entryPrice: 0, fdvAtSignal: sig.fdv,
        currentPrice: 0, pctNow: -100,
        maxGainPct: 0, maxDrawdownPct: -100, daysToMax: 0, daysToMin: 0,
        exitPct: -30, exitReason: 'NO_ENTRY_PRICE', exitDay: 0, pnlUsdc: -30,
        hasCandles: false,
      });
    }
  }

  save(results);
}

main().catch(err => { console.error(err); saveCache(); process.exit(1); });
