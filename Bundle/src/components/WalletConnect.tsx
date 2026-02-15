import { useState, useRef, useEffect } from 'react';
import { useWallet } from '../lib/wallet';
import { sepolia, monad } from '../lib/chains';

const shortAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export function WalletConnect() {
  const {
    address,
    chainId,
    balance,
    symbol,
    status,
    error,
    connect,
    disconnect,
    switchChain,
    isWrongChain,
  } = useWallet();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isConnected = status === 'connected' && address;

  useEffect(() => {
    if (!dropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [dropdownOpen]);

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setDropdownOpen(false);
    }
  };

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2 sm:gap-3" ref={dropdownRef}>
        {isWrongChain && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Wrong network →</span>
            <button
              type="button"
              onClick={() => switchChain(sepolia.id)}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              Sepolia
            </button>
            <button
              type="button"
              onClick={() => switchChain(monad.id)}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              Monad
            </button>
          </div>
        )}
        <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-[var(--border)]">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Balance</div>
            <div className="text-sm font-semibold text-white font-mono tabular-nums">
              {balance ? `${parseFloat(balance).toFixed(4)} ${symbol}` : '—'}
            </div>
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((o) => !o)}
            className="btn-secondary text-sm py-2 px-4 font-mono min-w-[120px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-input)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] transition-colors"
            title={address}
          >
            {shortAddress(address)}
          </button>
          {dropdownOpen && (
            <div
              className="absolute right-0 top-full mt-2 min-w-[200px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl py-2 z-50"
              role="menu"
            >
              <button
                type="button"
                onClick={copyAddress}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-white transition-colors"
                role="menuitem"
              >
                Copy address
              </button>
              <div className="border-t border-[var(--border)] my-2" />
              <div className="px-4 py-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Network</span>
              </div>
              <button
                type="button"
                onClick={() => { switchChain(sepolia.id); setDropdownOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--bg-input)] transition-colors ${chainId === sepolia.id ? 'text-white font-medium' : 'text-[var(--text-secondary)] hover:text-white'}`}
                role="menuitem"
              >
                {chainId === sepolia.id ? 'Sepolia ✓' : 'Sepolia'}
              </button>
              <button
                type="button"
                onClick={() => { switchChain(monad.id); setDropdownOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--bg-input)] transition-colors ${chainId === monad.id ? 'text-white font-medium' : 'text-[var(--text-secondary)] hover:text-white'}`}
                role="menuitem"
              >
                {chainId === monad.id ? 'Monad ✓' : 'Monad'}
              </button>
              <div className="border-t border-[var(--border)] my-2" />
              <button
                type="button"
                onClick={() => { disconnect(); setDropdownOpen(false); }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                role="menuitem"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p className="text-xs text-red-400 max-w-[220px] text-right" title={error}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={connect}
        disabled={status === 'connecting'}
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--accent)] text-white text-sm font-medium py-2.5 px-5 min-w-[140px] hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    </div>
  );
}
