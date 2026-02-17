import 'dotenv/config';
import { createPublicClient, http, type Hex } from 'viem';
import { monad } from 'viem/chains';
import { UNISWAP_V4_STATE_VIEW } from '@eigenswarm/shared';

const pub = createPublicClient({ chain: monad, transport: http(process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz') });

const TX_TOKEN = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777';
const EIGEN_TOKEN = '0xFa00f6635D32782E0a9fCb4250C68989c5577777';
const TX_POOL_ID = '0x9a3761cf2433c7514dd09f3ec2e5e42bebb2affb648bcb3d0263551aedb1fd8e' as `0x${string}`;
const EIGEN_POOL_ID = '0xb06bc6347a0ea337aa366ebbdc2d07a37a578382750a03d1513d985329dd5936' as `0x${string}`;

const STATE_VIEW_ABI = [
  { type: 'function', name: 'getSlot0', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }
  ], stateMutability: 'view' },
  { type: 'function', name: 'getLiquidity', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint128' }
  ], stateMutability: 'view' },
] as const;

async function main() {
  console.log('Token in your tx:', TX_TOKEN);
  console.log('EIGEN token:     ', EIGEN_TOKEN);
  const same = TX_TOKEN.toLowerCase() === EIGEN_TOKEN.toLowerCase();
  console.log('Same token?', same);

  console.log('\n--- Pool from your TX ---');
  const slot0_tx = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [TX_POOL_ID] });
  const liq_tx = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [TX_POOL_ID] });
  console.log('Pool ID:', TX_POOL_ID);
  console.log('sqrtPriceX96:', slot0_tx[0].toString());
  console.log('tick:', slot0_tx[1]);
  console.log('lpFee:', slot0_tx[3]);
  console.log('liquidity:', liq_tx.toString());

  console.log('\n--- EIGEN Pool ---');
  const slot0_e = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [EIGEN_POOL_ID] });
  const liq_e = await pub.readContract({ address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [EIGEN_POOL_ID] });
  console.log('Pool ID:', EIGEN_POOL_ID);
  console.log('sqrtPriceX96:', slot0_e[0].toString());
  console.log('tick:', slot0_e[1]);
  console.log('lpFee:', slot0_e[3]);
  console.log('liquidity:', liq_e.toString());

  if (liq_e === 0n) {
    console.log('\n*** EIGEN V4 pool has ZERO liquidity — initialized but empty ***');
    console.log('tick 887271 is near MAX_TICK (887272) — pool at extreme price with no LPs');
  }
}

main().catch(console.error);
