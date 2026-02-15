'use client';

import { type ReactNode } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { base } from 'wagmi/chains';
import { GlowButton } from '@/components/ui';

export function ChainGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { login, ready } = usePrivy();

  if (!ready) return null;

  if (!isConnected) {
    return (
      <div className="app-island-body">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-txt-primary mb-2">Connect Your Wallet</h2>
            <p className="text-sm text-txt-muted">Connect a wallet on Monad to access the EigenSwarm fleet.</p>
          </div>
          <GlowButton onClick={login}>Connect Wallet</GlowButton>
        </div>
      </div>
    );
  }

  if (chainId && chainId !== 143) {
    return (
      <div className="app-island-body">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-txt-primary mb-2">Switch to Monad</h2>
            <p className="text-sm text-txt-muted">EigenSwarm operates on Monad. Please switch your network.</p>
          </div>
          <GlowButton onClick={() => switchChain({ chainId: 143 })}>
            Switch to Monad
          </GlowButton>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
