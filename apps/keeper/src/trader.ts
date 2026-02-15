import { parseEther, formatEther, formatGwei } from 'viem';
import { publicClient, getWalletClient, getWalletClientForKey, getKeeperAddress } from './client';
import { getAllEigenConfigs, insertTradeRecord, insertPriceSnapshot, updateEigenConfigStatus, getTokenPositionsByEigen, getTokenPosition, type EigenConfig } from './db';
import { fetchActiveEigens, type PonderEigen } from './ponder';
import { getCachedOnChainEigens } from './recovery';
import { EIGENVAULT_ABI, EIGENVAULT_ADDRESS, eigenIdToBytes32 } from '@eigenswarm/shared';
import { encodeSwap, type PoolInfo } from './swap-encoder';
import { resolvePool } from './pool-resolver';
import { getTokenPriceEth, getTokenPriceWithFallback } from './price-oracle';
import { updatePositionOnBuy, updatePositionOnSell, getAggregatedPosition } from './pnl-tracker';
import { decideTradeAction, getDeploymentState, type EigenState, type TradeDecision } from './decision-engine';
import { getWalletsForEigen, selectWallet, fundWalletIfNeeded, recordWalletTrade, type DerivedWallet } from './wallet-manager';
import { executeSell, getTokenBalance, recoverWeth, recoverStrandedEth, fundKeeperFromSubWallet } from './sell-executor';
import { ERC20_ABI } from '@eigenswarm/shared';
import { evaluateTrade, type AIConfig } from './ai-evaluator';
import { buildMarketContext } from './ai-context';
import { executeMonadTradeCycle } from './monad-trader';
import { logTrade, trackSpend, alertKeeperGas, alertConsecutiveFailures } from './alerting';
import { resetAllNonces } from './nonce-manager';
import { sortByPriority, GasBudgetTracker } from './gas-budget';

// ── Concurrency Limiter ─────────────────────────────────────────────────
// Simple p-limit equivalent to avoid ESM-only dependency issues.

function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

const TRADE_CONCURRENCY = parseInt(process.env.TRADE_CONCURRENCY || '5', 10);

// ── AI Configuration ────────────────────────────────────────────────────
// Initialized from index.ts via setAIConfig()
let aiConfig: AIConfig = {
  enabled: false,
  provider: 'gemini',
  model: '',
  confidenceThreshold: 70,
  timeoutMs: 2000,
  apiKey: '',
};

export function setAIConfig(config: AIConfig): void {
  aiConfig = config;
  console.log(`[Trader] AI evaluation ${config.enabled ? 'ENABLED' : 'DISABLED'} (model=${config.model}, threshold=${config.confidenceThreshold})`);
}

const VAULT_ADDRESS = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;

// On Base, each tx costs ~0.00003-0.0001 ETH (L2 gas + L1 blob data fee).
const MIN_KEEPER_GAS_BALANCE = parseEther('0.0001');  // Below this, skip trade cycle entirely
const LOW_KEEPER_GAS_BALANCE = parseEther('0.0003');  // Warning threshold — trigger auto-funding

// ── Sell Failure Tracking ─────────────────────────────────────────────────
// Tracks consecutive sell failures per eigen to prevent infinite sell loops.
// After MAX_CONSECUTIVE_SELL_FAILURES, sells are skipped for SELL_COOLDOWN_MS
// to allow buys to proceed.

const MAX_CONSECUTIVE_SELL_FAILURES = 3;
const SELL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

interface SellFailureState {
  consecutiveFailures: number;
  lastFailureTime: number;
  lastError: string;
}

const sellFailures = new Map<string, SellFailureState>();

function recordSellFailure(eigenId: string, error: string): void {
  const state = sellFailures.get(eigenId) || { consecutiveFailures: 0, lastFailureTime: 0, lastError: '' };
  state.consecutiveFailures += 1;
  state.lastFailureTime = Date.now();
  state.lastError = error;
  sellFailures.set(eigenId, state);

  // Structured alert for monitoring — emit when sell failures reach blocking threshold
  if (state.consecutiveFailures === MAX_CONSECUTIVE_SELL_FAILURES) {
    console.error(`[ALERT] SELL_BLOCKED eigen=${eigenId} failures=${state.consecutiveFailures} lastError="${error.slice(0, 200)}" cooldownMs=${SELL_COOLDOWN_MS}`);
  }
}

function recordSellSuccess(eigenId: string): void {
  sellFailures.delete(eigenId);
}

export function isSellBlocked(eigenId: string): boolean {
  const state = sellFailures.get(eigenId);
  if (!state) return false;
  if (state.consecutiveFailures < MAX_CONSECUTIVE_SELL_FAILURES) return false;
  // Check if cooldown has expired
  if (Date.now() - state.lastFailureTime > SELL_COOLDOWN_MS) {
    // Reset and allow retry
    state.consecutiveFailures = 0;
    return false;
  }
  return true;
}

// ── Merge Ponder + Config ───────────────────────────────────────────────

function mergeEigenData(
  ponderEigens: PonderEigen[],
  configs: EigenConfig[],
): EigenState[] {
  // Build map from bytes32 hash → config, since Ponder uses the on-chain
  // bytes32 eigenId while the keeper stores the short "ES-xxxx" form.
  const configMap = new Map(configs.map((c) => [eigenIdToBytes32(c.eigen_id), c]));
  const configByEigenId = new Map(configs.map((c) => [c.eigen_id, c]));
  const merged: EigenState[] = [];
  const matchedConfigIds = new Set<string>();

  for (const pe of ponderEigens) {
    const config = configMap.get(pe.id as `0x${string}`);
    if (!config) continue;
    if (config.status === 'suspended' || config.status === 'liquidating' || config.status === 'liquidated') continue;
    matchedConfigIds.add(config.eigen_id);

    merged.push({
      eigenId: config.eigen_id,       // short form for DB
      bytes32Id: pe.id,               // bytes32 for on-chain calls
      owner: pe.owner,
      ethBalance: parseFloat(formatEther(BigInt(pe.balance))),
      tradeCount: pe.tradeCount,
      config,
      pool: null, // Resolved per-eigen below
    });
  }

  // When Ponder is down, include active configs that had no ponder match
  // These will have 0 balance until we read from vault on-chain
  if (ponderEigens.length === 0) {
    for (const config of configs) {
      if (matchedConfigIds.has(config.eigen_id)) continue;
      if (config.status !== 'active') continue;
      if (!config.token_address) continue;

      merged.push({
        eigenId: config.eigen_id,
        bytes32Id: eigenIdToBytes32(config.eigen_id),
        owner: config.owner_address,
        ethBalance: 0, // Will be read from vault below
        tradeCount: 0,
        config,
        pool: null,
      });
    }
  }

  return merged;
}


// ── Execute Buy ─────────────────────────────────────────────────────────

async function executeBuy(
  eigen: EigenState,
  decision: TradeDecision,
  pool: PoolInfo,
  wallet: DerivedWallet,
): Promise<void> {
  if (!decision.ethAmount) return;

  const ethAmountWei = decision.ethAmount;
  const ethAmountNum = parseFloat(formatEther(ethAmountWei));

  // Calculate minAmountOut using current pool price with slippage tolerance
  const slippageBps = eigen.config.slippage_bps || 200; // default 2%
  let minAmountOut: bigint;
  try {
    const currentPrice = await getTokenPriceEth(eigen.config.token_address as `0x${string}`, pool);
    if (currentPrice <= 0 || !isFinite(currentPrice)) {
      console.warn(`[Trader] BUY skipped for ${eigen.eigenId}: price unavailable (${currentPrice})`);
      return;
    }
    // expectedTokenOut = ethAmount / priceEth (price is ETH per token)
    const expectedTokenOut = ethAmountNum / currentPrice;
    if (!isFinite(expectedTokenOut) || expectedTokenOut <= 0) {
      console.warn(`[Trader] BUY skipped for ${eigen.eigenId}: bad expectedTokenOut (${expectedTokenOut})`);
      return;
    }
    const minOut = expectedTokenOut * (1 - slippageBps / 10000);
    // Convert to wei (assuming 18 decimals) — cap to prevent overflow
    const minOutWei = minOut * 1e18;
    minAmountOut = minOutWei > Number.MAX_SAFE_INTEGER ? 0n : BigInt(Math.floor(minOutWei));
  } catch {
    console.warn(`[Trader] BUY skipped for ${eigen.eigenId}: price fetch failed`);
    return;
  }

  // Encode the buy swap — recipient is the wallet (not vault)
  // Tokens go to the wallet for later selling
  const { router, calldata } = encodeSwap({
    direction: 'buy',
    tokenAddress: eigen.config.token_address as `0x${string}`,
    amount: ethAmountWei,
    pool,
    recipient: wallet.address,
    minAmountOut,
  });

  // Execute buy through the vault contract
  const masterClient = getWalletClient();

  const hash = await masterClient.writeContract({
    address: VAULT_ADDRESS,
    abi: EIGENVAULT_ABI,
    functionName: 'executeBuy',
    args: [
      eigen.bytes32Id as `0x${string}`,
      router,
      calldata,
      ethAmountWei,
    ],
  });

  console.log(`[Trader] BUY ${ethAmountNum.toFixed(4)} ETH → ${eigen.config.token_symbol} (${eigen.eigenId}) wallet=${wallet.address.slice(0, 8)}... tx=${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Determine how many tokens were received by checking wallet balance delta
  let tokenAmount = 0n;
  try {
    const balanceAfter = await publicClient.readContract({
      address: eigen.config.token_address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [wallet.address],
    });
    // Parse Transfer logs from the receipt to get the exact amount received
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const walletPadded = wallet.address.toLowerCase().replace('0x', '').padStart(64, '0');
    for (const log of receipt.logs) {
      if (
        log.topics[0] === transferTopic &&
        log.address.toLowerCase() === eigen.config.token_address.toLowerCase() &&
        log.topics[2]?.toLowerCase() === `0x${walletPadded}`
      ) {
        tokenAmount = BigInt(log.data);
        break;
      }
    }
    // Fallback: use full balance if no Transfer log found (first buy into empty wallet)
    if (tokenAmount === 0n) {
      tokenAmount = balanceAfter;
    }
  } catch {
    // Fallback: estimate from price
  }

  // Get current price for position tracking
  const price = await getTokenPriceEth(eigen.config.token_address as `0x${string}`, pool);

  // Update position
  if (tokenAmount > 0n) {
    updatePositionOnBuy(
      eigen.eigenId,
      wallet.address,
      eigen.config.token_address,
      tokenAmount,
      ethAmountNum,
      price,
    );
  }

  // Record trade in local DB
  insertTradeRecord({
    eigenId: eigen.eigenId,
    type: decision.type,
    walletAddress: wallet.address,
    tokenAddress: eigen.config.token_address,
    ethAmount: ethAmountWei.toString(),
    tokenAmount: tokenAmount.toString(),
    priceEth: price,
    pnlRealized: 0,
    gasCost: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    txHash: hash,
    router,
    poolVersion: pool.version,
  });

  recordWalletTrade(eigen.eigenId, wallet.index);

  // Structured trade alert + spend tracking
  logTrade({
    eigenId: eigen.eigenId,
    type: 'buy',
    ethAmount: ethAmountWei,
    tokenAmount,
    tokenSymbol: eigen.config.token_symbol,
    txHash: hash,
    walletAddress: wallet.address,
    reason: decision.reason,
  });
  trackSpend(eigen.eigenId, ethAmountWei, BigInt(Math.floor(eigen.ethBalance * 1e18)));

  // Snapshot price for chart data
  if (price > 0) {
    insertPriceSnapshot(eigen.config.token_address, price, 'trade');
  }
}

// ── Execute Sell / Profit-Take ──────────────────────────────────────────

async function executeSellTrade(
  eigen: EigenState,
  decision: TradeDecision,
  pool: PoolInfo,
  wallet: DerivedWallet,
): Promise<void> {
  if (!decision.tokenAmount || decision.tokenAmount <= 0n) return;

  const walletClient = getWalletClientForKey(wallet.privateKey);
  const tokenAmountNum = Number(decision.tokenAmount) * 1e-18;

  // Calculate minEthOut using current pool price with slippage tolerance
  const slippageBps = eigen.config.slippage_bps || 200; // default 2%
  let minEthOut: bigint;
  try {
    const currentPrice = await getTokenPriceEth(eigen.config.token_address as `0x${string}`, pool);
    if (currentPrice <= 0 || !isFinite(currentPrice)) {
      console.warn(`[Trader] SELL skipped for ${eigen.eigenId}: price unavailable (${currentPrice})`);
      return;
    }
    // expectedEthOut = tokenAmount * priceEth
    const expectedEthOut = tokenAmountNum * currentPrice;
    if (!isFinite(expectedEthOut) || expectedEthOut <= 0) {
      console.warn(`[Trader] SELL skipped for ${eigen.eigenId}: bad expectedEthOut (${expectedEthOut})`);
      return;
    }
    const minOut = expectedEthOut * (1 - slippageBps / 10000);
    // Cap minEthOut to prevent overflow — if > 100 ETH, something is wrong, use 0 (accept any output)
    const minOutWei = minOut * 1e18;
    minEthOut = minOutWei > 100e18 ? 0n : BigInt(Math.floor(minOutWei));
  } catch {
    console.warn(`[Trader] SELL skipped for ${eigen.eigenId}: price fetch failed`);
    return;
  }

  console.log(`[Trader] ${decision.type.toUpperCase()} ${tokenAmountNum.toFixed(6)} ${eigen.config.token_symbol} → ETH (${eigen.eigenId}) reason=${decision.reason}`);

  try {
    // Log diagnostic info before sell attempt
    const walletGas = await publicClient.getBalance({ address: wallet.address });
    const tokenBal = await getTokenBalance(eigen.config.token_address as `0x${string}`, wallet.address);
    console.log(`[Trader] SELL DIAG ${eigen.eigenId}: wallet=${wallet.address.slice(0, 10)} gas=${formatEther(walletGas)} tokens=${(Number(tokenBal) * 1e-18).toFixed(6)} pool=${pool.version} hooks=${pool.hooks?.slice(0, 10) || 'none'} isWETH=${pool.isWETHPair}`);

    const result = await executeSell(
      eigen.bytes32Id,
      eigen.config.token_address as `0x${string}`,
      decision.tokenAmount,
      pool,
      walletClient,
      minEthOut,
    );

    // Sell succeeded — reset failure counter
    recordSellSuccess(eigen.eigenId);

    const ethReceivedNum = parseFloat(formatEther(result.ethReceived));
    const currentPrice = await getTokenPriceEth(eigen.config.token_address as `0x${string}`, pool);

    // Update position and get realized P&L
    const realizedPnl = updatePositionOnSell(
      eigen.eigenId,
      wallet.address,
      eigen.config.token_address,
      decision.tokenAmount,
      ethReceivedNum,
      currentPrice,
    );

    // Record trade
    insertTradeRecord({
      eigenId: eigen.eigenId,
      type: decision.type,
      walletAddress: wallet.address,
      tokenAddress: eigen.config.token_address,
      ethAmount: result.ethReceived.toString(),
      tokenAmount: decision.tokenAmount.toString(),
      priceEth: currentPrice,
      pnlRealized: realizedPnl,
      gasCost: result.totalGasCost.toString(),
      txHash: result.txHash,
      router: pool.version === 'v3' ? '0x2626664c2603336E57B271c5C0b26F421741e481' : '0x6ff5693b99212da76ad316178a184ab56d299b43',
      poolVersion: pool.version,
    });

    recordWalletTrade(eigen.eigenId, wallet.index);

    // Structured trade alert
    logTrade({
      eigenId: eigen.eigenId,
      type: decision.type,
      ethAmount: result.ethReceived,
      tokenAmount: decision.tokenAmount,
      tokenSymbol: eigen.config.token_symbol,
      txHash: result.txHash,
      walletAddress: wallet.address,
      reason: decision.reason,
    });

    // Snapshot price for chart data
    if (currentPrice > 0) {
      insertPriceSnapshot(eigen.config.token_address, currentPrice, 'trade');
    }

    // If this was a stop-loss, suspend the eigen
    if (decision.type === 'sell' && decision.reason.includes('stop_loss')) {
      updateEigenConfigStatus(eigen.eigenId, 'suspended', decision.reason);
      console.log(`[Trader] Eigen ${eigen.eigenId} SUSPENDED due to stop-loss`);
    }

    console.log(`[Trader] ${decision.type.toUpperCase()} complete: received ${ethReceivedNum.toFixed(4)} ETH, P&L: ${realizedPnl.toFixed(4)} ETH`);
  } catch (error) {
    const errMsg = (error as Error).message;
    recordSellFailure(eigen.eigenId, errMsg);
    const state = sellFailures.get(eigen.eigenId);
    console.error(`[Trader] Sell FAILED for ${eigen.eigenId} (attempt ${state?.consecutiveFailures || 1}/${MAX_CONSECUTIVE_SELL_FAILURES}): ${errMsg}`);
    if (state && state.consecutiveFailures >= MAX_CONSECUTIVE_SELL_FAILURES) {
      console.warn(`[Trader] Sell blocked for ${eigen.eigenId} — will skip sells for ${SELL_COOLDOWN_MS / 1000}s and allow buys`);
      alertConsecutiveFailures(eigen.eigenId, state.consecutiveFailures, errMsg);
    }
  }
}

// ── Deployment Burst ─────────────────────────────────────────────────────

const BURST_DELAY_MS = 5000; // 5 seconds between deployment buys

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute deployment burst: buy into all empty wallets with staggered 5s delays.
 * Deploys ~90% of vault ETH evenly across empty wallets.
 */
async function executeDeploymentBurst(
  eigen: EigenState,
  pool: PoolInfo,
  emptyWalletIndices: number[],
): Promise<void> {
  const wallets = getWalletsForEigen(eigen.eigenId, eigen.config.wallet_count);
  const emptyCount = emptyWalletIndices.length;
  const ethPerWallet = eigen.ethBalance * 0.8 / emptyCount;
  const ethPerWalletWei = BigInt(Math.floor(ethPerWallet * 1e18));

  console.log(`[Trader] DEPLOYMENT BURST ${eigen.eigenId}: ${emptyCount} empty wallets, ${ethPerWallet.toFixed(6)} ETH each, total=${(ethPerWallet * emptyCount).toFixed(6)} ETH`);

  for (let i = 0; i < emptyWalletIndices.length; i++) {
    const walletIndex = emptyWalletIndices[i]!;
    const wallet = wallets.find(w => w.index === walletIndex);
    if (!wallet) continue;

    try {
      const decision: TradeDecision = {
        type: 'buy',
        ethAmount: ethPerWalletWei,
        reason: `deployment_burst: wallet ${walletIndex + 1}/${emptyCount}`,
      };

      console.log(`[Trader] BURST BUY ${i + 1}/${emptyCount}: wallet[${walletIndex}]=${wallet.address.slice(0, 8)}... amount=${ethPerWallet.toFixed(6)} ETH`);
      await executeBuy(eigen, decision, pool, wallet);
    } catch (error) {
      console.error(`[Trader] BURST BUY failed for wallet[${walletIndex}]:`, (error as Error).message);
    }

    // Stagger buys with 5s delay (except after the last one)
    if (i < emptyWalletIndices.length - 1) {
      await sleep(BURST_DELAY_MS);
    }
  }

  console.log(`[Trader] DEPLOYMENT BURST complete for ${eigen.eigenId}`);
}

// ── Liquidation ─────────────────────────────────────────────────────────

async function executeLiquidation(config: EigenConfig): Promise<void> {
  const bytes32Id = eigenIdToBytes32(config.eigen_id);
  console.log(`[Trader] Liquidating eigen ${config.eigen_id} (${bytes32Id.slice(0, 10)}...) token=${config.token_symbol} (${config.token_address})`);

  const pool = await resolvePool(
    config.token_address as `0x${string}`,
    config.eigen_id,
  );

  if (!pool) {
    console.error(`[Trader] Cannot liquidate ${config.eigen_id}: no pool found for ${config.token_address}`);
    return;
  }

  console.log(`[Trader] LIQUIDATE pool resolved: version=${pool.version} token0=${pool.token0} token1=${pool.token1} fee=${pool.fee} hooks=${pool.hooks?.slice(0, 10) || 'none'} isWETH=${pool.isWETHPair}`);

  // Scan ALL derived wallets for on-chain token balances (not just DB positions)
  const wallets = getWalletsForEigen(config.eigen_id, config.wallet_count);
  let hasTokensRemaining = false;

  for (const wallet of wallets) {
    // Check actual on-chain token balance for each wallet
    let tokenBalance: bigint;
    try {
      tokenBalance = await getTokenBalance(
        config.token_address as `0x${string}`,
        wallet.address,
      );
    } catch (error) {
      console.error(`[Trader] LIQUIDATE: failed to read balance for wallet ${wallet.address.slice(0, 8)}...:`, (error as Error).message);
      hasTokensRemaining = true;
      continue;
    }

    if (tokenBalance <= 0n) {
      console.log(`[Trader] LIQUIDATE wallet ${wallet.address.slice(0, 8)}...: 0 tokens, skipping`);
      continue;
    }

    console.log(`[Trader] LIQUIDATE wallet ${wallet.address.slice(0, 8)}...: has ${(Number(tokenBalance) * 1e-18).toFixed(6)} ${config.token_symbol}`);

    try {
      await fundWalletIfNeeded(wallet, config.eigen_id);

      const walletClient = getWalletClientForKey(wallet.privateKey);
      const tokenAmountNum = Number(tokenBalance) * 1e-18;

      // Calculate minEthOut with slippage
      const slippageBps = config.slippage_bps || 200;
      let minEthOut: bigint;
      try {
        const currentPrice = await getTokenPriceEth(config.token_address as `0x${string}`, pool);
        console.log(`[Trader] LIQUIDATE price for ${config.token_symbol}: ${currentPrice}`);
        if (currentPrice <= 0 || !isFinite(currentPrice)) {
          console.warn(`[Trader] LIQUIDATE skipped for wallet ${wallet.address.slice(0, 8)}...: price unavailable (${currentPrice}), will retry`);
          hasTokensRemaining = true;
          continue;
        }
        const expectedEthOut = tokenAmountNum * currentPrice;
        const minOut = expectedEthOut * (1 - slippageBps / 10000);
        const minOutWei = minOut * 1e18;
        minEthOut = minOutWei > 100e18 ? 0n : BigInt(Math.floor(minOutWei));
      } catch {
        console.warn(`[Trader] LIQUIDATE skipped for wallet ${wallet.address.slice(0, 8)}...: price fetch failed, will retry`);
        hasTokensRemaining = true;
        continue;
      }

      console.log(`[Trader] LIQUIDATE selling ${tokenAmountNum.toFixed(6)} ${config.token_symbol} from wallet ${wallet.address.slice(0, 8)}... minEthOut=${formatEther(minEthOut)} ETH`);

      const result = await executeSell(
        bytes32Id,
        config.token_address as `0x${string}`,
        tokenBalance,
        pool,
        walletClient,
        minEthOut,
      );

      const ethReceivedNum = parseFloat(formatEther(result.ethReceived));
      const currentPrice = await getTokenPriceEth(config.token_address as `0x${string}`, pool);

      updatePositionOnSell(
        config.eigen_id,
        wallet.address,
        config.token_address,
        tokenBalance,
        ethReceivedNum,
        currentPrice,
      );

      insertTradeRecord({
        eigenId: config.eigen_id,
        type: 'liquidation',
        walletAddress: wallet.address,
        tokenAddress: config.token_address,
        ethAmount: result.ethReceived.toString(),
        tokenAmount: tokenBalance.toString(),
        priceEth: currentPrice,
        pnlRealized: 0,
        gasCost: result.totalGasCost.toString(),
        txHash: result.txHash,
        router: pool.version === 'v3' ? '0x2626664c2603336E57B271c5C0b26F421741e481' : '0x6ff5693b99212da76ad316178a184ab56d299b43',
        poolVersion: pool.version,
      });

      recordWalletTrade(config.eigen_id, wallet.index);
      console.log(`[Trader] LIQUIDATE complete: received ${ethReceivedNum.toFixed(4)} ETH from wallet ${wallet.address.slice(0, 8)}...`);
    } catch (error) {
      console.error(`[Trader] Liquidation sell failed for wallet ${wallet.address.slice(0, 8)}...:`, (error as Error).message);
      hasTokensRemaining = true;
    }
  }

  if (!hasTokensRemaining) {
    // Call keeperTerminate on-chain to settle fees and send remaining ETH to owner
    try {
      const masterClient = getWalletClient();
      const txHash = await masterClient.writeContract({
        address: VAULT_ADDRESS,
        abi: EIGENVAULT_ABI,
        functionName: 'keeperTerminate',
        args: [bytes32Id as `0x${string}`],
      });
      console.log(`[Trader] keeperTerminate tx: ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (error) {
      console.warn(`[Trader] keeperTerminate failed for ${config.eigen_id}:`, (error as Error).message);
    }

    // Don't overwrite 'terminated' status — only update if still liquidating
    if (config.status === 'liquidating') {
      updateEigenConfigStatus(config.eigen_id, 'liquidated');
    }
    console.log(`[Trader] Eigen ${config.eigen_id} fully liquidated — all wallets cleared`);
  } else {
    console.log(`[Trader] Eigen ${config.eigen_id} still has tokens remaining — will retry next cycle`);
  }
}

// ── Recover Stranded WETH ────────────────────────────────────────────────

async function recoverStrandedWeth(config: EigenConfig): Promise<void> {
  const wallets = getWalletsForEigen(config.eigen_id, config.wallet_count);
  const bytes32Id = eigenIdToBytes32(config.eigen_id);

  for (const wallet of wallets) {
    const walletClient = getWalletClientForKey(wallet.privateKey);

    // Recover stranded WETH
    const tryRecoverWeth = async (funded: boolean) => {
      if (funded) await fundWalletIfNeeded(wallet, config.eigen_id);
      const recovered = await recoverWeth(bytes32Id, walletClient);
      if (recovered > 0n) {
        console.log(`[Trader] Recovered ${formatEther(recovered)} ETH from WETH in wallet ${wallet.address.slice(0, 8)}... for ${config.eigen_id}`);
        insertTradeRecord({
          eigenId: config.eigen_id,
          type: 'liquidation',
          walletAddress: wallet.address,
          tokenAddress: config.token_address,
          ethAmount: recovered.toString(),
          tokenAmount: '0',
          priceEth: 0,
          pnlRealized: 0,
          gasCost: '0',
          txHash: 'weth-recovery',
          router: '0x0000000000000000000000000000000000000000',
          poolVersion: 'v3',
        });
      }
    };

    try {
      await tryRecoverWeth(false);
    } catch {
      try {
        await tryRecoverWeth(true);
      } catch {
        // Skip WETH recovery for this wallet
      }
    }

    // Recover stranded native ETH (from sells where returnEth failed)
    try {
      const recovered = await recoverStrandedEth(bytes32Id, walletClient);
      if (recovered > 0n) {
        console.log(`[Trader] Recovered ${formatEther(recovered)} stranded ETH from wallet ${wallet.address.slice(0, 8)}... for ${config.eigen_id}`);
      }
    } catch {
      // Skip ETH recovery for this wallet, will retry next cycle
    }
  }
}

/**
 * Emergency: sweep stranded ETH from sub-wallets directly to the keeper.
 * Used when keeper is critically low and can't fund sub-wallets for normal operations.
 * Simple ETH transfers are cheaper than returnEth contract calls.
 */
async function emergencyFundKeeper(config: EigenConfig): Promise<void> {
  const wallets = getWalletsForEigen(config.eigen_id, config.wallet_count);
  let totalRecovered = 0n;

  for (const wallet of wallets) {
    try {
      const walletClient = getWalletClientForKey(wallet.privateKey);
      const recovered = await fundKeeperFromSubWallet(walletClient);
      totalRecovered += recovered;
    } catch {
      // Skip this wallet
    }
  }

  if (totalRecovered > 0n) {
    console.log(`[Trader] Emergency: recovered ${formatEther(totalRecovered)} ETH from ${config.eigen_id} sub-wallets to keeper`);
  }
}

// ── On-Chain Position Sync ──────────────────────────────────────────────

/**
 * Sync on-chain token balances into SQLite.
 * Recovers positions lost when the Railway deploy wipes the ephemeral DB.
 * Called once per eigen before making trade decisions.
 */
async function syncOnChainPositions(eigen: EigenState, pool: PoolInfo): Promise<void> {
  const wallets = getWalletsForEigen(eigen.eigenId, eigen.config.wallet_count);
  const tokenAddress = eigen.config.token_address as `0x${string}`;

  for (const wallet of wallets) {
    try {
      const dbPos = getTokenPosition(eigen.eigenId, eigen.config.token_address, wallet.address);
      const onChainBalance = await getTokenBalance(tokenAddress, wallet.address);

      // Case 1: DB has tokens but on-chain has 0 — position was closed externally
      if (dbPos && BigInt(dbPos.amount_raw) > 0n && onChainBalance <= 0n) {
        console.log(`[Trader] SYNC: DB shows ${(Number(BigInt(dbPos.amount_raw)) * 1e-18).toFixed(6)} ${eigen.config.token_symbol} in wallet ${wallet.address.slice(0, 8)}... but on-chain balance is 0 — clearing stale position`);
        updatePositionOnSell(
          eigen.eigenId,
          wallet.address,
          eigen.config.token_address,
          BigInt(dbPos.amount_raw),
          0, // no ETH received (external sale)
          0, // price unknown
        );
        continue;
      }

      // Case 2: DB has non-zero position that matches on-chain — skip
      if (dbPos && BigInt(dbPos.amount_raw) > 0n) continue;

      // Case 3: On-chain has tokens but DB doesn't — reconstruct position
      if (onChainBalance <= 0n) continue;

      const currentPrice = await getTokenPriceEth(tokenAddress, pool);
      if (currentPrice <= 0) continue;

      const tokensDecimal = Number(onChainBalance) * 1e-18;
      const estimatedCost = tokensDecimal * currentPrice;

      console.log(`[Trader] SYNC: Found ${tokensDecimal.toFixed(6)} ${eigen.config.token_symbol} in wallet ${wallet.address.slice(0, 8)}... (not in DB) — syncing position`);

      updatePositionOnBuy(
        eigen.eigenId,
        wallet.address,
        eigen.config.token_address,
        onChainBalance,
        estimatedCost,
        currentPrice,
      );
    } catch (error) {
      console.warn(`[Trader] Position sync failed for wallet ${wallet.address.slice(0, 8)}...:`, (error as Error).message);
    }
  }
}

// ── Take Profit ──────────────────────────────────────────────────────────

const TAKE_PROFIT_DELAY_MS = 3000; // 3 seconds between sells

/**
 * Execute take-profit: sell a percentage of tokens across all sub-wallets.
 * Called directly from the API endpoint (not from the trade cycle).
 */
export async function executeTakeProfit(eigenId: string, percent: number): Promise<{ walletsToSell: number }> {
  const configs = getAllEigenConfigs();
  const config = configs.find(c => c.eigen_id === eigenId);
  if (!config) throw new Error(`Eigen config not found: ${eigenId}`);
  if (!config.token_address) throw new Error(`No token configured for ${eigenId}`);

  const bytes32Id = eigenIdToBytes32(eigenId);
  const pool = await resolvePool(config.token_address as `0x${string}`, eigenId);
  if (!pool) throw new Error(`No pool found for ${config.token_address}`);

  const wallets = getWalletsForEigen(eigenId, config.wallet_count);
  const tokenAddr = config.token_address as `0x${string}`;
  let walletsToSell = 0;

  const eigen: EigenState = {
    eigenId,
    bytes32Id,
    owner: config.owner_address,
    ethBalance: 0,
    tradeCount: 0,
    config,
    pool,
  };

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]!;
    let tokenBalance: bigint;
    try {
      tokenBalance = await getTokenBalance(tokenAddr, wallet.address);
    } catch {
      continue;
    }
    if (tokenBalance <= 0n) continue;

    const sellAmount = tokenBalance * BigInt(Math.floor(percent * 100)) / 10000n;
    if (sellAmount <= 0n) continue;

    walletsToSell++;

    try {
      await fundWalletIfNeeded(wallet, eigenId);

      const decision: TradeDecision = {
        type: 'profit_take',
        tokenAmount: sellAmount,
        reason: `take_profit_manual: ${percent}% of wallet ${wallet.index}`,
      };

      console.log(`[Trader] TAKE PROFIT ${eigenId}: wallet[${wallet.index}]=${wallet.address.slice(0, 8)}... selling ${(Number(sellAmount) * 1e-18).toFixed(6)} ${config.token_symbol}`);
      await executeSellTrade(eigen, decision, pool, wallet);
    } catch (error) {
      console.error(`[Trader] TAKE PROFIT sell failed for wallet[${wallet.index}]:`, (error as Error).message);
    }

    // Stagger sells with delay (except after the last one)
    if (i < wallets.length - 1) {
      await sleep(TAKE_PROFIT_DELAY_MS);
    }
  }

  console.log(`[Trader] TAKE PROFIT complete for ${eigenId}: sold from ${walletsToSell} wallets`);
  return { walletsToSell };
}

// ── Main Trade Cycle ────────────────────────────────────────────────────

export async function executeTradeCycle(): Promise<void> {
  // Only process Base eigens here; Monad eigens handled by executeMonadTradeCycle()
  const configs = getAllEigenConfigs().filter((c) => c.chain_id === 8453);

  const BASE_TRADING_ENABLED = false; // Disabled for Monad-first

  if (BASE_TRADING_ENABLED) {
  // ── Recovery runs FIRST (before gas check) to self-heal gas issues ──
  // When keeper is critically low, recovery sweeps stranded sub-wallet ETH
  // directly to keeper instead of vault, breaking the gas death spiral.
  const keeperAddress = getKeeperAddress();
  let keeperBalance = 0n;
  try {
    keeperBalance = await publicClient.getBalance({ address: keeperAddress });
  } catch { }

  const keeperCriticallyLow = keeperBalance < MIN_KEEPER_GAS_BALANCE;

  // Handle liquidations and WETH/ETH recovery
  for (const config of configs) {
    if ((config.status === 'liquidating' || config.status === 'terminated') && !keeperCriticallyLow) {
      try {
        await executeLiquidation(config);
      } catch (error) {
        console.error(`[Trader] Liquidation error for ${config.eigen_id}:`, (error as Error).message);
      }
    }
    // Recover any stranded WETH/ETH from wallets (from sells where returnEth failed)
    // Also run for terminated eigens to recover stranded funds
    if (config.status === 'liquidating' || config.status === 'liquidated' || config.status === 'active' || config.status === 'terminated') {
      try {
        if (keeperCriticallyLow) {
          // Emergency: sweep sub-wallet ETH directly to keeper
          await emergencyFundKeeper(config);
        } else {
          await recoverStrandedWeth(config);
        }
      } catch (error) {
        console.error(`[Trader] WETH/ETH recovery error for ${config.eigen_id}:`, (error as Error).message);
      }
    }
  }

  // Re-check keeper balance after recovery (may have been funded)
  try {
    keeperBalance = await publicClient.getBalance({ address: keeperAddress });
  } catch { }

  // ── Keeper gas safety check ──────────────────────────────────────────
  if (keeperBalance < MIN_KEEPER_GAS_BALANCE) {
    console.error(`[Trader] CRITICAL: Keeper gas too low! Balance: ${formatEther(keeperBalance)} ETH (min: ${formatEther(MIN_KEEPER_GAS_BALANCE)}). Fund keeper wallet: ${keeperAddress}`);
    alertKeeperGas(keeperAddress, keeperBalance, 'critical');
    return;
  }

  if (keeperBalance < LOW_KEEPER_GAS_BALANCE) {
    console.warn(`[Trader] WARNING: Keeper gas getting low: ${formatEther(keeperBalance)} ETH (threshold: ${formatEther(LOW_KEEPER_GAS_BALANCE)}). Keeper: ${keeperAddress}`);
    alertKeeperGas(keeperAddress, keeperBalance, 'low');
  }

  // ── Refill vault from keeper surplus (only when vault is too low) ────
  // When recovery sweeps sub-wallet ETH to keeper instead of vault,
  // the keeper accumulates sell proceeds. Send surplus back to vault
  // ONLY when the vault is too low to trade — avoids wasting gas on
  // unnecessary transfers.
  // This is checked per-eigen below after fetching ponder balances.

  // Fetch on-chain state from Ponder + local config from SQLite
  // Race ponder against 5s timeout to avoid blocking the trade loop
  let ponderEigens = await Promise.race([
    fetchActiveEigens().catch(() => [] as PonderEigen[]),
    new Promise<PonderEigen[]>((resolve) => setTimeout(() => resolve([]), 5000)),
  ]);

  // If Ponder is down, use on-chain fallback (filtered to active only)
  if (ponderEigens.length === 0) {
    const onChain = getCachedOnChainEigens();
    if (onChain.length > 0) {
      ponderEigens = onChain.filter((e) => e.status === 'ACTIVE');
    }
  }

  let eigens = mergeEigenData(ponderEigens, configs);

  // Fallback: if Ponder + recovery both return nothing but we have active configs,
  // build EigenState directly from SQLite + on-chain vault balance queries.
  // This handles fresh vaults where no events have been indexed yet.
  if (eigens.length === 0 && configs.length > 0) {
    const activeConfigs = configs.filter((c) => c.status === 'active');
    if (activeConfigs.length > 0) {
      console.log(`[Trader] Ponder/recovery empty — building ${activeConfigs.length} eigens from SQLite + on-chain`);
      for (const config of activeConfigs) {
        const bytes32Id = eigenIdToBytes32(config.eigen_id);
        let ethBalance = 0;
        try {
          const bal = await publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: EIGENVAULT_ABI,
            functionName: 'getNetBalance',
            args: [bytes32Id as `0x${string}`],
          }) as bigint;
          ethBalance = parseFloat(formatEther(bal));
        } catch {
          // Vault query failed — eigen may not exist on-chain yet, skip
          console.log(`[Trader] ${config.eigen_id}: vault query failed, skipping`);
          continue;
        }
        eigens.push({
          eigenId: config.eigen_id,
          bytes32Id,
          owner: config.owner_address,
          ethBalance,
          tradeCount: 0,
          config,
          pool: null,
        });
      }
    }
  }

  if (eigens.length === 0) {
    console.log(`[Trader] No active eigens (ponder=${ponderEigens.length}, configs=${configs.length})`);
    return;
  }

  // If Ponder is down, read vault balances directly from chain
  if (ponderEigens.length === 0) {
    for (const eigen of eigens) {
      if (eigen.ethBalance === 0) {
        try {
          const bal = await publicClient.readContract({
            address: VAULT_ADDRESS,
            abi: EIGENVAULT_ABI,
            functionName: 'getNetBalance',
            args: [eigen.bytes32Id as `0x${string}`],
          }) as bigint;
          eigen.ethBalance = parseFloat(formatEther(bal));
        } catch { }
      }
    }
  }

  // Reset nonce cache at start of each cycle for clean state
  resetAllNonces();

  // Sort eigens by priority: deploying > active_trading > idle
  eigens = sortByPriority(eigens);
  const gasBudget = new GasBudgetTracker();

  // ── Per-Eigen Processing (parallelized) ─────────────────────────────
  // Vault refills use the master wallet and must remain sequential.
  // Trade execution (per sub-wallet) can safely run in parallel.

  // Phase A: Sequential vault refills (uses master wallet nonce)
  for (const eigen of eigens) {
    try {
      const pool = await resolvePool(
        eigen.config.token_address as `0x${string}`,
        eigen.eigenId,
      );
      if (!pool) continue;
      eigen.pool = pool;

      // Refill vault from keeper surplus if vault is too low for trades
      const minVaultForTrade = parseFloat(formatEther(BigInt(Math.floor(0.00005 * 1e18))));
      if (eigen.ethBalance < minVaultForTrade && keeperBalance > LOW_KEEPER_GAS_BALANCE * 3n) {
        const MAX_REFILL = parseEther('0.005');
        const rawSurplus = keeperBalance - LOW_KEEPER_GAS_BALANCE * 2n;
        const surplus = rawSurplus < MAX_REFILL ? rawSurplus : MAX_REFILL;
        if (surplus > 0n) {
          try {
            const masterClient = getWalletClient();
            const masterAccount = masterClient.account;
            if (masterAccount) {
              console.log(`[Trader] Vault low (${eigen.ethBalance.toFixed(8)} ETH) — refilling with ${formatEther(surplus)} ETH from keeper`);
              const hash = await masterClient.writeContract({
                address: VAULT_ADDRESS,
                abi: EIGENVAULT_ABI,
                functionName: 'returnEth',
                args: [eigen.bytes32Id as `0x${string}`],
                value: surplus,
                chain: masterClient.chain,
                account: masterAccount,
              });
              await publicClient.waitForTransactionReceipt({ hash });
              console.log(`[Trader] Vault refilled: ${hash}`);
              keeperBalance = await publicClient.getBalance({ address: keeperAddress });
            }
          } catch (error) {
            console.error(`[Trader] Vault refill failed:`, (error as Error).message);
          }
        }
      }
    } catch (error) {
      console.error(`[Trader] Pool resolve/refill error for ${eigen.eigenId}:`, (error as Error).message);
    }
  }

  // Phase B: Parallel per-eigen trade processing
  const limit = pLimit(TRADE_CONCURRENCY);
  const cycleStart = Date.now();

  const results = await Promise.allSettled(
    eigens
      .filter((e) => e.pool !== null)
      .map((eigen) => limit(() => processEigen(eigen, eigen.pool!, gasBudget)))
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  const cycleDuration = Date.now() - cycleStart;
  console.log(`[Trader] Cycle complete: ${eigens.length} eigens, ${failed} errors, ${cycleDuration}ms (concurrency=${TRADE_CONCURRENCY}) gas=${gasBudget.summary()}`);
  } // END BASE_TRADING_ENABLED

  // ── Monad Trade Cycle (vaultless, nad.fun SDK) ────────────────────────
  try {
    await executeMonadTradeCycle(aiConfig);
  } catch (error) {
    console.error(`[Trader] Monad trade cycle error:`, (error as Error).message);
  }
}

// ── Per-Eigen Processing ──────────────────────────────────────────────
// Extracted from the main loop for parallel execution.

async function processEigen(eigen: EigenState, pool: PoolInfo, gasBudget: GasBudgetTracker): Promise<void> {
  // Gas budget check — skip low-priority eigens when budget exhausted
  if (!gasBudget.canAfford()) {
    console.log(`[Trader] ${eigen.eigenId}: skipped (gas budget exhausted: ${gasBudget.summary()})`);
    return;
  }

  // 1. Sync on-chain positions (recovers DB after redeploy)
  await syncOnChainPositions(eigen, pool);

  // 2. Check for deployment phase → execute burst if deploying
  const deployState = await getDeploymentState(eigen);
  if (deployState.deploying && eigen.ethBalance > 0.00001) {
    console.log(`[Trader] ${eigen.eigenId}: DEPLOYMENT PHASE — ${deployState.emptyWalletIndices.length} empty wallets`);
    await executeDeploymentBurst(eigen, pool, deployState.emptyWalletIndices);
  }

  // 3. Get trade decision (market making phase)
  let decision = await decideTradeAction(eigen);
  if (!decision) {
    const pos = getAggregatedPosition(eigen.eigenId, eigen.config.token_address);
    const tokenBal = Number(pos.totalAmount) * 1e-18;
    console.log(`[Trader] ${eigen.eigenId}: no action (eth=${eigen.ethBalance.toFixed(6)} tokens=${tokenBal.toFixed(6)} cost=${pos.totalCost.toFixed(6)})`);
    return;
  }

  // 3b. AI EVALUATION (if enabled) — evaluate before execution
  if (aiConfig.enabled && decision) {
    try {
      const pos = getAggregatedPosition(eigen.eigenId, eigen.config.token_address);
      const price = await getTokenPriceWithFallback(
        eigen.config.token_address as `0x${string}`,
        pool,
      );
      const context = buildMarketContext(eigen.eigenId, eigen.config.token_address);

      const evaluation = await evaluateTrade(decision, eigen, pos, price, context, aiConfig, eigen.config.custom_prompt);

      if (!evaluation.approved) {
        console.log(`[Trader] ${eigen.eigenId}: AI REJECTED trade (${evaluation.reason})`);
        return;
      }

      // Apply adjusted amount if AI suggested a resize
      if (evaluation.adjustedAmount) {
        if (decision.ethAmount) {
          decision = { ...decision, ethAmount: evaluation.adjustedAmount };
          console.log(`[Trader] ${eigen.eigenId}: AI adjusted buy amount to ${formatEther(evaluation.adjustedAmount)} ETH`);
        } else if (decision.tokenAmount) {
          decision = { ...decision, tokenAmount: evaluation.adjustedAmount };
          console.log(`[Trader] ${eigen.eigenId}: AI adjusted sell amount to ${(Number(evaluation.adjustedAmount) * 1e-18).toFixed(6)} tokens`);
        }
      }
    } catch (error) {
      console.warn(`[Trader] ${eigen.eigenId}: AI evaluation error, fail-open — ${(error as Error).message}`);
    }
  }

  // Check if sells are blocked due to consecutive failures
  const isSellDecision = !!decision.tokenAmount && !decision.ethAmount;
  if (isSellDecision && isSellBlocked(eigen.eigenId)) {
    const state = sellFailures.get(eigen.eigenId);
    console.log(`[Trader] ${eigen.eigenId}: sell blocked (${state?.consecutiveFailures} consecutive failures, last: ${state?.lastError?.slice(0, 80)}). Falling through to buy.`);
    const pctMin = eigen.config.order_size_pct_min || 8;
    const min = eigen.ethBalance * (pctMin / 100);
    if (min >= 0.00001) {
      const pctMax = eigen.config.order_size_pct_max || 15;
      const max = eigen.ethBalance * (pctMax / 100);
      const size = max <= min ? min : min + Math.random() * (max - min);
      decision = {
        type: 'buy' as const,
        ethAmount: BigInt(Math.floor(size * 1e18)),
        reason: 'fallback_buy_sell_blocked',
      };
      console.log(`[Trader] ${eigen.eigenId}: fallback buy ${(size).toFixed(6)} ETH`);
    } else {
      console.log(`[Trader] ${eigen.eigenId}: sell blocked and insufficient ETH for buy (${eigen.ethBalance.toFixed(6)})`);
      return;
    }
  }

  console.log(`[Trader] ${eigen.eigenId}: decision=${decision.type} reason=${decision.reason}`);

  // 4. Get or derive sub-wallets
  const wallets = getWalletsForEigen(eigen.eigenId, eigen.config.wallet_count);

  // 5. Execute
  const isBuyAction = !!decision.ethAmount;
  const isSellAction = !!decision.tokenAmount && !isBuyAction;

  if (isBuyAction) {
    const wallet = selectWallet(eigen.eigenId, wallets);
    await executeBuy(eigen, decision, pool, wallet);
  } else if (isSellAction) {
    let remainingToSell = decision.tokenAmount!;
    const tokenAddr = eigen.config.token_address as `0x${string}`;
    let soldAny = false;

    for (const w of wallets) {
      if (remainingToSell <= 0n) break;

      const walletBalance = await getTokenBalance(tokenAddr, w.address);
      if (walletBalance <= 0n) continue;

      const sellAmount = walletBalance < remainingToSell ? walletBalance : remainingToSell;
      await fundWalletIfNeeded(w, eigen.eigenId);

      const walletDecision: TradeDecision = { ...decision, tokenAmount: sellAmount };
      await executeSellTrade(eigen, walletDecision, pool, w);
      remainingToSell -= sellAmount;
      soldAny = true;
    }

    if (!soldAny) {
      recordSellFailure(eigen.eigenId, 'no_tokens_in_wallets: all sub-wallets have 0 token balance on-chain');
      const state = sellFailures.get(eigen.eigenId);
      console.warn(`[Trader] ${eigen.eigenId}: sell decision but no wallets have tokens (attempt ${state?.consecutiveFailures}/${MAX_CONSECUTIVE_SELL_FAILURES}). DB position may be stale.`);
    }
  }
}
