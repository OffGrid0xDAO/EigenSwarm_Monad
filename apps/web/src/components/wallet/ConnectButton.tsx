'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { truncateAddress } from '@eigenswarm/shared';

export function ConnectButton() {
  const { login, logout, ready, authenticated } = usePrivy();
  const { address } = useAccount();

  const isConnected = ready && authenticated && !!address;

  return (
    <button
      onClick={isConnected ? logout : login}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
        ${isConnected
          ? 'bg-bg-elevated border border-border-subtle text-txt-primary hover:border-border-hover'
          : 'bg-eigen-violet text-white hover:brightness-110'
        }
      `}
    >
      {isConnected ? (
        <>
          <span className="w-2 h-2 rounded-full bg-status-success" />
          <span className="font-mono text-xs">
            {truncateAddress(address || '')}
          </span>
          <span className="text-caption text-txt-disabled px-1.5 py-0.5 rounded bg-bg-hover font-mono">
            Base
          </span>
        </>
      ) : (
        'Connect Wallet'
      )}
    </button>
  );
}
