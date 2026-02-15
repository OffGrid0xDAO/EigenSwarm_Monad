'use client';

import { useState, useRef, useEffect } from 'react';

const CHAIN_META: Record<number, { logo: string; color: string }> = {
  143:  { logo: '/logos/monad.svg',  color: '#836EF9' },
  8453: { logo: '/logos/base-icon.svg', color: '#0052FF' },
};

interface Chain {
  readonly id: number;
  readonly name: string;
  readonly token: string;
}

interface ChainSelectorProps {
  chains: readonly Chain[];
  selectedId: number;
  onChange: (id: number) => void;
  disabled?: boolean;
}

export function ChainSelector({ chains, selectedId, onChange, disabled }: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = chains.find((c) => c.id === selectedId) ?? chains[0];
  const meta = CHAIN_META[selected.id];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-lg border border-border-subtle bg-bg-card hover:border-border-hover transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <img src={meta?.logo} alt={selected.name} width={20} height={20} className="rounded-full" />
        <span className="text-[12px] font-medium text-txt-primary">{selected.name}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={`text-txt-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border-subtle bg-bg-card shadow-lg overflow-hidden animate-[fadeIn_0.12s_ease-out]">
          {chains.map((chain) => {
            const m = CHAIN_META[chain.id];
            const isActive = chain.id === selectedId;
            return (
              <button
                key={chain.id}
                onClick={() => { onChange(chain.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-bg-elevated text-txt-primary'
                    : 'text-txt-muted hover:bg-bg-elevated/50 hover:text-txt-primary'
                }`}
              >
                <img src={m?.logo} alt={chain.name} width={18} height={18} className="rounded-full" />
                <span className="text-[12px] font-medium">{chain.name}</span>
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="ml-auto text-eigen-violet">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
