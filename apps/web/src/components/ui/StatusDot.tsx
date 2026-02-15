'use client';

import type { EigenStatus } from '@eigenswarm/shared';

const statusColors: Record<EigenStatus, string> = {
  active: 'bg-status-success',
  suspended: 'bg-status-warning',
  terminated: 'bg-status-danger',
  liquidating: 'bg-status-warning',
  liquidated: 'bg-status-danger',
  pending_lp: 'bg-amber-400',
  pending_funding: 'bg-amber-400',
  closed: 'bg-neutral-400',
};

const statusLabels: Record<EigenStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
  liquidating: 'Liquidating',
  liquidated: 'Closed',
  pending_lp: 'Pending LP',
  pending_funding: 'Pending Funding',
  closed: 'Closed',
};

interface StatusDotProps {
  status: EigenStatus;
  showLabel?: boolean;
  pulse?: boolean;
  size?: 'sm' | 'md';
}

export function StatusDot({ status, showLabel = false, pulse = true, size = 'md' }: StatusDotProps) {
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex">
        {pulse && status === 'active' && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${statusColors[status]} opacity-40 animate-ping`}
          />
        )}
        <span className={`relative inline-flex rounded-full ${dotSize} ${statusColors[status]}`} />
      </span>
      {showLabel && (
        <span className="text-xs font-medium text-txt-muted uppercase tracking-wider">
          {statusLabels[status]}
        </span>
      )}
    </span>
  );
}
