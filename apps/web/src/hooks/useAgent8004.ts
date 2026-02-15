'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import {
  ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
  IDENTITY_REGISTRY_8004_ABI,
  REPUTATION_REGISTRY_8004_ABI,
} from '@eigenswarm/shared';

/**
 * Read agent reputation summary from the on-chain Reputation Registry.
 */
export function useAgentReputation(agentId: string | undefined | null, chainId: number = 143) {
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ['agent8004Reputation', agentId, chainId],
    queryFn: async () => {
      if (!agentId || !publicClient) return null;

      const [summary, feedbackCount] = await Promise.all([
        publicClient.readContract({
          address: ERC8004_REPUTATION_REGISTRY as `0x${string}`,
          abi: REPUTATION_REGISTRY_8004_ABI,
          functionName: 'getSummary',
          args: [BigInt(agentId)],
        }).catch(() => null),
        publicClient.readContract({
          address: ERC8004_REPUTATION_REGISTRY as `0x${string}`,
          abi: REPUTATION_REGISTRY_8004_ABI,
          functionName: 'feedbackCount',
          args: [BigInt(agentId)],
        }).catch(() => BigInt(0)),
      ]);

      if (!summary) return null;

      const [totalFeedback, averageValue] = summary as [bigint, bigint];

      // Read last few feedback entries in parallel
      const count = Number(feedbackCount);
      const recentFeedback: {
        tag1: string;
        tag2: string;
        value: number;
        timestamp: number;
      }[] = [];

      const entriesToRead = Math.min(count, 10);
      if (entriesToRead > 0) {
        const indices = Array.from({ length: entriesToRead }, (_, j) => count - 1 - j).filter(i => i >= 0);
        const results = await Promise.all(
          indices.map(i =>
            publicClient.readContract({
              address: ERC8004_REPUTATION_REGISTRY as `0x${string}`,
              abi: REPUTATION_REGISTRY_8004_ABI,
              functionName: 'readFeedback',
              args: [BigInt(agentId), BigInt(i)],
            }).catch(() => null)
          )
        );

        for (const entry of results) {
          if (!entry) continue;
          const [, tag1Hex, tag2Hex, value, timestamp] = entry as [string, `0x${string}`, `0x${string}`, bigint, bigint];
          recentFeedback.push({
            tag1: hexToString(tag1Hex),
            tag2: hexToString(tag2Hex),
            value: Number(value),
            timestamp: Number(timestamp),
          });
        }
      }

      return {
        totalFeedback: Number(totalFeedback),
        averageValue: Number(averageValue),
        recentFeedback,
      };
    },
    enabled: !!agentId && !!publicClient,
    refetchInterval: 60_000, // Refresh every minute
    staleTime: 30_000,
  });
}

/**
 * Read the current owner of an 8004 agent NFT.
 */
export function useAgent8004Owner(agentId: string | undefined | null, chainId: number = 143) {
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ['agent8004Owner', agentId, chainId],
    queryFn: async () => {
      if (!agentId || !publicClient) return null;

      const owner = await publicClient.readContract({
        address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_8004_ABI,
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
      });

      return owner as string;
    },
    enabled: !!agentId && !!publicClient,
    staleTime: 30_000,
  });
}

function hexToString(hex: `0x${string}`): string {
  // Remove trailing null bytes and convert
  let str = '';
  for (let i = 2; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
}
