import type { Metadata } from 'next';
import { DM_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '@/styles/globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const SITE_URL = 'https://eigenswarm.xyz';
const SITE_NAME = 'EigenSwarm';
const TITLE = 'EigenSwarm — Autonomous Market Making Agents on Monad';
const DESCRIPTION =
  'Deploy autonomous AI agents that generate volume, manage spreads, and capture 100% of LP fees on nad.fun tokens. Protocol-grade market making infrastructure on Monad. Four agent tiers from Lite to Ultra with AI-driven trading strategies.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | EigenSwarm',
  },
  description: DESCRIPTION,
  keywords: [
    'EigenSwarm',
    'autonomous market making',
    'AI trading agents',
    'Monad',
    'nad.fun',
    'LP fees',
    'liquidity provider',
    'DeFi automation',
    'market making bot',
    'crypto trading bot',
    'autonomous agents',
    'volume generation',
    'spread management',
    'protocol-grade market making',
    'AI market maker',
    'Monad DeFi',
    'nad.fun market making',
    'token liquidity',
    'autonomous trading',
    'DeFi agents',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/social.png`,
        width: 1200,
        height: 630,
        alt: 'EigenSwarm — Autonomous Market Making Agents on Monad',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    creator: '@eigenswarm',
    site: '@eigenswarm',
    images: [`${SITE_URL}/social.png`],
  },
  manifest: '/manifest.json',
  category: 'DeFi',
  other: {
    'application-name': SITE_NAME,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Preconnect to critical third-party origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://auth.privy.io" />
        <link rel="dns-prefetch" href="https://relay.walletconnect.com" />
        <link rel="dns-prefetch" href="https://verify.walletconnect.com" />

        {/* JSON-LD Structured Data for AI discoverability & rich snippets */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': `${SITE_URL}/#organization`,
                  name: SITE_NAME,
                  url: SITE_URL,
                  logo: `${SITE_URL}/logos/eigenswarm-icon.svg`,
                  description: DESCRIPTION,
                  sameAs: [
                    'https://twitter.com/eigenswarm',
                    'https://github.com/eigenswarm',
                  ],
                },
                {
                  '@type': 'WebSite',
                  '@id': `${SITE_URL}/#website`,
                  url: SITE_URL,
                  name: SITE_NAME,
                  publisher: { '@id': `${SITE_URL}/#organization` },
                  description: DESCRIPTION,
                  dateModified: new Date().toISOString(),
                  potentialAction: {
                    '@type': 'SearchAction',
                    target: {
                      '@type': 'EntryPoint',
                      urlTemplate: `${SITE_URL}/app/eigen/{search_term_string}`,
                    },
                    'query-input': 'required name=search_term_string',
                  },
                },
                {
                  '@type': 'SoftwareApplication',
                  '@id': `${SITE_URL}/#application`,
                  name: SITE_NAME,
                  url: SITE_URL,
                  applicationCategory: 'FinanceApplication',
                  operatingSystem: 'Web',
                  description:
                    'Autonomous AI-powered market making agents for nad.fun tokens on Monad. Deploy agents that generate trading volume, manage bid-ask spreads, and capture 100% of LP fees. Four tiers: Lite, Core, Pro, Ultra — from $50 to $2000+ deposits with AI-driven strategies.',
                  offers: {
                    '@type': 'AggregateOffer',
                    lowPrice: '0',
                    highPrice: '2000',
                    priceCurrency: 'USD',
                    offerCount: 4,
                    offers: [
                      {
                        '@type': 'Offer',
                        name: 'Lite Agent',
                        description:
                          'Entry-level autonomous market making agent. $50 minimum deposit, 3% protocol fee, up to $500 daily volume.',
                        price: '0',
                        priceCurrency: 'USD',
                      },
                      {
                        '@type': 'Offer',
                        name: 'Core Agent',
                        description:
                          'Most popular autonomous market making agent. $200 minimum deposit, 5% protocol fee, up to $5K daily volume.',
                        price: '0',
                        priceCurrency: 'USD',
                      },
                      {
                        '@type': 'Offer',
                        name: 'Pro Agent',
                        description:
                          'Advanced autonomous market making agent with AI evaluation. $500 minimum deposit, 7% protocol fee, up to $25K daily volume.',
                        price: '0',
                        priceCurrency: 'USD',
                      },
                      {
                        '@type': 'Offer',
                        name: 'Ultra Agent',
                        description:
                          'Maximum-tier autonomous market making agent with full AI suite. $2000 minimum deposit, 10% protocol fee, up to $100K+ daily volume.',
                        price: '0',
                        priceCurrency: 'USD',
                      },
                    ],
                  },
                  featureList: [
                    'Autonomous AI-powered market making',
                    '100% of LP fees go to the user',
                    'Dedicated LP pool per token',
                    'AI-driven spread management',
                    'Volume generation on nad.fun',
                    'Multi-tier agent classes (Lite, Core, Pro, Ultra)',
                    'Real-time performance monitoring',
                    'Protocol-grade trading infrastructure on Monad',
                  ],
                },
                {
                  '@type': 'BreadcrumbList',
                  '@id': `${SITE_URL}/#breadcrumb`,
                  itemListElement: [
                    {
                      '@type': 'ListItem',
                      position: 1,
                      name: 'Home',
                      item: SITE_URL,
                    },
                    {
                      '@type': 'ListItem',
                      position: 2,
                      name: 'Agent Classes',
                      item: `${SITE_URL}/agents`,
                    },
                    {
                      '@type': 'ListItem',
                      position: 3,
                      name: 'Documentation',
                      item: `${SITE_URL}/docs`,
                    },
                  ],
                },
                {
                  '@type': 'FAQPage',
                  '@id': `${SITE_URL}/#faq`,
                  dateModified: new Date().toISOString(),
                  mainEntity: [
                    {
                      '@type': 'Question',
                      name: 'What is EigenSwarm?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'EigenSwarm is an autonomous market making platform on Monad that deploys AI-powered trading agents (called Eigens) for nad.fun tokens. Each agent manages a dedicated LP pool, generating trading volume, managing spreads, and capturing 100% of LP fees for the user.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How does EigenSwarm market making work?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'You deploy an Eigen (autonomous agent) that creates a dedicated liquidity pool for your token. The agent autonomously executes trades to generate volume and manage spreads. All LP fees from every trade flow directly to you — not split with infrastructure providers. The protocol only charges a fee on positive P&L.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'What are the EigenSwarm agent tiers?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'EigenSwarm offers four agent tiers: Lite ($50 min deposit, $500/day volume, 3% fee), Core ($200 min deposit, $5K/day volume, 5% fee), Pro ($500 min deposit, $25K/day volume, 7% fee), and Ultra ($2000 min deposit, $100K+/day volume, 10% fee). Higher tiers include AI-driven strategies and evaluation.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'What blockchain does EigenSwarm run on?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'EigenSwarm runs on Monad, a high-performance EVM-compatible blockchain. It integrates with nad.fun, the leading token launchpad on Monad, to provide automated market making for newly launched tokens.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How is EigenSwarm different from other market making bots?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Unlike traditional market making bots, EigenSwarm deploys a dedicated LP pool for each token where 100% of fees go to the user. On platforms like nad.fun, fees are split 40/40/20 between creator, platform, and protocol. EigenSwarm gives you all of it. The agents are also AI-powered with autonomous decision making.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How do I deploy an Eigen agent?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Connect your wallet at eigenswarm.xyz, choose an existing nad.fun token or launch a new one, select an agent tier (Lite, Core, Pro, or Ultra), and deposit the minimum required funds. Your Eigen starts market making immediately — no manual configuration needed.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'What chains does EigenSwarm support?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'EigenSwarm is currently live on Monad, a high-performance EVM-compatible Layer 1 blockchain. It integrates with nad.fun, the leading token launchpad on Monad. Support for additional chains is planned for the future.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'What is ERC-8004 and how does EigenSwarm use it?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'ERC-8004 is a token standard for agent-managed liquidity pools with standardized interfaces. EigenSwarm leverages ERC-8004 to define how autonomous Eigen agents interact with on-chain LP positions, enabling permissionless and composable market making.',
                      },
                    },
                    {
                      '@type': 'Question',
                      name: 'How do EigenSwarm fees work?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'EigenSwarm charges a protocol fee only on positive P&L (profit), not on principal or total volume. Fee rates vary by tier: 3% for Lite, 5% for Core, 7% for Pro, and 10% for Ultra. All LP fees from your dedicated pool go to you — the protocol fee is separate and only applies when your agent is profitable.',
                      },
                    },
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
