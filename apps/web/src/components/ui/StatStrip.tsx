'use client';

interface StatStripItem {
  label: string;
  value: string;
  delta?: string;
  deltaType?: 'positive' | 'negative' | 'neutral';
}

interface StatStripProps {
  stats: StatStripItem[];
  className?: string;
}

export function StatStrip({ stats, className = '' }: StatStripProps) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-${stats.length} gap-8 lg:gap-12 ${className}`}>
      {stats.map((stat) => {
        const deltaColor = stat.deltaType === 'positive'
          ? 'text-status-success'
          : stat.deltaType === 'negative'
            ? 'text-status-danger'
            : 'text-txt-muted';

        return (
          <div key={stat.label} className="flex flex-col gap-1 text-center">
            <span className="font-mono text-3xl lg:text-4xl font-semibold text-txt-primary tabular-nums">
              {stat.value}
            </span>
            <span className="text-[11px] font-medium text-txt-muted uppercase tracking-[0.08em]">
              {stat.label}
            </span>
            {stat.delta && (
              <span className={`font-mono text-xs tabular-nums ${deltaColor}`}>
                {stat.delta}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
