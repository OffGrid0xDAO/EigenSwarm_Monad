// ── SDK Configuration ────────────────────────────────────────────────────

export interface EigenSwarmConfig {
  /** Keeper API base URL (e.g. "https://keeper.eigenswarm.com" or "http://localhost:3001") */
  keeperUrl: string;

  /** API key for authenticated operations (get one via POST /api/agent/keys) */
  apiKey?: string;

  /** Default chain ID (default: 8453 = Base) */
  chainId?: number;

  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

// ── Eigen Management ─────────────────────────────────────────────────────

export interface CreateEigenParams {
  /** Token contract address to market-make */
  tokenAddress: string;
  /** Token symbol (optional, auto-detected if empty) */
  tokenSymbol?: string;
  /** Token name (optional, auto-detected if empty) */
  tokenName?: string;
  /** Agent class: sentinel, operator, architect, sovereign */
  class?: 'sentinel' | 'operator' | 'architect' | 'sovereign';
  /** Daily volume target in ETH */
  volumeTarget?: number;
  /** Trades per hour target */
  tradeFrequency?: number;
  /** Min order size in ETH */
  orderSizeMin?: number;
  /** Max order size in ETH */
  orderSizeMax?: number;
  /** Spread width percentage */
  spreadWidth?: number;
  /** Profit target percentage */
  profitTarget?: number;
  /** Stop loss percentage */
  stopLoss?: number;
  /** Portfolio rebalance threshold */
  rebalanceThreshold?: number;
  /** Number of sub-wallets */
  walletCount?: number;
  /** Chain ID (default: from config) */
  chainId?: number;
}

export interface CreateEigenResult {
  success: boolean;
  eigenId: string;
  chainId: number;
  error?: string;
}

export interface EigenStatus {
  eigenId: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  status: string;
  class: string;
  stats: {
    totalBuys: number;
    totalSells: number;
    totalRealizedPnl: number;
    winRate: number;
  };
  createdAt: string;
}

export interface EigenPnL {
  eigenId: string;
  totalRealizedPnl: number;
  totalBuys: number;
  totalSells: number;
  winCount: number;
  lossCount: number;
  totalGasCost: number;
}

export interface TradeRecord {
  id: number;
  eigenId: string;
  type: string;
  ethAmount: string;
  tokenAmount: string;
  priceEth: number;
  pnlRealized: number;
  txHash: string;
  createdAt: string;
}

export interface TokenPosition {
  eigenId: string;
  tokenAddress: string;
  walletAddress: string;
  amountRaw: string;
  entryPriceEth: number;
  totalCostEth: number;
}

// ── x402 Payment ─────────────────────────────────────────────────────────

export interface VolumePackage {
  id: string;
  ethVolume: number;
  priceUSDC: number;
  duration: string;
}

export interface PaymentRequiredResponse {
  amount: string;
  token: string;
  chain: number;
  recipient: string;
  description: string;
  supportedChains: { chainId: number; name: string; usdc: string }[];
}

export interface BuyVolumeResult {
  success: boolean;
  eigenId: string;
  chainId: number;
  package: string;
  ethVolume: number;
  status: string;
  funding: {
    funded: boolean;
    fundingTx: string | null;
    error: string | null;
  };
  error?: string;
}

export interface FundEigenResult {
  success: boolean;
  eigenId: string;
  status: string;
  paidAmount: number;
  paymentTx: string;
  funding: {
    funded: boolean;
    swapTx: string | null;
    fundTx: string | null;
    ethReceived: string | null;
    error: string | null;
  };
}

// ── Full Token Launch ─────────────────────────────────────────────────────

export interface LaunchParams {
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Token description */
  description?: string;
  /** Token image URL */
  image?: string;
  /** Volume package ID (e.g. 'starter', 'growth', 'pro') */
  packageId: string;
  /** Fee type: 'static' or 'dynamic' (default: 'static') */
  feeType?: 'static' | 'dynamic';
  /** Enable MEV protection (default: true) */
  mevProtection?: boolean;
  /** ETH allocation split (must sum to 100) */
  allocation?: {
    devBuyPct: number;
    liquidityPct: number;
    volumePct: number;
  };
  /** Agent class: sentinel, operator, architect, sovereign */
  class?: 'sentinel' | 'operator' | 'architect' | 'sovereign';
  /** Number of sub-wallets to use */
  walletCount?: number;
  /** Daily volume target in ETH */
  volumeTarget?: number;
  /** Profit target percentage */
  profitTarget?: number;
  /** Stop loss percentage */
  stopLoss?: number;
}

export interface LaunchResult {
  success: boolean;
  tokenAddress: string;
  tokenSymbol: string;
  eigenId: string;
  poolId: string | null;
  allocation: {
    totalEth: string;
    devBuyEth: string;
    liquidityEth: string;
    volumeEth: string;
  };
  txHashes: {
    swap: string;
    deploy: string;
    lp: string | null;
  };
  fees?: {
    protocolFee: string;
    protocolFeeBps: number;
    gasBudget: string;
    walletCount: number;
    deployableEth: string;
  };
  status: string;
  paidBy: string;
  paidAmount: number;
}
