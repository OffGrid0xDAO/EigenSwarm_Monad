'use client';

import { useState, type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const posClass = position === 'top'
    ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
    : 'top-full mt-2 left-1/2 -translate-x-1/2';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={`
            absolute z-50 px-2.5 py-1.5 text-xs text-txt-primary
            bg-bg-elevated border border-border-subtle rounded-lg
            shadow-lg whitespace-nowrap pointer-events-none
            ${posClass}
          `}
        >
          {content}
        </span>
      )}
    </span>
  );
}
