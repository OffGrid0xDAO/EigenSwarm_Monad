// ─── Agent Classes ───────────────────────────────────────────────────────────

export type AgentClass = 'sentinel' | 'operator' | 'architect' | 'sovereign';

export type EigenStatus = 'active' | 'suspended' | 'terminated' | 'liquidating' | 'liquidated' | 'pending_lp' | 'pending_funding' | 'closed';

export type TradeType = 'buy' | 'sell' | 'rebalance' | 'profit_take' | 'fee_claim' | 'liquidation' | 'reactive_sell';

export type TransactionType = 'deposit' | 'withdraw' | 'terminate';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

// ─── Class Configuration ────────────────────────────────────────────────────

export interface ClassConfig {
  name: AgentClass;
  label: string;
  description: string;
  volumeRange: [number, number];       // ETH per day [min, max]
  tradesPerHour: [number, number];
  orderSize: [number, number];         // ETH per trade [min, max]
  spreadWidth: [number, number];       // percentage [min, max]
  minDeposit: number;                  // ETH
  protocolFee: number;                 // percentage of realized P&L
  walletCountRange: [number, number];  // [min, max] wallets per class
}

// ─── Eigen (Agent) ──────────────────────────────────────────────────────────

export interface Eigen {
  id: string;                          // ES-XXXX
  ownerAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  poolAddress: string;
  class: AgentClass;
  status: EigenStatus;
  vaultEigenId: string;                // bytes32 on-chain ID
  chainId: number;                     // 8453 = Base, 143 = Monad

  // Parameters
  volumeTarget: number;
  tradeFrequency: number;
  orderSizeMin: number;
  orderSizeMax: number;
  orderSizePctMin: number;
  orderSizePctMax: number;
  spreadWidth: number;
  profitTarget: number;
  stopLoss: number;
  rebalanceThreshold: number;
  walletCount: number;
  slippageBps: number;
  reactiveSellMode: boolean;
  reactiveSellPct: number;

  // Balances
  ethDeposited: number;
  ethBalance: number;
  tokenBalance: number;

  // Metrics
  entryPrice: number;
  currentPrice: number;
  volumeGenerated: number;
  tradesExecuted: number;
  realizedPnl: number;
  unrealizedPnl: number;
  lpFeesEarned: number;
  lpFeesClaimed: number;
  protocolFeeAccrued: number;
  totalGasSpent: number;
  winRate: number;

  createdAt: string;
  terminatedAt: string | null;
  updatedAt: string;

  // ERC-8004 Identity
  agent8004Id?: string;        // NFT token ID on identity registry
  agent8004ChainId?: number;   // Chain where 8004 NFT lives
  agentCardUri?: string;       // URI to agent registration file

  // LP / Pool info (from keeper config, not from on-chain EigenLP contract)
  poolVersion?: string | null;   // 'atomic' | 'v4' | null
  lpPoolId?: string | null;      // V4 pool ID (bytes32 hex)

  // AI strategy
  customPrompt?: string | null;

  // Token image (from nad.fun CDN)
  tokenImageUrl?: string | null;

  // Market data (optional — populated when available)
  marketCap?: number;

  // Gas status
  gasWarning?: {
    needsFunding: boolean;
    keeperAddress: string;
    keeperBalance: string;
  } | null;

  // Low vault balance warning
  lowBalance?: {
    needsDeposit: boolean;
    currentBalance: string;
    minimumBalance: string;
  } | null;
}

// ─── Trade ──────────────────────────────────────────────────────────────────

export interface Trade {
  id: number;
  eigenId: string;
  type: TradeType;
  ethAmount: number;
  tokenAmount: number;
  price: number;
  txHash: string;
  pnlImpact: number;
  gasCost: number;
  createdAt: string;
}

// ─── Transaction ────────────────────────────────────────────────────────────

export interface Transaction {
  id: number;
  eigenId: string;
  type: TransactionType;
  amount: number;
  txHash: string;
  status: TransactionStatus;
  createdAt: string;
}

// ─── Token ──────────────────────────────────────────────────────────────────

export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  price: number;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  poolAddress: string;
  poolFee: number;
  isClanker: boolean;
  clankerVersion: 'v3' | 'v4' | null;
}

// ─── Portfolio ──────────────────────────────────────────────────────────────

export interface PortfolioStats {
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalVolumeGenerated: number;
  totalLpFeesEarned: number;
  activeEigens: number;
  totalEthDeployed: number;
}

// ─── Price Snapshot ─────────────────────────────────────────────────────────

export interface PriceSnapshot {
  tokenAddress: string;
  priceEth: number;
  priceUsd: number;
  volume24h: number;
  timestamp: string;
}

// ─── Deploy Params ──────────────────────────────────────────────────────────

export interface DeployEigenParams {
  tokenAddress: string;
  class: AgentClass;
  volumeTarget: number;
  tradeFrequency: number;
  orderSizeMin: number;
  orderSizeMax: number;
  spreadWidth: number;
  profitTarget: number;
  stopLoss: number;
  rebalanceThreshold: number;
  walletCount: number;
  ethDeposit: number;
}

export interface LaunchTokenParams {
  name: string;
  symbol: string;
  image: string;
  description: string;
  socialLinks: string[];
  feeType: 'static' | 'dynamic';
  baseFee: number;
  maxFee: number;
  vaultPercentage: number;
  lockupDays: number;
  vestingDays: number;
  devBuyEth: number;
  mevProtection: {
    blockDelay: boolean;
    descendingFees: boolean;
    sniperAuction: boolean;
  };
}

// ─── API Responses ──────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
