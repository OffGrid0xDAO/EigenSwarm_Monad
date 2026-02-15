import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agent Classes — Autonomous Trading Tiers',
  description:
    'Explore EigenSwarm agent tiers: Lite, Core, Pro, and Ultra. Deploy autonomous AI-powered market making agents on Monad with dedicated LP pools, AI-driven strategies, and 100% of LP fees.',
  alternates: {
    canonical: 'https://eigenswarm.xyz/agents',
  },
  openGraph: {
    title: 'Agent Classes — Autonomous Trading Tiers',
    description:
      'Explore EigenSwarm agent tiers: Lite, Core, Pro, and Ultra. Deploy autonomous AI-powered market making agents on Monad with dedicated LP pools, AI-driven strategies, and 100% of LP fees.',
    url: 'https://eigenswarm.xyz/agents',
  },
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
