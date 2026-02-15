import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_FILE = path.join(__dirname, '..', '.tg-code');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH!;
const phone = process.env.TELEGRAM_PHONE!;

async function waitForCodeFile(): Promise<string> {
  console.log(`WAITING FOR CODE — write it to: ${CODE_FILE}`);
  // Clean up any stale file
  try { fs.unlinkSync(CODE_FILE); } catch {}

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const code = fs.readFileSync(CODE_FILE, 'utf-8').trim();
      if (code.length >= 5) {
        fs.unlinkSync(CODE_FILE);
        console.log(`Got code: ${code}`);
        return code;
      }
    } catch {}
  }
}

async function auth() {
  console.log('Authenticating with Telegram...');
  console.log(`Phone: ${phone}`);
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phone,
    phoneCode: async () => await waitForCodeFile(),
    password: async () => {
      console.log('2FA password requested — write to .tg-code file');
      return await waitForCodeFile();
    },
    onError: (err: Error) => console.error('Error:', err.message),
  });

  const session = (client.session as StringSession).save();
  console.log('SESSION_STRING_START');
  console.log(session);
  console.log('SESSION_STRING_END');

  await client.disconnect();
  process.exit(0);
}

auth();
