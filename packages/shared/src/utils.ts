import { keccak256, toHex } from 'viem';

// ─── Eigen ID → bytes32 ─────────────────────────────────────────────────────

const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

export function eigenIdToBytes32(id: string): `0x${string}` {
  if (!id) return ZERO_BYTES32;
  // Already a bytes32 hash — return as-is to avoid double-hashing
  if (id.startsWith('0x') && id.length === 66) return id as `0x${string}`;
  return keccak256(toHex(id));
}

// ─── Address Formatting ─────────────────────────────────────────────────────

export function truncateAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// ─── Number Formatting ─────────────────────────────────────────────────────

export function formatEth(value: number, decimals = 4): string {
  if (value === 0) return (0).toFixed(decimals);
  const abs = Math.abs(value);
  // For very small values, use enough decimals to show significant digits
  if (abs > 0 && abs < 0.0001) {
    // Find first significant digit
    const sigDecimals = Math.max(decimals, -Math.floor(Math.log10(abs)) + 2);
    return value.toFixed(Math.min(sigDecimals, 12));
  }
  return value.toFixed(decimals);
}

export function formatPrice(value: number): string {
  if (value === 0) return '--';
  const abs = Math.abs(value);
  if (abs < 0.000001) {
    // Scientific notation for very small prices
    return value.toExponential(4);
  }
  if (abs < 0.0001) {
    const sigDecimals = -Math.floor(Math.log10(abs)) + 3;
    return value.toFixed(Math.min(sigDecimals, 12));
  }
  return value.toFixed(6);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(1);
}

// ─── Time Formatting ────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatRuntime(createdAt: string): string {
  const start = new Date(createdAt).getTime();
  const now = Date.now();
  return formatDuration(now - start);
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ─── Eigen ID Helpers ───────────────────────────────────────────────────────

export function isValidEigenId(id: string): boolean {
  return /^ES-[0-9a-f]{4,12}$/.test(id);
}

// ─── P&L Helpers ────────────────────────────────────────────────────────────

export function pnlColor(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}
