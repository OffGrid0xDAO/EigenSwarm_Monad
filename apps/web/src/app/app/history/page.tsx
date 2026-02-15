'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useEigens } from '@/hooks/useEigenQueries';
import { ClassBadge } from '@/components/ui/ClassBadge';
import { MonoValue } from '@/components/ui/MonoValue';
import { StatStrip } from '@/components/ui/StatStrip';
import { SkeletonStatStrip, SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { formatEth, formatPercent, formatDuration } from '@eigenswarm/shared';

export default function HistoryPage() {
  const { address } = useAccount();
  const { data: allEigens = [], isLoading } = useEigens(address);
  const terminated = useMemo(() => allEigens.filter((e) => e.status === 'terminated'), [allEigens]);

  const totalDeposited = terminated.reduce((sum, e) => sum + e.ethDeposited, 0);
  const totalVaultBalance = terminated.reduce((sum, e) => sum + e.ethBalance, 0);
  const totalTokenValue = terminated.reduce((sum, e) => sum + e.tokenBalance * e.currentPrice, 0);
  const totalValue = totalVaultBalance + totalTokenValue;
  const totalRealReturn = totalValue - totalDeposited;
  const totalVolume = terminated.reduce((sum, e) => sum + e.volumeGenerated, 0);
  const totalMultiplier = totalDeposited > 0 ? totalVolume / totalDeposited : 0;

  const stats = [
    { label: 'Volume Generated', value: `${formatEth(totalVolume)} MON` },
    { label: 'Capital Efficiency', value: `${totalMultiplier.toFixed(0)}×` },
    { label: 'Total Deposited', value: `${formatEth(totalDeposited)} MON` },
    {
      label: 'Real Return',
      value: `${totalRealReturn >= 0 ? '+' : ''}${formatEth(totalRealReturn)} MON`,
      deltaType: totalRealReturn >= 0 ? 'positive' as const : 'negative' as const,
    },
  ];

  if (isLoading) {
    return (
      <AppPageShell label="History" title="Terminated Eigens" subtitle="Performance data for terminated eigens.">
        <div className="space-y-8">
          <SkeletonStatStrip />
          <SkeletonTable rows={3} cols={8} />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell label="History" title="Terminated Eigens" subtitle="Performance data for terminated eigens.">
    <div className="space-y-8">
      {terminated.length > 0 && (
        <div className="rounded-xl bg-bg-card border border-border-subtle p-6 shadow-card">
          <StatStrip stats={stats} />
        </div>
      )}

      {terminated.length === 0 ? (
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="10" />
            </svg>
          }
          title="No history yet"
          description="Terminated eigens and their performance data will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Eigen ID</th>
                <th>Token</th>
                <th>Class</th>
                <th>Duration</th>
                <th>Volume</th>
                <th>Deposited</th>
                <th>Remaining Value</th>
                <th>Gas + Fees</th>
                <th>Real Return</th>
                <th>Terminated</th>
              </tr>
            </thead>
            <tbody>
              {terminated.map((eigen) => {
                const duration = eigen.terminatedAt
                  ? new Date(eigen.terminatedAt).getTime() - new Date(eigen.createdAt).getTime()
                  : 0;
                const eigenValue = eigen.ethBalance + eigen.tokenBalance * eigen.currentPrice;
                const net = eigenValue - eigen.ethDeposited;
                const netPercent = eigen.ethDeposited > 0 ? (net / eigen.ethDeposited) * 100 : 0;

                return (
                  <tr key={eigen.id} className="group hover:bg-eigen-violet-wash/30 transition-colors">
                    <td>
                      <Link href={`/app/eigen/${eigen.id}`} className="font-mono text-xs text-txt-secondary group-hover:text-eigen-violet transition-colors">
                        {eigen.id.slice(0, 10)}...
                      </Link>
                    </td>
                    <td className="font-medium text-txt-primary">${eigen.tokenSymbol}</td>
                    <td><ClassBadge agentClass={eigen.class} /></td>
                    <td className="font-mono text-xs text-txt-muted">{formatDuration(duration)}</td>
                    <td>
                      <MonoValue value={formatEth(eigen.volumeGenerated)} suffix="MON" size="sm" />
                      {eigen.ethDeposited > 0 && (
                        <span className="ml-1.5 font-mono text-caption text-eigen-violet font-semibold">
                          {(eigen.volumeGenerated / eigen.ethDeposited).toFixed(0)}×
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-txt-muted">{formatEth(eigen.ethDeposited)} MON</td>
                    <td className="font-mono text-xs text-txt-muted">{formatEth(eigenValue)} MON</td>
                    <td className="font-mono text-xs text-txt-muted">{formatEth(eigen.protocolFeeAccrued + eigen.totalGasSpent)} MON</td>
                    <td>
                      <MonoValue value={net} pnl size="sm" />
                      <span className="ml-1 font-mono text-caption text-txt-disabled">
                        ({formatPercent(netPercent)})
                      </span>
                    </td>
                    <td className="font-mono text-xs text-txt-disabled">
                      {eigen.terminatedAt ? new Date(eigen.terminatedAt).toLocaleDateString() : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </AppPageShell>
  );
}
