import 'dotenv/config';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = parseInt(process.env.TELEGRAM_API_ID!);
const apiHash = process.env.TELEGRAM_API_HASH!;
const session = new StringSession(process.env.TELEGRAM_SESSION!);

const TARGET_CHATS = [
  'Trenches & Chill',
  'TNC',
  'Hustlers 2.0',
  'ManifestorOVER',
  "Based Chad's",
];

const CONTRACT_RE = /0x[a-fA-F0-9]{40}/g;

async function main() {
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  console.log('Connected.\n');

  // Resolve chats
  const dialogs = await client.getDialogs({ limit: 200 });
  const resolved: { id: bigint; title: string }[] = [];

  for (const d of dialogs) {
    const title = d.title || '';
    const username = (d.entity && 'username' in d.entity) ? (d.entity as any).username : '';
    const match = TARGET_CHATS.some(
      t => title.toLowerCase().includes(t.toLowerCase()) ||
           (username && username.toLowerCase() === t.toLowerCase())
    );
    if (match && d.id) {
      resolved.push({ id: BigInt(d.id.toString()), title });
      console.log(`Resolved: "${title}" → ${d.id}`);
    }
  }

  console.log(`\nPulling last 500 messages from each chat...\n`);

  for (const chat of resolved) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`CHAT: ${chat.title}`);
    console.log(`${'═'.repeat(70)}\n`);

    const messages = await client.getMessages(chat.id, { limit: 500 });

    let totalMsgs = 0;
    let msgsWithAddresses = 0;
    const senders = new Map<string, { count: number; addresses: string[] }>();
    const allAddresses = new Set<string>();
    const addressDetails: { sender: string; addr: string; text: string; date: Date }[] = [];

    for (const msg of messages) {
      totalMsgs++;
      const text = msg.text || msg.message || '';
      if (!text) continue;

      const addrs = text.match(CONTRACT_RE) || [];
      if (addrs.length === 0) continue;

      msgsWithAddresses++;
      let senderName = 'unknown';
      try {
        const sender = await msg.getSender();
        if (sender) {
          if ('firstName' in sender) senderName = (sender as any).firstName || '';
          if (!senderName && 'username' in sender) senderName = (sender as any).username || '';
          if (!senderName && 'title' in sender) senderName = (sender as any).title || '';
        }
      } catch { /* ignore */ }

      if (!senders.has(senderName)) senders.set(senderName, { count: 0, addresses: [] });
      const s = senders.get(senderName)!;
      s.count++;

      for (const a of addrs) {
        const lower = a.toLowerCase();
        if (!allAddresses.has(lower)) {
          allAddresses.add(lower);
          s.addresses.push(lower);
          addressDetails.push({
            sender: senderName,
            addr: lower,
            text: text.slice(0, 120),
            date: new Date(msg.date * 1000),
          });
        }
      }
    }

    console.log(`Total messages scanned: ${totalMsgs}`);
    console.log(`Messages with addresses: ${msgsWithAddresses}`);
    console.log(`Unique contract addresses: ${allAddresses.size}\n`);

    // Sender breakdown
    console.log('Sender breakdown:');
    const sorted = [...senders.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [name, s] of sorted) {
      const isBot = s.addresses.some(a => {
        const msg = addressDetails.find(d => d.addr === a && d.sender === name);
        return msg?.text.includes('FDV:') || msg?.text.includes('💎') || msg?.text.includes('💦');
      });
      console.log(`  ${name.padEnd(25)} ${String(s.count).padStart(4)} msgs  ${String(s.addresses.length).padStart(3)} unique addrs  ${isBot ? '🤖 BOT' : '👤 HUMAN'}`);
    }

    // Recent address calls (last 20)
    console.log(`\nRecent unique address mentions (newest first):`);
    const recentAddrs = addressDetails.slice(0, 25);
    for (const d of recentAddrs) {
      const timeStr = d.date.toISOString().slice(5, 16).replace('T', ' ');
      console.log(`  ${timeStr}  ${d.sender.padEnd(20)} ${d.addr.slice(0, 12)}...  ${d.text.slice(0, 60).replace(/\n/g, ' ')}`);
    }
  }

  await client.disconnect();
}

main().catch(console.error);
