import { encodeFunctionData, encodeAbiParameters, parseAbiParameters, concat, toHex } from 'viem';
import {
  WETH_ADDRESS,
  UNISWAP_V3_SWAP_ROUTER,
  UNISWAP_V4_UNIVERSAL_ROUTER,
} from '@eigenswarm/shared';

// ── Types ────────────────────────────────────────────────────────────────

export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export interface PoolInfo {
  version: 'v3' | 'v4';
  poolAddress: string;
  fee: number;
  tickSpacing?: number;
  hooks?: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  poolId?: `0x${string}`;
  isWETHPair?: boolean;
}

export interface SwapRoute {
  router: `0x${string}`;
  calldata: `0x${string}`;
}

export interface Permit2Data {
  permitSingle: `0x${string}`; // ABI-encoded PermitSingle struct
  signature: `0x${string}`;   // EIP-712 signature
}

export interface SwapParams {
  direction: 'buy' | 'sell';
  tokenAddress: `0x${string}`;
  amount: bigint; // ETH amount for buys, token amount for sells
  pool: PoolInfo;
  recipient: `0x${string}`;
  slippageBps?: number; // basis points, e.g. 200 = 2%
  minAmountOut?: bigint;
  permit2Data?: Permit2Data; // For V4 sells: inline Permit2 permit signature
  isNativeEthPool?: boolean; // True for hook-free pools using native ETH (address(0)) instead of WETH
}

// ── V3 ABIs ─────────────────────────────────────────────────────────────

const V3_EXACT_INPUT_SINGLE_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const;

// ── V4 Universal Router Commands (from Commands.sol) ──────────────────
// These are top-level commands for UniversalRouter.execute()
const UR_PERMIT2_PERMIT = 0x0a;
const UR_WRAP_ETH = 0x0b;
const UR_UNWRAP_WETH = 0x0c;
const UR_V4_SWAP = 0x10;

// ── V4 Router Actions (from Actions.sol) ──────────────────────────────
// These are inner actions within the V4_SWAP command
const ACTION_SWAP_EXACT_IN = 0x07;
const ACTION_SETTLE = 0x0b;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE = 0x0e;

const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

// ADDRESS_THIS placeholder used in Universal Router for "this contract"
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as `0x${string}`;
// Native ETH in V4 is address(0)
const NATIVE_ETH = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// ── Helpers ─────────────────────────────────────────────────────────────

function buildV4PoolKey(tokenAddress: `0x${string}`, pool: PoolInfo): V4PoolKey {
  return {
    currency0: pool.token0,
    currency1: pool.token1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing || 200,
    hooks: pool.hooks || ('0x0000000000000000000000000000000000000000' as `0x${string}`),
  };
}

/**
 * Encode ExactInputParams for SWAP_EXACT_IN (action 0x07).
 * Uses PathKey[] for routing instead of a flat PoolKey struct.
 *
 * IMPORTANT: The V4 Router decodes this as `abi.decode(params, (ExactInputParams))`,
 * which expects a single struct tuple (not flat parameters). This adds a 32-byte
 * offset prefix to the encoding.
 *
 * ExactInputParams: (Currency currencyIn, PathKey[] path, uint128 amountIn, uint128 amountOutMinimum)
 * PathKey: (Currency intermediateCurrency, uint24 fee, int24 tickSpacing, IHooks hooks, bytes hookData)
 */
function encodeExactInputParams(
  currencyIn: `0x${string}`,
  poolKey: V4PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  // The output currency is the "intermediateCurrency" in the PathKey
  const intermediateCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  // Encode as a struct tuple — the outer parens wrap all fields into a single struct
  // This matches Solidity's abi.decode(params, (ExactInputParams))
  return encodeAbiParameters(
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
      currencyIn,
      path: [{ intermediateCurrency, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks, hookData: '0x' as `0x${string}` }],
      amountIn,
      amountOutMinimum: amountOutMin,
    }],
  );
}

// ── V3 Encoders ─────────────────────────────────────────────────────────

function encodeV3Buy(params: SwapParams): SwapRoute {
  const calldata = encodeFunctionData({
    abi: V3_EXACT_INPUT_SINGLE_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: WETH_ADDRESS,
        tokenOut: params.tokenAddress,
        fee: params.pool.fee,
        recipient: params.recipient,
        amountIn: params.amount,
        amountOutMinimum: params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })(),
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return { router: UNISWAP_V3_SWAP_ROUTER, calldata };
}

function encodeV3Sell(params: SwapParams): SwapRoute {
  const calldata = encodeFunctionData({
    abi: V3_EXACT_INPUT_SINGLE_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.tokenAddress,
        tokenOut: WETH_ADDRESS,
        fee: params.pool.fee,
        recipient: params.recipient,
        amountIn: params.amount,
        amountOutMinimum: params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })(),
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return { router: UNISWAP_V3_SWAP_ROUTER, calldata };
}

// ── V4 Encoders ─────────────────────────────────────────────────────────

/**
 * Encode a V4 buy: ETH → token via WETH-paired V4 pool.
 *
 * Matches the encoding from successful on-chain tx:
 * https://dashboard.tenderly.co/tx/0x0e0e14efddc16ed6359519cd20f41056728ee5e5bb1bfdb195dd832fce98f584
 *
 * Universal Router commands:
 *   1. WRAP_ETH (0x0b): wrap native ETH → WETH in the router
 *   2. V4_SWAP (0x10): execute swap with V4 Actions:
 *      a. SWAP_EXACT_IN (0x07): swap WETH → token via PathKey routing
 *      b. SETTLE (payerIsUser=false, maxAmount=0): settle all WETH debt from router balance
 *      c. TAKE (minAmount=0): withdraw all output tokens to recipient
 */
function encodeV4Buy(params: SwapParams): SwapRoute {
  const poolKey = buildV4PoolKey(params.tokenAddress, params.pool);
  const baseCurrency = params.pool.isWETHPair ? WETH_ADDRESS.toLowerCase() : NATIVE_ETH.toLowerCase();
  const zeroForOne = poolKey.currency0.toLowerCase() === baseCurrency;
  const amountOutMin = params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })();

  // Input is WETH (what we're paying), output is the token (what we're receiving)
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  // ── Command 1: WRAP_ETH ──
  const wrapInput = encodeAbiParameters(
    parseAbiParameters('address recipient, uint256 amountMin'),
    [ADDRESS_THIS, params.amount],
  );

  // ── Command 2: V4_SWAP ──
  // Actions: SWAP_EXACT_IN + SETTLE + TAKE (matching successful on-chain txs)
  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  const actionParams: `0x${string}`[] = [
    // Action 0: SWAP_EXACT_IN — ExactInputParams with PathKey[] routing
    encodeExactInputParams(inputCurrency, poolKey, zeroForOne, params.amount, amountOutMin),
    // Action 1: SETTLE — maxAmount=0 means "settle all outstanding debt"
    // payerIsUser=false: router pays from its own WETH balance (from WRAP_ETH)
    encodeAbiParameters(
      parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
      [inputCurrency, 0n, false],
    ),
    // Action 2: TAKE — minAmount=0 means "take all available output"
    // Slippage is enforced by amountOutMinimum in SWAP_EXACT_IN
    encodeAbiParameters(
      parseAbiParameters('address currency, address recipient, uint256 minAmount'),
      [outputCurrency, params.recipient, 0n],
    ),
  ];

  // Encode V4_SWAP input: abi.encode(bytes actions, bytes[] params)
  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, actionParams],
  );

  // ── Build Universal Router execute() calldata ──
  const commands = concat([
    toHex(UR_WRAP_ETH, { size: 1 }),
    toHex(UR_V4_SWAP, { size: 1 }),
  ]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const calldata = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, [wrapInput, v4SwapInput], deadline],
  });

  return { router: UNISWAP_V4_UNIVERSAL_ROUTER, calldata };
}

/**
 * Encode a V4 sell: token → ETH via WETH-paired V4 pool.
 *
 * Matches the encoding from successful on-chain tx:
 * https://dashboard.tenderly.co/tx/0xa45db19fb064422758069d625309b38217aee0313065c12ab43111f885eb2406
 *
 * Universal Router commands:
 *   1. PERMIT2_PERMIT (0x0a): inline Permit2 allowance via EIP-712 signature
 *   2. V4_SWAP (0x10): execute swap with V4 Actions:
 *      a. SWAP_EXACT_IN (0x07): swap token → WETH via PathKey routing
 *      b. SETTLE (0x0b, payerIsUser=true): pull tokens from caller via Permit2
 *      c. TAKE (0x0e, minAmount=0): withdraw WETH to router (ADDRESS_THIS)
 *   3. UNWRAP_WETH (0x0c): unwrap WETH → native ETH and send to recipient
 */
function encodeV4Sell(params: SwapParams): SwapRoute {
  const poolKey = buildV4PoolKey(params.tokenAddress, params.pool);
  const zeroForOne = poolKey.currency0.toLowerCase() === params.tokenAddress.toLowerCase();
  const amountOutMin = params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })();

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const commandList: number[] = [];
  const inputList: `0x${string}`[] = [];

  // ── Command 1: PERMIT2_PERMIT (if signature provided) ──
  if (params.permit2Data) {
    commandList.push(UR_PERMIT2_PERMIT);
    // Input: abi.encode(IAllowanceTransfer.PermitSingle, bytes signature)
    // The permitSingle is already ABI-encoded, concat with signature
    inputList.push(params.permit2Data.permitSingle);
  }

  // ── Command 2: V4_SWAP ──
  // Actions: SWAP_EXACT_IN + SETTLE + TAKE (matching successful on-chain txs)
  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  const actionParams: `0x${string}`[] = [
    // Action 0: SWAP_EXACT_IN — ExactInputParams with PathKey[] routing
    // amountOutMinimum=0 here — slippage enforced by UNWRAP_WETH amountMin instead
    encodeExactInputParams(inputCurrency, poolKey, zeroForOne, params.amount, 0n),
    // Action 1: SETTLE — payerIsUser=true, maxAmount=0 (settle all outstanding debt)
    // Pulls tokens from msg.sender via Permit2 allowance
    encodeAbiParameters(
      parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
      [inputCurrency, 0n, true],
    ),
    // Action 2: TAKE — send WETH to router for unwrapping, minAmount=0
    encodeAbiParameters(
      parseAbiParameters('address currency, address recipient, uint256 minAmount'),
      [outputCurrency, ADDRESS_THIS, 0n],
    ),
  ];

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, actionParams],
  );

  commandList.push(UR_V4_SWAP);
  inputList.push(v4SwapInput);

  // ── Command 3: UNWRAP_WETH ──
  const unwrapInput = encodeAbiParameters(
    parseAbiParameters('address recipient, uint256 amountMin'),
    [params.recipient, amountOutMin],
  );

  commandList.push(UR_UNWRAP_WETH);
  inputList.push(unwrapInput);

  // ── Build Universal Router execute() calldata ──
  const commands = concat(commandList.map(c => toHex(c, { size: 1 })));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const calldata = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, inputList, deadline],
  });

  return { router: UNISWAP_V4_UNIVERSAL_ROUTER, calldata };
}

// ── V4 Native ETH Encoders ───────────────────────────────────────────────
// For hook-free pools using native ETH (currency0 = address(0)) instead of WETH.
// These skip WRAP_ETH/UNWRAP_WETH and use native ETH settlement directly.

/**
 * Encode a V4 buy: native ETH → token via native ETH pool.
 * No WRAP_ETH needed — send ETH as msg.value, settle natively.
 *
 * Universal Router commands:
 *   1. V4_SWAP (0x10): execute swap with V4 Actions:
 *      a. SWAP_EXACT_IN (0x07): swap native ETH → token
 *      b. SETTLE (payerIsUser=true, maxAmount=ETH amount): settle ETH from msg.value
 *      c. TAKE (minAmount=0): withdraw tokens to recipient
 */
function encodeV4NativeEthBuy(params: SwapParams): SwapRoute {
  const poolKey = buildV4PoolKey(params.tokenAddress, params.pool);
  const zeroForOne = poolKey.currency0.toLowerCase() === NATIVE_ETH.toLowerCase();
  const amountOutMin = params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })();

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  // ── Command 1: V4_SWAP ──
  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  const actionParams: `0x${string}`[] = [
    encodeExactInputParams(inputCurrency, poolKey, zeroForOne, params.amount, amountOutMin),
    // SETTLE: payerIsUser=true, settle ETH from msg.value
    encodeAbiParameters(
      parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
      [inputCurrency, params.amount, true],
    ),
    // TAKE: withdraw tokens to recipient
    encodeAbiParameters(
      parseAbiParameters('address currency, address recipient, uint256 minAmount'),
      [outputCurrency, params.recipient, 0n],
    ),
  ];

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, actionParams],
  );

  const commands = concat([toHex(UR_V4_SWAP, { size: 1 })]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const calldata = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, [v4SwapInput], deadline],
  });

  return { router: UNISWAP_V4_UNIVERSAL_ROUTER, calldata };
}

/**
 * Encode a V4 sell: token → native ETH via native ETH pool.
 * No UNWRAP_WETH needed — receive native ETH directly.
 *
 * Universal Router commands:
 *   1. PERMIT2_PERMIT (0x0a): inline Permit2 allowance (if provided)
 *   2. V4_SWAP (0x10): execute swap with V4 Actions:
 *      a. SWAP_EXACT_IN (0x07): swap token → native ETH
 *      b. SETTLE (payerIsUser=true): pull tokens from caller via Permit2
 *      c. TAKE (minAmount=0): withdraw native ETH to recipient
 */
function encodeV4NativeEthSell(params: SwapParams): SwapRoute {
  const poolKey = buildV4PoolKey(params.tokenAddress, params.pool);
  const zeroForOne = poolKey.currency0.toLowerCase() === params.tokenAddress.toLowerCase();
  const amountOutMin = params.minAmountOut ?? (() => { throw new Error('minAmountOut is required'); })();

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const commandList: number[] = [];
  const inputList: `0x${string}`[] = [];

  // ── Command 1: PERMIT2_PERMIT (if signature provided) ──
  if (params.permit2Data) {
    commandList.push(UR_PERMIT2_PERMIT);
    inputList.push(params.permit2Data.permitSingle);
  }

  // ── Command 2: V4_SWAP ──
  const actions = concat([
    toHex(ACTION_SWAP_EXACT_IN, { size: 1 }),
    toHex(ACTION_SETTLE, { size: 1 }),
    toHex(ACTION_TAKE, { size: 1 }),
  ]);

  const actionParams: `0x${string}`[] = [
    encodeExactInputParams(inputCurrency, poolKey, zeroForOne, params.amount, 0n),
    // SETTLE: pull tokens from caller via Permit2
    encodeAbiParameters(
      parseAbiParameters('address currency, uint256 maxAmount, bool payerIsUser'),
      [inputCurrency, 0n, true],
    ),
    // TAKE: withdraw native ETH directly to recipient (no UNWRAP_WETH needed)
    encodeAbiParameters(
      parseAbiParameters('address currency, address recipient, uint256 minAmount'),
      [outputCurrency, params.recipient, amountOutMin],
    ),
  ];

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actions, actionParams],
  );

  commandList.push(UR_V4_SWAP);
  inputList.push(v4SwapInput);

  const commands = concat(commandList.map(c => toHex(c, { size: 1 })));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const calldata = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, inputList, deadline],
  });

  return { router: UNISWAP_V4_UNIVERSAL_ROUTER, calldata };
}

// ── Unified Entry Point ─────────────────────────────────────────────────

export function encodeSwap(params: SwapParams): SwapRoute {
  const { direction, pool } = params;

  if (pool.version === 'v3') {
    return direction === 'buy' ? encodeV3Buy(params) : encodeV3Sell(params);
  }

  // Use native ETH encoders for hook-free pools with address(0) as base currency
  const isNativeEth = params.isNativeEthPool ||
    pool.token0?.toLowerCase() === NATIVE_ETH.toLowerCase();

  if (isNativeEth) {
    return direction === 'buy'
      ? encodeV4NativeEthBuy(params)
      : encodeV4NativeEthSell(params);
  }

  return direction === 'buy' ? encodeV4Buy(params) : encodeV4Sell(params);
}

export { buildV4PoolKey, NATIVE_ETH };
