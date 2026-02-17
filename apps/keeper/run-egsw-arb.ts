/**
 * EGSW arb: Buy on nad.fun bonding curve (cheaper) -> Sell on V4 (more expensive)
 * Uses the updated EigenArb contract with per-call router address
 */
import 'dotenv/config';
import {
  formatEther, parseEther, encodeFunctionData, decodeFunctionData,
  encodeAbiParameters, parseAbiParameters, concat, toHex,
  createPublicClient, createWalletClient, http,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createTrading } from '@nadfun/sdk';
import { UNISWAP_V4_STATE_VIEW } from '@eigenswarm/shared';

const EGSW = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777' as Address;
const ARB_CONTRACT = '0xc0715e797bB06752e0D10706fC3045413180F666' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

const EGSW_POOL_ID = '0x9a3761cf2433c7514dd09f3ec2e5e42bebb2affb648bcb3d0263551aedb1fd8e' as Hex;

const RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PK = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account });

const STATE_VIEW_ABI = [
  { type: 'function', name: 'getSlot0', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }
  ], stateMutability: 'view' },
] as const;

const EIGEN_ARB_ABI = [{
  type: 'function', name: 'arbBuyNadSellV4',
  inputs: [
    { name: 'token', type: 'address' },
    { name: 'nadRouter', type: 'address' },
    { name: 'minProfit', type: 'uint256' },
    { name: 'nadFunMinTokens', type: 'uint256' },
    { name: 'v4SellCommands', type: 'bytes' },
    { name: 'v4SellInputs', type: 'bytes[]' },
  ],
  outputs: [], stateMutability: 'payable',
}] as const;

const UR_ABI = [{
  type: 'function', name: 'execute',
  inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
  outputs: [], stateMutability: 'payable',
}] as const;

function encodeV4SellCalldata(tokenAddress: Address, amount: bigint, recipient: Address): { commands: Hex; inputs: Hex[] } {
  const ACTION_SWAP_EXACT_IN = 0x07;
  const ACTION_SETTLE = 0x0b;
  const ACTION_TAKE = 0x0e;

  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

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
      path: [{ intermediateCurrency: ZERO, fee: 9900, tickSpacing: 198, hooks: ZERO, hookData: '0x' as Hex }],
      amountIn: amount,
      amountOutMinimum: 0n,
    }],
  );

  const settleParams = encodeAbiParameters(
    parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
    [tokenAddress, amount, true],
  );

  const takeParams = encodeAbiParameters(
    parseAbiParameters('address currency, address recipient, uint256 minAmount'),
    [ZERO, recipient, 0n],
  );

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, [swapParams, settleParams, takeParams]],
  );

  return {
    commands: '0x10' as Hex, // V4_SWAP
    inputs: [v4SwapInput],
  };
}

async function main() {
  console.log('=== EGSW Arb ===');
  const monBal = await pub.getBalance({ address: account.address });
  console.log(`Wallet MON: ${formatEther(monBal)}`);

  // Get prices
  const slot0 = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [EGSW_POOL_ID] });
  const sqrtPriceX96 = slot0[0];
  const Q192 = 2n ** 192n;
  const rawPrice = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  const v4Price = rawPrice > 0 ? 1 / rawPrice : 0;

  const trading = createTrading({ rpcUrl: RPC, privateKey: PK, network: 'mainnet' });
  const tradeAmount = parseEther('5');
  const buyQuote = await trading.getAmountOut(EGSW, tradeAmount, true);
  const nadRouter = buyQuote.router as Address;
  const nadPrice = parseFloat(formatEther(tradeAmount)) / parseFloat(formatEther(buyQuote.amount));

  console.log(`V4 price:      ${v4Price.toFixed(10)} MON/EGSW`);
  console.log(`nad.fun price: ${nadPrice.toFixed(10)} MON/EGSW`);
  const spreadBps = Math.round((v4Price - nadPrice) / nadPrice * 10000);
  console.log(`Spread: ${spreadBps} bps (${(spreadBps/100).toFixed(1)}%)`);
  console.log(`Direction: BUY nad.fun -> SELL V4`);
  console.log(`Trade: ${formatEther(tradeAmount)} MON -> ~${formatEther(buyQuote.amount)} EGSW`);
  console.log(`Expected V4 return: ~${(parseFloat(formatEther(buyQuote.amount)) * v4Price).toFixed(4)} MON`);
  console.log(`Router: ${nadRouter}`);

  // Encode V4 sell (recipient = arb contract to receive native ETH)
  const { commands, inputs } = encodeV4SellCalldata(EGSW, buyQuote.amount, ARB_CONTRACT);
  const nadFunMinTokens = buyQuote.amount * 85n / 100n;

  // Build arb calldata
  const arbCalldata = encodeFunctionData({
    abi: EIGEN_ARB_ABI,
    functionName: 'arbBuyNadSellV4',
    args: [EGSW, nadRouter, 0n, nadFunMinTokens, commands, inputs],
  });

  // Simulate
  console.log('\nSimulating arb...');
  try {
    await pub.call({ to: ARB_CONTRACT, data: arbCalldata, value: tradeAmount, account: account.address, gas: 5_000_000n });
    console.log('Simulation PASSED!');
  } catch (e: any) {
    console.log(`Simulation FAILED: ${e.message?.slice(0, 300)}`);
    return;
  }

  // Execute
  console.log('\nExecuting arb...');
  const monBefore = await pub.getBalance({ address: account.address });
  const arbMonBefore = await pub.getBalance({ address: ARB_CONTRACT });

  const txHash = await wallet.sendTransaction({
    to: ARB_CONTRACT, data: arbCalldata, value: tradeAmount, gas: 5_000_000n,
  });
  console.log(`TX: ${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  const monAfter = await pub.getBalance({ address: account.address });
  const arbMonAfter = await pub.getBalance({ address: ARB_CONTRACT });
  console.log(`\nWallet MON delta: ${formatEther(monAfter - monBefore)} (includes gas)`);
  console.log(`Arb contract MON: ${formatEther(arbMonAfter)} (profit in contract)`);

  if (receipt.status === 'success' && arbMonAfter > 0n) {
    console.log('\n=== ARB PROFITABLE! ===');
    console.log(`Profit sitting in arb contract: ${formatEther(arbMonAfter)} MON`);
  }
}

main().catch(console.error);
