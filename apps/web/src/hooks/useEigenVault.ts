'use client';

import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import { parseEther } from 'viem';
import {
  EIGENVAULT_ABI,
  EIGENVAULT_ADDRESS,
  eigenIdToBytes32,
} from '@eigenswarm/shared';

const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
const VAULT_ABI = EIGENVAULT_ABI;

// ── Create Eigen ────────────────────────────────────────────────────────────

export function useCreateEigen() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function createEigen(eigenId: string, ethAmount: string, tradingFeeBps: number) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'createEigen',
      args: [eigenIdToBytes32(eigenId), BigInt(tradingFeeBps)],
      value: parseEther(ethAmount),
    });
  }

  return { createEigen, hash, isPending, isConfirming, isSuccess, error };
}

// ── Deposit ─────────────────────────────────────────────────────────────────

export function useDeposit() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function deposit(eigenId: string, ethAmount: string) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [eigenIdToBytes32(eigenId)],
      value: parseEther(ethAmount),
    });
  }

  return { deposit, hash, isPending, isConfirming, isSuccess, error };
}

// ── Withdraw ────────────────────────────────────────────────────────────────

export function useWithdraw() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function withdraw(eigenId: string, ethAmount: string) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [eigenIdToBytes32(eigenId), parseEther(ethAmount)],
    });
  }

  return { withdraw, hash, isPending, isConfirming, isSuccess, error };
}

// ── Terminate ───────────────────────────────────────────────────────────────

export function useTerminate() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function terminate(eigenId: string) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'terminate',
      args: [eigenIdToBytes32(eigenId)],
    });
  }

  return { terminate, hash, isPending, isConfirming, isSuccess, error };
}

// ── Suspend ─────────────────────────────────────────────────────────────────

export function useSuspend() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function suspend(eigenId: string) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'suspend',
      args: [eigenIdToBytes32(eigenId)],
    });
  }

  return { suspend, hash, isPending, isConfirming, isSuccess, error };
}

// ── Resume ──────────────────────────────────────────────────────────────────

export function useResume() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function resume(eigenId: string) {
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'resume',
      args: [eigenIdToBytes32(eigenId)],
    });
  }

  return { resume, hash, isPending, isConfirming, isSuccess, error };
}

// ── Read: Eigen Info ────────────────────────────────────────────────────────

export function useEigenInfo(eigenId: string) {
  const bytes32Id = eigenIdToBytes32(eigenId);

  const { data, isLoading, error } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'getEigenInfo',
    args: [bytes32Id],
    query: { enabled: !!eigenId },
  });

  return {
    owner: data?.[0] as `0x${string}` | undefined,
    active: data?.[1] as boolean | undefined,
    balance: data?.[2] as bigint | undefined,
    isLoading,
    error,
  };
}

// ── Exported constants ──────────────────────────────────────────────────────

export { VAULT_ADDRESS };
