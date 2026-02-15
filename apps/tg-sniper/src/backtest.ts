import 'dotenv/config';
import fs from 'fs';

const API = 'https://fomolt.com/api/v1';
const KEY = process.env.FOMOLT_API_KEY!;
const headers = { Authorization: `Bearer ${KEY}` };

interface Trade {
  id: string;
  contractAddress: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  totalUsdc: string;
  realizedPnl: string | null;
  note: string | null;
  createdAt: string;
}

interface TradePair {
  symbol: string;
  contractAddress: string;
  buyTime: Date;
  sellTime: Date;
  entryPrice: number;
  exitPrice: number;
  amountUsdc: number;
  realizedPnl: number;
  pnlPct: number;
  holdMinutes: number;
  note: string;
  exitReason: string; // 'tp', 'sl', 'manual', 'timeout'
  source: string; // chat + sender
}

async function fetchAllTrades(): Promise<Trade[]> {
  const all: Trade[] = [];
  let cursor: string | undefined;

  while (true) {
    const url = cursor
      ? `${API}/agent/paper/dex/trades?limit=100&sort=asc&cursor=${cursor}`
      : `${API}/agent/paper/dex/trades?limit=100&sort=asc`;
    const res = await fetch(url, { headers });
    const json = await res.json() as any;
    if (!json.success) break;
    all.push(...json.response.trades);
    if (!json.response.pagination.hasMore) break;
    cursor = json.response.pagination.nextCursor;
  }

  return all;
}

function pairTrades(trades: Trade[]): TradePair[] {
  const buys = new Map<string, Trade[]>();
  const pairs: TradePair[] = [];

  // Group buys by contract address
  for (const t of trades) {
    if (t.side === 'buy') {
      const key = t.contractAddress.toLowerCase();
      if (!buys.has(key)) buys.set(key, []);
      buys.get(key)!.push(t);
    }
  }

  // Match sells to buys
  for (const t of trades) {
    if (t.side !== 'sell') continue;
    const key = t.contractAddress.toLowerCase();
    const buyList = buys.get(key);
    if (!buyList || buyList.length === 0) continue;

    const buy = buyList.shift()!;
    const entryPrice = parseFloat(buy.price);
    const exitPrice = parseFloat(t.price);
    const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : -100;
    const buyTime = new Date(buy.createdAt);
    const sellTime = new Date(t.createdAt);
    const holdMinutes = (sellTime.getTime() - buyTime.getTime()) / 60000;

    let exitReason = 'manual';
    if (t.note?.includes('Auto TP')) exitReason = 'tp';
    else if (t.note?.includes('Auto SL')) exitReason = 'sl';
    else if (t.note?.includes('Closing all')) exitReason = 'manual';

    // Extract source from buy note
    let source = '';
    const noteMatch = buy.note?.match(/TG sniper: (.+)/);
    if (noteMatch) source = noteMatch[1].replace(/&amp;/g, '&');

    pairs.push({
      symbol: t.symbol,
      contractAddress: t.contractAddress,
      buyTime,
      sellTime,
      entryPrice,
      exitPrice,
      amountUsdc: parseFloat(buy.totalUsdc),
      realizedPnl: parseFloat(t.realizedPnl || '0'),
      pnlPct,
      holdMinutes,
      note: buy.note || '',
      exitReason,
      source,
    });
  }

  return pairs;
}

// ── Strategy Simulations ────────────────────────────────────────────────

interface StrategyResult {
  name: string;
  totalPnl: number;
  tradeResults: { symbol: string; pnl: number; reason: string }[];
  wins: number;
  losses: number;
}

function currentStrategy(pairs: TradePair[]): StrategyResult {
  // Actual results — SL -30%, TP +50%, rest manual close
  const results = pairs.map(p => ({
    symbol: p.symbol,
    pnl: p.realizedPnl,
    reason: p.exitReason,
  }));
  return {
    name: 'Current: Flat $100, SL -30%, TP +50%',
    totalPnl: results.reduce((s, r) => s + r.pnl, 0),
    tradeResults: results,
    wins: results.filter(r => r.pnl > 0).length,
    losses: results.filter(r => r.pnl < 0).length,
  };
}

function trailingTpStrategy(pairs: TradePair[]): StrategyResult {
  // Trailing TP: sell 50% at +50%, trail rest with -30% from peak
  // SL: -30% on full position
  // Timeout: exit at 4 hours if within +/-15%
  //
  // Since we don't have tick data, we approximate:
  // - If actual exit was at TP (>= +50%), assume half sold at +50%, other half at actual exit
  // - If actual exit was at SL (<= -30%), same result
  // - If actual exit was manual (flat), apply 4hr timeout rule
  //
  // For trades that hit +50% TP auto-sell, we need to estimate where the "trail" would exit.
  // Conservative: assume the second half exits at 70% of peak PnL% (mean reversion after pump)

  const results = pairs.map(p => {
    const pct = p.pnlPct;

    // Rug / total loss — same outcome
    if (pct <= -90) {
      return { symbol: p.symbol, pnl: p.realizedPnl, reason: 'rug' };
    }

    // SL hit at -30% — same outcome
    if (p.exitReason === 'sl' || pct <= -30) {
      return { symbol: p.symbol, pnl: p.realizedPnl, reason: 'sl' };
    }

    // TP hit — trailing logic
    if (p.exitReason === 'tp' || pct >= 50) {
      // First half: sold at +50% = $50 profit on $100 → $25 profit (50% of position)
      const firstHalfPnl = 50 * 0.5; // $25 profit from first 50% of position

      // Second half: estimate where trailing stop would catch
      // If actual exit was at +50%, the trailing stop would exit somewhere between +35% and +50%
      // If actual exit was higher (e.g., +154%), the trailing stop (-30% from peak) would catch most of it
      // Conservative estimate: second half exits at max(actual_pct * 0.7, 35%)
      const secondHalfPct = Math.max(pct * 0.7, 35);
      const secondHalfPnl = (secondHalfPct / 100) * 50; // 50% of $100 position

      return {
        symbol: p.symbol,
        pnl: firstHalfPnl + secondHalfPnl,
        reason: `trailing_tp (peak ~${pct.toFixed(0)}%)`,
      };
    }

    // Flat position — 4hr timeout rule
    if (p.holdMinutes > 240 && Math.abs(pct) < 15) {
      // Would have exited at ~0% at 4hr mark instead of holding longer
      // Assume exit at 0% (breakeven) since it was flat
      return { symbol: p.symbol, pnl: 0, reason: 'timeout_4hr' };
    }

    // Everything else — same as actual
    return { symbol: p.symbol, pnl: p.realizedPnl, reason: `hold (${pct.toFixed(1)}%)` };
  });

  return {
    name: 'New: Trailing TP (50%→trail), SL -30%, 4hr timeout',
    totalPnl: results.reduce((s, r) => s + r.pnl, 0),
    tradeResults: results,
    wins: results.filter(r => r.pnl > 0).length,
    losses: results.filter(r => r.pnl < 0).length,
  };
}

function blacklistStrategy(pairs: TradePair[]): StrategyResult {
  // Same as trailing TP + skip senders with rug history (Faltify)
  // Also skip tokens where LP was likely thin (proxy: -90%+ losses)

  const rugSenders = ['faltify'];

  const results = pairs.map(p => {
    const senderLower = p.source.toLowerCase();
    const isBlacklisted = rugSenders.some(s => senderLower.includes(s));

    if (isBlacklisted) {
      return { symbol: p.symbol, pnl: 0, reason: 'blacklisted_sender (skipped)' };
    }

    const pct = p.pnlPct;

    if (pct <= -90) {
      // Would have been caught by liquidity filter in real implementation
      // Assume we skip 50% of rugs with the LP check
      return { symbol: p.symbol, pnl: p.realizedPnl * 0.5, reason: 'partial_rug_filter' };
    }

    if (p.exitReason === 'sl' || pct <= -30) {
      return { symbol: p.symbol, pnl: p.realizedPnl, reason: 'sl' };
    }

    if (p.exitReason === 'tp' || pct >= 50) {
      const firstHalfPnl = 50 * 0.5;
      const secondHalfPct = Math.max(pct * 0.7, 35);
      const secondHalfPnl = (secondHalfPct / 100) * 50;
      return {
        symbol: p.symbol,
        pnl: firstHalfPnl + secondHalfPnl,
        reason: `trailing_tp (peak ~${pct.toFixed(0)}%)`,
      };
    }

    if (p.holdMinutes > 240 && Math.abs(pct) < 15) {
      return { symbol: p.symbol, pnl: 0, reason: 'timeout_4hr' };
    }

    return { symbol: p.symbol, pnl: p.realizedPnl, reason: `hold (${pct.toFixed(1)}%)` };
  });

  return {
    name: 'Full: Trailing TP + 4hr timeout + sender blacklist + rug filter',
    totalPnl: results.reduce((s, r) => s + r.pnl, 0),
    tradeResults: results,
    wins: results.filter(r => r.pnl > 0).length,
    losses: results.filter(r => r.pnl < 0).length,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching all trades...');
  const trades = await fetchAllTrades();
  console.log(`Total trades: ${trades.length}`);

  // Filter out initial manual trades (WETH, cbBTC, VIRTUAL etc)
  const sniperTrades = trades.filter(t =>
    t.note?.includes('TG sniper') ||
    t.note?.includes('Auto TP') ||
    t.note?.includes('Auto SL') ||
    t.note?.includes('Closing all')
  );
  console.log(`Sniper-related trades: ${sniperTrades.length}`);

  const pairs = pairTrades(sniperTrades);
  console.log(`Matched trade pairs: ${pairs.length}\n`);

  // ── Trade Pair Summary ────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRADE-BY-TRADE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════');

  // Sort by PnL for readability
  const sorted = [...pairs].sort((a, b) => b.realizedPnl - a.realizedPnl);

  console.log(`\n${'Symbol'.padEnd(20)} ${'PnL%'.padStart(8)} ${'PnL$'.padStart(10)} ${'Hold'.padStart(8)} ${'Exit'.padStart(8)} Source`);
  console.log('─'.repeat(90));

  for (const p of sorted) {
    const holdStr = p.holdMinutes < 60
      ? `${p.holdMinutes.toFixed(0)}m`
      : `${(p.holdMinutes / 60).toFixed(1)}h`;
    console.log(
      `${p.symbol.padEnd(20)} ${p.pnlPct.toFixed(1).padStart(7)}% ${('$' + p.realizedPnl.toFixed(2)).padStart(10)} ${holdStr.padStart(8)} ${p.exitReason.padStart(8)} ${p.source.slice(0, 35)}`
    );
  }

  // ── Strategy Comparison ───────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('STRATEGY BACKTEST COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const strategies = [
    currentStrategy(pairs),
    trailingTpStrategy(pairs),
    blacklistStrategy(pairs),
  ];

  for (const s of strategies) {
    const winRate = s.tradeResults.length > 0
      ? ((s.wins / s.tradeResults.length) * 100).toFixed(1)
      : '0.0';
    const avgWin = s.wins > 0
      ? s.tradeResults.filter(r => r.pnl > 0).reduce((a, r) => a + r.pnl, 0) / s.wins
      : 0;
    const avgLoss = s.losses > 0
      ? s.tradeResults.filter(r => r.pnl < 0).reduce((a, r) => a + r.pnl, 0) / s.losses
      : 0;

    console.log(`Strategy: ${s.name}`);
    console.log(`  Total P&L:    $${s.totalPnl.toFixed(2)}`);
    console.log(`  Win Rate:     ${winRate}% (${s.wins}W / ${s.losses}L / ${s.tradeResults.length - s.wins - s.losses}BE)`);
    console.log(`  Avg Win:      $${avgWin.toFixed(2)}`);
    console.log(`  Avg Loss:     $${avgLoss.toFixed(2)}`);
    console.log(`  Return on 10k: ${(s.totalPnl / 100).toFixed(2)}%`);
    console.log('');

    // Show individual results for non-current strategies
    if (s.name !== strategies[0].name) {
      console.log('  Trade details:');
      for (const r of s.tradeResults.sort((a, b) => b.pnl - a.pnl)) {
        const marker = r.pnl > 0 ? '✓' : r.pnl < 0 ? '✗' : '○';
        console.log(`    ${marker} ${r.symbol.padEnd(20)} $${r.pnl.toFixed(2).padStart(8)}  ${r.reason}`);
      }
      console.log('');
    }
  }

  // ── Delta Analysis ────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('IMPROVEMENT DELTA (New Strategy vs Current)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const current = strategies[0];
  const best = strategies[2];

  for (let i = 0; i < pairs.length; i++) {
    const diff = best.tradeResults[i].pnl - current.tradeResults[i].pnl;
    if (Math.abs(diff) > 1) {
      const arrow = diff > 0 ? '↑' : '↓';
      console.log(
        `  ${arrow} ${pairs[i].symbol.padEnd(20)} ${('$' + current.tradeResults[i].pnl.toFixed(2)).padStart(10)} → ${('$' + best.tradeResults[i].pnl.toFixed(2)).padStart(10)}  (${diff > 0 ? '+' : ''}$${diff.toFixed(2)})  ${best.tradeResults[i].reason}`
      );
    }
  }

  const totalDelta = best.totalPnl - current.totalPnl;
  console.log(`\n  Net improvement: ${totalDelta > 0 ? '+' : ''}$${totalDelta.toFixed(2)}`);
  console.log(`  Current → New:   $${current.totalPnl.toFixed(2)} → $${best.totalPnl.toFixed(2)}`);
}

main().catch(console.error);
