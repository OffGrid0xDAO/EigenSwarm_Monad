'use client';

interface MonoValueProps {
  value: string | number;
  suffix?: string;
  prefix?: string;
  pnl?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function MonoValue({ value, suffix, prefix, pnl = false, size = 'md', className = '' }: MonoValueProps) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  const isPositive = !isNaN(num) && num > 0;
  const isNegative = !isNaN(num) && num < 0;

  const colorClass = pnl
    ? isPositive
      ? 'text-status-success'
      : isNegative
        ? 'text-status-danger'
        : 'text-txt-primary'
    : 'text-txt-primary';

  const sizeClass = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg',
    xl: 'text-2xl',
  }[size];

  const displayValue = typeof value === 'number' ? value.toFixed(4) : value;

  return (
    <span className={`font-mono tabular-nums ${colorClass} ${sizeClass} ${className}`}>
      {prefix}
      {pnl && isPositive && '+'}
      {displayValue}
      {suffix && <span className="text-txt-muted ml-1">{suffix}</span>}
    </span>
  );
}
