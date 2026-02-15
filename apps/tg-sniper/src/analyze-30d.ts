import 'dotenv/config';
import fs from 'fs';

/**
 * Analyze 30 days of Telegram signals from the deep scan.
 * Does NOT call external APIs — pure local analysis of the JSON.
 *
 * Outputs:
 *   - Signal volume by day and chat
 *   - Human vs bot signal split
 *   - Top senders by signal count
 *   - Quality filter simulation (what would pass our filters)
 *   - First-mention dedup simulation
 *   - Rick bot enrichment coverage
 */

const INPUT = '/tmp/tg-sniper-30d-signals.json';

interface Signal {
  chat: string;
  sender: string;
  isBot: boolean;
  addr: string;
  date: string;
  liq: number | null;
  fdv: string | null;
  chain: string | null;
  symbol: string | null;
}

// ── Quality Filters (same logic as telegram.ts) ──────────────────────────

const BLACKLISTED_SENDERS = ['faltify'];

function parseMetricValue(raw: string): number {
  const cleaned = raw.replace(/[,$]/g, '').trim();
  if (cleaned === '0') return 0;
  const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const match = cleaned.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (match[2] ? multipliers[match[2].toUpperCase()] || 1 : 1);
}

function simulateFilters(sig: Signal): { pass: boolean; reason?: string } {
  // Blacklist
  if (BLACKLISTED_SENDERS.some(b => sig.sender.toLowerCase().includes(b))) {
    return { pass: false, reason: 'blacklisted_sender' };
  }

  // Bot messages with quality data
  if (sig.isBot) {
    // Chain filter
    if (sig.chain && sig.chain.toLowerCase() !== 'base') {
      return { pass: false, reason: `non-base-chain:${sig.chain}` };
    }
    // Liquidity filter
    if (sig.liq !== null && sig.liq === 0) {
      return { pass: false, reason: 'zero-liquidity' };
    }
    if (sig.liq !== null && sig.liq < 1000) {
      return { pass: false, reason: `low-liquidity:$${sig.liq}` };
    }
  }

  return { pass: true };
}

// ── Main Analysis ────────────────────────────────────────────────────────

function main() {
  const raw: Signal[] = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  console.log(`\nLoaded ${raw.length} signals from ${INPUT}\n`);

  // ── 1. Basic Stats ─────────────────────────────────────────────────────
  const uniqueAddrs = new Set(raw.map(s => s.addr));
  const humanSignals = raw.filter(s => !s.isBot);
  const botSignals = raw.filter(s => s.isBot);
  const humanAddrs = new Set(humanSignals.map(s => s.addr));
  const botAddrs = new Set(botSignals.map(s => s.addr));

  console.log('═══ OVERVIEW ═══');
  console.log(`Total signals: ${raw.length}`);
  console.log(`Unique addresses: ${uniqueAddrs.size}`);
  console.log(`Human signals: ${humanSignals.length} (${(humanSignals.length/raw.length*100).toFixed(0)}%)`);
  console.log(`Bot signals: ${botSignals.length} (${(botSignals.length/raw.length*100).toFixed(0)}%)`);
  console.log(`Human unique addrs: ${humanAddrs.size}`);
  console.log(`Bot unique addrs: ${botAddrs.size}`);

  // ── 2. Signals by Chat ─────────────────────────────────────────────────
  console.log('\n═══ SIGNALS BY CHAT ═══');
  const chatStats = new Map<string, { total: number; human: number; bot: number; uniqueAddrs: Set<string> }>();
  for (const s of raw) {
    const cs = chatStats.get(s.chat) || { total: 0, human: 0, bot: 0, uniqueAddrs: new Set<string>() };
    cs.total++;
    s.isBot ? cs.bot++ : cs.human++;
    cs.uniqueAddrs.add(s.addr);
    chatStats.set(s.chat, cs);
  }
  for (const [chat, stats] of chatStats) {
    console.log(`  ${chat}: ${stats.total} signals (${stats.human} human, ${stats.bot} bot) | ${stats.uniqueAddrs.size} unique addrs`);
  }

  // ── 3. Signals by Day ─────────────────────────────────────────────────
  console.log('\n═══ SIGNALS BY DAY (human-only) ═══');
  const dayStats = new Map<string, { total: number; uniqueAddrs: Set<string>; chats: Map<string, number> }>();
  for (const s of humanSignals) {
    const day = s.date.slice(0, 10);
    const ds = dayStats.get(day) || { total: 0, uniqueAddrs: new Set<string>(), chats: new Map<string, number>() };
    ds.total++;
    ds.uniqueAddrs.add(s.addr);
    ds.chats.set(s.chat, (ds.chats.get(s.chat) || 0) + 1);
    dayStats.set(day, ds);
  }
  const sortedDays = [...dayStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [day, stats] of sortedDays) {
    const chatBreak = [...stats.chats.entries()].map(([c, n]) => `${c.slice(0, 12)}:${n}`).join(', ');
    console.log(`  ${day}: ${stats.total} signals, ${stats.uniqueAddrs.size} unique addrs | ${chatBreak}`);
  }

  // ── 4. Top Human Senders ───────────────────────────────────────────────
  console.log('\n═══ TOP 30 HUMAN SENDERS (by signal count) ═══');
  const senderStats = new Map<string, { count: number; addrs: Set<string>; chats: Set<string> }>();
  for (const s of humanSignals) {
    const ss = senderStats.get(s.sender) || { count: 0, addrs: new Set<string>(), chats: new Set<string>() };
    ss.count++;
    ss.addrs.add(s.addr);
    ss.chats.add(s.chat);
    senderStats.set(s.sender, ss);
  }
  const topSenders = [...senderStats.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30);
  for (const [sender, stats] of topSenders) {
    console.log(`  ${sender}: ${stats.count} signals, ${stats.addrs.size} unique addrs | chats: ${[...stats.chats].join(', ')}`);
  }

  // ── 5. First-Mention Dedup Simulation ──────────────────────────────────
  console.log('\n═══ FIRST-MENTION DEDUP SIMULATION ═══');
  console.log('(How many signals would pass if we only trade the FIRST human mention of each address)');
  const firstMentionSeen = new Set<string>();
  let firstMentionCount = 0;
  const firstMentionByChat = new Map<string, number>();
  const firstMentionBySender = new Map<string, number>();

  // Sort by date first to simulate chronological order
  const chronoHuman = [...humanSignals].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const s of chronoHuman) {
    if (firstMentionSeen.has(s.addr)) continue;
    firstMentionSeen.add(s.addr);
    firstMentionCount++;
    firstMentionByChat.set(s.chat, (firstMentionByChat.get(s.chat) || 0) + 1);
    firstMentionBySender.set(s.sender, (firstMentionBySender.get(s.sender) || 0) + 1);
  }
  console.log(`First-mention unique signals: ${firstMentionCount} out of ${humanSignals.length} (${(firstMentionCount/humanSignals.length*100).toFixed(1)}% pass rate)`);
  console.log('\nFirst-mentions by chat:');
  for (const [chat, count] of [...firstMentionByChat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${chat}: ${count}`);
  }
  console.log('\nTop 20 first-mention senders:');
  for (const [sender, count] of [...firstMentionBySender.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${sender}: ${count} first-mentions`);
  }

  // ── 6. Quality Filter Simulation ──────────────────────────────────────
  console.log('\n═══ QUALITY FILTER SIMULATION ═══');
  console.log('(Apply our filters to all first-mention signals)');

  // For quality filters, we need to match human signals with their corresponding Rick bot reply
  // Rick bot signals typically appear right after the human signal for the same address
  const botDataByAddr = new Map<string, Signal>();
  for (const s of botSignals) {
    if (!botDataByAddr.has(s.addr)) {
      botDataByAddr.set(s.addr, s);
    }
  }

  let passCount = 0;
  let filteredCount = 0;
  const filterReasons = new Map<string, number>();
  const passedSignals: { addr: string; sender: string; chat: string; date: string; fdv: string | null; liq: number | null; chain: string | null; symbol: string | null }[] = [];

  const firstMentionSeen2 = new Set<string>();
  for (const s of chronoHuman) {
    if (firstMentionSeen2.has(s.addr)) continue;
    firstMentionSeen2.add(s.addr);

    // Check blacklist
    if (BLACKLISTED_SENDERS.some(b => s.sender.toLowerCase().includes(b))) {
      filteredCount++;
      filterReasons.set('blacklisted_sender', (filterReasons.get('blacklisted_sender') || 0) + 1);
      continue;
    }

    // Check Rick bot data for this address
    const botData = botDataByAddr.get(s.addr);
    if (botData) {
      const result = simulateFilters(botData);
      if (!result.pass) {
        filteredCount++;
        filterReasons.set(result.reason!, (filterReasons.get(result.reason!) || 0) + 1);
        continue;
      }
    }

    passCount++;
    passedSignals.push({
      addr: s.addr,
      sender: s.sender,
      chat: s.chat,
      date: s.date,
      fdv: botData?.fdv || null,
      liq: botData?.liq || null,
      chain: botData?.chain || null,
      symbol: botData?.symbol || null,
    });
  }

  console.log(`Passed: ${passCount} | Filtered: ${filteredCount} | Total first-mentions: ${passCount + filteredCount}`);
  console.log('\nFilter reasons:');
  for (const [reason, count] of [...filterReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  // ── 7. Rick Bot Coverage ──────────────────────────────────────────────
  console.log('\n═══ RICK BOT ENRICHMENT COVERAGE ═══');
  const firstMentionAddrs = new Set<string>();
  for (const s of chronoHuman) {
    firstMentionAddrs.add(s.addr);
  }
  let withRickData = 0;
  let withFDV = 0;
  let withLiq = 0;
  let withChain = 0;
  for (const addr of firstMentionAddrs) {
    const bd = botDataByAddr.get(addr);
    if (bd) {
      withRickData++;
      if (bd.fdv) withFDV++;
      if (bd.liq !== null) withLiq++;
      if (bd.chain) withChain++;
    }
  }
  console.log(`Addresses with Rick bot data: ${withRickData}/${firstMentionAddrs.size} (${(withRickData/firstMentionAddrs.size*100).toFixed(0)}%)`);
  console.log(`  With FDV: ${withFDV}`);
  console.log(`  With Liquidity: ${withLiq}`);
  console.log(`  With Chain: ${withChain}`);

  // ── 8. Chain Distribution ─────────────────────────────────────────────
  console.log('\n═══ CHAIN DISTRIBUTION (from Rick bot data) ═══');
  const chainCounts = new Map<string, number>();
  for (const s of botSignals) {
    const chain = s.chain || 'unknown';
    chainCounts.set(chain, (chainCounts.get(chain) || 0) + 1);
  }
  for (const [chain, count] of [...chainCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${chain}: ${count} (${(count/botSignals.length*100).toFixed(1)}%)`);
  }

  // ── 9. FDV Distribution of Passed Signals ─────────────────────────────
  console.log('\n═══ FDV DISTRIBUTION (passed signals with FDV data) ═══');
  const fdvBuckets: Record<string, number> = {
    'Under $10K': 0,
    '$10K-$50K': 0,
    '$50K-$100K': 0,
    '$100K-$500K': 0,
    '$500K-$1M': 0,
    '$1M-$5M': 0,
    '$5M+': 0,
    'No FDV data': 0,
  };
  for (const sig of passedSignals) {
    if (!sig.fdv) { fdvBuckets['No FDV data']++; continue; }
    const val = parseMetricValue(sig.fdv);
    if (val < 10_000) fdvBuckets['Under $10K']++;
    else if (val < 50_000) fdvBuckets['$10K-$50K']++;
    else if (val < 100_000) fdvBuckets['$50K-$100K']++;
    else if (val < 500_000) fdvBuckets['$100K-$500K']++;
    else if (val < 1_000_000) fdvBuckets['$500K-$1M']++;
    else if (val < 5_000_000) fdvBuckets['$1M-$5M']++;
    else fdvBuckets['$5M+']++;
  }
  for (const [bucket, count] of Object.entries(fdvBuckets)) {
    if (count > 0) console.log(`  ${bucket}: ${count}`);
  }

  // ── 10. Trading Volume Estimate ────────────────────────────────────────
  console.log('\n═══ TRADING VOLUME ESTIMATE ═══');
  console.log(`If we traded every first-mention that passes filters at $100 USDC each:`);
  console.log(`  Total trades: ${passCount}`);
  console.log(`  Capital deployed: $${(passCount * 100).toLocaleString()}`);
  const tradesByDay = new Map<string, number>();
  for (const sig of passedSignals) {
    const day = sig.date.slice(0, 10);
    tradesByDay.set(day, (tradesByDay.get(day) || 0) + 1);
  }
  const tradeDays = [...tradesByDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const avgPerDay = passCount / tradeDays.length;
  const maxPerDay = Math.max(...tradeDays.map(([, n]) => n));
  const minPerDay = Math.min(...tradeDays.map(([, n]) => n));
  console.log(`  Avg trades/day: ${avgPerDay.toFixed(1)}`);
  console.log(`  Max trades/day: ${maxPerDay}`);
  console.log(`  Min trades/day: ${minPerDay}`);
  console.log(`  Active trading days: ${tradeDays.length}`);

  console.log('\nTrades per day:');
  for (const [day, count] of tradeDays) {
    const bar = '█'.repeat(Math.ceil(count / 5));
    console.log(`  ${day}: ${count.toString().padStart(3)} ${bar}`);
  }

  // ── 11. Save passed signals for backtest ──────────────────────────────
  const outFile = '/tmp/tg-sniper-30d-tradeable.json';
  fs.writeFileSync(outFile, JSON.stringify(passedSignals, null, 2));
  console.log(`\nSaved ${passedSignals.length} tradeable signals to ${outFile}`);
}

main();
