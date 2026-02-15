'use client';

import { useEffect, useState } from 'react';
import { GlowButton } from './GlowButton';

interface TxStatusProps {
  hash?: `0x${string}`;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: Error | null;
  onRetry?: () => void;
}

const TIMEOUT_MS = 30_000;

export function TxStatus({ hash, isPending, isConfirming, isSuccess, error, onRetry }: TxStatusProps) {
  const [timedOut, setTimedOut] = useState(false);

  // Timeout detection for confirming state
  useEffect(() => {
    if (!isConfirming) {
      setTimedOut(false);
      return;
    }

    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  if (!isPending && !isConfirming && !isSuccess && !error) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-4 space-y-2">
      {isPending && (
        <div className="flex items-center gap-2 text-sm text-txt-muted">
          <Spinner />
          <span>Waiting for wallet confirmation...</span>
        </div>
      )}

      {isConfirming && hash && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-txt-muted">
            <Spinner />
            <span>Confirming on Base...</span>
            <span className="text-xs text-txt-disabled ml-1">Usually ~2s</span>
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-eigen-violet hover:underline font-mono text-xs ml-auto"
            >
              View on BaseScan
            </a>
          </div>
          {timedOut && (
            <div className="flex items-center gap-2 text-xs text-status-warning-text">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="5.5" />
                <path d="M7 4.5v3M7 9v.5" />
              </svg>
              <span>Transaction is taking longer than expected. It may still confirm.</span>
            </div>
          )}
        </div>
      )}

      {isSuccess && hash && (
        <div className="flex items-center gap-2 text-sm text-status-success-text">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8l3 3 7-7" />
          </svg>
          <span>Transaction confirmed</span>
          <a
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-eigen-violet hover:underline font-mono text-xs ml-auto"
          >
            {hash.slice(0, 10)}...{hash.slice(-6)}
          </a>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-status-danger">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M6 6l4 4M10 6l-4 4" />
            </svg>
            <span className="break-all">{(error as Error).message?.split('\n')[0] || 'Transaction failed'}</span>
          </div>
          {onRetry && (
            <div className="flex justify-end">
              <GlowButton variant="ghost" size="sm" onClick={onRetry}>
                Retry
              </GlowButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-eigen-violet" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
