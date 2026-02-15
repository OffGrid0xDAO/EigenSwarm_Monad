'use client';

import type { AgentClass } from '@eigenswarm/shared';

const classStyles: Record<AgentClass, string> = {
  sentinel: 'bg-bg-elevated text-status-success border-border-subtle',
  operator: 'bg-bg-elevated text-txt-secondary border-border-subtle',
  architect: 'bg-bg-elevated text-status-warning border-border-subtle',
  sovereign: 'bg-bg-elevated text-status-danger border-border-subtle',
};

const classLabels: Record<AgentClass, string> = {
  sentinel: 'Lite',
  operator: 'Core',
  architect: 'Pro',
  sovereign: 'Ultra',
};

interface ClassBadgeProps {
  agentClass: AgentClass;
  size?: 'sm' | 'md';
}

export function ClassBadge({ agentClass, size = 'sm' }: ClassBadgeProps) {
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`
        inline-flex items-center font-mono font-medium uppercase tracking-wider rounded-md border
        ${classStyles[agentClass]}
        ${sizeClass}
      `}
    >
      {classLabels[agentClass]}
    </span>
  );
}
