import type {
  EigenSwarmConfig,
  CreateEigenParams,
  CreateEigenResult,
  EigenStatus,
  EigenPnL,
  TradeRecord,
  TokenPosition,
  VolumePackage,
  PaymentRequiredResponse,
  BuyVolumeResult,
  FundEigenResult,
  LaunchParams,
  LaunchResult,
} from './types';

/**
 * EigenSwarm SDK Client
 *
 * Two modes of operation:
 *
 * 1. **API Key mode** (recommended for agents):
 *    - Get an API key once via EIP-191 signature
 *    - All subsequent calls use X-API-KEY header
 *    - No wallet/signing needed for API calls
 *
 * 2. **x402 mode** (pay-and-go):
 *    - Send USDC to the keeper's payment address
 *    - Keeper auto-funds the eigen from its ETH treasury
 *    - Agent never touches ETH or vault contracts
 *
 * @example
 * ```typescript
 * import { EigenSwarmClient } from '@eigenswarm/sdk';
 *
 * const client = new EigenSwarmClient({
 *   keeperUrl: 'https://keeper.eigenswarm.com',
 *   apiKey: 'esk_abc123...',
 * });
 *
 * // Create a market-making eigen for a token
 * const result = await client.createEigen({
 *   tokenAddress: '0x...',
 *   class: 'operator',
 *   volumeTarget: 5,
 * });
 *
 * // Monitor it
 * const pnl = await client.getPnL(result.eigenId);
 * console.log(`Realized P&L: ${pnl.totalRealizedPnl} ETH`);
 *
 * // Take profit when ready
 * await client.takeProfit(result.eigenId, 50); // sell 50% of positions
 * ```
 */
export class EigenSwarmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultChainId: number;
  private readonly timeoutMs: number;

  constructor(config: EigenSwarmConfig) {
    this.baseUrl = config.keeperUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.defaultChainId = config.chainId ?? 143;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  // ── HTTP Helpers ──────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new EigenSwarmError(
          data.error || `HTTP ${response.status}`,
          response.status,
          data,
        );
      }

      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Health & Info ──────────────────────────────────────────────────────

  /** Check if the keeper is healthy and running */
  async health(): Promise<{
    status: string;
    uptime: number;
    keeperAddress: string;
    keeperBalance: string;
  }> {
    return this.request('GET', '/api/health');
  }

  /** Get supported chains and their capabilities */
  async getChains(): Promise<{
    data: {
      chainId: number;
      name: string;
      shortName: string;
      hasEigenVault: boolean;
    }[];
  }> {
    return this.request('GET', '/api/chains');
  }

  /** Get treasury health (can the keeper fund eigens?) */
  async getTreasuryHealth(): Promise<{
    keeperAddress: string;
    ethBalance: string;
    canFundEigens: boolean;
  }> {
    return this.request('GET', '/api/treasury');
  }

  // ── Eigen Management ──────────────────────────────────────────────────

  /**
   * Create a new market-making eigen for a token.
   * Requires API key authentication.
   */
  async createEigen(params: CreateEigenParams): Promise<CreateEigenResult> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required to create eigens', 401);
    }

    return this.request('POST', '/api/agent/eigens', {
      tokenAddress: params.tokenAddress,
      tokenSymbol: params.tokenSymbol,
      tokenName: params.tokenName,
      class: params.class ?? 'operator',
      volumeTarget: params.volumeTarget,
      tradeFrequency: params.tradeFrequency,
      orderSizeMin: params.orderSizeMin,
      orderSizeMax: params.orderSizeMax,
      spreadWidth: params.spreadWidth,
      profitTarget: params.profitTarget,
      stopLoss: params.stopLoss,
      rebalanceThreshold: params.rebalanceThreshold,
      walletCount: params.walletCount,
      chainId: params.chainId ?? this.defaultChainId,
    });
  }

  /** List all eigens owned by the authenticated agent */
  async listEigens(chainId?: number): Promise<{ data: EigenStatus[] }> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required', 401);
    }

    const params = chainId ? `?chainId=${chainId}` : '';
    return this.request('GET', `/api/agent/eigens${params}`);
  }

  /** Get detailed info about a specific eigen */
  async getEigen(eigenId: string): Promise<{ data: Record<string, unknown> }> {
    return this.request('GET', `/api/eigens/${eigenId}`);
  }

  /** Update eigen configuration */
  async updateEigen(
    eigenId: string,
    config: Partial<CreateEigenParams>,
  ): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required', 401);
    }

    return this.request('PATCH', `/api/agent/eigens/${eigenId}`, {
      config,
    });
  }

  // ── Trading Data ──────────────────────────────────────────────────────

  /** Get P&L summary for an eigen */
  async getPnL(eigenId: string): Promise<EigenPnL> {
    const result = await this.request<{ data: EigenPnL }>('GET', `/api/eigens/${eigenId}/pnl`);
    return result.data;
  }

  /** Get trade history for an eigen */
  async getTrades(eigenId: string, limit = 50): Promise<{ data: TradeRecord[] }> {
    return this.request('GET', `/api/eigens/${eigenId}/trades?limit=${limit}`);
  }

  /** Get current token positions for an eigen */
  async getPositions(eigenId: string): Promise<{ data: TokenPosition[] }> {
    return this.request('GET', `/api/eigens/${eigenId}/positions`);
  }

  /** Get price history for an eigen's token */
  async getPriceHistory(
    eigenId: string,
    since?: string,
  ): Promise<{ data: { priceEth: number; createdAt: string }[] }> {
    const params = since ? `?since=${since}` : '';
    return this.request('GET', `/api/eigens/${eigenId}/price-history${params}`);
  }

  // ── Trading Actions ───────────────────────────────────────────────────

  /**
   * Take profit — sell a percentage of all positions.
   * @param eigenId - Eigen to take profit from
   * @param percent - Percentage of positions to sell (1-100, default 100)
   */
  async takeProfit(eigenId: string, percent = 100): Promise<{ status: string }> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required', 401);
    }

    return this.request('POST', `/api/agent/eigens/${eigenId}/take-profit`, {
      percent,
    });
  }

  /** Initiate full liquidation of an eigen */
  async liquidate(eigenId: string): Promise<{ status: string }> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required', 401);
    }

    return this.request('POST', `/api/agent/eigens/${eigenId}/liquidate`, {});
  }

  // ── x402 Payment Flow ─────────────────────────────────────────────────

  /** Get available volume packages and pricing */
  async getPricing(): Promise<{
    packages: VolumePackage[];
    paymentToken: string;
    supportedChains: { chainId: number; name: string; usdc: string }[];
    paymentAddress: string;
  }> {
    return this.request('GET', '/api/pricing');
  }

  /**
   * Purchase a volume package via x402 payment.
   *
   * Flow:
   * 1. Call this with no paymentTxHash → get 402 with payment details
   * 2. Send USDC to the payment address on the specified chain
   * 3. Call this again with the USDC tx hash → eigen is created and auto-funded
   *
   * @param tokenAddress - Token to market-make
   * @param packageId - Package: 'starter', 'growth', 'pro', 'whale'
   * @param paymentTxHash - USDC transfer tx hash (omit for step 1)
   * @param paymentChainId - Chain where payment was made (default: 8453)
   */
  async buyVolume(
    tokenAddress: string,
    packageId: string,
    paymentTxHash?: string,
    paymentChainId?: number,
  ): Promise<BuyVolumeResult | PaymentRequiredResponse> {
    const body: Record<string, unknown> = {
      tokenAddress,
      packageId,
      chainId: this.defaultChainId,
    };

    if (paymentChainId) {
      body.paymentChainId = paymentChainId;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
    }

    if (paymentTxHash) {
      headers['X-PAYMENT'] = paymentTxHash;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/agents/buy-volume`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json();

      if (response.status === 402) {
        // Payment required — return payment instructions
        return data as PaymentRequiredResponse;
      }

      if (!response.ok) {
        throw new EigenSwarmError(data.error || `HTTP ${response.status}`, response.status, data);
      }

      return data as BuyVolumeResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fund an existing eigen via x402 payment.
   *
   * Flow mirrors buyVolume():
   * 1. Call with no paymentTxHash → get 402 with payment details
   * 2. Send USDC to the payment address
   * 3. Call again with the USDC tx hash → eigen is funded
   *
   * @param eigenId - Eigen to fund
   * @param packageId - Package for pricing: 'starter', 'growth', 'pro', 'whale'
   * @param paymentTxHash - USDC transfer tx hash (omit for step 1)
   * @param paymentChainId - Chain where payment was made (default: 8453)
   */
  async fundEigen(
    eigenId: string,
    packageId: string,
    paymentTxHash?: string,
    paymentChainId?: number,
  ): Promise<FundEigenResult | PaymentRequiredResponse> {
    if (!this.apiKey) {
      throw new EigenSwarmError('API key required to fund eigens', 401);
    }

    const body: Record<string, unknown> = { packageId };
    if (paymentChainId) body.paymentChainId = paymentChainId;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-KEY': this.apiKey,
    };

    if (paymentTxHash) {
      headers['X-PAYMENT'] = paymentTxHash;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/agent/eigens/${eigenId}/fund`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json();

      if (response.status === 402) {
        return data as PaymentRequiredResponse;
      }

      if (!response.ok) {
        throw new EigenSwarmError(data.error || `HTTP ${response.status}`, response.status, data);
      }

      return data as FundEigenResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Full Token Launch ────────────────────────────────────────────────

  /**
   * Launch a new token: deploy via Clanker + dev buy + LP seed + eigen creation.
   *
   * Flow:
   * 1. Call with no paymentTxHash → get 402 with payment details
   * 2. Send USDC to the payment address on the specified chain
   * 3. Call again with the USDC tx hash → token deployed, LP seeded, eigen active
   *
   * @param params - Launch parameters (name, symbol, packageId, allocation, etc.)
   * @param paymentTxHash - USDC transfer tx hash (omit for step 1)
   * @param paymentChainId - Chain where payment was made (default: 8453)
   */
  async launch(
    params: LaunchParams,
    paymentTxHash?: string,
    paymentChainId?: number,
  ): Promise<LaunchResult | PaymentRequiredResponse> {
    const body: Record<string, unknown> = { ...params };
    if (paymentChainId) body.paymentChainId = paymentChainId;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
    }

    if (paymentTxHash) {
      headers['X-PAYMENT'] = paymentTxHash;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/launch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json();

      if (response.status === 402) {
        return data as PaymentRequiredResponse;
      }

      if (!response.ok) {
        throw new EigenSwarmError(data.error || `HTTP ${response.status}`, response.status, data);
      }

      return data as LaunchResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Token Verification ────────────────────────────────────────────────

  /** Verify a token address is valid and has a trading pool */
  async verifyToken(tokenAddress: string): Promise<{
    valid: boolean;
    name: string;
    symbol: string;
    decimals: number;
    pool: { version: string; fee: number } | null;
  }> {
    return this.request('GET', `/api/tokens/${tokenAddress}/verify`);
  }
}

// ── Error Class ──────────────────────────────────────────────────────────

export class EigenSwarmError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'EigenSwarmError';
  }
}
