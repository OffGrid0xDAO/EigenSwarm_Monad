import { getPublicClient } from './client';
import { DEFAULT_CHAIN_ID } from '@eigenswarm/shared';

// ── Nonce Manager ───────────────────────────────────────────────────────
// Per-address nonce tracking with async lock for safe concurrent tx submission.
// - Reads nonce from chain on first use
// - Increments locally for subsequent txs (avoids round-trip per tx)
// - Invalidates on tx failure (re-reads from chain)

interface NonceState {
  current: number;
  initialized: boolean;
  lock: Promise<void>;
  unlock: (() => void) | null;
}

const nonceStates = new Map<string, NonceState>();

function getState(address: string): NonceState {
  const key = address.toLowerCase();
  let state = nonceStates.get(key);
  if (!state) {
    state = {
      current: 0,
      initialized: false,
      lock: Promise.resolve(),
      unlock: null,
    };
    nonceStates.set(key, state);
  }
  return state;
}

/**
 * Acquire an async lock on the nonce for a given address.
 * Returns the nonce to use and a release function.
 *
 * Usage:
 * ```
 * const { nonce, release, invalidate } = await acquireNonce(address);
 * try {
 *   await sendTx({ nonce });
 *   release();
 * } catch (e) {
 *   invalidate(); // re-reads nonce from chain on next acquire
 *   throw e;
 * }
 * ```
 */
export async function acquireNonce(
  address: `0x${string}`,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{
  nonce: number;
  release: () => void;
  invalidate: () => void;
}> {
  const state = getState(address);

  // Wait for any existing lock to release
  await state.lock;

  // Create a new lock
  let releaseFn: () => void;
  state.lock = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });

  // Initialize from chain if needed
  if (!state.initialized) {
    const client = getPublicClient(chainId);
    state.current = await client.getTransactionCount({ address });
    state.initialized = true;
  }

  const nonce = state.current;
  state.current++; // optimistically increment for next caller

  return {
    nonce,
    release: () => {
      releaseFn!();
    },
    invalidate: () => {
      // Reset so next acquire re-reads from chain
      state.initialized = false;
      state.current = 0;
      releaseFn!();
    },
  };
}

/**
 * Invalidate cached nonce for an address (e.g., after detecting a failed tx).
 * Next acquireNonce() will re-read from chain.
 */
export function invalidateNonce(address: `0x${string}`): void {
  const key = address.toLowerCase();
  const state = nonceStates.get(key);
  if (state) {
    state.initialized = false;
    state.current = 0;
  }
}

/**
 * Clear all cached nonces (e.g., at the start of each trade cycle).
 */
export function resetAllNonces(): void {
  nonceStates.clear();
}
