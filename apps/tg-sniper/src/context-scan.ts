import 'dotenv/config';
import fs from 'fs';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

/**
 * Context scanner — for tokens with OHLCV data, pull surrounding messages
 * to capture sentiment (reposts, "aped", "looks good", "rugged", etc.)
 *
 * For each token address in our OHLCV cache:
 *   1. Find original signal(s) from 30d data
 *   2. Pull messages from that chat around the signal time (±2 hours)
 *   3. Find ALL mentions of the address in those messages
 *   4. Capture follow-up messages that quote/reply to the signal
 *   5. Score sentiment based on keywords
 */

const SIGNALS_FILE = '/tmp/tg-sniper-30d-tradeable.json';
const CACHE_FILE = '/tmp/tg-sniper-ohlcv-cache.json';
const OUTPUT_FILE = '/tmp/tg-sniper-context-analysis.json';

const CONTRACT_RE = /0x[a-fA-F0-9]{40}/gi;

// Sentiment keywords
const BULLISH_WORDS = [
  'ape', 'aped', 'aping', 'bag', 'bagged', 'buy', 'bought', 'long', 'bullish',
  'moon', 'pump', 'send', 'sending', 'fire', 'gem', 'alpha', 'early',
  'good', 'great', 'nice', 'solid', 'love', 'insane', 'huge', 'letsgo',
  'x2', 'x3', 'x5', 'x10', 'x20', 'x50', 'x100', '100x', '10x', '50x',
  'chad', 'based', 'fomo', 'degen', 'lets go', "let's go", 'lfg',
  'yolo', 'filled', 'loaded', 'accumulating', 'acc',
];
const BEARISH_WORDS = [
  'rug', 'rugged', 'scam', 'dump', 'dumped', 'dumping', 'sell', 'sold', 'short',
  'dead', 'rekt', 'rip', 'trash', 'shit', 'crap', 'avoid', 'skip', 'pass',
  'honeypot', 'honey', 'drain', 'drained', 'fake', 'bot', 'bots',
  'rugpull', 'slow rug', 'dev sold', 'dev dump', 'caution', 'careful',
  'exit', 'exited', 'out', 'got out', 'taking profit', 'tp',
];
const CAUTION_WORDS = [
  'careful', 'caution', 'dyor', 'nfa', 'risky', 'risk', 'sus', 'suspicious',
  'low liq', 'no liq', 'locked', 'unlocked', 'renounced', 'not renounced',
];

interface Signal {
  addr: string; sender: string; chat: string; date: string;
  fdv: string | null; liq: number | null; chain: string | null; symbol: string | null;
}

interface CacheEntry {
  pool: string | null;
  symbol: string;
  candles: number[][];
  fetchedAt: string;
}

interface TokenContext {
  addr: string;
  symbol: string;
  signalDate: string;
  signalSender: string;
  signalChat: string;
  // Context messages
  totalMentions: number;        // how many messages mention this address
  uniqueMentioners: number;     // how many different people mentioned it
  replyCount: number;           // replies near the original signal
  // Sentiment
  bullishCount: number;
  bearishCount: number;
  cautionCount: number;
  sentimentScore: number;       // bullish - bearish
  // Key messages (with text)
  messages: {
    sender: string;
    text: string;
    date: string;
    containsAddr: boolean;
    sentiment: 'bullish' | 'bearish' | 'caution' | 'neutral';
    minutesAfterSignal: number;
  }[];
  // Aggregated
  hasBullishFollowUp: boolean;  // someone else said something positive
  hasBearishFollowUp: boolean;  // someone warned about it
  repostCount: number;          // address reposted by different people
}

const client = new TelegramClient(
  new StringSession(process.env.TELEGRAM_SESSION!),
  parseInt(process.env.TELEGRAM_API_ID!),
  process.env.TELEGRAM_API_HASH!,
  { connectionRetries: 5 }
);

let interrupted = false;
process.on('SIGINT', () => { interrupted = true; console.log('\n\nInterrupted — saving...'); });
process.on('SIGTERM', () => { interrupted = true; });

function scoreSentiment(text: string): { bull: number; bear: number; caut: number; label: 'bullish' | 'bearish' | 'caution' | 'neutral' } {
  const lower = text.toLowerCase();
  let bull = 0, bear = 0, caut = 0;
  for (const w of BULLISH_WORDS) if (lower.includes(w)) bull++;
  for (const w of BEARISH_WORDS) if (lower.includes(w)) bear++;
  for (const w of CAUTION_WORDS) if (lower.includes(w)) caut++;

  // Emoji sentiment
  if (/[🚀🔥💎🟢⬆️📈✅]/.test(text)) bull++;
  if (/[💀☠️🔴⬇️📉❌🚨⚠️]/.test(text)) bear++;

  const label = bull > bear ? 'bullish' : bear > bull ? 'bearish' : caut > 0 ? 'caution' : 'neutral';
  return { bull, bear, caut, label };
}

async function main() {
  // Load data
  const signals: Signal[] = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
  const cache: Record<string, CacheEntry> = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

  // Get tokens with candle data — group by first signal per (addr, chat)
  const tokenSignals = new Map<string, Signal>();
  for (const s of signals) {
    const entry = cache[s.addr] || cache[s.addr.toLowerCase()];
    if (!entry || entry.candles.length === 0) continue;
    const key = s.addr + '|' + s.chat;
    if (!tokenSignals.has(key)) tokenSignals.set(key, s);
  }

  console.log(`Tokens with OHLCV to scan context for: ${tokenSignals.size} (addr+chat combos)`);

  // Group by chat
  const byChat = new Map<string, Signal[]>();
  for (const [, sig] of tokenSignals) {
    const list = byChat.get(sig.chat) || [];
    list.push(sig);
    byChat.set(sig.chat, list);
  }
  for (const [chat, sigs] of byChat) {
    console.log(`  ${chat}: ${sigs.length} tokens`);
  }

  await client.connect();
  console.log('Connected to Telegram.\n');

  // Resolve chat IDs
  const dialogs = await client.getDialogs({ limit: 200 });
  const chatMap = new Map<string, bigint>();
  for (const d of dialogs) {
    const title = d.title || '';
    if (d.id) chatMap.set(title, BigInt(d.id.toString()));
  }

  const results: TokenContext[] = [];
  const senderCache = new Map<string, string>();
  let total = 0;

  for (const [chatTitle, tokenSigs] of byChat) {
    if (interrupted) break;

    // Find chat ID
    let chatId: bigint | undefined;
    for (const [title, id] of chatMap) {
      if (title.toLowerCase().includes(chatTitle.toLowerCase().slice(0, 15))) {
        chatId = id;
        break;
      }
    }
    if (!chatId) {
      console.log(`  ⚠ Could not resolve chat: ${chatTitle}`);
      continue;
    }

    console.log(`\nScanning ${chatTitle} (${tokenSigs.length} tokens)...`);

    // Sort signals by date so we scan chronologically
    tokenSigs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (let ti = 0; ti < tokenSigs.length && !interrupted; ti++) {
      const sig = tokenSigs[ti];
      total++;
      const sigTs = Math.floor(new Date(sig.date).getTime() / 1000);
      const entry = cache[sig.addr] || cache[sig.addr.toLowerCase()];

      process.stdout.write(`\r  [${ti + 1}/${tokenSigs.length}] ${entry?.symbol || sig.addr.slice(0, 12)}  `);

      // Pull messages from 30min before to 2h after the signal
      const windowBefore = 30 * 60;  // 30 min before
      const windowAfter = 2 * 60 * 60; // 2h after

      const contextMessages: TokenContext['messages'] = [];
      let totalMentions = 0;
      const mentioners = new Set<string>();
      let bullishCount = 0, bearishCount = 0, cautionCount = 0;
      let repostCount = 0;

      try {
        // Search for messages around the signal time
        // We'll get messages near that timestamp using offsetDate
        const msgs = await client.getMessages(chatId, {
          limit: 100,
          offsetDate: sigTs + windowAfter,
        });

        for (const msg of msgs) {
          if (msg.date < sigTs - windowBefore) break; // too old
          if (msg.date > sigTs + windowAfter) continue; // too new

          const text = msg.text || msg.message || '';
          if (!text || text.length < 3) continue;

          // Get sender
          const senderId = msg.senderId?.toString() || 'unknown';
          let senderName = senderCache.get(senderId) || '';
          if (!senderName) {
            try {
              const sender = await msg.getSender();
              if (sender) {
                if ('firstName' in sender) senderName = (sender as any).firstName || '';
                if (!senderName && 'username' in sender) senderName = (sender as any).username || '';
                if (!senderName && 'title' in sender) senderName = (sender as any).title || '';
              }
            } catch {}
            senderName = senderName || 'unknown';
            senderCache.set(senderId, senderName);
          }

          const containsAddr = text.toLowerCase().includes(sig.addr.toLowerCase());
          const minutesAfter = (msg.date - sigTs) / 60;
          const sent = scoreSentiment(text);

          if (containsAddr) {
            totalMentions++;
            mentioners.add(senderName);
            if (senderName !== sig.sender) repostCount++;
          }

          bullishCount += sent.bull;
          bearishCount += sent.bear;
          cautionCount += sent.caut;

          // Only store messages that are relevant (mention the addr, or are sentiment-heavy, or are replies near signal)
          const isRelevant = containsAddr || sent.bull > 0 || sent.bear > 0 || sent.caut > 0 ||
            (minutesAfter >= 0 && minutesAfter <= 30); // first 30 min after signal

          if (isRelevant) {
            contextMessages.push({
              sender: senderName,
              text: text.slice(0, 500),
              date: new Date(msg.date * 1000).toISOString(),
              containsAddr,
              sentiment: sent.label,
              minutesAfterSignal: Math.round(minutesAfter),
            });
          }
        }
      } catch (err) {
        process.stdout.write('[err]');
      }

      const followUpBullish = contextMessages.some(m => m.sentiment === 'bullish' && m.sender !== sig.sender && m.minutesAfterSignal > 0);
      const followUpBearish = contextMessages.some(m => m.sentiment === 'bearish' && m.sender !== sig.sender && m.minutesAfterSignal > 0);

      results.push({
        addr: sig.addr,
        symbol: entry?.symbol || '?',
        signalDate: sig.date,
        signalSender: sig.sender,
        signalChat: chatTitle,
        totalMentions,
        uniqueMentioners: mentioners.size,
        replyCount: contextMessages.filter(m => m.minutesAfterSignal > 0 && m.minutesAfterSignal <= 30).length,
        bullishCount,
        bearishCount,
        cautionCount,
        sentimentScore: bullishCount - bearishCount,
        messages: contextMessages.sort((a, b) => a.minutesAfterSignal - b.minutesAfterSignal),
        hasBullishFollowUp: followUpBullish,
        hasBearishFollowUp: followUpBearish,
        repostCount,
      });

      // Rate limit — Telegram flood wait protection
      await new Promise(r => setTimeout(r, 1500));

      // Save every 25 tokens
      if (total % 25 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
        process.stdout.write(`\n  [saved ${results.length} contexts]\n`);
      }
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n\nDone — ${results.length} token contexts saved to ${OUTPUT_FILE}`);

  // ── Quick analysis ──
  console.log('\n' + '='.repeat(60));
  console.log('  CONTEXT SENTIMENT ANALYSIS');
  console.log('='.repeat(60));

  // Load backtest results to correlate
  const backtestFile = '/tmp/tg-sniper-30d-backtest-ohlcv.json';
  let backtestResults: any[] = [];
  try { backtestResults = JSON.parse(fs.readFileSync(backtestFile, 'utf8')); } catch {}

  const btMap = new Map<string, any>();
  for (const r of backtestResults) btMap.set(r.addr, r);

  // Correlate sentiment with performance
  const withPerf = results.map(ctx => {
    const bt = btMap.get(ctx.addr);
    return { ...ctx, pnl: bt?.pnlUsdc || -30, win: bt ? bt.pnlUsdc > 0 : false, exitReason: bt?.exitReason || 'NO_DATA' };
  });

  const $ = (n: number) => n.toFixed(2);
  const wr = (arr: any[]) => arr.length ? (arr.filter(r => r.win).length / arr.length * 100).toFixed(1) + '%' : 'n/a';
  const avgPnl = (arr: any[]) => arr.length ? arr.reduce((s: number, r: any) => s + r.pnl, 0) / arr.length : 0;

  // By sentiment score
  console.log('\n-- Sentiment Score vs Performance --');
  for (const [label, min, max] of [['Very bearish (<-2)', -Infinity, -2], ['Bearish (-2 to -1)', -2, 0], ['Neutral (0)', 0, 0], ['Bullish (1-2)', 1, 2], ['Very bullish (>2)', 3, Infinity]] as [string, number, number][]) {
    const g = withPerf.filter(r => r.sentimentScore >= min && r.sentimentScore <= max);
    if (!g.length) continue;
    console.log(`  ${label}: ${g.length} tokens, WR: ${wr(g)}, avg P&L: $${$(avgPnl(g))}`);
  }

  // Has bullish follow-up
  console.log('\n-- Bullish Follow-up (someone else was positive) --');
  const hasBull = withPerf.filter(r => r.hasBullishFollowUp);
  const noBull = withPerf.filter(r => !r.hasBullishFollowUp);
  console.log(`  Has bullish follow-up: ${hasBull.length} tokens, WR: ${wr(hasBull)}, avg: $${$(avgPnl(hasBull))}`);
  console.log(`  No bullish follow-up: ${noBull.length} tokens, WR: ${wr(noBull)}, avg: $${$(avgPnl(noBull))}`);

  // Has bearish follow-up
  console.log('\n-- Bearish Follow-up (someone warned) --');
  const hasBear = withPerf.filter(r => r.hasBearishFollowUp);
  const noBear = withPerf.filter(r => !r.hasBearishFollowUp);
  console.log(`  Has bearish warning: ${hasBear.length} tokens, WR: ${wr(hasBear)}, avg: $${$(avgPnl(hasBear))}`);
  console.log(`  No bearish warning: ${noBear.length} tokens, WR: ${wr(noBear)}, avg: $${$(avgPnl(noBear))}`);

  // Repost count
  console.log('\n-- Repost Count (others re-shared the address) --');
  for (const [label, min, max] of [['0 reposts', 0, 0], ['1 repost', 1, 1], ['2+ reposts', 2, Infinity]] as [string, number, number][]) {
    const g = withPerf.filter(r => r.repostCount >= min && r.repostCount <= max);
    if (!g.length) continue;
    console.log(`  ${label}: ${g.length} tokens, WR: ${wr(g)}, avg: $${$(avgPnl(g))}`);
  }

  // Reply activity (messages within 30min)
  console.log('\n-- Reply Activity (messages within 30min of signal) --');
  for (const [label, min, max] of [['0 replies', 0, 0], ['1-3 replies', 1, 3], ['4-10 replies', 4, 10], ['10+ replies', 10, Infinity]] as [string, number, number][]) {
    const g = withPerf.filter(r => r.replyCount >= min && r.replyCount <= max);
    if (!g.length) continue;
    console.log(`  ${label}: ${g.length} tokens, WR: ${wr(g)}, avg: $${$(avgPnl(g))}`);
  }

  await client.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
