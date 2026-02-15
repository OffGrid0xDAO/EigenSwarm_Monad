/**
 * ERC-8004 (Trustless Agents) integration module.
 *
 * Registers eigens as ERC-8004 agents on the Identity Registry,
 * builds Agent Card JSON, and updates agent URIs.
 *
 * Feature-flagged via ERC8004_ENABLED env var.
 */

import { encodeFunctionData, type Hex, stringToHex, padHex } from 'viem';
import {
  ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
  IDENTITY_REGISTRY_8004_ABI,
  REPUTATION_REGISTRY_8004_ABI,
} from '@eigenswarm/shared';
import { getPublicClient, getWalletClient } from './client';
import { getEigenConfig, getTradeStats, updateAgent8004Id, type EigenConfig } from './db';

const DEFAULT_CHAIN_ID = 143;

export function isErc8004Enabled(): boolean {
  return process.env.ERC8004_ENABLED === 'true';
}

/**
 * Build an ERC-8004 Agent Card JSON for the given eigen.
 */
export function buildAgentCard(
  eigenId: string,
  config: EigenConfig,
  stats?: { totalBuys: number; totalSells: number; winRate: number; totalRealizedPnl: number },
): Record<string, unknown> {
  const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
  const classLabel = config.class === 'sentinel' ? 'Lite'
    : config.class === 'operator' ? 'Core'
      : config.class === 'architect' ? 'Pro'
        : config.class === 'sovereign' ? 'Ultra'
          : config.class;

  const description = [
    `Autonomous market-maker. ${classLabel} class.`,
    stats ? `${stats.totalBuys + stats.totalSells} trades, ${stats.winRate.toFixed(1)}% win rate.` : '',
    config.token_symbol ? `Trading $${config.token_symbol}.` : '',
  ].filter(Boolean).join(' ');

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `EigenSwarm Agent ${eigenId} · $${config.token_symbol || 'unknown'}`,
    description,
    services: [
      {
        name: 'web',
        endpoint: `${baseUrl}/app/eigen/${eigenId}`,
      },
      {
        name: 'api',
        endpoint: `${baseUrl}/api/eigens/${eigenId}/agent-card`,
      },
    ],
    active: config.status === 'active',
    supportedTrust: ['reputation'],
    metadata: {
      platform: 'eigenswarm',
      eigenId,
      chainId: config.chain_id,
      class: config.class,
      tokenAddress: config.token_address,
      tokenSymbol: config.token_symbol,
    },
  };
}

/**
 * Register an eigen as an ERC-8004 agent on the Identity Registry.
 * Returns the minted agent NFT ID.
 */
export async function registerAgent(
  eigenId: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<string> {
  const config = getEigenConfig(eigenId);
  if (!config) throw new Error(`Eigen ${eigenId} not found`);

  const stats = getTradeStats(eigenId);
  const winRate = (stats.winCount + stats.lossCount) > 0
    ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
    : 0;

  const agentCard = buildAgentCard(eigenId, config, {
    totalBuys: stats.totalBuys,
    totalSells: stats.totalSells,
    winRate,
    totalRealizedPnl: stats.totalRealizedPnl,
  });
  const agentURI = JSON.stringify(agentCard);

  const walletClient = getWalletClient(chainId);
  const publicClientInstance = getPublicClient(chainId);

  // Call register(agentURI) on Identity Registry
  const txHash = await walletClient.writeContract({
    address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_REGISTRY_8004_ABI,
    functionName: 'register',
    args: [agentURI],
  });

  console.log(`[ERC-8004] Register tx sent for ${eigenId}: ${txHash}`);

  // Wait for receipt and extract agentId from Registered event
  const receipt = await publicClientInstance.waitForTransactionReceipt({ hash: txHash });

  // Registered(uint256 indexed agentId, string agentURI, address indexed owner)
  // topic[0] = keccak256("Registered(uint256,string,address)") = 0xca52e62c...
  // topic[1] = agentId (indexed)
  const REGISTERED_TOPIC = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
  const registryAddr = (ERC8004_IDENTITY_REGISTRY as string).toLowerCase();

  let agentId: string | null = null;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === registryAddr &&
      log.topics[0] === REGISTERED_TOPIC &&
      log.topics[1]
    ) {
      // topics[1] is the indexed agentId as uint256
      agentId = BigInt(log.topics[1]).toString();
      break;
    }
  }

  if (!agentId) {
    console.error(`[ERC-8004] Could not find Registered event in tx ${txHash}. Logs:`, receipt.logs.map((l: { address: string; topics: string[] }) => ({ addr: l.address, topics: l.topics })));
    throw new Error(`Failed to extract agentId from registration tx ${txHash}`);
  }

  // Build the agent card URI for future reads
  const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
  const agentCardUri = `${baseUrl}/api/eigens/${eigenId}/agent-card`;

  // Store in DB
  updateAgent8004Id(eigenId, agentId, chainId, agentCardUri);

  console.log(`[ERC-8004] Registered ${eigenId} as agent #${agentId} on chain ${chainId}`);
  return agentId;
}

/**
 * Resolve the 8004 agent ID for a given eigenId.
 * Returns null if not registered.
 */
export function getAgentIdForEigen(eigenId: string): string | null {
  const config = getEigenConfig(eigenId);
  return config?.agent_8004_id || null;
}

/**
 * Update the agent card URI on-chain via setAgentURI.
 * Called when stats change significantly (e.g., daily reputation posting).
 */
export async function updateAgentCard(
  eigenId: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<void> {
  const config = getEigenConfig(eigenId);
  if (!config || !config.agent_8004_id) return;

  const stats = getTradeStats(eigenId);
  const winRate = (stats.winCount + stats.lossCount) > 0
    ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
    : 0;

  const agentCard = buildAgentCard(eigenId, config, {
    totalBuys: stats.totalBuys,
    totalSells: stats.totalSells,
    winRate,
    totalRealizedPnl: stats.totalRealizedPnl,
  });
  const agentURI = JSON.stringify(agentCard);

  const walletClient = getWalletClient(chainId);

  try {
    const txHash = await walletClient.writeContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: IDENTITY_REGISTRY_8004_ABI,
      functionName: 'setAgentURI',
      args: [BigInt(config.agent_8004_id), agentURI],
    });

    console.log(`[ERC-8004] Updated agent card for ${eigenId} (agent #${config.agent_8004_id}): ${txHash}`);
  } catch (error) {
    console.warn(`[ERC-8004] Failed to update agent card for ${eigenId}:`, (error as Error).message);
  }
}

/**
 * Resolve the current NFT owner of an 8004 agent.
 * Used for NFT-based ownership resolution (Phase 3).
 */
export async function resolveAgent8004Owner(
  agent8004Id: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<string | null> {
  try {
    const client = getPublicClient(chainId);
    const owner = await client.readContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: IDENTITY_REGISTRY_8004_ABI,
      functionName: 'ownerOf',
      args: [BigInt(agent8004Id)],
    });
    return owner as string;
  } catch {
    return null;
  }
}

/**
 * Encode a tag string to bytes32 for the Reputation Registry.
 */
export function encodeTag(tag: string): Hex {
  const hex = stringToHex(tag, { size: 32 });
  return hex;
}
