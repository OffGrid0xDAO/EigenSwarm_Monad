/**
 * Test V4 sell for EGSW with exact encoding matching the working buy tx pattern
 */
import 'dotenv/config';
import {
  formatEther, parseEther, createPublicClient, createWalletClient, http,
  encodeAbiParameters, parseAbiParameters, concat, toHex, encodeFunctionData,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';

const EGSW = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777' as Address;
const UR = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3' as Address;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

const RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PK = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account });

const ERC20 = [
  { type: 'function', name: 'balanceOf', inputs: [{name:'',type:'address'}], outputs: [{name:'',type:'uint256'}], stateMutability: 'view' },
  { type: 'function', name: 'allowance', inputs: [{name:'',type:'address'},{name:'',type:'address'}], outputs: [{name:'',type:'uint256'}], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{name:'',type:'address'},{name:'',type:'uint256'}], outputs: [{name:'',type:'bool'}], stateMutability: 'nonpayable' },
] as const;

const P2_ABI = [
  { type: 'function', name: 'approve', inputs: [{name:'token',type:'address'},{name:'spender',type:'address'},{name:'amount',type:'uint160'},{name:'expiration',type:'uint48'}], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{name:'owner',type:'address'},{name:'token',type:'address'},{name:'spender',type:'address'}], outputs: [{name:'amount',type:'uint160'},{name:'expiration',type:'uint48'},{name:'nonce',type:'uint48'}], stateMutability: 'view' },
] as const;

const UR_ABI = [{
  type: 'function', name: 'execute',
  inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
  outputs: [], stateMutability: 'payable',
}] as const;

async function main() {
  const sellAmount = parseEther('1000'); // sell 1000 EGSW
  const bal = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  console.log(`Wallet EGSW: ${formatEther(bal)}`);
  if (bal < sellAmount) { console.log('Not enough EGSW'); return; }

  // 1. Ensure EGSW -> Permit2 approval
  const p2Allow = await pub.readContract({ address: EGSW, abi: ERC20, functionName: 'allowance', args: [account.address, PERMIT2] });
  console.log(`EGSW -> Permit2 allowance: ${formatEther(p2Allow)}`);
  if (p2Allow < sellAmount) {
    console.log('Approving EGSW -> Permit2...');
    const tx = await wallet.writeContract({ address: EGSW, abi: ERC20, functionName: 'approve', args: [PERMIT2, sellAmount * 100n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log('Done');
  }

  // 2. Ensure Permit2 -> UR approval for EGSW
  const [p2Amt] = await pub.readContract({ address: PERMIT2, abi: P2_ABI, functionName: 'allowance', args: [account.address, EGSW, UR] });
  console.log(`Permit2 -> UR allowance: ${p2Amt}`);
  if (p2Amt < sellAmount) {
    console.log('Setting Permit2 -> UR approval...');
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await wallet.writeContract({ address: PERMIT2, abi: P2_ABI, functionName: 'approve', args: [EGSW, UR, maxU160, Number(maxU48)] });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log('Done');
  }

  // 3. Encode sell: EGSW -> native ETH
  // Mirroring the working buy tx pattern exactly but reversed direction
  // Buy was: currencyIn=0x0 (ETH), SETTLE ETH, TAKE EGSW
  // Sell is:  currencyIn=EGSW, SETTLE EGSW, TAKE ETH(0x0)

  const ACTION_SWAP_EXACT_IN = 0x07;
  const ACTION_SETTLE = 0x0b;
  const ACTION_TAKE = 0x0e;

  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  // SWAP_EXACT_IN params (ExactInputParams struct)
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
      currencyIn: EGSW,
      path: [{
        intermediateCurrency: ZERO, // output = native ETH
        fee: 9900,
        tickSpacing: 198,
        hooks: ZERO,
        hookData: '0x' as `0x${string}`,
      }],
      amountIn: sellAmount,
      amountOutMinimum: 0n,
    }],
  );

  // SETTLE: pull EGSW from user via Permit2 (exact amount, not 0)
  const settleParams = encodeAbiParameters(
    parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
    [EGSW, sellAmount, true],
  );

  // TAKE: send native ETH to recipient
  const takeParams = encodeAbiParameters(
    parseAbiParameters('address currency, address recipient, uint256 minAmount'),
    [ZERO, account.address, 0n],
  );

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, [swapParams, settleParams, takeParams]],
  );

  const commands = concat([toHex(0x10, { size: 1 })]); // V4_SWAP only
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const calldata = encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: [commands, [v4SwapInput], deadline],
  });

  // 4. Simulate
  console.log('\nSimulating V4 sell (1000 EGSW -> MON)...');
  try {
    await pub.call({ to: UR, data: calldata, account: account.address, gas: 3_000_000n });
    console.log('Simulation PASSED!');
  } catch (e: any) {
    console.log(`Simulation FAILED: ${e.message?.slice(0, 200)}`);
    return;
  }

  // 5. Execute
  console.log('Executing V4 sell...');
  const monBefore = await pub.getBalance({ address: account.address });
  const txHash = await wallet.sendTransaction({ to: UR, data: calldata, gas: 3_000_000n });
  console.log(`TX: ${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  const monAfter = await pub.getBalance({ address: account.address });
  console.log(`MON received: ${formatEther(monAfter - monBefore)} (includes gas)`);
}

main().catch(console.error);
