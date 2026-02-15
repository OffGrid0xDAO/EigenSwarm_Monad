'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'gradient' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  href?: string;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-eigen-violet text-white hover:brightness-110 active:brightness-95',
  gradient:
    'bg-gradient-to-br from-eigen-violet to-eigen-violet-deep text-white shadow-[0_2px_12px_rgba(123,63,228,0.25)] hover:shadow-[0_6px_24px_rgba(123,63,228,0.35)] hover:-translate-y-px hover:brightness-105 active:brightness-95 rounded-lg',
  secondary:
    'bg-bg-card border border-border-subtle text-txt-primary hover:border-border-hover shadow-card',
  danger:
    'bg-status-danger/10 border border-status-danger/20 text-status-danger hover:bg-status-danger/15',
  ghost:
    'bg-transparent text-txt-muted hover:text-txt-primary hover:bg-bg-elevated',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[8px] gap-1.5 md:min-h-0 min-h-[44px]',
  md: 'px-5 py-2.5 text-sm rounded-[10px] gap-2 min-h-[44px]',
  lg: 'px-7 py-3.5 text-sm rounded-[10px] gap-2.5 min-h-[44px]',
};

export const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          inline-flex items-center justify-center font-semibold transition-all duration-150
          disabled:opacity-40 disabled:cursor-not-allowed
          ${variants[variant]}
          ${sizes[size]}
          ${className}
        `}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

GlowButton.displayName = 'GlowButton';
