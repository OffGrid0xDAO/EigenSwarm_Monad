/**
 * Decode the user's working V4 swap tx to understand exact encoding
 */
import 'dotenv/config';
import {
  formatEther, createPublicClient, http, decodeAbiParameters, parseAbiParameters,
  type Hex, type Address, decodeFunctionData,
} from 'viem';
import { monad } from 'viem/chains';

const pub = createPublicClient({ chain: monad, transport: http(process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz') });
const txHash = '0x46bd8ab20ff416ed8d6836ac0c45e2140399e130d32b1c9dfd1d7b5ffa43c82a' as Hex;

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
  const tx = await pub.getTransaction({ hash: txHash });
  console.log('From:', tx.from);
  console.log('To:', tx.to);
  console.log('Value:', formatEther(tx.value), 'MON');

  // Decode execute(bytes commands, bytes[] inputs, uint256 deadline)
  const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: tx.input });
  const commands = decoded.args[0] as Hex;
  const inputs = decoded.args[1] as Hex[];
  const deadline = decoded.args[2] as bigint;

  console.log('\nCommands:', commands);
  console.log('Deadline:', deadline.toString());
  console.log('Number of inputs:', inputs.length);

  // Parse each command byte
  const cmdBytes = commands.slice(2); // remove 0x
  for (let i = 0; i < cmdBytes.length; i += 2) {
    const cmd = parseInt(cmdBytes.slice(i, i + 2), 16);
    const cmdName = cmd === 0x0a ? 'PERMIT2_PERMIT' :
                    cmd === 0x0b ? 'WRAP_ETH' :
                    cmd === 0x0c ? 'UNWRAP_WETH' :
                    cmd === 0x10 ? 'V4_SWAP' :
                    `UNKNOWN(0x${cmd.toString(16)})`;
    console.log(`\n=== Command ${i/2}: ${cmdName} (0x${cmd.toString(16)}) ===`);

    const input = inputs[i/2];

    if (cmd === 0x0b) {
      // WRAP_ETH: abi.decode(inputs, (address recipient, uint256 amountMin))
      const [recipient, amountMin] = decodeAbiParameters(
        parseAbiParameters('address recipient, uint256 amountMin'),
        input,
      );
      console.log('  Recipient:', recipient);
      console.log('  AmountMin:', formatEther(amountMin), 'MON');
    }

    if (cmd === 0x0c) {
      // UNWRAP_WETH: abi.decode(inputs, (address recipient, uint256 amountMin))
      const [recipient, amountMin] = decodeAbiParameters(
        parseAbiParameters('address recipient, uint256 amountMin'),
        input,
      );
      console.log('  Recipient:', recipient);
      console.log('  AmountMin:', formatEther(amountMin));
    }

    if (cmd === 0x10) {
      // V4_SWAP: abi.decode(inputs, (bytes actions, bytes[] params))
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters('bytes actions, bytes[] params'),
        input,
      );
      console.log('  Actions:', actions);

      // Parse each action
      const actBytes = (actions as Hex).slice(2);
      for (let j = 0; j < actBytes.length; j += 2) {
        const act = parseInt(actBytes.slice(j, j + 2), 16);
        const actName = act === 0x07 ? 'SWAP_EXACT_IN' :
                        act === 0x08 ? 'SWAP_EXACT_IN_SINGLE' :
                        act === 0x0b ? 'SETTLE' :
                        act === 0x0c ? 'SETTLE_ALL' :
                        act === 0x0e ? 'TAKE' :
                        act === 0x0f ? 'TAKE_ALL' :
                        act === 0x12 ? 'TAKE_PORTION' :
                        `UNKNOWN(0x${act.toString(16)})`;
        console.log(`\n  Action ${j/2}: ${actName} (0x${act.toString(16)})`);

        const param = (params as Hex[])[j/2];

        if (act === 0x07) {
          // SWAP_EXACT_IN: abi.decode(params, (ExactInputParams))
          // ExactInputParams: (address currencyIn, PathKey[] path, uint128 amountIn, uint128 amountOutMinimum)
          // PathKey: (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)
          try {
            const result = decodeAbiParameters(
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
              param,
            );
            const eip = result[0] as any;
            console.log('    currencyIn:', eip.currencyIn);
            console.log('    amountIn:', formatEther(eip.amountIn));
            console.log('    amountOutMinimum:', formatEther(eip.amountOutMinimum));
            console.log('    path:');
            for (const pk of eip.path) {
              console.log('      intermediateCurrency:', pk.intermediateCurrency);
              console.log('      fee:', pk.fee);
              console.log('      tickSpacing:', pk.tickSpacing);
              console.log('      hooks:', pk.hooks);
            }
          } catch (e: any) {
            console.log('    Decode failed:', e.message?.slice(0, 100));
            console.log('    Raw param:', param.slice(0, 200));
          }
        }

        if (act === 0x0b) {
          // SETTLE: (address currency, uint256 maxAmount, bool payerIsUser)
          const [currency, maxAmount, payerIsUser] = decodeAbiParameters(
            parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
            param,
          );
          console.log('    currency:', currency);
          console.log('    maxAmount:', maxAmount.toString());
          console.log('    payerIsUser:', payerIsUser);
        }

        if (act === 0x0e) {
          // TAKE: (address currency, address recipient, uint256 minAmount)
          const [currency, recipient, minAmount] = decodeAbiParameters(
            parseAbiParameters('address currency, address recipient, uint256 minAmount'),
            param,
          );
          console.log('    currency:', currency);
          console.log('    recipient:', recipient);
          console.log('    minAmount:', minAmount.toString());
        }
      }
    }
  }
}

main().catch(console.error);
