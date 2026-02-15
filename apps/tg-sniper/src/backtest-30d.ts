import 'dotenv/config';
import fs from 'fs';

const INPUT = '/tmp/tg-sniper-30d-tradeable.json';
const OUTPUT = '/tmp/tg-sniper-30d-backtest.json';
const CACHE_FILE = '/tmp/tg-sniper-30d-price-cache.json';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

interface TradableSignal {
  addr: string; sender: string; chat: string; date: string;
  fdv: string | null; liq: number | null; chain: string | null; symbol: string | null;
}
interface PriceData {
  pool: string | null; symbol: string; currentPrice: number; fdv: number;
  candles: number[][]; fetchedAt: string;
}
interface BacktestResult {
  addr: string; sender: string; chat: string; signalDate: string;
  symbol: string; entryPrice: number; fdvAtSignal: string | null;
  priceAt1d: number | null; priceAt3d: number | null; priceAt7d: number | null; priceAt14d: number | null;
  currentPrice: number;
  pctAt1d: number | null; pctAt3d: number | null; pctAt7d: number | null; pctAt14d: number | null; pctNow: number;
  maxGainPct: number; maxDrawdownPct: number; daysToMax: number; daysToMin: number;
  strategyExitPct: number; strategyExitReason: string; strategyExitDay: number; strategyPnlUsdc: number;
}

// ── Rate Limiters ───────────────────────────────────────────────────────
let lastGecko = 0, lastDex = 0;
async function geckoFetch(url: string): Promise<any> {
  const wait = 4500 - (Date.now() - lastGecko);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGecko = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      console.log('  Gecko 429 — waiting 65s...');
      await new Promise(r => setTimeout(r, 65_000));
      return geckoFetch(url);
    }
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}
async function dexFetch(url: string): Promise<any> {
  const wait = 300 - (Date.now() - lastDex);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastDex = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      console.log('  DexScreener 429 — waiting 30s...');
      await new Promise(r => setTimeout(r, 30_000));
      return dexFetch(url);
    }
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Cache ───────────────────────────────────────────────────────────────
let priceCache: Record<string, PriceData> = {};
function loadCache() {
  try { if (fs.existsSync(CACHE_FILE)) { priceCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); console.log(`Cache: ${Object.keys(priceCache).length} entries`); } } catch {}
}
function saveCache() { fs.writeFileSync(CACHE_FILE, JSON.stringify(priceCache)); }

// ── Phase 1: DexScreener Batch ──────────────────────────────────────────
async function batchDexScreener(addrs: string[]): Promise<Map<string, { pool: string; symbol: string; price: number; fdv: number }>> {
  const out = new Map<string, { pool: string; symbol: string; price: number; fdv: number }>();
  const BATCH = 30;
  for (let i = 0; i < addrs.length && !interrupted; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    const data = await dexFetch(`${DEXSCREENER_BASE}/tokens/v1/base/${batch.join(',')}`);
    if (Array.isArray(data)) {
      for (const p of data) {
        const addr = p.baseToken?.address?.toLowerCase();
        if (!addr || out.has(addr)) continue;
        out.set(addr, { pool: p.pairAddress || '', symbol: p.baseToken?.symbol || '?', price: parseFloat(p.priceUsd || '0'), fdv: p.fdv || 0 });
      }
    }
    process.stdout.write(`\r  DexScreener: ${Math.min(i + BATCH, addrs.length)}/${addrs.length} — found ${out.size}  `);
  }
  console.log();
  return out;
}

// ── Phase 2: GeckoTerminal OHLCV ───────────────────────────────────────
async function fetchOHLCV(tokenAddr: string): Promise<{ pool: string; candles: number[][] } | null> {
  const poolData = await geckoFetch(`${GECKO_BASE}/networks/base/tokens/${tokenAddr}/pools?page=1`);
  const pools = poolData?.data || [];
  if (!pools.length) return null;
  const pool = pools[0].attributes?.address;
  if (!pool) return null;
  const ohlcv = await geckoFetch(`${GECKO_BASE}/networks/base/pools/${pool}/ohlcv/day?aggregate=1&limit=45`);
  return { pool, candles: ohlcv?.data?.attributes?.ohlcv_list || [] };
}

// ── Backtest helpers ────────────────────────────────────────────────────
function priceOnDate(candles: number[][], date: string): number | null {
  const day = date.slice(0, 10);
  for (const c of candles) { if (new Date(c[0] * 1000).toISOString().slice(0, 10) === day) return c[4]; }
  const ts = new Date(day).getTime() / 1000;
  let best: [number, number] | null = null;
  for (const c of candles) { const d = Math.abs(c[0] - ts); if (!best || d < best[0]) best = [d, c[4]]; }
  return best && best[0] < 172800 ? best[1] : null;
}
function priceAfterDays(candles: number[][], entryTs: number, days: number): number | null {
  const target = entryTs + days * 86400;
  let best: [number, number] | null = null;
  for (const c of candles) { const d = Math.abs(c[0] - target); if (!best || d < best[0]) best = [d, c[4]]; }
  return best && best[0] < 86400 ? best[1] : null;
}
function simulate(candles: number[][], entryTs: number, ep: number) {
  const SL = -30, TP = 50;
  const after = candles.filter(c => c[0] >= entryTs).sort((a, b) => a[0] - b[0]);
  for (const c of after) {
    const d = (c[0] - entryTs) / 86400;
    if (((c[2] - ep) / ep) * 100 >= TP) return { exitPct: TP, exitReason: 'TP', exitDay: Math.round(d) };
    if (((c[3] - ep) / ep) * 100 <= SL) return { exitPct: SL, exitReason: 'SL', exitDay: Math.round(d) };
    const cp = ((c[4] - ep) / ep) * 100;
    if (d >= 1 && Math.abs(cp) <= 10) return { exitPct: cp, exitReason: 'FLAT', exitDay: Math.round(d) };
  }
  if (after.length) { const l = after[after.length - 1]; return { exitPct: ((l[4] - ep) / ep) * 100, exitReason: 'HOLD', exitDay: Math.round((l[0] - entryTs) / 86400) }; }
  return { exitPct: 0, exitReason: 'NO_DATA', exitDay: 0 };
}

// ── Summary ─────────────────────────────────────────────────────────────
function summary(R: BacktestResult[]) {
  if (!R.length) return;
  const $ = (n: number) => n.toFixed(2);
  const T = R.reduce((s, r) => s + r.strategyPnlUsdc, 0);
  const W = R.filter(r => r.strategyPnlUsdc > 0), L = R.filter(r => r.strategyPnlUsdc < 0);
  console.log('\n' + '═'.repeat(60));
  console.log('  BACKTEST — SL -30% / TP +50% / Flat 1d ±10%');
  console.log('═'.repeat(60));
  console.log(`\nTrades: ${R.length} @ $100 each | Total P&L: $${$(T)} | WR: ${(W.length/R.length*100).toFixed(1)}%`);
  console.log(`Wins: ${W.length} (avg $${$(W.length?W.reduce((s,r)=>s+r.strategyPnlUsdc,0)/W.length:0)}) | Losses: ${L.length} (avg $${$(L.length?L.reduce((s,r)=>s+r.strategyPnlUsdc,0)/L.length:0)})`);

  console.log('\n── Exit Reasons ──');
  const byR = new Map<string, { n: number; pnl: number }>();
  for (const r of R) { const s = byR.get(r.strategyExitReason) || { n: 0, pnl: 0 }; s.n++; s.pnl += r.strategyPnlUsdc; byR.set(r.strategyExitReason, s); }
  for (const [k, v] of byR) console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}`);

  console.log('\n── By Chat ──');
  const byC = new Map<string, { n: number; pnl: number; w: number }>();
  for (const r of R) { const s = byC.get(r.chat) || { n: 0, pnl: 0, w: 0 }; s.n++; s.pnl += r.strategyPnlUsdc; if (r.strategyPnlUsdc > 0) s.w++; byC.set(r.chat, s); }
  for (const [k, v] of [...byC.entries()].sort((a, b) => b[1].pnl - a[1].pnl))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w/v.n*100).toFixed(0)}%, $/trade: $${$(v.pnl/v.n)}`);

  console.log('\n── Top 25 Senders by P&L ──');
  const byS = new Map<string, { n: number; pnl: number; w: number }>();
  for (const r of R) { const s = byS.get(r.sender) || { n: 0, pnl: 0, w: 0 }; s.n++; s.pnl += r.strategyPnlUsdc; if (r.strategyPnlUsdc > 0) s.w++; byS.set(r.sender, s); }
  for (const [k, v] of [...byS.entries()].sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 25))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w/v.n*100).toFixed(0)}%, $/trade: $${$(v.pnl/v.n)}`);

  console.log('\n── Bottom 10 Senders ──');
  for (const [k, v] of [...byS.entries()].sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 10))
    console.log(`  ${k}: ${v.n} trades, $${$(v.pnl)}, WR: ${(v.w/v.n*100).toFixed(0)}%`);

  console.log('\n── Top 10 Biggest Winners ──');
  for (const r of [...R].sort((a, b) => b.maxGainPct - a.maxGainPct).slice(0, 10))
    console.log(`  ${r.symbol} +${r.maxGainPct.toFixed(0)}% max in ${r.daysToMax}d | ${r.chat} by ${r.sender} | ${r.signalDate.slice(0, 10)}`);

  console.log('\n── Weekly P&L ──');
  const byW = new Map<string, { n: number; pnl: number }>();
  for (const r of R) { const d = new Date(r.signalDate); const ws = new Date(d); ws.setDate(d.getDate() - d.getDay()); const w = ws.toISOString().slice(0, 10); const s = byW.get(w) || { n: 0, pnl: 0 }; s.n++; s.pnl += r.strategyPnlUsdc; byW.set(w, s); }
  for (const [w, s] of [...byW.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const bar = s.pnl >= 0 ? '+'.repeat(Math.min(Math.ceil(s.pnl / 100), 30)) : '-'.repeat(Math.min(Math.ceil(Math.abs(s.pnl) / 100), 30));
    console.log(`  ${w}: ${String(s.n).padStart(3)} trades, ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(0).padStart(6)} ${bar}`);
  }

  // FDV buckets
  console.log('\n── P&L by Entry FDV ──');
  function parseFDV(f: string | null): number {
    if (!f) return 0;
    const m: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
    const match = f.replace(/[,$]/g, '').match(/([\d.]+)\s*([KMB])?/i);
    return match ? parseFloat(match[1]) * (match[2] ? m[match[2].toUpperCase()] || 1 : 1) : 0;
  }
  for (const [label, min, max] of [['<$10K', 0, 1e4], ['$10K-$50K', 1e4, 5e4], ['$50K-$100K', 5e4, 1e5], ['$100K-$500K', 1e5, 5e5], ['$500K+', 5e5, Infinity]] as [string, number, number][]) {
    const b = R.filter(r => { const f = parseFDV(r.fdvAtSignal); return f > 0 && f >= min && f < max; });
    if (!b.length) continue;
    const pnl = b.reduce((s, r) => s + r.strategyPnlUsdc, 0);
    console.log(`  ${label}: ${b.length} trades, $${$(pnl)}, WR: ${(b.filter(r => r.strategyPnlUsdc > 0).length / b.length * 100).toFixed(0)}%`);
  }

  // Timing
  const mx = R.filter(r => r.daysToMax > 0);
  if (mx.length) console.log(`\nAvg days to peak: ${(mx.reduce((s, r) => s + r.daysToMax, 0) / mx.length).toFixed(1)}`);
  const mn = R.filter(r => r.daysToMin > 0);
  if (mn.length) console.log(`Avg days to trough: ${(mn.reduce((s, r) => s + r.daysToMin, 0) / mn.length).toFixed(1)}`);
}

// ── Main ────────────────────────────────────────────────────────────────
let interrupted = false;
const results: BacktestResult[] = [];
function save() { fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2)); saveCache(); console.log(`\nSaved ${results.length} results to ${OUTPUT}`); summary(results); }
process.on('SIGINT', () => { interrupted = true; console.log('\n\nInterrupted — saving...'); save(); process.exit(0); });
process.on('SIGTERM', () => { interrupted = true; save(); process.exit(0); });

async function main() {
  loadCache();
  const signals: TradableSignal[] = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const uniqueAddrs = [...new Set(signals.map(s => s.addr))];
  const uncached = uniqueAddrs.filter(a => !priceCache[a]);
  console.log(`Signals: ${signals.length} | Unique addrs: ${uniqueAddrs.length} | Uncached: ${uncached.length}\n`);

  if (uncached.length > 0) {
    // Phase 1: DexScreener batch (fast — ~2 min for 3742 addrs)
    console.log('Phase 1: DexScreener batch lookup...');
    const dexData = await batchDexScreener(uncached);
    console.log(`Found ${dexData.size} tokens on DexScreener\n`);

    // Phase 2: GeckoTerminal OHLCV (slow — ~9s per token)
    const need = uncached.filter(a => dexData.has(a));
    const est = Math.ceil(need.length * 9 / 60);
    console.log(`Phase 2: GeckoTerminal OHLCV for ${need.length} tokens (~${est} min)`);

    for (let i = 0; i < need.length && !interrupted; i++) {
      const addr = need[i];
      const dex = dexData.get(addr)!;
      process.stdout.write(`\r  [${((i+1)/need.length*100).toFixed(0)}%] ${i+1}/${need.length} — ${dex.symbol} (${addr.slice(0,10)}...)  `);

      const ohlcv = await fetchOHLCV(addr);
      priceCache[addr] = { pool: ohlcv?.pool || dex.pool, symbol: dex.symbol, currentPrice: dex.price, fdv: dex.fdv, candles: ohlcv?.candles || [], fetchedAt: new Date().toISOString() };
      if ((i + 1) % 50 === 0) saveCache();
    }

    // Mark not-found tokens
    for (const a of uncached) { if (!priceCache[a]) priceCache[a] = { pool: null, symbol: '?', currentPrice: 0, fdv: 0, candles: [], fetchedAt: new Date().toISOString() }; }
    saveCache();
  }

  console.log('\n\nPhase 3: Backtesting...\n');
  let skip = 0;
  for (const sig of signals) {
    if (interrupted) break;
    const pd = priceCache[sig.addr];
    if (!pd || !pd.candles.length) { skip++; continue; }
    const entryTs = Math.floor(new Date(sig.date).getTime() / 1000);
    const ep = priceOnDate(pd.candles, sig.date);
    if (!ep || ep === 0) { skip++; continue; }

    const after = pd.candles.filter(c => c[0] >= entryTs).sort((a, b) => a[0] - b[0]);
    let mg = 0, md = 0, dtm = 0, dtn = 0;
    for (const c of after) {
      const hp = ((c[2] - ep) / ep) * 100, lp = ((c[3] - ep) / ep) * 100;
      if (hp > mg) { mg = hp; dtm = Math.round((c[0] - entryTs) / 86400); }
      if (lp < md) { md = lp; dtn = Math.round((c[0] - entryTs) / 86400); }
    }
    const cp = pd.currentPrice || pd.candles.sort((a, b) => b[0] - a[0])[0]?.[4] || ep;
    const strat = simulate(pd.candles, entryTs, ep);

    results.push({
      addr: sig.addr, sender: sig.sender, chat: sig.chat, signalDate: sig.date,
      symbol: pd.symbol, entryPrice: ep, fdvAtSignal: sig.fdv,
      priceAt1d: priceAfterDays(pd.candles, entryTs, 1), priceAt3d: priceAfterDays(pd.candles, entryTs, 3),
      priceAt7d: priceAfterDays(pd.candles, entryTs, 7), priceAt14d: priceAfterDays(pd.candles, entryTs, 14),
      currentPrice: cp,
      pctAt1d: (() => { const p = priceAfterDays(pd.candles, entryTs, 1); return p ? ((p - ep) / ep) * 100 : null; })(),
      pctAt3d: (() => { const p = priceAfterDays(pd.candles, entryTs, 3); return p ? ((p - ep) / ep) * 100 : null; })(),
      pctAt7d: (() => { const p = priceAfterDays(pd.candles, entryTs, 7); return p ? ((p - ep) / ep) * 100 : null; })(),
      pctAt14d: (() => { const p = priceAfterDays(pd.candles, entryTs, 14); return p ? ((p - ep) / ep) * 100 : null; })(),
      pctNow: ((cp - ep) / ep) * 100,
      maxGainPct: mg, maxDrawdownPct: md, daysToMax: dtm, daysToMin: dtn,
      strategyExitPct: strat.exitPct, strategyExitReason: strat.exitReason,
      strategyExitDay: strat.exitDay, strategyPnlUsdc: strat.exitPct / 100 * 100,
    });
  }
  console.log(`Backtested: ${results.length} | Skipped: ${skip}`);
  save();
}

main().catch(err => { console.error(err); save(); process.exit(1); });
