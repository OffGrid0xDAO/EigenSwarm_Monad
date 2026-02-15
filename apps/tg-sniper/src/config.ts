import 'dotenv/config';

export const config = {
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH!,
    phone: process.env.TELEGRAM_PHONE!,
    session: process.env.TELEGRAM_SESSION || '',
    chatIds: (process.env.TELEGRAM_CHAT_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },
  fomolt: {
    apiKey: process.env.FOMOLT_API_KEY!,
    baseUrl: 'https://fomolt.com/api/v1',
  },
  tradeAmountUsdc: process.env.TRADE_AMOUNT_USDC || '100',
} as const;

export function validateConfig() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required');
  }
  if (!config.telegram.phone) {
    throw new Error('TELEGRAM_PHONE is required');
  }
  if (!config.fomolt.apiKey) {
    throw new Error('FOMOLT_API_KEY is required');
  }
  if (!config.telegram.chatIds.length) {
    console.warn('[Config] TELEGRAM_CHAT_IDS is empty — will monitor all chats');
  }
}
