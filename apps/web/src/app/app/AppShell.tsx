'use client';

import { type ReactNode, useState, useEffect } from 'react';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { TopBar } from '@/components/layout/TopBar';
import { SwarmBackground } from '@/components/ui/SwarmBackground';

export function AppShell({ children }: { children: ReactNode }) {
  // Privy + Wagmi providers must only mount on the client.
  // Without this guard, SSR hydration can race with wagmi hooks in children,
  // causing WagmiProviderNotFoundError on production deploys.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="min-h-screen bg-[#131517]" />;
  }

  return (
    <WalletProvider>
      <div className="min-h-screen bg-[#131517] relative">
        <SwarmBackground />
        <TopBar />
        <main className="mx-3 sm:mx-5 md:mx-8 lg:mx-12 -mt-px relative z-[39]">
          {children}
        </main>
        {/* Bottom dark spacer */}
        <div className="h-8 md:h-12" />
      </div>
    </WalletProvider>
  );
}
