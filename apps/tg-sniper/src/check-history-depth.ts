import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const client = new TelegramClient(
  new StringSession(process.env.TELEGRAM_SESSION!),
  parseInt(process.env.TELEGRAM_API_ID!),
  process.env.TELEGRAM_API_HASH!,
  { connectionRetries: 5 }
);

async function main() {
  await client.connect();

  const dialogs = await client.getDialogs({ limit: 200 });
  const targets = ['ManifestorOVER', 'Hustlers 2.0', 'Trenches & Chill', 'Based Chad'];

  for (const d of dialogs) {
    const title = d.title || '';
    if (!targets.some(c => title.toLowerCase().includes(c.toLowerCase()))) continue;

    // newest message
    const newest = await client.getMessages(d.id!, { limit: 1 });
    const newestDate = newest[0] ? new Date(newest[0].date * 1000).toISOString().slice(0, 16) : '?';

    console.log(`═══ ${title} ═══`);
    console.log(`  Latest message: ${newestDate}`);

    // Try different time offsets
    const offsets = [
      { label: '3 days ago', days: 3 },
      { label: '7 days ago', days: 7 },
      { label: '14 days ago', days: 14 },
      { label: '30 days ago', days: 30 },
      { label: '90 days ago', days: 90 },
    ];

    for (const o of offsets) {
      const ts = Math.floor((Date.now() - o.days * 24 * 60 * 60 * 1000) / 1000);
      const msgs = await client.getMessages(d.id!, { limit: 3, offsetDate: ts });
      if (msgs.length > 0) {
        const date = new Date(msgs[0].date * 1000).toISOString().slice(0, 16);
        console.log(`  ${o.label.padEnd(15)} ✓ (msg from ${date})`);
      } else {
        console.log(`  ${o.label.padEnd(15)} ✗ no messages`);
      }
    }
    console.log('');
  }

  await client.disconnect();
}

main().catch(console.error);
