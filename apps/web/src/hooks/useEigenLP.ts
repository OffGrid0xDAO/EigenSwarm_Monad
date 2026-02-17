'use client';

import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import { parseEther } from 'viem';
import { EIGENLP_ABI, EIGENLP_ADDRESS } from '@eigenswarm/shared';
import { eigenIdToBytes32 } from '@eigenswarm/shared';

const LP_ADDRESS = (process.env.NEXT_PUBLIC_EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;

// ── Seed Pool ──────────────────────────────────────────────────────────────

export function useSeedPool() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function seedPool(
    eigenId: string,
    tokenAddress: `0x${string}`,
    sqrtPriceX96: bigint,
    tokenAmount: bigint,
    ethAmount: string,
  ) {
    writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'seedPool',
      args: [eigenIdToBytes32(eigenId), tokenAddress, sqrtPriceX96, tokenAmount],
      value: parseEther(ethAmount),
    });
  }

  return { seedPool, hash, isPending, isConfirming, isSuccess, error };
}

// ── Collect Fees ───────────────────────────────────────────────────────────

export function useCollectFees() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function collectFees(eigenId: string) {
    writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'collectFees',
      args: [eigenIdToBytes32(eigenId), BigInt(0), BigInt(0)],
    });
  }

  return { collectFees, hash, isPending, isConfirming, isSuccess, error };
}

// ── Remove Liquidity ───────────────────────────────────────────────────────

export function useRemoveLiquidity() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function removeLiquidity(eigenId: string) {
    writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'removeLiquidity',
      args: [eigenIdToBytes32(eigenId), BigInt(0), BigInt(0)],
    });
  }

  return { removeLiquidity, hash, isPending, isConfirming, isSuccess, error };
}

// ── Compound Fees ─────────────────────────────────────────────────────────────

export function useCompoundFees() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function compoundFees(eigenId: string) {
    writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'compoundFees',
      args: [eigenIdToBytes32(eigenId)],
    });
  }

  return { compoundFees, hash, isPending, isConfirming, isSuccess, error };
}

// ── Seed Pool Concentrated ────────────────────────────────────────────────────

export function useSeedPoolConcentrated() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function seedPoolConcentrated(
    eigenId: string,
    tokenAddress: `0x${string}`,
    sqrtPriceX96: bigint,
    tokenAmount: bigint,
    ethAmount: string,
    tickLower: number,
    tickUpper: number,
  ) {
    writeContract({
      address: LP_ADDRESS,
      abi: EIGENLP_ABI,
      functionName: 'seedPoolConcentrated',
      args: [eigenIdToBytes32(eigenId), tokenAddress, sqrtPriceX96, tokenAmount, tickLower, tickUpper],
      value: parseEther(ethAmount),
    });
  }

  return { seedPoolConcentrated, hash, isPending, isConfirming, isSuccess, error };
}

// ── Read: Get Position ─────────────────────────────────────────────────────

export function useLPPosition(eigenId: string) {
  const bytes32Id = eigenId ? eigenIdToBytes32(eigenId) : ('0x' + '0'.repeat(64)) as `0x${string}`;

  const { data, isLoading, error } = useReadContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'getPosition',
    args: [bytes32Id],
    query: { enabled: !!eigenId },
  });

  return {
    tokenId: data?.[0] as bigint | undefined,
    poolId: data?.[1] as `0x${string}` | undefined,
    token: data?.[2] as `0x${string}` | undefined,
    eigenOwner: data?.[3] as `0x${string}` | undefined,
    fee: data?.[4] as number | undefined,
    tickSpacing: data?.[5] as number | undefined,
    isLoading,
    error,
  };
}
