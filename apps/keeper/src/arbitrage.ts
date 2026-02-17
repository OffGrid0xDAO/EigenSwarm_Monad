/**
 * Arbitrage Module
 *
 * Detects price discrepancies between nad.fun (bonding curve or DEX) and
 * EigenSwarm V4 pools for graduated tokens and executes atomic single-tx
 * arbitrage via EigenArb contract.
 *
 * Key: the nad.fun SDK returns the correct router per token (bonding curve
 * or DEX), and EigenArb accepts the router address per-call.
 */

import {
  formatEther, parseEther, encodeFunctionData,
  encodeAbiParameters, parseAbiParameters, concat, toHex,
  type Address, type Hex,
} from 'viem';
import { getPublicClient, getMasterPrivateKey, getWalletClientForKey } from './client';
import {
  getAllEigenConfigs,
  insertTradeRecord,
  type EigenConfig,
} from './db';
import { getTokenPriceEth } from './price-oracle';
import { getMonadQuote, buildV4PoolFromConfig } from './monad-trader';
import { type PoolInfo } from './swap-encoder';

const MONAD_CHAIN_ID = 143;

// ── Arb Config ──────────────────────────────────────────────────────────

export interface ArbConfig {
  enabled: boolean;
  minSpreadBps: number;     // Minimum spread to trigger arb (e.g. 150 = 1.5%)
  maxTradeEth: number;      // Max trade size in MON (e.g. 5)
  cooldownMs: number;       // Per-token cooldown (e.g. 30000 = 30s)
  arbContractAddress: Address | null; // Deployed EigenArb contract address
}

export function loadArbConfig(): ArbConfig {
  return {
    enabled: process.env.ARB_ENABLED === 'true',
    minSpreadBps: parseInt(process.env.ARB_MIN_SPREAD_BPS || '150', 10),
    maxTradeEth: parseFloat(process.env.ARB_MAX_TRADE_ETH || '5'),
    cooldownMs: parseInt(process.env.ARB_COOLDOWN_MS || '30000', 10),
    arbContractAddress: (process.env.ARB_CONTRACT_ADDRESS as Address) || null,
  };
}

// ── Cooldown Tracking ───────────────────────────────────────────────────

const lastArbTime = new Map<string, number>();

function isOnCooldown(eigenId: string, cooldownMs: number): boolean {
  const last = lastArbTime.get(eigenId);
  if (!last) return false;
  return Date.now() - last < cooldownMs;
}

function setCooldown(eigenId: string): void {
  lastArbTime.set(eigenId, Date.now());
}

// ── Venue Prices ────────────────────────────────────────────────────────

export interface VenuePrices {
  nadfunPrice: number;   // MON per token on nad.fun
  nadfunRouter: Address; // Router address returned by SDK (bonding curve or DEX)
  v4Price: number;       // MON per token on V4 pool
  spreadBps: number;     // Spread in basis points (absolute)
  direction: 'buy_nadfun_sell_v4' | 'buy_v4_sell_nadfun' | 'none';
}

/**
 * Fetch prices from both venues and compute spread.
 * nad.fun price: quote selling 1000 tokens → MON (then divide).
 * V4 price: read sqrtPriceX96 from StateView.
 */
export async function getVenuePrices(
  tokenAddress: Address,
  v4Pool: PoolInfo,
): Promise<VenuePrices | null> {
  try {
    // V4 price from sqrtPriceX96
    const v4Price = await getTokenPriceEth(tokenAddress, v4Pool);
    if (v4Price <= 0) return null;

    // nad.fun price: quote selling 1000 tokens (larger amount for accuracy)
    const quoteAmount = parseEther('1000');
    const nadQuote = await getMonadQuote(tokenAddress, quoteAmount, false);
    const nadfunPrice = parseFloat(formatEther(nadQuote.amount)) / 1000;
    if (nadfunPrice <= 0) return null;

    const nadfunRouter = nadQuote.router as Address;

    // Spread = |v4 - nadfun| / min(v4, nadfun) in bps
    const minPrice = Math.min(v4Price, nadfunPrice);
    const spreadBps = Math.round(Math.abs(v4Price - nadfunPrice) / minPrice * 10000);

    let direction: VenuePrices['direction'] = 'none';
    if (nadfunPrice < v4Price) {
      direction = 'buy_nadfun_sell_v4';  // nad.fun is cheaper
    } else if (v4Price < nadfunPrice) {
      direction = 'buy_v4_sell_nadfun';  // V4 is cheaper
    }

    return { nadfunPrice, nadfunRouter, v4Price, spreadBps, direction };
  } catch (error) {
    console.error(`[Arb] Price fetch failed for ${tokenAddress}:`, (error as Error).message);
    return null;
  }
}

// ── EigenArb Contract ABI ────────────────────────────────────────────────

const EIGEN_ARB_ABI = [
  {
    type: 'function',
    name: 'arbBuyNadSellV4',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'nadRouter', type: 'address' },
      { name: 'minProfit', type: 'uint256' },
      { name: 'nadFunMinTokens', type: 'uint256' },
      { name: 'v4SellCommands', type: 'bytes' },
      { name: 'v4SellInputs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'arbBuyV4SellNad',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'nadRouter', type: 'address' },
      { name: 'minProfit', type: 'uint256' },
      { name: 'v4BuyCommands', type: 'bytes' },
      { name: 'v4BuyInputs', type: 'bytes[]' },
      { name: 'nadFunMinMon', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ── V4 Sell Encoder (inline, matching confirmed working pattern) ────────

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address;

function encodeV4SellCommandsAndInputs(
  tokenAddress: Address,
  amount: bigint,
  recipient: Address,
  pool: PoolInfo,
): { v4Commands: `0x${string}`; v4Inputs: `0x${string}`[] } {
  const ACTION_SWAP_EXACT_IN = 0x07;
  const ACTION_SETTLE = 0x0b;
  const ACTION_TAKE = 0x0e;

  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  // SWAP_EXACT_IN: ExactInputParams struct
  const swapParams = encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currencyIn', type: 'address' },
      { name: 'path', type: 'tuple[]', components: [
        { name: 'intermediateCurrency', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
        { name: 'hookData', type: 'bytes' },
      ]},
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
    ]}],
    [{
      currencyIn: tokenAddress,
      path: [{
        intermediateCurrency: ZERO_ADDR, // output = native ETH
        fee: pool.fee,
        tickSpacing: pool.tickSpacing || 198,
        hooks: (pool.hooks || ZERO_ADDR) as Address,
        hookData: '0x' as `0x${string}`,
      }],
      amountIn: amount,
      amountOutMinimum: 0n,
    }],
  );

  // SETTLE: pull tokens from caller via Permit2 (exact amount)
  const settleParams = encodeAbiParameters(
    parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
    [tokenAddress, amount, true],
  );

  // TAKE: send native ETH to recipient
  const takeParams = encodeAbiParameters(
    parseAbiParameters('address currency, address recipient, uint256 minAmount'),
    [ZERO_ADDR, recipient, 0n],
  );

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, [swapParams, settleParams, takeParams]],
  );

  return {
    v4Commands: '0x10' as `0x${string}`, // V4_SWAP command
    v4Inputs: [v4SwapInput],
  };
}

// ── V4 Buy Encoder (matching confirmed working pattern) ─────────────────

function encodeV4BuyCommandsAndInputs(
  tokenAddress: Address,
  ethAmount: bigint,
  recipient: Address,
  pool: PoolInfo,
): { v4Commands: `0x${string}`; v4Inputs: `0x${string}`[] } {
  const ACTION_SWAP_EXACT_IN = 0x07;
  const ACTION_SETTLE = 0x0b;
  const ACTION_TAKE = 0x0e;

  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  // SWAP_EXACT_IN: ETH -> token
  const swapParams = encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currencyIn', type: 'address' },
      { name: 'path', type: 'tuple[]', components: [
        { name: 'intermediateCurrency', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
        { name: 'hookData', type: 'bytes' },
      ]},
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
    ]}],
    [{
      currencyIn: ZERO_ADDR, // native ETH
      path: [{
        intermediateCurrency: tokenAddress, // output = token
        fee: pool.fee,
        tickSpacing: pool.tickSpacing || 198,
        hooks: (pool.hooks || ZERO_ADDR) as Address,
        hookData: '0x' as `0x${string}`,
      }],
      amountIn: ethAmount,
      amountOutMinimum: 0n,
    }],
  );

  // SETTLE: pay native ETH (exact amount)
  const settleParams = encodeAbiParameters(
    parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
    [ZERO_ADDR, ethAmount, true],
  );

  // TAKE: receive tokens
  const takeParams = encodeAbiParameters(
    parseAbiParameters('address currency, address recipient, uint256 minAmount'),
    [tokenAddress, recipient, 0n],
  );

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, [swapParams, settleParams, takeParams]],
  );

  return {
    v4Commands: '0x10' as `0x${string}`,
    v4Inputs: [v4SwapInput],
  };
}

// ── Execute Atomic Arb ──────────────────────────────────────────────────

async function executeAtomicArb(
  config: EigenConfig,
  v4Pool: PoolInfo,
  prices: VenuePrices,
  arbConfig: ArbConfig,
): Promise<void> {
  if (!arbConfig.arbContractAddress) {
    console.warn('[Arb] ARB_CONTRACT_ADDRESS not set, skipping atomic arb');
    return;
  }

  const tokenAddress = config.token_address as Address;
  const client = getPublicClient(MONAD_CHAIN_ID);
  const masterKey = getMasterPrivateKey();
  const walletClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const account = walletClient.account!;

  const tradeAmountEth = Math.min(arbConfig.maxTradeEth, 200);
  const tradeAmount = parseEther(tradeAmountEth.toString());

  // Estimate profit: spread% * tradeAmount (rough estimate)
  const estimatedProfitEth = tradeAmountEth * (prices.spreadBps / 10000);
  // Require at least 20% of estimated spread as minimum profit (accounts for gas + slippage)
  const minProfitEth = estimatedProfitEth * 0.2;
  const minProfit = parseEther(minProfitEth.toFixed(18));

  try {
    let txHash: Hex;

    if (prices.direction === 'buy_nadfun_sell_v4') {
      // Buy on nad.fun (cheaper), sell on V4 (more expensive)
      const buyQuote = await getMonadQuote(tokenAddress, tradeAmount, true);
      const nadFunMinTokens = buyQuote.amount * 85n / 100n; // 15% slippage for bonding curve

      // Encode V4 sell (recipient = arb contract to receive native ETH)
      const { v4Commands, v4Inputs } = encodeV4SellCommandsAndInputs(
        tokenAddress, buyQuote.amount, arbConfig.arbContractAddress, v4Pool,
      );

      const arbCalldata = encodeFunctionData({
        abi: EIGEN_ARB_ABI,
        functionName: 'arbBuyNadSellV4',
        args: [tokenAddress, prices.nadfunRouter, minProfit, nadFunMinTokens, v4Commands, v4Inputs],
      });

      // Simulate first
      await client.call({
        to: arbConfig.arbContractAddress,
        data: arbCalldata,
        value: tradeAmount,
        account: account.address,
        gas: 5_000_000n,
      });

      txHash = await walletClient.sendTransaction({
        to: arbConfig.arbContractAddress,
        data: arbCalldata,
        value: tradeAmount,
        chain: walletClient.chain,
        account,
        gas: 5_000_000n,
      });
    } else {
      // Buy on V4 (cheaper), sell on nad.fun (more expensive)
      const { v4Commands, v4Inputs } = encodeV4BuyCommandsAndInputs(
        tokenAddress, tradeAmount, arbConfig.arbContractAddress, v4Pool,
      );

      // Estimate tokens from V4 buy for nad.fun sell min
      const nadFunMinMon = 0n; // Let contract's profit check handle this

      const arbCalldata = encodeFunctionData({
        abi: EIGEN_ARB_ABI,
        functionName: 'arbBuyV4SellNad',
        args: [tokenAddress, prices.nadfunRouter, minProfit, v4Commands, v4Inputs, nadFunMinMon],
      });

      // Simulate first
      await client.call({
        to: arbConfig.arbContractAddress,
        data: arbCalldata,
        value: tradeAmount,
        account: account.address,
        gas: 5_000_000n,
      });

      txHash = await walletClient.sendTransaction({
        to: arbConfig.arbContractAddress,
        data: arbCalldata,
        value: tradeAmount,
        chain: walletClient.chain,
        account,
        gas: 5_000_000n,
      });
    }

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    const dirLabel = prices.direction === 'buy_nadfun_sell_v4' ? 'NAD→V4' : 'V4→NAD';
    const status = receipt.status === 'success' ? '✓' : '✗';

    // Check arb contract balance for actual profit
    const arbBal = await client.getBalance({ address: arbConfig.arbContractAddress });

    console.log(`[Arb] ${status} ${config.eigen_id} ($${config.token_symbol}): ${dirLabel} ${tradeAmountEth} MON spread=${prices.spreadBps}bps profit=${formatEther(arbBal)}MON tx=${txHash}`);

    // Record arb trade
    insertTradeRecord({
      eigenId: config.eigen_id,
      type: 'arbitrage',
      walletAddress: account.address,
      tokenAddress: config.token_address,
      ethAmount: tradeAmount.toString(),
      tokenAmount: '0',
      priceEth: prices.direction === 'buy_nadfun_sell_v4' ? prices.nadfunPrice : prices.v4Price,
      pnlRealized: parseFloat(formatEther(arbBal)),
      gasCost: (receipt.gasUsed * 202n).toString(), // ~202 gwei gas price
      txHash,
      router: 'eigenarb',
      poolVersion: 'v4',
    });

    // Auto-withdraw profit to wallet
    if (arbBal > 0n) {
      try {
        const withdrawCalldata = encodeFunctionData({
          abi: EIGEN_ARB_ABI,
          functionName: 'withdraw',
          args: [],
        });
        const withdrawTx = await walletClient.sendTransaction({
          to: arbConfig.arbContractAddress,
          data: withdrawCalldata,
          chain: walletClient.chain,
          account,
        });
        await client.waitForTransactionReceipt({ hash: withdrawTx });
        console.log(`[Arb] Withdrew ${formatEther(arbBal)} MON profit to wallet`);
      } catch (e) {
        console.warn(`[Arb] Withdraw failed: ${(e as Error).message?.slice(0, 80)}`);
      }
    }

    setCooldown(config.eigen_id);
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('Insufficient profit') || msg.includes('revert')) {
      console.log(`[Arb] ${config.eigen_id}: arb reverted (spread closed) — ${msg.slice(0, 100)}`);
    } else {
      console.error(`[Arb] ${config.eigen_id}: arb failed — ${msg.slice(0, 150)}`);
    }
    setCooldown(config.eigen_id);
  }
}

// ── Main Arb Cycle ──────────────────────────────────────────────────────

export async function executeArbCycle(): Promise<void> {
  const arbConfig = loadArbConfig();
  if (!arbConfig.enabled) return;

  if (!arbConfig.arbContractAddress) {
    console.warn('[Arb] ARB_ENABLED=true but ARB_CONTRACT_ADDRESS not set');
    return;
  }

  const allConfigs = getAllEigenConfigs();

  // Filter for graduated tokens with V4 pools (both venues must exist)
  const arbCandidates = allConfigs.filter((c) => {
    if (c.chain_id !== MONAD_CHAIN_ID) return false;
    if (c.status !== 'active') return false;
    if (c.graduation_status !== 'graduated') return false;
    if (!c.lp_pool_id || /^0x0+$/.test(c.lp_pool_id)) return false;
    return true;
  });

  if (arbCandidates.length === 0) return;

  console.log(`[Arb] Scanning ${arbCandidates.length} graduated tokens for arb opportunities`);

  for (const config of arbCandidates) {
    if (isOnCooldown(config.eigen_id, arbConfig.cooldownMs)) continue;

    const tokenAddress = config.token_address as Address;
    const v4Pool = buildV4PoolFromConfig(tokenAddress, config);
    if (!v4Pool) continue;

    const prices = await getVenuePrices(tokenAddress, v4Pool);
    if (!prices || prices.direction === 'none') continue;

    if (prices.spreadBps < arbConfig.minSpreadBps) {
      continue;
    }

    console.log(`[Arb] ${config.eigen_id} ($${config.token_symbol}): spread=${prices.spreadBps}bps dir=${prices.direction} nad=${prices.nadfunPrice.toFixed(8)} v4=${prices.v4Price.toFixed(8)}`);

    try {
      await executeAtomicArb(config, v4Pool, prices, arbConfig);
    } catch (error) {
      console.error(`[Arb] ${config.eigen_id}: unexpected error — ${(error as Error).message}`);
      setCooldown(config.eigen_id);
    }
  }
}
