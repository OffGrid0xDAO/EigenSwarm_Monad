'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { LandingNav } from '@/components/layout/LandingNav';
import { Footer } from '@/components/layout/Footer';

/* ── Types ─────────────────────────────────────────────────────────── */

interface SectionDef {
  id: string;
  label: string;
  children?: { id: string; label: string }[];
}

/* ── Sidebar navigation structure ──────────────────────────────────── */

const sections: SectionDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    children: [
      { id: 'what-is-eigenswarm', label: 'What Is EigenSwarm' },
      { id: 'key-concepts', label: 'Key Concepts' },
      { id: 'architecture', label: 'Architecture' },
    ],
  },
  {
    id: 'getting-started',
    label: 'Getting Started',
    children: [
      { id: 'connect-wallet', label: 'Connect Wallet' },
      { id: 'deploy-on-token', label: 'Deploy on Existing Token' },
      { id: 'launch-new-token', label: 'Launch New Token + Eigen' },
    ],
  },
  {
    id: 'agent-classes',
    label: 'Agent Classes',
    children: [
      { id: 'sentinel', label: 'Lite' },
      { id: 'operator', label: 'Core' },
      { id: 'architect', label: 'Pro' },
      { id: 'sovereign', label: 'Ultra' },
    ],
  },
  {
    id: 'protocol-mechanics',
    label: 'Protocol Mechanics',
    children: [
      { id: 'eigenvault', label: 'EigenVault Contract' },
      { id: 'deposit-withdraw', label: 'Deposits & Withdrawals' },
      { id: 'trade-execution', label: 'Trade Execution' },
      { id: 'fee-model', label: 'Fee Model' },
    ],
  },
  {
    id: 'parameters',
    label: 'Configuration',
    children: [
      { id: 'execution-params', label: 'Execution Parameters' },
      { id: 'risk-params', label: 'Risk Parameters' },
      { id: 'wallet-distribution', label: 'Wallet Distribution' },
    ],
  },
  {
    id: 'fleet-dashboard',
    label: 'Fleet Dashboard',
    children: [
      { id: 'portfolio-overview', label: 'Portfolio Overview' },
      { id: 'eigen-detail', label: 'Eigen Detail View' },
      { id: 'eigen-controls', label: 'Controls & Actions' },
    ],
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    children: [
      { id: 'api-overview', label: 'Overview' },
      { id: 'pricing-endpoint', label: 'Pricing' },
      { id: 'buy-volume', label: 'Buy Volume (x402)' },
      { id: 'monitor-eigen', label: 'Monitor Eigen' },
      { id: 'x402-flow', label: 'x402 Payment Flow' },
    ],
  },
  {
    id: 'sdk',
    label: 'SDK Reference',
    children: [
      { id: 'sdk-install', label: 'Installation' },
      { id: 'sdk-quickstart', label: 'Quick Start' },
      { id: 'sdk-types', label: 'Types' },
      { id: 'sdk-utilities', label: 'Utilities' },
    ],
  },
  {
    id: 'contracts',
    label: 'Smart Contracts',
    children: [
      { id: 'contract-addresses', label: 'Addresses' },
      { id: 'eigenvault-abi', label: 'EigenVault ABI' },
      { id: 'security', label: 'Security Model' },
    ],
  },
  {
    id: 'faq',
    label: 'FAQ',
  },
];

/* ── Scroll spy hook ───────────────────────────────────────────────── */

function useActiveSection() {
  const [active, setActive] = useState('overview');

  useEffect(() => {
    const headings = document.querySelectorAll('[data-section]');
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.getAttribute('data-section') || 'overview');
            break;
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, []);

  return active;
}

/* ── Reusable components ───────────────────────────────────────────── */

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border-subtle font-mono text-[0.8125rem] text-eigen-violet">
      {children}
    </code>
  );
}

function CodeBlock({ children, title }: { children: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl border border-border-subtle overflow-hidden my-5">
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-bg-alt border-b border-border-subtle">
          <span className="font-mono text-xs text-txt-muted">{title}</span>
          <button onClick={copy} className="text-xs text-txt-muted hover:text-txt-primary transition-colors">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {!title && (
        <div className="flex justify-end px-4 pt-2 bg-code-bg">
          <button onClick={copy} className="text-xs text-txt-muted hover:text-txt-primary transition-colors">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="px-4 py-4 bg-code-bg overflow-x-auto">
        <code className="font-mono text-[0.8125rem] leading-relaxed text-txt-primary">{children.trim()}</code>
      </pre>
    </div>
  );
}

function SectionHeading({ id, children, level = 2 }: { id: string; children: ReactNode; level?: 2 | 3 }) {
  const Tag = level === 2 ? 'h2' : 'h3';
  const cls = level === 2
    ? 'text-2xl font-bold text-txt-primary mt-16 mb-4 scroll-mt-24'
    : 'text-lg font-semibold text-txt-primary mt-10 mb-3 scroll-mt-24';
  return <Tag id={id} data-section={id} className={cls}>{children}</Tag>;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <p className="text-body text-txt-secondary leading-relaxed mb-4">{children}</p>;
}

function Callout({ type = 'info', children }: { type?: 'info' | 'warning'; children: ReactNode }) {
  const styles = {
    info: 'border-eigen-violet/30 bg-eigen-violet-wash/40',
    warning: 'border-status-warning/30 bg-orange-50',
  };
  const icons = {
    info: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-eigen-violet flex-shrink-0 mt-0.5">
        <circle cx="8" cy="8" r="7" /><path d="M8 7v4M8 5.5v-.01" />
      </svg>
    ),
    warning: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-status-warning flex-shrink-0 mt-0.5">
        <path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" /><path d="M8 6.5v3M8 11v.01" />
      </svg>
    ),
  };
  return (
    <div className={`flex gap-3 rounded-xl border p-4 my-5 ${styles[type]}`}>
      {icons[type]}
      <div className="text-sm text-txt-secondary leading-relaxed">{children}</div>
    </div>
  );
}

function SpecTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle my-5">
      <table className="w-full">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={k} className={i % 2 === 0 ? 'bg-bg-card' : 'bg-bg-elevated'}>
              <td className="px-4 py-2.5 text-sm font-medium text-txt-primary whitespace-nowrap border-r border-border-subtle w-48">{k}</td>
              <td className="px-4 py-2.5 text-sm text-txt-secondary font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassCard({ name, badge, volume, deposit, fee, trades, orderSize, spread, description }: {
  name: string; badge: string; volume: string; deposit: string; fee: string;
  trades: string; orderSize: string; spread: string; description: string;
}) {
  const badgeColors: Record<string, string> = {
    sentinel: 'bg-blue-100 text-blue-700',
    operator: 'bg-green-100 text-green-700',
    architect: 'bg-purple-100 text-purple-700',
    sovereign: 'bg-amber-100 text-amber-700',
  };
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColors[badge]}`}>{name}</span>
        <span className="text-xs text-txt-muted">{fee} protocol fee</span>
      </div>
      <p className="text-sm text-txt-secondary">{description}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 pt-2 border-t border-border-subtle">
        <Stat label="Volume" value={volume} />
        <Stat label="Min Deposit" value={deposit} />
        <Stat label="Trades / hr" value={trades} />
        <Stat label="Order Size" value={orderSize} />
        <Stat label="Spread" value={spread} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-txt-muted">{label}</span>
      <span className="font-mono text-txt-primary">{value}</span>
    </div>
  );
}

/* ── Sidebar ───────────────────────────────────────────────────────── */

function Sidebar({ active, onNavigate }: { active: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {sections.map((section) => {
        const isGroupActive = section.id === active || section.children?.some((c) => c.id === active);
        return (
          <div key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={onNavigate}
              className={`
                block px-3 py-1.5 rounded-lg text-sm transition-colors
                ${isGroupActive ? 'text-eigen-violet font-medium' : 'text-txt-muted hover:text-txt-primary'}
              `}
            >
              {section.label}
            </a>
            {section.children && isGroupActive && (
              <div className="ml-3 pl-3 border-l border-border-subtle space-y-0.5 mt-0.5 mb-1.5">
                {section.children.map((child) => (
                  <a
                    key={child.id}
                    href={`#${child.id}`}
                    onClick={onNavigate}
                    className={`
                      block px-2 py-1 rounded text-[0.8125rem] transition-colors
                      ${child.id === active ? 'text-eigen-violet font-medium' : 'text-txt-muted hover:text-txt-primary'}
                    `}
                  >
                    {child.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */

export default function DocsPage() {
  const active = useActiveSection();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <LandingNav />

      <div className="min-h-screen bg-bg-void pt-24 pb-20">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12 xl:grid-cols-[240px_1fr] xl:gap-16">

            {/* Mobile nav toggle */}
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden flex items-center gap-2 text-sm text-txt-muted mb-6 px-3 py-2 rounded-lg bg-bg-card border border-border-subtle"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="14" y2="12" />
              </svg>
              Documentation Menu
            </button>

            {/* Mobile nav overlay */}
            {mobileNavOpen && (
              <div className="lg:hidden mb-6 p-4 rounded-xl bg-bg-card border border-border-subtle">
                <Sidebar active={active} onNavigate={() => setMobileNavOpen(false)} />
              </div>
            )}

            {/* Desktop sidebar */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 max-h-[calc(100vh-120px)] overflow-y-auto pr-2">
                <p className="text-label uppercase text-txt-muted tracking-widest mb-4 px-3">Documentation</p>
                <Sidebar active={active} />
              </div>
            </aside>

            {/* Content */}
            <main className="min-w-0 max-w-[720px]">
              {/* ═══ OVERVIEW ═══ */}
              <div id="overview" data-section="overview" className="scroll-mt-24">
                <p className="text-label uppercase text-eigen-violet tracking-widest mb-3">Documentation</p>
                <h1 className="font-display text-display-lg mb-4">EigenSwarm Protocol</h1>
                <p className="text-body-lg text-txt-secondary mb-8 leading-relaxed">
                  Autonomous market making infrastructure for nad.fun tokens on Monad.
                  Deploy intelligent agents that generate volume, manage spreads, and capture LP fees.
                </p>
              </div>

              <SectionHeading id="what-is-eigenswarm" level={3}>What Is EigenSwarm</SectionHeading>
              <Paragraph>
                EigenSwarm is a protocol for deploying autonomous market making agents — called <strong>Eigens</strong> — on nad.fun tokens.
                Each Eigen operates independently: it buys, sells, rebalances, and takes profit based on configurable parameters,
                generating organic trading volume while capturing LP interface fees.
              </Paragraph>
              <Paragraph>
                The protocol runs on <strong>Monad</strong> (chain ID 10143) and integrates with <strong>Uniswap V3/V4</strong> for trade execution,
                <strong> nad.fun</strong> for token deployment, and the <strong>x402</strong> machine-to-machine payment protocol for programmatic access.
              </Paragraph>

              <SectionHeading id="key-concepts" level={3}>Key Concepts</SectionHeading>
              <div className="space-y-3 my-5">
                <div className="rounded-lg bg-bg-card border border-border-subtle p-4">
                  <p className="text-sm font-medium text-txt-primary mb-1">Eigen</p>
                  <p className="text-sm text-txt-secondary">An autonomous market making agent. Each Eigen is bound to a single token, funded by ETH deposited into the EigenVault, and executes trades according to its class and parameters.</p>
                </div>
                <div className="rounded-lg bg-bg-card border border-border-subtle p-4">
                  <p className="text-sm font-medium text-txt-primary mb-1">EigenVault</p>
                  <p className="text-sm text-txt-secondary">The on-chain smart contract that holds all deposited ETH. Non-custodial — you retain full control and can withdraw at any time. Each Eigen can only access its own allocated funds.</p>
                </div>
                <div className="rounded-lg bg-bg-card border border-border-subtle p-4">
                  <p className="text-sm font-medium text-txt-primary mb-1">Keeper</p>
                  <p className="text-sm text-txt-secondary">The off-chain execution engine that monitors market conditions and submits trades on behalf of Eigens. Keepers can only execute swaps using funds within the Eigen&apos;s balance — they cannot withdraw or redirect funds.</p>
                </div>
                <div className="rounded-lg bg-bg-card border border-border-subtle p-4">
                  <p className="text-sm font-medium text-txt-primary mb-1">Agent Class</p>
                  <p className="text-sm text-txt-secondary">One of four tiers (Lite, Core, Pro, Ultra) that determines an Eigen&apos;s volume capacity, minimum deposit, trade frequency, and protocol fee rate.</p>
                </div>
              </div>

              <SectionHeading id="architecture" level={3}>Architecture</SectionHeading>
              <Paragraph>
                The protocol has three layers:
              </Paragraph>
              <ol className="list-decimal list-inside space-y-2 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Smart Contract Layer</strong> — On Monad, trades flow through nad.fun&apos;s bonding curve with vaultless sub-wallet execution. EigenVault on Base is available but currently disabled.</li>
                <li><strong className="text-txt-primary">Keeper Layer</strong> — Off-chain agents that read market data, compute optimal trades, and submit transactions through the EigenVault&apos;s <Code>executeBuy</Code> and <Code>returnEth</Code> functions.</li>
                <li><strong className="text-txt-primary">Interface Layer</strong> — The web dashboard for deploying, monitoring, and controlling Eigens, plus the API/SDK for programmatic access.</li>
              </ol>

              {/* ═══ GETTING STARTED ═══ */}
              <SectionHeading id="getting-started">Getting Started</SectionHeading>

              <SectionHeading id="connect-wallet" level={3}>Connect Wallet</SectionHeading>
              <Paragraph>
                EigenSwarm requires a wallet connected to <strong>Monad</strong> (chain ID 10143). The app supports any EVM wallet through ConnectKit — MetaMask, Coinbase Wallet, WalletConnect, and others. If you&apos;re on the wrong chain, the app will prompt you to switch.
              </Paragraph>

              <SectionHeading id="deploy-on-token" level={3}>Deploy on Existing Token</SectionHeading>
              <Paragraph>
                Navigate to <strong>Add Agent</strong> in the app to attach an Eigen to any existing nad.fun token on Monad. The process follows four steps:
              </Paragraph>
              <ol className="list-decimal list-inside space-y-3 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Select Token</strong> — Enter the token&apos;s contract address on Monad. The app verifies it&apos;s a valid ERC-20 with an active Uniswap pool.</li>
                <li><strong className="text-txt-primary">Choose Agent Class</strong> — Pick from Lite, Core, Pro, or Ultra based on your volume and risk goals.</li>
                <li><strong className="text-txt-primary">Configure Parameters</strong> — Set volume target, trade frequency, order sizes, spread width, risk limits, and wallet count.</li>
                <li><strong className="text-txt-primary">Fund & Deploy</strong> — Deposit MON (at or above the class minimum) and confirm the on-chain transaction. Your Eigen begins trading within seconds.</li>
              </ol>

              <SectionHeading id="launch-new-token" level={3}>Launch New Token + Eigen</SectionHeading>
              <Paragraph>
                Navigate to <strong>Launch</strong> to deploy a new nad.fun token and attach a market making agent in one flow. This has three phases:
              </Paragraph>
              <ol className="list-decimal list-inside space-y-3 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Deploy Token</strong> — Provide a name, symbol, image URL, and description (280 chars max). Advanced options include fee type (static 1% or dynamic 0.25–5%), MEV protection (2-block snipe delay), and optional dev buy.</li>
                <li><strong className="text-txt-primary">Create Eigen On-Chain</strong> — The EigenVault entry is created and funded with your ETH deposit.</li>
                <li><strong className="text-txt-primary">Register Configuration</strong> — Agent parameters are submitted to the keeper network and execution begins.</li>
              </ol>
              <Callout>
                The fee split on launched tokens is <strong>40% Creator / 40% EigenSwarm / 20% nad.fun</strong>. This applies to interface fees collected on every swap through the nad.fun interface.
              </Callout>

              {/* ═══ AGENT CLASSES ═══ */}
              <SectionHeading id="agent-classes">Agent Classes</SectionHeading>
              <Paragraph>
                Four tiers of autonomous intelligence, each tuned for different volume targets and risk profiles. All classes support the full parameter set — they differ in capacity, minimum deposit, and protocol fee rate.
              </Paragraph>

              <SectionHeading id="sentinel" level={3}>Lite</SectionHeading>
              <ClassCard
                name="Lite" badge="sentinel"
                volume="0.5–2 ETH/day" deposit="0.05 ETH" fee="3%"
                trades="2–5" orderSize="0.001–0.01 ETH" spread="1–3%"
                description="Low-intensity. Baseline market activity with tight risk controls."
              />

              <SectionHeading id="operator" level={3}>Core</SectionHeading>
              <ClassCard
                name="Core" badge="operator"
                volume="2–10 ETH/day" deposit="0.2 ETH" fee="5%"
                trades="5–20" orderSize="0.005–0.05 ETH" spread="0.5–2%"
                description="Steady volume. DexScreener visibility, organic accumulation. Most popular."
              />

              <SectionHeading id="architect" level={3}>Pro</SectionHeading>
              <ClassCard
                name="Pro" badge="architect"
                volume="10–50 ETH/day" deposit="1 ETH" fee="7%"
                trades="20–60" orderSize="0.01–0.1 ETH" spread="0.3–1.5%"
                description="High-throughput. Multi-wallet distribution, institutional-grade volume."
              />

              <SectionHeading id="sovereign" level={3}>Ultra</SectionHeading>
              <ClassCard
                name="Ultra" badge="sovereign"
                volume="50–200+ ETH/day" deposit="5 ETH" fee="10%"
                trades="60–200" orderSize="0.05–0.5 ETH" spread="0.2–1%"
                description="Maximum capacity. Whale operations, aggressive campaigns."
              />

              {/* ═══ PROTOCOL MECHANICS ═══ */}
              <SectionHeading id="protocol-mechanics">Protocol Mechanics</SectionHeading>

              <SectionHeading id="eigenvault" level={3}>EigenVault Contract</SectionHeading>
              <Paragraph>
                The EigenVault is the core smart contract that holds all user deposits. It is <strong>non-custodial</strong> — you always retain withdrawal rights regardless of Eigen status or keeper availability.
              </Paragraph>
              <Paragraph>
                Each Eigen has an isolated balance tracked by a <Code>bytes32</Code> identifier. The contract enforces that:
              </Paragraph>
              <ul className="list-disc list-inside space-y-1.5 text-sm text-txt-secondary mb-6 pl-2">
                <li>Only the Eigen owner can deposit to or withdraw from their Eigen</li>
                <li>Only the authorized keeper can execute trades</li>
                <li>Trade execution can only pull from the Eigen&apos;s own balance</li>
                <li>All withdrawals use ReentrancyGuard protection</li>
                <li>Protocol fee collection requires owner authorization</li>
              </ul>

              <SectionHeading id="deposit-withdraw" level={3}>Deposits & Withdrawals</SectionHeading>
              <Paragraph>
                <strong>Deposits:</strong> Send MON when calling <Code>createEigen(eigenId)</Code> for initial funding, or <Code>deposit(eigenId)</Code> to add more later. Funds are immediately available for the keeper to execute trades.
              </Paragraph>
              <Paragraph>
                <strong>Withdrawals:</strong> Call <Code>withdraw(eigenId, amount)</Code> to pull ETH back to your wallet at any time. Partial withdrawals are supported. If you want to close the agent entirely, use <Code>terminate(eigenId)</Code> — this sells any remaining token inventory and returns all ETH.
              </Paragraph>
              <Callout type="warning">
                Termination is irreversible. The Eigen will sell all held tokens at market price and return the proceeds plus remaining ETH to your wallet. This may result in slippage on large positions.
              </Callout>

              <SectionHeading id="trade-execution" level={3}>Trade Execution</SectionHeading>
              <Paragraph>
                The keeper network monitors market conditions and executes trades through the EigenVault:
              </Paragraph>
              <ol className="list-decimal list-inside space-y-2 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Buy execution</strong> — Keeper calls <Code>executeBuy(eigenId, router, swapData, ethAmount)</Code>, pulling ETH from the Eigen&apos;s balance and routing it through the Uniswap swap router.</li>
                <li><strong className="text-txt-primary">Sell execution</strong> — Keeper sells tokens on Uniswap and returns ETH proceeds via <Code>returnEth(eigenId)</Code>.</li>
                <li><strong className="text-txt-primary">Rebalancing</strong> — When inventory drifts past the <Code>rebalanceThreshold</Code>, the keeper adjusts the ETH/token ratio.</li>
                <li><strong className="text-txt-primary">Profit-taking</strong> — When unrealized gains exceed the <Code>profitTarget</Code>, the keeper sells a portion to lock in returns.</li>
              </ol>
              <Paragraph>
                Trades are distributed across multiple wallets (configurable, 1–10) to create natural-looking market activity and reduce single-point execution risk.
              </Paragraph>

              <SectionHeading id="fee-model" level={3}>Fee Model</SectionHeading>
              <Paragraph>
                EigenSwarm has two revenue streams:
              </Paragraph>
              <div className="space-y-4 my-5">
                <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
                  <p className="text-sm font-semibold text-txt-primary mb-2">Interface Fees (Passive)</p>
                  <p className="text-sm text-txt-secondary mb-3">
                    Collected on every swap through the nad.fun interface. These are permanent and require no keeper action.
                  </p>
                  <SpecTable rows={[
                    ['Token Creator', '40%'],
                    ['EigenSwarm Protocol', '40%'],
                    ['nad.fun Infrastructure', '20%'],
                  ]} />
                </div>
                <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
                  <p className="text-sm font-semibold text-txt-primary mb-2">Protocol Fees (Performance)</p>
                  <p className="text-sm text-txt-secondary mb-3">
                    Charged <strong>only on positive realized P&L</strong>. If the Eigen doesn&apos;t generate profit, no protocol fee is collected.
                  </p>
                  <SpecTable rows={[
                    ['Lite', '3% of realized P&L'],
                    ['Core', '5% of realized P&L'],
                    ['Pro', '7% of realized P&L'],
                    ['Ultra', '10% of realized P&L'],
                  ]} />
                </div>
              </div>

              {/* ═══ PARAMETERS ═══ */}
              <SectionHeading id="parameters">Configuration</SectionHeading>

              <SectionHeading id="execution-params" level={3}>Execution Parameters</SectionHeading>
              <SpecTable rows={[
                ['volumeTarget', 'Target ETH volume per day. The keeper adjusts trade frequency and size to meet this target.'],
                ['tradeFrequency', 'Maximum trades per hour. Higher values produce more granular execution.'],
                ['orderSizeMin', 'Minimum ETH per trade. Sets the floor for individual swap amounts.'],
                ['orderSizeMax', 'Maximum ETH per trade. Caps individual swap size to control slippage.'],
                ['spreadWidth', 'Target bid-ask spread as a percentage. Tighter spreads capture more fees but increase inventory risk.'],
              ]} />

              <SectionHeading id="risk-params" level={3}>Risk Parameters</SectionHeading>
              <SpecTable rows={[
                ['profitTarget', 'Percentage gain that triggers automatic profit-taking. E.g., 15% means the keeper sells when unrealized gains reach 15%.'],
                ['stopLoss', 'Percentage loss that triggers automatic suspension. The Eigen pauses execution and holds current inventory.'],
                ['rebalanceThreshold', 'Inventory drift ratio (0–1) that triggers rebalancing. 0.5 means rebalance when ETH/token split drifts beyond 50/50.'],
              ]} />

              <SectionHeading id="wallet-distribution" level={3}>Wallet Distribution</SectionHeading>
              <Paragraph>
                The <Code>walletCount</Code> parameter (1–10) controls how many execution wallets the keeper uses for your Eigen.
                Multi-wallet execution distributes trades across separate addresses, producing more organic-looking market activity
                and reducing the concentration of trade flow from a single address.
              </Paragraph>

              {/* ═══ FLEET DASHBOARD ═══ */}
              <SectionHeading id="fleet-dashboard">Fleet Dashboard</SectionHeading>

              <SectionHeading id="portfolio-overview" level={3}>Portfolio Overview</SectionHeading>
              <Paragraph>
                The Fleet page (<Code>/app</Code>) shows all your active Eigens with aggregate portfolio statistics:
              </Paragraph>
              <SpecTable rows={[
                ['Unrealized P&L', 'Total open position gains/losses across all Eigens'],
                ['Realized P&L', 'Cashed-out gains/losses from completed trades'],
                ['Volume Generated', 'Total ETH volume executed by all active Eigens'],
                ['LP Fees Earned', 'Total interface fees collected'],
                ['Active Eigens', 'Count of running agents'],
                ['ETH Deployed', 'Total ETH allocated to active Eigens'],
              ]} />

              <SectionHeading id="eigen-detail" level={3}>Eigen Detail View</SectionHeading>
              <Paragraph>
                Click any Eigen to see its dedicated dashboard with price charts (1h/4h/1d/7d/30d ranges),
                cumulative P&L history, volume-by-hour distribution, trade distribution breakdown, full performance metrics,
                inventory composition bar, live activity feed, and parameter configuration.
              </Paragraph>
              <Paragraph>
                Key metrics tracked per Eigen: entry price, current price, unrealized and realized P&L, net return
                (realized + unrealized + LP fees - protocol fees), win rate, total volume, trade count, LP fees earned/claimed,
                protocol fee accrued, and remaining ETH balance.
              </Paragraph>

              <SectionHeading id="eigen-controls" level={3}>Controls & Actions</SectionHeading>
              <SpecTable rows={[
                ['Suspend / Resume', 'Pause or restart autonomous trading without withdrawing funds.'],
                ['Adjust', 'Modify agent parameters (volume target, risk limits, etc.) while the Eigen is active.'],
                ['Terminate', 'Permanently close the Eigen. Sells all token inventory and returns ETH to your wallet.'],
                ['Withdraw', 'Pull available ETH balance back to your wallet.'],
                ['Claim LP Fees', 'Claim earned interface fees to your wallet.'],
                ['Upgrade Class', 'Promote the Eigen to a higher tier for increased capacity.'],
              ]} />

              {/* ═══ API REFERENCE ═══ */}
              <SectionHeading id="api-reference">API Reference</SectionHeading>

              <SectionHeading id="api-overview" level={3}>Overview</SectionHeading>
              <Paragraph>
                The EigenSwarm API allows AI agents and bots to programmatically purchase trading volume on any nad.fun token.
                Payments use the <strong>x402</strong> protocol — a machine-to-machine payment standard where the server responds with
                HTTP 402 and payment instructions, the client pays on-chain, then retries with proof.
              </Paragraph>
              <CodeBlock title="Base URL">{`https://api.eigenswarm.xyz`}</CodeBlock>

              <SectionHeading id="pricing-endpoint" level={3}>Pricing</SectionHeading>
              <CodeBlock title="GET /api/pricing">
                {`GET /api/pricing

Response:
{
  "packages": [
    { "id": "starter",  "ethVolume": 1,   "priceUSDC": 10,  "duration": "24h" },
    { "id": "growth",   "ethVolume": 5,   "priceUSDC": 40,  "duration": "24h" },
    { "id": "pro",      "ethVolume": 20,  "priceUSDC": 120, "duration": "24h" },
    { "id": "whale",    "ethVolume": 100, "priceUSDC": 500, "duration": "24h" }
  ],
  "paymentToken": "MON",
  "paymentChain": 10143,
  "paymentAddress": "0x..."
}`}
              </CodeBlock>

              <SectionHeading id="buy-volume" level={3}>Buy Volume (x402)</SectionHeading>
              <CodeBlock title="POST /api/agents/buy-volume">
                {`POST /api/agents/buy-volume
Content-Type: application/json

{
  "tokenAddress": "0x...",
  "packageId": "growth",
  "tokenSymbol": "TOKEN",
  "tokenName": "My Token"
}

// Success Response (201):
{
  "success": true,
  "eigenId": "0x...",
  "package": "growth",
  "ethVolume": 5,
  "duration": "24h",
  "status": "active",
  "expiresAt": "2025-01-02T00:00:00Z"
}`}
              </CodeBlock>
              <Callout>
                This endpoint returns HTTP <strong>402 Payment Required</strong> on first call. See the x402 Payment Flow section below for the complete handshake.
              </Callout>

              <SectionHeading id="monitor-eigen" level={3}>Monitor Eigen</SectionHeading>
              <CodeBlock title="GET /api/eigens/:eigenId">
                {`// Fetch eigen status and metrics
GET /api/eigens/{eigenId}

// Fetch trade history
GET /api/eigens/{eigenId}/trades

// API health check
GET /api/health

// Protocol-wide statistics
GET /api/stats`}
              </CodeBlock>

              <SectionHeading id="x402-flow" level={3}>x402 Payment Flow</SectionHeading>
              <Paragraph>
                The x402 protocol enables machine-to-machine payments without API keys or accounts. Here&apos;s the complete flow:
              </Paragraph>
              <ol className="list-decimal list-inside space-y-3 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Request</strong> — POST to <Code>/api/agents/buy-volume</Code> with token address and package ID.</li>
                <li><strong className="text-txt-primary">402 Response</strong> — Server responds with <Code>X-PAYMENT-REQUIRED</Code> header containing: MON amount, recipient address, and token contract (MON on Monad).</li>
                <li><strong className="text-txt-primary">On-Chain Payment</strong> — Execute the MON transfer on Monad. Confirmation takes ~2 seconds.</li>
                <li><strong className="text-txt-primary">Retry with Proof</strong> — Resend the same POST request with <Code>X-PAYMENT</Code> header containing the transaction hash.</li>
                <li><strong className="text-txt-primary">Activation</strong> — Server verifies the payment, creates the Eigen, and returns 201 with the eigen ID and status.</li>
              </ol>

              <CodeBlock title="Agent skill manifest">
                {`# AI agents can discover EigenSwarm's API by fetching:
curl -s https://www.eigenswarm.xyz/skill.md`}
              </CodeBlock>

              {/* ═══ SDK REFERENCE ═══ */}
              <SectionHeading id="sdk">SDK Reference</SectionHeading>

              <SectionHeading id="sdk-install" level={3}>Installation</SectionHeading>
              <CodeBlock title="Terminal">{`npm install @eigenswarm/sdk viem`}</CodeBlock>

              <SectionHeading id="sdk-quickstart" level={3}>Quick Start</SectionHeading>
              <CodeBlock title="deploy-eigen.ts">
                {`import { EigenSwarm } from '@eigenswarm/sdk';

const swarm = new EigenSwarm({ wallet });

// Deploy on existing token
const eigen = await swarm.deploy({
  token: '0x...',
  class: 'operator',
  params: {
    volumeTarget: 5,
    tradeFrequency: 12,
    orderSizeMin: 0.005,
    orderSizeMax: 0.05,
    spreadWidth: 1,
    profitTarget: 15,
    stopLoss: 10,
    rebalanceThreshold: 0.5,
    walletCount: 3,
  },
  deposit: 0.5, // ETH
});

console.log(eigen.id);     // "ES-a1b2"
console.log(eigen.status);  // "active"`}
              </CodeBlock>

              <SectionHeading id="sdk-types" level={3}>Types</SectionHeading>
              <CodeBlock title="types.ts">
                {`type AgentClass = 'sentinel' | 'operator' | 'architect' | 'sovereign';
type EigenStatus = 'active' | 'suspended' | 'terminated';
type TradeType = 'buy' | 'sell' | 'rebalance' | 'profit_take' | 'fee_claim';

interface Eigen {
  id: string;                    // "ES-XXXX"
  ownerAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  poolAddress: string;
  class: AgentClass;
  status: EigenStatus;
  vaultEigenId: string;          // bytes32 on-chain ID

  // Parameters
  volumeTarget: number;
  tradeFrequency: number;
  orderSizeMin: number;
  orderSizeMax: number;
  spreadWidth: number;
  profitTarget: number;
  stopLoss: number;
  rebalanceThreshold: number;
  walletCount: number;

  // Balances
  ethDeposited: number;
  ethBalance: number;
  tokenBalance: number;

  // Metrics
  entryPrice: number;
  currentPrice: number;
  volumeGenerated: number;
  tradesExecuted: number;
  realizedPnl: number;
  unrealizedPnl: number;
  lpFeesEarned: number;
  lpFeesClaimed: number;
  protocolFeeAccrued: number;
  winRate: number;

  createdAt: string;
  terminatedAt: string | null;
  updatedAt: string;
}

interface Trade {
  id: number;
  eigenId: string;
  type: TradeType;
  ethAmount: number;
  tokenAmount: number;
  price: number;
  txHash: string;
  pnlImpact: number;
  gasCost: number;
  createdAt: string;
}`}
              </CodeBlock>

              <SectionHeading id="sdk-utilities" level={3}>Utilities</SectionHeading>
              <CodeBlock title="@eigenswarm/shared">
                {`import {
  truncateAddress,     // "0x1234...abcd"
  eigenIdToBytes32,    // ES-XXXX → keccak256 hash
  isValidEigenId,      // validates /^ES-[0-9a-f]{4}$/
  formatEth,           // format ETH values (4 decimals)
  formatUsd,           // format USD with Intl.NumberFormat
  formatPercent,       // "+12.5%" with sign
  formatCompact,       // 1.2M, 34.5K
  formatDuration,      // ms → "2d 5h"
  formatRuntime,       // ISO → time since
  formatTimestamp,     // ISO → HH:MM:SS
  pnlColor,           // value → 'positive' | 'negative' | 'neutral'
} from '@eigenswarm/shared';`}
              </CodeBlock>

              {/* ═══ SMART CONTRACTS ═══ */}
              <SectionHeading id="contracts">Smart Contracts</SectionHeading>

              <SectionHeading id="contract-addresses" level={3}>Addresses</SectionHeading>
              <Paragraph>Primary deployment on <strong>Monad</strong> (chain ID 143). Base contracts (chain ID 8453) are available but currently disabled.</Paragraph>
              <SpecTable rows={[
                ['WETH', '0x4200000000000000000000000000000000000006'],
                ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
                ['Uniswap V3 Router', '0x2626664c2603336E57B271c5C0b26F421741e481'],
                ['Uniswap V3 Factory', '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'],
                ['Uniswap V4 Router', '0x6ff5693b99212da76ad316178a184ab56d299b43'],
                ['Uniswap V4 Pool Mgr', '0x498581ff718922c3f8e6a244956af099b2652b2b'],
                ['Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3'],
              ]} />

              <p className="text-label uppercase text-txt-muted tracking-widest mt-6 mb-3">Token Factory Contracts (Base-only)</p>
              <SpecTable rows={[
                ['V4 (Current)', '0xE85A59c628F7d27878ACeB4bf3b35733630083a9'],
                ['V3', '0x2A787b2362021cC3eEa3C24C4748a6cD5B687382'],
                ['V3.0', '0x375C15db32D28cEcdcAB5C03Ab889bf15cbD2c5E'],
                ['V2', '0x732560fa1d1A76350b1A500155BA978031B53833'],
                ['V1', '0x9B84fcE5Dcd9a38d2D01d5D72373F6b6b067c3e1'],
              ]} />

              <SectionHeading id="eigenvault-abi" level={3}>EigenVault ABI</SectionHeading>
              <Paragraph>Core functions of the EigenVault contract:</Paragraph>
              <CodeBlock title="EigenVault.sol — Key Functions">
                {`// Create a new Eigen and deposit initial ETH
function createEigen(bytes32 eigenId) external payable

// Add more ETH to an existing Eigen
function deposit(bytes32 eigenId) external payable

// Withdraw ETH (partial or full)
function withdraw(bytes32 eigenId, uint256 amount) external

// Permanently close Eigen, sell inventory, return ETH
function terminate(bytes32 eigenId) external

// Pause / resume keeper execution
function suspend(bytes32 eigenId) external
function resume(bytes32 eigenId) external

// Keeper-only: execute a buy swap through Uniswap
function executeBuy(
  bytes32 eigenId,
  address router,
  bytes calldata swapData,
  uint256 ethAmount
) external

// Keeper-only: return ETH from sell proceeds
function returnEth(bytes32 eigenId) external payable

// Owner-only: collect protocol fees
function collectFee(bytes32 eigenId, uint256 amount) external

// View: query Eigen ownership, status, balance
function getEigenInfo(bytes32 eigenId) external view
  returns (address owner, bool active, uint256 balance)`}
              </CodeBlock>

              <SectionHeading id="security" level={3}>Security Model</SectionHeading>
              <ul className="list-disc list-inside space-y-2 text-sm text-txt-secondary mb-6 pl-2">
                <li><strong className="text-txt-primary">Non-custodial</strong> — Users always retain withdrawal rights. No admin function can freeze or redirect user funds.</li>
                <li><strong className="text-txt-primary">ReentrancyGuard</strong> — All withdrawal and termination functions use OpenZeppelin&apos;s ReentrancyGuard to prevent reentrancy attacks.</li>
                <li><strong className="text-txt-primary">Ownable</strong> — Admin functions (keeper management, fee collection) are restricted to the contract owner.</li>
                <li><strong className="text-txt-primary">Keeper isolation</strong> — The keeper can only execute swaps using funds within the Eigen&apos;s balance. It cannot withdraw, transfer, or access other Eigens&apos; funds.</li>
                <li><strong className="text-txt-primary">Balance isolation</strong> — Each Eigen has an independent balance. One Eigen&apos;s losses or compromised parameters cannot affect another.</li>
              </ul>

              {/* ═══ FAQ ═══ */}
              <SectionHeading id="faq">Frequently Asked Questions</SectionHeading>

              <div className="space-y-5 mt-6">
                <FaqItem q="What is an Eigen?">
                  An autonomous market making agent. It executes trades on your behalf — buying, selling, rebalancing, and taking profit based on configurable parameters — to generate volume and capture LP fees.
                </FaqItem>
                <FaqItem q="How does the fee model work?">
                  Two revenue streams: <strong>interface fees</strong> (40/40/20 split on every swap, permanent and passive) and <strong>protocol fees</strong> (3–10% of realized positive P&L only, scaled by agent class). You never pay protocol fees on losses.
                </FaqItem>
                <FaqItem q="Is my ETH safe?">
                  Yes. On Monad, MON is managed through vaultless sub-wallets derived from your master key. Each Eigen can only trade with its own allocated funds and cannot access other deposits.
                </FaqItem>
                <FaqItem q="What tokens are supported?">
                  Any token deployed through nad.fun on Monad. Tokens on the bonding curve and graduated tokens (DEX) are both supported. You can also launch a new token and attach an Eigen simultaneously through the Launch flow.
                </FaqItem>
                <FaqItem q="Can I stop an Eigen?">
                  Yes. You can <strong>suspend</strong> (pause trading), <strong>resume</strong> (restart trading), or <strong>terminate</strong> (sell inventory, close permanently) at any time from the Fleet dashboard. Termination returns all remaining ETH to your wallet.
                </FaqItem>
                <FaqItem q="What happens if the keeper goes offline?">
                  Your funds remain safe in the EigenVault. The keeper cannot withdraw funds — it can only execute swaps. If the keeper is unavailable, trading pauses but your deposit and any held tokens are unaffected. You can withdraw at any time regardless of keeper status.
                </FaqItem>
                <FaqItem q="How do AI agents use EigenSwarm?">
                  AI agents can purchase trading volume programmatically through the API using the x402 payment protocol. They fetch the skill manifest at <Code>eigenswarm.xyz/skill.md</Code>, call the buy-volume endpoint, complete a USDC payment on Monad, and receive an active Eigen.
                </FaqItem>
                <FaqItem q="What is the x402 protocol?">
                  x402 is a machine-to-machine payment standard. Instead of API keys, the server responds with HTTP 402 and on-chain payment instructions. The client pays (USDC on Monad), then retries with the transaction hash as proof. No accounts, no subscriptions.
                </FaqItem>
                <FaqItem q="Can I run multiple Eigens on the same token?">
                  Yes. You can deploy multiple Eigens with different classes and parameters on the same token. Each operates independently with its own balance and configuration.
                </FaqItem>
                <FaqItem q="What is the minimum cost to get started?">
                  The minimum deposit is 0.05 ETH for a Lite-class Eigen. For the API, the cheapest volume package is 10 USDC for 1 ETH of volume over 24 hours.
                </FaqItem>
              </div>

              {/* ── Bottom CTA ─── */}
              <div className="mt-20 pt-10 border-t border-border-subtle">
                <p className="text-xl font-semibold text-txt-primary mb-3">Ready to deploy?</p>
                <p className="text-sm text-txt-muted mb-6">Launch your first Eigen in under a minute.</p>
                <div className="flex gap-3">
                  <Link href="/app" className="inline-flex items-center px-5 py-2.5 rounded-lg bg-eigen-violet text-white text-sm font-medium hover:bg-eigen-violet-deep transition-colors">
                    Launch App
                  </Link>
                  <Link href="/agents" className="inline-flex items-center px-5 py-2.5 rounded-lg border border-border-subtle text-sm font-medium text-txt-primary hover:bg-bg-elevated transition-colors">
                    Agent Integration
                  </Link>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

/* ── FAQ Item ──────────────────────────────────────────────────────── */

function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-medium text-txt-primary">{q}</span>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`flex-shrink-0 ml-3 text-txt-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-txt-secondary leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
