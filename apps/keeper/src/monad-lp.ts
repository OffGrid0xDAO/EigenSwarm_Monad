/**
 * Monad V4 LP Management
 *
 * Creates and manages Uniswap V4 liquidity pools on Monad.
 * Interacts directly with V4 PositionManager (no EigenLP contract needed).
 */

import { type Address, type Hex, encodeAbiParameters, encodePacked, formatEther, parseEther, keccak256 } from 'viem';
import { getPublicClient, getMasterPrivateKey, getWalletClientForKey } from './client';
import { getEigenConfig } from './db';
import { getChainConfig } from '@eigenswarm/shared';

const MONAD_CHAIN_ID = 143;
const monadConfig = getChainConfig(MONAD_CHAIN_ID);

const POOL_MANAGER = monadConfig.uniswapV4PoolManager! as Address;
const POSITION_MANAGER = monadConfig.uniswapV4PositionManager! as Address;
const STATE_VIEW = monadConfig.uniswapV4StateView! as Address;
const PERMIT2 = monadConfig.permit2! as Address;

// Match EigenLP constants
const POOL_FEE = 9900; // 0.99%
const TICK_SPACING = 198;
const TICK_LOWER = -887238; // Full range (largest multiple of 198 ≤ -887272)
const TICK_UPPER = 887238;

// V4 Action codes (from Uniswap v4-periphery Actions.sol)
const Actions = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  INCREASE_LIQUIDITY_FROM_DELTAS: 0x04,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  SWEEP: 0x14,
  WRAP: 0x15,
  UNWRAP: 0x16,
} as const;

// ── Minimal ABIs ─────────────────────────────────────────────────────────

const POOL_MANAGER_ABI = [
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [{ name: 'tick', type: 'int24' }],
    stateMutability: 'nonpayable',
  },
] as const;

const POSITION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'modifyLiquidities',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'nextTokenId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPositionLiquidity',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
    stateMutability: 'view',
  },
] as const;

const STATE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getSlot0',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
    ],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLiquidity',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
    ],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
    stateMutability: 'view',
  },
] as const;

const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

const PERMIT2_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

// Transfer(address,address,uint256) event signature
const TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ── Pool Key Helper ──────────────────────────────────────────────────────

const POOL_KEY_TUPLE_TYPE = {
  type: 'tuple' as const,
  components: [
    { name: 'currency0', type: 'address' as const },
    { name: 'currency1', type: 'address' as const },
    { name: 'fee', type: 'uint24' as const },
    { name: 'tickSpacing', type: 'int24' as const },
    { name: 'hooks', type: 'address' as const },
  ],
};

function buildPoolKey(tokenAddress: Address): {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
} {
  // currency0 must be < currency1 numerically
  // Native MON = address(0), which is always < any token address
  return {
    currency0: '0x0000000000000000000000000000000000000000' as Address,
    currency1: tokenAddress,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: '0x0000000000000000000000000000000000000000' as Address,
  };
}

function computePoolId(poolKey: ReturnType<typeof buildPoolKey>): Hex {
  const encoded = encodeAbiParameters(
    [POOL_KEY_TUPLE_TYPE],
    [poolKey],
  );
  return keccak256(encoded);
}

// ── Liquidity Math ──────────────────────────────────────────────────────

/**
 * Calculate liquidity amount from desired token amounts and price.
 * Uses the Uniswap V3/V4 formula for full-range positions.
 */
function calculateLiquidity(
  sqrtPriceX96: bigint,
  amount0: bigint,
  amount1: bigint,
  tickLower: number,
  tickUpper: number,
): bigint {
  // For full-range positions, use the simpler formula:
  // L = min(amount0 * sqrtPrice / (sqrtUpper - sqrtPrice), amount1 / (sqrtPrice - sqrtLower))
  // But we need sqrtPriceX96 at the tick boundaries too.
  //
  // sqrtRatioAtTick = 1.0001^(tick/2) * 2^96
  // For full range: sqrtLower ≈ MIN_SQRT_PRICE, sqrtUpper ≈ MAX_SQRT_PRICE
  const Q96 = 2n ** 96n;

  // Approximate sqrtPrice at tick boundaries for full range
  // MIN_SQRT_RATIO = 4295128739 (from TickMath.sol)
  // MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 (from TickMath.sol)
  const sqrtLower = 4295128739n;
  const sqrtUpper = 1461446703485210103287273052203988822378723970342n;

  // L from amount0: L = amount0 * sqrtPrice * sqrtUpper / ((sqrtUpper - sqrtPrice) * Q96)
  // L from amount1: L = amount1 * Q96 / (sqrtPrice - sqrtLower)
  let L0 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'); // max uint128
  let L1 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

  if (sqrtUpper > sqrtPriceX96) {
    // L0 = amount0 * sqrtPrice * sqrtUpper / ((sqrtUpper - sqrtPrice) * Q96)
    const numerator0 = amount0 * sqrtPriceX96;
    const denominator0 = ((sqrtUpper - sqrtPriceX96) * Q96) / sqrtUpper;
    if (denominator0 > 0n) {
      L0 = (numerator0 * Q96) / (denominator0 * Q96 / sqrtUpper);
      // Simplified: L0 = amount0 * sqrtPriceX96 * sqrtUpper / ((sqrtUpper - sqrtPriceX96) * 2^96)
      L0 = (amount0 * (sqrtPriceX96 * sqrtUpper / Q96)) / (sqrtUpper - sqrtPriceX96);
    }
  }

  if (sqrtPriceX96 > sqrtLower) {
    // L1 = amount1 * Q96 / (sqrtPrice - sqrtLower)
    L1 = (amount1 * Q96) / (sqrtPriceX96 - sqrtLower);
  }

  // Use the minimum to avoid exceeding either amount
  return L0 < L1 ? L0 : L1;
}

// ── Encode Actions ──────────────────────────────────────────────────────

function encodeMintPositionAction(
  poolKey: ReturnType<typeof buildPoolKey>,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  owner: Address,
): { actions: Hex; params: Hex[] } {
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8', 'uint8'],
    [Actions.MINT_POSITION, Actions.SETTLE_PAIR, Actions.CLOSE_CURRENCY, Actions.CLOSE_CURRENCY],
  );

  const mintParams = encodeAbiParameters(
    [
      POOL_KEY_TUPLE_TYPE,
      { type: 'int24' },
      { type: 'int24' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'address' },
      { type: 'bytes' },
    ],
    [poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, '0x'],
  );

  const settlePairParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [poolKey.currency0, poolKey.currency1],
  );

  const closeCurrency0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [poolKey.currency0],
  );

  const closeCurrency1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [poolKey.currency1],
  );

  return {
    actions,
    params: [mintParams, settlePairParams, closeCurrency0Params, closeCurrency1Params],
  };
}

function encodeCollectFeesAction(
  tokenId: bigint,
  currency0: Address,
  currency1: Address,
  recipient: Address,
): { actions: Hex; params: Hex[] } {
  // DECREASE_LIQUIDITY(0) to collect fees + TAKE_PAIR + CLOSE_CURRENCY x2
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8', 'uint8'],
    [Actions.DECREASE_LIQUIDITY, Actions.TAKE_PAIR, Actions.CLOSE_CURRENCY, Actions.CLOSE_CURRENCY],
  );

  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, 0n, '0x'], // 0 liquidity = collect fees only
  );

  const takePairParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [currency0, currency1, recipient],
  );

  const closeCurrency0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency0],
  );

  const closeCurrency1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency1],
  );

  return { actions, params: [decreaseParams, takePairParams, closeCurrency0Params, closeCurrency1Params] };
}

function encodeCompoundFeesAction(
  tokenId: bigint,
): { actions: Hex; params: Hex[] } {
  // DECREASE_LIQUIDITY(0) to collect + INCREASE_LIQUIDITY_FROM_DELTAS to reinvest + CLOSE_CURRENCY x2
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8', 'uint8'],
    [
      Actions.DECREASE_LIQUIDITY,
      Actions.INCREASE_LIQUIDITY_FROM_DELTAS,
      Actions.CLOSE_CURRENCY,
      Actions.CLOSE_CURRENCY,
    ],
  );

  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, 0n, '0x'],
  );

  const increaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, '0x'],
  );

  // Need currency addresses for CLOSE_CURRENCY — but we don't have them here.
  // The caller must pass them or we get them from the config.
  // For now, we'll return a version that takes currency addresses.
  // This function will be updated to accept them.
  return { actions, params: [decreaseParams, increaseParams] };
}

function encodeCompoundFeesActionWithCurrencies(
  tokenId: bigint,
  currency0: Address,
  currency1: Address,
): { actions: Hex; params: Hex[] } {
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8', 'uint8'],
    [
      Actions.DECREASE_LIQUIDITY,
      Actions.INCREASE_LIQUIDITY_FROM_DELTAS,
      Actions.CLOSE_CURRENCY,
      Actions.CLOSE_CURRENCY,
    ],
  );

  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, 0n, '0x'],
  );

  const increaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, '0x'],
  );

  const closeCurrency0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency0],
  );

  const closeCurrency1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency1],
  );

  return { actions, params: [decreaseParams, increaseParams, closeCurrency0Params, closeCurrency1Params] };
}

function encodeRemoveLiquidityAction(
  tokenId: bigint,
  liquidity: bigint,
  currency0: Address,
  currency1: Address,
  recipient: Address,
): { actions: Hex; params: Hex[] } {
  // Must DECREASE_LIQUIDITY to zero first, then BURN_POSITION, then TAKE_PAIR + CLOSE x2
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
    [
      Actions.DECREASE_LIQUIDITY,
      Actions.BURN_POSITION,
      Actions.TAKE_PAIR,
      Actions.CLOSE_CURRENCY,
      Actions.CLOSE_CURRENCY,
    ],
  );

  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, liquidity, 0n, 0n, '0x'],
  );

  const burnParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [tokenId, 0n, 0n, '0x'],
  );

  const takePairParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [currency0, currency1, recipient],
  );

  const closeCurrency0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency0],
  );

  const closeCurrency1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [currency1],
  );

  return { actions, params: [decreaseParams, burnParams, takePairParams, closeCurrency0Params, closeCurrency1Params] };
}

function encodeUnlockData(actions: Hex, params: Hex[]): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actions, params],
  );
}

// ── Parse Token ID from Mint Receipt ─────────────────────────────────────

function parseTokenIdFromReceipt(receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] }): bigint | null {
  // Look for Transfer(address(0), recipient, tokenId) event from PositionManager (ERC721 mint)
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POSITION_MANAGER.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_EVENT_SIG) continue;
    // topics[1] = from (should be address(0) for mint)
    const from = '0x' + (log.topics[1] as string).slice(26);
    if (from !== '0x0000000000000000000000000000000000000000') continue;
    // topics[2] = to, data or topics[3] = tokenId
    // ERC721 Transfer has tokenId as topics[3]
    if (log.topics.length >= 4) {
      return BigInt(log.topics[3] as string);
    }
  }
  return null;
}

// ── Create V4 Pool & Seed LP ─────────────────────────────────────────────

export async function createMonadV4Pool(params: {
  eigenId: string;
  tokenAddress: Address;
  sqrtPriceX96: bigint;
  tokenAmount: bigint;
  monAmount: bigint;
  tickLower?: number;
  tickUpper?: number;
}): Promise<{ poolId: Hex; tokenId: bigint; txHash: Hex }> {
  const {
    eigenId,
    tokenAddress,
    sqrtPriceX96,
    tokenAmount,
    monAmount,
    tickLower = TICK_LOWER,
    tickUpper = TICK_UPPER,
  } = params;

  const client = getPublicClient(MONAD_CHAIN_ID);
  const masterKey = getMasterPrivateKey();
  const walletClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const account = walletClient.account;
  if (!account) throw new Error('No wallet account');

  const poolKey = buildPoolKey(tokenAddress);

  // 1. Initialize the pool on PoolManager
  console.log(`[MonadLP] Initializing V4 pool for ${tokenAddress} (sqrtPriceX96=${sqrtPriceX96})`);
  try {
    const initHash = await walletClient.writeContract({
      address: POOL_MANAGER,
      abi: POOL_MANAGER_ABI,
      functionName: 'initialize',
      args: [poolKey, sqrtPriceX96],
      chain: walletClient.chain,
      account,
    });
    await client.waitForTransactionReceipt({ hash: initHash });
    console.log(`[MonadLP] Pool initialized: ${initHash}`);
  } catch (error) {
    const msg = (error as Error).message;
    // Pool may already exist — that's OK
    if (!msg.includes('PoolAlreadyInitialized') && !msg.includes('already initialized')) {
      throw error;
    }
    console.log(`[MonadLP] Pool already initialized, continuing with mint`);
  }

  // 2. Approve token to Permit2, then Permit2 to PositionManager
  const currentAllowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, PERMIT2],
  }).catch(() => 0n);

  if (currentAllowance < tokenAmount) {
    console.log(`[MonadLP] Approving token to Permit2...`);
    const approveTx = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PERMIT2, tokenAmount * 2n],
      chain: walletClient.chain,
      account,
    });
    await client.waitForTransactionReceipt({ hash: approveTx });
  }

  // Permit2 → PositionManager approval
  console.log(`[MonadLP] Setting Permit2 approval for PositionManager...`);
  const permit2ApproveTx = await walletClient.writeContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'approve',
    args: [
      tokenAddress,
      POSITION_MANAGER,
      BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), // max uint160
      Math.floor(Date.now() / 1000) + 86400, // 24h expiration
    ],
    chain: walletClient.chain,
    account,
  });
  await client.waitForTransactionReceipt({ hash: permit2ApproveTx });

  // 3. Calculate liquidity from amounts and current price
  const liquidity = calculateLiquidity(sqrtPriceX96, monAmount, tokenAmount, tickLower, tickUpper);
  if (liquidity <= 0n) {
    throw new Error('Calculated liquidity is zero — check amounts and price');
  }
  console.log(`[MonadLP] Calculated liquidity: ${liquidity}`);

  // 4. Encode mint action with calculated liquidity
  const { actions, params: actionParams } = encodeMintPositionAction(
    poolKey,
    tickLower,
    tickUpper,
    liquidity,
    BigInt(monAmount), // amount0Max (MON)
    BigInt(tokenAmount), // amount1Max (token)
    account.address,
  );

  const unlockData = encodeUnlockData(actions, actionParams);

  // 5. Call modifyLiquidities with MON value
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min deadline

  console.log(`[MonadLP] Minting LP position: ${formatEther(monAmount)} MON + tokens`);
  const mintHash = await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    value: monAmount,
    chain: walletClient.chain,
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash: mintHash });

  // 6. Parse actual token ID from Transfer event (avoids race condition)
  const mintedTokenId = parseTokenIdFromReceipt(receipt);
  if (!mintedTokenId) {
    // Fallback: try nextTokenId - 1 (risky but better than nothing)
    const currentNextId = await client.readContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'nextTokenId',
    });
    console.warn(`[MonadLP] Could not parse tokenId from receipt, using nextTokenId-1: ${currentNextId - 1n}`);
  }
  const tokenId = mintedTokenId || (await client.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'nextTokenId',
  })) - 1n;

  console.log(`[MonadLP] LP position minted: ${mintHash} (tokenId=${tokenId})`);

  // 7. Compute poolId from poolKey (keccak256 of encoded PoolKey)
  const poolId = computePoolId(poolKey);

  // 8. Update eigen config with LP data
  const db = await import('./db');
  const config = db.getEigenConfig(eigenId);
  if (config) {
    db.getDb().prepare(`
      UPDATE eigen_configs SET
        lp_pool_id = @poolId,
        lp_token_id = @tokenId,
        lp_pool_fee = @poolFee,
        lp_pool_tick_spacing = @tickSpacing,
        lp_contract_address = @positionManager
      WHERE eigen_id = @eigenId
    `).run({
      eigenId,
      poolId,
      tokenId: tokenId.toString(), // Store as string to avoid precision loss
      poolFee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      positionManager: POSITION_MANAGER,
    });
  }

  return {
    poolId: poolId as Hex,
    tokenId,
    txHash: mintHash,
  };
}

// ── Compound LP Fees ─────────────────────────────────────────────────────

export async function compoundMonadLpFees(eigenId: string): Promise<Hex | null> {
  const config = getEigenConfig(eigenId);
  if (!config?.lp_token_id || config.chain_id !== MONAD_CHAIN_ID) return null;

  const client = getPublicClient(MONAD_CHAIN_ID);
  const masterKey = getMasterPrivateKey();
  const walletClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const account = walletClient.account;
  if (!account) return null;

  const tokenId = BigInt(config.lp_token_id);
  const tokenAddress = config.token_address as Address;
  const poolKey = buildPoolKey(tokenAddress);

  // Check if there's any liquidity
  const liquidity = await client.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  }).catch(() => 0n);

  if (liquidity === 0n) return null;

  const { actions, params: actionParams } = encodeCompoundFeesActionWithCurrencies(
    tokenId,
    poolKey.currency0,
    poolKey.currency1,
  );
  const unlockData = encodeUnlockData(actions, actionParams);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  try {
    const hash = await walletClient.writeContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [unlockData, deadline],
      chain: walletClient.chain,
      account,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status === 'success') {
      console.log(`[MonadLP] Compounded fees for ${eigenId}: ${hash}`);
      return hash;
    }
    return null;
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('revert') || msg.includes('insufficient')) {
      // No fees to compound — expected
      return null;
    }
    throw error;
  }
}

// ── Collect LP Fees ──────────────────────────────────────────────────────

export async function collectMonadLpFees(eigenId: string): Promise<Hex | null> {
  const config = getEigenConfig(eigenId);
  if (!config?.lp_token_id || config.chain_id !== MONAD_CHAIN_ID) return null;

  const client = getPublicClient(MONAD_CHAIN_ID);
  const masterKey = getMasterPrivateKey();
  const walletClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const account = walletClient.account;
  if (!account) return null;

  const tokenId = BigInt(config.lp_token_id);
  const tokenAddress = config.token_address as Address;
  const poolKey = buildPoolKey(tokenAddress);

  const { actions, params: actionParams } = encodeCollectFeesAction(
    tokenId,
    poolKey.currency0,
    poolKey.currency1,
    account.address, // fees go to keeper, who manages for the eigen owner
  );

  const unlockData = encodeUnlockData(actions, actionParams);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  try {
    const hash = await walletClient.writeContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [unlockData, deadline],
      chain: walletClient.chain,
      account,
    });

    await client.waitForTransactionReceipt({ hash });
    console.log(`[MonadLP] Collected fees for ${eigenId}: ${hash}`);
    return hash;
  } catch (error) {
    console.error(`[MonadLP] Failed to collect fees for ${eigenId}:`, (error as Error).message);
    return null;
  }
}

// ── Remove Liquidity ─────────────────────────────────────────────────────

export async function removeMonadLiquidity(eigenId: string): Promise<Hex | null> {
  const config = getEigenConfig(eigenId);
  if (!config?.lp_token_id || config.chain_id !== MONAD_CHAIN_ID) return null;

  const client = getPublicClient(MONAD_CHAIN_ID);
  const masterKey = getMasterPrivateKey();
  const walletClient = getWalletClientForKey(masterKey, MONAD_CHAIN_ID);
  const account = walletClient.account;
  if (!account) return null;

  const tokenId = BigInt(config.lp_token_id);
  const tokenAddress = config.token_address as Address;
  const poolKey = buildPoolKey(tokenAddress);

  // Get current liquidity so we can decrease to zero before burning
  const liquidity = await client.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  }).catch(() => 0n);

  const { actions, params: actionParams } = encodeRemoveLiquidityAction(
    tokenId,
    liquidity,
    poolKey.currency0,
    poolKey.currency1,
    account.address,
  );

  const unlockData = encodeUnlockData(actions, actionParams);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const hash = await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    chain: walletClient.chain,
    account,
  });

  await client.waitForTransactionReceipt({ hash });
  console.log(`[MonadLP] Removed liquidity for ${eigenId}: ${hash}`);

  // Clear LP fields in DB
  const db = await import('./db');
  db.getDb().prepare(`
    UPDATE eigen_configs SET
      lp_pool_id = NULL,
      lp_token_id = NULL,
      lp_pool_fee = NULL,
      lp_pool_tick_spacing = NULL,
      lp_contract_address = NULL
    WHERE eigen_id = ?
  `).run(eigenId);

  return hash;
}

// ── Price to sqrtPriceX96 Helper ─────────────────────────────────────────

export function priceToSqrtPriceX96(priceToken1PerToken0: number): bigint {
  // sqrtPriceX96 = sqrt(price) * 2^96
  // Use BigInt math to avoid floating-point precision loss with 2^96
  const sqrtPrice = Math.sqrt(priceToken1PerToken0);

  // Split into integer and fractional parts for higher precision
  // Multiply sqrtPrice by 2^48, then shift left by 48 more bits
  const HALF_Q96 = 2n ** 48n;
  const scaledSqrt = BigInt(Math.round(sqrtPrice * Number(HALF_Q96)));
  return scaledSqrt * HALF_Q96;
}
