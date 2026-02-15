import { createPublicClient, createWalletClient, http, type Chain, defineChain } from 'viem';
import { base, mainnet, arbitrum, optimism } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainRpcUrl, DEFAULT_CHAIN_ID, type ChainConfig, getChainConfig } from '@eigenswarm/shared';
import { getKeeperAccount, getMasterPrivateKey as _getMasterPrivateKey } from './key-manager';

// ── Chain Definitions (viem) ─────────────────────────────────────────────

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
});

const VIEM_CHAINS: Record<number, Chain> = {
  8453: base,
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  143: monad,
};

function getViemChain(chainId: number): Chain {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) throw new Error(`No viem chain definition for chainId ${chainId}`);
  return chain;
}

// ── Multi-Chain Client Cache ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publicClients = new Map<number, any>();

export function getPublicClient(chainId: number = DEFAULT_CHAIN_ID) {
  let client = publicClients.get(chainId);
  if (!client) {
    const rpcUrl = getChainRpcUrl(chainId, process.env as Record<string, string | undefined>);
    client = createPublicClient({
      chain: getViemChain(chainId),
      transport: http(rpcUrl),
    });
    publicClients.set(chainId, client);
  }
  return client;
}

// Default public client (Monad) — backward compatible
const rpcUrl = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';

export const publicClient = createPublicClient({
  chain: monad,
  transport: http(rpcUrl),
});

// Register Monad client in the cache on startup
publicClients.set(DEFAULT_CHAIN_ID, publicClient);

// ── Wallet Clients ──────────────────────────────────────────────────────

export function getWalletClient(chainId: number = DEFAULT_CHAIN_ID) {
  const account = getKeeperAccount();
  const chainRpcUrl = getChainRpcUrl(chainId, process.env as Record<string, string | undefined>);

  return createWalletClient({
    account,
    chain: getViemChain(chainId),
    transport: http(chainRpcUrl),
  });
}

export function getKeeperAddress(): `0x${string}` {
  return getKeeperAccount().address;
}

export function getWalletClientForKey(privateKey: `0x${string}`, chainId: number = DEFAULT_CHAIN_ID) {
  const account = privateKeyToAccount(privateKey);
  const chainRpcUrl = getChainRpcUrl(chainId, process.env as Record<string, string | undefined>);

  return createWalletClient({
    account,
    chain: getViemChain(chainId),
    transport: http(chainRpcUrl),
  });
}

/**
 * @deprecated Use key-manager's getKeeperAccount() for new code.
 * Re-exported from key-manager for backward compatibility.
 */
export function getMasterPrivateKey(): `0x${string}` {
  return _getMasterPrivateKey();
}
