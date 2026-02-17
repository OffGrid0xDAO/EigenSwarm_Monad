/**
 * Debug: test each leg of the arb separately.
 * Step 1: Buy tokens on nad.fun via arb contract
 * Step 2: Check if tokens landed in arb contract
 * Step 3: Try V4 sell from arb contract
 */
import 'dotenv/config';
import { formatEther, parseEther, encodeFunctionData, encodeAbiParameters, parseAbiParameters, createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';

const TOKEN_ADDRESS = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
const ARB_CONTRACT = '0xE12fFA15A5F48e19db72de8f671001CC3fA1D661' as Address;
const NADFUN_DEX_ROUTER = '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137' as Address;

const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });
const walletClient = createWalletClient({ chain: monad, transport: http(RPC_URL), account });

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// Test: call nad.fun DEX router buy directly from the arb contract using a low-level call
// Since the arb contract only has arbBuyNadSellV4, let's test step by step

// Actually, let's just test buying directly on nad.fun from our wallet, then check pricing
async function main() {
  console.log('=== Debug: Testing nad.fun buy separately ===');

  // Check token balance of arb contract
  const arbTokenBal = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ARB_CONTRACT],
  });
  console.log(`Arb contract EIGEN balance: ${formatEther(arbTokenBal)}`);

  // Test: directly call the nad.fun router buy from our wallet to see if it works
  console.log('\nTest 1: Direct nad.fun buy from wallet...');
  const tradeAmount = parseEther('5'); // 5 MON

  // nad.fun DexRouter.buy(BuyParams{amountOutMin, token, to, deadline})
  const NADFUN_BUY_ABI = [{
    type: 'function',
    name: 'buy',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'amountOutMin', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  }] as const;

  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    // First simulate
    const simResult = await publicClient.simulateContract({
      address: NADFUN_DEX_ROUTER,
      abi: NADFUN_BUY_ABI,
      functionName: 'buy',
      args: [{
        amountOutMin: 0n,
        token: TOKEN_ADDRESS,
        to: account.address,
        deadline,
      }],
      value: tradeAmount,
      account: account.address,
    });
    console.log(`Simulation OK — expected output: ${formatEther(simResult.result)} EIGEN`);
  } catch (err: any) {
    console.log(`Simulation failed: ${err.message?.slice(0, 200)}`);
  }

  // Test 2: Check if we can call nad.fun buy with `to: ARB_CONTRACT`
  console.log('\nTest 2: nad.fun buy with to=ARB_CONTRACT...');
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const simResult = await publicClient.simulateContract({
      address: NADFUN_DEX_ROUTER,
      abi: NADFUN_BUY_ABI,
      functionName: 'buy',
      args: [{
        amountOutMin: 0n,
        token: TOKEN_ADDRESS,
        to: ARB_CONTRACT,
        deadline,
      }],
      value: tradeAmount,
      account: account.address,
    });
    console.log(`Simulation OK — output to arb contract: ${formatEther(simResult.result)} EIGEN`);
  } catch (err: any) {
    console.log(`Simulation failed: ${err.message?.slice(0, 200)}`);
  }

  // Test 3: Simulate the arb contract's nad.fun buy internally
  // The issue might be that the nad.fun router checks msg.sender
  // and the arb contract is the caller, not the wallet.
  console.log('\nTest 3: Simulating the full arbBuyNadSellV4 call...');

  // Let's try a much simpler approach: just do the nad.fun buy + V4 sell in two separate txs from our wallet
  // This tells us if both legs work independently

  // Test nad.fun buy from wallet
  console.log('\nTest 4: Actually executing nad.fun buy from wallet (5 MON)...');
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const walletTokenBefore = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    const txHash = await walletClient.writeContract({
      address: NADFUN_DEX_ROUTER,
      abi: NADFUN_BUY_ABI,
      functionName: 'buy',
      args: [{
        amountOutMin: 0n,
        token: TOKEN_ADDRESS,
        to: account.address,
        deadline,
      }],
      value: tradeAmount,
    });

    console.log(`TX: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Status: ${receipt.status}`);
    console.log(`Gas: ${receipt.gasUsed}`);

    const walletTokenAfter = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    const tokensReceived = walletTokenAfter - walletTokenBefore;
    console.log(`Tokens received: ${formatEther(tokensReceived)} EIGEN`);

    // Now test V4 sell of those tokens
    console.log('\nTest 5: V4 sell of received tokens from wallet...');
    const { encodeSwap } = await import('./src/swap-encoder');
    const { calldata } = encodeSwap({
      direction: 'sell',
      tokenAddress: TOKEN_ADDRESS,
      amount: tokensReceived,
      pool: {
        version: 'v4',
        poolAddress: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
        fee: 9900,
        tickSpacing: 198,
        hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        token0: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        token1: TOKEN_ADDRESS,
        poolId: '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936' as `0x${string}`,
        isWETHPair: false,
      },
      recipient: account.address,
      minAmountOut: 0n,
      isNativeEthPool: true,
    });

    const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
    const UR = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;

    // Check if token approved to Permit2
    const p2Allowance = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, PERMIT2],
    });
    console.log(`Token→Permit2 allowance: ${formatEther(p2Allowance)}`);

    if (p2Allowance < tokensReceived) {
      console.log('Approving token → Permit2...');
      const APPROVE_ABI = [{ type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' }] as const;
      const approveTx = await walletClient.writeContract({
        address: TOKEN_ADDRESS,
        abi: APPROVE_ABI,
        functionName: 'approve',
        args: [PERMIT2, tokensReceived * 100n],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log('Approved');
    }

    // Set Permit2 → Universal Router allowance
    const PERMIT2_ABI = [
      { type: 'function', name: 'approve', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [], stateMutability: 'nonpayable' },
      { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], stateMutability: 'view' },
    ] as const;

    const [p2Amt] = await publicClient.readContract({
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [account.address, TOKEN_ADDRESS, UR],
    });
    console.log(`Permit2→UR allowance: ${p2Amt}`);

    if (p2Amt < tokensReceived) {
      console.log('Setting Permit2 → UR allowance...');
      const maxUint160 = (1n << 160n) - 1n;
      const maxUint48 = (1n << 48n) - 1n;
      const p2Tx = await walletClient.writeContract({
        address: PERMIT2,
        abi: PERMIT2_ABI,
        functionName: 'approve',
        args: [TOKEN_ADDRESS, UR, maxUint160, Number(maxUint48)],
      });
      await publicClient.waitForTransactionReceipt({ hash: p2Tx });
      console.log('Set');
    }

    // Execute V4 sell
    const monBefore = await publicClient.getBalance({ address: account.address });
    const sellTx = await walletClient.sendTransaction({
      to: UR,
      data: calldata,
      gas: 500_000n,
    });
    console.log(`V4 sell TX: ${sellTx}`);
    const sellReceipt = await publicClient.waitForTransactionReceipt({ hash: sellTx });
    console.log(`Status: ${sellReceipt.status}`);
    console.log(`Gas: ${sellReceipt.gasUsed}`);

    const monAfter = await publicClient.getBalance({ address: account.address });
    console.log(`MON received from V4 sell: ${formatEther(monAfter - monBefore)} MON (includes gas cost)`);

    const walletTokenFinal = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
    console.log(`Remaining tokens: ${formatEther(walletTokenFinal)}`);

  } catch (err: any) {
    console.error(`Failed: ${err.message?.slice(0, 300)}`);
  }
}

main().catch(console.error);
