/**
 * Base V4 LP Management — EigenLP / EigenBundler
 *
 * Seeds Uniswap V4 pools on Base for Clanker-deployed tokens.
 * Primary path: EigenBundler.launch() (atomic LP seed + vault deposit)
 * Fallback path: direct V4 PositionManager (same pattern as monad-lp.ts)
 *
 * Also includes:
 *   - readClankerPoolPrice() — read sqrtPriceX96 from the Clanker pool
 *   - collectBaseLpFees() / compoundBaseLpFees() — via EigenLP contract
 *
 * DISABLED: Base LP is disabled for Monad-first migration.
 */

const BASE_LP_ENABLED = false; // Disabled for Monad-first

import {
  type Address,
  type Hex,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  erc20Abi,
  formatEther,
} from 'viem';
import { getPublicClient, getWalletClient, getKeeperAddress } from './client';
import {
  EIGENLP_ADDRESS,
  EIGENLP_ABI,
  EIGENLP_FEE,
  EIGENLP_TICK_SPACING,
  EIGENBUNDLER_ADDRESS,
  EIGENBUNDLER_ABI,
  EIGENLAUNCHER_ADDRESS,
  EIGENLAUNCHER_ABI,
  EIGENFACTORY_ADDRESS,
  EIGENFACTORY_ABI,
  WETH_ADDRESS,
  UNISWAP_V4_STATE_VIEW,
  CLANKER_DYNAMIC_FEE,
  CLANKER_TICK_SPACING,
  CLANKER_KNOWN_HOOKS,
  eigenIdToBytes32,
} from '@eigenswarm/shared';

const BASE_CHAIN_ID = 143;

// EigenLP / EigenBundler addresses (env override or shared defaults)
const LP_ADDRESS = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as Address;
const BUNDLER_ADDRESS = (process.env.EIGENBUNDLER_ADDRESS || EIGENBUNDLER_ADDRESS) as Address;

const LAUNCHER_ADDRESS = (process.env.EIGENLAUNCHER_ADDRESS || EIGENLAUNCHER_ADDRESS) as Address;
const FACTORY_ADDRESS = (process.env.EIGENFACTORY_ADDRESS || EIGENFACTORY_ADDRESS) as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// StateView ABI (subset for slot0)
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

// ── readClankerPoolPrice ──────────────────────────────────────────────────

/**
 * Compute a Uniswap V4 pool ID from pool key components.
 * Matches on-chain PoolId.toId(): keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
 */
function computeV4PoolId(
  currency0: Address,
  currency1: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address,
): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [currency0, currency1, fee, tickSpacing, hooks],
  );
  return keccak256(encoded);
}

/**
 * Read sqrtPriceX96 from the Clanker V4 pool for a token,
 * converted to EigenLP's currency ordering (ETH/Token).
 *
 * Clanker pools use (Token, WETH) or (WETH, Token) depending on address sort.
 * EigenLP always uses currency0=ETH(address(0)), currency1=Token.
 *
 * When Token < WETH (most tokens), Clanker's sqrtPriceX96 = sqrt(WETH/Token)
 * but EigenLP needs sqrt(Token/ETH). These are inverses, so we convert:
 *   eigenLP_sqrtPriceX96 = 2^192 / clanker_sqrtPriceX96
 */
export async function readClankerPoolPrice(
  tokenAddress: Address,
): Promise<bigint | null> {
  if (!BASE_LP_ENABLED) { console.warn('[BaseLP] Disabled for Monad-first'); return null; }
  // Test mode: return a realistic mock sqrtPriceX96 (~0.00005 ETH per token)
  if (process.env.X402_TEST_MODE === 'true') {
    const mockPrice = 5602277097478614n; // ~0.00005 ETH/token
    console.log(`[BaseLP] TEST MODE — mock sqrtPriceX96=${mockPrice}`);
    return mockPrice;
  }

  const client = getPublicClient(BASE_CHAIN_ID);
  const weth = WETH_ADDRESS.toLowerCase();
  const token = tokenAddress.toLowerCase();
  const isWethCurrency0 = weth < token;
  const currency0 = isWethCurrency0 ? WETH_ADDRESS : tokenAddress;
  const currency1 = isWethCurrency0 ? tokenAddress : WETH_ADDRESS;

  for (const hooks of CLANKER_KNOWN_HOOKS) {
    const poolId = computeV4PoolId(
      currency0 as Address,
      currency1 as Address,
      CLANKER_DYNAMIC_FEE,
      CLANKER_TICK_SPACING,
      hooks as Address,
    );

    try {
      const [sqrtPriceX96] = await client.readContract({
        address: UNISWAP_V4_STATE_VIEW as Address,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });

      if (sqrtPriceX96 > 0n) {
        console.log(
          `[BaseLP] Found Clanker pool via hook ${(hooks as string).slice(0, 10)}…, sqrtPriceX96=${sqrtPriceX96}`,
        );

        // Convert to EigenLP ordering: currency0=ETH(0x0), currency1=Token
        // If WETH is currency0 in Clanker, sqrtPriceX96 = sqrt(Token/WETH) → matches EigenLP
        // If Token is currency0 in Clanker, sqrtPriceX96 = sqrt(WETH/Token) → need inversion
        if (!isWethCurrency0) {
          const TWO_192 = 1n << 192n;
          const inverted = TWO_192 / sqrtPriceX96;
          console.log(
            `[BaseLP] Inverted sqrtPriceX96 for EigenLP (Token<WETH): ${sqrtPriceX96} → ${inverted}`,
          );
          return inverted;
        }

        return sqrtPriceX96;
      }
    } catch {
      // This hook doesn't match — try next
    }
  }

  return null;
}

// ── Bundled Launch (Primary Path) ──────────────────────────────────────────

export interface SeedBaseLPBundledParams {
  eigenId: string;
  tokenAddress: Address;
  sqrtPriceX96: bigint;
  tokenAmount: bigint;
  lpEthAmount: bigint;
  vaultDepositEth: bigint;
  tradingFeeBps: bigint;
}

export interface SeedBaseLPResult {
  poolId: Hex;
  tokenId: number;
  txHash: Hex;
}

/**
 * Atomic LP seed + vault deposit via EigenBundler.launch().
 * Matches frontend flow in launch/page.tsx:304-317.
 *
 * Steps:
 * 1. Approve tokens to bundler
 * 2. Call EigenBundler.launch() with ETH value = lpEth + vaultEth
 * 3. Read back position via EigenLP.getPosition()
 */
export async function seedBaseLPBundled(
  params: SeedBaseLPBundledParams,
): Promise<SeedBaseLPResult> {
  if (!BASE_LP_ENABLED) throw new Error('Base LP is disabled. Use Monad nad.fun flow instead.');
  const {
    eigenId,
    tokenAddress,
    sqrtPriceX96,
    tokenAmount,
    lpEthAmount,
    vaultDepositEth,
    tradingFeeBps,
  } = params;

  // Test mode: return mock pool/position data
  if (process.env.X402_TEST_MODE === 'true') {
    const mockPoolId = keccak256(encodeAbiParameters(
      parseAbiParameters('string, address'),
      [`test-pool-${eigenId}`, tokenAddress],
    )) as Hex;
    const mockTx = keccak256(encodeAbiParameters(
      parseAbiParameters('string'),
      [`test-lp-tx-${eigenId}`],
    )) as Hex;
    console.log(`[BaseLP] TEST MODE — mock LP seeded: poolId=${mockPoolId}, tokenId=1`);
    return { poolId: mockPoolId, tokenId: 1, txHash: mockTx };
  }

  if (BUNDLER_ADDRESS === ZERO_ADDRESS) {
    throw new Error('EigenBundler not deployed — set EIGENBUNDLER_ADDRESS env var');
  }

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const keeperAddress = getKeeperAddress();

  // 1. Check token balance
  const tokenBalance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [keeperAddress],
  });

  if (tokenBalance < tokenAmount) {
    throw new Error(
      `Insufficient token balance: have ${tokenBalance}, need ${tokenAmount}`,
    );
  }

  // 2. Approve tokens to bundler
  console.log(`[BaseLP] Approving ${tokenAmount} tokens to bundler...`);
  const approveTx = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [BUNDLER_ADDRESS, tokenAmount],
  });
  await client.waitForTransactionReceipt({ hash: approveTx });

  // 3. Call EigenBundler.launch()
  const bytes32Id = eigenIdToBytes32(eigenId);
  const totalValue = lpEthAmount + vaultDepositEth;

  console.log(
    `[BaseLP] Bundler launch: eigenId=${eigenId}, token=${tokenAddress}, ` +
    `lpEth=${formatEther(lpEthAmount)}, vaultEth=${formatEther(vaultDepositEth)}, ` +
    `tokenAmount=${tokenAmount}, feeBps=${tradingFeeBps}`,
  );

  const launchTx = await walletClient.writeContract({
    address: BUNDLER_ADDRESS,
    abi: EIGENBUNDLER_ABI,
    functionName: 'launch',
    args: [
      bytes32Id,
      tokenAddress,
      sqrtPriceX96,
      tokenAmount,
      tradingFeeBps,
      vaultDepositEth,
    ],
    value: totalValue,
  });

  console.log(`[BaseLP] Bundler launch tx: ${launchTx}`);
  await client.waitForTransactionReceipt({ hash: launchTx });

  // 4. Read back position from EigenLP
  const positionData = await client.readContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'getPosition',
    args: [bytes32Id],
  });

  const tokenId = Number((positionData as any)[0]);
  const poolId = (positionData as any)[1] as Hex;

  console.log(
    `[BaseLP] Bundled launch complete: poolId=${poolId}, tokenId=${tokenId}`,
  );

  return {
    poolId,
    tokenId,
    txHash: launchTx,
  };
}

// ── Atomic Launch with 8004 Agent (via EigenLauncher) ───────────────────────

export interface SeedBaseLPWithAgentParams {
  eigenId: string;
  tokenAddress: Address;
  sqrtPriceX96: bigint;
  tokenAmount: bigint;
  lpEthAmount: bigint;
  vaultDepositEth: bigint;
  tradingFeeBps: bigint;
  agentURI: string;
  onBehalfOf: Address;
}

export interface SeedBaseLPWithAgentResult {
  poolId: Hex;
  tokenId: number;
  agentId: string;
  txHash: Hex;
}

/**
 * Atomic LP seed + vault deposit + 8004 agent mint via EigenLauncher.launch().
 *
 * Steps:
 * 1. Approve tokens to EigenLauncher
 * 2. Call EigenLauncher.launch() with total ETH value
 * 3. Parse Registered event from receipt to get agentId
 * 4. Read back LP position from EigenLP.getPosition()
 */
export async function seedBaseLPWithAgent(
  params: SeedBaseLPWithAgentParams,
): Promise<SeedBaseLPWithAgentResult> {
  if (!BASE_LP_ENABLED) throw new Error('Base LP is disabled. Use Monad nad.fun flow instead.');
  const {
    eigenId,
    tokenAddress,
    sqrtPriceX96,
    tokenAmount,
    lpEthAmount,
    vaultDepositEth,
    tradingFeeBps,
    agentURI,
    onBehalfOf,
  } = params;

  // Test mode: return mock data
  if (process.env.X402_TEST_MODE === 'true') {
    const mockPoolId = keccak256(encodeAbiParameters(
      parseAbiParameters('string, address'),
      [`test-pool-${eigenId}`, tokenAddress],
    )) as Hex;
    const mockTx = keccak256(encodeAbiParameters(
      parseAbiParameters('string'),
      [`test-launch-tx-${eigenId}`],
    )) as Hex;
    console.log(`[BaseLP] TEST MODE — mock launch with agent: poolId=${mockPoolId}, agentId=1`);
    return { poolId: mockPoolId, tokenId: 1, agentId: '1', txHash: mockTx };
  }

  if (LAUNCHER_ADDRESS === ZERO_ADDRESS) {
    throw new Error('EigenLauncher not deployed — set EIGENLAUNCHER_ADDRESS env var');
  }

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const keeperAddress = getKeeperAddress();

  // 1. Check token balance
  const tokenBalance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [keeperAddress],
  });

  if (tokenBalance < tokenAmount) {
    throw new Error(
      `Insufficient token balance: have ${tokenBalance}, need ${tokenAmount}`,
    );
  }

  // 2. Approve tokens to EigenLauncher
  console.log(`[BaseLP] Approving ${tokenAmount} tokens to EigenLauncher...`);
  const approveTx = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [LAUNCHER_ADDRESS, tokenAmount],
  });
  await client.waitForTransactionReceipt({ hash: approveTx });

  // 3. Call EigenLauncher.launch()
  const bytes32Id = eigenIdToBytes32(eigenId);
  const totalValue = lpEthAmount + vaultDepositEth;

  console.log(
    `[BaseLP] EigenLauncher launch: eigenId=${eigenId}, token=${tokenAddress}, ` +
    `lpEth=${formatEther(lpEthAmount)}, vaultEth=${formatEther(vaultDepositEth)}, ` +
    `tokenAmount=${tokenAmount}, feeBps=${tradingFeeBps}, onBehalfOf=${onBehalfOf}`,
  );

  const launchTx = await walletClient.writeContract({
    address: LAUNCHER_ADDRESS,
    abi: EIGENLAUNCHER_ABI,
    functionName: 'launch',
    args: [
      bytes32Id,
      tokenAddress,
      sqrtPriceX96,
      tokenAmount,
      tradingFeeBps,
      vaultDepositEth,
      agentURI,
      onBehalfOf,
    ],
    value: totalValue,
  });

  console.log(`[BaseLP] EigenLauncher launch tx: ${launchTx}`);
  const receipt = await client.waitForTransactionReceipt({ hash: launchTx });

  // 4. Parse Registered event to get agentId
  // Registered(uint256 indexed agentId, string agentURI, address indexed owner)
  const REGISTERED_TOPIC = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
  let agentId: string | null = null;
  for (const log of receipt.logs) {
    if (log.topics[0] === REGISTERED_TOPIC && log.topics[1]) {
      agentId = BigInt(log.topics[1]).toString();
      break;
    }
  }

  if (!agentId) {
    throw new Error(`Failed to extract agentId from launch tx ${launchTx}`);
  }

  // 5. Read back position from EigenLP
  const positionData = await client.readContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'getPosition',
    args: [bytes32Id],
  });

  const tokenId = Number((positionData as any)[0]);
  const poolId = (positionData as any)[1] as Hex;

  console.log(
    `[BaseLP] EigenLauncher complete: poolId=${poolId}, tokenId=${tokenId}, agentId=${agentId}`,
  );

  return {
    poolId,
    tokenId,
    agentId,
    txHash: launchTx,
  };
}

// ── Direct LP Seed (no bundler needed) ────────────────────────────────────

export interface SeedBaseLPDirectParams {
  eigenId: string;
  tokenAddress: Address;
  sqrtPriceX96: bigint;
  tokenAmount: bigint;
  ethAmount: bigint;
}

/**
 * Seed an EigenLP pool directly via EigenLP.seedPool() (no bundler required).
 * Use this when the EigenLauncher/EigenBundler paths are unavailable.
 *
 * Steps:
 * 1. Approve tokens to EigenLP (with on-chain verification)
 * 2. Call EigenLP.seedPool() with ETH + tokens
 * 3. Read back position from EigenLP.getPosition()
 */
export async function seedBaseLPDirect(
  params: SeedBaseLPDirectParams,
): Promise<SeedBaseLPResult> {
  if (!BASE_LP_ENABLED) throw new Error('Base LP is disabled. Use Monad nad.fun flow instead.');
  const { eigenId, tokenAddress, sqrtPriceX96, tokenAmount, ethAmount } = params;

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const keeperAddress = getKeeperAddress();
  const bytes32Id = eigenIdToBytes32(eigenId);

  // 1. Approve tokens to EigenLP
  console.log(`[BaseLP] Approving ${tokenAmount} tokens to EigenLP (${LP_ADDRESS})...`);
  const approveTx = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [LP_ADDRESS, tokenAmount],
  });
  const approveReceipt = await client.waitForTransactionReceipt({ hash: approveTx });
  console.log(`[BaseLP] Approve tx confirmed: ${approveTx} (block ${approveReceipt.blockNumber}, status=${approveReceipt.status})`);

  // Verify allowance on-chain (guards against RPC state inconsistency)
  for (let attempt = 0; attempt < 5; attempt++) {
    const allowance = await client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [keeperAddress, LP_ADDRESS],
    });
    console.log(`[BaseLP] Allowance check (attempt ${attempt + 1}): ${allowance} (need ${tokenAmount})`);
    if (allowance >= tokenAmount) break;
    if (attempt === 4) {
      throw new Error(`Allowance not reflected on-chain after approve tx ${approveTx}. Have ${allowance}, need ${tokenAmount}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Also verify token balance
  const balance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [keeperAddress],
  });
  console.log(`[BaseLP] Token balance: ${balance}`);
  if (balance < tokenAmount) {
    throw new Error(`Insufficient token balance: have ${balance}, need ${tokenAmount}`);
  }

  // 2. Call EigenLP.seedPool() directly
  console.log(
    `[BaseLP] Direct seedPool: eigenId=${eigenId}, token=${tokenAddress}, ` +
    `ethAmount=${formatEther(ethAmount)}, tokenAmount=${tokenAmount}, sqrtPriceX96=${sqrtPriceX96}`,
  );

  const seedTx = await walletClient.writeContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'seedPool',
    args: [bytes32Id, tokenAddress, sqrtPriceX96, tokenAmount],
    value: ethAmount,
  });

  console.log(`[BaseLP] seedPool tx: ${seedTx}`);
  const seedReceipt = await client.waitForTransactionReceipt({ hash: seedTx });
  console.log(`[BaseLP] seedPool confirmed: block ${seedReceipt.blockNumber}, status=${seedReceipt.status}, gasUsed=${seedReceipt.gasUsed}`);

  // 3. Read back position
  const positionData = await client.readContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'getPosition',
    args: [bytes32Id],
  });

  const tokenId = Number((positionData as any)[0]);
  const poolId = (positionData as any)[1] as Hex;

  console.log(
    `[BaseLP] Direct seed complete: poolId=${poolId}, tokenId=${tokenId}`,
  );

  return { poolId, tokenId, txHash: seedTx };
}

// ── Atomic Deploy + Launch (via EigenFactory) ─────────────────────────────
// Deploys token via Clanker AND seeds LP + vault + 8004 in a SINGLE tx.
// Eliminates the front-running window between Clanker deploy and LP seed.

import type { ClankerDeployTxConfig } from './base-deployer';

export interface AtomicDeployAndLaunchParams {
  eigenId: string;
  clankerTx: ClankerDeployTxConfig;
  sqrtPriceX96: bigint;
  lpEthAmount: bigint;
  vaultDepositEth: bigint;
  tradingFeeBps: bigint;
  agentURI: string;
  onBehalfOf: Address;
}

export interface AtomicDeployAndLaunchResult {
  tokenAddress: Address;
  agentId: string;
  poolId: Hex;
  tokenId: number;
  txHash: Hex;
}

/**
 * Atomic token deployment + LP seed + vault creation + 8004 agent mint
 * via EigenFactory.deployAndLaunch(). All in ONE transaction.
 *
 * Steps:
 * 1. Call EigenFactory.deployAndLaunch() with:
 *    - Clanker factory calldata (pre-encoded by buildClankerDeployTx)
 *    - EigenLauncher params (eigenId, fees, agentURI, etc.)
 * 2. Parse Registered event from receipt to get agentId
 * 3. Read back LP position from EigenLP.getPosition()
 */
export async function atomicDeployAndLaunch(
  params: AtomicDeployAndLaunchParams,
): Promise<AtomicDeployAndLaunchResult> {
  if (!BASE_LP_ENABLED) throw new Error('Base LP is disabled. Use Monad nad.fun flow instead.');
  const {
    eigenId,
    clankerTx,
    sqrtPriceX96,
    lpEthAmount,
    vaultDepositEth,
    tradingFeeBps,
    agentURI,
    onBehalfOf,
  } = params;

  if (FACTORY_ADDRESS === ZERO_ADDRESS) {
    throw new Error('EigenFactory not deployed — set EIGENFACTORY_ADDRESS env var');
  }

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const bytes32Id = eigenIdToBytes32(eigenId);

  // Total ETH = dev buy + LP + vault
  const totalValue = clankerTx.value + lpEthAmount + vaultDepositEth;

  console.log(
    `[BaseLP] Atomic deployAndLaunch: eigenId=${eigenId}, ` +
    `factory=${clankerTx.factoryAddress}, expectedToken=${clankerTx.expectedAddress}, ` +
    `devBuyEth=${formatEther(clankerTx.value)}, lpEth=${formatEther(lpEthAmount)}, ` +
    `vaultEth=${formatEther(vaultDepositEth)}, sqrtPriceX96=${sqrtPriceX96}`,
  );

  console.log(`[BaseLP] Sending writeContract to ${FACTORY_ADDRESS}, value=${formatEther(totalValue)} ETH`);

  const tx = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: EIGENFACTORY_ABI,
    functionName: 'deployAndLaunch',
    args: [
      clankerTx.factoryAddress,
      clankerTx.calldata,
      clankerTx.value,
      clankerTx.expectedAddress,
      sqrtPriceX96,
      bytes32Id,
      tradingFeeBps,
      vaultDepositEth,
      agentURI,
      onBehalfOf,
    ],
    value: totalValue,
    gas: 8_000_000n, // atomic deploy is gas-heavy
  });

  console.log(`[BaseLP] Atomic deployAndLaunch tx sent: ${tx}`);
  const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  console.log(`[BaseLP] Tx status: ${receipt.status}, gasUsed: ${receipt.gasUsed}`);

  // Parse token address from TokenCreated event or use expected
  let tokenAddress = clankerTx.expectedAddress;

  if (receipt.status === 'reverted') {
    throw new Error(`Atomic launch tx reverted: ${tx}`);
  }

  // Parse events from receipt logs
  const REGISTERED_TOPIC = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
  const POOL_SEEDED_TOPIC = '0xeb6b191506821e4e684f1af171c11cd4adec26740725f65e5a730ae416df81fe';
  let agentId: string | null = null;
  let poolId: Hex = '0x' as Hex;
  let tokenId = 0;

  for (const log of receipt.logs) {
    // ERC-8004 Registered event: topics[1] = agentId
    if (log.topics[0] === REGISTERED_TOPIC && log.topics[1]) {
      agentId = BigInt(log.topics[1]).toString();
    }

    // EigenLP PoolSeeded event: data = poolId (bytes32) + nftTokenId (uint256)
    if (log.topics[0] === POOL_SEEDED_TOPIC && log.address.toLowerCase() === LP_ADDRESS.toLowerCase()) {
      const data = log.data as string;
      if (data.length >= 130) { // 0x + 64 + 64
        poolId = ('0x' + data.slice(2, 66)) as Hex;
        tokenId = Number(BigInt('0x' + data.slice(66, 130)));
      }
    }
  }

  if (!agentId) {
    console.warn(`[BaseLP] No Registered event found in tx ${tx} — agent may not have been minted`);
  }

  if (poolId === '0x' || poolId === ('0x' + '0'.repeat(64))) {
    console.warn(`[BaseLP] No PoolSeeded event found in tx ${tx} — LP pool may not have been created`);
    // Fallback: try reading from contract (might be stale)
    try {
      const positionData = await client.readContract({
        address: LP_ADDRESS,
        abi: EIGENLP_ABI,
        functionName: 'getPosition',
        args: [bytes32Id],
      });
      tokenId = Number((positionData as any)[0]);
      poolId = (positionData as any)[1] as Hex;
    } catch { }
  }

  console.log(
    `[BaseLP] Atomic launch complete: token=${tokenAddress}, poolId=${poolId}, ` +
    `tokenId=${tokenId}, agentId=${agentId}`,
  );

  return {
    tokenAddress,
    agentId: agentId || '',
    poolId,
    tokenId,
    txHash: tx,
  };
}

// ── Collect LP Fees (via EigenLP) ──────────────────────────────────────────

/**
 * Collect accumulated fees from an EigenLP position.
 */
export async function collectBaseLpFees(eigenId: string): Promise<Hex | null> {
  if (!BASE_LP_ENABLED) return null;
  if (LP_ADDRESS === ZERO_ADDRESS) return null;

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const bytes32Id = eigenIdToBytes32(eigenId);

  try {
    const hash = await walletClient.writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'collectFees',
      args: [bytes32Id, BigInt(0), BigInt(0)],
    });

    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status === 'success') {
      console.log(`[BaseLP] Collected fees for ${eigenId}: ${hash}`);
      return hash;
    }
    return null;
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('revert') || msg.includes('insufficient')) {
      return null; // No fees to collect
    }
    throw error;
  }
}

// ── Compound LP Fees (via EigenLP) ─────────────────────────────────────────

/**
 * Compound accumulated fees back into the LP position.
 */
export async function compoundBaseLpFees(eigenId: string): Promise<Hex | null> {
  if (!BASE_LP_ENABLED) return null;
  if (LP_ADDRESS === ZERO_ADDRESS) return null;

  const client = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);
  const bytes32Id = eigenIdToBytes32(eigenId);

  try {
    const hash = await walletClient.writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'compoundFees',
      args: [bytes32Id],
    });

    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status === 'success') {
      console.log(`[BaseLP] Compounded fees for ${eigenId}: ${hash}`);
      return hash;
    }
    return null;
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('revert') || msg.includes('insufficient')) {
      return null; // No fees to compound
    }
    throw error;
  }
}
