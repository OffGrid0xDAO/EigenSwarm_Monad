'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';

const navLinks = [
  { href: '/app', label: 'Fleet' },
  { href: '/app/deploy', label: 'Add Agent' },
  { href: '/app/launch', label: 'Launch Token' },
  { href: '/app/history', label: 'History' },
];

/**
 * Organic recessed platform nav for app pages.
 * Matches the landing page's OrganicNav shape exactly:
 * - Left shelf (dark area): Logo + EigenSwarm wordmark
 * - Center pill (white area): Page navigation links
 * - Right shelf (dark area): Connect Wallet button
 *
 * The SVG pedestal shape has:
 * - Full width at base (connects to content below)
 * - Shelves on left/right at y=62 (dark bg visible behind them)
 * - Center pill from x=320..1120 rising to y=0 (white, contains nav links)
 */
export function TopBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navPath = [
    'M 0,120',
    'L 0,82',
    'Q 0,62 20,62',
    'L 298,62',
    'Q 320,62 320,40',
    'L 320,20',
    'Q 320,0 340,0',
    'L 1100,0',
    'Q 1120,0 1120,20',
    'L 1120,40',
    'Q 1120,62 1142,62',
    'L 1420,62',
    'Q 1440,62 1440,82',
    'L 1440,120',
    'L 0,120',
    'Z',
  ].join(' ');

  return (
    <div className="relative z-[3]" style={{ paddingTop: 'clamp(16px, 2.5vw, 32px)' }}>
      <div
        className="relative mx-3 sm:mx-5 md:mx-8 lg:mx-12"
        style={{ height: 'clamp(54px, 6vw, 88px)' }}
      >
        {/* The SVG pedestal shape */}
        <svg
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          <path d={navPath} fill="#FFFFFF" />
        </svg>

        {/* Nav content — three zones */}
        <div className="absolute inset-0">
          <div className="h-full flex items-stretch">
            {/* LEFT SHELF (dark area) — Logo + Name */}
            <div className="hidden md:flex items-center justify-center" style={{ width: '22.2%' }}>
              <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 -mt-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/eigenswarm-icon.svg"
                  alt="EigenSwarm logo"
                  className="h-9 w-9 md:h-10 md:w-10"
                  style={{ filter: 'brightness(0) saturate(100%) invert(96%) sepia(5%) saturate(200%) hue-rotate(15deg) brightness(1.02)' }}
                />
                <span className="font-display text-[1.6rem] tracking-[-0.02em] text-[#F5F3EE] hidden lg:block">
                  EigenSwarm
                </span>
              </Link>
            </div>

            {/* CENTER PILL (white area) — Nav links */}
            <div className="flex-1 md:flex-none flex items-center justify-center" style={{ width: '55.6%' }}>
              <nav className="hidden md:flex items-center gap-1 -mt-10">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href ||
                    (link.href !== '/app' && pathname.startsWith(link.href));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`organic-nav-link ${isActive ? 'active' : ''}`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Mobile: logo + hamburger in center pill */}
              <div className="flex md:hidden items-center justify-between w-full px-4 -mt-20">
                <Link href="/" className="flex items-center gap-2 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm" className="h-7 w-7" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/eigenswarm-wordmark.svg" alt="EigenSwarm" className="h-4 nav-wordmark" />
                </Link>
                <button
                  className="p-2 text-[#706F84]"
                  onClick={() => setMobileOpen(!mobileOpen)}
                  aria-label="Toggle menu"
                >
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

            {/* RIGHT SHELF (dark area) — Connect Wallet */}
            <div className="hidden md:flex items-center justify-center" style={{ width: '22.2%' }}>
              <div className="-mt-20">
                <ConnectButton />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu — drops down from curve */}
      {mobileOpen && (
        <div className="md:hidden mx-4 mt-1 rounded-2xl bg-white border border-[#E8E6E0] shadow-lg p-4 relative z-10">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href ||
                (link.href !== '/app' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    text-sm py-2.5 min-h-[44px] flex items-center transition-colors
                    ${isActive
                      ? 'text-[#1A1A2E] font-medium'
                      : 'text-[#706F84] hover:text-[#1A1A2E]'
                    }
                  `}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-[#E8E6E0]">
            <ConnectButton />
          </div>
        </div>
      )}
    </div>
  );
}
