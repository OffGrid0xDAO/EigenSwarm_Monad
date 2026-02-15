'use client';

import { useState } from 'react';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { BundleLaunch } from './BundleLaunch';
import { BundleSellComponent } from './BundleSell';

const TABS = [
    { id: 'launch', label: 'Launch & Distribute' },
    { id: 'sell', label: 'Bundle Sell' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function BundlePage() {
    const [activeTab, setActiveTab] = useState<TabId>('launch');

    return (
        <AppPageShell
            label="Bundle"
            title="Bundle Tools"
            subtitle="Launch tokens on nad.fun with bundled buys, or sell tokens from multiple wallets in one transaction."
        >
            <div className="max-w-5xl mx-auto">
                {/* Tab switcher */}
                <div className="flex items-center justify-center gap-1 mb-8">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                px-5 py-2 rounded-xl text-sm font-medium transition-all
                ${activeTab === tab.id
                                    ? 'bg-eigen-violet text-white shadow-lg shadow-eigen-violet/20'
                                    : 'text-txt-muted hover:text-txt-primary hover:bg-bg-hover'
                                }
              `}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                {activeTab === 'launch' ? <BundleLaunch /> : <BundleSellComponent />}
            </div>
        </AppPageShell>
    );
}
