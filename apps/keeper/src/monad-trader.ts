/**
 * Monad Trading Module
 *
 * Vaultless trading on Monad via nad.fun SDK.
 * Handles both bonding curve and graduated (Uniswap) tokens.
 * Trades directly from sub-wallets — no vault contract needed.
 */

import { formatEther, parseEther, maxUint160, maxUint48, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createTrading,
  initSDK,
  createCurveStream,
  type Trading,
  type QuoteResult,
  type NadFunSDK,
  type CreateTokenResult,
  type CurveEvent,
} from '@nadfun/sdk';
import { getPublicClient, getMasterPrivateKey, getWalletClientForKey } from './client';
import {
  getAllEigenConfigs,
  insertTradeRecord,
  insertPriceSnapshot,
  getTokenPositionsByEigen,
  getEigensByGraduationStatus,
  updateGraduationStatus,
  type EigenConfig,
} from './db';
import { updatePositionOnBuy, updatePositionOnSell, getAggregatedPosition } from './pnl-tracker';
import { decideTradeAction, getDeploymentState, type EigenState, type TradeDecision } from './decision-engine';
import { getWalletsForEigen, selectWallet, recordWalletTrade, type DerivedWallet } from './wallet-manager';
import { evaluateTrade, type AIConfig } from './ai-evaluator';
import { buildMarketContext } from './ai-context';
import { getChainRpcUrl, EIGENLP_FEE, EIGENLP_TICK_SPACING, UNISWAP_V4_UNIVERSAL_ROUTER, UNISWAP_V4_POOL_MANAGER, PERMIT2_ADDRESS } from '@eigenswarm/shared';
import { eigenIdToBytes32 } from '@eigenswarm/shared';
import { encodeSwap, type PoolInfo } from './swap-encoder';

const MONAD_CHAIN_ID = 143;
const MONAD_RPC = getChainRpcUrl(MONAD_CHAIN_ID, process.env as Record<string, string | undefined>);
const DEFAULT_SLIPPAGE = 3; // 3% slippage for Monad trades

// ── Trading Instance Cache ──────────────────────────────────────────────

const tradingInstances = new Map<string, Trading>();

function getTradingInstance(privateKey: `0x${string}`): Trading {
  const account = privateKeyToAccount(privateKey);
  const addr = account.address.toLowerCase();
  let instance = tradingInstances.get(addr);
  if (!instance) {
    instance = createTrading({
      rpcUrl: MONAD_RPC,
      privateKey,
      network: 'mainnet',
    });
    tradingInstances.set(addr, instance);
  }
  return instance;
}

// ── SDK Instance (full SDK with token creation) ─────────────────────────

let sdkInstance: NadFunSDK | null = null;

function getSDK(): NadFunSDK {
  if (!sdkInstance) {
    const masterKey = getMasterPrivateKey();
    sdkInstance = initSDK({
      rpcUrl: MONAD_RPC,
      privateKey: masterKey,
      network: 'mainnet',
    });
  }
  return sdkInstance;
}

// ── Token Creation ──────────────────────────────────────────────────────

export interface CreateMonadTokenParams {
  name: string;
  symbol: string;
  description: string;
  image: Buffer;
  imageContentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  website?: string;
  twitter?: string;
  telegram?: string;
  initialBuyMon?: bigint;
}

export async function createMonadToken(
  params: CreateMonadTokenParams,
): Promise<CreateTokenResult> {
  const sdk = getSDK();

  console.log(`[MonadTrader] Creating token: ${params.name} ($${params.symbol})`);
  if (params.initialBuyMon) {
    console.log(`[MonadTrader] Dev buy: ${formatEther(params.initialBuyMon)} MON`);
  }

  const result = await sdk.createToken({
    name: params.name,
    symbol: params.symbol,
    description: params.description,
    image: params.image,
    imageContentType: params.imageContentType,
    website: params.website,
    twitter: params.twitter,
    telegram: params.telegram,
    initialBuyAmount: params.initialBuyMon,
  });

  console.log(`[MonadTrader] Token created: ${result.tokenAddress} pool=${result.poolAddress} tx=${result.transactionHash}`);
  return result;
}

// ── Graduation Monitoring ───────────────────────────────────────────────

let graduationMonitorActive = false;
let activeStream: ReturnType<typeof createCurveStream> | null = null;

export function startGraduationMonitor(): void {
  if (graduationMonitorActive) return;
  graduationMonitorActive = true;

  // Get all bonding curve eigens to watch
  const bondingCurveEigens = getEigensByGraduationStatus('bonding_curve');
  const tokenAddresses = bondingCurveEigens
    .filter((e) => e.token_address && e.token_address.length > 2)
    .map((e) => e.token_address as Address);

  if (tokenAddresses.length === 0) {
    console.log('[MonadTrader] No bonding curve tokens to monitor for graduation');
    graduationMonitorActive = false;
    return;
  }

  console.log(`[MonadTrader] Monitoring ${tokenAddresses.length} tokens for graduation`);

  const MONAD_WS = process.env.MONAD_WS_URL || 'wss://rpc.monad.xyz';

  const stream = createCurveStream({
    wsUrl: MONAD_WS,
    network: 'mainnet',
    tokens: tokenAddresses,
    eventTypes: ['Graduate'],
  });
  activeStream = stream;

  stream.onEvent((event: CurveEvent) => {
    if (event.type !== 'Graduate') return;
    const { token, pool } = event;
    console.log(`[MonadTrader] GRADUATION: token=${token} pool=${pool} block=${event.blockNumber}`);

    // Find the eigen(s) with this token and update graduation status
    const allConfigs = getAllEigenConfigs();
    for (const config of allConfigs) {
      if (config.token_address.toLowerCase() === token.toLowerCase() && config.graduation_status === 'bonding_curve') {
        updateGraduationStatus(config.eigen_id, 'graduated', pool);
        console.log(`[MonadTrader] Updated ${config.eigen_id}: graduated → pool=${pool}`);
      }
    }
  });

  stream.onError((error: Error) => {
    console.error('[MonadTrader] Graduation monitor error:', error.message);
    graduationMonitorActive = false;
    activeStream = null;
    // Retry after delay
    setTimeout(() => startGraduationMonitor(), 30_000);
  });

  stream.start();
}

/**
 * Restart graduation monitor to pick up newly created tokens.
 * Call this after creating a new Monad token so it gets watched for graduation.
 */
export function restartGraduationMonitor(): void {
  if (activeStream) {
    try {
      // Close the existing stream if it has a close/stop method
      (activeStream as any).close?.();
      (activeStream as any).stop?.();
      (activeStream as any).destroy?.();
    } catch {
      // Stream cleanup is best-effort
    }
    activeStream = null;
  }
  graduationMonitorActive = false;
  startGraduationMonitor();
}

// ── Quote ───────────────────────────────────────────────────────────────

export async function getMonadQuote(
  tokenAddress: Address,
  amountIn: bigint,
  isBuy: boolean,
): Promise<QuoteResult> {
  const masterKey = getMasterPrivateKey();
  const trading = getTradingInstance(masterKey);
  return trading.getAmountOut(tokenAddress, amountIn, isBuy);
}

// ── Buy ─────────────────────────────────────────────────────────────────

export async function monadBuy(
  tokenAddress: Address,
  monAmount: bigint,
  wallet: DerivedWallet,
  slippagePct = DEFAULT_SLIPPAGE,
): Promise<{ txHash: Hex; tokenAmount: bigint }> {
  const trading = getTradingInstance(wallet.privateKey);

  // Get quote to determine minAmountOut
  const quote = await trading.getAmountOut(tokenAddress, monAmount, true);
  const minOut = quote.amount - (quote.amount * BigInt(Math.floor(slippagePct * 100))) / 10000n;

  const txHash = await trading.buy(
    {
      token: tokenAddress,
      to: wallet.address,
      amountIn: monAmount,
      amountOutMin: minOut,
    },
    quote.router,
  );

  // Read token balance after trade
  const client = getPublicClient(MONAD_CHAIN_ID);
  await client.waitForTransactionReceipt({ hash: txHash });

  const ERC20_BALANCE = [
    { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  ] as const;
  const tokenBalance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE,
    functionName: 'balanceOf',
    args: [wallet.address],
  }).catch(() => 0n);

  return { txHash, tokenAmount: tokenBalance };
}

// ── Sell ─────────────────────────────────────────────────────────────────

export async function monadSell(
  tokenAddress: Address,
  tokenAmount: bigint,
  wallet: DerivedWallet,
  slippagePct = DEFAULT_SLIPPAGE,
): Promise<{ txHash: Hex; monReceived: bigint }> {
  const trading = getTradingInstance(wallet.privateKey);

  // Get quote for sell
  const quote = await trading.getAmountOut(tokenAddress, tokenAmount, false);
  const minOut = quote.amount - (quote.amount * BigInt(Math.floor(slippagePct * 100))) / 10000n;

  // Approve token for the router if needed
  const client = getPublicClient(MONAD_CHAIN_ID);
  const ERC20_ALLOWANCE = [
    { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
    { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  ] as const;

  const allowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ALLOWANCE,
    functionName: 'allowance',
    args: [wallet.address, quote.router],
  }).catch(() => 0n);

  if (allowance < tokenAmount) {
    const walletClient = getWalletClientForKey(wallet.privateKey, MONAD_CHAIN_ID);
    const approveHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ALLOWANCE,
      functionName: 'approve',
      args: [quote.router, tokenAmount * 2n], // Approve 2x for future trades
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  // Get MON balance before sell to calculate received amount
  const monBefore = BigInt(await client.getBalance({ address: wallet.address }));

  const txHash = await trading.sell(
    {
      token: tokenAddress,
      to: wallet.address,
      amountIn: tokenAmount,
      amountOutMin: minOut,
    },
    quote.router,
  );

  await client.waitForTransactionReceipt({ hash: txHash });
  const monAfter = BigInt(await client.getBalance({ address: wallet.address }));
  const monReceived = monAfter > monBefore ? monAfter - monBefore : 0n;

  return { txHash, monReceived };
}

// ── V4 Direct Swap Functions ─────────────────────────────────────────────
// These bypass the nad.fun SDK and trade directly on Uniswap V4 pools.

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

const ERC20_BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

const ERC20_APPROVE_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

const PERMIT2_ABI = [
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

/**
 * Build a V4 PoolInfo for EigenLP native ETH pools.
 * EigenLP pools: currency0=address(0), no hooks, fee=9900, tickSpacing=198.
 */
function buildEigenLPPool(tokenAddress: Address): PoolInfo {
  return {
    version: 'v4',
    poolAddress: UNISWAP_V4_POOL_MANAGER as string,
    fee: EIGENLP_FEE,
    tickSpacing: EIGENLP_TICK_SPACING,
    hooks: ZERO_ADDRESS,
    token0: ZERO_ADDRESS,
    token1: tokenAddress,
    isWETHPair: false,
  };
}

/**
 * V4 Buy: MON → Token via Universal Router (native ETH pool).
 * Bypasses nad.fun SDK, routes directly through V4.
 */
async function monadV4Buy(
  tokenAddress: Address,
  monAmount: bigint,
  wallet: DerivedWallet,
  pool: PoolInfo,
  slippagePct = DEFAULT_SLIPPAGE,
): Promise<{ txHash: Hex; tokenAmount: bigint }> {
  const client = getPublicClient(MONAD_CHAIN_ID);
  const walletClient = getWalletClientForKey(wallet.privateKey, MONAD_CHAIN_ID);

  // Get token balance before
  const balBefore = BigInt(await client.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [wallet.address],
  }).catch(() => 0n));

  // Encode V4 native ETH buy (minAmountOut=0 for simplicity — we're the primary LP)
  const { router, calldata } = encodeSwap({
    direction: 'buy',
    tokenAddress,
    amount: monAmount,
    pool,
    recipient: wallet.address,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });

  const txHash = await walletClient.sendTransaction({
    to: router,
    data: calldata,
    value: monAmount,
    chain: walletClient.chain,
    account: walletClient.account!,
    gas: 500_000n,
  });

  await client.waitForTransactionReceipt({ hash: txHash });

  const balAfter = BigInt(await client.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [wallet.address],
  }).catch(() => 0n));

  return { txHash, tokenAmount: balAfter > balBefore ? balAfter - balBefore : 0n };
}

/**
 * V4 Sell: Token → MON via Universal Router (native ETH pool).
 * Handles Permit2 approvals (ERC20 → Permit2 → Universal Router).
 */
async function monadV4Sell(
  tokenAddress: Address,
  tokenAmount: bigint,
  wallet: DerivedWallet,
  pool: PoolInfo,
  slippagePct = DEFAULT_SLIPPAGE,
): Promise<{ txHash: Hex; monReceived: bigint }> {
  const client = getPublicClient(MONAD_CHAIN_ID);
  const walletClient = getWalletClientForKey(wallet.privateKey, MONAD_CHAIN_ID);
  const account = walletClient.account!;

  // Step 1: ERC20 approve token → Permit2 (one-time)
  const erc20Allowance = BigInt(await client.readContract({
    address: tokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: 'allowance',
    args: [wallet.address, PERMIT2_ADDRESS],
  }).catch(() => 0n));

  if (erc20Allowance < tokenAmount) {
    console.log(`[MonadTrader] V4 sell: approving token → Permit2...`);
    const approveHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [PERMIT2_ADDRESS, tokenAmount * 100n], // Approve generously for future trades
      chain: walletClient.chain,
      account,
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  // Step 2: Permit2 approve → Universal Router (one-time)
  const [p2Amount, p2Expiration] = await client.readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [wallet.address, tokenAddress, UNISWAP_V4_UNIVERSAL_ROUTER as `0x${string}`],
  }).catch(() => [0n, 0n, 0n] as [bigint, bigint, bigint]);

  if (p2Amount < tokenAmount || p2Expiration < BigInt(Math.floor(Date.now() / 1000))) {
    console.log(`[MonadTrader] V4 sell: setting Permit2 allowance for Universal Router...`);
    const p2Hash = await walletClient.writeContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_ABI,
      functionName: 'approve',
      args: [tokenAddress, UNISWAP_V4_UNIVERSAL_ROUTER as `0x${string}`, maxUint160, Number(maxUint48)],
      chain: walletClient.chain,
      account,
    });
    await client.waitForTransactionReceipt({ hash: p2Hash });
  }

  // Step 3: Get MON balance before sell
  const monBefore = BigInt(await client.getBalance({ address: wallet.address }));

  // Step 4: Encode V4 native ETH sell (no inline permit2 needed — we did on-chain approval)
  const { router, calldata } = encodeSwap({
    direction: 'sell',
    tokenAddress,
    amount: tokenAmount,
    pool,
    recipient: wallet.address,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });

  const txHash = await walletClient.sendTransaction({
    to: router,
    data: calldata,
    chain: walletClient.chain,
    account,
    gas: 500_000n,
  });

  await client.waitForTransactionReceipt({ hash: txHash });
  const monAfter = BigInt(await client.getBalance({ address: wallet.address }));
  const monReceived = monAfter > monBefore ? monAfter - monBefore : 0n;

  return { txHash, monReceived };
}

// ── Get Token Price ─────────────────────────────────────────────────────

async function getMonadTokenPrice(tokenAddress: Address): Promise<number> {
  try {
    // Price = MON per token. Quote: how much MON for 1 token (sell 1e18 tokens)?
    const quote = await getMonadQuote(tokenAddress, parseEther('1'), false);
    return parseFloat(formatEther(quote.amount));
  } catch {
    // Fallback: try DexScreener
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = await res.json();
        const pair = data.pairs?.find((p: any) => p.chainId === 'monad');
        if (pair?.priceNative) return parseFloat(pair.priceNative);
      }
    } catch { }
    return 0;
  }
}

// ── Fund Sub-Wallet on Monad ────────────────────────────────────────────

const MONAD_MIN_GAS = parseEther('0.01');   // MON for gas
const MONAD_FUND_AMOUNT = parseEther('0.05'); // MON to fund

async function fundMonadWalletIfNeeded(wallet: DerivedWallet): Promise<void> {
  const client = getPublicClient(MONAD_CHAIN_ID);
  const balance = await client.getBalance({ address: wallet.address });

  if (balance >= MONAD_MIN_GAS) return;

  console.log(`[MonadTrader] Funding wallet ${wallet.address.slice(0, 10)}... (balance: ${formatEther(balance)} MON)`);

  const masterKey = getMasterPrivateKey();
  const masterClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const masterAccount = masterClient.account;
  if (!masterAccount) throw new Error('Master wallet has no account');

  const hash = await masterClient.sendTransaction({
    to: wallet.address,
    value: MONAD_FUND_AMOUNT,
    chain: masterClient.chain,
    account: masterAccount,
  });

  await client.waitForTransactionReceipt({ hash });
  console.log(`[MonadTrader] Funded ${wallet.address.slice(0, 10)}... with ${formatEther(MONAD_FUND_AMOUNT)} MON`);
}

// ── Build EigenState from DB (no Ponder/vault) ──────────────────────────

function buildMonadEigenState(config: EigenConfig): EigenState {
  // For Monad eigens, ETH balance is tracked via sub-wallet balances in DB
  // We'll estimate from DB positions; actual balances fetched on-chain during trade
  return {
    eigenId: config.eigen_id,
    bytes32Id: eigenIdToBytes32(config.eigen_id),
    owner: config.owner_address,
    ethBalance: 0, // Will be set from on-chain balance
    tradeCount: 0, // Updated from DB
    config,
    pool: null,
  };
}

// ── Main Monad Trade Cycle ──────────────────────────────────────────────

export async function executeMonadTradeCycle(aiConfig: AIConfig): Promise<void> {
  const allConfigs = getAllEigenConfigs();
  const monadConfigs = allConfigs.filter(
    (c) => c.chain_id === MONAD_CHAIN_ID && c.status === 'active',
  );

  if (monadConfigs.length === 0) return;

  const client = getPublicClient(MONAD_CHAIN_ID);

  // Check keeper MON balance on Monad
  const masterKey = getMasterPrivateKey();
  const masterAccount = getTradingInstance(masterKey).account;
  let keeperBalance = 0n;
  try {
    keeperBalance = await client.getBalance({ address: masterAccount.address });
  } catch { }

  if (keeperBalance < parseEther('0.005')) {
    console.error(`[MonadTrader] Keeper MON too low: ${formatEther(keeperBalance)} MON. Fund: ${masterAccount.address}`);
    return;
  }

  console.log(`[MonadTrader] Processing ${monadConfigs.length} Monad eigens (keeper=${formatEther(keeperBalance)} MON)`);

  for (const config of monadConfigs) {
    try {
      await processMonadEigen(config, aiConfig);
    } catch (error) {
      console.error(`[MonadTrader] Error for ${config.eigen_id}:`, (error as Error).message);
    }
  }
}

async function processMonadEigen(config: EigenConfig, aiConfig: AIConfig): Promise<void> {
  const tokenAddress = config.token_address as Address;
  const client = getPublicClient(MONAD_CHAIN_ID);

  // Build eigen state
  const eigen = buildMonadEigenState(config);

  // Calculate effective ETH balance from sub-wallet MON balances
  const wallets = getWalletsForEigen(config.eigen_id, config.wallet_count);
  let totalMon = 0n;
  for (const w of wallets) {
    try {
      const bal = await client.getBalance({ address: w.address });
      totalMon += bal;
    } catch { }
  }
  eigen.ethBalance = parseFloat(formatEther(totalMon));

  // Check graduation status and set pool metadata accordingly
  const isGraduated = config.graduation_status === 'graduated';
  const v4Pool = isGraduated ? buildEigenLPPool(tokenAddress) : null;

  // Get token price for pool data
  const price = await getMonadTokenPrice(tokenAddress);
  if (price > 0) {
    insertPriceSnapshot(config.token_address, price, isGraduated ? 'v4' : 'nadfun');
  }

  // Build pool info for decision engine compatibility
  if (v4Pool) {
    eigen.pool = v4Pool;
  } else {
    const poolAddress = (config.graduated_pool_address || ZERO_ADDRESS) as Address;
    eigen.pool = {
      version: 'nadfun' as any,
      token0: ZERO_ADDRESS,
      token1: tokenAddress,
      fee: 10000,
      poolAddress,
    };
  }

  // Check deployment phase
  const deployState = await getDeploymentState(eigen);
  if (deployState.deploying && eigen.ethBalance > 0.001) {
    console.log(`[MonadTrader] ${eigen.eigenId}: DEPLOYMENT — ${deployState.emptyWalletIndices.length} empty wallets`);
    await executeMonadDeploymentBurst(eigen, wallets, deployState.emptyWalletIndices, v4Pool);
  }

  // Get trade decision
  let decision = await decideTradeAction(eigen);
  if (!decision) {
    const pos = getAggregatedPosition(eigen.eigenId, config.token_address);
    const tokenBal = Number(pos.totalAmount) * 1e-18;
    console.log(`[MonadTrader] ${eigen.eigenId}: no action (mon=${eigen.ethBalance.toFixed(6)} tokens=${tokenBal.toFixed(6)})`);
    return;
  }

  // AI evaluation (if enabled)
  if (aiConfig.enabled && decision) {
    try {
      const pos = getAggregatedPosition(eigen.eigenId, config.token_address);
      const context = buildMarketContext(eigen.eigenId, config.token_address);
      const evaluation = await evaluateTrade(decision, eigen, pos, price, context, aiConfig);

      if (!evaluation.approved) {
        console.log(`[MonadTrader] ${eigen.eigenId}: AI REJECTED (${evaluation.reason})`);
        return;
      }
      if (evaluation.adjustedAmount) {
        decision = { ...decision, ethAmount: decision.ethAmount ? evaluation.adjustedAmount : undefined, tokenAmount: decision.tokenAmount ? evaluation.adjustedAmount : undefined };
      }
    } catch (error) {
      console.warn(`[MonadTrader] ${eigen.eigenId}: AI error, fail-open — ${(error as Error).message}`);
    }
  }

  console.log(`[MonadTrader] ${eigen.eigenId}: decision=${decision.type} reason=${decision.reason}`);

  const isBuyAction = !!decision.ethAmount;
  const isSellAction = !!decision.tokenAmount && !isBuyAction;

  if (isBuyAction) {
    const wallet = selectWallet(eigen.eigenId, wallets);
    await fundMonadWalletIfNeeded(wallet);
    await executeMonadBuy(eigen, decision, wallet, price, v4Pool);
  } else if (isSellAction) {
    let remaining = decision.tokenAmount!;
    for (const w of wallets) {
      if (remaining <= 0n) break;
      const bal = await client.readContract({ address: tokenAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [w.address] }).catch(() => 0n);
      if (bal <= 0n) continue;

      const sellAmt = bal < remaining ? bal : remaining;
      await fundMonadWalletIfNeeded(w);
      await executeMonadSell(eigen, { ...decision, tokenAmount: sellAmt }, w, price, v4Pool);
      remaining -= sellAmt;
    }
  }
}

// ── Execute Monad Buy ───────────────────────────────────────────────────

async function executeMonadBuy(
  eigen: EigenState,
  decision: TradeDecision,
  wallet: DerivedWallet,
  price: number,
  v4Pool: PoolInfo | null = null,
): Promise<void> {
  if (!decision.ethAmount) return;
  const monAmount = decision.ethAmount;
  const monNum = parseFloat(formatEther(monAmount));

  const routerType = v4Pool ? 'v4' : 'nadfun-curve';
  const poolVersion = v4Pool ? 'v4' : 'nadfun';

  try {
    const { txHash, tokenAmount } = v4Pool
      ? await monadV4Buy(eigen.config.token_address as Address, monAmount, wallet, v4Pool)
      : await monadBuy(eigen.config.token_address as Address, monAmount, wallet);

    console.log(`[MonadTrader] BUY ${monNum.toFixed(4)} MON → ${eigen.config.token_symbol} (${eigen.eigenId}) router=${routerType} wallet=${wallet.address.slice(0, 8)}... tx=${txHash}`);

    // Update position tracking
    if (tokenAmount > 0n) {
      updatePositionOnBuy(
        eigen.eigenId,
        wallet.address,
        eigen.config.token_address,
        tokenAmount,
        monNum,
        price,
      );
    }

    // Record trade
    insertTradeRecord({
      eigenId: eigen.eigenId,
      type: 'buy',
      walletAddress: wallet.address,
      tokenAddress: eigen.config.token_address,
      ethAmount: monAmount.toString(),
      tokenAmount: tokenAmount.toString(),
      priceEth: price,
      gasCost: '0',
      txHash,
      router: routerType,
      poolVersion,
    });

    recordWalletTrade(eigen.eigenId, wallet.index);
  } catch (error) {
    console.error(`[MonadTrader] BUY failed for ${eigen.eigenId}:`, (error as Error).message);
  }
}

// ── Execute Monad Sell ──────────────────────────────────────────────────

async function executeMonadSell(
  eigen: EigenState,
  decision: TradeDecision,
  wallet: DerivedWallet,
  price: number,
  v4Pool: PoolInfo | null = null,
): Promise<void> {
  if (!decision.tokenAmount) return;
  const sellAmount = decision.tokenAmount;

  const routerType = v4Pool ? 'v4' : 'nadfun-curve';
  const poolVersion = v4Pool ? 'v4' : 'nadfun';

  try {
    const { txHash, monReceived } = v4Pool
      ? await monadV4Sell(eigen.config.token_address as Address, sellAmount, wallet, v4Pool)
      : await monadSell(eigen.config.token_address as Address, sellAmount, wallet);

    const monNum = parseFloat(formatEther(monReceived));
    console.log(`[MonadTrader] SELL ${(Number(sellAmount) * 1e-18).toFixed(4)} ${eigen.config.token_symbol} → ${monNum.toFixed(4)} MON (${eigen.eigenId}) router=${routerType} tx=${txHash}`);

    // Update position tracking
    const pnl = updatePositionOnSell(
      eigen.eigenId,
      wallet.address,
      eigen.config.token_address,
      sellAmount,
      monNum,
      price,
    );

    // Record trade
    insertTradeRecord({
      eigenId: eigen.eigenId,
      type: decision.type === 'profit_take' ? 'profit_take' : 'sell',
      walletAddress: wallet.address,
      tokenAddress: eigen.config.token_address,
      ethAmount: monReceived.toString(),
      tokenAmount: sellAmount.toString(),
      priceEth: price,
      pnlRealized: pnl,
      gasCost: '0',
      txHash,
      router: routerType,
      poolVersion,
    });

    recordWalletTrade(eigen.eigenId, wallet.index);
  } catch (error) {
    console.error(`[MonadTrader] SELL failed for ${eigen.eigenId}:`, (error as Error).message);
  }
}

// ── Deployment Burst ────────────────────────────────────────────────────

async function executeMonadDeploymentBurst(
  eigen: EigenState,
  wallets: DerivedWallet[],
  emptyWalletIndices: number[],
  v4Pool: PoolInfo | null = null,
): Promise<void> {
  const tokenAddress = eigen.config.token_address as Address;
  const monPerWallet = eigen.ethBalance / (emptyWalletIndices.length + 1);
  const price = await getMonadTokenPrice(tokenAddress);

  const routerType = v4Pool ? 'v4' : 'nadfun-curve';
  const poolVersion = v4Pool ? 'v4' : 'nadfun';

  for (const idx of emptyWalletIndices) {
    const wallet = wallets.find((w) => w.index === idx);
    if (!wallet) continue;

    const buyAmount = BigInt(Math.floor(monPerWallet * 0.8 * 1e18)); // 80% of allocation (keep some for gas)
    if (buyAmount <= parseEther('0.001')) continue;

    await fundMonadWalletIfNeeded(wallet);

    try {
      const { txHash, tokenAmount } = v4Pool
        ? await monadV4Buy(tokenAddress, buyAmount, wallet, v4Pool)
        : await monadBuy(tokenAddress, buyAmount, wallet);

      console.log(`[MonadTrader] DEPLOY BUY ${formatEther(buyAmount)} MON → ${eigen.config.token_symbol} router=${routerType} wallet=${wallet.address.slice(0, 8)}... tx=${txHash}`);

      if (tokenAmount > 0n) {
        updatePositionOnBuy(eigen.eigenId, wallet.address, eigen.config.token_address, tokenAmount, parseFloat(formatEther(buyAmount)), price);
      }

      insertTradeRecord({
        eigenId: eigen.eigenId,
        type: 'buy',
        walletAddress: wallet.address,
        tokenAddress: eigen.config.token_address,
        ethAmount: buyAmount.toString(),
        tokenAmount: tokenAmount.toString(),
        priceEth: price,
        gasCost: '0',
        txHash,
        router: routerType,
        poolVersion,
      });

      recordWalletTrade(eigen.eigenId, wallet.index);
    } catch (error) {
      console.error(`[MonadTrader] Deploy buy failed wallet ${idx}:`, (error as Error).message);
    }
  }
}
