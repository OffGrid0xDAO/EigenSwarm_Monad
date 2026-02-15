import { createPublicClient, http, getAddress, toHex, encodeAbiParameters, parseAbiParameters, concat, encodeFunctionData, decodeAbiParameters, hexToBytes } from 'viem';
import { base } from 'viem/chains';
import { WETH_ADDRESS, UNISWAP_V4_UNIVERSAL_ROUTER } from '@eigenswarm/shared';
import { encodeSwap, type PoolInfo } from './swap-encoder';

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const KEEPER = '0x42069c220DD72541C2C7Cb7620f2094f1601430A' as `0x${string}`;
const FOMOLT = getAddress('0xeff5672a3e73e104a56b7d16c1166f2ae0714b07');
const HOOKS = getAddress('0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc');

async function main() {
  console.log('=== Comparing our encoding with successful tx ===\n');

  // Fetch the successful tx to get its exact calldata
  const tx = await client.getTransaction({ hash: '0x0e0e14efddc16ed6359519cd20f41056728ee5e5bb1bfdb195dd832fce98f584' as `0x${string}` });
  console.log('Successful tx input length:', tx.input.length);

  // Decode the successful tx
  const params = decodeAbiParameters(
    parseAbiParameters('bytes commands, bytes[] inputs, uint256 deadline'),
    ('0x' + tx.input.slice(10)) as `0x${string}`
  );
  const successInputs = params[1];

  // Get the V4_SWAP input from successful tx
  const successV4Params = decodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    successInputs[1]
  );

  console.log('Success tx actions:', successV4Params[0]);
  console.log('Success tx SWAP params (raw):', successV4Params[1][0].slice(0, 200), '...');
  console.log('Success tx SETTLE params (raw):', successV4Params[1][1]);
  console.log('Success tx TAKE params (raw):', successV4Params[1][2]);

  // Now encode our version
  const pool: PoolInfo = {
    version: 'v4',
    poolAddress: '0x3e81aac5ec50c74b3bc88a6c063bad6ff6cdc260dda96992e6c5885ee05f363f',
    fee: 8388608,
    tickSpacing: 200,
    hooks: HOOKS,
    token0: WETH_ADDRESS as `0x${string}`,
    token1: FOMOLT,
    poolId: '0x3e81aac5ec50c74b3bc88a6c063bad6ff6cdc260dda96992e6c5885ee05f363f' as `0x${string}`,
    isWETHPair: true,
  };

  // Use same amount as successful tx: 100000000000000 (0.0001 ETH)
  const ethAmount = 100000000000000n;
  const { router, calldata } = encodeSwap({
    direction: 'buy',
    tokenAddress: FOMOLT,
    amount: ethAmount,
    pool,
    recipient: KEEPER,
    minAmountOut: 0n,
  });

  // Decode our calldata to compare
  const ourParams = decodeAbiParameters(
    parseAbiParameters('bytes commands, bytes[] inputs, uint256 deadline'),
    ('0x' + calldata.slice(10)) as `0x${string}`
  );
  const ourInputs = ourParams[1];
  const ourV4Params = decodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    ourInputs[1]
  );

  console.log('\n=== COMPARISON ===');
  console.log('Actions match:', successV4Params[0] === ourV4Params[0],
    '| success:', successV4Params[0], '| ours:', ourV4Params[0]);

  // Compare SWAP params (Action 0)
  console.log('\n--- SWAP params (Action 0) ---');
  console.log('Success:', successV4Params[1][0]);
  console.log('Ours:   ', ourV4Params[1][0]);
  console.log('Match:', successV4Params[1][0] === ourV4Params[1][0]);

  // Decode both SWAP params to see field-level differences
  try {
    const successSwap = decodeAbiParameters(
      parseAbiParameters('address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 amountIn, uint128 amountOutMinimum'),
      successV4Params[1][0]
    );
    console.log('\nSuccess SWAP decoded:');
    console.log('  currencyIn:', successSwap[0]);
    console.log('  path[0].intermediateCurrency:', successSwap[1][0].intermediateCurrency);
    console.log('  path[0].fee:', successSwap[1][0].fee);
    console.log('  path[0].tickSpacing:', successSwap[1][0].tickSpacing);
    console.log('  path[0].hooks:', successSwap[1][0].hooks);
    console.log('  path[0].hookData:', successSwap[1][0].hookData);
    console.log('  amountIn:', successSwap[2].toString());
    console.log('  amountOutMinimum:', successSwap[3].toString());
  } catch(e) {
    console.log('Failed to decode success SWAP with uint24 fee:', (e as Error).message.slice(0, 300));
  }

  try {
    const ourSwap = decodeAbiParameters(
      parseAbiParameters('address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 amountIn, uint128 amountOutMinimum'),
      ourV4Params[1][0]
    );
    console.log('\nOur SWAP decoded:');
    console.log('  currencyIn:', ourSwap[0]);
    console.log('  path[0].intermediateCurrency:', ourSwap[1][0].intermediateCurrency);
    console.log('  path[0].fee:', ourSwap[1][0].fee);
    console.log('  path[0].tickSpacing:', ourSwap[1][0].tickSpacing);
    console.log('  path[0].hooks:', ourSwap[1][0].hooks);
    console.log('  path[0].hookData:', ourSwap[1][0].hookData);
    console.log('  amountIn:', ourSwap[2].toString());
    console.log('  amountOutMinimum:', ourSwap[3].toString());
  } catch(e) {
    console.log('Failed to decode our SWAP:', (e as Error).message.slice(0, 300));
  }

  // Compare SETTLE params (Action 1)
  console.log('\n--- SETTLE params (Action 1) ---');
  console.log('Success:', successV4Params[1][1]);
  console.log('Ours:   ', ourV4Params[1][1]);
  console.log('Match:', successV4Params[1][1] === ourV4Params[1][1]);

  // Compare TAKE params (Action 2)
  console.log('\n--- TAKE params (Action 2) ---');
  console.log('Success:', successV4Params[1][2]);
  console.log('Ours:   ', ourV4Params[1][2]);

  // Now try the actual eth_call simulation
  console.log('\n\n=== ETH_CALL TEST ===');
  try {
    const result = await client.request({
      method: 'eth_call' as any,
      params: [{
        from: KEEPER,
        to: router,
        data: calldata,
        value: toHex(ethAmount),
        gas: toHex(1000000),
      }, 'latest'] as any,
    });
    console.log('V4 BUY: SUCCESS!', result);
  } catch(e: any) {
    console.log('V4 BUY: FAILED');
    console.log('error.message:', e?.message?.slice(0, 400));
    if (e?.cause?.data) console.log('error.cause.data:', e.cause.data);
  }

  // Also test with the EXACT calldata from successful tx (just changing from address to ours)
  console.log('\n=== REPLAY SUCCESSFUL TX CALLDATA ===');
  try {
    const result = await client.request({
      method: 'eth_call' as any,
      params: [{
        from: tx.from,
        to: tx.to,
        data: tx.input,
        value: toHex(tx.value),
        gas: toHex(1000000),
      }, 'latest'] as any,
    });
    console.log('REPLAY: SUCCESS!', result);
  } catch(e: any) {
    console.log('REPLAY: FAILED');
    console.log('error.message:', e?.message?.slice(0, 300));
    if (e?.cause?.data) console.log('error.cause.data:', e.cause.data);
  }
}

main().catch(console.error);
