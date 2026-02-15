'use client';

import Link from 'next/link';

interface AnnouncementPillProps {
  text: string;
  href: string;
}

export function AnnouncementPill({ text, href }: AnnouncementPillProps) {
  return (
    <Link
      href={href}
      className="
        inline-flex items-center gap-2 px-4 py-1.5
        rounded-full border border-border-hover bg-bg-elevated/50
        text-xs font-medium text-txt-muted
        hover:border-border-hover hover:text-txt-primary
        transition-all duration-200
        backdrop-blur-sm
      "
    >
      <span className="w-1.5 h-1.5 rounded-full bg-txt-primary animate-pulse" />
      {text}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="ml-0.5">
        <path d="M4.5 2.5l3.5 3.5-3.5 3.5" />
      </svg>
    </Link>
  );
}
