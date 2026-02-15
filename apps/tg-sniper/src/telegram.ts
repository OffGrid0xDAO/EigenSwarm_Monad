import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
// @ts-ignore no types for input
import input from 'input';
import { config } from './config.js';
import { isAlreadyTraded, isAlreadySeen, insertSignal, insertTrade, updateSignalStatus } from './db.js';
import { getPrice, paperTrade } from './fomolt.js';

const CONTRACT_RE = /0x[a-fA-F0-9]{40}/g;
const LOG = '[Telegram]';

// Blacklisted senders — known rug pullers
const BLACKLISTED_SENDERS = ['faltify'];

// Known chat names to resolve at startup
// ── Rick Bot Detection & Quality Filters ────────────────────────────────
// Rick is a token scanner bot that replies to human CA posts with structured
// data (FDV, Liq, Vol). We parse this to apply quality filters.

const RICK_BOT_PATTERN = /[🟡🟢🆕🔄🐦🟣]/;

function isRickBotMessage(text: string): boolean {
  return RICK_BOT_PATTERN.test(text) && (
    text.includes('FDV:') || text.includes('💎') || text.includes('💦 Liq:') || text.includes('📊 Vol:')
  );
}

function parseMetricValue(raw: string): number {
  const cleaned = raw.replace(/[,$]/g, '').trim();
  if (cleaned === '0') return 0;
  const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const match = cleaned.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (match[2] ? multipliers[match[2].toUpperCase()] || 1 : 1);
}

function applyQualityFilters(text: string): string | null {
  if (!isRickBotMessage(text)) return null; // not a Rick message, no filter

  // Chain filter: only trade Base tokens
  const chainMatch = text.match(/🌐\s*(\w+)\s*@/);
  if (chainMatch && chainMatch[1].toLowerCase() !== 'base') {
    return `non-Base chain (${chainMatch[1]})`;
  }

  // Liquidity filter
  const liqMatch = text.match(/💦 Liq: `([^`]+)`/);
  if (liqMatch) {
    const liqValue = parseMetricValue(liqMatch[1]);
    if (liqValue === 0) return 'zero liquidity';
    if (text.includes('⚠️') && liqValue < 1_000) return `low liquidity ($${liqValue})`;
  }

  // Volume filter
  const volMatch = text.match(/📊 Vol: `([^`]+)`/);
  if (volMatch && parseMetricValue(volMatch[1]) === 0) return 'zero volume';

  return null; // passed all filters
}

// Known chat names to resolve at startup
const TARGET_CHATS = [
  'Trenches & Chill',
  'TNC',
  'tncportal',
  'Hustlers 2.0',
  'ManifestorOVER',
  "Based Chad's",
  '10K ETH Waiting Room',
];

let client: TelegramClient;
let monitoredChatIds: Set<string> = new Set();

// ── Public API ──────────────────────────────────────────────────────────

export async function startTelegramMonitor(): Promise<TelegramClient> {
  const session = new StringSession(config.telegram.session);
  client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
  });

  console.log(`${LOG} Connecting...`);
  await client.start({
    phoneNumber: async () => config.telegram.phone,
    phoneCode: async () => await input.text('Enter the Telegram code you received: '),
    password: async () => await input.text('Enter your 2FA password (if any): '),
    onError: (err) => console.error(`${LOG} Auth error:`, err.message),
  });

  // Print session string for .env persistence
  const sessionStr = (client.session as StringSession).save();
  if (!config.telegram.session) {
    console.log(`\n${LOG} ────────────────────────────────────────────`);
    console.log(`${LOG} Save this session string to .env TELEGRAM_SESSION:`);
    console.log(sessionStr);
    console.log(`${LOG} ────────────────────────────────────────────\n`);
  }

  // Resolve chat IDs
  await resolveChats();

  // Register message handler
  if (monitoredChatIds.size > 0) {
    const chatIdNumbers = [...monitoredChatIds].map(id => Number(id));
    client.addEventHandler(handleMessage, new NewMessage({ chats: chatIdNumbers }));
    console.log(`${LOG} Listening to ${monitoredChatIds.size} chats`);
  } else {
    // If no specific chats resolved, listen to all and filter by name
    client.addEventHandler(handleMessageUnfiltered, new NewMessage({}));
    console.log(`${LOG} No chat IDs configured — listening to all chats, filtering by name`);
  }

  return client;
}

// ── Chat Resolution ─────────────────────────────────────────────────────

async function resolveChats() {
  // First, add any explicit chat IDs from .env
  for (const id of config.telegram.chatIds) {
    monitoredChatIds.add(id);
  }

  // Then try to resolve named chats
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    for (const dialog of dialogs) {
      const title = dialog.title || '';
      const username = (dialog.entity && 'username' in dialog.entity) ? (dialog.entity as any).username : '';

      const match = TARGET_CHATS.some(
        target =>
          title.toLowerCase().includes(target.toLowerCase()) ||
          (username && username.toLowerCase() === target.toLowerCase())
      );

      if (match && dialog.id) {
        monitoredChatIds.add(dialog.id.toString());
        console.log(`${LOG} Resolved chat: "${title}" → ${dialog.id}`);
      }
    }
  } catch (err) {
    console.error(`${LOG} Failed to resolve chats:`, (err as Error).message);
  }

  if (monitoredChatIds.size === 0) {
    console.warn(`${LOG} No target chats found. Make sure you've joined: ${TARGET_CHATS.join(', ')}`);
  }
}

// ── Message Handlers ────────────────────────────────────────────────────

async function handleMessage(event: NewMessageEvent) {
  try {
    await processMessage(event);
  } catch (err) {
    console.error(`${LOG} Error processing message:`, (err as Error).message);
  }
}

async function handleMessageUnfiltered(event: NewMessageEvent) {
  try {
    // Filter by chat title if we couldn't resolve IDs
    const chat = await event.message.getChat();
    if (!chat) return;
    const title = 'title' in chat ? (chat as any).title : '';
    const username = 'username' in chat ? (chat as any).username : '';

    const isTarget = TARGET_CHATS.some(
      target =>
        (title && title.toLowerCase().includes(target.toLowerCase())) ||
        (username && username.toLowerCase() === target.toLowerCase())
    );
    if (!isTarget) return;

    // Found a target — add to monitored set for future reference
    const chatId = chat.id.toString();
    if (!monitoredChatIds.has(chatId)) {
      monitoredChatIds.add(chatId);
      console.log(`${LOG} Discovered target chat: "${title}" → ${chatId}`);
    }

    await processMessage(event);
  } catch (err) {
    console.error(`${LOG} Error processing message:`, (err as Error).message);
  }
}

async function processMessage(event: NewMessageEvent) {
  const msg = event.message;
  const text = msg.text || msg.message || '';
  if (!text) return;

  const addresses = extractAddresses(text);
  if (addresses.length === 0) return;

  // Get chat info
  let chatTitle = '';
  let chatId = '';
  try {
    const chat = await msg.getChat();
    if (chat) {
      chatTitle = 'title' in chat ? (chat as any).title || '' : '';
      chatId = chat.id.toString();
    }
  } catch { /* ignore */ }

  // Get sender info
  let senderName = '';
  try {
    const sender = await msg.getSender();
    if (sender) {
      if ('firstName' in sender) senderName = (sender as any).firstName || '';
      if ('username' in sender) senderName = senderName || (sender as any).username || '';
    }
  } catch { /* ignore */ }

  console.log(`${LOG} Found ${addresses.length} address(es) in "${chatTitle}" from ${senderName || 'unknown'}`);

  for (const addr of addresses) {
    await processAddress(addr, chatId, chatTitle, senderName, text, msg.id);
  }
}

// ── Address Processing ──────────────────────────────────────────────────

function extractAddresses(text: string): string[] {
  const matches = text.match(CONTRACT_RE) || [];
  // Deduplicate and normalize
  const seen = new Set<string>();
  return matches.filter(addr => {
    const lower = addr.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

async function processAddress(
  contractAddress: string,
  chatId: string,
  chatTitle: string,
  senderName: string,
  messageText: string,
  messageId: number,
) {
  const addr = contractAddress.toLowerCase();

  // Blacklisted sender check
  if (BLACKLISTED_SENDERS.some(b => senderName.toLowerCase().includes(b))) {
    console.log(`${LOG} Skip ${addr.slice(0, 10)}... (blacklisted sender: ${senderName})`);
    insertSignal({ contractAddress: addr, chatId, chatTitle, senderName, messageText, status: 'blacklisted_sender' });
    return;
  }

  // Quality filters from Rick bot data (chain, liquidity, volume)
  const filterReason = applyQualityFilters(messageText);
  if (filterReason) {
    console.log(`${LOG} Skip ${addr.slice(0, 10)}... (quality filter: ${filterReason})`);
    insertSignal({ contractAddress: addr, chatId, chatTitle, senderName, messageText, status: `filtered: ${filterReason}` });
    return;
  }

  // First-mention-only: skip if this address has EVER been seen before in any chat
  if (isAlreadySeen(addr)) {
    console.log(`${LOG} Skip ${addr.slice(0, 10)}... (already seen before — not first mention)`);
    return;
  }

  // Also skip if already traded (belt-and-suspenders)
  if (isAlreadyTraded(addr)) {
    console.log(`${LOG} Skip ${addr.slice(0, 10)}... (already traded)`);
    insertSignal({ contractAddress: addr, chatId, chatTitle, senderName, messageText, status: 'skipped_dup' });
    return;
  }

  // Record signal
  const signalId = insertSignal({
    contractAddress: addr,
    chatId,
    chatTitle,
    senderName,
    messageText,
    status: 'pending',
  });

  // Check price on Fomolt
  console.log(`${LOG} Checking price for ${addr.slice(0, 10)}...`);
  const price = await getPrice(addr);
  if (!price) {
    console.log(`${LOG} No price for ${addr.slice(0, 10)}... — skipping`);
    updateSignalStatus(signalId, 'no_price');
    return;
  }

  console.log(`${LOG} ${price.symbol} (${price.name}) = $${price.priceInUsdc}`);

  // Execute paper trade
  const note = `TG sniper: ${chatTitle} | ${senderName}`.slice(0, 280);
  const trade = await paperTrade({
    contractAddress: addr,
    amountUsdc: config.tradeAmountUsdc,
    note,
  });

  if (trade) {
    console.log(`${LOG} ✓ Bought ${trade.quantity} ${trade.symbol} for $${trade.totalUsdc} @ $${trade.price}`);
    updateSignalStatus(signalId, 'traded');
    insertTrade({
      contractAddress: addr,
      signalId,
      symbol: trade.symbol,
      side: 'buy',
      amountUsdc: trade.totalUsdc,
      price: trade.price,
      tokensReceived: trade.quantity,
      fomoltTradeId: '',
      status: 'filled',
      chatTitle,
    });
  } else {
    console.log(`${LOG} ✗ Trade failed for ${price.symbol}`);
    updateSignalStatus(signalId, 'error');
    insertTrade({
      contractAddress: addr,
      signalId,
      symbol: price.symbol,
      side: 'buy',
      amountUsdc: config.tradeAmountUsdc,
      price: price.priceInUsdc,
      tokensReceived: '0',
      fomoltTradeId: '',
      status: 'failed',
      errorMessage: 'Trade request failed',
      chatTitle,
    });
  }
}
