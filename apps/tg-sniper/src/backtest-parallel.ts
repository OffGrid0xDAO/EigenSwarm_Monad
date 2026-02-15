import 'dotenv/config';
import fs from 'fs';

/**
 * Parallel OHLCV fetcher — burst-mode replacement for sequential backtest-ohlcv.ts Phase 2.
 *
 * Assumes Phase 1 (pool discovery) is already complete in cache.
 * Fires BURST_SIZE concurrent requests, waits between bursts.
 * On completion: runs full backtest + prints summary.
 */

const INPUT = '/tmp/tg-sniper-30d-tradeable.json';
const OUTPUT = '/tmp/tg-sniper-30d-backtest-ohlcv.json';
const CACHE_FILE = '/tmp/tg-sniper-ohlcv-cache.json';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

const BURST_SIZE = 5;
const BASE_BURST_DELAY = 45_000;   // 45s between bursts
const BACKOFF_DELAY = 75_000;      // 75s after a 429
const BACKOFF_BURSTS = 3;          // how many bursts to stay in backoff

interface Signal {
  addr: string; sender: string; chat: string; date: string;
  fdv: string | null; liq: number | null; chain: string | null; symbol: string | null;
}

interface CacheEntry {
  pool: string | null;
  symbol: string;
  candles: number[][]; // [ts, o, h, l, c, v] — daily (legacy)
  hourlyCandles?: number[][]; // [ts, o, h, l, c, v] — hourly (accurate)
  fetchedAt: string;
}

// ── State ────────────────────────────────────────────────────────────────

let cache: Record<string, CacheEntry> = {};
let interrupted = false;
let total429s = 0;
let totalCalls = 0;

// ── Cache ────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const withDaily = Object.values(cache).filter(c => c.candles.length > 0).length;
      const withHourly = Object.values(cache).filter(c => c.hourlyCandles && c.hourlyCandles.length > 0).length;
      const withPool = Object.values(cache).filter(c => c.pool !== null).length;
      const noPool = Object.values(cache).filter(c => c.pool === null).length;
      console.log(`Cache: ${Object.keys(cache).length} entries (${withHourly} hourly, ${withDaily} daily, ${withPool} pools, ${noPool} no pool)`);
    }
  } catch {}
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

// ── Single OHLCV fetch — HOURLY candles for accurate signal-time entry ──

async function fetchOHLCVSingle(poolAddr: string): Promise<number[][]> {
  totalCalls++;
  // Fetch 720 hourly candles = 30 days of data
  const res = await fetch(
    `${GECKO_BASE}/networks/base/pools/${poolAddr}/ohlcv/hour?aggregate=1&limit=720&currency=usd`,
    { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } }
  );

  if (res.status === 429) {
    total429s++;
    throw new Error('429');
  }
  if (!res.ok) return [];

  const json = await res.json();
  return json?.data?.attributes?.ohlcv_list || [];
}

// ── Parallel Burst Fetcher ───────────────────────────────────────────────

async function parallelFetch(addrs: string[]) {
  // Fetch hourly candles for tokens that have a pool but no hourly data yet
  const needOhlcv = addrs.filter(a => {
    const entry = cache[a] || cache[a.toLowerCase()];
    return entry && entry.pool && (!entry.hourlyCandles || entry.hourlyCandles.length === 0);
  });

  if (!needOhlcv.length) {
    console.log('All hourly OHLCV data already cached — nothing to fetch.');
    return;
  }

  console.log(`Parallel fetch (HOURLY): ${needOhlcv.length} tokens (burst=${BURST_SIZE}, delay=${BASE_BURST_DELAY / 1000}s)\n`);
  const startTime = Date.now();

  let burstDelay = BASE_BURST_DELAY;
  let backoffRemaining = 0;
  let fetched = 0;

  for (let i = 0; i < needOhlcv.length && !interrupted; i += BURST_SIZE) {
    const batch = needOhlcv.slice(i, i + BURST_SIZE);
    const burstNum = Math.floor(i / BURST_SIZE) + 1;
    const totalBursts = Math.ceil(needOhlcv.length / BURST_SIZE);

    process.stdout.write(`\r  Burst ${burstNum}/${totalBursts} [${((i / needOhlcv.length) * 100).toFixed(0)}%] `);

    const results = await Promise.allSettled(
      batch.map(addr => {
        const entry = cache[addr] || cache[addr.toLowerCase()];
        return fetchOHLCVSingle(entry!.pool!);
      })
    );

    let got429 = false;
    for (let j = 0; j < batch.length; j++) {
      const addr = batch[j];
      const entry = cache[addr] || cache[addr.toLowerCase()];
      const result = results[j];

      if (result.status === 'fulfilled') {
        entry.hourlyCandles = result.value;
        entry.fetchedAt = new Date().toISOString();
        cache[addr] = entry;
        fetched++;
        process.stdout.write(result.value.length > 0 ? `[${result.value.length}h]` : '[0h]');
      } else {
        const is429 = result.reason?.message === '429';
        if (is429) got429 = true;
        process.stdout.write(is429 ? '[429]' : '[err]');
      }
    }

    if (got429) {
      backoffRemaining = BACKOFF_BURSTS;
      process.stdout.write(` ⚠ 429 — backing off to ${BACKOFF_DELAY / 1000}s for next ${BACKOFF_BURSTS} bursts`);
    }

    if (backoffRemaining > 0) {
      burstDelay = BACKOFF_DELAY;
      backoffRemaining--;
    } else {
      burstDelay = BASE_BURST_DELAY;
    }

    if (burstNum % 5 === 0 || i + BURST_SIZE >= needOhlcv.length) {
      saveCache();
      const withHourly = Object.values(cache).filter(c => c.hourlyCandles && c.hourlyCandles.length > 0).length;
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const rate = fetched > 0 ? (fetched / parseFloat(elapsed)).toFixed(1) : '—';
      process.stdout.write(`\n  [saved — ${withHourly} hourly total, ${rate}/min, ${elapsed}m, ${total429s} 429s]\n`);
    }

    if (i + BURST_SIZE < needOhlcv.length && !interrupted) {
      const remaining = needOhlcv.length - i - batch.length;
      const burstsLeft = Math.ceil(remaining / BURST_SIZE);
      const etaMins = (burstsLeft * burstDelay / 60_000).toFixed(0);
      process.stdout.write(` — wait ${burstDelay / 1000}s (ETA ~${etaMins}m)`);
      await new Promise(r => setTimeout(r, burstDelay));
    }
  }

  const withHourly = Object.values(cache).filter(c => c.hourlyCandles && c.hourlyCandles.length > 0).length;
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nDone: ${fetched} fetched in ${elapsed}m | ${withHourly} total with hourly candles | ${total429s} 429s | ${totalCalls} API calls`);
}

// ── Backtest Logic ──────────────────────────────────────────────────────

function findEntryPrice(sig: Signal, entry: CacheEntry): { entryPrice: number; sigTs: number; after: number[][]; source: 'hourly' | 'daily' } | null {
  // Prefer hourly candles (accurate to ±1h), fall back to daily (legacy)
  const hourly = entry.hourlyCandles && entry.hourlyCandles.length > 0 ? entry.hourlyCandles : null;
  const daily = entry.candles.length > 0 ? entry.candles : null;
  const candles = hourly || daily;
  if (!candles) return null;

  const sigTs = Math.floor(new Date(sig.date).getTime() / 1000);
  const source = hourly ? 'hourly' as const : 'daily' as const;

  let entryPrice: number | null = null;

  if (hourly) {
    // Hourly candles: use OPEN of the NEXT candle after signal time.
    // Reasoning: token gets shared → bot sees signal → processes + executes buy
    // The next hourly OPEN = price 0-60 min after signal (realistic execution time).
    // This avoids the bias of using the signal-hour OPEN (pre-pump price).
    const sorted = [...hourly].sort((a, b) => a[0] - b[0]); // oldest → newest
    const nextCandle = sorted.find(c => c[0] > sigTs);
    const matchCandle = sorted.filter(c => c[0] <= sigTs).pop(); // last candle before signal

    if (nextCandle) {
      // Use OPEN of the candle right AFTER signal time
      entryPrice = nextCandle[1];
    } else if (matchCandle) {
      // Signal is after the last candle — use CLOSE of that candle
      entryPrice = matchCandle[4];
    }

    // Verify the entry candle is within 2h of signal
    const entryCandle = nextCandle || matchCandle;
    if (entryCandle && Math.abs(entryCandle[0] - sigTs) > 7200) entryPrice = null;
  } else if (daily) {
    // Daily fallback: match by date string
    const sigDay = sig.date.slice(0, 10);
    for (const c of daily) {
      if (new Date(c[0] * 1000).toISOString().slice(0, 10) === sigDay) {
        entryPrice = c[1];
        break;
      }
    }
    if (!entryPrice) {
      let best: [number, number] | null = null;
      for (const c of daily) {
        const d = Math.abs(c[0] - sigTs);
        if (!best || d < best[0]) best = [d, c[1]];
      }
      if (best && best[0] < 172800) entryPrice = best[1];
    }
  }

  if (!entryPrice || entryPrice === 0) return null;

  // Get all candles AFTER signal time, sorted ascending
  const after = candles.filter(c => c[0] >= sigTs).sort((a, b) => a[0] - b[0]);
  return { entryPrice, sigTs, after, source };
}

function backtestWithParams(sig: Signal, entry: CacheEntry, sl: number, tp: number) {
  const found = findEntryPrice(sig, entry);
  if (!found) return null;
  const { entryPrice, sigTs, after, source } = found;

  let maxGain = 0, maxDD = 0, daysToMax = 0, daysToMin = 0;
  let exitPct = 0, exitReason = 'NO_DATA', exitDay = 0;
  let exited = false;

  // Flat close threshold: 24h regardless of candle granularity
  const FLAT_CLOSE_SECS = 24 * 3600;

  for (const c of after) {
    const secsSince = c[0] - sigTs;
    const daysSince = secsSince / 86400;
    const highPct = ((c[2] - entryPrice) / entryPrice) * 100;
    const lowPct = ((c[3] - entryPrice) / entryPrice) * 100;
    const closePct = ((c[4] - entryPrice) / entryPrice) * 100;

    if (highPct > maxGain) { maxGain = highPct; daysToMax = parseFloat(daysSince.toFixed(2)); }
    if (lowPct < maxDD) { maxDD = lowPct; daysToMin = parseFloat(daysSince.toFixed(2)); }

    if (!exited) {
      if (highPct >= tp) {
        exitPct = tp; exitReason = 'TP'; exitDay = parseFloat(daysSince.toFixed(2)); exited = true;
      } else if (lowPct <= sl) {
        exitPct = sl; exitReason = 'SL'; exitDay = parseFloat(daysSince.toFixed(2)); exited = true;
      } else if (secsSince >= FLAT_CLOSE_SECS && Math.abs(closePct) <= 10) {
        exitPct = closePct; exitReason = 'FLAT'; exitDay = parseFloat(daysSince.toFixed(2)); exited = true;
      }
    }
  }

  if (!exited && after.length > 0) {
    const last = after[after.length - 1];
    exitPct = ((last[4] - entryPrice) / entryPrice) * 100;
    exitReason = 'HOLD';
    exitDay = parseFloat(((last[0] - sigTs) / 86400).toFixed(2));
  }

  const currentPrice = after.length ? [...after].sort((a, b) => b[0] - a[0])[0][4] : entryPrice;

  return {
    addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
    symbol: entry.symbol, entryPrice,
    fdvAtSignal: sig.fdv,
    currentPrice,
    pctNow: ((currentPrice - entryPrice) / entryPrice) * 100,
    maxGainPct: maxGain, maxDrawdownPct: maxDD,
    daysToMax, daysToMin,
    exitPct, exitReason, exitDay,
    pnlUsdc: exitPct / 100 * 100,
    hasCandles: true,
    candleSource: source,
  };
}

function backtest(sig: Signal, entry: CacheEntry) {
  return backtestWithParams(sig, entry, -30, 50);
}

// ── SL/TP Sweep with Context Awareness ──────────────────────────────────

interface ContextEntry {
  addr: string; repostCount: number; uniqueMentioners: number;
  hasBullishFollowUp: boolean; hasBearishFollowUp: boolean;
  sentimentScore: number; replyCount: number; totalMentions: number;
}

function runSlTpSweep(signals: Signal[]) {
  // Load context data if available
  const CONTEXT_FILE = '/tmp/tg-sniper-context-analysis.json';
  let ctxMap = new Map<string, ContextEntry>();
  try {
    if (fs.existsSync(CONTEXT_FILE)) {
      const ctxData: ContextEntry[] = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
      for (const c of ctxData) ctxMap.set(c.addr, c);
      console.log(`  Loaded ${ctxMap.size} context entries`);
    }
  } catch {}

  // Only tokens with candle data
  type TestSig = { sig: Signal; entry: CacheEntry; isHighConv: boolean };
  const testable: TestSig[] = [];
  const seen = new Set<string>();

  for (const sig of signals) {
    if (seen.has(sig.addr)) continue;
    seen.add(sig.addr);
    const entry = cache[sig.addr] || cache[sig.addr.toLowerCase()];
    if (!entry || entry.candles.length === 0) continue;

    const ctx = ctxMap.get(sig.addr);
    const isHighConv = ctx ? (ctx.repostCount >= 2 || ctx.uniqueMentioners >= 3) : false;
    testable.push({ sig, entry, isHighConv });
  }

  const highConv = testable.filter(t => t.isHighConv);
  const normal = testable.filter(t => !t.isHighConv);

  console.log(`  Testable: ${testable.length} tokens (${highConv.length} high-conviction, ${normal.length} normal)\n`);

  const $$ = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(0);

  // ── SL sweep for each group ──
  for (const [label, group] of [['HIGH CONVICTION', highConv], ['NORMAL', normal], ['ALL', testable]] as [string, TestSig[]][]) {
    if (!group.length) continue;
    console.log(`\n  ── ${label} (${group.length} tokens) ──`);
    console.log(`  ${'SL'.padStart(6)} ${'TP'.padStart(6)} | ${'Trades'.padStart(6)} ${'WR'.padStart(7)} ${'AvgP&L'.padStart(9)} ${'TotalP&L'.padStart(11)} | ${'TPs'.padStart(4)} ${'SLs'.padStart(4)} ${'Flat'.padStart(4)} ${'Hold'.padStart(4)}`);
    console.log(`  ${'-'.repeat(80)}`);

    for (const sl of [-5, -10, -15, -20, -30, -50]) {
      for (const tp of [50, 100, 150, 200]) {
        const results = group.map(t => backtestWithParams(t.sig, t.entry, sl, tp)).filter(Boolean) as any[];
        const wins = results.filter(r => r.pnlUsdc > 0);
        const total = results.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
        const avg = results.length ? total / results.length : 0;
        const tps = results.filter(r => r.exitReason === 'TP').length;
        const sls = results.filter(r => r.exitReason === 'SL').length;
        const flat = results.filter(r => r.exitReason === 'FLAT').length;
        const hold = results.filter(r => r.exitReason === 'HOLD').length;

        console.log(`  ${$$(sl).padStart(6)} ${$$(tp).padStart(6)} | ${String(results.length).padStart(6)} ${(wins.length / results.length * 100).toFixed(1).padStart(6)}% ${('$' + avg.toFixed(2)).padStart(9)} ${('$' + total.toFixed(0)).padStart(11)} | ${String(tps).padStart(4)} ${String(sls).padStart(4)} ${String(flat).padStart(4)} ${String(hold).padStart(4)}`);
      }
    }
  }

  // ── Combined tiered strategy sweep ──
  console.log('\n\n  ══ TIERED STRATEGY SWEEP ══');
  console.log('  (high-conv gets $200 + custom SL/TP, normal gets $100 + SL-30/TP+50)\n');
  console.log(`  ${'HC_SL'.padStart(6)} ${'HC_TP'.padStart(6)} ${'HC_$'.padStart(5)} | ${'TotalP&L'.padStart(11)} ${'ROI'.padStart(8)} ${'Capital'.padStart(9)} ${'WR'.padStart(7)}`);
  console.log(`  ${'-'.repeat(65)}`);

  // Normal baseline: always $100, SL-30, TP+50
  const normalBaseline = normal.map(t => {
    const r = backtestWithParams(t.sig, t.entry, -30, 50);
    return r ? r.pnlUsdc : -30;
  });
  const normalTotal = normalBaseline.reduce((s, p) => s + p, 0);
  const normalCapital = normal.length * 100;
  const normalWins = normalBaseline.filter(p => p > 0).length;

  for (const hcSl of [-5, -10, -15, -20, -30]) {
    for (const hcTp of [50, 100, 150, 200]) {
      for (const hcSize of [100, 200, 300]) {
        const hcResults = highConv.map(t => {
          const r = backtestWithParams(t.sig, t.entry, hcSl, hcTp);
          return r ? r.pnlUsdc * (hcSize / 100) : hcSl * (hcSize / 100);
        });
        const hcTotal = hcResults.reduce((s, p) => s + p, 0);
        const hcWins = hcResults.filter(p => p > 0).length;
        const hcCapital = highConv.length * hcSize;

        const totalPnl = hcTotal + normalTotal;
        const totalCapital = hcCapital + normalCapital;
        const totalWins = hcWins + normalWins;
        const totalTrades = highConv.length + normal.length;
        const roi = (totalPnl / totalCapital * 100);

        console.log(`  ${$$(hcSl).padStart(6)} ${$$(hcTp).padStart(6)} ${('$' + hcSize).padStart(5)} | ${('$' + totalPnl.toFixed(0)).padStart(11)} ${(roi.toFixed(2) + '%').padStart(8)} ${('$' + totalCapital).padStart(9)} ${(totalWins / totalTrades * 100).toFixed(1).padStart(6)}%`);
      }
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────

function printSummary(R: any[]) {
  if (!R.length) return;
  const $ = (n: number) => n.toFixed(2);

  const withData = R.filter((r: any) => r.hasCandles);
  const noData = R.filter((r: any) => !r.hasCandles);

  const T = R.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
  const W = R.filter((r: any) => r.pnlUsdc > 0), L = R.filter((r: any) => r.pnlUsdc < 0);

  console.log('\n' + '='.repeat(60));
  console.log('  HOURLY OHLCV BACKTEST — SL -30% / TP +50% / Flat 24h +/-10%');
  console.log('='.repeat(60));
  console.log(`\nTotal: ${R.length} signals @ $100`);
  const fromHourly = withData.filter((r: any) => r.candleSource === 'hourly').length;
  const fromDaily = withData.filter((r: any) => r.candleSource === 'daily').length;
  console.log(`With OHLCV data: ${withData.length} (${fromHourly} hourly, ${fromDaily} daily) | No pool/data (assumed SL): ${noData.length}`);
  console.log(`\nTotal P&L: $${$(T)} | WR: ${(W.length / R.length * 100).toFixed(1)}%`);
  console.log(`Wins: ${W.length} (avg $${$(W.length ? W.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / W.length : 0)})`);
  console.log(`Losses: ${L.length} (avg $${$(L.length ? L.reduce((s: number, r: any) => s + r.pnlUsdc, 0) / L.length : 0)})`);

  if (withData.length) {
    const dp = withData.reduce((s: number, r: any) => s + r.pnlUsdc, 0);
    const dw = withData.filter((r: any) => r.pnlUsdc > 0);
    console.log(`\n-- With OHLCV Data Only --`);
    console.log(`P&L: $${$(dp)} | WR: ${(dw.length / withData.length * 100).toFixed(1)}%`);
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
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%, $/trade: $${$(v.pnl / v.n)}`);

  console.log('\n-- Top 30 Senders by P&L --');
  const byS = new Map<string, { n: number; pnl: number; w: number; tp: number }>();
  for (const r of R) { const s = byS.get(r.sender) || { n: 0, pnl: 0, w: 0, tp: 0 }; s.n++; s.pnl += r.pnlUsdc; if (r.pnlUsdc > 0) s.w++; if (r.exitReason === 'TP') s.tp++; byS.set(r.sender, s); }
  for (const [k, v] of [...byS.entries()].sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 30))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%, TPs: ${v.tp}, $/trade: $${$(v.pnl / v.n)}`);

  console.log('\n-- Bottom 15 Senders --');
  for (const [k, v] of [...byS.entries()].filter(([, v]) => v.n >= 3).sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 15))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w / v.n * 100).toFixed(0)}%`);

  console.log('\n-- Top 10 Biggest Pumps (max gain after signal) --');
  for (const r of [...withData].sort((a: any, b: any) => b.maxGainPct - a.maxGainPct).slice(0, 10))
    console.log(`  ${r.symbol} +${r.maxGainPct.toFixed(0)}% in ${r.daysToMax}d | ${r.chat} by ${r.sender} | ${r.signalDate.slice(0, 10)}`);

  console.log('\n-- P&L by Signal-Time FDV --');
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

  console.log('\n-- Weekly P&L --');
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

// ── Signal Quality Filter ────────────────────────────────────────────────

function isTradeableSignal(sig: Signal): boolean {
  // Would the bot actually trade this? Needs: chain, FDV, liquidity
  const hasChain = sig.chain && sig.chain !== 'unknown';
  const hasFDV = sig.fdv && sig.fdv !== 'null' && sig.fdv !== '0';
  const hasLiq = sig.liq !== null && sig.liq > 0;
  return !!(hasChain && hasFDV && hasLiq);
}

function signalQualityTag(sig: Signal): string {
  const tags: string[] = [];
  if (!sig.chain || sig.chain === 'unknown') tags.push('no_chain');
  if (!sig.fdv || sig.fdv === 'null' || sig.fdv === '0') tags.push('no_fdv');
  if (!sig.liq || sig.liq === 0) tags.push('no_liq');
  if (!sig.symbol || sig.symbol === 'null') tags.push('no_symbol');
  return tags.length ? tags.join(',') : 'tradeable';
}

// ── Main ─────────────────────────────────────────────────────────────────

function runBacktest(signals: Signal[]) {
  console.log('\nRunning backtest...\n');
  const results: any[] = [];

  for (const sig of signals) {
    const entry = cache[sig.addr] || cache[sig.addr.toLowerCase()];
    const tradeable = isTradeableSignal(sig);
    const quality = signalQualityTag(sig);

    if (!entry || entry.pool === null || entry.candles.length === 0) {
      results.push({
        addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
        symbol: entry?.symbol || 'NO_DATA', entryPrice: 0, fdvAtSignal: sig.fdv,
        liqAtSignal: sig.liq, chainAtSignal: sig.chain,
        currentPrice: 0, pctNow: -100,
        maxGainPct: 0, maxDrawdownPct: -100, daysToMax: 0, daysToMin: 0,
        exitPct: -30, exitReason: 'NO_DATA_SL', exitDay: 0, pnlUsdc: -30,
        hasCandles: false, tradeable, quality,
      });
      continue;
    }

    const result = backtest(sig, entry);
    if (result) {
      results.push({ ...result, liqAtSignal: sig.liq, chainAtSignal: sig.chain, tradeable, quality });
    } else {
      results.push({
        addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
        symbol: entry.symbol, entryPrice: 0, fdvAtSignal: sig.fdv,
        liqAtSignal: sig.liq, chainAtSignal: sig.chain,
        currentPrice: 0, pctNow: -100,
        maxGainPct: 0, maxDrawdownPct: -100, daysToMax: 0, daysToMin: 0,
        exitPct: -30, exitReason: 'NO_ENTRY_PRICE', exitDay: 0, pnlUsdc: -30,
        hasCandles: false, tradeable, quality,
      });
    }
  }

  return results;
}

process.on('SIGINT', () => {
  interrupted = true;
  console.log('\n\nInterrupted — saving cache...');
  saveCache();
});
process.on('SIGTERM', () => { interrupted = true; saveCache(); });

async function main() {
  loadCache();
  const signals: Signal[] = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const uniqueAddrs = [...new Set(signals.map(s => s.addr))];
  console.log(`Signals: ${signals.length} | Unique addresses: ${uniqueAddrs.length}`);

  // Skip Phase 1 — pool discovery already in cache
  const withPool = Object.values(cache).filter(c => c.pool !== null).length;
  const withDaily = Object.values(cache).filter(c => c.candles.length > 0).length;
  const withHourly = Object.values(cache).filter(c => c.hourlyCandles && c.hourlyCandles.length > 0).length;
  const needOhlcv = uniqueAddrs.filter(a => {
    const entry = cache[a] || cache[a.toLowerCase()];
    return entry && entry.pool && (!entry.hourlyCandles || entry.hourlyCandles.length === 0);
  });
  console.log(`Pools: ${withPool} | Hourly candles: ${withHourly} | Daily (legacy): ${withDaily} | Need hourly OHLCV: ${needOhlcv.length}\n`);

  if (needOhlcv.length === 0) {
    console.log('Nothing to fetch — running backtest on existing data.');
  } else {
    await parallelFetch(uniqueAddrs);
    if (interrupted) { saveCache(); return; }
  }

  // Run backtest
  const results = runBacktest(signals);
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  saveCache();
  console.log(`\nSaved ${results.length} results to ${OUTPUT}`);
  console.log(`API stats: ${totalCalls} calls, ${total429s} rate limits hit`);

  // ── Scenario 1: Full set (no-pool = -30% SL) ──
  console.log('\n\n' + '#'.repeat(60));
  console.log('  SCENARIO 1: ALL SIGNALS (no-pool = -30% SL)');
  console.log('#'.repeat(60));
  printSummary(results);

  // ── Scenario 2: Full set (no-pool = -100% rug, worst case) ──
  const worstCase = results.map(r => {
    if (!r.hasCandles && r.exitReason === 'NO_DATA_SL') {
      return { ...r, exitPct: -100, pnlUsdc: -100, exitReason: 'NO_DATA_RUG' };
    }
    return r;
  });
  console.log('\n\n' + '#'.repeat(60));
  console.log('  SCENARIO 2: ALL SIGNALS (no-pool = -100% RUG, worst case)');
  console.log('#'.repeat(60));
  printSummary(worstCase);

  // ── Scenario 3: Filtered — only signals the bot WOULD trade ──
  const filtered = results.filter(r => r.tradeable);
  console.log('\n\n' + '#'.repeat(60));
  console.log('  SCENARIO 3: FILTERED — tradeable signals only');
  console.log('  (has chain + FDV + liquidity at signal time)');
  console.log('#'.repeat(60));
  printSummary(filtered);

  // ── Quality breakdown ──
  const qualityMap = new Map<string, { n: number; pnl: number; noPool: number }>();
  for (const r of results) {
    const s = qualityMap.get(r.quality) || { n: 0, pnl: 0, noPool: 0 };
    s.n++; s.pnl += r.pnlUsdc;
    if (!r.hasCandles) s.noPool++;
    qualityMap.set(r.quality, s);
  }
  console.log('\n\n' + '='.repeat(60));
  console.log('  SIGNAL QUALITY BREAKDOWN');
  console.log('='.repeat(60));
  const $ = (n: number) => n.toFixed(2);
  for (const [q, s] of [...qualityMap.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${q}: ${s.n} signals, $${$(s.pnl)} P&L, ${s.noPool} no-pool (${(s.noPool/s.n*100).toFixed(0)}% rug)`);
  }

  // ── Filter recommendation ──
  const tradeableCount = results.filter(r => r.tradeable).length;
  const skippedCount = results.length - tradeableCount;
  const tradeablePnl = results.filter(r => r.tradeable).reduce((s, r) => s + r.pnlUsdc, 0);
  const skippedPnl = results.filter(r => !r.tradeable).reduce((s, r) => s + r.pnlUsdc, 0);
  console.log(`\n  FILTER IMPACT: Trading ${tradeableCount}/${results.length} signals`);
  console.log(`  Skipped ${skippedCount} signals would have lost: $${$(skippedPnl)}`);
  console.log(`  Tradeable signals P&L: $${$(tradeablePnl)}`);
  console.log(`  Savings from filter: $${$(Math.abs(skippedPnl))}`);

  // ── SL/TP Sweep ──
  console.log('\n\n' + '#'.repeat(60));
  console.log('  SL/TP PARAMETER SWEEP (with context awareness)');
  console.log('#'.repeat(60));
  runSlTpSweep(signals);
}

main().catch(err => { console.error(err); saveCache(); process.exit(1); });
