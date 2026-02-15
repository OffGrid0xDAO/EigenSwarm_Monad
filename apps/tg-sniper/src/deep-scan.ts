import 'dotenv/config';
import fs from 'fs';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const client = new TelegramClient(
  new StringSession(process.env.TELEGRAM_SESSION!),
  parseInt(process.env.TELEGRAM_API_ID!),
  process.env.TELEGRAM_API_HASH!,
  { connectionRetries: 5 }
);

const CONTRACT_RE = /0x[a-fA-F0-9]{40}/g;
const DAYS_BACK = 30;
const OUTPUT_FILE = '/tmp/tg-sniper-30d-signals.json';

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

function parseMetric(raw: string): number {
  const c = raw.replace(/[,$]/g, '').trim();
  if (c === '0') return 0;
  const m: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
  const match = c.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (match[2] ? m[match[2].toUpperCase()] || 1 : 1);
}

const allSignals: Signal[] = [];
let interrupted = false;

function saveAndExit() {
  interrupted = true;
  console.log('\n\nInterrupted — saving what we have...');
  saveResults();
  process.exit(0);
}

function saveResults() {
  allSignals.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allSignals, null, 2));

  const uniqueAddrs = new Set(allSignals.map(s => s.addr));
  const dates = allSignals.map(s => s.date.slice(0, 10));
  console.log(`\nSaved ${allSignals.length} signals to ${OUTPUT_FILE}`);
  console.log(`Unique addresses: ${uniqueAddrs.size}`);
  if (dates.length > 0) console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  const chatCounts = new Map<string, number>();
  for (const s of allSignals) chatCounts.set(s.chat, (chatCounts.get(s.chat) || 0) + 1);
  for (const [chat, count] of chatCounts) console.log(`  ${chat}: ${count} signals`);
}

function progressBar(current: number, total: number, width: number = 30): string {
  const pct = Math.min(current / total, 1);
  const filled = Math.round(width * pct);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(pct * 100).toFixed(0)}%`;
}

process.on('SIGINT', saveAndExit);
process.on('SIGTERM', saveAndExit);

async function main() {
  await client.connect();
  console.log('Connected. Scanning 30 days across 5 chats.\n');

  const dialogs = await client.getDialogs({ limit: 200 });
  const targets = ['ManifestorOVER', 'Hustlers 2.0', 'Trenches & Chill', 'Based Chad', '10K ETH Waiting Room'];
  const resolved: { id: bigint; title: string }[] = [];

  for (const d of dialogs) {
    const title = d.title || '';
    if (targets.some(t => title.toLowerCase().includes(t.toLowerCase())) && d.id) {
      resolved.push({ id: BigInt(d.id.toString()), title });
    }
  }

  console.log(`Chats: ${resolved.map(r => r.title).join(', ')}\n`);

  const cutoff = Math.floor((Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000) / 1000);
  const nowTs = Math.floor(Date.now() / 1000);
  const totalRange = nowTs - cutoff; // total seconds we're scanning
  const senderCache = new Map<string, string>();

  for (let ci = 0; ci < resolved.length; ci++) {
    const chat = resolved[ci];
    if (interrupted) break;

    console.log(`\n[${ci + 1}/${resolved.length}] ${chat.title}`);
    let count = 0;
    let addrCount = 0;
    const startTime = Date.now();
    let offsetId = 0;
    let done = false;
    let lastDate = nowTs;

    while (!done && !interrupted) {
      const messages = await client.getMessages(chat.id, { limit: 100, offsetId });
      if (messages.length === 0) break;

      for (const msg of messages) {
        if (msg.date < cutoff) { done = true; break; }
        count++;
        offsetId = msg.id;
        lastDate = msg.date;

        const text = msg.text || msg.message || '';
        if (!text) continue;

        const addrs = text.match(CONTRACT_RE);
        if (!addrs) continue;

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
          } catch { /* ignore */ }
          senderName = senderName || 'unknown';
          senderCache.set(senderId, senderName);
        }

        const isBot = /[🟡🟢🆕🔄🐦🟣]/.test(text) && (
          text.includes('FDV:') || text.includes('💎') || text.includes('💦 Liq:')
        );

        let liq: number | null = null;
        let fdv: string | null = null;
        let chain: string | null = null;
        let symbol: string | null = null;
        if (isBot) {
          const liqMatch = text.match(/💦 Liq: `([^`]+)`/);
          if (liqMatch) liq = parseMetric(liqMatch[1]);
          const fdvMatch = text.match(/FDV: `([^`]+)`/);
          if (fdvMatch) fdv = fdvMatch[1];
          const chainMatch = text.match(/🌐\s*(\w+)\s*@/);
          if (chainMatch) chain = chainMatch[1];
          const symMatch = text.match(/\*\*\$(\w+)\*\*/);
          if (symMatch) symbol = symMatch[1];
        }

        const unique = new Set<string>();
        for (const a of addrs) {
          const lower = a.toLowerCase();
          if (unique.has(lower)) continue;
          unique.add(lower);
          addrCount++;
          allSignals.push({
            chat: chat.title, sender: senderName, isBot, addr: lower,
            date: new Date(msg.date * 1000).toISOString(),
            liq, fdv, chain, symbol,
          });
        }
      }

      // Progress bar based on time range covered
      const scanned = nowTs - lastDate;
      const chatProgress = progressBar(scanned, totalRange);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const dateStr = new Date(lastDate * 1000).toISOString().slice(0, 10);
      process.stdout.write(`\r  ${chatProgress} ${dateStr} | ${count} msgs, ${addrCount} addrs (${elapsed}s)  `);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n  Done: ${count} msgs, ${addrCount} addrs in ${elapsed}s`);
  }

  saveResults();
  await client.disconnect();
}

main().catch(err => {
  console.error(err);
  saveResults();
  process.exit(1);
});
