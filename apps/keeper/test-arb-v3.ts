/**
 * Test arb v3: Uses updated EigenArb contract with per-call router address.
 * Direction: Buy on nad.fun bonding curve (cheaper) → Sell on V4 (more expensive)
 * Max 200 MON trade.
 */
import 'dotenv/config';
import {
  formatEther, parseEther, encodeFunctionData, decodeFunctionData,
  createPublicClient, createWalletClient, http,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createTrading } from '@nadfun/sdk';

// ── Addresses ──────────────────────────────────────────────────────────

const TOKEN_ADDRESS = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
const ARB_CONTRACT = '0xc0715e797bB06752e0D10706fC3045413180F666' as Address;
const UNIVERSAL_ROUTER = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;

const V4_POOL_ID = '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936' as Hex;
const POOL_FEE = 9900;
const TICK_SPACING = 198;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });
const walletClient = createWalletClient({ chain: monad, transport: http(RPC_URL), account });

// ── ABI ────────────────────────────────────────────────────────────────

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
] as const;

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

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('=== EigenArb v3 Test ===');
  console.log(`Arb Contract: ${ARB_CONTRACT}`);
  console.log(`Wallet: ${account.address}`);

  const monBalance = await publicClient.getBalance({ address: account.address });
  console.log(`Wallet MON: ${formatEther(monBalance)}`);

  // 1. Get nad.fun quote to determine router & expected tokens
  const trading = createTrading({ rpcUrl: RPC_URL, privateKey: PRIVATE_KEY, network: 'mainnet' });
  const tradeAmount = parseEther('5'); // 5 MON test

  console.log(`\nGetting nad.fun buy quote for ${formatEther(tradeAmount)} MON...`);
  const buyQuote = await trading.getAmountOut(TOKEN_ADDRESS, tradeAmount, true);
  const nadRouter = buyQuote.router as Address;
  console.log(`  Router: ${nadRouter}`);
  console.log(`  Expected tokens: ${formatEther(buyQuote.amount)} EIGEN`);
  const nadPricePerToken = parseFloat(formatEther(tradeAmount)) / parseFloat(formatEther(buyQuote.amount));
  console.log(`  nad.fun price: ${nadPricePerToken.toFixed(10)} MON/EIGEN`);

  // 2. Get V4 price
  const { UNISWAP_V4_STATE_VIEW } = await import('@eigenswarm/shared');
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

  const slot0 = await publicClient.readContract({
    address: UNISWAP_V4_STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [V4_POOL_ID],
  });
  const sqrtPriceX96 = slot0[0];
  const Q192 = 2n ** 192n;
  const rawPrice = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  const v4PricePerToken = rawPrice > 0 ? 1 / rawPrice : 0;
  console.log(`  V4 price: ${v4PricePerToken.toFixed(10)} MON/EIGEN`);

  const spreadBps = Math.round(Math.abs(v4PricePerToken - nadPricePerToken) / nadPricePerToken * 10000);
  console.log(`  Spread: ${spreadBps} bps (${(spreadBps/100).toFixed(1)}%)`);

  if (v4PricePerToken <= nadPricePerToken) {
    console.log('V4 is NOT more expensive — no arb in this direction.');
    return;
  }

  // 3. Encode V4 sell (sell the tokens we get from nad.fun buy, receive MON to arb contract)
  const { encodeSwap } = await import('./src/swap-encoder');
  const { calldata } = encodeSwap({
    direction: 'sell',
    tokenAddress: TOKEN_ADDRESS,
    amount: buyQuote.amount,
    pool: {
      version: 'v4',
      poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: ZERO_ADDRESS as `0x${string}`,
      token0: ZERO_ADDRESS as `0x${string}`,
      token1: TOKEN_ADDRESS,
      poolId: V4_POOL_ID,
      isWETHPair: false,
    },
    recipient: ARB_CONTRACT,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });

  // Decode UR calldata to extract commands + inputs
  const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: calldata });
  const v4SellCommands = decoded.args[0] as `0x${string}`;
  const v4SellInputs = decoded.args[1] as `0x${string}`[];
  console.log(`\nV4 sell encoded — commands: ${v4SellCommands}`);

  // 4. Encode arb call
  const nadFunMinTokens = buyQuote.amount * 90n / 100n; // 10% slippage for test
  const arbCalldata = encodeFunctionData({
    abi: EIGEN_ARB_ABI,
    functionName: 'arbBuyNadSellV4',
    args: [TOKEN_ADDRESS, nadRouter, 0n, nadFunMinTokens, v4SellCommands, v4SellInputs],
  });

  // 5. Simulate
  console.log('\nSimulating arb call...');
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
    console.log(`Simulation revert: ${simErr.message?.slice(0, 300)}`);
    console.log('Trying to execute anyway...');
  }

  // 6. Execute
  console.log('\nExecuting arb TX...');
  const monBefore = await publicClient.getBalance({ address: account.address });
  const arbMonBefore = await publicClient.getBalance({ address: ARB_CONTRACT });

  const txHash = await walletClient.sendTransaction({
    to: ARB_CONTRACT,
    data: arbCalldata,
    value: tradeAmount,
    gas: 2_000_000n,
  });

  console.log(`TX: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  const monAfter = await publicClient.getBalance({ address: account.address });
  const arbMonAfter = await publicClient.getBalance({ address: ARB_CONTRACT });

  console.log(`\nWallet MON delta: ${formatEther(monAfter - monBefore)} (includes gas)`);
  console.log(`Arb contract MON delta: ${formatEther(arbMonAfter - arbMonBefore)}`);

  if (receipt.status === 'success') {
    console.log('\n=== ARB SUCCESSFUL! ===');
  } else {
    console.log('\n=== ARB REVERTED ===');
  }
}

main().catch(console.error);
