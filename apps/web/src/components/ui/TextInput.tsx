'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  suffix?: ReactNode;
  mono?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, error, helper, suffix, mono, className = '', ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
            {label}
          </label>
        )}
        <div className="relative flex items-center gap-2">
          <input
            ref={ref}
            className={`
              w-full bg-bg-elevated border rounded-lg px-3.5 py-2.5 text-sm text-txt-primary
              placeholder:text-txt-disabled
              focus:outline-none focus:border-border-hover transition-colors
              disabled:opacity-50
              ${mono ? 'font-mono' : ''}
              ${error ? 'border-status-danger/50' : 'border-border-subtle'}
              ${className}
            `}
            {...props}
          />
          {suffix && (
            <span className="text-sm text-txt-muted font-mono flex-shrink-0">{suffix}</span>
          )}
        </div>
        {error && (
          <p className="text-xs text-status-danger mt-1">{error}</p>
        )}
        {helper && !error && (
          <p className="text-xs text-txt-disabled mt-1">{helper}</p>
        )}
      </div>
    );
  }
);

TextInput.displayName = 'TextInput';
