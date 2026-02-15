'use client';

import { useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useAccount, useSwitchChain } from 'wagmi';
import { truncateAddress } from '@eigenswarm/shared';

const MONAD_CHAIN_ID = 143;

export function ConnectButton() {
  const { login, logout, ready, authenticated } = usePrivy();
  const { address, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { wallets } = useWallets();

  const isConnected = ready && authenticated && !!address;
  const isWrongChain = isConnected && chain?.id !== MONAD_CHAIN_ID;

  // Auto-switch to Monad when wallet connects on wrong chain
  useEffect(() => {
    if (isWrongChain && switchChain) {
      switchChain({ chainId: MONAD_CHAIN_ID });
    }
  }, [isConnected, isWrongChain, switchChain]);

  const handleClick = () => {
    if (!isConnected) {
      login();
    } else if (isWrongChain) {
      switchChain?.({ chainId: MONAD_CHAIN_ID });
    } else {
      logout();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
        ${isWrongChain
          ? 'bg-amber-600 text-white hover:brightness-110'
          : isConnected
            ? 'bg-bg-elevated border border-border-subtle text-txt-primary hover:border-border-hover'
            : 'bg-eigen-violet text-white hover:brightness-110'
        }
      `}
    >
      {isWrongChain ? (
        'Switch to Monad'
      ) : isConnected ? (
        <>
          <span className="w-2 h-2 rounded-full bg-status-success" />
          <span className="font-mono text-xs">
            {truncateAddress(address || '')}
          </span>
          <span className="text-caption text-txt-disabled px-1.5 py-0.5 rounded bg-bg-hover font-mono">
            Monad
          </span>
        </>
      ) : (
        'Connect Wallet'
      )}
    </button>
  );
}
