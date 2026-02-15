import { type ReactNode, forwardRef } from 'react';

interface AppPageShellProps {
  label: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  variant?: 'default' | 'full-bleed';
  bodyClassName?: string;
  compact?: boolean;
  hideHeader?: boolean;
}

/**
 * Organic island wrapper for app pages.
 *
 * The TopBar (organic recessed platform nav) has a full-width white bottom edge.
 * This component continues that white surface seamlessly with:
 * - A page header area with label + title (inside the white body)
 * - Content area below
 * - Rounded bottom corners matching the landing page's organic islands
 *
 * The -mt-px on the layout ensures this merges seamlessly with the nav above.
 *
 * variant="full-bleed" skips the max-w container so the page can manage its own layout.
 */
export const AppPageShell = forwardRef<HTMLDivElement, AppPageShellProps>(
  function AppPageShell({ label, title, subtitle, children, variant = 'default', bodyClassName, compact = false, hideHeader = false }, ref) {
    return (
      <div ref={ref} className={`app-island-body ${bodyClassName || ''}`}>
        {!hideHeader && (
          <>
            {/* Page header — unified across all tabs */}
            <div className="text-center -mt-6 pb-0.5 md:-mt-8 md:pb-1 relative z-[4]">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-[#7B3FE4] font-medium mb-0.5">
                {label}
              </p>
              <h1 className="font-display text-[clamp(1.15rem,3vw,1.6rem)] leading-[1.15] tracking-[-0.02em] text-[#1A1A2E]">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[13px] text-[#706F84] leading-relaxed mt-0.5 max-w-[460px] mx-auto">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="mx-auto w-3/5 border-b border-[#E8E6E0]" />
          </>
        )}

        {/* Page content */}
        {variant === 'full-bleed' ? (
          children
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
            {children}
          </div>
        )}
      </div>
    );
  }
);
