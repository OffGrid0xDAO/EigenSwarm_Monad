/**
 * Check EGSW V4 pool reserves (MON + EGSW in the specific pool, not all pools)
 */
import 'dotenv/config';
import { formatEther, createPublicClient, http, type Address, type Hex } from 'viem';
import { monad } from 'viem/chains';
import { UNISWAP_V4_STATE_VIEW } from '@eigenswarm/shared';

const pub = createPublicClient({ chain: monad, transport: http(process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz') });

const EGSW = '0x2bb7dac00efac28c3b76a1d72757c65c38ef7777' as Address;
const EGSW_POOL_ID = '0x9a3761cf2433c7514dd09f3ec2e5e42bebb2affb648bcb3d0263551aedb1fd8e' as Hex;

const STATE_VIEW_ABI = [
  { type: 'function', name: 'getSlot0', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }
  ], stateMutability: 'view' },
  { type: 'function', name: 'getLiquidity', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: '', type: 'uint128' }
  ], stateMutability: 'view' },
] as const;

// PoolManager stores per-pool currency deltas as a mapping:
// mapping(PoolId => mapping(Currency => int256)) internal _currencyDelta
// But V4 doesn't expose per-pool reserves directly. We need to compute from liquidity + price.

async function main() {
  const slot0 = await pub.readContract({
    address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI,
    functionName: 'getSlot0', args: [EGSW_POOL_ID],
  });
  const liq = await pub.readContract({
    address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI,
    functionName: 'getLiquidity', args: [EGSW_POOL_ID],
  });

  const sqrtPriceX96 = slot0[0];
  const tick = slot0[1];
  const lpFee = slot0[3];

  // sqrtPrice as a float
  const Q96 = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtP * sqrtP; // EGSW per MON
  const priceInv = 1 / price;  // MON per EGSW

  const L = Number(liq);

  // For concentrated liquidity at the current tick, the in-range reserves are:
  //   token0 (MON/ETH) = L / sqrtP
  //   token1 (EGSW)    = L * sqrtP
  // These are the "virtual" reserves at the current price point.
  // The actual tradeable depth depends on tick range of positions.
  const virtualMON = L / sqrtP / 1e18;
  const virtualEGSW = L * sqrtP / 1e18;

  // Estimate tradeable depth: how much MON can you get by selling EGSW (or vice versa)
  // For a rough estimate, use the constant-product approximation at current liquidity:
  // If you sell X EGSW, you get approximately: X * priceInv * (1 - fee/1e6) for small X
  // For larger trades, price impact kicks in.

  console.log('=== EGSW V4 Pool ===');
  console.log(`Pool ID: ${EGSW_POOL_ID}`);
  console.log(`Tick: ${tick}`);
  console.log(`Fee: ${lpFee} (${(lpFee / 10000).toFixed(2)}%)`);
  console.log(`Liquidity: ${liq.toString()}`);
  console.log();
  console.log(`Price: ${price.toFixed(2)} EGSW/MON`);
  console.log(`Price: ${priceInv.toFixed(10)} MON/EGSW`);
  console.log();
  console.log(`Virtual reserves at current tick:`);
  console.log(`  MON:  ~${virtualMON.toFixed(2)}`);
  console.log(`  EGSW: ~${virtualEGSW.toFixed(2)}`);
  console.log();

  // Estimate how much MON you'd get selling various amounts of EGSW
  // Using x * y = k approximation: dy = L^2 / (x + dx) - y  ... simplified:
  // For exact-in swap: amountOut = L^2 * dx / (x * (x + dx)) adjusted for fee
  console.log('Estimated trade depth (sell EGSW -> MON):');
  for (const egswSell of [1000, 10000, 50000, 100000, 500000]) {
    // dy = virtualMON - L^2 / (L * sqrtP + dx * 1e18) / 1e18
    // Simplified: amountOut ≈ egswSell * priceInv * (1 - priceImpact)
    const dx = egswSell;
    const newVirtualEGSW = virtualEGSW + dx;
    const newVirtualMON = (L / 1e18) * (L / 1e18) / newVirtualEGSW;
    const monOut = virtualMON - newVirtualMON;
    const effectivePrice = monOut / dx;
    const impact = ((priceInv - effectivePrice) / priceInv * 100);
    const afterFee = monOut * (1 - lpFee / 1e6);
    console.log(`  ${egswSell.toLocaleString()} EGSW -> ~${afterFee.toFixed(4)} MON (${impact.toFixed(1)}% impact)`);
  }

  console.log();
  console.log('Estimated trade depth (buy EGSW with MON):');
  for (const monSpend of [1, 5, 10, 50, 100]) {
    const dx = monSpend;
    const newVirtualMON = virtualMON + dx;
    const newVirtualEGSW = (L / 1e18) * (L / 1e18) / newVirtualMON;
    const egswOut = virtualEGSW - newVirtualEGSW;
    const effectivePrice = dx / egswOut;
    const impact = ((effectivePrice - priceInv) / priceInv * 100);
    const afterFee = egswOut * (1 - lpFee / 1e6);
    console.log(`  ${monSpend} MON -> ~${afterFee.toFixed(2)} EGSW (${impact.toFixed(1)}% impact)`);
  }
}

main().catch(console.error);
