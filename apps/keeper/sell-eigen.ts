/**
 * Sell all EIGEN tokens on nad.fun bonding curve
 */
import 'dotenv/config';
import { formatEther, createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createTrading } from '@nadfun/sdk';

const EIGEN = '0xFa00f6635D32782E0a9fCb4250C68989c5577777' as Address;
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
  const bal = await pub.readContract({ address: EIGEN, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`EIGEN balance: ${formatEther(bal)}`);
  if (bal === 0n) { console.log('Nothing to sell'); return; }

  const trading = createTrading({ rpcUrl: RPC, privateKey: PK, network: 'mainnet' });

  // Get quote
  const quote = await trading.getAmountOut(EIGEN, bal, false);
  const router = quote.router as Address;
  console.log(`Sell ${formatEther(bal)} EIGEN -> ${formatEther(quote.amount)} MON`);
  console.log(`Router: ${router}`);

  // Approve token to router
  const allowance = await pub.readContract({ address: EIGEN, abi: ERC20, functionName: 'allowance', args: [account.address, router] });
  if (allowance < bal) {
    console.log('Approving EIGEN -> router...');
    const tx = await wallet.writeContract({ address: EIGEN, abi: ERC20, functionName: 'approve', args: [router, bal * 2n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log('Approved');
  }

  const monBefore = await pub.getBalance({ address: account.address });

  // Sell
  const minOut = quote.amount * 85n / 100n; // 15% slippage for bonding curve
  console.log(`Min out: ${formatEther(minOut)} MON`);
  const txHash = await trading.sell(
    { token: EIGEN, to: account.address, amountIn: bal, amountOutMin: minOut },
    router,
  );
  console.log(`TX: ${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
  console.log(`Status: ${receipt.status}`);

  const monAfter = await pub.getBalance({ address: account.address });
  console.log(`MON received: ${formatEther(monAfter - monBefore)} (includes gas)`);

  const remaining = await pub.readContract({ address: EIGEN, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`Remaining EIGEN: ${formatEther(remaining)}`);
}
main().catch(console.error);
