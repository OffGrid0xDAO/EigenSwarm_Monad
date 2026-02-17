import 'dotenv/config';
import { formatEther, parseEther, createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { encodeSwap } from './src/swap-encoder';
import { WETH_ADDRESS } from '@eigenswarm/shared';

const TOKEN = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const V4_POOL_ID = '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936' as Hex;
const UR = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;

const RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PK = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });

async function main() {
  const sellAmount = parseEther('1000');

  // Test 1: native ETH sell (isNativeEthPool: true)
  console.log('=== Test 1: Native ETH sell ===');
  const { calldata: c1 } = encodeSwap({
    direction: 'sell', tokenAddress: TOKEN, amount: sellAmount,
    pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', fee: 9900, tickSpacing: 198,
      hooks: ZERO, token0: ZERO, token1: TOKEN, poolId: V4_POOL_ID, isWETHPair: false },
    recipient: account.address, minAmountOut: 0n, isNativeEthPool: true,
  });
  try {
    await pub.call({ to: UR, data: c1, account: account.address, gas: 3_000_000n });
    console.log('PASS');
  } catch (e: any) { console.log('FAIL:', e.message?.slice(0, 150)); }

  // Test 2: WETH sell (isNativeEthPool: false, token0 still address(0))
  console.log('\n=== Test 2: WETH sell (token0=0x0) ===');
  const { calldata: c2 } = encodeSwap({
    direction: 'sell', tokenAddress: TOKEN, amount: sellAmount,
    pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', fee: 9900, tickSpacing: 198,
      hooks: ZERO, token0: ZERO, token1: TOKEN, poolId: V4_POOL_ID, isWETHPair: false },
    recipient: account.address, minAmountOut: 0n, isNativeEthPool: false,
  });
  try {
    await pub.call({ to: UR, data: c2, account: account.address, gas: 3_000_000n });
    console.log('PASS');
  } catch (e: any) { console.log('FAIL:', e.message?.slice(0, 150)); }

  // Test 3: WETH sell (isWETHPair: true, token0=WETH)
  console.log('\n=== Test 3: WETH sell (token0=WETH) ===');
  const { calldata: c3 } = encodeSwap({
    direction: 'sell', tokenAddress: TOKEN, amount: sellAmount,
    pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', fee: 9900, tickSpacing: 198,
      hooks: ZERO, token0: WETH_ADDRESS as `0x${string}`, token1: TOKEN, poolId: V4_POOL_ID, isWETHPair: true },
    recipient: account.address, minAmountOut: 0n, isNativeEthPool: false,
  });
  try {
    await pub.call({ to: UR, data: c3, account: account.address, gas: 3_000_000n });
    console.log('PASS');
  } catch (e: any) { console.log('FAIL:', e.message?.slice(0, 150)); }

  // Test 4: Even smaller amount
  console.log('\n=== Test 4: Native ETH sell (100 tokens) ===');
  const { calldata: c4 } = encodeSwap({
    direction: 'sell', tokenAddress: TOKEN, amount: parseEther('100'),
    pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', fee: 9900, tickSpacing: 198,
      hooks: ZERO, token0: ZERO, token1: TOKEN, poolId: V4_POOL_ID, isWETHPair: false },
    recipient: account.address, minAmountOut: 0n, isNativeEthPool: true,
  });
  try {
    await pub.call({ to: UR, data: c4, account: account.address, gas: 3_000_000n });
    console.log('PASS');
  } catch (e: any) { console.log('FAIL:', e.message?.slice(0, 150)); }

  // Test 5: V4 BUY instead (to verify pool works in buy direction)
  console.log('\n=== Test 5: Native ETH BUY (0.1 MON) ===');
  const { calldata: c5 } = encodeSwap({
    direction: 'buy', tokenAddress: TOKEN, amount: parseEther('0.1'),
    pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e', fee: 9900, tickSpacing: 198,
      hooks: ZERO, token0: ZERO, token1: TOKEN, poolId: V4_POOL_ID, isWETHPair: false },
    recipient: account.address, minAmountOut: 0n, isNativeEthPool: true,
  });
  try {
    await pub.call({ to: UR, data: c5, account: account.address, gas: 3_000_000n, value: parseEther('0.1') });
    console.log('PASS');
  } catch (e: any) { console.log('FAIL:', e.message?.slice(0, 150)); }
}

main().catch(console.error);
