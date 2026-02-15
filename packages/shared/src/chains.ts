// ─── Chain Registry ─────────────────────────────────────────────────────────
// Chain-agnostic configuration for all supported networks.
// Base (8453) is the primary chain with all addresses populated.
// Other chains have placeholder addresses until contracts are deployed.

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  rpcEnvVar: string;                    // env var name for custom RPC override
  weth: `0x${string}`;
  nativeToken: string;                  // 'ETH', 'MATIC', etc.
  nativeDecimals: number;
  blockExplorer: string;
  avgBlockTimeMs: number;

  // Contracts (optional — not all chains have all contracts)
  eigenvault?: `0x${string}`;
  eigenbundler?: `0x${string}`;
  eigenlp?: `0x${string}`;

  // Uniswap V3
  uniswapV3Router?: `0x${string}`;
  uniswapV3Factory?: `0x${string}`;

  // Uniswap V4
  uniswapV4UniversalRouter?: `0x${string}`;
  uniswapV4PoolManager?: `0x${string}`;
  uniswapV4StateView?: `0x${string}`;
  uniswapV4PositionManager?: `0x${string}`;

  // Permit2
  permit2?: `0x${string}`;

  // Stablecoins
  usdc?: `0x${string}`;

  // Clanker (Base-specific, optional on other chains)
  clankerFactories?: readonly `0x${string}`[];
  clankerKnownHooks?: readonly `0x${string}`[];
  clankerDynamicFee?: number;
  clankerTickSpacing?: number;

  // Atomic launcher (Monad-specific, creates token + LP + vault in one tx)
  eigenAtomicLauncher?: `0x${string}`;

  // nad.fun (Monad-specific, optional on other chains)
  nadfunBondingCurveRouter?: `0x${string}`;
  nadfunBondingCurve?: `0x${string}`;
  nadfunDexFactory?: `0x${string}`;
  nadfunDexRouter?: `0x${string}`;
  nadfunLens?: `0x${string}`;
}

// ─── Chain Registry ─────────────────────────────────────────────────────────

export const CHAIN_REGISTRY: Record<number, ChainConfig> = {
  // ── Base (primary chain) ──────────────────────────────────────────────
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'base',
    rpcUrl: 'https://mainnet.base.org',
    rpcEnvVar: 'BASE_RPC_URL',
    weth: '0x4200000000000000000000000000000000000006',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    blockExplorer: 'https://basescan.org',
    avgBlockTimeMs: 2000,

    eigenvault: '0x3aD2b12AE0Fe4bB4e0B0F92624d8D4D87da57a58',
    eigenbundler: '0x246571691Ea5B366Fc4C6c4E765E095ACeF05369',
    eigenlp: '0xDA1495458E85Ff371574f61a383C8797CA420A30',

    uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481',
    uniswapV3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',

    uniswapV4UniversalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
    uniswapV4PoolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    uniswapV4StateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    uniswapV4PositionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc',

    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

    clankerFactories: [
      '0xE85A59c628F7d27878ACeB4bf3b35733630083a9', // V4
      '0x2A787b2362021cC3eEa3C24C4748a6cD5B687382', // V3
      '0x375C15db32D28cEcdcAB5C03Ab889bf15cbD2c5E', // V3-0
      '0x732560fa1d1A76350b1A500155BA978031B53833', // V2
      '0x9B84fcE5Dcd9a38d2D01d5D72373F6b6b067c3e1', // V1
    ],
    clankerKnownHooks: [
      '0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC', // Clanker Static Hook V1
      '0x3609e894F94EedCDD131bEA2f3C3a31Fd149393B', // Clanker Hook V2
    ],
    clankerDynamicFee: 8388608, // 0x800000
    clankerTickSpacing: 200,
  },

  // ── Ethereum Mainnet ──────────────────────────────────────────────────
  1: {
    chainId: 1,
    name: 'Ethereum',
    shortName: 'eth',
    rpcUrl: 'https://eth.llamarpc.com',
    rpcEnvVar: 'ETH_RPC_URL',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    blockExplorer: 'https://etherscan.io',
    avgBlockTimeMs: 12000,

    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',

    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },

  // ── Arbitrum One ──────────────────────────────────────────────────────
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'arb',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rpcEnvVar: 'ARBITRUM_RPC_URL',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    blockExplorer: 'https://arbiscan.io',
    avgBlockTimeMs: 250,

    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',

    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },

  // ── Optimism ──────────────────────────────────────────────────────────
  10: {
    chainId: 10,
    name: 'Optimism',
    shortName: 'op',
    rpcUrl: 'https://mainnet.optimism.io',
    rpcEnvVar: 'OPTIMISM_RPC_URL',
    weth: '0x4200000000000000000000000000000000000006',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    blockExplorer: 'https://optimistic.etherscan.io',
    avgBlockTimeMs: 2000,

    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',

    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },

  // ── Monad ───────────────────────────────────────────────────────────
  143: {
    chainId: 143,
    name: 'Monad',
    shortName: 'monad',
    rpcUrl: 'https://rpc.monad.xyz',
    rpcEnvVar: 'MONAD_RPC_URL',
    weth: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', // WMON
    nativeToken: 'MON',
    nativeDecimals: 18,
    blockExplorer: 'https://monadscan.com',
    avgBlockTimeMs: 400,

    eigenvault: '0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b',
    eigenlp: '0xEf8b421B15Dd0Aa59392431753029A184F3eEc54',
    eigenbundler: '0x9920E8900a154Da216d56F005156FA354835CDAE',
    eigenAtomicLauncher: '0x9920E8900a154Da216d56F005156FA354835CDAE',

    uniswapV3Router: '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900',
    uniswapV3Factory: '0x204faca1764b154221e35c0d20abb3c525710498',

    uniswapV4UniversalRouter: '0x0d97dc33264bfc1c226207428a79b26757fb9dc3',
    uniswapV4PoolManager: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
    uniswapV4PositionManager: '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016',
    uniswapV4StateView: '0x77395f3b2e73ae90843717371294fa97cc419d64',

    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    usdc: '0x754704Bc059F8C67012fEd69BC8a327a5aafb603',

    nadfunBondingCurveRouter: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
    nadfunBondingCurve: '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE',
    nadfunDexFactory: '0x6B5F564339DbAD6b780249827f2198a841FEB7F3',
    nadfunDexRouter: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
    nadfunLens: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export const DEFAULT_CHAIN_ID = 143;

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_REGISTRY[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}. Supported: ${getSupportedChainIds().join(', ')}`);
  }
  return config;
}

export function getChainConfigOrNull(chainId: number): ChainConfig | null {
  return CHAIN_REGISTRY[chainId] ?? null;
}

export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_REGISTRY).map(Number);
}

export function getSupportedChains(): ChainConfig[] {
  return Object.values(CHAIN_REGISTRY);
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAIN_REGISTRY;
}

/**
 * Get the RPC URL for a chain. Accepts an optional env record to check
 * for overrides (e.g. pass `process.env` from the caller).
 */
export function getChainRpcUrl(chainId: number, env?: Record<string, string | undefined>): string {
  const config = getChainConfig(chainId);
  if (env) {
    const envUrl = env[config.rpcEnvVar];
    if (envUrl) return envUrl;
  }
  return config.rpcUrl;
}
