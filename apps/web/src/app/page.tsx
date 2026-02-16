'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { GlowButton } from '@/components/ui/GlowButton';
import { OrganicCapabilities } from '@/components/ui/OrganicShape';
import { SwarmBackground } from '@/components/ui/SwarmBackground';
import { fetchEigens } from '@/lib/api';
import { mapApiEigenToEigen } from '@/lib/mappers';
import { formatEth } from '@eigenswarm/shared';

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
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

/* ── Sliding Puzzle Logo ─────────────────────────────────────────── */

const GRID = 5;
const CELL = 90;
const TILE = 80;
const RX = 5;
const INTRO_DURATION = 3.5;
const SLIDE_INTERVAL = 1800;

const INITIAL_BLOCKS: [number, number, number][] = [
  [0, 0, 0], [0, 1, 1], [0, 3, 2], [0, 4, 3],
  [1, 0, 4], [1, 1, 5], [1, 2, 6], [1, 3, 7],
  [2, 0, 8], [2, 1, 9], [2, 2, 10], [2, 4, 11],
  [3, 1, 12], [3, 2, 13], [3, 3, 14], [3, 4, 15],
  [4, 0, 16], [4, 2, 17], [4, 3, 18],
];

function useSlidingPuzzle() {
  const [positions, setPositions] = useState<[number, number][]>(
    () => INITIAL_BLOCKS.map(([r, c]) => [r, c])
  );
  const [active, setActive] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setActive(true), INTRO_DURATION * 1000);
    return () => clearTimeout(timer);
  }, []);

  const slide = useCallback(() => {
    setPositions(prev => {
      const occupied = new Set(prev.map(([r, c]) => `${r},${c}`));
      const empties: [number, number][] = [];
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if (!occupied.has(`${r},${c}`)) empties.push([r, c]);
        }
      }
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const moves: { blockIdx: number; toRow: number; toCol: number }[] = [];
      for (const [er, ec] of empties) {
        for (const [dr, dc] of dirs) {
          const nr = er + dr;
          const nc = ec + dc;
          const blockIdx = prev.findIndex(([r, c]) => r === nr && c === nc);
          if (blockIdx !== -1) {
            moves.push({ blockIdx, toRow: er, toCol: ec });
          }
        }
      }
      if (moves.length === 0) return prev;
      const move = moves[Math.floor(Math.random() * moves.length)];
      const next = [...prev] as [number, number][];
      next[move.blockIdx] = [move.toRow, move.toCol];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(slide, SLIDE_INTERVAL);
    return () => clearInterval(interval);
  }, [active, slide]);

  return positions;
}

const AGENT_DATA = [
  { name: 'ES-a1f2', token: '$DEGEN', cls: 'Core', vol: '4.2 ETH', pnl: '+0.31 ETH', status: 'active' },
  { name: 'ES-b3c4', token: '$NAD', cls: 'Pro', vol: '18.7 ETH', pnl: '+1.82 ETH', status: 'active' },
  { name: 'ES-d5e6', token: '$HIGHER', cls: 'Lite', vol: '1.1 ETH', pnl: '+0.04 ETH', status: 'active' },
  { name: 'ES-f7a8', token: '$TOSHI', cls: 'Core', vol: '6.8 ETH', pnl: '+0.55 ETH', status: 'active' },
  { name: 'ES-b9c0', token: '$BRETT', cls: 'Ultra', vol: '82.4 ETH', pnl: '+6.13 ETH', status: 'active' },
  { name: 'ES-d1e2', token: '$MFER', cls: 'Core', vol: '3.9 ETH', pnl: '-0.12 ETH', status: 'active' },
  { name: 'ES-f3a4', token: '$ENJOY', cls: 'Pro', vol: '24.1 ETH', pnl: '+2.47 ETH', status: 'active' },
  { name: 'ES-b5c6', token: '$MONAD', cls: 'Lite', vol: '0.8 ETH', pnl: '+0.02 ETH', status: 'active' },
  { name: 'ES-d7e8', token: '$AERO', cls: 'Ultra', vol: '91.3 ETH', pnl: '+8.44 ETH', status: 'active' },
  { name: 'ES-f9a0', token: '$NORM', cls: 'Core', vol: '5.5 ETH', pnl: '+0.38 ETH', status: 'active' },
  { name: 'ES-c1d2', token: '$ZORA', cls: 'Pro', vol: '31.2 ETH', pnl: '+3.05 ETH', status: 'active' },
  { name: 'ES-e3f4', token: '$FREN', cls: 'Lite', vol: '1.4 ETH', pnl: '+0.09 ETH', status: 'active' },
  { name: 'ES-a5b6', token: '$VIRTUAL', cls: 'Core', vol: '7.3 ETH', pnl: '+0.67 ETH', status: 'active' },
  { name: 'ES-c7d8', token: '$PRIME', cls: 'Pro', vol: '15.8 ETH', pnl: '+1.21 ETH', status: 'active' },
  { name: 'ES-e9f0', token: '$SEAM', cls: 'Core', vol: '4.7 ETH', pnl: '-0.08 ETH', status: 'active' },
  { name: 'ES-a2b3', token: '$BALD', cls: 'Ultra', vol: '67.9 ETH', pnl: '+5.22 ETH', status: 'active' },
  { name: 'ES-c4d5', token: '$WELL', cls: 'Lite', vol: '1.9 ETH', pnl: '+0.15 ETH', status: 'active' },
  { name: 'ES-e6f7', token: '$MORPHO', cls: 'Pro', vol: '28.6 ETH', pnl: '+2.73 ETH', status: 'active' },
  { name: 'ES-a8b9', token: '$SPEC', cls: 'Core', vol: '8.1 ETH', pnl: '+0.91 ETH', status: 'active' },
];

function AnimatedLogo({ className = '', id = 'logo', interactive = false }: { className?: string; id?: string; interactive?: boolean }) {
  const positions = useSlidingPuzzle();
  const [hovered, setHovered] = useState<number | null>(null);
  const perim = (TILE + TILE) * 2;

  return (
    <div className="relative" style={{ display: 'inline-block' }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 450 450"
        className={className}
        aria-label="EigenSwarm logo"
      >
        <defs>
          <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="50%" stopColor="#7B3FE4" />
            <stop offset="100%" stopColor="#5B21B6" />
          </linearGradient>
          <linearGradient id={`${id}-stroke`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#7B3FE4" />
          </linearGradient>
          {/* Subtle top-edge glare */}
          <linearGradient id={`${id}-glare`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.25" />
            <stop offset="30%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <circle cx="225" cy="225" r="140" fill="#7B3FE4" opacity="0">
          <animate attributeName="opacity" values="0;0.03;0" dur="7s" repeatCount="indefinite" />
          <animate attributeName="r" values="140;160;140" dur="7s" repeatCount="indefinite" />
        </circle>
        <g filter={`url(#${id}-glow)`} transform="translate(10, 10)">
          {INITIAL_BLOCKS.map(([initRow, initCol, idx], i) => {
            const [curRow, curCol] = positions[i];
            const x = curCol * CELL;
            const y = curRow * CELL;
            const drawBegin = idx * 0.08;
            const drawDur = 0.6;
            const fillBegin = drawBegin + drawDur;
            const fillDur = 0.4;
            const breatheBegin = fillBegin + fillDur + 0.3;
            const seed = (initRow * 7 + initCol * 13 + idx * 3) % 19;
            const breatheDur = 3.5 + (seed / 19) * 4;
            const breathePhase = (seed / 19) * breatheDur;
            const breatheMin = 0.7 + (seed % 5) * 0.04;
            const breatheDelay = breatheBegin + breathePhase;
            const isHovered = interactive && hovered === i;
            const shimmerDur = 4 + (seed / 19) * 3;
            const shimmerDelay = (fillBegin + 0.5) + (seed / 19) * 2;

            return (
              <g
                key={`block-${idx}`}
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                  transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  cursor: interactive ? 'pointer' : undefined,
                }}
                onMouseEnter={interactive ? () => setHovered(i) : undefined}
                onMouseLeave={interactive ? () => setHovered(null) : undefined}
              >
                <rect x={0} y={0} width={TILE} height={TILE} rx={RX} fill="none" stroke={`url(#${id}-stroke)`} strokeWidth="2" strokeDasharray={perim} strokeDashoffset={perim} opacity="0">
                  <animate attributeName="opacity" from="0" to="1" dur="0.15s" begin={`${drawBegin}s`} fill="freeze" />
                  <animate attributeName="stroke-dashoffset" from={perim} to="0" dur={`${drawDur}s`} begin={`${drawBegin}s`} fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
                  <animate attributeName="opacity" from="1" to="0" dur="0.4s" begin={`${fillBegin + 0.2}s`} fill="freeze" />
                </rect>
                <rect x={0} y={0} width={TILE} height={TILE} rx={RX} fill={`url(#${id}-grad)`} opacity="0" style={isHovered ? { filter: 'brightness(1.25)' } : undefined}>
                  <animate attributeName="opacity" from="0" to="1" dur={`${fillDur}s`} begin={`${fillBegin}s`} fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
                  <animate attributeName="opacity" values={`1;${breatheMin};1`} dur={`${breatheDur.toFixed(2)}s`} begin={`${breatheDelay.toFixed(2)}s`} repeatCount="indefinite" />
                </rect>
                {/* Subtle top glare — just a hint of glass */}
                <rect x={2} y={1} width={TILE - 4} height={TILE * 0.35} rx={RX - 1} fill={`url(#${id}-glare)`} opacity="0">
                  <animate attributeName="opacity" from="0" to="0.6" dur={`${fillDur}s`} begin={`${fillBegin}s`} fill="freeze" />
                </rect>
                <rect x={0} y={0} width={TILE} height={TILE} rx={RX} fill="none" stroke="#EDE9FE" strokeWidth="1.5" strokeDasharray={`${perim * 0.15} ${perim * 0.85}`} strokeDashoffset={perim} opacity="0">
                  <animate attributeName="opacity" from="0" to="0.4" dur="0.3s" begin={`${shimmerDelay.toFixed(2)}s`} fill="freeze" />
                  <animate attributeName="stroke-dashoffset" values={`${perim};0`} dur={`${shimmerDur.toFixed(2)}s`} begin={`${shimmerDelay.toFixed(2)}s`} repeatCount="indefinite" />
                </rect>
                {isHovered && (
                  <rect x={0} y={0} width={TILE} height={TILE} rx={RX} fill="none" stroke="#EDE9FE" strokeWidth="2" opacity="0.6" />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {interactive && hovered !== null && (() => {
        const agent = AGENT_DATA[hovered];
        const [curRow, curCol] = positions[hovered];
        const tileCenter = {
          x: ((10 + curCol * CELL + TILE / 2) / 450) * 100,
          y: ((10 + curRow * CELL) / 450) * 100,
        };
        const pnlPositive = agent.pnl.startsWith('+');
        return (
          <div className="absolute pointer-events-none z-10" style={{ left: `${tileCenter.x}%`, top: `${tileCenter.y}%`, transform: 'translate(-50%, -110%)' }}>
            <div className="bg-txt-primary/95 backdrop-blur-sm rounded-lg px-3 py-2.5 shadow-lg min-w-[150px]">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="font-mono text-[11px] text-white/90 font-medium">{agent.name}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-status-success flex-shrink-0" />
              </div>
              <div className="text-[11px] text-white/70 mb-1">{agent.token} <span className="text-white/40">·</span> {agent.cls}</div>
              <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/10">
                <div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider">Vol 24h</div>
                  <div className="font-mono text-[11px] text-white/90">{agent.vol}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-white/40 uppercase tracking-wider">P&L</div>
                  <div className={`font-mono text-[11px] ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>{agent.pnl}</div>
                </div>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="w-2 h-2 bg-txt-primary/95 rotate-45 -mt-1" />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Corner Puzzle Decoration ─────────────────────────────────────── */

const CORNER_GRID = 14;
const CORNER_CELL = 22;
const CORNER_TILE = 18;
const CORNER_RX = 3;

const CORNER_BLOCKS: [number, number][] = (() => {
  const blocks: [number, number][] = [];
  for (let r = 0; r < CORNER_GRID; r++) {
    for (let c = 0; c < CORNER_GRID; c++) {
      const distFromCorner = r + (CORNER_GRID - 1 - c);
      if (distFromCorner >= CORNER_GRID) continue;
      if (distFromCorner >= CORNER_GRID - 3 && distFromCorner < CORNER_GRID) {
        if ((r + c) % 2 === 0) continue;
      }
      if ((r * 11 + c * 7) % 9 === 0) continue;
      blocks.push([r, c]);
    }
  }
  return blocks;
})();

function useCornerPuzzle() {
  const [positions, setPositions] = useState<[number, number][]>(() =>
    CORNER_BLOCKS.map(([r, c]) => [r, c])
  );

  const slide = useCallback(() => {
    setPositions(prev => {
      const occupied = new Set(prev.map(([r, c]) => `${r},${c}`));
      const empties: [number, number][] = [];
      for (let r = 0; r < CORNER_GRID; r++) {
        for (let c = 0; c < CORNER_GRID; c++) {
          if (!occupied.has(`${r},${c}`)) empties.push([r, c]);
        }
      }
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const moves: { idx: number; to: [number, number] }[] = [];
      for (const [er, ec] of empties) {
        for (const [dr, dc] of dirs) {
          const nr = er + dr, nc = ec + dc;
          const idx = prev.findIndex(([r, c]) => r === nr && c === nc);
          if (idx !== -1) moves.push({ idx, to: [er, ec] });
        }
      }
      if (moves.length === 0) return prev;
      const move = moves[Math.floor(Math.random() * moves.length)];
      const next = [...prev] as [number, number][];
      next[move.idx] = move.to;
      return next;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(slide, 2200);
    return () => clearInterval(interval);
  }, [slide]);

  return positions;
}

function CornerPuzzle() {
  const positions = useCornerPuzzle();
  const svgSize = CORNER_GRID * CORNER_CELL;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: -12, right: -12,
        width: svgSize + 24, height: svgSize + 24,
        maskImage: 'radial-gradient(ellipse 80% 80% at 100% 0%, black 20%, transparent 65%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 100% 0%, black 20%, transparent 65%)',
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${svgSize} ${svgSize}`} width={svgSize} height={svgSize} style={{ opacity: 0.15 }}>
        <defs>
          <linearGradient id="corner-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#7B3FE4" />
          </linearGradient>
          <linearGradient id="corner-glare" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.25" />
            <stop offset="30%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
        {positions.map(([row, col], i) => {
          const tx = col * CORNER_CELL + (CORNER_CELL - CORNER_TILE) / 2;
          const ty = row * CORNER_CELL + (CORNER_CELL - CORNER_TILE) / 2;
          const seed = (row * 5 + col * 11 + i) % 13;
          const breatheDur = 3 + (seed / 13) * 4;
          const breatheDelay = (seed / 13) * breatheDur;
          const breatheMin = 0.5 + (seed % 4) * 0.1;
          return (
            <g key={`cp-${i}`} style={{ transform: `translate(${tx}px, ${ty}px)`, transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <rect x={0} y={0} width={CORNER_TILE} height={CORNER_TILE} rx={CORNER_RX} fill="url(#corner-grad)">
                <animate attributeName="opacity" values={`1;${breatheMin};1`} dur={`${breatheDur.toFixed(1)}s`} begin={`${breatheDelay.toFixed(1)}s`} repeatCount="indefinite" />
              </rect>
              {/* Subtle top glare */}
              <rect x={1} y={0.5} width={CORNER_TILE - 2} height={CORNER_TILE * 0.35} rx={CORNER_RX - 1} fill="url(#corner-glare)" opacity="0.5" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Logo Carousel — muted, infinite scroll with fade edges ─────── */

const PARTNER_LOGOS = [
  { name: 'nad.fun', src: '/logos/nad.svg', href: 'https://nad.fun', h: 'h-6 md:h-7' },
  { name: 'Monad', src: '/logos/monad.svg', href: 'https://monad.xyz', h: 'h-6 md:h-7' },
  { name: 'Uniswap', src: '/logos/uniswap.svg', href: 'https://uniswap.org', h: 'h-5 md:h-6' },
  { name: 'Chainlink', src: '/logos/chainlink.svg', href: 'https://chain.link', h: 'h-6 md:h-7' },
];

function LogoCarousel() {
  return (
    <div className="marquee-container py-2">
      <div className="marquee-track" style={{ animation: 'marquee 30s linear infinite' }}>
        {[...PARTNER_LOGOS, ...PARTNER_LOGOS, ...PARTNER_LOGOS, ...PARTNER_LOGOS].map((logo, i) => (
          <a
            key={`${logo.name}-${i}`}
            href={logo.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 flex-shrink-0 opacity-30 hover:opacity-60 transition-opacity duration-300"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.src} alt={logo.name} className={`${logo.h} grayscale`} />
            <span className="text-sm font-medium text-[#706F84] tracking-tight whitespace-nowrap">{logo.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LANDING PAGE — yield.xyz organic curved shapes
   ══════════════════════════════════════════════════════════════════════ */

export default function LandingPage() {
  const [platformStats, setPlatformStats] = useState({ volume: 0, activeCount: 0, trades: 0, fees: 0 });

  useEffect(() => {
    let cancelled = false;
    fetchEigens()
      .then((raw) => {
        if (cancelled) return;
        const eigens = raw.map((e) => mapApiEigenToEigen(e));
        setPlatformStats({
          volume: eigens.reduce((s, e) => s + e.volumeGenerated, 0),
          activeCount: eigens.filter((e) => e.status === 'active').length,
          trades: eigens.reduce((s, e) => s + e.tradesExecuted, 0),
          fees: eigens.reduce((s, e) => s + e.lpFeesEarned, 0),
        });
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  const fmtTrades = platformStats.trades >= 1_000_000
    ? `${(platformStats.trades / 1_000_000).toFixed(1)}M+`
    : platformStats.trades >= 1_000
      ? `${(platformStats.trades / 1_000).toFixed(1)}K`
      : platformStats.trades.toLocaleString();

  return (
    <div className="min-h-screen bg-[#131517] overflow-hidden relative">
      <SwarmBackground />
      {/* White entrance cover — page starts all white, dark bg revealed as shape contracts */}
      <div className="page-entrance-cover" aria-hidden="true" />

      {/* ── ORGANIC CURVE NAV + HERO ────────────────────────────── */}
      <OrganicNav />

      {/* ══ HERO — seamlessly continues from the SVG curve above ═ */}
      <div className="bg-white mx-3 sm:mx-5 md:mx-8 lg:mx-12 -mt-px relative z-[2]">
        <section className="max-w-[1000px] mx-auto px-6 md:px-12 pt-10 pb-8 md:pt-16 md:pb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.15em] text-[#706F84] font-medium mb-8 anim-hero-text" style={{ animationDelay: '1.2s' }}>
            Democratizing Market Making
          </p>

          <h1 className="font-display hero-headline mb-8 max-w-[750px] mx-auto anim-hero-text" style={{ animationDelay: '1.35s' }}>
            Autonomous<br />
            <em className="hero-em">Market Making</em><br />
            Infrastructure
          </h1>

          <div className="flex items-center justify-center gap-5 mb-14 anim-hero-text" style={{ animationDelay: '1.55s' }}>
            <Link href="/app" className="cta-pill">
              Deploy Capital
              <span className="cta-pill-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </Link>
            <Link href="/docs" className="text-sm text-[#1A1A2E] underline underline-offset-4 decoration-[#D4D2CC] hover:decoration-[#1A1A2E] transition-colors">
              View docs
            </Link>
          </div>

          <div className="anim-hero-text" style={{ animationDelay: '1.75s' }}>
            <p className="text-[11px] text-[#B8B7C8] italic mb-4 tracking-wide font-display">Trusted by the best</p>
            <LogoCarousel />
          </div>
        </section>
      </div>

      {/* ══ Get Started — transparent hole showing real page bg ════════ */}
      <div className="mx-3 sm:mx-5 md:mx-8 lg:mx-12 relative z-[2]">
        {/* Content area — overflow-hidden clips the box-shadow to create white frame */}
        <div className="overflow-hidden">
          <div className="px-2 sm:px-3 md:px-4 pt-2 md:pt-3">
            <div
              className="rounded-2xl md:rounded-[20px] p-8 md:p-12 lg:p-14 pb-14 md:pb-20"
              style={{ boxShadow: '0 0 0 120px #FFFFFF' }}
            >
              <div className="max-w-[1100px] mx-auto">
                <div className="flex flex-col lg:flex-row items-start gap-10 lg:gap-16">
                  <div className="flex-1 min-w-0">
                    <InstallSectionDark />
                  </div>
                  <Reveal delay={150}>
                    <div className="flex-shrink-0 hidden lg:flex flex-col items-center">
                      <AnimatedLogo className="w-[340px] h-[340px] xl:w-[400px] xl:h-[400px] drop-shadow-[0_0_40px_rgba(123,63,228,0.15)]" id="hero-logo" interactive />
                    </div>
                  </Reveal>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Inverted neck — white fill-rule:evenodd creates white shoulders, transparent center */}
        <div className="relative -mt-[67px] md:-mt-[83px]">
          <svg
            viewBox="0 0 1440 140"
            preserveAspectRatio="none"
            className="w-full block"
            style={{ height: 'clamp(100px, 11vw, 150px)' }}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d={[
                /* Outer rectangle — fills everything white */
                'M 0,0 H 1440 V 140 H 0 Z',
                /* Inner cutout — subtracts the neck shape (transparent) */
                'M 0,0',
                'L 0,58',
                'Q 0,78 20,78',
                'L 198,78',
                'Q 220,78 220,100',
                'L 220,120',
                'Q 220,140 240,140',
                'L 1200,140',
                'Q 1220,140 1220,120',
                'L 1220,100',
                'Q 1220,78 1242,78',
                'L 1420,78',
                'Q 1440,78 1440,58',
                'L 1440,0',
                'Z',
              ].join(' ')}
              fill="#FFFFFF"
            />
          </svg>

          {/* Stats row */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-center pt-8 sm:pt-10 md:pt-12">
            {/* Desktop: single row with dividers */}
            <div className="hidden md:flex items-center justify-center px-6 max-w-[800px] w-full">
              {[
                { val: formatEth(platformStats.volume), unit: 'MON', label: 'Volume Generated' },
                { val: String(platformStats.activeCount), unit: '', label: 'Active Eigens' },
                { val: fmtTrades, unit: '', label: 'Trades Executed' },
                { val: formatEth(platformStats.fees), unit: 'MON', label: 'LP Fees Captured' },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center">
                  {i > 0 && <div className="w-px h-10 bg-white/10 mx-6 lg:mx-8 flex-shrink-0" />}
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/40 font-medium mb-1.5">{s.label}</p>
                    <p className="font-display text-3xl md:text-[2.5rem] text-white/90 tracking-tight leading-none whitespace-nowrap">
                      {s.val}<span className="text-white/40 text-[0.55em] ml-0.5">{s.unit}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile: 2×2 grid with cross dividers */}
            <div className="md:hidden relative px-6 max-w-[400px] w-full">
              <div className="grid grid-cols-2 gap-y-5">
                {[
                  { val: formatEth(platformStats.volume), unit: 'MON', label: 'Volume Generated' },
                  { val: String(platformStats.activeCount), unit: '', label: 'Active Eigens' },
                  { val: fmtTrades, unit: '', label: 'Trades Executed' },
                  { val: formatEth(platformStats.fees), unit: 'MON', label: 'LP Fees Captured' },
                ].map((s) => (
                  <div key={s.label} className="text-center px-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-white/40 font-medium mb-1.5">{s.label}</p>
                    <p className="font-display text-2xl sm:text-3xl text-white/90 tracking-tight leading-none whitespace-nowrap">
                      {s.val}<span className="text-white/40 text-[0.55em] ml-0.5">{s.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
              {/* Vertical center divider */}
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/10 -translate-x-px" />
              {/* Horizontal center divider */}
              <div className="absolute left-6 right-6 top-1/2 h-px bg-white/10 -translate-y-px" />
            </div>
          </div>

          {/* White strip with rounded bottom corners */}
          <div className="h-[15px] bg-white rounded-b-2xl" />
        </div>
      </div>


      {/* ══ DARK: Protocol — alternating card + text ═════════════ */}
      <section id="protocol" className="relative py-16 md:py-24 overflow-hidden">
        <div className="section-glow section-glow-warm" style={{ top: '5%', left: '15%' }} aria-hidden="true" />
        <div className="section-glow section-glow-rose" style={{ top: '40%', right: '5%' }} aria-hidden="true" />

        <div className="max-w-[1100px] mx-auto px-6 relative z-[1]">
          <Reveal>
            <div className="text-center mb-16 md:mb-20">
              <h2 className="font-display text-[clamp(2rem,4vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-white mb-6">
                One Protocol. All Markets.<br /><em className="italic text-[#A78BFA]">Maximum Volume.</em>
              </h2>
              <p className="text-[15px] text-[#878285] leading-relaxed max-w-[500px] mx-auto">
                Deploy autonomous agents that generate volume, manage spreads, and capture LP fees on any token on Monad.
              </p>
            </div>
          </Reveal>

          {/* Diagonal card layout — panels connect via arms at the junction */}
          <div className="grid grid-cols-1 lg:grid-cols-[38%_62%] gap-6 md:gap-8 lg:gap-0">
            {/* Panel A: Stats Card (top-left) */}
            <Reveal className="order-1 lg:col-start-1 lg:row-start-1">
              <div className="float-card merged-panel-a p-8 md:p-10 h-full">
                <div className="grid grid-cols-2 gap-6">
                  {[
                    { val: `${formatEth(platformStats.volume)} MON`, label: 'Volume' },
                    { val: String(platformStats.activeCount), label: 'Active Eigens' },
                    { val: fmtTrades, label: 'Trades Executed' },
                    { val: `${formatEth(platformStats.fees)} MON`, label: 'Fees Captured' },
                  ].map(s => (
                    <div key={s.label} className="text-center py-4">
                      <div className="font-mono text-2xl md:text-3xl font-medium text-[#1A1A2E] mb-1">{s.val}</div>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[#706F84] font-medium">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Text 1 (top-right) */}
            <Reveal delay={100} className="order-2 lg:col-start-2 lg:row-start-1 flex flex-col justify-center">
              <div className="lg:pl-8 lg:py-6">
                <h3 className="font-display text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-white mb-4">
                  Four steps to <em className="italic">autonomous</em> market making
                </h3>
                <p className="text-[15px] text-[#878285] leading-relaxed mb-6">
                  Select a token, choose an agent class, configure parameters, fund and deploy. Your Eigen begins autonomous execution within seconds.
                </p>
                <Link href="/docs" className="learn-more-pill">
                  Learn more <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </Reveal>

            {/* Panel B: Steps Card (bottom-right) */}
            <Reveal className="order-3 lg:order-4 lg:col-start-2 lg:row-start-2">
              <div className="float-card merged-panel-b p-8 md:p-10 h-full">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {[
                    { n: '01', title: 'Select Token', body: 'Choose any nad.fun token on Monad, or deploy a new one with an agent attached.' },
                    { n: '02', title: 'Choose Class', body: 'Four tiers — Lite, Core, Pro, Ultra — each tuned for different profiles.' },
                    { n: '03', title: 'Configure', body: 'Set volume targets, spread width, risk limits, and wallet distribution strategy.' },
                    { n: '04', title: 'Fund & Deploy', body: 'Deposit ETH into the EigenVault. Your Eigen begins execution within seconds.' },
                  ].map(step => (
                    <div key={step.n} className="py-3">
                      <span className="font-mono text-xs text-[#7B3FE4]">{step.n}</span>
                      <h4 className="text-[15px] font-medium text-[#1A1A2E] mt-1.5 mb-1.5">{step.title}</h4>
                      <p className="text-[13px] text-[#706F84] leading-relaxed">{step.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Text 2 (bottom-left) */}
            <Reveal delay={100} className="order-4 lg:order-3 lg:col-start-1 lg:row-start-2 flex flex-col justify-center">
              <div className="lg:pr-8 lg:py-6">
                <h3 className="font-display text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-white mb-4">
                  Composable <em className="italic">agent</em> infrastructure
                </h3>
                <p className="text-[15px] text-[#878285] leading-relaxed mb-6">
                  Any AI agent can trigger volume generation via x402 payment protocol. No API keys, no accounts — just pay and execute.
                </p>
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                  <span className="text-xs text-[#505659] font-mono">x402 compatible</span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══ WHITE ISLAND: Agent Classes — neck + shoulders ═════════ */}
      <div id="agents" className="max-w-[1100px] mx-auto px-3 sm:px-5 md:px-8 mt-8 md:mt-12 relative z-[1]">
        {/* Neck + shoulders SVG: narrow white pill that flares to full width */}
        <div className="relative">
          <NeckMorphSVG />

          {/* Header text positioned in the neck */}
          <div
            className="absolute inset-0 flex items-center justify-center text-center px-6 mt-[10%] z-30"
            style={{
              left: `${(400 / 1440) * 100}%`,
              width: `${((1040 - 400) / 1440) * 100}%`,
            }}
          >
            <Reveal>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-3">Agent Classes</p>
                <h2 className="font-display text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-[#1A1A2E] mb-3">
                  Four tiers of <em className="italic">autonomous</em> intelligence
                </h2>
                <p className="text-[13px] md:text-[15px] text-[#706F84] leading-relaxed max-w-[460px] mx-auto">
                  Each class tuned for different volume targets, risk profiles, and capital requirements.
                </p>
              </div>
            </Reveal>
          </div>
        </div>

        {/* Top-of-hole neck + cards — relative wrapper for continuous white side strips */}
        <div className="relative">
          {/* White side strips spanning neck SVG + hole area so the frame is continuous */}
          <div className="absolute top-0 bottom-0 left-0 w-3 md:w-4 bg-white z-20 pointer-events-none rounded-bl-2xl" />
          <div className="absolute top-0 bottom-0 right-0 w-3 md:w-4 bg-white z-20 pointer-events-none rounded-br-2xl" />

          {/* Top-of-hole neck — white shoulders narrow down into the transparent hole */}
          <svg
            viewBox="0 0 1440 140"
            preserveAspectRatio="none"
            className="w-full block -mt-px relative z-10"
            style={{ height: 'clamp(80px, 10vw, 140px)' }}
            aria-hidden="true"
          >
            <path
              d={[
                'M 0,20',
                'Q 0,0 20,0',
                'L 1420,0',
                'Q 1440,0 1440,20',
                'L 1440,30',
                'Q 1440,40 1420,40',
                'L 1062,40',
                'Q 1040,40 1040,62',
                'L 1040,100',
                'Q 1040,120 1018,120',
                'L 422,120',
                'Q 400,120 400,100',
                'L 400,62',
                'Q 400,40 378,40',
                'L 20,40',
                'Q 0,40 0,30',
                'L 0,20',
                'Z',
              ].join(' ')}
              fill="#FFFFFF"
            />
          </svg>

          {/* Concave corner pieces at the top of the hole */}
          <div className="absolute left-3 md:left-4 w-5 h-5 overflow-hidden pointer-events-none z-30" style={{ top: 'clamp(23px, calc(2.86vw), 40px)' }}>
            <div className="absolute top-0 left-0 w-10 h-10 rounded-full" style={{ boxShadow: '0 0 0 20px #FFFFFF' }} />
          </div>
          <div className="absolute right-3 md:right-4 w-5 h-5 overflow-hidden pointer-events-none z-30" style={{ top: 'clamp(23px, calc(2.86vw), 40px)' }}>
            <div className="absolute top-0 right-0 w-10 h-10 rounded-full" style={{ boxShadow: '0 0 0 20px #FFFFFF' }} />
          </div>

          {/* Concave corner pieces at the bottom of the hole (flipped vertically) */}
          <div className="absolute left-3 md:left-4 w-5 h-5 overflow-hidden pointer-events-none z-30" style={{ bottom: 'clamp(21px, calc(5vw - 19px), 51px)' }}>
            <div className="absolute bottom-0 left-0 w-10 h-10 rounded-full" style={{ boxShadow: '0 0 0 20px #FFFFFF' }} />
          </div>
          <div className="absolute right-3 md:right-4 w-5 h-5 overflow-hidden pointer-events-none z-30" style={{ bottom: 'clamp(21px, calc(5vw - 19px), 51px)' }}>
            <div className="absolute bottom-0 right-0 w-10 h-10 rounded-full" style={{ boxShadow: '0 0 0 20px #FFFFFF' }} />
          </div>

          {/* Cards area: white frame with transparent hole showing page bg */}
          <div className="-mt-px overflow-hidden rounded-b-2xl md:rounded-b-[20px] relative z-10">
            <section className="px-3 md:px-4 pb-3 md:pb-4">
              {/* Transparent hole — box-shadow creates the white frame, bg is see-through */}
              <div
                className="p-4 md:p-6 relative"
                style={{ boxShadow: '0 0 0 120px #FFFFFF' }}
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {[
                    { name: 'Lite', ordinal: 'I', accent: '#94A3B8', accentRgb: '148,163,184', vol: '0.5–2 ETH/d', dep: '0.05 ETH', fee: '3%', desc: 'Baseline activity, tight risk controls.', popular: false },
                    { name: 'Core', ordinal: 'II', accent: '#7B3FE4', accentRgb: '123,63,228', vol: '2–10 ETH/d', dep: '0.2 ETH', fee: '5%', desc: 'Steady volume, DexScreener visibility.', popular: true },
                    { name: 'Pro', ordinal: 'III', accent: '#6366F1', accentRgb: '99,102,241', vol: '10–50 ETH/d', dep: '1 ETH', fee: '7%', desc: 'Multi-wallet, institutional-grade.', popular: false },
                    { name: 'Ultra', ordinal: 'IV', accent: '#C4B5FD', accentRgb: '196,181,253', vol: '50–200+ ETH/d', dep: '5 ETH', fee: '10%', desc: 'Maximum capacity, whale operations.', popular: false },
                  ].map((cls, i) => (
                    <Reveal key={cls.name} delay={i * 80}>
                      <div className="relative h-full">
                        {/* Glow behind popular card */}
                        {cls.popular && (
                          <div className="absolute -inset-3 rounded-[24px] blur-2xl pointer-events-none" style={{ background: `rgba(${cls.accentRgb}, 0.18)` }} />
                        )}
                        <div
                          className={`relative p-4 md:p-5 h-full cursor-pointer transition-all duration-200 hover:-translate-y-1 overflow-hidden rounded-xl ${cls.popular
                              ? 'ring-1 ring-white/30 hover:ring-white/40 hover:shadow-[0_8px_40px_rgba(123,63,228,0.3)]'
                              : 'hover:shadow-[0_8px_30px_rgba(123,63,228,0.12)]'
                            }`}
                          style={{
                            background: cls.popular
                              ? 'rgba(255,255,255,0.08)'
                              : 'rgba(255,255,255,0.04)',
                            backdropFilter: 'blur(32px) saturate(200%) brightness(1.1)',
                            WebkitBackdropFilter: 'blur(32px) saturate(200%) brightness(1.1)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            boxShadow: cls.popular
                              ? `0 4px 30px rgba(123,63,228,0.15), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 0 20px rgba(255,255,255,0.03)`
                              : `0 2px 20px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.20), inset 0 0 20px rgba(255,255,255,0.02)`,
                          }}
                        >
                          {/* Diagonal shine streak — the light catching the glass */}
                          <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{
                              background: 'linear-gradient(115deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 25%, transparent 45%, transparent 65%, rgba(255,255,255,0.02) 85%, rgba(255,255,255,0.08) 100%)',
                            }}
                          />
                          {/* Top edge glare — simulates light hitting glass edge */}
                          <div
                            className="absolute top-0 left-[10%] right-[10%] h-[1px] pointer-events-none rounded-full"
                            style={{
                              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                            }}
                          />
                          {/* Ultraviolet tint overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{
                              background: `linear-gradient(160deg, rgba(${cls.accentRgb}, 0.08) 0%, transparent 40%, rgba(${cls.accentRgb}, 0.03) 100%)`,
                            }}
                          />

                          {/* Large ordinal watermark */}
                          <div
                            className="absolute -bottom-3 -right-1 font-display text-[6rem] md:text-[7rem] font-bold leading-none pointer-events-none select-none"
                            style={{ color: `rgba(${cls.accentRgb}, 0.07)` }}
                          >
                            {cls.ordinal}
                          </div>

                          {/* Content */}
                          <div className="relative">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cls.accent, boxShadow: `0 0 8px rgba(${cls.accentRgb}, 0.5)` }} />
                              <h3
                                className="text-xs md:text-sm font-semibold tracking-[-0.01em] text-white/90"
                                style={{ textShadow: `0 0 20px rgba(${cls.accentRgb}, 0.3)` }}
                              >
                                {cls.name}
                              </h3>
                              {cls.popular && (
                                <span className="text-[8px] md:text-[9px] uppercase tracking-[0.1em] font-bold px-2 md:px-2.5 py-1 rounded-full leading-none text-white" style={{ background: `linear-gradient(135deg, ${cls.accent}, #A78BFA)`, boxShadow: `0 0 16px rgba(${cls.accentRgb}, 0.4), 0 2px 4px rgba(0,0,0,0.2)` }}>Popular</span>
                              )}
                            </div>
                            <p className="text-[11px] md:text-xs text-white/40 leading-relaxed mb-4">{cls.desc}</p>
                            <div className="space-y-2 pt-3 border-t border-white/[0.10]">
                              <Row label="Volume" value={cls.vol} dark />
                              <Row label="Min Deposit" value={cls.dep} dark />
                              <Row label="Protocol Fee" value={cls.fee} dark />
                            </div>
                          </div>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>

                {/* Bottom neck inside the hole — white shoulders narrow the dark area into a neck */}
                <svg
                  viewBox="0 0 1440 120"
                  preserveAspectRatio="none"
                  className="block -mb-4 md:-mb-6 rounded-b-2xl"
                  style={{ height: 'clamp(40px, 5vw, 70px)', width: 'calc(100% + 8rem)', marginLeft: '-4rem', marginRight: '-4rem' }}
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d={[
                      /* Outer rect with rounded bottom corners — white fill */
                      'M 0,0',
                      'L 1440,0',
                      'L 1440,90',
                      'Q 1440,120 1410,120',
                      'L 30,120',
                      'Q 0,120 0,90',
                      'Z',
                      /* Inner cutout — transparent neck shape */
                      'M 0,0',
                      'L 0,40',
                      'Q 0,60 20,60',
                      'L 378,60',
                      'Q 400,60 400,82',
                      'L 400,100',
                      'Q 400,120 422,120',
                      'L 1018,120',
                      'Q 1040,120 1040,100',
                      'L 1040,82',
                      'Q 1040,60 1062,60',
                      'L 1420,60',
                      'Q 1440,60 1440,40',
                      'L 1440,0',
                      'Z',
                    ].join(' ')}
                    fill="#FFFFFF"
                  />
                </svg>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ══ DARK: Economics ═════════════════════════════════════ */}
      <section id="economics" className="relative py-16 md:py-24 overflow-hidden">
        <div className="section-glow section-glow-rose" style={{ bottom: '-10%', left: '10%' }} aria-hidden="true" />

        <div className="max-w-[1100px] mx-auto px-6 relative z-[1]">
          {/* Text left + fee cards right */}
          <div className="flex flex-col lg:flex-row gap-8 md:gap-10">
            <Reveal className="lg:w-[40%] flex flex-col justify-center">
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-4">Fee Model</p>
                <h2 className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-white mb-4">
                  Your liquidity, <em className="italic">your</em> fees
                </h2>
                <p className="text-[15px] text-[#878285] leading-relaxed mb-6">
                  EigenSwarm deploys a dedicated LP pool for your token. Every trade your Eigen executes generates fees that flow directly to you — not split with infrastructure providers.
                </p>
                <p className="text-xs text-[#505659] pt-4 border-t border-white/10">
                  Protocol fee on positive P&L only: 3% (Lite) to 10% (Ultra) by agent class.
                </p>
              </div>
            </Reveal>

            {/* Unified white shape — two panels, left UP / right DOWN, joined with concave curves */}
            <Reveal className="lg:w-[60%]">
              {/* Desktop: offset panels as one organic shape */}
              <div className="relative hidden lg:flex" style={{ height: 340 }}>
                {/* Left panel — shifted UP */}
                <div
                  className="absolute left-0 bg-white p-7 flex flex-col justify-center text-center z-[2]"
                  style={{
                    top: 0,
                    width: '56%',
                    height: 260,
                    borderRadius: '28px 28px 0 28px',
                  }}
                >
                  <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-semibold mb-3">EigenSwarm Pool</p>
                  <div className="font-mono text-6xl xl:text-7xl font-bold leading-none mb-2" style={{ background: 'linear-gradient(135deg, #1A1A2E 40%, #7B3FE4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>100%</div>
                  <div className="text-sm font-medium text-[#1A1A2E] mb-2">Direct to you</div>
                  <div className="text-xs text-[#706F84] leading-relaxed">Your dedicated LP pool. Every fee from every trade flows straight to your wallet.</div>
                </div>

                {/* Right panel — shifted DOWN */}
                <div
                  className="absolute right-0 bg-white p-7 flex flex-col justify-center z-[1]"
                  style={{
                    bottom: 0,
                    width: '44%',
                    height: 260,
                    borderRadius: '0 28px 28px 28px',
                  }}
                >
                  <p className="text-[11px] uppercase tracking-[0.15em] text-[#706F84] font-semibold mb-4">nad.fun Pool</p>
                  <div className="space-y-3 mb-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#706F84]">Creator</span>
                      <span className="font-mono font-medium text-[#1A1A2E]">40%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#706F84]">EigenSwarm</span>
                      <span className="font-mono font-medium text-[#1A1A2E]">40%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#706F84]">nad.fun</span>
                      <span className="font-mono font-medium text-[#1A1A2E]">20%</span>
                    </div>
                  </div>
                  <div className="text-xs text-[#706F84]">Standard nad.fun pool fee split</div>
                </div>

                {/* Top concave corner — cutout at top-right */}
                <div
                  className="absolute z-[3] pointer-events-none"
                  style={{
                    left: '56%',
                    top: 80 - 28,
                    width: 28,
                    height: 28,
                    background: 'radial-gradient(circle 28px at 28px 0px, transparent 27px, white 28px)',
                  }}
                />

                {/* Bottom concave corner — cutout at bottom-left */}
                <div
                  className="absolute z-[3] pointer-events-none"
                  style={{
                    left: 'calc(56% - 28px)',
                    top: 260,
                    width: 28,
                    height: 28,
                    background: 'radial-gradient(circle 28px at 0px 28px, transparent 27px, white 28px)',
                  }}
                />
              </div>

              {/* Mobile fallback — stacked cards */}
              <div className="lg:hidden grid grid-cols-2 gap-3 items-stretch">
                <div className="bg-white rounded-[20px] p-5 flex flex-col justify-center text-center">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-[#7B3FE4] font-semibold mb-2">EigenSwarm Pool</p>
                  <div className="font-mono text-4xl font-bold leading-none mb-1" style={{ background: 'linear-gradient(135deg, #1A1A2E 40%, #7B3FE4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>100%</div>
                  <div className="text-xs font-medium text-[#1A1A2E] mb-1">Direct to you</div>
                  <div className="text-[10px] text-[#706F84] leading-relaxed">Every fee flows straight to your wallet.</div>
                </div>
                <div className="bg-white/[0.06] border border-white/[0.08] rounded-[20px] p-5 flex flex-col justify-center text-center">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">nad.fun Pool</p>
                  <div className="space-y-1.5 mb-2">
                    <div className="flex items-center justify-between text-xs"><span className="text-white/35">Creator</span><span className="font-mono font-medium text-white/50">40%</span></div>
                    <div className="flex items-center justify-between text-xs"><span className="text-white/35">EigenSwarm</span><span className="font-mono font-medium text-white/50">40%</span></div>
                    <div className="flex items-center justify-between text-xs"><span className="text-white/35">nad.fun</span><span className="font-mono font-medium text-white/50">20%</span></div>
                  </div>
                  <div className="text-[10px] text-white/25">Standard fee split</div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══ DARK: Features — organic shape ═══════════════════════ */}
      <OrganicCapabilities />

      {/* FAQ and CTA sections removed */}

      {/* ══ FOOTER — organic white with rounded top ═══════════ */}
      <div className="organic-footer mt-8 md:mt-12 mx-3 sm:mx-5 md:mx-8 lg:mx-12">
        <footer className="max-w-[1100px] mx-auto px-6 pt-16 pb-10 md:pt-20 md:pb-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-14">
            <Col title="Product" items={['Fleet Dashboard|/app', 'Deploy Eigen|/app/deploy', 'Launch Token|/app/launch', 'History|/app/history']} />
            <Col title="Resources" items={['Documentation|/docs', 'Agent Classes|#agents', 'Agent Integration|/agents', 'API Reference|/docs']} />
            <Col title="Community" items={['X (Twitter)|#', 'Farcaster|#', 'Telegram|#']} />
            <Col title="Legal" items={['Terms|#', 'Privacy|#']} />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-[#E8E6E0]">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm logo" className="h-9 w-9" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/eigenswarm-wordmark.svg" alt="EigenSwarm" className="h-12 footer-wordmark" />
            </div>
            <p className="text-xs text-[#B8B7C8]">&copy; 2025 EigenSwarm. Built on Monad. Powered by nad.fun.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── Neck Morph SVG — scroll-triggered wobble entrance ──────────── */

function NeckMorphSVG() {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<SVGAnimateElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !played.current) {
        played.current = true;
        animRef.current?.beginElement();
      }
    }, { threshold: 0.15 });
    obs.observe(svg);
    return () => obs.disconnect();
  }, []);

  const neckFinal = 'M 0,220 L 0,180 Q 0,160 20,160 L 378,160 Q 400,160 400,138 L 400,22 Q 400,0 422,0 L 1018,0 Q 1040,0 1040,22 L 1040,138 Q 1040,160 1062,160 L 1420,160 Q 1440,160 1440,180 L 1440,220 Z';
  const neckFull = 'M 0,220 L 0,0 Q 0,0 20,0 L 378,0 Q 400,0 400,0 L 400,0 Q 400,0 422,0 L 1018,0 Q 1040,0 1040,0 L 1040,0 Q 1040,0 1062,0 L 1420,0 Q 1440,0 1440,0 L 1440,220 Z';
  const neckSettle = 'M 0,220 L 0,186 Q 0,170 20,170 L 378,170 Q 400,170 400,150 L 400,32 Q 400,10 422,10 L 1018,10 Q 1040,10 1040,32 L 1040,150 Q 1040,170 1062,170 L 1420,170 Q 1440,170 1440,186 L 1440,220 Z';

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1440 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full block"
      preserveAspectRatio="none"
      style={{ height: 'clamp(70px, 9vw, 120px)' }}
    >
      <path d={neckFull} fill="#FFFFFF">
        <animate
          ref={animRef}
          attributeName="d"
          dur="1.8s"
          fill="freeze"
          begin="indefinite"
          values={[neckFull, neckSettle, neckFinal].join(';')}
          keyTimes="0;0.7;1"
          calcMode="spline"
          keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        />
      </path>
    </svg>
  );
}

/* ── Organic Recessed Platform Nav ──────────────────────────────── */

/**
 * Floating recessed platform navbar — a single continuous SVG shape.
 *
 * Visual: dark page bg is fully visible at top. Below a clear margin,
 * a white shape spans the full viewport width. It has large rounded
 * outer edges on left/right, curves inward concavely toward center,
 * forming a rounded horizontal platform where the nav content sits.
 *
 * Think: a pill-shaped navbar stretched full width with concave
 * curves on both inner sides — like a saddle or a recessed tray.
 *
 * viewBox: 0 0 1440 80
 *   - The shape is widest/tallest on the far left and far right edges
 *   - It dips concavely toward center, then a flat-ish platform center
 *   - Bottom edge is flat (connects to hero below)
 *
 * Path geometry:
 *   Start at top-left (0,0). Go to rounded outer left corner (0,60 → 40,80).
 *   Bottom flat across. Right side mirror. Top-right rounded (1440,0).
 *   Top edge: starts flat, curves DOWN concavely to center, back up.
 *   This creates the "recessed" look — sides are tall, center is lower.
 */

function OrganicNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 180);
      const sections = ['protocol', 'agents', 'economics'];
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top < 200 && rect.bottom > 200) {
            setActiveSection(id);
            return;
          }
        }
      }
      setActiveSection('');
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // SVG path: pedestal shape — straight lines + rounded corners only.
  //
  // viewBox: 0 0 1440 120
  //
  // Shape cross-section (all straight edges, rounded corners):
  //
  //              ╭──────────────────╮          ← Pill top (rounded corners)
  //              │   nav content    │          ← Straight vertical sides
  //         ╭────╯                  ╰────╮     ← Rounded inner corners
  //         │        shelf               │     ← Straight horizontal shelf
  //     ────╯                            ╰──── ← Rounded outer corners
  //     ═══════════════════════════════════════ ← Full width base → hero
  //
  // Pill: x=320 → x=1120 (800px wide, centered)
  // Shelf: y=55, full width sides below that
  // All corners use Q (quadratic bezier = border-radius feel)
  const R_TOP = 20;    // pill top corner radius
  const R_INNER = 22;  // inner corner radius (shelf → pill)
  const R_OUTER = 20;  // outer bottom corner radius

  const navPath = [
    'M 0,120',                                  // bottom-left
    'L 0,82',                                    // ↑ left edge (straight)
    'Q 0,62 20,62',                              // ╭ outer-left corner → shelf
    'L 298,62',                                  // → shelf going right (straight)
    'Q 320,62 320,40',                           // ╭ inner-left corner → pill side
    'L 320,20',                                  // ↑ pill left side (straight)
    'Q 320,0 340,0',                             // ╭ pill top-left corner
    'L 1100,0',                                  // → pill top (straight)
    'Q 1120,0 1120,20',                          // ╮ pill top-right corner
    'L 1120,40',                                 // ↓ pill right side (straight)
    'Q 1120,62 1142,62',                         // ╯ inner-right corner → shelf
    'L 1420,62',                                 // → shelf going right (straight)
    'Q 1440,62 1440,82',                         // ╯ outer-right corner
    'L 1440,120',                                // ↓ right edge (straight)
    'Z',                                         // close bottom
  ].join(' ');

  // Path morph: starts as full white rectangle → smoothly contracts into pedestal
  const navFull = 'M 0,120 L 0,0 Q 0,0 20,0 L 298,0 Q 320,0 320,0 L 320,0 Q 320,0 340,0 L 1100,0 Q 1120,0 1120,0 L 1120,0 Q 1120,0 1142,0 L 1420,0 Q 1440,0 1440,0 L 1440,120 Z';
  // Slight overshoot past final (just a touch too recessed, then settles)
  const navSettle = 'M 0,120 L 0,86 Q 0,68 20,68 L 298,68 Q 320,68 320,46 L 320,26 Q 320,6 340,6 L 1100,6 Q 1120,6 1120,26 L 1120,46 Q 1120,68 1142,68 L 1420,68 Q 1440,68 1440,86 L 1440,120 Z';
  const navMorphValues = [navFull, navSettle, navPath].join(';');

  return (
    <>
      {/* ── Static organic recessed platform at top of page ──── */}
      <div className="relative z-[3]" style={{ paddingTop: 'clamp(16px, 2.5vw, 32px)' }}>
        <div
          className="relative mx-3 sm:mx-5 md:mx-8 lg:mx-12"
          style={{ height: 'clamp(70px, 8vw, 120px)' }}
        >
          {/* The SVG shape — pedestal with straight edges + rounded corners */}
          <svg
            viewBox="0 0 1440 120"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            <path d={navFull} fill="#FFFFFF">
              <animate
                attributeName="d"
                dur="1.6s"
                fill="freeze"
                begin="0.15s"
                values={navMorphValues}
                keyTimes="0;0.7;1"
                calcMode="spline"
                keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
              />
            </path>
          </svg>

          {/* Nav content — three zones: logo (left dark), links (center pill), CTA (right dark) */}
          <div className="absolute inset-0">
            {/* Full-width flex: logo on left shelf, links in center pill, CTA on right shelf */}
            <div className="h-full flex items-stretch">
              {/* LEFT SHELF (dark area) — Logo */}
              {/* ~22% of width matches the left shelf in SVG (0–320 of 1440) */}
              <div className="hidden md:flex items-center justify-center" style={{ width: '22.2%' }}>
                <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 -mt-20 anim-drop-in" style={{ animationDelay: '0.6s' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm logo" className="h-9 w-9 md:h-10 md:w-10" style={{ filter: 'brightness(0) saturate(100%) invert(96%) sepia(5%) saturate(200%) hue-rotate(15deg) brightness(1.02)' }} />
                  <span className="font-display text-[1.6rem] tracking-[-0.02em] text-[#F5F3EE] hidden lg:block">EigenSwarm</span>
                </Link>
              </div>

              {/* CENTER PILL (white area) — Nav links */}
              {/* ~55.5% of width matches the pill in SVG (320–1120 of 1440) */}
              <div className="flex-1 md:flex-none flex items-center justify-center" style={{ width: '55.6%' }}>
                <div className="hidden md:flex items-center gap-1 -mt-10">
                  <a href="#" className={`organic-nav-link anim-drop-in ${activeSection === '' ? 'active' : ''}`} style={{ animationDelay: '0.9s' }}>Home</a>
                  <a href="#protocol" className={`organic-nav-link anim-drop-in ${activeSection === 'protocol' ? 'active' : ''}`} style={{ animationDelay: '0.95s' }}>Protocol</a>
                  <a href="#agents" className={`organic-nav-link anim-drop-in ${activeSection === 'agents' ? 'active' : ''}`} style={{ animationDelay: '1s' }}>Agents</a>
                  <a href="#economics" className={`organic-nav-link anim-drop-in ${activeSection === 'economics' ? 'active' : ''}`} style={{ animationDelay: '1.05s' }}>Economics</a>
                  <Link href="/docs" className="organic-nav-link anim-drop-in" style={{ animationDelay: '1.1s' }}>Docs</Link>
                </div>

                {/* Mobile: logo + hamburger in center pill */}
                <div className="flex md:hidden items-center justify-between w-full px-4 -mt-20">
                  <Link href="/" className="flex items-center gap-2 flex-shrink-0 anim-drop-in" style={{ animationDelay: '0.6s' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm" className="h-7 w-7" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logos/eigenswarm-wordmark.svg" alt="EigenSwarm" className="h-4 nav-wordmark" />
                  </Link>
                  <button className="p-2 text-[#706F84] anim-drop-in" style={{ animationDelay: '0.8s' }} onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      {mobileOpen ? (
                        <path d="M5 5l10 10M15 5L5 15" />
                      ) : (
                        <>
                          <line x1="3" y1="6" x2="17" y2="6" />
                          <line x1="3" y1="10" x2="17" y2="10" />
                          <line x1="3" y1="14" x2="17" y2="14" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* RIGHT SHELF (dark area) — CTA */}
              {/* ~22% of width matches the right shelf in SVG (1120–1440 of 1440) */}
              <div className="hidden md:flex items-center justify-center" style={{ width: '22.2%' }}>
                <Link href="/app" className="inline-flex items-center gap-2 bg-white text-[#1A1A2E] rounded-lg px-4 py-2 text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all -mt-20 anim-drop-in" style={{ animationDelay: '0.7s' }}>
                  Launch App
                  <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#7B3FE4] to-[#A78BFA] flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile menu — drops down from curve */}
        {mobileOpen && (
          <div className="md:hidden mx-4 mt-1 rounded-2xl bg-white border border-[#E8E6E0] shadow-lg p-4 relative z-10">
            <div className="flex flex-col gap-1">
              <a href="#" className="text-sm text-[#706F84] hover:text-[#1A1A2E] py-2.5 min-h-[44px] flex items-center transition-colors" onClick={() => setMobileOpen(false)}>Home</a>
              <a href="#protocol" className="text-sm text-[#706F84] hover:text-[#1A1A2E] py-2.5 min-h-[44px] flex items-center transition-colors" onClick={() => setMobileOpen(false)}>Protocol</a>
              <a href="#agents" className="text-sm text-[#706F84] hover:text-[#1A1A2E] py-2.5 min-h-[44px] flex items-center transition-colors" onClick={() => setMobileOpen(false)}>Agents</a>
              <a href="#economics" className="text-sm text-[#706F84] hover:text-[#1A1A2E] py-2.5 min-h-[44px] flex items-center transition-colors" onClick={() => setMobileOpen(false)}>Economics</a>
              <Link href="/docs" className="text-sm text-[#706F84] hover:text-[#1A1A2E] py-2.5 min-h-[44px] flex items-center transition-colors" onClick={() => setMobileOpen(false)}>Documentation</Link>
              <Link href="/app" className="mt-2 inline-flex items-center justify-center gap-2 bg-[#1A1A2E] text-white rounded-full px-4 py-2.5 text-sm font-medium min-h-[44px]" onClick={() => setMobileOpen(false)}>
                Launch App
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky fallback nav — appears when scrolled past curve ── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
      >
        <div className="py-3 flex justify-center">
          <div className="pill-nav-container">
            <Link href="/" className="flex items-center gap-2 px-3 flex-shrink-0" aria-label="EigenSwarm home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm" className="h-6 w-6" />
            </Link>
            <a href="#" className={`pill-nav-link ${activeSection === '' ? 'active' : ''}`}>Home</a>
            <a href="#protocol" className={`pill-nav-link ${activeSection === 'protocol' ? 'active' : ''}`}>Protocol</a>
            <a href="#agents" className={`pill-nav-link ${activeSection === 'agents' ? 'active' : ''}`}>Agents</a>
            <a href="#economics" className={`pill-nav-link ${activeSection === 'economics' ? 'active' : ''}`}>Economics</a>
            <Link href="/docs" className="pill-nav-link">Docs</Link>
            <Link href="/app" className="nav-cta-pill ml-1">
              App
              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#7B3FE4] to-[#A78BFA] flex items-center justify-center flex-shrink-0">
                <svg width="8" height="8" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </Link>
          </div>
        </div>
      </nav>
    </>
  );
}

/* ── Install Section (dark bg context) ────────────────────────────── */

function InstallSectionDark() {
  const [mode, setMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState(false);
  const agentSnippet = 'curl -s https://eigenswarm.xyz/skill.md';

  const copy = () => {
    navigator.clipboard.writeText(agentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Reveal>
      <div className="relative overflow-hidden">
        <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-3">Get Started</p>
        <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-[-0.02em] text-white mb-6">
          Deploy your first <em className="italic">swarm</em>
        </h2>
        <div className="mb-5">
          <div className="inline-flex bg-white/8 border border-white/10 rounded-lg p-1 gap-0.5">
            <button onClick={() => setMode('human')} className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${mode === 'human' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'}`}>Human</button>
            <button onClick={() => setMode('agent')} className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${mode === 'agent' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'}`}>AI Agent</button>
          </div>
        </div>

        {mode === 'human' ? (
          <>
            <p className="text-sm font-medium text-[#878285] mb-3">If you are a human:</p>
            <Link href="/app" className="inline-flex items-center gap-3 bg-white text-[#1A1A2E] rounded-lg px-6 py-3 text-[15px] font-medium hover:shadow-lg hover:-translate-y-0.5 transition-all mb-4">
              Enter App
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7B3FE4] to-[#A78BFA] flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </Link>
            <ol className="list-none p-0 m-0 flex flex-col gap-1.5 mt-4">
              <li className="text-[13px] text-[#878285] leading-relaxed flex items-baseline gap-2"><span className="font-mono text-xs text-[#505659]">1.</span><span>Launch a new token with an eigen or deploy on an existing one</span></li>
              <li className="text-[13px] text-[#878285] leading-relaxed flex items-baseline gap-2"><span className="font-mono text-xs text-[#505659]">2.</span><span>Fund the vault and your agent starts market making immediately</span></li>
            </ol>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-[#878285] mb-3">Give your agent this command:</p>
            <div className="flex items-start gap-3 bg-white/6 border border-white/10 rounded-lg px-4 py-3 mb-4">
              <pre className="flex-1 m-0 font-mono text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap break-all"><code>{agentSnippet}</code></pre>
              <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/50 bg-white/8 border border-white/10 rounded-md hover:text-white/80 hover:border-white/20 transition-all flex-shrink-0 cursor-pointer" aria-label="Copy to clipboard">
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.2" /></svg>
                )}
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <ol className="list-none p-0 m-0 flex flex-col gap-2">
              <li className="text-[13px] text-[#878285] leading-relaxed flex items-baseline gap-2"><span className="font-mono text-xs text-[#505659]">1.</span><span>Agent reads the skill manifest with full API spec and payment addresses</span></li>
              <li className="text-[13px] text-[#878285] leading-relaxed flex items-baseline gap-2"><span className="font-mono text-xs text-[#505659]">2.</span><span>Agent calls the API, sends USDC on Monad via x402 protocol</span></li>
              <li className="text-[13px] text-[#878285] leading-relaxed flex items-baseline gap-2"><span className="font-mono text-xs text-[#505659]">3.</span><span>Keeper swaps USDC to MON and deploys a market-making eigen autonomously</span></li>
            </ol>
            <p className="text-[12px] text-[#505659] mt-3">Starting from 1 USDC. Monad-first, with multi-chain support coming soon.</p>
          </>
        )}
      </div>
    </Reveal>
  );
}

/* ── Install Section (adapted for white bg context) ──────────────── */

function InstallSection() {
  const [mode, setMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState(false);
  const agentSnippet = 'curl -s https://eigenswarm.xyz/skill.md';

  const copy = () => {
    navigator.clipboard.writeText(agentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Reveal>
      <div className="relative overflow-hidden">
        <CornerPuzzle />
        <p className="text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-3">Get Started</p>
        <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-[-0.02em] text-[#1A1A2E] mb-6">
          Deploy your first <em className="italic">swarm</em>
        </h2>
        <div className="mb-5">
          <div className="install-toggle">
            <button onClick={() => setMode('human')} className={`install-toggle-btn ${mode === 'human' ? 'active' : ''}`}>Human</button>
            <button onClick={() => setMode('agent')} className={`install-toggle-btn ${mode === 'agent' ? 'active' : ''}`}>AI Agent</button>
          </div>
        </div>

        {mode === 'human' ? (
          <>
            <p className="text-sm font-medium text-[#1A1A2E] mb-3">If you are a human:</p>
            <Link href="/app" className="cta-pill mb-4 inline-flex">
              Enter App
              <span className="cta-pill-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </Link>
            <ol className="install-steps mt-4">
              <li><span className="install-step-num">1.</span><span>Launch a new token with an eigen or deploy on an existing one</span></li>
              <li><span className="install-step-num">2.</span><span>Fund the vault and your agent starts market making immediately</span></li>
            </ol>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-[#1A1A2E] mb-3">Give your agent this command:</p>
            <div className="install-code-block">
              <pre className="install-code"><code>{agentSnippet}</code></pre>
              <button onClick={copy} className="install-copy-btn" aria-label="Copy to clipboard">
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.2" /></svg>
                )}
                <span className="text-xs">{copied ? 'copied' : 'copy'}</span>
              </button>
            </div>
            <ol className="install-steps">
              <li><span className="install-step-num">1.</span><span>Agent reads the skill manifest with full API spec and payment addresses</span></li>
              <li><span className="install-step-num">2.</span><span>Agent calls the API, sends USDC on Monad via x402 protocol</span></li>
              <li><span className="install-step-num">3.</span><span>Keeper swaps USDC to MON and deploys a market-making eigen autonomously</span></li>
            </ol>
            <p className="text-[12px] text-[#706F84] mt-3">Starting from 1 USDC. Monad-first, with multi-chain support coming soon.</p>
          </>
        )}
      </div>
    </Reveal>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function Row({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={dark ? 'text-white/35' : 'text-[#706F84]'}>{label}</span>
      <span className={`font-mono ${dark ? 'text-white/70' : 'text-[#1A1A2E]'}`}>{value}</span>
    </div>
  );
}

function Col({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-[0.12em] text-[#B8B7C8] font-medium mb-4">{title}</h4>
      <ul className="space-y-2">
        {items.map((item) => {
          const [label, href] = item.split('|');
          return <li key={label}><Link href={href} className="text-sm text-[#706F84] hover:text-[#1A1A2E] transition-colors">{label}</Link></li>;
        })}
      </ul>
    </div>
  );
}
