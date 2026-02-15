'use client';

import { forwardRef, type HTMLAttributes } from 'react';

type CardVariant = 'static' | 'interactive' | 'elevated';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'sm' | 'md' | 'lg';
}

const variantStyles: Record<CardVariant, string> = {
  static: 'bg-bg-card border border-border-subtle rounded-xl shadow-card',
  interactive: 'bg-bg-card border border-border-subtle rounded-xl shadow-card card-lift cursor-pointer',
  elevated: 'bg-bg-card border border-border-subtle rounded-xl shadow-card-hover',
};

const paddingStyles: Record<string, string> = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'static', padding = 'md', className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`${variantStyles[variant]} ${paddingStyles[padding]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
