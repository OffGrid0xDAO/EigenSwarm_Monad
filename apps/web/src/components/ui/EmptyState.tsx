'use client';

import { type ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, actions, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center min-h-[40vh] gap-5 py-16 ${className}`}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-bg-elevated border border-border-subtle flex items-center justify-center text-txt-disabled">
          {icon}
        </div>
      )}
      <div className="text-center max-w-sm">
        <h2 className="text-xl font-bold text-txt-primary mb-1.5">{title}</h2>
        {description && (
          <p className="text-sm text-txt-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3 mt-1">
          {actions}
        </div>
      )}
    </div>
  );
}
