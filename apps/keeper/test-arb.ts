/**
 * Quick test: check prices on both venues and attempt a tiny arb if spread exists.
 * Max 200 MON trade size as requested.
 *
 * Usage: npx tsx test-arb.ts
 */
import 'dotenv/config';
import { formatEther, parseEther, encodeFunctionData, decodeFunctionData, createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';

// ── Config ──────────────────────────────────────────────────────────────

const TOKEN_ADDRESS = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
const TOKEN_SYMBOL = 'EIGEN';
const ARB_CONTRACT = '0xE12fFA15A5F48e19db72de8f671001CC3fA1D661' as Address;
const NADFUN_DEX_ROUTER = '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137' as Address;
const UNIVERSAL_ROUTER = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;
const STATE_VIEW = '0xcdC3E5a14f14bE5Ba5B9702528E52f34d tried' as Address; // Will get from shared

const V4_POOL_ID = '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936' as Hex;
const POOL_FEE = 9900;
const TICK_SPACING = 198;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const MAX_TRADE_WEI = parseEther('200'); // 200 MON max (tiny test)
const MIN_SPREAD_BPS = 50; // Lower threshold for testing (0.5%)

const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error('Set KEEPER_PRIVATE_KEY in .env');
  process.exit(1);
}

// ── Clients ─────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: monad,
  transport: http(RPC_URL),
});
const walletClient = createWalletClient({
  chain: monad,
  transport: http(RPC_URL),
  account,
});

// ── Price from V4 (sqrtPriceX96 via StateView) ─────────────────────────

const STATE_VIEW_ABI = [{
  type: 'function',
  name: 'getSlot0',
  inputs: [{ name: 'poolId', type: 'bytes32' }],
  outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' },
    { name: 'tick', type: 'int24' },
    { name: 'protocolFee', type: 'uint24' },
    { name: 'lpFee', type: 'uint24' },
  ],
  stateMutability: 'view',
}] as const;

async function getV4Price(): Promise<number> {
  // Get StateView address from shared constants
  const { UNISWAP_V4_STATE_VIEW } = await import('@eigenswarm/shared');

  const result = await publicClient.readContract({
    address: UNISWAP_V4_STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [V4_POOL_ID],
  });

  const sqrtPriceX96 = result[0];
  if (sqrtPriceX96 === 0n) return 0;

  // Pool is native ETH (addr 0) / token
  // price = sqrtPriceX96^2 / 2^192 = token1 per token0
  // token0 = address(0) = native ETH, token1 = EIGEN
  // So price = EIGEN per ETH → we want ETH per EIGEN = 1/price
  const Q192 = 2n ** 192n;
  const priceNum = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);

  // If token0 = address(0) (ETH) and token1 = EIGEN:
  // priceNum = EIGEN/ETH → ethPerToken = 1/priceNum? No:
  // Actually sqrtPriceX96 gives us token1/token0 = EIGEN/ETH
  // We want ETH per EIGEN = 1 / (EIGEN/ETH) = 1/priceNum
  //
  // BUT: need to check ordering. If token < ZERO, that can't happen.
  // address(0) < any token address → token0 = ETH, token1 = EIGEN
  // price = token1/token0 = EIGEN per ETH
  // ethPerToken = 1/price
  const ethPerToken = priceNum > 0 ? 1 / priceNum : 0;
  return ethPerToken;
}

// ── Price from nad.fun (quote selling 1 token) ─────────────────────────

async function getNadFunPrice(): Promise<number> {
  // Use the nad.fun SDK to get a quote
  const { createTrading } = await import('@nadfun/sdk');
  const trading = createTrading({
    rpcUrl: RPC_URL,
    privateKey: PRIVATE_KEY,
    network: 'mainnet',
  });

  // Quote: sell 1 token → how much MON?
  const oneToken = parseEther('1');
  const quote = await trading.getAmountOut(TOKEN_ADDRESS, oneToken, false);
  return parseFloat(formatEther(quote.amount));
}

// ── Encode V4 swap calldata ─────────────────────────────────────────────

async function encodeV4Swap(direction: 'buy' | 'sell', amount: bigint, recipient: Address) {
  const { encodeSwap } = await import('./src/swap-encoder');
  const { router, calldata } = encodeSwap({
    direction,
    tokenAddress: TOKEN_ADDRESS,
    amount,
    pool: {
      version: 'v4',
      poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', // pool manager
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: ZERO_ADDRESS,
      token0: ZERO_ADDRESS, // native ETH
      token1: TOKEN_ADDRESS,
      poolId: V4_POOL_ID,
      isWETHPair: false,
    },
    recipient,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });
  return { router, calldata };
}

// ── Decode Universal Router calldata ────────────────────────────────────

function decodeURCalldata(calldata: `0x${string}`): { commands: `0x${string}`; inputs: `0x${string}`[] } {
  const EXECUTE_ABI = [{
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  }] as const;

  const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: calldata });
  return {
    commands: decoded.args[0] as `0x${string}`,
    inputs: decoded.args[1] as `0x${string}`[],
  };
}

// ── EigenArb ABI ────────────────────────────────────────────────────────

const EIGEN_ARB_ABI = [
  {
    type: 'function',
    name: 'arbBuyNadSellV4',
    inputs: [
      { name: 'token', type: 'address' },
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
      { name: 'minProfit', type: 'uint256' },
      { name: 'v4BuyCommands', type: 'bytes' },
      { name: 'v4BuyInputs', type: 'bytes[]' },
      { name: 'nadFunMinMon', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== EigenArb Test ===');
  console.log(`Token: $${TOKEN_SYMBOL} (${TOKEN_ADDRESS})`);
  console.log(`Arb Contract: ${ARB_CONTRACT}`);
  console.log(`Wallet: ${account.address}`);
  console.log(`Max Trade: ${formatEther(MAX_TRADE_WEI)} MON`);
  console.log();

  // Check balances
  const monBalance = await publicClient.getBalance({ address: account.address });
  console.log(`Wallet MON balance: ${formatEther(monBalance)} MON`);

  const arbBalance = await publicClient.getBalance({ address: ARB_CONTRACT });
  console.log(`Arb contract MON balance: ${formatEther(arbBalance)} MON`);
  console.log();

  // Get prices from both venues
  console.log('Fetching prices...');
  let v4Price: number, nadPrice: number;
  try {
    [v4Price, nadPrice] = await Promise.all([getV4Price(), getNadFunPrice()]);
  } catch (error) {
    console.error('Price fetch failed:', (error as Error).message);
    return;
  }

  console.log(`V4 price:     ${v4Price.toFixed(10)} MON/token`);
  console.log(`nad.fun price: ${nadPrice.toFixed(10)} MON/token`);

  if (v4Price <= 0 || nadPrice <= 0) {
    console.log('One or both prices are zero — cannot compute spread.');
    return;
  }

  const minPrice = Math.min(v4Price, nadPrice);
  const spreadBps = Math.round(Math.abs(v4Price - nadPrice) / minPrice * 10000);
  const spreadPct = (spreadBps / 100).toFixed(2);

  let direction: string;
  if (nadPrice < v4Price) {
    direction = 'buy_nadfun_sell_v4';
    console.log(`Direction: BUY on nad.fun (cheaper) → SELL on V4 (more expensive)`);
  } else if (v4Price < nadPrice) {
    direction = 'buy_v4_sell_nadfun';
    console.log(`Direction: BUY on V4 (cheaper) → SELL on nad.fun (more expensive)`);
  } else {
    direction = 'none';
    console.log('Prices are equal — no arb opportunity.');
  }

  console.log(`Spread: ${spreadBps} bps (${spreadPct}%)`);
  console.log();

  if (direction === 'none') {
    console.log('No arb to execute.');
    return;
  }

  if (spreadBps < MIN_SPREAD_BPS) {
    console.log(`Spread ${spreadBps} bps < minimum ${MIN_SPREAD_BPS} bps — skipping execution.`);
    console.log('(Set MIN_SPREAD_BPS lower to test with smaller spreads)');
    return;
  }

  // Use a small trade amount: 10 MON (way under the 200 limit)
  const tradeAmount = parseEther('10');
  if (monBalance < tradeAmount + parseEther('1')) {
    console.log(`Insufficient balance for trade + gas. Need ~11 MON, have ${formatEther(monBalance)}`);
    return;
  }

  console.log(`Executing arb with ${formatEther(tradeAmount)} MON...`);

  try {
    if (direction === 'buy_nadfun_sell_v4') {
      // Get buy quote from nad.fun to estimate tokens
      const { createTrading } = await import('@nadfun/sdk');
      const trading = createTrading({ rpcUrl: RPC_URL, privateKey: PRIVATE_KEY, network: 'mainnet' });
      const buyQuote = await trading.getAmountOut(TOKEN_ADDRESS, tradeAmount, true);
      const nadFunMinTokens = buyQuote.amount * 90n / 100n; // 10% slippage for test
      console.log(`Expected tokens from nad.fun buy: ${formatEther(buyQuote.amount)}`);

      // Encode V4 sell (recipient = arb contract)
      const { calldata } = await encodeV4Swap('sell', buyQuote.amount, ARB_CONTRACT);
      const { commands, inputs } = decodeURCalldata(calldata);

      const arbCalldata = encodeFunctionData({
        abi: EIGEN_ARB_ABI,
        functionName: 'arbBuyNadSellV4',
        args: [TOKEN_ADDRESS, 0n, nadFunMinTokens, commands, inputs], // minProfit=0 for test
      });

      // Simulate first to check for revert reason
      console.log('Simulating arb call...');
      try {
        await publicClient.call({
          to: ARB_CONTRACT,
          data: arbCalldata,
          value: tradeAmount,
          account: account.address,
          gas: 2_000_000n,
        });
        console.log('Simulation passed!');
      } catch (simErr: any) {
        console.log('Simulation revert:', simErr.message?.slice(0, 300));
        console.log('Trying to execute anyway...');
      }

      const txHash = await walletClient.sendTransaction({
        to: ARB_CONTRACT,
        data: arbCalldata,
        value: tradeAmount,
        gas: 2_000_000n,
      });

      console.log(`TX submitted: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`Status: ${receipt.status === 'success' ? 'SUCCESS' : 'REVERTED'}`);
      console.log(`Gas used: ${receipt.gasUsed}`);

    } else {
      // buy_v4_sell_nadfun
      // Encode V4 buy (recipient = arb contract)
      const { calldata } = await encodeV4Swap('buy', tradeAmount, ARB_CONTRACT);
      const { commands, inputs } = decodeURCalldata(calldata);

      // Estimate nad.fun sell output
      const nadFunMinMon = 0n; // no min for test

      const arbCalldata = encodeFunctionData({
        abi: EIGEN_ARB_ABI,
        functionName: 'arbBuyV4SellNad',
        args: [TOKEN_ADDRESS, 0n, commands, inputs, nadFunMinMon], // minProfit=0 for test
      });

      // Simulate first
      console.log('Simulating arb call...');
      try {
        await publicClient.call({
          to: ARB_CONTRACT,
          data: arbCalldata,
          value: tradeAmount,
          account: account.address,
          gas: 2_000_000n,
        });
        console.log('Simulation passed!');
      } catch (simErr: any) {
        console.log('Simulation revert:', simErr.message?.slice(0, 300));
        console.log('Trying to execute anyway...');
      }

      const txHash = await walletClient.sendTransaction({
        to: ARB_CONTRACT,
        data: arbCalldata,
        value: tradeAmount,
        gas: 2_000_000n,
      });

      console.log(`TX submitted: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`Status: ${receipt.status === 'success' ? 'SUCCESS' : 'REVERTED'}`);
      console.log(`Gas used: ${receipt.gasUsed}`);
    }

    // Check final balances
    const finalMon = await publicClient.getBalance({ address: account.address });
    const finalArbMon = await publicClient.getBalance({ address: ARB_CONTRACT });
    console.log();
    console.log(`Wallet MON after: ${formatEther(finalMon)} (delta: ${formatEther(finalMon - monBalance)})`);
    console.log(`Arb contract MON after: ${formatEther(finalArbMon)} (delta: ${formatEther(finalArbMon - arbBalance)})`);

  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('Insufficient profit')) {
      console.log('Arb reverted: spread closed during execution (expected for small spreads)');
    } else {
      console.error('Arb failed:', msg.slice(0, 200));
    }
  }
}

main().catch(console.error);
