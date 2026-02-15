'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LandingNav } from '@/components/layout/LandingNav';

type Mode = 'human' | 'bot';

// ── Animated counter ─────────────────────────────────────────────────
function AnimCount({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      let frame = 0;
      const total = 40;
      const step = () => {
        frame++;
        const t = frame / total;
        const ease = 1 - Math.pow(1 - t, 3);
        setVal(Math.round(target * ease));
        if (frame < total) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      obs.disconnect();
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

// ── Reveal on scroll ──────────────────────────────────────────────────
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('is-visible'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

// ── Copy button ───────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-txt-on-dark-muted hover:text-txt-on-dark border border-border-dark-subtle rounded hover:border-txt-on-dark-subtle transition-all flex-shrink-0">
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          copy
        </>
      )}
    </button>
  );
}

// ── Agent class data ──────────────────────────────────────────────────
const AGENTS = [
  {
    id: 'lite',
    name: 'Lite',
    tagline: 'Watchful market guardian',
    description: 'Monitors token markets 24/7 and executes precise buy/sell cycles. Optimized for small-cap tokens that need consistent volume with minimal capital.',
    accent: '#F59E0B',
    accentDim: 'rgba(245,158,11,0.12)',
    specs: [
      { label: 'Capital', value: '0.001 – 0.05 ETH' },
      { label: 'Frequency', value: '8 – 15 trades/hr' },
      { label: 'Wallets', value: '3' },
      { label: 'Strategy', value: 'Volume cycling' },
    ],
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="4" fill="currentColor" opacity="0.3" />
        <circle cx="16" cy="16" r="1.5" fill="currentColor" />
        <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" />
        <line x1="16" y1="26" x2="16" y2="30" stroke="currentColor" strokeWidth="1.5" />
        <line x1="2" y1="16" x2="6" y2="16" stroke="currentColor" strokeWidth="1.5" />
        <line x1="26" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'core',
    name: 'Core',
    tagline: 'Autonomous execution engine',
    description: 'The workhorse class. Manages multi-wallet operations with adaptive position sizing, reactive sell triggers, and automatic keeper gas management.',
    accent: '#10B981',
    accentDim: 'rgba(16,185,129,0.12)',
    specs: [
      { label: 'Capital', value: '0.01 – 0.5 ETH' },
      { label: 'Frequency', value: '5 – 12 trades/hr' },
      { label: 'Wallets', value: '3 – 5' },
      { label: 'Strategy', value: 'Market making' },
    ],
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="18" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="6" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="18" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Strategic portfolio orchestrator',
    description: 'Deploys capital across multiple tokens simultaneously. Builds and rebalances portfolios with profit-taking, stop-loss protection, and cross-eigen coordination.',
    accent: '#A78BFA',
    accentDim: 'rgba(167,139,250,0.12)',
    specs: [
      { label: 'Capital', value: '0.1 – 5 ETH' },
      { label: 'Frequency', value: '2 – 8 trades/hr' },
      { label: 'Wallets', value: '5 – 10' },
      { label: 'Strategy', value: 'Portfolio MM' },
    ],
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path d="M16 4L28 12V24L16 28L4 24V12L16 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M16 4V28" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <path d="M4 12L28 12" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <path d="M4 24L16 16L28 24" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      </svg>
    ),
  },
];

// ── Package pricing ───────────────────────────────────────────────────
const PACKAGES = [
  { id: 'starter', volume: '1 ETH', price: '10', desc: 'Test the waters' },
  { id: 'growth', volume: '5 ETH', price: '40', desc: 'Build momentum', popular: true },
  { id: 'pro', volume: '20 ETH', price: '120', desc: 'Serious volume' },
  { id: 'whale', volume: '100 ETH', price: '500', desc: 'Full throttle' },
];

export default function AgentsPage() {
  const [mode, setMode] = useState<Mode>('human');
  const skillUrl = 'https://eigenswarm.xyz/skill.md';
  const humanPrompt = `Read ${skillUrl} and follow the instructions to hire EigenSwarm market making for my token.`;

  return (
    <div className="min-h-screen bg-bg-deep text-txt-on-dark">
      <LandingNav />

      {/* ═══ HERO ═══════════════════════════════════════════════════════ */}
      <section className="relative pt-28 pb-16 overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] rounded-full bg-[#7B3FE4] opacity-[0.06] blur-[120px] pointer-events-none" />
        <div className="absolute top-[10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-[#F59E0B] opacity-[0.04] blur-[100px] pointer-events-none" />

        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal>
            <p className="text-label uppercase tracking-[0.2em] text-eigen-violet-light mb-5">Autonomous Trading Agents</p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05] tracking-[-0.03em] mb-6 max-w-[800px]">
              Deploy <em className="italic text-eigen-violet-light">intelligent</em> volume<br />
              on any token
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="text-body-lg text-txt-on-dark-muted max-w-[540px] mb-10">
              Three classes of autonomous agents. Each optimized for different market conditions, capital sizes, and trading strategies.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="flex items-center gap-6 font-mono text-sm">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                <span className="text-txt-on-dark-muted"><AnimCount target={398} /> trades executed</span>
              </div>
              <div className="text-txt-on-dark-subtle">|</div>
              <div className="text-txt-on-dark-muted"><AnimCount target={12} suffix="+" /> eigens deployed</div>
              <div className="text-txt-on-dark-subtle">|</div>
              <div className="text-txt-on-dark-muted">Monad</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ AGENT CLASSES ══════════════════════════════════════════════ */}
      <section className="relative py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal>
            <p className="text-label uppercase tracking-[0.2em] text-txt-on-dark-subtle mb-4">Agent Classes</p>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-8">
            {AGENTS.map((agent, i) => (
              <Reveal key={agent.id} delay={i * 120}>
                <div
                  className="group relative rounded-2xl border border-border-dark-subtle bg-bg-deep-alt p-6 transition-all duration-500 hover:border-opacity-30"
                  style={{
                    ['--agent-accent' as string]: agent.accent,
                    ['--agent-dim' as string]: agent.accentDim,
                  }}
                >
                  {/* Top accent line */}
                  <div
                    className="absolute top-0 left-6 right-6 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{ background: `linear-gradient(90deg, transparent, ${agent.accent}, transparent)` }}
                  />

                  {/* Icon + Badge */}
                  <div className="flex items-start justify-between mb-6">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center transition-colors duration-500"
                      style={{ color: agent.accent, backgroundColor: agent.accentDim }}
                    >
                      {agent.icon}
                    </div>
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border"
                      style={{ color: agent.accent, borderColor: agent.accentDim }}
                    >
                      {agent.id}
                    </span>
                  </div>

                  {/* Name + Tagline */}
                  <h3 className="font-display text-[1.75rem] leading-tight mb-1" style={{ color: agent.accent }}>
                    {agent.name}
                  </h3>
                  <p className="text-sm text-txt-on-dark-muted mb-4 italic font-display">{agent.tagline}</p>
                  <p className="text-body text-txt-on-dark-subtle leading-relaxed mb-6">{agent.description}</p>

                  {/* Specs grid */}
                  <div className="grid grid-cols-2 gap-3 pt-5 border-t border-border-dark-subtle">
                    {agent.specs.map((spec) => (
                      <div key={spec.label}>
                        <div className="text-[10px] uppercase tracking-[0.15em] text-txt-on-dark-subtle mb-0.5">{spec.label}</div>
                        <div className="font-mono text-sm text-txt-on-dark">{spec.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Hover glow */}
                  <div
                    className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                    style={{ boxShadow: `inset 0 0 60px ${agent.accentDim}, 0 0 40px ${agent.accentDim}` }}
                  />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ INTEGRATION ═══════════════════════════════════════════════ */}
      <section className="relative py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid lg:grid-cols-[1fr,1.2fr] gap-16 items-start">
            {/* Left: copy */}
            <div>
              <Reveal>
                <p className="text-label uppercase tracking-[0.2em] text-eigen-violet-light mb-4">Integration</p>
                <h2 className="font-display text-display mb-4">
                  One message<br /><em className="italic">to deploy</em>
                </h2>
                <p className="text-body-lg text-txt-on-dark-muted mb-8">
                  AI agents can programmatically purchase trading volume on any nad.fun token via x402 payments. Humans send a single prompt.
                </p>
              </Reveal>

              {/* Mode Toggle */}
              <Reveal delay={100}>
                <div className="mb-8">
                  <div className="inline-flex rounded-lg border border-border-dark-subtle overflow-hidden">
                    <button
                      onClick={() => setMode('human')}
                      className={`px-5 py-2.5 text-sm font-medium transition-all duration-300 ${mode === 'human'
                          ? 'bg-white text-bg-deep'
                          : 'bg-transparent text-txt-on-dark-muted hover:text-txt-on-dark'
                        }`}
                    >
                      Human
                    </button>
                    <button
                      onClick={() => setMode('bot')}
                      className={`px-5 py-2.5 text-sm font-medium transition-all duration-300 ${mode === 'bot'
                          ? 'bg-white text-bg-deep'
                          : 'bg-transparent text-txt-on-dark-muted hover:text-txt-on-dark'
                        }`}
                    >
                      Bot / Agent
                    </button>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={160}>
                <ol className="space-y-4 text-body text-txt-on-dark-muted">
                  {mode === 'human' ? (
                    <>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>01</span>
                        Copy the prompt and send it to your AI agent (Claude, GPT, or any LLM).
                      </li>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>02</span>
                        Your agent reads the skill file, discovers the API, and handles x402 payment.
                      </li>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>03</span>
                        Market making begins within 30 seconds. Monitor via dashboard.
                      </li>
                    </>
                  ) : (
                    <>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>01</span>
                        Fetch and parse the skill file for complete API documentation.
                      </li>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>02</span>
                        Call buy-volume endpoint. Handle the 402 payment flow with MON on Monad.
                      </li>
                      <li className="flex gap-3">
                        <span className="font-mono text-xs mt-0.5 w-5 flex-shrink-0" style={{ color: '#A78BFA' }}>03</span>
                        Eigen activates automatically. Poll the status endpoint.
                      </li>
                    </>
                  )}
                </ol>
              </Reveal>
            </div>

            {/* Right: code/prompt card */}
            <Reveal delay={200}>
              <div className="rounded-2xl border border-border-dark-subtle bg-bg-deep-alt overflow-hidden">
                {/* Tab bar */}
                <div className="flex items-center gap-0 border-b border-border-dark-subtle">
                  <div className="px-5 py-3 text-xs font-mono uppercase tracking-wider text-txt-on-dark-muted border-b-2 border-eigen-violet-light">
                    {mode === 'human' ? 'Prompt' : 'API Reference'}
                  </div>
                </div>

                {mode === 'human' ? (
                  <div className="p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <code className="flex-1 text-sm font-mono text-txt-on-dark leading-relaxed break-all opacity-90">
                        {humanPrompt}
                      </code>
                      <CopyButton text={humanPrompt} />
                    </div>
                    <p className="text-caption text-txt-on-dark-subtle">
                      Paste this into Claude, GPT, or any agent with tool use enabled.
                    </p>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="flex items-start gap-3 mb-5">
                      <code className="flex-1 text-sm font-mono text-eigen-violet-light">{skillUrl}</code>
                      <CopyButton text={skillUrl} />
                    </div>
                    <pre className="text-xs font-mono text-txt-on-dark-muted leading-relaxed overflow-x-auto">{`# 1. Check pricing
GET /api/pricing

# 2. Purchase volume (x402 flow)
POST /api/agents/buy-volume
{
  "tokenAddress": "0x...",
  "packageId": "growth",
  "tokenSymbol": "TOKEN",
  "tokenName": "My Token"
}

# 3. Complete MON payment on Monad
# 4. Retry with X-PAYMENT header

# 5. Monitor
GET /api/eigens/{eigenId}
GET /api/eigens/{eigenId}/trades`}</pre>
                  </div>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══ PRICING ═══════════════════════════════════════════════════ */}
      <section className="relative py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal>
            <div className="text-center mb-12">
              <p className="text-label uppercase tracking-[0.2em] text-eigen-violet-light mb-4">Pricing</p>
              <h2 className="font-display text-display-lg mb-3">
                Volume <em className="italic">packages</em>
              </h2>
              <p className="text-body text-txt-on-dark-muted max-w-[440px] mx-auto">
                Pay in MON on Monad. Volume generated over 24h by autonomous keeper agents.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PACKAGES.map((pkg, i) => (
              <Reveal key={pkg.id} delay={i * 80}>
                <div className={`group relative rounded-xl border p-5 transition-all duration-500 hover:translate-y-[-2px] ${pkg.popular
                    ? 'border-eigen-violet/30 bg-[rgba(123,63,228,0.06)]'
                    : 'border-border-dark-subtle bg-bg-deep-alt hover:border-txt-on-dark-subtle/20'
                  }`}>
                  {pkg.popular && (
                    <span className="absolute top-3 right-3 text-[9px] font-mono uppercase tracking-[0.15em] px-2 py-0.5 rounded-full bg-eigen-violet/15 text-eigen-violet-light">
                      Popular
                    </span>
                  )}
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-txt-on-dark-subtle mb-2">{pkg.id}</div>
                  <div className="font-mono text-2xl font-medium text-txt-on-dark">{pkg.volume}</div>
                  <div className="text-xs text-txt-on-dark-subtle mt-0.5 mb-4">{pkg.desc}</div>
                  <div className="pt-3 border-t border-border-dark-subtle">
                    <span className="font-mono text-xl text-eigen-violet-light">{pkg.price}</span>
                    <span className="text-xs text-txt-on-dark-subtle ml-1.5">MON</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ x402 PROTOCOL ══════════════════════════════════════════════ */}
      <section className="relative py-20 pb-32">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal>
            <p className="text-label uppercase tracking-[0.2em] text-txt-on-dark-subtle mb-4">Protocol</p>
            <h2 className="font-display text-display mb-3">
              How <em className="italic">x402</em> works
            </h2>
            <p className="text-body text-txt-on-dark-muted mb-10 max-w-[480px]">
              Machine-to-machine payments over HTTP. Your agent pays for services directly, no human approval needed.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border-dark-subtle">
            {[
              { n: '01', title: 'Request', body: 'Agent calls the buy-volume endpoint with token address and desired package.' },
              { n: '02', title: '402 Response', body: 'Server responds with payment details: amount in MON, recipient on Monad.' },
              { n: '03', title: 'Pay On-Chain', body: 'Agent executes MON transfer on Monad. Confirmation in ~2 seconds.' },
              { n: '04', title: 'Activate', body: 'Retry with payment proof. Eigen activates and begins autonomous trading.' },
            ].map((step, i) => (
              <Reveal key={step.n} delay={i * 100}>
                <div className="bg-bg-deep-alt p-6 h-full">
                  <span className="font-mono text-xs text-eigen-violet-light">{step.n}</span>
                  <h3 className="font-display text-lg text-txt-on-dark mt-3 mb-2">{step.title}</h3>
                  <p className="text-sm text-txt-on-dark-subtle leading-relaxed">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ════════════════════════════════════════════════════════ */}
      <section className="relative pb-20">
        <div className="max-w-[1100px] mx-auto px-6 text-center">
          <Reveal>
            <Link
              href="/app/launch"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-white text-bg-deep font-medium text-sm hover:shadow-card-float transition-all duration-500 hover:translate-y-[-2px]"
            >
              Launch an Eigen
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
