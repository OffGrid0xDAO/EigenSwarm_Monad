/**
 * Sell EGSW tokens from wallet on nad.fun
 */
import 'dotenv/config';
import { formatEther, createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createTrading } from '@nadfun/sdk';

const EGSW = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777' as Address;
const RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PK = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account });

const ERC20 = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'allowance', inputs: [{ name: '', type: 'address' }, { name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: '', type: 'address' }, { name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

async function main() {
  let bal = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`EGSW balance: ${formatEther(bal)}`);
  if (bal === 0n) { console.log('Nothing to sell'); return; }

  const trading = createTrading({ rpcUrl: RPC, privateKey: PK, network: 'mainnet' });

  // Get quote for full balance
  const quote = await trading.getAmountOut(EGSW, bal, false);
  const router = quote.router as Address;
  console.log(`Sell ${formatEther(bal)} EGSW -> ~${formatEther(quote.amount)} MON`);
  console.log(`Router: ${router}`);

  // Approve
  const allowance = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'allowance', args: [account.address, router] });
  if (allowance < bal) {
    console.log('Approving EGSW -> router...');
    const tx = await wallet.writeContract({ address: EGSW, abi: ERC20, functionName: 'approve', args: [router, bal * 2n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log('Approved');
  }

  const monBefore = await pub.getBalance({ address: account.address });

  // Sell with 15% slippage tolerance (bonding curve has high slippage for large amounts)
  const minOut = quote.amount * 80n / 100n;
  console.log(`Min out: ${formatEther(minOut)} MON`);
  try {
    const txHash = await trading.sell(
      { token: EGSW, to: account.address, amountIn: bal, amountOutMin: minOut },
      router,
    );
    console.log(`TX: ${txHash}`);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    console.log(`Status: ${receipt.status}`);

    const monAfter = await pub.getBalance({ address: account.address });
    console.log(`MON received: ${formatEther(monAfter - monBefore)} (includes gas)`);
  } catch (e: any) {
    console.log(`Sell failed: ${e.message?.slice(0, 200)}`);
    console.log('Trying smaller batches...');

    // Try selling half
    const half = bal / 2n;
    const halfQuote = await trading.getAmountOut(EGSW, half, false);
    const halfMin = halfQuote.amount * 80n / 100n;
    console.log(`Selling half: ${formatEther(half)} EGSW -> ~${formatEther(halfQuote.amount)} MON`);
    const tx1 = await trading.sell(
      { token: EGSW, to: account.address, amountIn: half, amountOutMin: halfMin },
      router,
    );
    console.log(`TX1: ${tx1}`);
    await pub.waitForTransactionReceipt({ hash: tx1 as `0x${string}` });

    // Sell remaining
    bal = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    if (bal > 0n) {
      const q2 = await trading.getAmountOut(EGSW, bal, false);
      const tx2 = await trading.sell(
        { token: EGSW, to: account.address, amountIn: bal, amountOutMin: q2.amount * 80n / 100n },
        router,
      );
      console.log(`TX2: ${tx2}`);
      await pub.waitForTransactionReceipt({ hash: tx2 as `0x${string}` });
    }

    const monAfter = await pub.getBalance({ address: account.address });
    console.log(`Total MON received: ${formatEther(monAfter - monBefore)} (includes gas)`);
  }

  const remaining = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`Remaining EGSW: ${formatEther(remaining)}`);
  console.log(`Final MON balance: ${formatEther(await pub.getBalance({ address: account.address }))}`);
}

main().catch(console.error);
