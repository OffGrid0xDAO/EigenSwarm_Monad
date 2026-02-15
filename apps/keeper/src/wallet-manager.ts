import { parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { publicClient, getWalletClientForKey } from './client';
import { deriveSubKey, getMasterPrivateKey } from './key-manager';
import { decryptPrivateKey } from './crypto';
import {
  upsertSubWallet,
  getSubWallets,
  updateSubWalletTrade,
  updateSubWalletFunding,
  getGasBudgetRemaining,
  recordGasSpent,
  getEigenConfig,
  getImportedWallets,
  updateImportedWalletTrade,
  type SubWallet,
  type ImportedWallet,
} from './db';

// ── Types ────────────────────────────────────────────────────────────────

export interface DerivedWallet {
  index: number;
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

/**
 * Derive and register sub-wallets for an eigen.
 * Idempotent — can be called multiple times safely.
 */
export function deriveSubWallets(eigenId: string, count: number): DerivedWallet[] {
  const wallets: DerivedWallet[] = [];

  for (let i = 0; i < count; i++) {
    const privateKey = deriveSubKey(eigenId, i);
    const account = privateKeyToAccount(privateKey);

    wallets.push({
      index: i,
      address: account.address,
      privateKey,
    });

    // Persist to DB
    upsertSubWallet({
      eigenId,
      walletIndex: i,
      address: account.address,
    });
  }

  return wallets;
}

/**
 * Get or derive sub-wallets for an eigen.
 */
export function getOrDeriveSubWallets(eigenId: string, count: number): DerivedWallet[] {
  const existing = getSubWallets(eigenId);

  if (existing.length >= count) {
    // Re-derive keys (not stored in DB for security)
    return existing.slice(0, count).map((sw) => {
      const privateKey = deriveSubKey(eigenId, sw.wallet_index);
      return {
        index: sw.wallet_index,
        address: sw.address as `0x${string}`,
        privateKey,
      };
    });
  }

  return deriveSubWallets(eigenId, count);
}

/**
 * Load imported wallets from DB, decrypting private keys.
 */
export function getImportedWalletsDecrypted(eigenId: string): DerivedWallet[] {
  const rows = getImportedWallets(eigenId);
  return rows.map((row) => ({
    index: row.wallet_index,
    address: row.address as `0x${string}`,
    privateKey: decryptPrivateKey(row.encrypted_private_key),
  }));
}

/**
 * Unified wallet getter — picks the right source based on eigen config.
 * If wallet_source is 'imported', loads from imported_wallets table.
 * Otherwise, derives sub-wallets from the keeper's master key.
 */
export function getWalletsForEigen(eigenId: string, count: number): DerivedWallet[] {
  const config = getEigenConfig(eigenId);
  if (config?.wallet_source === 'imported') {
    const imported = getImportedWalletsDecrypted(eigenId);
    if (imported.length > 0) return imported;
    // Fallback to derived if no imported wallets found
    console.warn(`[WalletManager] wallet_source=imported but no imported wallets for ${eigenId}, falling back to derived`);
  }
  return getOrDeriveSubWallets(eigenId, count);
}

// ── Wallet Selection ────────────────────────────────────────────────────

// On Base, each tx costs ~0.00003-0.0001 ETH (L2 gas + L1 blob data fee).
const MIN_GAS_BALANCE = parseEther('0.0001');

/**
 * Select the best sub-wallet for the next trade.
 * Strategy: round-robin with least-recently-traded preference.
 */
export function selectWallet(eigenId: string, wallets: DerivedWallet[]): DerivedWallet {
  if (wallets.length === 0) throw new Error('No wallets available');
  if (wallets.length === 1) return wallets[0]!;

  // Check both sub_wallets and imported_wallets tables for trade history
  const dbSubWallets = getSubWallets(eigenId);
  const dbImported = getImportedWallets(eigenId);

  // Merge trade history from both tables
  const walletMap = new Map<number, { last_trade_at: string | null }>();
  for (const w of dbSubWallets) walletMap.set(w.wallet_index, { last_trade_at: w.last_trade_at });
  for (const w of dbImported) walletMap.set(w.wallet_index, { last_trade_at: w.last_trade_at });

  // Find the wallet with the oldest last_trade_at (or null = never traded)
  let bestWallet = wallets[0]!;
  let oldestTrade = Infinity;

  for (const wallet of wallets) {
    const dbW = walletMap.get(wallet.index);
    if (!dbW || !dbW.last_trade_at) {
      // Never traded — use this one
      bestWallet = wallet;
      break;
    }

    const lastTrade = new Date(dbW.last_trade_at).getTime();
    if (lastTrade < oldestTrade) {
      oldestTrade = lastTrade;
      bestWallet = wallet;
    }
  }

  return bestWallet;
}

// ── Wallet Funding ──────────────────────────────────────────────────────

// Fund enough for a sell cycle (approve + swap + unwrap + returnEth).
// On Base each tx costs ~0.00005 ETH, a full sell cycle is ~4 txs = ~0.0002 ETH.
const FUND_AMOUNT = parseEther('0.0003');

/**
 * Ensure a sub-wallet has enough ETH for gas.
 * Transfers from the master wallet if needed.
 *
 * If eigenId is provided, checks gas budget before funding and records spend.
 * Backward-compatible: eigenId is optional, old callers still work.
 */
export async function fundWalletIfNeeded(wallet: DerivedWallet, eigenId?: string): Promise<void> {
  const balance = await publicClient.getBalance({ address: wallet.address });

  if (balance >= MIN_GAS_BALANCE) return;

  // Check gas budget if eigenId provided
  if (eigenId) {
    const remaining = getGasBudgetRemaining(eigenId);
    if (remaining <= 0) {
      console.warn(`[WalletManager] Gas budget exhausted for ${eigenId} (remaining: ${remaining.toFixed(6)} ETH), skipping funding for ${wallet.address}`);
      return;
    }
  }

  console.log(`[WalletManager] Funding wallet ${wallet.address} (balance: ${formatEther(balance)} ETH)`);

  const masterClient = getWalletClientForKey(getMasterPrivateKey());
  const masterAccount = masterClient.account;
  if (!masterAccount) throw new Error('Master wallet has no account');

  const hash = await masterClient.sendTransaction({
    to: wallet.address,
    value: FUND_AMOUNT,
    chain: masterClient.chain,
    account: masterAccount,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[WalletManager] Funded ${wallet.address} with ${formatEther(FUND_AMOUNT)} ETH: ${hash}`);

  // Record gas spend against eigen's budget
  if (eigenId) {
    recordGasSpent(eigenId, 0.0003);
  }
}

/**
 * Record that a wallet was used for a trade.
 * Dispatches to the correct table based on wallet source.
 */
export function recordWalletTrade(eigenId: string, walletIndex: number): void {
  const config = getEigenConfig(eigenId);
  if (config?.wallet_source === 'imported') {
    updateImportedWalletTrade(eigenId, walletIndex);
  } else {
    updateSubWalletTrade(eigenId, walletIndex);
  }
}
