'use client';

function SkeletonPulse({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-bg-hover rounded ${className}`} />
  );
}

export function SkeletonStatStrip() {
  return (
    <div className="bg-bg-alt rounded-xl p-6 border border-border-subtle">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonPulse className="h-3 w-20" />
            <SkeletonPulse className="h-5 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-border-subtle overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 border-b border-border-subtle bg-bg-elevated">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonPulse key={i} className="h-3 w-16 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 px-4 py-3 border-b border-border-subtle/60">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <SkeletonPulse
              key={colIdx}
              className={`h-4 flex-1 ${colIdx === 0 ? 'w-24' : 'w-16'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-4">
      <SkeletonPulse className="h-4 w-32" />
      <div className="space-y-3">
        <SkeletonPulse className="h-3 w-full" />
        <SkeletonPulse className="h-3 w-3/4" />
        <SkeletonPulse className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonEigenDetail() {
  return (
    <>
      {/* Padded header content — mirrors loaded state */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-6 space-y-4">
        {/* Header row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SkeletonPulse className="h-6 w-24" />
            <SkeletonPulse className="h-5 w-20 rounded-md" />
            <SkeletonPulse className="h-5 w-16 rounded-full" />
            <SkeletonPulse className="h-5 w-14 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonPulse className="h-8 w-20 rounded-lg" />
            <SkeletonPulse className="h-8 w-16 rounded-lg" />
            <div className="h-5 w-px bg-border-subtle mx-1" />
            <SkeletonPulse className="h-8 w-36 rounded-lg" />
          </div>
        </div>
        {/* Runtime bar */}
        <SkeletonPulse className="h-10 w-full rounded-lg" />
      </div>
    </>
  );
}

/** Full-page skeleton including the 2x2 grid below the shell */
export function SkeletonEigenGrid() {
  return (
    <div className="relative z-[3] lg:-mt-[8px]">
      <div className="grid grid-cols-1 lg:grid-cols-[44%_56%] gap-6 lg:gap-0">
        {/* Top-left: dark area — chart + trade tape */}
        <div className="order-1 lg:col-start-1 lg:row-start-1 p-5 lg:p-6 lg:pl-8 lg:pr-[72px]">
          <div className="flex items-end justify-between px-1 pt-1 pb-3">
            <div className="space-y-1">
              <SkeletonPulse className="h-3 w-16 !bg-white/10" />
              <SkeletonPulse className="h-7 w-24 !bg-white/10" />
            </div>
            <div className="text-right space-y-1">
              <SkeletonPulse className="h-3 w-16 ml-auto !bg-white/10" />
              <SkeletonPulse className="h-7 w-28 ml-auto !bg-white/10" />
              <div className="flex justify-end gap-0.5 mt-1.5">
                {['1h', '4h', '1d', '7d', '30d'].map((r) => (
                  <div key={r} className="px-2 py-0.5 text-[10px] font-mono text-white/20">{r}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(123,63,228,0.15)', background: 'rgba(15,17,23,0.85)' }}>
            <div className="h-[300px] animate-pulse bg-white/[0.03]" />
            <div className="flex items-center justify-between px-4 py-1.5" style={{ borderTop: '1px solid rgba(123,63,228,0.15)', borderBottom: '1px solid rgba(123,63,228,0.15)', background: 'rgba(123,63,228,0.06)' }}>
              <SkeletonPulse className="h-3 w-20 !bg-white/10" />
              <SkeletonPulse className="h-4 w-6 rounded-full !bg-white/10" />
            </div>
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-[6px]" style={{ borderBottom: '1px solid rgba(123,63,228,0.10)' }}>
                  <SkeletonPulse className="h-3 w-12 !bg-white/10" />
                  <SkeletonPulse className="h-3 w-8 !bg-white/10" />
                  <SkeletonPulse className="h-3 w-20 flex-1 !bg-white/10" />
                  <SkeletonPulse className="h-3 w-12 !bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top-right: white card — analytics */}
        <div className="order-2 lg:col-start-2 lg:row-start-1 float-card merged-panel-tr !shadow-none p-5 lg:p-6 lg:pr-8">
          <svg className="hidden lg:block absolute top-[7px] -left-[56px]" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
            <path d="M0,0 L56,0 L56,56 A56,56 0 0,0 0,0Z" fill="#FFFFFF" />
          </svg>
          {/* Volume hero */}
          <div className="rounded-xl bg-gradient-to-br from-eigen-violet-wash/50 to-transparent p-4 mb-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <SkeletonPulse className="h-3 w-28" />
                <SkeletonPulse className="h-8 w-40" />
                <SkeletonPulse className="h-4 w-24" />
              </div>
              <div className="text-right space-y-3">
                <div className="space-y-1">
                  <SkeletonPulse className="h-3 w-20 ml-auto" />
                  <SkeletonPulse className="h-5 w-28 ml-auto" />
                </div>
                <div className="space-y-1">
                  <SkeletonPulse className="h-3 w-16 ml-auto" />
                  <SkeletonPulse className="h-5 w-16 ml-auto" />
                </div>
              </div>
            </div>
          </div>
          {/* Chart placeholders */}
          <div className="grid grid-cols-1 gap-4">
            <div className="p-5">
              <SkeletonPulse className="h-3 w-28 mb-3" />
              <SkeletonPulse className="h-[180px] rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-5">
                <SkeletonPulse className="h-3 w-24 mb-3" />
                <SkeletonPulse className="h-[160px] rounded-lg" />
              </div>
              <div className="p-5">
                <SkeletonPulse className="h-3 w-28 mb-3" />
                <SkeletonPulse className="h-[160px] rounded-lg" />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom-left: white card — metrics + actions */}
        <div className="order-4 lg:order-3 lg:col-start-1 lg:row-start-2 float-card merged-panel-bl !shadow-none p-5 lg:p-6 lg:pl-8">
          <div className="space-y-5">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <SkeletonPulse className="h-3 w-28" />
                <div className="space-y-1.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <SkeletonPulse className="h-3 w-24" />
                      <SkeletonPulse className="h-5 flex-1 rounded-md" />
                      <SkeletonPulse className="h-3 w-28" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <SkeletonPulse className="h-3 w-28" />
                <div className="space-y-1.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <SkeletonPulse className="h-3 w-24" />
                      <SkeletonPulse className="h-5 flex-1 rounded-md" />
                      <SkeletonPulse className="h-3 w-28" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Inventory bar */}
            <div className="border-t border-border-subtle pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <SkeletonPulse className="h-3 w-8" />
                <SkeletonPulse className="h-3 w-14" />
                <SkeletonPulse className="h-3 w-10" />
              </div>
              <SkeletonPulse className="h-3 w-full rounded-full" />
              <div className="flex items-center justify-between mt-1">
                <SkeletonPulse className="h-3 w-20" />
                <SkeletonPulse className="h-3 w-24" />
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
              <SkeletonPulse className="h-8 w-20 rounded-lg" />
              <SkeletonPulse className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        </div>

        {/* Bottom-right: dark area — stats + params */}
        <div className="order-3 lg:order-4 lg:col-start-2 lg:row-start-2 p-5 lg:p-6 lg:pr-8">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-y-3 gap-x-4 mb-5 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <SkeletonPulse className="h-3 w-16 !bg-white/10" />
                <SkeletonPulse className="h-4 w-20 !bg-white/10" />
              </div>
            ))}
          </div>
          <SkeletonPulse className="h-3 w-20 mb-3 !bg-white/10" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <SkeletonPulse className="h-3 w-20 !bg-white/10" />
                <SkeletonPulse className="h-4 w-24 !bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
