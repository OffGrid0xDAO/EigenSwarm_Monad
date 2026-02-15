/**
 * Base Token Deployer — Clanker SDK V4
 *
 * Deploys tokens on Base via Clanker, matching the frontend flow
 * in apps/web/src/app/app/launch/page.tsx:209-241.
 *
 * DISABLED: Base deployer is disabled for Monad-first migration.
 * Use monad-trader.ts createMonadToken() for token deployment.
 */

const BASE_DEPLOYER_ENABLED = false; // Disabled for Monad-first

import { type Address, type Hex, keccak256, toHex, encodeFunctionData } from 'viem';
import { getPublicClient, getWalletClient, getKeeperAddress } from './client';

const BASE_CHAIN_ID = 143;

export interface DeployBaseTokenParams {
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  tokenAdmin: Address;
  feeType?: 'static' | 'dynamic';
  devBuyEth?: number;
  /** Override dev buy recipient (e.g. EigenFactory address for atomic launches) */
  devBuyRecipient?: Address;
}

export interface DeployBaseTokenResult {
  tokenAddress: Address;
  txHash: Hex;
}

/**
 * Deploy a token on Base via Clanker SDK V4.
 *
 * Uses the same configuration as the frontend:
 *   - Full-range position: tickLower=-230400, tickUpper=887200, positionBps=10000
 *   - Static fees: clankerFee=100, pairedFee=100
 *   - Dynamic fees: baseFee=100, maxFee=2000, etc.
 *   - Optional dev buy (atomically bundled by Clanker)
 *   - Sniper fee protection (auto-applied by Clanker SDK via sniperFees defaults)
 */
export async function deployBaseToken(
  params: DeployBaseTokenParams,
): Promise<DeployBaseTokenResult> {
  if (!BASE_DEPLOYER_ENABLED) throw new Error('Base deployer is disabled. Use Monad nad.fun flow instead.');
  const {
    name,
    symbol,
    image,
    description,
    tokenAdmin,
    feeType = 'static',
    devBuyEth = 0,
  } = params;

  // Test mode: return a deterministic mock token address
  if (process.env.X402_TEST_MODE === 'true') {
    const mockAddr = keccak256(toHex(`test-token-${name}-${symbol}-${Date.now()}`)).slice(0, 42) as Address;
    const mockTx = keccak256(toHex(`test-deploy-tx-${mockAddr}`)) as Hex;
    console.log(`[BaseDeployer] TEST MODE — mock token deployed: ${mockAddr}`);
    return { tokenAddress: mockAddr, txHash: mockTx };
  }

  const publicClient = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);

  // Dynamic import to match frontend pattern
  const { Clanker } = await import('clanker-sdk/v4');
  const clanker = new Clanker({
    wallet: walletClient as any,
    publicClient: publicClient as any,
  });

  console.log(`[BaseDeployer] Deploying token: ${name} ($${symbol})`);

  const result = await clanker.deploy({
    name,
    symbol,
    image: image || undefined,
    tokenAdmin,
    metadata: { description: description || undefined },
    pool: {
      positions: [
        { tickLower: -230400, tickUpper: 887200, positionBps: 10000 },
      ],
    },
    fees: feeType === 'dynamic'
      ? {
        type: 'dynamic' as const,
        baseFee: 100,
        maxFee: 2000,
        referenceTickFilterPeriod: 300,
        resetPeriod: 3600,
        resetTickFilter: 100,
        feeControlNumerator: 5000,
        decayFilterBps: 9500,
      }
      : { type: 'static' as const, clankerFee: 100, pairedFee: 100 },
    devBuy: devBuyEth > 0 ? { ethAmount: devBuyEth, recipient: getKeeperAddress() } : undefined,
  });

  // Check for deploy error
  if ((result as any).error) {
    const err = (result as any).error;
    const detail =
      err?.data?.label ||
      err?.data?.rawName ||
      err?.error?.shortMessage ||
      err?.message ||
      String(err);
    console.error('[BaseDeployer] Clanker deploy error:', err);
    throw new Error(detail);
  }

  const receipt = await (result as any).waitForTransaction();
  const tokenAddress = (receipt.address || '') as Address;

  if (!tokenAddress) {
    throw new Error('Clanker deploy succeeded but no token address in receipt');
  }

  console.log(`[BaseDeployer] Token deployed at: ${tokenAddress}`);

  return {
    tokenAddress,
    txHash: receipt.transactionHash || (receipt as any).hash || ('0x' as Hex),
  };
}

// ── Build Clanker Deploy Calldata (for EigenFactory atomic path) ────────

export interface ClankerDeployTxConfig {
  /** Clanker factory address */
  factoryAddress: Address;
  /** Pre-encoded calldata for deployToken() */
  calldata: Hex;
  /** ETH value to send (for dev buy) */
  value: bigint;
  /** Predicted token address via CREATE2 */
  expectedAddress: Address;
}

/**
 * Build the Clanker deploy transaction config WITHOUT sending it.
 * Used by EigenFactory for atomic deploy + launch.
 *
 * Uses the SDK's getDeployTransaction() to get the tx params,
 * then encodes them as calldata for our contract to forward.
 */
export async function buildClankerDeployTx(
  params: DeployBaseTokenParams,
): Promise<ClankerDeployTxConfig> {
  if (!BASE_DEPLOYER_ENABLED) throw new Error('Base deployer is disabled. Use Monad nad.fun flow instead.');
  const {
    name,
    symbol,
    image,
    description,
    tokenAdmin,
    feeType = 'static',
    devBuyEth = 0,
    devBuyRecipient,
  } = params;

  const publicClient = getPublicClient(BASE_CHAIN_ID);
  const walletClient = getWalletClient(BASE_CHAIN_ID);

  const { Clanker } = await import('clanker-sdk/v4');
  const clanker = new Clanker({
    wallet: walletClient as any,
    publicClient: publicClient as any,
  });

  // Build tx config without sending
  const txConfig = await clanker.getDeployTransaction({
    name,
    symbol,
    image: image || undefined,
    tokenAdmin,
    metadata: { description: description || undefined },
    pool: {
      positions: [
        { tickLower: -230400, tickUpper: 887200, positionBps: 10000 },
      ],
    },
    fees: feeType === 'dynamic'
      ? {
        type: 'dynamic' as const,
        baseFee: 100,
        maxFee: 2000,
        referenceTickFilterPeriod: 300,
        resetPeriod: 3600,
        resetTickFilter: 100,
        feeControlNumerator: 5000,
        decayFilterBps: 9500,
      }
      : { type: 'static' as const, clankerFee: 100, pairedFee: 100 },
    devBuy: devBuyEth > 0
      ? { ethAmount: devBuyEth, recipient: devBuyRecipient || getKeeperAddress() }
      : undefined,
  });

  // Encode the function call as raw calldata
  const calldata = encodeFunctionData({
    abi: (txConfig as any).abi,
    functionName: (txConfig as any).functionName,
    args: (txConfig as any).args,
  });

  console.log(
    `[BaseDeployer] Built Clanker deploy tx: factory=${(txConfig as any).address}, ` +
    `expectedToken=${(txConfig as any).expectedAddress}, value=${(txConfig as any).value || 0n}`,
  );

  return {
    factoryAddress: (txConfig as any).address as Address,
    calldata: calldata as Hex,
    value: BigInt((txConfig as any).value || 0),
    expectedAddress: (txConfig as any).expectedAddress as Address,
  };
}
