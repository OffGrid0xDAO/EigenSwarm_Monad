import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'eigenswarm.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
    migrateSchema();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eigen_configs (
      eigen_id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL DEFAULT '',
      token_symbol TEXT NOT NULL DEFAULT '',
      token_name TEXT NOT NULL DEFAULT '',
      class TEXT NOT NULL DEFAULT 'operator',
      volume_target REAL NOT NULL DEFAULT 5,
      trade_frequency REAL NOT NULL DEFAULT 20,
      order_size_min REAL NOT NULL DEFAULT 0.005,
      order_size_max REAL NOT NULL DEFAULT 0.05,
      spread_width REAL NOT NULL DEFAULT 1.2,
      profit_target REAL NOT NULL DEFAULT 50,
      stop_loss REAL NOT NULL DEFAULT 30,
      rebalance_threshold REAL NOT NULL DEFAULT 0.6,
      wallet_count INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_positions (
      eigen_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      amount_raw TEXT NOT NULL DEFAULT '0',
      entry_price_eth REAL NOT NULL DEFAULT 0,
      total_cost_eth REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(eigen_id, token_address, wallet_address)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eigen_id TEXT NOT NULL,
      type TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      eth_amount TEXT NOT NULL,
      token_amount TEXT NOT NULL,
      price_eth REAL NOT NULL,
      pnl_realized REAL NOT NULL DEFAULT 0,
      gas_cost TEXT NOT NULL DEFAULT '0',
      tx_hash TEXT NOT NULL,
      router TEXT NOT NULL,
      pool_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_eigen ON trades(eigen_id);
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);

    CREATE TABLE IF NOT EXISTS sub_wallets (
      eigen_id TEXT NOT NULL,
      wallet_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      last_trade_at TEXT,
      trade_count INTEGER NOT NULL DEFAULT 0,
      eth_funded REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(eigen_id, wallet_index)
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT NOT NULL,
      price_eth REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'pool',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_price_token ON price_snapshots(token_address, created_at);

    CREATE TABLE IF NOT EXISTS used_payments (
      tx_hash TEXT PRIMARY KEY,
      payer_address TEXT NOT NULL,
      amount_usdc REAL NOT NULL,
      package_id TEXT NOT NULL,
      eigen_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      owner_address TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      rate_limit INTEGER NOT NULL DEFAULT 60,
      active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON agent_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON agent_api_keys(owner_address);
  `);
}

// Migrate existing eigen_configs with new columns (safe to re-run)
function migrateSchema() {
  const newColumns: [string, string][] = [
    ['pool_version', 'TEXT DEFAULT NULL'],
    ['pool_fee', 'INTEGER DEFAULT NULL'],
    ['pool_tick_spacing', 'INTEGER DEFAULT NULL'],
    ['pool_hooks', 'TEXT DEFAULT NULL'],
    ['pool_address', 'TEXT DEFAULT NULL'],
    ['owner_address', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['suspended_at', 'TEXT DEFAULT NULL'],
    ['suspended_reason', 'TEXT DEFAULT NULL'],
    ['slippage_bps', 'INTEGER NOT NULL DEFAULT 200'],
    ['order_size_pct_min', 'REAL NOT NULL DEFAULT 8'],
    ['order_size_pct_max', 'REAL NOT NULL DEFAULT 15'],
    ['reactive_sell_mode', 'INTEGER NOT NULL DEFAULT 0'],
    ['reactive_sell_pct', 'REAL NOT NULL DEFAULT 100'],
    ['reactive_sell_last_block', 'INTEGER DEFAULT NULL'],
    ['lp_pool_id', 'TEXT DEFAULT NULL'],
    ['lp_token_id', 'INTEGER DEFAULT NULL'],
    ['lp_pool_fee', 'INTEGER DEFAULT NULL'],
    ['lp_pool_tick_spacing', 'INTEGER DEFAULT NULL'],
    ['lp_contract_address', 'TEXT DEFAULT NULL'],
    ['lp_last_compound_at', 'TEXT DEFAULT NULL'],
    ['chain_id', 'INTEGER NOT NULL DEFAULT 143'],
    ['graduation_status', 'TEXT DEFAULT NULL'],        // 'bonding_curve' | 'graduated' | null
    ['graduated_pool_address', 'TEXT DEFAULT NULL'],    // V3 pool created on graduation
    ['agent_8004_id', 'TEXT DEFAULT NULL'],             // ERC-8004 NFT agent ID
    ['agent_8004_chain_id', 'INTEGER DEFAULT NULL'],   // Chain where 8004 NFT lives
    ['agent_card_uri', 'TEXT DEFAULT NULL'],            // URI to agent registration file
    ['vault_version', "TEXT NOT NULL DEFAULT 'v1'"],   // kept for backward compat, always 'v2' for new
    ['gas_budget_eth', 'REAL NOT NULL DEFAULT 0'],
    ['gas_spent_eth', 'REAL NOT NULL DEFAULT 0'],
    ['protocol_fee_eth', 'REAL NOT NULL DEFAULT 0'],
    ['custom_prompt', 'TEXT DEFAULT NULL'],
    ['wallet_source', "TEXT NOT NULL DEFAULT 'derived'"],  // 'derived' | 'imported'
  ];

  for (const [name, definition] of newColumns) {
    try {
      db.exec(`ALTER TABLE eigen_configs ADD COLUMN ${name} ${definition}`);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // Protocol fee audit trail
  db.exec(`
    CREATE TABLE IF NOT EXISTS protocol_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eigen_id TEXT NOT NULL,
      fee_eth TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'launch',
      tx_context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_fees_eigen ON protocol_fees(eigen_id);
  `);

  // Imported wallets (encrypted private keys from Bundle tool)
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_wallets (
      eigen_id TEXT NOT NULL,
      wallet_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      last_trade_at TEXT,
      trade_count INTEGER NOT NULL DEFAULT 0,
      eth_funded REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(eigen_id, wallet_index)
    );
    CREATE INDEX IF NOT EXISTS idx_imported_wallets_eigen ON imported_wallets(eigen_id);
  `);
}

// ── Types ────────────────────────────────────────────────────────────────

export interface EigenConfig {
  eigen_id: string;
  token_address: string;
  token_symbol: string;
  token_name: string;
  class: string;
  volume_target: number;
  trade_frequency: number;
  order_size_min: number;
  order_size_max: number;
  spread_width: number;
  profit_target: number;
  stop_loss: number;
  rebalance_threshold: number;
  wallet_count: number;
  pool_version: string | null;
  pool_fee: number | null;
  pool_tick_spacing: number | null;
  pool_hooks: string | null;
  pool_address: string | null;
  owner_address: string;
  status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  slippage_bps: number;
  order_size_pct_min: number;  // % of balance for min trade size (e.g. 10 = 10%)
  order_size_pct_max: number;  // % of balance for max trade size (e.g. 30 = 30%)
  reactive_sell_mode: number;           // 0=off, 1=on
  reactive_sell_pct: number;            // % of detected buy to mirror-sell (default 100)
  reactive_sell_last_block: number | null;  // last block scanned for external buys
  lp_pool_id: string | null;                // Hook-free V4 LP pool ID (bytes32)
  lp_token_id: number | null;               // PositionManager NFT token ID
  lp_pool_fee: number | null;               // LP pool fee (e.g. 9900 = 0.99%)
  lp_pool_tick_spacing: number | null;       // LP pool tick spacing (e.g. 198)
  lp_contract_address: string | null;        // EigenLP contract address
  lp_last_compound_at: string | null;        // Last time LP fees were compounded
  chain_id: number;                          // Chain ID (default 143 = Monad)
  graduation_status: string | null;           // 'bonding_curve' | 'graduated' | null
  graduated_pool_address: string | null;      // V3 pool address after graduation
  agent_8004_id: string | null;              // ERC-8004 NFT agent ID
  agent_8004_chain_id: number | null;        // Chain where 8004 NFT lives
  agent_card_uri: string | null;             // URI to agent registration file
  gas_budget_eth: number;                    // ETH earmarked for gas at launch
  gas_spent_eth: number;                     // ETH spent on gas so far
  protocol_fee_eth: number;                  // Protocol fee deducted at launch
  custom_prompt: string | null;              // User-provided AI strategy instructions
  wallet_source: string;                     // 'derived' | 'imported'
  created_at: string;
}

export interface TokenPosition {
  eigen_id: string;
  token_address: string;
  wallet_address: string;
  amount_raw: string;
  entry_price_eth: number;
  total_cost_eth: number;
  updated_at: string;
}

export interface TradeRecord {
  id: number;
  eigen_id: string;
  type: string;
  wallet_address: string;
  token_address: string;
  eth_amount: string;
  token_amount: string;
  price_eth: number;
  pnl_realized: number;
  gas_cost: string;
  tx_hash: string;
  router: string;
  pool_version: string;
  created_at: string;
}

export interface SubWallet {
  eigen_id: string;
  wallet_index: number;
  address: string;
  last_trade_at: string | null;
  trade_count: number;
  eth_funded: number;
  created_at: string;
}

export interface PriceSnapshot {
  id: number;
  token_address: string;
  price_eth: number;
  source: string;
  created_at: string;
}

// ── Eigen Config CRUD ───────────────────────────────────────────────────

export function insertEigenConfig(data: {
  eigenId: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  class?: string;
  volumeTarget?: number;
  tradeFrequency?: number;
  orderSizeMin?: number;
  orderSizeMax?: number;
  spreadWidth?: number;
  profitTarget?: number;
  stopLoss?: number;
  rebalanceThreshold?: number;
  walletCount?: number;
  poolVersion?: string | null;
  poolFee?: number | null;
  poolTickSpacing?: number | null;
  poolHooks?: string | null;
  poolAddress?: string | null;
  ownerAddress?: string;
  lpPoolId?: string | null;
  lpTokenId?: number | null;
  lpPoolFee?: number | null;
  lpPoolTickSpacing?: number | null;
  lpContractAddress?: string | null;
  chainId?: number;
  gasBudgetEth?: number;
  protocolFeeEth?: number;
}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO eigen_configs (
      eigen_id, token_address, token_symbol, token_name,
      class, volume_target, trade_frequency, order_size_min, order_size_max,
      spread_width, profit_target, stop_loss, rebalance_threshold, wallet_count,
      pool_version, pool_fee, pool_tick_spacing, pool_hooks, pool_address, owner_address,
      lp_pool_id, lp_token_id, lp_pool_fee, lp_pool_tick_spacing, lp_contract_address,
      chain_id, vault_version, gas_budget_eth, protocol_fee_eth
    ) VALUES (
      @eigenId, @tokenAddress, @tokenSymbol, @tokenName,
      @class, @volumeTarget, @tradeFrequency, @orderSizeMin, @orderSizeMax,
      @spreadWidth, @profitTarget, @stopLoss, @rebalanceThreshold, @walletCount,
      @poolVersion, @poolFee, @poolTickSpacing, @poolHooks, @poolAddress, @ownerAddress,
      @lpPoolId, @lpTokenId, @lpPoolFee, @lpPoolTickSpacing, @lpContractAddress,
      @chainId, @vaultVersion, @gasBudgetEth, @protocolFeeEth
    )
  `);
  stmt.run({
    eigenId: data.eigenId,
    tokenAddress: data.tokenAddress || '',
    tokenSymbol: data.tokenSymbol || '',
    tokenName: data.tokenName || '',
    class: data.class || 'operator',
    volumeTarget: data.volumeTarget || 5,
    tradeFrequency: data.tradeFrequency || 20,
    orderSizeMin: data.orderSizeMin || 0.005,
    orderSizeMax: data.orderSizeMax || 0.05,
    spreadWidth: data.spreadWidth || 1.2,
    profitTarget: data.profitTarget || 50,
    stopLoss: data.stopLoss || 30,
    rebalanceThreshold: data.rebalanceThreshold || 0.6,
    walletCount: data.walletCount || 10,
    poolVersion: data.poolVersion ?? null,
    poolFee: data.poolFee ?? null,
    poolTickSpacing: data.poolTickSpacing ?? null,
    poolHooks: data.poolHooks ?? null,
    poolAddress: data.poolAddress ?? null,
    ownerAddress: data.ownerAddress || '',
    lpPoolId: data.lpPoolId ?? null,
    lpTokenId: data.lpTokenId ?? null,
    lpPoolFee: data.lpPoolFee ?? null,
    lpPoolTickSpacing: data.lpPoolTickSpacing ?? null,
    lpContractAddress: data.lpContractAddress ?? null,
    chainId: data.chainId ?? 143,
    vaultVersion: 'v2',
    gasBudgetEth: data.gasBudgetEth ?? 0,
    protocolFeeEth: data.protocolFeeEth ?? 0,
  });
}

export function getEigenConfig(eigenId: string): EigenConfig | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM eigen_configs WHERE eigen_id = ?').get(eigenId) as EigenConfig | undefined;
}

export function getAllEigenConfigs(): EigenConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eigen_configs ORDER BY created_at DESC').all() as EigenConfig[];
}

export function getEigenConfigsByOwner(ownerAddress: string): EigenConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eigen_configs WHERE LOWER(owner_address) = LOWER(?) ORDER BY created_at DESC').all(ownerAddress) as EigenConfig[];
}

export function updateEigenConfigPool(eigenId: string, pool: {
  poolVersion: string;
  poolFee: number;
  poolTickSpacing?: number | null;
  poolHooks?: string | null;
  poolAddress?: string | null;
}) {
  const db = getDb();
  db.prepare(`
    UPDATE eigen_configs SET
      pool_version = @poolVersion,
      pool_fee = @poolFee,
      pool_tick_spacing = @poolTickSpacing,
      pool_hooks = @poolHooks,
      pool_address = @poolAddress
    WHERE eigen_id = @eigenId
  `).run({
    eigenId,
    poolVersion: pool.poolVersion,
    poolFee: pool.poolFee,
    poolTickSpacing: pool.poolTickSpacing ?? null,
    poolHooks: pool.poolHooks ?? null,
    poolAddress: pool.poolAddress ?? null,
  });
}

export function updateEigenConfigLpPool(eigenId: string, lpPoolId: string) {
  const db = getDb();
  db.prepare(`UPDATE eigen_configs SET lp_pool_id = @lpPoolId WHERE eigen_id = @eigenId`).run({ eigenId, lpPoolId });
}

const ALLOWED_CONFIG_FIELDS = new Set([
  'volume_target', 'trade_frequency', 'order_size_min', 'order_size_max',
  'order_size_pct_min', 'order_size_pct_max', 'spread_width', 'profit_target',
  'stop_loss', 'rebalance_threshold', 'wallet_count', 'slippage_bps',
  'reactive_sell_mode', 'reactive_sell_pct', 'custom_prompt',
]);

export function updateEigenConfig(eigenId: string, updates: Partial<{
  volume_target: number;
  trade_frequency: number;
  order_size_min: number;
  order_size_max: number;
  order_size_pct_min: number;
  order_size_pct_max: number;
  spread_width: number;
  profit_target: number;
  stop_loss: number;
  rebalance_threshold: number;
  wallet_count: number;
  slippage_bps: number;
  reactive_sell_mode: number;
  reactive_sell_pct: number;
  custom_prompt: string | null;
}>) {
  const db = getDb();
  const setClauses: string[] = [];
  const values: Record<string, unknown> = { eigenId };

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      // Strict whitelist: reject any field name not in the allowed set
      if (!ALLOWED_CONFIG_FIELDS.has(key)) continue;
      setClauses.push(`${key} = @${key}`);
      values[key] = val;
    }
  }

  if (setClauses.length === 0) return;

  db.prepare(`UPDATE eigen_configs SET ${setClauses.join(', ')} WHERE eigen_id = @eigenId`).run(values);
}

export function updateEigenConfigStatus(eigenId: string, status: string, reason?: string) {
  const db = getDb();
  if (status === 'suspended') {
    db.prepare(`
      UPDATE eigen_configs SET status = @status, suspended_at = datetime('now'), suspended_reason = @reason
      WHERE eigen_id = @eigenId
    `).run({ eigenId, status, reason: reason || null });
  } else {
    db.prepare(`
      UPDATE eigen_configs SET status = @status, suspended_at = NULL, suspended_reason = NULL
      WHERE eigen_id = @eigenId
    `).run({ eigenId, status });
  }
}

export function updateReactiveSellBlock(eigenId: string, blockNumber: number) {
  const db = getDb();
  db.prepare('UPDATE eigen_configs SET reactive_sell_last_block = ? WHERE eigen_id = ?')
    .run(blockNumber, eigenId);
}

// ── Token Position CRUD ─────────────────────────────────────────────────

export function upsertTokenPosition(data: {
  eigenId: string;
  tokenAddress: string;
  walletAddress: string;
  amountRaw: string;
  entryPriceEth: number;
  totalCostEth: number;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_positions (eigen_id, token_address, wallet_address, amount_raw, entry_price_eth, total_cost_eth, updated_at)
    VALUES (@eigenId, @tokenAddress, @walletAddress, @amountRaw, @entryPriceEth, @totalCostEth, datetime('now'))
    ON CONFLICT(eigen_id, token_address, wallet_address)
    DO UPDATE SET amount_raw = @amountRaw, entry_price_eth = @entryPriceEth, total_cost_eth = @totalCostEth, updated_at = datetime('now')
  `).run({
    eigenId: data.eigenId,
    tokenAddress: data.tokenAddress,
    walletAddress: data.walletAddress,
    amountRaw: data.amountRaw,
    entryPriceEth: data.entryPriceEth,
    totalCostEth: data.totalCostEth,
  });
}

export function getTokenPosition(eigenId: string, tokenAddress: string, walletAddress: string): TokenPosition | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM token_positions WHERE eigen_id = ? AND token_address = ? AND wallet_address = ?',
  ).get(eigenId, tokenAddress, walletAddress) as TokenPosition | undefined;
}

export function getTokenPositionsByEigen(eigenId: string): TokenPosition[] {
  const db = getDb();
  return db.prepare('SELECT * FROM token_positions WHERE eigen_id = ?').all(eigenId) as TokenPosition[];
}

export function getAllTokenPositions(): TokenPosition[] {
  const db = getDb();
  return db.prepare('SELECT * FROM token_positions WHERE CAST(amount_raw AS REAL) > 0').all() as TokenPosition[];
}

// ── Trade Record CRUD ───────────────────────────────────────────────────

export function insertTradeRecord(data: {
  eigenId: string;
  type: string;
  walletAddress: string;
  tokenAddress: string;
  ethAmount: string;
  tokenAmount: string;
  priceEth: number;
  pnlRealized?: number;
  gasCost?: string;
  txHash: string;
  router: string;
  poolVersion: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO trades (eigen_id, type, wallet_address, token_address, eth_amount, token_amount, price_eth, pnl_realized, gas_cost, tx_hash, router, pool_version)
    VALUES (@eigenId, @type, @walletAddress, @tokenAddress, @ethAmount, @tokenAmount, @priceEth, @pnlRealized, @gasCost, @txHash, @router, @poolVersion)
  `).run({
    eigenId: data.eigenId,
    type: data.type,
    walletAddress: data.walletAddress,
    tokenAddress: data.tokenAddress,
    ethAmount: data.ethAmount,
    tokenAmount: data.tokenAmount,
    priceEth: data.priceEth,
    pnlRealized: data.pnlRealized || 0,
    gasCost: data.gasCost || '0',
    txHash: data.txHash,
    router: data.router,
    poolVersion: data.poolVersion,
  });
}

export function getTradesByEigen(eigenId: string, limit = 100): TradeRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM trades WHERE eigen_id = ? ORDER BY created_at DESC LIMIT ?').all(eigenId, limit) as TradeRecord[];
}

export function getLastTradeByEigen(eigenId: string): TradeRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trades WHERE eigen_id = ? ORDER BY created_at DESC LIMIT 1').get(eigenId) as TradeRecord | undefined;
}

export function getTradeStats(eigenId: string): {
  totalBuys: number;
  totalSells: number;
  totalRealizedPnl: number;
  winCount: number;
  lossCount: number;
  totalGasCost: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'buy' THEN 1 ELSE 0 END), 0) as totalBuys,
      COALESCE(SUM(CASE WHEN type IN ('sell', 'profit_take') THEN 1 ELSE 0 END), 0) as totalSells,
      COALESCE(SUM(pnl_realized), 0) as totalRealizedPnl,
      COALESCE(SUM(CASE WHEN pnl_realized > 0 THEN 1 ELSE 0 END), 0) as winCount,
      COALESCE(SUM(CASE WHEN pnl_realized < 0 THEN 1 ELSE 0 END), 0) as lossCount,
      COALESCE(SUM(CAST(gas_cost AS REAL)), 0) as totalGasCost
    FROM trades WHERE eigen_id = ?
  `).get(eigenId) as { totalBuys: number; totalSells: number; totalRealizedPnl: number; winCount: number; lossCount: number; totalGasCost: number };
  return row;
}

// ── Sub-Wallet CRUD ─────────────────────────────────────────────────────

export function upsertSubWallet(data: {
  eigenId: string;
  walletIndex: number;
  address: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sub_wallets (eigen_id, wallet_index, address)
    VALUES (@eigenId, @walletIndex, @address)
    ON CONFLICT(eigen_id, wallet_index) DO UPDATE SET address = @address
  `).run({ eigenId: data.eigenId, walletIndex: data.walletIndex, address: data.address });
}

export function getSubWallets(eigenId: string): SubWallet[] {
  const db = getDb();
  return db.prepare('SELECT * FROM sub_wallets WHERE eigen_id = ? ORDER BY wallet_index').all(eigenId) as SubWallet[];
}

export function updateSubWalletTrade(eigenId: string, walletIndex: number) {
  const db = getDb();
  db.prepare(`
    UPDATE sub_wallets SET last_trade_at = datetime('now'), trade_count = trade_count + 1
    WHERE eigen_id = ? AND wallet_index = ?
  `).run(eigenId, walletIndex);
}

export function updateSubWalletFunding(eigenId: string, walletIndex: number, ethFunded: number) {
  const db = getDb();
  db.prepare(`
    UPDATE sub_wallets SET eth_funded = eth_funded + ? WHERE eigen_id = ? AND wallet_index = ?
  `).run(ethFunded, eigenId, walletIndex);
}

// ── Imported Wallet CRUD ────────────────────────────────────────────────

export interface ImportedWallet {
  eigen_id: string;
  wallet_index: number;
  address: string;
  encrypted_private_key: string;
  last_trade_at: string | null;
  trade_count: number;
  eth_funded: number;
  created_at: string;
}

export function upsertImportedWallet(data: {
  eigenId: string;
  walletIndex: number;
  address: string;
  encryptedPrivateKey: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO imported_wallets (eigen_id, wallet_index, address, encrypted_private_key)
    VALUES (@eigenId, @walletIndex, @address, @encryptedPrivateKey)
    ON CONFLICT(eigen_id, wallet_index) DO UPDATE SET
      address = @address,
      encrypted_private_key = @encryptedPrivateKey
  `).run({
    eigenId: data.eigenId,
    walletIndex: data.walletIndex,
    address: data.address,
    encryptedPrivateKey: data.encryptedPrivateKey,
  });
}

export function getImportedWallets(eigenId: string): ImportedWallet[] {
  const db = getDb();
  return db.prepare('SELECT * FROM imported_wallets WHERE eigen_id = ? ORDER BY wallet_index')
    .all(eigenId) as ImportedWallet[];
}

export function deleteImportedWallets(eigenId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM imported_wallets WHERE eigen_id = ?').run(eigenId);
}

export function updateImportedWalletTrade(eigenId: string, walletIndex: number) {
  const db = getDb();
  db.prepare(`
    UPDATE imported_wallets SET last_trade_at = datetime('now'), trade_count = trade_count + 1
    WHERE eigen_id = ? AND wallet_index = ?
  `).run(eigenId, walletIndex);
}

export function updateWalletSource(eigenId: string, source: 'derived' | 'imported') {
  const db = getDb();
  db.prepare('UPDATE eigen_configs SET wallet_source = ? WHERE eigen_id = ?').run(source, eigenId);
}

// ── Price Snapshot CRUD ─────────────────────────────────────────────────

export function insertPriceSnapshot(tokenAddress: string, priceEth: number, source = 'pool') {
  const db = getDb();
  db.prepare(
    'INSERT INTO price_snapshots (token_address, price_eth, source) VALUES (?, ?, ?)',
  ).run(tokenAddress, priceEth, source);
}

export function getPriceSnapshots(
  tokenAddress: string,
  since?: string, // ISO datetime
  limit = 500,
): PriceSnapshot[] {
  const db = getDb();
  if (since) {
    return db.prepare(
      'SELECT * FROM price_snapshots WHERE token_address = ? AND created_at >= ? ORDER BY created_at ASC LIMIT ?',
    ).all(tokenAddress, since, limit) as PriceSnapshot[];
  }
  return db.prepare(
    'SELECT * FROM price_snapshots WHERE token_address = ? ORDER BY created_at DESC LIMIT ?',
  ).all(tokenAddress, limit) as PriceSnapshot[];
}

export function getLatestPrice(tokenAddress: string): PriceSnapshot | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM price_snapshots WHERE token_address = ? ORDER BY created_at DESC LIMIT 1',
  ).get(tokenAddress) as PriceSnapshot | undefined;
}

// ── Payment Deduplication ─────────────────────────────────────────────

export function isPaymentUsed(txHash: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM used_payments WHERE tx_hash = ?').get(txHash);
  return !!row;
}

export function recordPayment(data: {
  txHash: string;
  payerAddress: string;
  amountUsdc: number;
  packageId: string;
  eigenId: string;
}): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO used_payments (tx_hash, payer_address, amount_usdc, package_id, eigen_id) VALUES (?, ?, ?, ?, ?)',
  ).run(data.txHash, data.payerAddress, data.amountUsdc, data.packageId, data.eigenId);
}

export function deletePayment(txHash: string): void {
  const db = getDb();
  db.prepare('DELETE FROM used_payments WHERE tx_hash = ?').run(txHash);
}

// ── LP Compounding ────────────────────────────────────────────────────────

export function updateLpLastCompound(eigenId: string) {
  const db = getDb();
  db.prepare("UPDATE eigen_configs SET lp_last_compound_at = datetime('now') WHERE eigen_id = ?").run(eigenId);
}

export function getEigensWithLP(): EigenConfig[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM eigen_configs WHERE lp_token_id IS NOT NULL AND status = 'active'"
  ).all() as EigenConfig[];
}

// ── Agent API Keys ──────────────────────────────────────────────────────

export interface AgentApiKey {
  id: number;
  key_hash: string;
  key_prefix: string;
  owner_address: string;
  label: string;
  rate_limit: number;
  active: number;
  last_used_at: string | null;
  created_at: string;
}

export function insertAgentApiKey(data: {
  keyHash: string;
  keyPrefix: string;
  ownerAddress: string;
  label: string;
  rateLimit?: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_api_keys (key_hash, key_prefix, owner_address, label, rate_limit)
    VALUES (@keyHash, @keyPrefix, @ownerAddress, @label, @rateLimit)
  `).run({
    keyHash: data.keyHash,
    keyPrefix: data.keyPrefix,
    ownerAddress: data.ownerAddress,
    label: data.label,
    rateLimit: data.rateLimit ?? 60,
  });
}

export function getAgentApiKeyByHash(keyHash: string): AgentApiKey | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_api_keys WHERE key_hash = ? AND active = 1').get(keyHash) as AgentApiKey | undefined;
}

export function getAgentApiKeysByOwner(ownerAddress: string): AgentApiKey[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_api_keys WHERE LOWER(owner_address) = LOWER(?) ORDER BY created_at DESC').all(ownerAddress) as AgentApiKey[];
}

export function deactivateAgentApiKey(keyHash: string): void {
  const db = getDb();
  db.prepare('UPDATE agent_api_keys SET active = 0 WHERE key_hash = ?').run(keyHash);
}

export function touchAgentApiKey(keyHash: string): void {
  const db = getDb();
  db.prepare("UPDATE agent_api_keys SET last_used_at = datetime('now') WHERE key_hash = ?").run(keyHash);
}

// ── Graduation Status ────────────────────────────────────────────────────

export function updateGraduationStatus(eigenId: string, status: 'bonding_curve' | 'graduated', poolAddress?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE eigen_configs SET graduation_status = @status, graduated_pool_address = @poolAddress
    WHERE eigen_id = @eigenId
  `).run({ eigenId, status, poolAddress: poolAddress || null });
}

export function getEigensByGraduationStatus(status: string): EigenConfig[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM eigen_configs WHERE graduation_status = ? AND status = 'active'",
  ).all(status) as EigenConfig[];
}

// ── ERC-8004 Agent Identity ──────────────────────────────────────────────

export function updateAgent8004Id(
  eigenId: string,
  agent8004Id: string,
  chainId: number,
  agentCardUri?: string,
): void {
  const db = getDb();
  db.prepare(`
    UPDATE eigen_configs SET
      agent_8004_id = @agent8004Id,
      agent_8004_chain_id = @chainId,
      agent_card_uri = @agentCardUri
    WHERE eigen_id = @eigenId
  `).run({
    eigenId,
    agent8004Id,
    chainId,
    agentCardUri: agentCardUri || null,
  });
}

export function getEigensWithout8004(): EigenConfig[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM eigen_configs WHERE agent_8004_id IS NULL AND status != 'terminated'"
  ).all() as EigenConfig[];
}

export function getEigenByAgent8004Id(agent8004Id: string): EigenConfig | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM eigen_configs WHERE agent_8004_id = ?'
  ).get(agent8004Id) as EigenConfig | undefined;
}

// ── Reputation Posts (ERC-8004) ─────────────────────────────────────────

export function initReputationPostsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eigen_id TEXT NOT NULL,
      agent_8004_id TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      tag1 TEXT NOT NULL,
      tag2 TEXT NOT NULL,
      value INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      posted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rep_posts_eigen ON reputation_posts(eigen_id);
    CREATE INDEX IF NOT EXISTS idx_rep_posts_agent ON reputation_posts(agent_8004_id);
  `);
}

export function insertReputationPost(data: {
  eigenId: string;
  agent8004Id: string;
  chainId: number;
  tag1: string;
  tag2: string;
  value: number;
  txHash: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO reputation_posts (eigen_id, agent_8004_id, chain_id, tag1, tag2, value, tx_hash)
    VALUES (@eigenId, @agent8004Id, @chainId, @tag1, @tag2, @value, @txHash)
  `).run({
    eigenId: data.eigenId,
    agent8004Id: data.agent8004Id,
    chainId: data.chainId,
    tag1: data.tag1,
    tag2: data.tag2,
    value: data.value,
    txHash: data.txHash,
  });
}

export function getReputationPosts(eigenId: string, limit = 50): {
  id: number; eigen_id: string; agent_8004_id: string; chain_id: number;
  tag1: string; tag2: string; value: number; tx_hash: string; posted_at: string;
}[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM reputation_posts WHERE eigen_id = ? ORDER BY posted_at DESC LIMIT ?'
  ).all(eigenId, limit) as any[];
}

export function getEigensWithAgent8004(): EigenConfig[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM eigen_configs WHERE agent_8004_id IS NOT NULL AND status = 'active'"
  ).all() as EigenConfig[];
}

// ── Chain-Aware Queries ─────────────────────────────────────────────────

export function getEigenConfigsByChain(chainId: number): EigenConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eigen_configs WHERE chain_id = ? ORDER BY created_at DESC').all(chainId) as EigenConfig[];
}

// ── Gas Budget & Protocol Fee ─────────────────────────────────────────

export function recordGasSpent(eigenId: string, ethAmount: number): void {
  const db = getDb();
  db.prepare('UPDATE eigen_configs SET gas_spent_eth = gas_spent_eth + ? WHERE eigen_id = ?').run(ethAmount, eigenId);
}

export function getGasBudgetRemaining(eigenId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT gas_budget_eth, gas_spent_eth FROM eigen_configs WHERE eigen_id = ?').get(eigenId) as { gas_budget_eth: number; gas_spent_eth: number } | undefined;
  if (!row) return 0;
  return row.gas_budget_eth - row.gas_spent_eth;
}

export function insertProtocolFee(eigenId: string, feeEth: string, source: string, txContext?: string): void {
  const db = getDb();
  db.prepare('INSERT INTO protocol_fees (eigen_id, fee_eth, source, tx_context) VALUES (?, ?, ?, ?)').run(eigenId, feeEth, source, txContext ?? null);
}

export function deleteEigenConfig(eigenId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM eigen_configs WHERE eigen_id = ?').run(eigenId);
}

export function getTradeVolumeByEigenIds(eigenIds: string[]): number {
  if (eigenIds.length === 0) return 0;
  const db = getDb();
  const placeholders = eigenIds.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COALESCE(SUM(CAST(eth_amount AS REAL) / 1e18), 0) as total_volume
    FROM trades WHERE eigen_id IN (${placeholders})
  `).get(...eigenIds) as { total_volume: number } | undefined;
  return row?.total_volume || 0;
}
