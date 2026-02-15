import { keccak256, concat, toHex, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Key Manager ─────────────────────────────────────────────────────────
// Centralizes all master key access. Provides:
// - Single point of access for the keeper private key
// - Deterministic sub-key derivation
// - Audit logging for signing operations
// - Cleanup on process exit
// Designed as the abstraction layer for future KMS integration (Phase 3).

let masterKey: `0x${string}` | null = null;
let keeperAccount: Account | null = null;
let signingOpCount = 0;

function ensureKey(): `0x${string}` {
  if (masterKey) return masterKey;
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) throw new Error('KEEPER_PRIVATE_KEY not set');
  masterKey = key as `0x${string}`;
  return masterKey;
}

/**
 * Get the keeper's viem Account (address + signing functions).
 * Does NOT expose the raw private key.
 */
export function getKeeperAccount(): Account {
  if (keeperAccount) return keeperAccount;
  keeperAccount = privateKeyToAccount(ensureKey());
  return keeperAccount;
}

/**
 * Get the keeper's address without exposing the key.
 */
export function getKeeperAddressFromKey(): `0x${string}` {
  return getKeeperAccount().address;
}

/**
 * Derive a deterministic sub-wallet private key.
 * Uses keccak256(masterKey + eigenId + index) for uniqueness.
 */
export function deriveSubKey(eigenId: string, index: number): `0x${string}` {
  const key = ensureKey();
  auditLog('derive_sub_key', { eigenId, index });
  return keccak256(
    concat([
      key as `0x${string}`,
      toHex(eigenId),
      toHex(index, { size: 32 }),
    ]),
  );
}

/**
 * Get the raw master private key.
 * @deprecated Use getKeeperAccount() instead for new code.
 * Kept for backward compatibility with monad-trader.ts and monad-lp.ts.
 */
export function getMasterPrivateKey(): `0x${string}` {
  auditLog('master_key_access', {});
  return ensureKey();
}

/**
 * Record a master-key signing operation for audit.
 */
export function auditSign(operation: string, details: Record<string, unknown>): void {
  signingOpCount++;
  auditLog(operation, details);
}

function auditLog(operation: string, details: Record<string, unknown>): void {
  // Structured audit log — only to stdout in production
  // Avoids logging to external services to prevent key material leaks
  if (process.env.AUDIT_LOG === 'true') {
    console.log(JSON.stringify({
      _audit: true,
      op: operation,
      ts: new Date().toISOString(),
      sigCount: signingOpCount,
      ...details,
    }));
  }
}

/**
 * Zero-fill key material on shutdown.
 * Not cryptographically guaranteed in JS (GC may copy strings),
 * but reduces the window of exposure.
 */
function cleanup(): void {
  masterKey = null;
  keeperAccount = null;
}

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
