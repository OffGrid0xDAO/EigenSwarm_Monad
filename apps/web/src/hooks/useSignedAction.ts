import { useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { buildRegisterMessage, buildLiquidateMessage, buildAdjustMessage, buildTakeProfitMessage, buildDeleteMessage, buildTerminateMessage } from '@/lib/signing';

export function useSignedRegister() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signRegister = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildRegisterMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signRegister };
}

export function useSignedLiquidate() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signLiquidate = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildLiquidateMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signLiquidate };
}

export function useSignedAdjust() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signAdjust = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildAdjustMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signAdjust };
}

export function useSignedTakeProfit() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signTakeProfit = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildTakeProfitMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signTakeProfit };
}

export function useSignedDelete() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signDelete = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildDeleteMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signDelete };
}

export function useSignedTerminate() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signTerminate = useCallback(
    async (eigenId: string): Promise<{ signature: string; timestamp: number }> => {
      if (!address) throw new Error('Wallet not connected');
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildTerminateMessage(eigenId, address, timestamp);
      const signature = await signMessageAsync({ message });
      return { signature, timestamp };
    },
    [address, signMessageAsync],
  );

  return { signTerminate };
}
