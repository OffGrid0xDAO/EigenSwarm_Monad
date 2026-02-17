/**
 * Debug v2: Use the nad.fun SDK properly and check both venue prices carefully.
 */
import 'dotenv/config';
import { formatEther, parseEther, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createTrading, type QuoteResult } from '@nadfun/sdk';

const TOKEN_ADDRESS = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
const V4_POOL_ID = '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936';

const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });

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

async function main() {
  console.log('=== Price Debug ===\n');

  // 1. V4 price via StateView
  const { UNISWAP_V4_STATE_VIEW } = await import('@eigenswarm/shared');
  const slot0 = await publicClient.readContract({
    address: UNISWAP_V4_STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [V4_POOL_ID as `0x${string}`],
  });

  const sqrtPriceX96 = slot0[0];
  const tick = slot0[1];
  console.log(`V4 sqrtPriceX96: ${sqrtPriceX96}`);
  console.log(`V4 tick: ${tick}`);

  // price = sqrtPriceX96^2 / 2^192
  // For pool where token0=address(0) (ETH), token1=EIGEN:
  // price = EIGEN/ETH (how many EIGEN per 1 ETH)
  // We want ETH per EIGEN = 1/price
  const Q192 = 2n ** 192n;
  const rawPrice = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  console.log(`V4 raw price (token1/token0 = EIGEN/ETH): ${rawPrice}`);
  console.log(`V4 ETH per EIGEN: ${1/rawPrice}`);
  console.log(`V4 EIGEN per ETH: ${rawPrice}`);
  console.log();

  // 2. nad.fun price via SDK
  const trading = createTrading({ rpcUrl: RPC_URL, privateKey: PRIVATE_KEY, network: 'mainnet' });

  // Quote: buy 5 MON worth of tokens
  console.log('nad.fun quotes:');
  try {
    const buyQuote = await trading.getAmountOut(TOKEN_ADDRESS, parseEther('5'), true);
    console.log(`  Buy 5 MON → ${formatEther(buyQuote.amount)} EIGEN (router: ${buyQuote.router})`);
    const pricePerToken = 5 / parseFloat(formatEther(buyQuote.amount));
    console.log(`  Price: ${pricePerToken} MON/EIGEN`);
  } catch (err: any) {
    console.log(`  Buy quote failed: ${err.message?.slice(0, 150)}`);
  }

  try {
    const sellQuote = await trading.getAmountOut(TOKEN_ADDRESS, parseEther('1000'), false);
    console.log(`  Sell 1000 EIGEN → ${formatEther(sellQuote.amount)} MON (router: ${sellQuote.router})`);
    const pricePerToken2 = parseFloat(formatEther(sellQuote.amount)) / 1000;
    console.log(`  Price: ${pricePerToken2} MON/EIGEN`);
  } catch (err: any) {
    console.log(`  Sell quote failed: ${err.message?.slice(0, 150)}`);
  }

  // 3. Check which router nad.fun uses (bonding curve vs dex)
  try {
    const state = await trading.getCurveState(TOKEN_ADDRESS);
    console.log(`\nnad.fun curve state:`);
    console.log(`  ${JSON.stringify(state, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}`);
  } catch (err: any) {
    console.log(`\nCurve state failed: ${err.message?.slice(0, 150)}`);
  }

  // 4. Check token balances in V4 pool (via pool manager)
  console.log('\nV4 pool liquidity check:');
  const POOL_MANAGER = '0x188d586ddcf52439676ca21a244753fa19f9ea8e' as Address;

  // Check if pool has liquidity by looking at the tick
  console.log(`  Current tick: ${tick}`);
  console.log(`  sqrtPriceX96: ${sqrtPriceX96}`);
  if (sqrtPriceX96 === 0n) {
    console.log('  Pool has no liquidity (sqrtPriceX96 = 0)!');
  } else {
    console.log('  Pool is initialized with liquidity');
  }

  // 5. Summary comparison
  console.log('\n=== SUMMARY ===');
  const v4EthPerToken = rawPrice > 0 ? 1 / rawPrice : 0;
  console.log(`V4 price:      ${v4EthPerToken.toFixed(10)} MON/EIGEN (${rawPrice.toFixed(2)} EIGEN/MON)`);
  // The "nad.fun price" we got earlier (0.000167) was from getAmountOut(1 token, false)
  // which quotes "sell 1 token, get X MON" — this IS the MON/token price
}

main().catch(console.error);
