import type { ClassConfig, AgentClass } from './types';
import { CHAIN_REGISTRY, DEFAULT_CHAIN_ID, getChainConfig } from './chains';

// ─── Chain (backward-compatible exports from chain registry) ────────────────

const defaultChain = getChainConfig(DEFAULT_CHAIN_ID);

export const BASE_CHAIN_ID = DEFAULT_CHAIN_ID; // Note: DEFAULT_CHAIN_ID is Monad (143), name kept for backward compat
export const BASE_RPC_URL = defaultChain.rpcUrl;

// ─── Contracts ──────────────────────────────────────────────────────────────

export const EIGENVAULT_ADDRESS = defaultChain.eigenvault!;
export const EIGENSWARM_FEE_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// ─── Protocol Fee & Gas Budget ─────────────────────────────────────────────

export const PROTOCOL_FEE_BPS = 500;              // 5%
export const GAS_BUDGET_PER_WALLET = '0.0003';     // ETH per sub-wallet
export const EIGENSWARM_REWARD_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const WETH_ADDRESS = defaultChain.weth;

// ─── EigenBundler / EigenLauncher ──────────────────────────────────────────

export const EIGENBUNDLER_ADDRESS = defaultChain.eigenbundler!;
export const EIGENLAUNCHER_ADDRESS = defaultChain.eigenbundler!; // EigenLauncher is the bundler on Monad

// ─── EigenFactory (unused on Monad) ───────────────────────────────────────

export const EIGENFACTORY_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// ─── EigenLP (Hook-Free V4 LP) ─────────────────────────────────────────────

export const EIGENLP_ADDRESS = defaultChain.eigenlp!;
export const UNISWAP_V4_POSITION_MANAGER = defaultChain.uniswapV4PositionManager!;
export const EIGENLP_FEE = 9900 as const;          // 0.99%
export const EIGENLP_TICK_SPACING = 198 as const;

// ─── Uniswap V3 ───────────────────────────────────────────────────────────

export const UNISWAP_V3_SWAP_ROUTER = defaultChain.uniswapV3Router!;
export const UNISWAP_V3_FACTORY = defaultChain.uniswapV3Factory!;

// ─── Uniswap V4 ───────────────────────────────────────────────────────────

export const UNISWAP_V4_UNIVERSAL_ROUTER = defaultChain.uniswapV4UniversalRouter!;
export const UNISWAP_V4_POOL_MANAGER = defaultChain.uniswapV4PoolManager!;
export const UNISWAP_V4_STATE_VIEW = defaultChain.uniswapV4StateView!;
export const PERMIT2_ADDRESS = defaultChain.permit2!;

// ─── Clanker (Base-only) ────────────────────────────────────────────────────

const baseChainForClanker = CHAIN_REGISTRY[8453];
export const CLANKER_V4_FACTORY = baseChainForClanker?.clankerFactories?.[0] ?? ('0x0000000000000000000000000000000000000000' as const);
export const CLANKER_FEE_LOCKER_V4 = '0xf3622742b1e446d92e45e22923ef11c2fcd55d68' as const;
export const CLANKER_V3_FACTORY = baseChainForClanker?.clankerFactories?.[1] ?? ('0x0000000000000000000000000000000000000000' as const);
export const CLANKER_V3_0_FACTORY = baseChainForClanker?.clankerFactories?.[2] ?? ('0x0000000000000000000000000000000000000000' as const);
export const CLANKER_V2_FACTORY = baseChainForClanker?.clankerFactories?.[3] ?? ('0x0000000000000000000000000000000000000000' as const);
export const CLANKER_V1_FACTORY = baseChainForClanker?.clankerFactories?.[4] ?? ('0x0000000000000000000000000000000000000000' as const);
export const ALL_CLANKER_FACTORIES = baseChainForClanker?.clankerFactories ?? ([] as readonly `0x${string}`[]);

// ─── Clanker V4 Pool Constants ─────────────────────────────────────────

export const CLANKER_DYNAMIC_FEE = baseChainForClanker?.clankerDynamicFee ?? 8388608;
export const CLANKER_TICK_SPACING = baseChainForClanker?.clankerTickSpacing ?? 200;
export const CLANKER_KNOWN_HOOKS = baseChainForClanker?.clankerKnownHooks ?? ([] as readonly `0x${string}`[]);

// ─── USDC ───────────────────────────────────────────────────────────────────

export const USDC_ADDRESS = defaultChain.usdc!;

// ─── nad.fun (Monad) ───────────────────────────────────────────────────────

export const NADFUN_BONDING_CURVE_ROUTER = defaultChain.nadfunBondingCurveRouter;
export const NADFUN_DEX_ROUTER = defaultChain.nadfunDexRouter;
export const NADFUN_LENS = defaultChain.nadfunLens;

// ─── ERC-8004 (Trustless Agents) ────────────────────────────────────────────

export const ERC8004_IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
export const ERC8004_REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;

// ─── Agent Classes ──────────────────────────────────────────────────────────

export const CLASS_CONFIGS: Record<AgentClass, ClassConfig> = {
  sentinel: {
    name: 'sentinel',
    label: 'Lite',
    description: 'Low-intensity. Baseline market activity, tight risk controls.',
    volumeRange: [0.5, 2],
    tradesPerHour: [1, 30],
    orderSize: [0.001, 0.01],
    spreadWidth: [1, 3],
    minDeposit: 0.001,
    protocolFee: 3,
    walletCountRange: [1, 5],
  },
  operator: {
    name: 'operator',
    label: 'Core',
    description: 'Steady volume. DexScreener visibility, organic accumulation. Most popular.',
    volumeRange: [2, 10],
    tradesPerHour: [1, 60],
    orderSize: [0.005, 0.05],
    spreadWidth: [0.5, 2],
    minDeposit: 0.2,
    protocolFee: 5,
    walletCountRange: [3, 10],
  },
  architect: {
    name: 'architect',
    label: 'Pro',
    description: 'High-throughput. Multi-wallet distribution, institutional-grade volume.',
    volumeRange: [10, 50],
    tradesPerHour: [1, 120],
    orderSize: [0.01, 0.1],
    spreadWidth: [0.3, 1.5],
    minDeposit: 1,
    protocolFee: 7,
    walletCountRange: [5, 25],
  },
  sovereign: {
    name: 'sovereign',
    label: 'Ultra',
    description: 'Maximum capacity. Whale operations, aggressive campaigns.',
    volumeRange: [50, 200],
    tradesPerHour: [1, 200],
    orderSize: [0.05, 0.5],
    spreadWidth: [0.2, 1],
    minDeposit: 5,
    protocolFee: 10,
    walletCountRange: [10, 100],
  },
};

// ─── Eigen ID Generation ────────────────────────────────────────────────────

export function generateEigenId(): string {
  const arr = new Uint8Array(6);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ES-${hex}`;
}

// ─── Fee Split ──────────────────────────────────────────────────────────────

export const FEE_SPLIT = {
  creator: 40,
  eigenswarm: 40,
  clanker: 20,
} as const;
