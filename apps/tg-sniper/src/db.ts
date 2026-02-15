import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'sniper.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function initTables() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_address TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_title TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      message_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_address ON signals(contract_address);
    CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_address TEXT NOT NULL UNIQUE,
      signal_id INTEGER REFERENCES signals(id),
      symbol TEXT NOT NULL DEFAULT '',
      side TEXT NOT NULL DEFAULT 'buy',
      amount_usdc TEXT NOT NULL,
      price TEXT,
      tokens_received TEXT,
      fomolt_trade_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      chat_title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
  `);

  console.log('[DB] Tables initialized');
}

export function isAlreadyTraded(contractAddress: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM trades WHERE contract_address = ?')
    .get(contractAddress.toLowerCase());
  return !!row;
}

export function isAlreadySeen(contractAddress: string): boolean {
  // Returns true if this address has EVER been mentioned in any monitored chat
  const row = getDb()
    .prepare('SELECT 1 FROM signals WHERE contract_address = ?')
    .get(contractAddress.toLowerCase());
  return !!row;
}

export function insertSignal(params: {
  contractAddress: string;
  chatId: string;
  chatTitle: string;
  senderName: string;
  messageText: string;
  status: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO signals (contract_address, chat_id, chat_title, sender_name, message_text, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.contractAddress.toLowerCase(),
      params.chatId,
      params.chatTitle,
      params.senderName,
      params.messageText.slice(0, 1000),
      params.status
    );
  return Number(result.lastInsertRowid);
}

export function insertTrade(params: {
  contractAddress: string;
  signalId: number;
  symbol: string;
  side: string;
  amountUsdc: string;
  price: string;
  tokensReceived: string;
  fomoltTradeId: string;
  status: string;
  errorMessage?: string;
  chatTitle: string;
}) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO trades
       (contract_address, signal_id, symbol, side, amount_usdc, price, tokens_received, fomolt_trade_id, status, error_message, chat_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.contractAddress.toLowerCase(),
      params.signalId,
      params.symbol,
      params.side,
      params.amountUsdc,
      params.price,
      params.tokensReceived,
      params.fomoltTradeId,
      params.status,
      params.errorMessage || null,
      params.chatTitle
    );
}

export function updateSignalStatus(id: number, status: string) {
  getDb().prepare('UPDATE signals SET status = ? WHERE id = ?').run(status, id);
}
