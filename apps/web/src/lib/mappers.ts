import type { Eigen, Trade, PortfolioStats, AgentClass, EigenStatus } from '@eigenswarm/shared';
import type { ApiEigen, ApiTrade, ApiPortfolio, ApiPnlSummary } from './api';
import { formatEther } from 'viem';

/**
 * Map keeper API eigen response to frontend Eigen type.
 */
export function mapApiEigenToEigen(api: ApiEigen, pnl?: ApiPnlSummary | null): Eigen {
  const config = api.config;
  const position = pnl?.position;

  const status = normalizeStatus(api.status || config?.status || 'active');
  const balance = safeParseEth(api.balance);
  const totalDeposited = safeParseEth(api.totalDeposited);

  return {
    id: api.id,
    ownerAddress: api.owner || config?.owner_address || '',
    tokenAddress: config?.token_address || '',
    tokenSymbol: config?.token_symbol || '???',
    tokenName: config?.token_name || 'Unknown',
    poolAddress: config?.pool_address || '',
    class: (config?.class || 'operator') as AgentClass,
    status,
    vaultEigenId: api.id,
    chainId: config?.chain_id ?? 143,

    // Parameters
    volumeTarget: config?.volume_target ?? 5,
    tradeFrequency: config?.trade_frequency ?? 12,
    orderSizeMin: config?.order_size_min ?? 0.005,
    orderSizeMax: config?.order_size_max ?? 0.05,
    orderSizePctMin: config?.order_size_pct_min ?? 10,
    orderSizePctMax: config?.order_size_pct_max ?? 30,
    spreadWidth: config?.spread_width ?? 1.2,
    profitTarget: config?.profit_target ?? 50,
    stopLoss: config?.stop_loss ?? 30,
    rebalanceThreshold: config?.rebalance_threshold ?? 0.7,
    walletCount: config?.wallet_count ?? 3,
    slippageBps: config?.slippage_bps ?? 200,
    reactiveSellMode: config?.reactive_sell_mode === 1,
    reactiveSellPct: config?.reactive_sell_pct ?? 100,

    // Balances
    ethDeposited: totalDeposited,
    ethBalance: balance,
    tokenBalance: position?.tokenBalance
      ? Number(BigInt(position.tokenBalance)) * 1e-18
      : api.pnl?.tokenBalance
        ? Number(BigInt(api.pnl.tokenBalance)) * 1e-18
        : 0,

    // Metrics
    entryPrice: position?.entryPriceEth ?? 0,
    currentPrice: position?.currentPriceEth ?? 0,
    volumeGenerated: safeParseEth(api.totalTraded),
    tradesExecuted: api.tradeCount || 0,
    realizedPnl: position?.realizedPnlEth ?? api.pnl?.totalRealizedPnl ?? 0,
    unrealizedPnl: position?.unrealizedPnlEth ?? 0,
    lpFeesEarned: 0,
    lpFeesClaimed: 0,
    protocolFeeAccrued: safeParseEth(api.totalFees),
    totalGasSpent: (api.pnl?.totalGasCost ?? 0) / 1e18,
    winRate: position?.winRate ?? api.pnl?.winRate ?? 0,

    createdAt: api.createdAt
      ? new Date(api.createdAt * 1000).toISOString()
      : config?.created_at || new Date().toISOString(),
    terminatedAt: status === 'terminated' || status === 'closed' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),

    // AI strategy
    customPrompt: config?.custom_prompt || null,

    // ERC-8004 identity
    agent8004Id: api.agent8004Id || config?.agent_8004_id || undefined,
    agent8004ChainId: api.agent8004ChainId || config?.agent_8004_chain_id || undefined,
    agentCardUri: api.agentCardUri || config?.agent_card_uri || undefined,

    // Gas status
    gasWarning: api.gasWarning || null,

    // Low vault balance warning
    lowBalance: api.lowBalance || null,
  };
}

/**
 * Map keeper API trade to frontend Trade type.
 */
export function mapApiTradeToTrade(api: ApiTrade): Trade {
  return {
    id: api.id,
    eigenId: api.eigen_id,
    type: api.type as Trade['type'],
    ethAmount: parseFloat(api.eth_amount) / 1e18,
    tokenAmount: parseFloat(api.token_amount) / 1e18,
    price: api.price_eth,
    txHash: api.tx_hash,
    pnlImpact: api.pnl_realized,
    gasCost: parseFloat(api.gas_cost) / 1e18,
    createdAt: api.created_at,
  };
}

/**
 * Map portfolio API response to frontend PortfolioStats.
 */
export function mapApiPortfolio(api: ApiPortfolio): PortfolioStats {
  return {
    totalUnrealizedPnl: api.totalUnrealizedPnl,
    totalRealizedPnl: api.totalRealizedPnl,
    totalVolumeGenerated: api.totalVolumeGenerated,
    totalLpFeesEarned: api.totalLpFeesEarned,
    activeEigens: api.activeEigens,
    totalEthDeployed: api.totalEthDeployed,
  };
}

function normalizeStatus(status: string): EigenStatus {
  const lower = status.toLowerCase();
  if (lower === 'active') return 'active';
  if (lower === 'suspended') return 'suspended';
  if (lower === 'terminated') return 'terminated';
  if (lower === 'liquidating') return 'liquidating';
  if (lower === 'liquidated') return 'liquidated';
  if (lower === 'pending_lp') return 'pending_lp';
  if (lower === 'pending_funding') return 'pending_funding';
  if (lower === 'closed') return 'closed';
  return 'active';
}

function safeParseEth(value: string | undefined | null): number {
  if (!value || value === '0') return 0;
  try {
    return parseFloat(formatEther(BigInt(value)));
  } catch {
    return parseFloat(value) || 0;
  }
}
