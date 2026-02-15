'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { GlowButton } from '@/components/ui';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`
        fixed top-0 left-0 right-0 z-50 transition-all duration-300
        ${scrolled
          ? 'bg-bg-void/90 backdrop-blur-xl border-b border-border-subtle'
          : 'bg-transparent'
        }
      `}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Wordmark */}
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/eigenswarm-icon.svg" alt="EigenSwarm logo" className="h-9 w-9" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/eigenswarm-wordmark.svg" alt="EigenSwarm" className="h-6 nav-wordmark" />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#protocol" className="text-sm text-txt-muted hover:text-txt-primary transition-colors">
              Protocol
            </a>
            <a href="#agents" className="text-sm text-txt-muted hover:text-txt-primary transition-colors">
              Agents
            </a>
            <a href="#economics" className="text-sm text-txt-muted hover:text-txt-primary transition-colors">
              Economics
            </a>
            <Link href="/docs" className="text-sm text-txt-muted hover:text-txt-primary transition-colors">
              Docs
            </Link>
            <Link href="/agents" className="text-sm text-txt-muted hover:text-txt-primary transition-colors">
              Integration
            </Link>
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center">
            <Link href="/app">
              <GlowButton size="sm">Launch App</GlowButton>
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 text-txt-muted"
            onClick={() => setMobileOpen(!mobileOpen)}
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

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 border-t border-border-subtle mt-2 pt-4">
            <div className="flex flex-col gap-1">
              <a href="#protocol" className="text-sm text-txt-muted py-2.5 min-h-[44px] flex items-center" onClick={() => setMobileOpen(false)}>
                Protocol
              </a>
              <a href="#agents" className="text-sm text-txt-muted py-2.5 min-h-[44px] flex items-center" onClick={() => setMobileOpen(false)}>
                Agents
              </a>
              <a href="#economics" className="text-sm text-txt-muted py-2.5 min-h-[44px] flex items-center" onClick={() => setMobileOpen(false)}>
                Economics
              </a>
              <Link href="/docs" className="text-sm text-txt-muted py-2.5 min-h-[44px] flex items-center" onClick={() => setMobileOpen(false)}>
                Documentation
              </Link>
              <Link href="/agents" className="text-sm text-txt-muted py-2.5 min-h-[44px] flex items-center" onClick={() => setMobileOpen(false)}>
                Integration
              </Link>
              <Link href="/app" className="mt-2" onClick={() => setMobileOpen(false)}>
                <GlowButton size="sm" className="w-full">Launch App</GlowButton>
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

