import { publicClient } from './client';
import { ERC20_ABI, EIGENVAULT_ABI, EIGENVAULT_ADDRESS } from '@eigenswarm/shared';
import type { EigenState } from './decision-engine';
import type { DerivedWallet } from './wallet-manager';

// ── Batch RPC Reader ────────────────────────────────────────────────────
// Uses multicall to batch ERC20 balanceOf reads per cycle.
// Reduces N sequential RPC calls to ceil(N / BATCH_SIZE) multicall batches.

const VAULT_ADDRESS = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
const BATCH_SIZE = 100; // max calls per multicall

// ── Batch Token Balance Reads ───────────────────────────────────────────

export interface WalletBalance {
  walletAddress: `0x${string}`;
  walletIndex: number;
  balance: bigint;
}

/**
 * Read token balances for multiple wallets in a single multicall.
 * Returns a map of walletAddress -> balance.
 */
export async function batchGetTokenBalances(
  tokenAddress: `0x${string}`,
  wallets: DerivedWallet[],
): Promise<Map<string, bigint>> {
  if (wallets.length === 0) return new Map();

  const results = new Map<string, bigint>();

  // Split into batches to respect RPC limits
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    const calls = batch.map((w) => ({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [w.address] as const,
    }));

    try {
      const batchResults = await publicClient.multicall({ contracts: calls });

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        const wallet = batch[j]!;
        if (result && result.status === 'success') {
          results.set(wallet.address.toLowerCase(), result.result as bigint);
        } else {
          results.set(wallet.address.toLowerCase(), 0n);
        }
      }
    } catch (error) {
      // Fallback: if multicall fails, set all to 0 (caller should handle)
      console.warn(`[BatchReader] Multicall failed for ${tokenAddress.slice(0, 10)}:`, (error as Error).message);
      for (const w of batch) {
        results.set(w.address.toLowerCase(), 0n);
      }
    }
  }

  return results;
}

// ── Batch Vault Balance Reads ───────────────────────────────────────────

/**
 * Read vault ETH balances for multiple eigens in a single multicall.
 * Returns a map of bytes32Id -> ethBalance (in ETH as number).
 */
export async function batchGetVaultBalances(
  eigenIds: `0x${string}`[],
): Promise<Map<string, bigint>> {
  if (eigenIds.length === 0) return new Map();

  const results = new Map<string, bigint>();

  for (let i = 0; i < eigenIds.length; i += BATCH_SIZE) {
    const batch = eigenIds.slice(i, i + BATCH_SIZE);

    const calls = batch.map((id) => ({
      address: VAULT_ADDRESS,
      abi: EIGENVAULT_ABI,
      functionName: 'getNetBalance' as const,
      args: [id] as const,
    }));

    try {
      const batchResults = await publicClient.multicall({ contracts: calls });

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        const id = batch[j]!;
        if (result && result.status === 'success') {
          results.set(id, result.result as bigint);
        }
      }
    } catch (error) {
      console.warn(`[BatchReader] Vault multicall failed:`, (error as Error).message);
    }
  }

  return results;
}

// ── Batch ETH Balance Reads ─────────────────────────────────────────────

/**
 * Read native ETH balances for multiple addresses in a single multicall.
 * Uses the ETH balance multicall trick (calling Multicall3.getEthBalance).
 */
export async function batchGetEthBalances(
  addresses: `0x${string}`[],
): Promise<Map<string, bigint>> {
  if (addresses.length === 0) return new Map();

  const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
  const results = new Map<string, bigint>();

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);

    const calls = batch.map((addr) => ({
      address: MULTICALL3,
      abi: [{
        type: 'function' as const,
        name: 'getEthBalance',
        inputs: [{ name: 'addr', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
        stateMutability: 'view' as const,
      }] as const,
      functionName: 'getEthBalance' as const,
      args: [addr] as const,
    }));

    try {
      const batchResults = await publicClient.multicall({ contracts: calls });

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        const addr = batch[j]!;
        if (result && result.status === 'success') {
          results.set(addr.toLowerCase(), result.result as bigint);
        }
      }
    } catch (error) {
      console.warn(`[BatchReader] ETH balance multicall failed:`, (error as Error).message);
    }
  }

  return results;
}
