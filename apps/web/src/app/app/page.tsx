'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useEigens, usePortfolio } from '@/hooks/useEigenQueries';
import { StatusDot } from '@/components/ui/StatusDot';
import { ClassBadge } from '@/components/ui/ClassBadge';
import { MonoValue } from '@/components/ui/MonoValue';
import { GlowButton } from '@/components/ui/GlowButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonStatStrip, SkeletonTable } from '@/components/ui/Skeleton';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { formatEth, formatPercent, formatRuntime, truncateAddress } from '@eigenswarm/shared';

type ViewMode = 'all' | 'mine' | 'closed';

const TERMINAL_STATUSES = new Set(['terminated', 'closed', 'liquidated']);

export default function FleetPage() {
  const { address } = useAccount();
  const [view, setView] = useState<ViewMode>('all');

  const { data: allEigensRaw = [], isLoading: allLoading } = useEigens();
  const { data: portfolio } = usePortfolio(address);

  const myEigensRaw = useMemo(
    () => address ? allEigensRaw.filter(e => e.ownerAddress.toLowerCase() === address.toLowerCase()) : [],
    [allEigensRaw, address],
  );

  const isLoading = allLoading;

  const eigens = useMemo(() => {
    if (view === 'closed') {
      // Show only terminal eigens owned by the connected wallet
      const source = address ? myEigensRaw : allEigensRaw;
      return source.filter((e) => TERMINAL_STATUSES.has(e.status));
    }
    const source = view === 'all' ? allEigensRaw : myEigensRaw;
    return source.filter((e) => !TERMINAL_STATUSES.has(e.status));
  }, [view, allEigensRaw, myEigensRaw, address]);

  // Stats are always based on active eigens
  const activeSource = view === 'mine' ? myEigensRaw : allEigensRaw;
  const activeEigensForStats = activeSource.filter((e) => !TERMINAL_STATUSES.has(e.status));
  const viewDeployed = activeEigensForStats.reduce((sum, e) => sum + e.ethDeposited, 0);
  const viewVaultBalance = activeEigensForStats.reduce((sum, e) => sum + e.ethBalance, 0);
  const viewTokenValue = activeEigensForStats.reduce((sum, e) => sum + e.tokenBalance * e.currentPrice, 0);
  const viewValue = viewVaultBalance + viewTokenValue;
  const viewRealReturn = viewValue - viewDeployed;
  const viewVolume = activeEigensForStats.reduce((sum, e) => sum + e.volumeGenerated, 0);
  const viewMultiplier = viewDeployed > 0 ? viewVolume / viewDeployed : 0;
  const activeCount = activeEigensForStats.filter(e => e.status === 'active').length;
  const allCount = allEigensRaw.filter(e => !TERMINAL_STATUSES.has(e.status)).length;
  const myCount = myEigensRaw.filter(e => !TERMINAL_STATUSES.has(e.status)).length;
  const closedCount = (address ? myEigensRaw : allEigensRaw).filter(e => TERMINAL_STATUSES.has(e.status)).length;

  if (allLoading) {
    return (
      <AppPageShell label="Fleet Dashboard" title="Your Active Fleet">
        <div className="space-y-4">
          <SkeletonStatStrip />
          <SkeletonTable rows={4} cols={8} />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell label="Fleet Dashboard" title="Your Active Fleet">
    <div className="space-y-4">

      {/* ── Dark stat strip — mirrors landing page stats ───── */}
      {view !== 'closed' && (
        <div className="rounded-2xl border border-border-subtle px-6 py-5">
          <div className="flex items-center justify-center">
            <div className="flex items-center w-full max-w-full">
              {[
                { label: 'Volume Generated', value: formatEth(viewVolume), unit: 'MON', accent: false },
                { label: 'Efficiency', value: `${viewMultiplier.toFixed(0)}×`, unit: '', accent: true },
                { label: 'Active', value: `${activeCount}`, unit: `/ ${activeEigensForStats.length}`, accent: false },
                { label: 'Deployed', value: formatEth(viewDeployed, 2), unit: 'MON', accent: false },
                { label: 'Remaining', value: formatEth(viewVaultBalance), unit: 'MON', accent: false },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center flex-1 min-w-0">
                  {i > 0 && <div className="w-px h-9 bg-border-subtle mx-3 lg:mx-5 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-txt-disabled font-medium mb-1">{s.label}</p>
                    <p className={`font-display text-xl lg:text-2xl tracking-tight leading-none whitespace-nowrap ${
                      s.accent ? 'text-eigen-violet' : 'text-txt-primary'
                    }`}>
                      {s.value}
                      {s.unit && <span className="text-txt-disabled text-[0.5em] ml-0.5">{s.unit}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Controls ──────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <div className="inline-flex rounded-lg border border-border-subtle bg-bg-card p-0.5">
          {[
            { key: 'all' as ViewMode, label: 'All Agents', count: allCount },
            { key: 'mine' as ViewMode, label: 'My Agents', count: myCount },
            { key: 'closed' as ViewMode, label: 'Closed', count: closedCount },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                view === tab.key
                  ? 'bg-bg-elevated text-txt-primary shadow-sm'
                  : 'text-txt-muted hover:text-txt-secondary'
              }`}
            >
              {tab.label}
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold tabular-nums px-1 ${
                view === tab.key
                  ? 'bg-eigen-violet/10 text-eigen-violet'
                  : 'bg-bg-elevated text-txt-disabled'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Link href="/app/deploy">
            <GlowButton size="sm">Deploy Eigen</GlowButton>
          </Link>
          <Link href="/app/launch">
            <GlowButton size="sm" variant="secondary">Launch Token</GlowButton>
          </Link>
        </div>
      </div>

      {/* ── Agent table ───────────────────────────────────── */}
      {eigens.length === 0 ? (
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          }
          title={view === 'closed' ? 'No closed agents' : view === 'mine' ? 'No eigens deployed' : 'No agents found'}
          description={view === 'closed'
            ? 'Terminated and liquidated agents will appear here.'
            : view === 'mine'
              ? 'Deploy your first agent to start generating volume.'
              : 'No agents have been deployed yet.'
          }
          actions={view !== 'closed' ? (
            <Link href="/app/deploy">
              <GlowButton>Deploy Eigen</GlowButton>
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Eigen ID</th>
                <th>Token</th>
                {view === 'all' && <th>Owner</th>}
                <th>Class</th>
                <th>Status</th>
                <th>Runtime</th>
                <th>Volume</th>
                <th>Deployed</th>
                <th>Remaining</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {eigens.map((eigen) => {
                const isTerminal = TERMINAL_STATUSES.has(eigen.status);
                return (
                  <tr
                    key={eigen.id}
                    className={`cursor-pointer group transition-colors ${
                      isTerminal ? 'opacity-50 hover:opacity-80' : ''
                    }`}
                    onClick={() => window.location.href = `/app/eigen/${eigen.id}`}
                  >
                    <td>
                      <span className="font-mono text-xs text-txt-secondary">{eigen.id.slice(0, 10)}...</span>
                    </td>
                    <td>
                      <span className="font-medium text-txt-primary">${eigen.tokenSymbol}</span>
                    </td>
                    {view === 'all' && (
                      <td>
                        <span className="font-mono text-xs text-txt-muted">
                          {truncateAddress(eigen.ownerAddress)}
                        </span>
                      </td>
                    )}
                    <td>
                      <ClassBadge agentClass={eigen.class} />
                    </td>
                    <td>
                      <StatusDot status={eigen.status} showLabel size="sm" />
                    </td>
                    <td>
                      <span className="font-mono text-xs text-txt-muted">{formatRuntime(eigen.createdAt)}</span>
                    </td>
                    <td>
                      <MonoValue value={formatEth(eigen.volumeGenerated)} suffix="MON" size="sm" />
                      {eigen.ethDeposited > 0 && (
                        <span className="ml-1.5 font-mono text-caption text-eigen-violet font-semibold">
                          {(eigen.volumeGenerated / eigen.ethDeposited).toFixed(0)}×
                        </span>
                      )}
                    </td>
                    <td>
                      <MonoValue value={formatEth(eigen.ethDeposited)} suffix="MON" size="sm" />
                    </td>
                    <td>
                      <MonoValue value={formatEth(eigen.ethBalance)} suffix="MON" size="sm" />
                      {eigen.ethDeposited > 0 && (
                        <span className="ml-1 font-mono text-caption text-txt-disabled">
                          ({Math.round((eigen.ethBalance / eigen.ethDeposited) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td>
                      <Link href={`/app/eigen/${eigen.id}`} onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-txt-muted group-hover:text-txt-primary transition-colors">
                          &rarr;
                        </span>
                      </Link>
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
