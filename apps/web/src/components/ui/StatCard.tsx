'use client';

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaType?: 'positive' | 'negative' | 'neutral';
}

export function StatCard({ label, value, delta, deltaType = 'neutral' }: StatCardProps) {
  const deltaColor = {
    positive: 'text-status-success',
    negative: 'text-status-danger',
    neutral: 'text-txt-muted',
  }[deltaType];

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-txt-muted uppercase tracking-[0.08em]">
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold text-txt-primary tabular-nums">
        {value}
      </span>
      {delta && (
        <span className={`font-mono text-xs tabular-nums ${deltaColor}`}>
          {delta}
        </span>
      )}
    </div>
  );
}
