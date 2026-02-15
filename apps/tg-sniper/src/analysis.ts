import 'dotenv/config';

const API = 'https://fomolt.com/api/v1';
const KEY = process.env.FOMOLT_API_KEY!;
const headers = { Authorization: `Bearer ${KEY}` };

interface Trade {
  id: string; contractAddress: string; symbol: string; side: 'buy' | 'sell';
  quantity: string; price: string; totalUsdc: string; realizedPnl: string | null;
  note: string | null; createdAt: string;
}

async function fetchAll(): Promise<Trade[]> {
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

interface Pair {
  symbol: string; buyTime: Date; sellTime: Date; entryPrice: number;
  exitPrice: number; pnlPct: number; realizedPnl: number; holdMinutes: number;
  exitReason: string; source: string; sender: string; chat: string; hour: number;
}

async function main() {
  const trades = await fetchAll();
  const sniper = trades.filter(t =>
    t.note?.includes('TG sniper') || t.note?.includes('Auto TP') ||
    t.note?.includes('Auto SL') || t.note?.includes('Closing all')
  );

  // Pair trades
  const buys = new Map<string, Trade[]>();
  for (const t of sniper) {
    if (t.side === 'buy') {
      const k = t.contractAddress.toLowerCase();
      if (!buys.has(k)) buys.set(k, []);
      buys.get(k)!.push(t);
    }
  }

  const pairs: Pair[] = [];
  for (const t of sniper) {
    if (t.side !== 'sell') continue;
    const k = t.contractAddress.toLowerCase();
    const bl = buys.get(k);
    if (!bl || !bl.length) continue;
    const buy = bl.shift()!;
    const ep = parseFloat(buy.price), xp = parseFloat(t.price);
    const pnlPct = ep > 0 ? ((xp - ep) / ep) * 100 : -100;
    const bt = new Date(buy.createdAt), st = new Date(t.createdAt);
    const hm = (st.getTime() - bt.getTime()) / 60000;
    let exitR = 'manual';
    if (t.note?.includes('Auto TP')) exitR = 'tp';
    else if (t.note?.includes('Auto SL')) exitR = 'sl';
    let source = '', sender = '', chat = '';
    const m = buy.note?.match(/TG sniper: (.+)/);
    if (m) {
      source = m[1].replace(/&amp;/g, '&');
      const parts = source.split(' | ');
      chat = parts[0] || '';
      sender = parts[1] || '';
    }
    pairs.push({
      symbol: t.symbol, buyTime: bt, sellTime: st, entryPrice: ep, exitPrice: xp,
      pnlPct, realizedPnl: parseFloat(t.realizedPnl || '0'), holdMinutes: hm,
      exitReason: exitR, source, sender, chat, hour: bt.getUTCHours(),
    });
  }

  // ═══ SENDER ANALYSIS ═══
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SENDER PERFORMANCE RANKING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const senderStats = new Map<string, { trades: number; pnl: number; wins: number; losses: number; pnls: number[] }>();
  for (const p of pairs) {
    if (!p.sender) continue;
    if (!senderStats.has(p.sender)) senderStats.set(p.sender, { trades: 0, pnl: 0, wins: 0, losses: 0, pnls: [] });
    const s = senderStats.get(p.sender)!;
    s.trades++;
    s.pnl += p.realizedPnl;
    s.pnls.push(p.realizedPnl);
    if (p.realizedPnl > 0) s.wins++;
    if (p.realizedPnl < 0) s.losses++;
  }

  const senderArr = [...senderStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  console.log(`${'Sender'.padEnd(20)} ${'Trades'.padStart(6)} ${'W/L'.padStart(8)} ${'WinRate'.padStart(8)} ${'Total PnL'.padStart(12)} ${'Avg PnL'.padStart(10)} ${'Best'.padStart(10)} ${'Worst'.padStart(10)}`);
  console.log('─'.repeat(95));
  for (const [name, s] of senderArr) {
    const wr = ((s.wins / s.trades) * 100).toFixed(0);
    const avg = (s.pnl / s.trades).toFixed(2);
    const best = Math.max(...s.pnls).toFixed(2);
    const worst = Math.min(...s.pnls).toFixed(2);
    console.log(`${name.padEnd(20)} ${String(s.trades).padStart(6)} ${(s.wins+'W/'+s.losses+'L').padStart(8)} ${(wr+'%').padStart(8)} ${'$'+s.pnl.toFixed(2).padStart(11)} ${'$'+avg.padStart(9)} ${'$'+best.padStart(9)} ${'$'+worst.padStart(9)}`);
  }

  // ═══ CHAT ANALYSIS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CHAT PERFORMANCE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const chatStats = new Map<string, { trades: number; pnl: number; wins: number; losses: number }>();
  for (const p of pairs) {
    if (!p.chat) continue;
    if (!chatStats.has(p.chat)) chatStats.set(p.chat, { trades: 0, pnl: 0, wins: 0, losses: 0 });
    const s = chatStats.get(p.chat)!;
    s.trades++;
    s.pnl += p.realizedPnl;
    if (p.realizedPnl > 0) s.wins++;
    if (p.realizedPnl < 0) s.losses++;
  }
  for (const [name, s] of chatStats) {
    const wr = ((s.wins / s.trades) * 100).toFixed(0);
    console.log(`${name}: ${s.trades} trades, $${s.pnl.toFixed(2)} P&L, ${wr}% win rate (${s.wins}W/${s.losses}L)`);
  }

  // ═══ TIMING ANALYSIS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('HOLD TIME vs OUTCOME');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const buckets = [
    { label: '0-5 min', min: 0, max: 5 },
    { label: '5-15 min', min: 5, max: 15 },
    { label: '15-60 min', min: 15, max: 60 },
    { label: '1-2 hr', min: 60, max: 120 },
    { label: '2-4 hr', min: 120, max: 240 },
    { label: '4-6 hr', min: 240, max: 360 },
    { label: '6+ hr', min: 360, max: 9999 },
  ];
  for (const b of buckets) {
    const inBucket = pairs.filter(p => p.holdMinutes >= b.min && p.holdMinutes < b.max);
    if (inBucket.length === 0) continue;
    const pnl = inBucket.reduce((s, p) => s + p.realizedPnl, 0);
    const wins = inBucket.filter(p => p.realizedPnl > 0).length;
    const wr = ((wins / inBucket.length) * 100).toFixed(0);
    console.log(`${b.label.padEnd(12)} ${String(inBucket.length).padStart(3)} trades  $${pnl.toFixed(2).padStart(10)}  ${wr}% win rate  avg $${(pnl/inBucket.length).toFixed(2)}`);
  }

  // ═══ EXIT REASON ANALYSIS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('EXIT REASON BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const exits = new Map<string, { count: number; pnl: number }>();
  for (const p of pairs) {
    if (!exits.has(p.exitReason)) exits.set(p.exitReason, { count: 0, pnl: 0 });
    const e = exits.get(p.exitReason)!;
    e.count++;
    e.pnl += p.realizedPnl;
  }
  for (const [reason, e] of exits) {
    console.log(`${reason.padEnd(10)} ${String(e.count).padStart(3)} trades  $${e.pnl.toFixed(2).padStart(10)}  avg $${(e.pnl/e.count).toFixed(2)}`);
  }

  // ═══ HOUR OF DAY ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TIME OF DAY (UTC) — BUY HOUR vs P&L');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const hourStats = new Map<number, { count: number; pnl: number; wins: number }>();
  for (const p of pairs) {
    if (!hourStats.has(p.hour)) hourStats.set(p.hour, { count: 0, pnl: 0, wins: 0 });
    const h = hourStats.get(p.hour)!;
    h.count++;
    h.pnl += p.realizedPnl;
    if (p.realizedPnl > 0) h.wins++;
  }
  for (const [hour, h] of [...hourStats.entries()].sort((a, b) => a[0] - b[0])) {
    const bar = h.pnl > 0 ? '█'.repeat(Math.min(Math.floor(h.pnl / 5), 30)) : '░'.repeat(Math.min(Math.floor(Math.abs(h.pnl) / 5), 30));
    const wr = ((h.wins / h.count) * 100).toFixed(0);
    console.log(`${String(hour).padStart(2)}:00 UTC  ${String(h.count).padStart(3)} trades  $${h.pnl.toFixed(2).padStart(10)}  ${wr}% wr  ${bar}`);
  }

  // ═══ TP HITS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TP HITS: HOW FAST DO WINNERS PUMP?');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const tpTrades = pairs.filter(p => p.exitReason === 'tp');
  for (const p of tpTrades.sort((a, b) => a.holdMinutes - b.holdMinutes)) {
    console.log(`${p.symbol.padEnd(20)} +${p.pnlPct.toFixed(0)}% in ${p.holdMinutes < 60 ? p.holdMinutes.toFixed(0)+'min' : (p.holdMinutes/60).toFixed(1)+'hr'}  (from ${p.sender})`);
  }

  // ═══ SL HITS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SL HITS: HOW FAST DO LOSERS DUMP?');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const slTrades = pairs.filter(p => p.exitReason === 'sl');
  for (const p of slTrades.sort((a, b) => a.holdMinutes - b.holdMinutes)) {
    console.log(`${p.symbol.padEnd(20)} ${p.pnlPct.toFixed(0)}% in ${p.holdMinutes < 60 ? p.holdMinutes.toFixed(0)+'min' : (p.holdMinutes/60).toFixed(1)+'hr'}  (from ${p.sender})`);
  }

  // ═══ RICK DEEP DIVE ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('RICK DEEP DIVE (biggest sample)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const rickTrades = pairs.filter(p => p.sender === 'Rick').sort((a, b) => b.realizedPnl - a.realizedPnl);
  let rickRunning = 0;
  for (const p of rickTrades) {
    rickRunning += p.realizedPnl;
    const holdStr = p.holdMinutes < 60 ? p.holdMinutes.toFixed(0)+'m' : (p.holdMinutes/60).toFixed(1)+'h';
    console.log(`${p.symbol.padEnd(18)} $${p.realizedPnl.toFixed(2).padStart(10)}  ${p.pnlPct.toFixed(1).padStart(7)}%  ${holdStr.padStart(6)}  ${p.exitReason.padStart(6)}  running: $${rickRunning.toFixed(2)}`);
  }
  console.log(`\nRick total: $${rickTrades.reduce((s,p) => s+p.realizedPnl, 0).toFixed(2)} | ${rickTrades.filter(p=>p.realizedPnl>0).length}W / ${rickTrades.filter(p=>p.realizedPnl<0).length}L`);

  // ═══ "REPEATED ACROSS CHATS" ANALYSIS ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CROSS-CHAT SIGNALS (same token mentioned in multiple chats)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check if tokens that appeared in multiple chats performed better
  const tokenChats = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.chat) continue;
    const sym = p.symbol.toLowerCase();
    if (!tokenChats.has(sym)) tokenChats.set(sym, new Set());
    tokenChats.get(sym)!.add(p.chat);
  }

  const multiChat = pairs.filter(p => (tokenChats.get(p.symbol.toLowerCase())?.size || 0) > 1);
  const singleChat = pairs.filter(p => (tokenChats.get(p.symbol.toLowerCase())?.size || 0) === 1);

  if (multiChat.length > 0) {
    const mcPnl = multiChat.reduce((s, p) => s + p.realizedPnl, 0);
    const mcWins = multiChat.filter(p => p.realizedPnl > 0).length;
    console.log(`Multi-chat tokens: ${multiChat.length} trades, $${mcPnl.toFixed(2)} P&L, ${((mcWins/multiChat.length)*100).toFixed(0)}% wr`);
    for (const p of multiChat) console.log(`  ${p.symbol.padEnd(18)} $${p.realizedPnl.toFixed(2).padStart(8)}  ${p.chat}`);
  }

  const scPnl = singleChat.reduce((s, p) => s + p.realizedPnl, 0);
  const scWins = singleChat.filter(p => p.realizedPnl > 0).length;
  console.log(`\nSingle-chat tokens: ${singleChat.length} trades, $${scPnl.toFixed(2)} P&L, ${((scWins/singleChat.length)*100).toFixed(0)}% wr`);
}

main().catch(console.error);
