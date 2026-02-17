/**
 * EGSW arb: Buy on nad.fun bonding curve (cheaper) -> Sell on V4 (more expensive)
 * 17% spread detected
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
import { UNISWAP_V4_STATE_VIEW } from '@eigenswarm/shared';

const EGSW = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777' as Address;
const ARB_CONTRACT = '0xc0715e797bB06752e0D10706fC3045413180F666' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// EGSW V4 pool
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
  { type: 'function', name: 'getLiquidity', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint128' }
  ], stateMutability: 'view' },
] as const;

const EIGEN_ARB_ABI = [{
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
}] as const;

const EXECUTE_ABI = [{
  type: 'function', name: 'execute',
  inputs: [
    { name: 'commands', type: 'bytes' },
    { name: 'inputs', type: 'bytes[]' },
    { name: 'deadline', type: 'uint256' },
  ],
  outputs: [], stateMutability: 'payable',
}] as const;

async function main() {
  console.log('=== EGSW Arb ===');
  console.log(`Wallet: ${account.address}`);
  const monBal = await pub.getBalance({ address: account.address });
  console.log(`MON: ${formatEther(monBal)}`);

  // 1. Pool info
  const slot0 = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [EGSW_POOL_ID] });
  const liq = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [EGSW_POOL_ID] });
  const sqrtPriceX96 = slot0[0];
  const tick = slot0[1];
  const lpFee = slot0[3];
  const Q192 = 2n ** 192n;
  const rawPrice = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  const v4Price = rawPrice > 0 ? 1 / rawPrice : 0;

  // Estimate pool reserves from liquidity and sqrtPrice
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  // For the current tick's liquidity: approx MON reserve = L / sqrtPrice, Token reserve = L * sqrtPrice
  // (simplified for full-range approximation)
  const approxMON = Number(liq) / sqrtP / 1e18;
  const approxEGSW = Number(liq) * sqrtP / 1e18;

  console.log(`\nEGSW V4 Pool:`);
  console.log(`  Tick: ${tick}, Fee: ${lpFee}`);
  console.log(`  Liquidity: ${liq.toString()}`);
  console.log(`  V4 price: ${v4Price.toFixed(10)} MON/EGSW (${rawPrice.toFixed(2)} EGSW/MON)`);
  console.log(`  Approx pool MON: ~${approxMON.toFixed(2)}`);
  console.log(`  Approx pool EGSW: ~${approxEGSW.toFixed(2)}`);

  // 2. nad.fun quote
  const trading = createTrading({ rpcUrl: RPC, privateKey: PK, network: 'mainnet' });
  const tradeAmount = parseEther('5'); // 5 MON test
  const buyQuote = await trading.getAmountOut(EGSW, tradeAmount, true);
  const nadRouter = buyQuote.router as Address;
  const nadPrice = parseFloat(formatEther(tradeAmount)) / parseFloat(formatEther(buyQuote.amount));

  console.log(`\nnad.fun:`);
  console.log(`  Buy ${formatEther(tradeAmount)} MON -> ${formatEther(buyQuote.amount)} EGSW`);
  console.log(`  Router: ${nadRouter}`);
  console.log(`  nad.fun price: ${nadPrice.toFixed(10)} MON/EGSW`);

  const spreadBps = Math.round((v4Price - nadPrice) / nadPrice * 10000);
  console.log(`\nSpread: ${spreadBps} bps (${(spreadBps/100).toFixed(1)}%)`);

  if (spreadBps < 0) {
    console.log('V4 is cheaper — wrong direction for buy-nad-sell-v4');
    return;
  }

  // 3. Encode V4 sell
  //    Need to figure out the pool key: token0 and token1
  //    From the swap event: pool uses native ETH (address 0) as currency0
  //    EGSW is currency1
  const { encodeSwap } = await import('./src/swap-encoder');
  const { calldata } = encodeSwap({
    direction: 'sell',
    tokenAddress: EGSW,
    amount: buyQuote.amount,
    pool: {
      version: 'v4',
      poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
      fee: lpFee,
      tickSpacing: Number(lpFee) / 50, // fee / 50 is the typical tick spacing for V4
      hooks: ZERO,
      token0: ZERO,
      token1: EGSW,
      poolId: EGSW_POOL_ID,
      isWETHPair: false,
    },
    recipient: ARB_CONTRACT,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });

  const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: calldata });
  const v4SellCommands = decoded.args[0] as `0x${string}`;
  const v4SellInputs = decoded.args[1] as `0x${string}`[];

  // 4. First test: simulate V4 sell directly from wallet to see if it works
  console.log('\nTest: simulating V4 sell directly from wallet...');
  const UR = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

  // Need wallet to have tokens approved to Permit2 -> UR for simulation
  const ERC20 = [
    { type: 'function', name: 'allowance', inputs: [{name:'',type:'address'},{name:'',type:'address'}], outputs: [{name:'',type:'uint256'}], stateMutability: 'view' },
    { type: 'function', name: 'approve', inputs: [{name:'',type:'address'},{name:'',type:'uint256'}], outputs: [{name:'',type:'bool'}], stateMutability: 'nonpayable' },
    { type: 'function', name: 'balanceOf', inputs: [{name:'',type:'address'}], outputs: [{name:'',type:'uint256'}], stateMutability: 'view' },
  ] as const;

  const walletEgsw = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`Wallet EGSW: ${formatEther(walletEgsw)}`);

  // Encode a sell for tokens we already have (from wallet, smaller amount)
  const testSellAmt = walletEgsw < buyQuote.amount ? walletEgsw : buyQuote.amount;
  const { calldata: walletSellCalldata } = encodeSwap({
    direction: 'sell',
    tokenAddress: EGSW,
    amount: testSellAmt,
    pool: {
      version: 'v4',
      poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
      fee: lpFee,
      tickSpacing: Number(lpFee) / 50,
      hooks: ZERO,
      token0: ZERO,
      token1: EGSW,
      poolId: EGSW_POOL_ID,
      isWETHPair: false,
    },
    recipient: account.address,
    minAmountOut: 0n,
    isNativeEthPool: true,
  });

  try {
    await pub.call({ to: UR, data: walletSellCalldata, account: account.address, gas: 3_000_000n });
    console.log('V4 sell simulation PASSED!');
  } catch (e: any) {
    console.log(`V4 sell simulation FAILED: ${e.message?.slice(0, 200)}`);

    // Maybe tickSpacing is wrong. Let me try common values
    for (const ts of [198, 200, 100, 50, 10, 1]) {
      try {
        const { calldata: tc } = encodeSwap({
          direction: 'sell', tokenAddress: EGSW, amount: testSellAmt,
          pool: { version: 'v4', poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
            fee: lpFee, tickSpacing: ts, hooks: ZERO, token0: ZERO, token1: EGSW,
            poolId: EGSW_POOL_ID, isWETHPair: false },
          recipient: account.address, minAmountOut: 0n, isNativeEthPool: true,
        });
        await pub.call({ to: UR, data: tc, account: account.address, gas: 3_000_000n });
        console.log(`  tickSpacing=${ts} WORKS!`);
        break;
      } catch { console.log(`  tickSpacing=${ts} failed`); }
    }
    return;
  }

  // 5. Build and execute arb
  console.log('\nBuilding arb call...');
  const nadFunMinTokens = buyQuote.amount * 85n / 100n;
  const arbCalldata = encodeFunctionData({
    abi: EIGEN_ARB_ABI,
    functionName: 'arbBuyNadSellV4',
    args: [EGSW, nadRouter, 0n, nadFunMinTokens, v4SellCommands, v4SellInputs],
  });

  console.log('Simulating arb...');
  try {
    await pub.call({ to: ARB_CONTRACT, data: arbCalldata, value: tradeAmount, account: account.address, gas: 3_000_000n });
    console.log('Arb simulation PASSED!');
  } catch (e: any) {
    console.log(`Arb simulation failed: ${e.message?.slice(0, 200)}`);
  }

  console.log('\nExecuting arb TX...');
  const monBefore = await pub.getBalance({ address: account.address });
  const arbMonBefore = await pub.getBalance({ address: ARB_CONTRACT });

  const txHash = await wallet.sendTransaction({
    to: ARB_CONTRACT, data: arbCalldata, value: tradeAmount, gas: 3_000_000n,
  });
  console.log(`TX: ${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  const monAfter = await pub.getBalance({ address: account.address });
  const arbMonAfter = await pub.getBalance({ address: ARB_CONTRACT });
  console.log(`\nWallet MON delta: ${formatEther(monAfter - monBefore)} (includes gas)`);
  console.log(`Arb contract MON: ${formatEther(arbMonAfter)} (delta: ${formatEther(arbMonAfter - arbMonBefore)})`);
}

main().catch(console.error);
