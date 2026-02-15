import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type PublicClient,
} from 'viem';
import {
  WETH_ADDRESS,
  UNISWAP_V4_STATE_VIEW,
  CLANKER_DYNAMIC_FEE,
  CLANKER_TICK_SPACING,
  CLANKER_KNOWN_HOOKS,
} from '@eigenswarm/shared';

// StateView ABI (subset needed for slot0)
const STATE_VIEW_ABI = [
  {
    type: 'function' as const,
    name: 'getSlot0' as const,
    inputs: [{ name: 'poolId', type: 'bytes32' as const }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' as const },
      { name: 'tick', type: 'int24' as const },
      { name: 'protocolFee', type: 'uint24' as const },
      { name: 'lpFee', type: 'uint24' as const },
    ],
    stateMutability: 'view' as const,
  },
] as const;

/**
 * Compute the Uniswap V4 pool ID from the pool key components.
 * Matches the on-chain PoolId.toId() logic: keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
 */
export function computeV4PoolId(
  currency0: `0x${string}`,
  currency1: `0x${string}`,
  fee: number,
  tickSpacing: number,
  hooks: `0x${string}`,
): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [currency0, currency1, fee, tickSpacing, hooks],
  );
  return keccak256(encoded);
}

/**
 * Read the sqrtPriceX96 from a Clanker V4 pool after token deployment.
 *
 * Tries all known Clanker hook addresses to find the initialized pool,
 * then reads its slot0 from StateView.
 *
 * Returns the sqrtPriceX96 or null if no pool is found.
 */
export async function readClankerPoolPrice(
  tokenAddress: `0x${string}`,
  publicClient: PublicClient,
): Promise<bigint | null> {
  const weth = WETH_ADDRESS.toLowerCase();
  const token = tokenAddress.toLowerCase();
  const isWethCurrency0 = weth < token;
  const currency0 = isWethCurrency0 ? WETH_ADDRESS : tokenAddress;
  const currency1 = isWethCurrency0 ? tokenAddress : WETH_ADDRESS;

  for (const hooks of CLANKER_KNOWN_HOOKS) {
    const poolId = computeV4PoolId(
      currency0,
      currency1,
      CLANKER_DYNAMIC_FEE,
      CLANKER_TICK_SPACING,
      hooks as `0x${string}`,
    );

    try {
      const [sqrtPriceX96] = await publicClient.readContract({
        address: UNISWAP_V4_STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });

      if (sqrtPriceX96 > BigInt(0)) {
        console.log(
          `[clankerPool] Found Clanker pool via hook ${hooks.slice(0, 10)}…, sqrtPriceX96=${sqrtPriceX96}`,
        );
        return sqrtPriceX96;
      }
    } catch {
      // This hook config doesn't match — try the next one
    }
  }

  return null;
}
