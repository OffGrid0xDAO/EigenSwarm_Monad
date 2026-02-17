const KEEPER_API_URL = process.env.NEXT_PUBLIC_KEEPER_API_URL || 'http://localhost:3001';

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${KEEPER_API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

async function postApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KEEPER_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || `API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── Eigen endpoints ─────────────────────────────────────────────────────

export interface ApiEigen {
  id: string;
  owner: string;
  status: string;
  balance: string;
  totalDeposited: string;
  totalWithdrawn: string;
  totalTraded: string;
  totalFees: string;
  feeOwed: string;
  tradeCount: number;
  createdAt: number;
  config: ApiEigenConfig | null;
  pnl: ApiPnlStats | null;
  gasWarning?: {
    needsFunding: boolean;
    keeperAddress: string;
    keeperBalance: string;
  } | null;
  lowBalance?: {
    needsDeposit: boolean;
    currentBalance: string;
    minimumBalance: string;
  } | null;
  // V4 LP on-chain stats (fees, reserves, position share)
  v4LpFees?: {
    unclaimedMon: string;
    unclaimedToken: string;
    poolMonReserve: string;
    poolTokenReserve: string;
    positionLiquidity: string;
    totalPoolLiquidity: string;
    positionSharePct: number;
    tokenPriceMon: number;
    poolFeeBps: number;
  } | null;
  // ERC-8004 identity
  agent8004Id?: string | null;
  agent8004ChainId?: number | null;
  agentCardUri?: string | null;
}

export interface ApiEigenConfig {
  eigen_id: string;
  token_address: string;
  token_symbol: string;
  token_name: string;
  class: string;
  volume_target: number;
  trade_frequency: number;
  order_size_min: number;
  order_size_max: number;
  spread_width: number;
  profit_target: number;
  stop_loss: number;
  rebalance_threshold: number;
  wallet_count: number;
  pool_version: string | null;
  pool_fee: number | null;
  pool_address: string | null;
  owner_address: string;
  status: string;
  slippage_bps: number;
  order_size_pct_min: number;
  order_size_pct_max: number;
  reactive_sell_mode: number;
  reactive_sell_pct: number;
  chain_id: number;
  agent_8004_id: string | null;
  agent_8004_chain_id: number | null;
  agent_card_uri: string | null;
  custom_prompt: string | null;
  created_at: string;
}

export interface ApiPnlStats {
  totalBuys: number;
  totalSells: number;
  totalRealizedPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  tokenBalance: string;
  totalCostEth: number;
  totalGasCost: number;
}

export interface ApiTrade {
  id: number;
  eigen_id: string;
  type: string;
  wallet_address: string;
  token_address: string;
  eth_amount: string;
  token_amount: string;
  price_eth: number;
  pnl_realized: number;
  gas_cost: string;
  tx_hash: string;
  router: string;
  pool_version: string;
  created_at: string;
}

export interface ApiArbStats {
  totalArbs: number;
  totalArbProfit: number;
  arbWinRate: number;
}

export interface ApiPnlSummary {
  eigenId: string;
  tokenAddress: string;
  position: {
    eigenId: string;
    tokenAddress: string;
    tokenBalance: string;
    entryPriceEth: number;
    currentPriceEth: number;
    totalCostEth: number;
    currentValueEth: number;
    unrealizedPnlEth: number;
    unrealizedPnlPercent: number;
    realizedPnlEth: number;
    totalPnlEth: number;
    winRate: number;
    tradeCount: number;
  } | null;
  stats: ApiPnlStats;
  arb?: ApiArbStats;
}

export interface ApiPriceSnapshot {
  id: number;
  token_address: string;
  price_eth: number;
  source: string;
  created_at: string;
}

export interface ApiSubWallet {
  eigen_id: string;
  wallet_index: number;
  address: string;
  last_trade_at: string | null;
  trade_count: number;
  eth_funded: number;
}

export interface ApiPortfolio {
  owner: string;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalVolumeGenerated: number;
  totalLpFeesEarned: number;
  activeEigens: number;
  totalEthDeployed: number;
  eigenCount: number;
}

export interface ApiTokenVerification {
  address: string;
  chainId?: number;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  valid: boolean;
  pool: {
    version: string;
    address: string;
    fee: number;
  } | null;
  price: number;
  nadfun?: {
    isNadfun: boolean;
    graduated: boolean;
    progress: number;
  } | null;
  dexscreener?: {
    chainId: string;
    dexId: string;
    pairAddress: string;
    priceNative?: string;
    priceUsd?: string;
    liquidity?: number;
  } | null;
  error?: string;
}

// ── API functions ───────────────────────────────────────────────────────

export function fetchEigens(ownerAddress?: string): Promise<ApiEigen[]> {
  const query = ownerAddress ? `?owner=${ownerAddress}` : '';
  return fetchApi<ApiEigen[]>(`/api/eigens${query}`);
}

export function fetchEigen(id: string): Promise<ApiEigen> {
  return fetchApi<ApiEigen>(`/api/eigens/${id}`);
}

export function fetchTrades(eigenId: string, limit = 100): Promise<ApiTrade[]> {
  return fetchApi<ApiTrade[]>(`/api/eigens/${eigenId}/trades?limit=${limit}`);
}

export function fetchEigenPnl(id: string): Promise<ApiPnlSummary> {
  return fetchApi<ApiPnlSummary>(`/api/eigens/${id}/pnl`);
}

export function fetchPriceHistory(eigenId: string, range = '1d'): Promise<ApiPriceSnapshot[]> {
  return fetchApi<ApiPriceSnapshot[]>(`/api/eigens/${eigenId}/price-history?range=${range}`);
}

export function fetchWallets(eigenId: string): Promise<ApiSubWallet[]> {
  return fetchApi<ApiSubWallet[]>(`/api/eigens/${eigenId}/wallets`);
}

export function fetchPortfolio(ownerAddress: string): Promise<ApiPortfolio> {
  return fetchApi<ApiPortfolio>(`/api/portfolio?owner=${ownerAddress}`);
}

export function fetchTokenVerification(address: string, chainId?: number): Promise<ApiTokenVerification> {
  const params = chainId ? `?chainId=${chainId}` : '';
  return fetchApi<ApiTokenVerification>(`/api/tokens/${address}/verify${params}`);
}

export function registerEigenConfig(config: Record<string, unknown>): Promise<{ success: boolean; eigenId: string }> {
  return postApi('/api/eigens', config);
}

async function deleteApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KEEPER_API_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function patchApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KEEPER_API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return res.json();
}

export function adjustEigenConfig(
  eigenId: string,
  ownerAddress: string,
  signature: string,
  timestamp: number,
  config: Record<string, number | string | null>,
): Promise<{ success: boolean; config: ApiEigenConfig }> {
  return patchApi(`/api/eigens/${eigenId}`, { ownerAddress, signature, timestamp, config });
}

export function liquidateEigen(
  eigenId: string,
  ownerAddress: string,
  signature: string,
  timestamp: number,
): Promise<{ status: string; eigenId: string }> {
  return postApi(`/api/eigens/${eigenId}/liquidate`, { ownerAddress, signature, timestamp });
}

export function takeProfitEigen(
  eigenId: string,
  body: { ownerAddress: string; signature: string; timestamp: number; percent?: number },
): Promise<{ status: string; eigenId: string; percent: number }> {
  return postApi(`/api/eigens/${eigenId}/take-profit`, body);
}

// ── Monad Token Creation ────────────────────────────────────────────────

export interface CreateMonadTokenResponse {
  success: boolean;
  tokenAddress: string;
  poolAddress: string;
  txHash: string;
  eigenId: string;
  imageUri: string;
}

export function createMonadToken(params: {
  eigenId: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  imageBase64?: string;
  imageContentType?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  devBuyMon?: string;
  class?: string;
  ownerAddress: string;
  signature: string;
  timestamp: number;
}): Promise<CreateMonadTokenResponse> {
  return postApi('/api/tokens/create-monad', params);
}

export interface SeedV4PoolResponse {
  success: boolean;
  poolId: string;
  tokenId: string;
  txHash: string;
}

export function seedMonadV4Pool(
  eigenId: string,
  params: {
    ownerAddress: string;
    signature: string;
    timestamp: number;
    tokenAmount?: string;
    monAmount?: string;
    priceMonPerToken?: string;
    sqrtPriceX96?: string;
  },
): Promise<SeedV4PoolResponse> {
  return postApi(`/api/eigens/${eigenId}/seed-v4-pool`, params);
}

// ── Base launch (single-tx: user sends ETH, keeper does everything) ──────

export interface LaunchBaseTokenParams {
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  class: string;
  feeType?: 'static' | 'dynamic';
  walletCount?: number;
  allocation?: {
    devBuyPct: number;
    liquidityPct: number;
    volumePct: number;
  };
  website?: string;
  twitter?: string;
  telegram?: string;
  ownerAddress: string;
  signature: string;
  timestamp: number;
}

export interface LaunchBaseTokenResponse {
  success: boolean;
  tokenAddress: string;
  tokenSymbol: string;
  eigenId: string;
  agent8004Id: string | null;
  poolId: string | null;
  allocation: {
    totalEth: string;
    devBuyEth: string;
    liquidityEth: string;
    volumeEth: string;
  };
  txHashes: {
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
}

export async function launchToken(
  ethPaymentTxHash: string,
  params: LaunchBaseTokenParams,
): Promise<LaunchBaseTokenResponse> {
  const res = await fetch(`${KEEPER_API_URL}/api/launch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ETH-PAYMENT': ethPaymentTxHash,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Launch failed: ${res.status}`);
  }
  return res.json();
}

export function deleteEigen(
  eigenId: string,
  ownerAddress: string,
  signature: string,
  timestamp: number,
): Promise<{ success: boolean }> {
  return deleteApi(`/api/eigens/${eigenId}`, { ownerAddress, signature, timestamp });
}

export function terminateEigenApi(
  eigenId: string,
  ownerAddress: string,
  signature: string,
  timestamp: number,
): Promise<{ success: boolean }> {
  return postApi(`/api/eigens/${eigenId}/terminate`, { ownerAddress, signature, timestamp });
}
