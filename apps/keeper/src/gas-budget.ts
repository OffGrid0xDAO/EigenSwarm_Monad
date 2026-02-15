import { parseEther, formatEther } from 'viem';
import type { EigenState } from './decision-engine';

// ── Gas Budget ──────────────────────────────────────────────────────────
// Per-cycle gas budget to prevent runaway gas spending.
// When budget is exhausted, low-priority eigens are skipped.

const CYCLE_GAS_BUDGET = parseEther(process.env.CYCLE_GAS_BUDGET || '0.05');

// ── Eigen Priority ──────────────────────────────────────────────────────

export type EigenPriority = 'deploying' | 'active_trading' | 'idle';

/**
 * Classify eigen priority for gas budget allocation.
 * Higher priority eigens get gas first.
 */
export function classifyPriority(eigen: EigenState): EigenPriority {
  // Deploying eigens need to fill wallets — highest priority
  if (eigen.ethBalance > 0.001 && eigen.tradeCount < eigen.config.wallet_count * 2) {
    return 'deploying';
  }

  // Eigens with recent trades are actively trading
  if (eigen.tradeCount > 0) {
    return 'active_trading';
  }

  return 'idle';
}

/**
 * Sort eigens by priority: deploying > active_trading > idle.
 * Within each priority, sort by ethBalance descending (bigger vaults first).
 */
export function sortByPriority(eigens: EigenState[]): EigenState[] {
  const priorityOrder: Record<EigenPriority, number> = {
    deploying: 0,
    active_trading: 1,
    idle: 2,
  };

  return [...eigens].sort((a, b) => {
    const pa = priorityOrder[classifyPriority(a)];
    const pb = priorityOrder[classifyPriority(b)];
    if (pa !== pb) return pa - pb;
    return b.ethBalance - a.ethBalance; // larger vaults first
  });
}

// ── Cycle Budget Tracker ────────────────────────────────────────────────

export class GasBudgetTracker {
  private spent = 0n;
  private budget: bigint;

  constructor(budget: bigint = CYCLE_GAS_BUDGET) {
    this.budget = budget;
  }

  /**
   * Check if we have enough budget remaining for the estimated gas cost.
   */
  canAfford(estimatedGas: bigint = parseEther('0.001')): boolean {
    return this.spent + estimatedGas <= this.budget;
  }

  /**
   * Record gas spent.
   */
  recordSpend(gasUsed: bigint): void {
    this.spent += gasUsed;
  }

  /**
   * Get remaining budget.
   */
  get remaining(): bigint {
    return this.budget > this.spent ? this.budget - this.spent : 0n;
  }

  /**
   * Get total spent.
   */
  get totalSpent(): bigint {
    return this.spent;
  }

  /**
   * Summary string for logging.
   */
  summary(): string {
    return `spent=${formatEther(this.spent)} remaining=${formatEther(this.remaining)} budget=${formatEther(this.budget)}`;
  }
}
