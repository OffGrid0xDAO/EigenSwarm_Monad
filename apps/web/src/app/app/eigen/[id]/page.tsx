'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEigen, useEigenPnl, usePriceHistory } from '@/hooks/useEigenQueries';
import { useEigenStore } from '@/stores/eigens';
import { PriceChart } from '@/components/charts/PriceChart';
import { PnlChart } from '@/components/charts/PnlChart';
import { VolumeChart } from '@/components/charts/VolumeChart';
import { TradeDistribution } from '@/components/charts/TradeDistribution';
import { fetchTrades, fetchEigen as fetchEigenApi, liquidateEigen, adjustEigenConfig, takeProfitEigen, deleteEigen, terminateEigenApi, type ApiTrade } from '@/lib/api';
import { mapApiTradeToTrade } from '@/lib/mappers';
import { useAccount } from 'wagmi';
import { useSignedLiquidate, useSignedAdjust, useSignedTakeProfit, useSignedDelete, useSignedTerminate } from '@/hooks/useSignedAction';
import { useQuery, useQueryClient } from '@tanstack/react-query';

function useRawTrades(eigenId: string | undefined) {
  return useQuery<ApiTrade[]>({
    queryKey: ['rawTrades', eigenId],
    queryFn: () => (eigenId ? fetchTrades(eigenId, 1000) : []),
    refetchInterval: 20_000,
    staleTime: 10_000,
    enabled: !!eigenId,
  });
}

import { StatusDot } from '@/components/ui/StatusDot';
import { ClassBadge } from '@/components/ui/ClassBadge';
import { MonoValue } from '@/components/ui/MonoValue';
import { GlowButton } from '@/components/ui/GlowButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TxStatus } from '@/components/ui/TxStatus';
import { SkeletonEigenDetail, SkeletonEigenGrid } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  formatEth,
  formatPrice,
  formatPercent,
  formatRuntime,
  formatTimestamp,
  formatUsd,
  formatCompact,
  truncateAddress,
  ERC8004_IDENTITY_REGISTRY,
  type Eigen,
} from '@eigenswarm/shared';
import { useSuspend, useResume, useTerminate, useWithdraw, useDeposit } from '@/hooks/useEigenVault';
import { useLPPosition, useCollectFees, useRemoveLiquidity, useCompoundFees, useSeedPoolConcentrated } from '@/hooks/useEigenLP';
import { CONCENTRATION_PRESETS, type ConcentrationPreset, alignTick, TICK_SPACING } from '@/lib/tickMath';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { useAgentReputation } from '@/hooks/useAgent8004';
import { useOhlcv, useGeckoPoolInfo } from '@/hooks/useGeckoTerminal';

export default function EigenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: eigen, isLoading, isError, refetch } = useEigen(id);
  const { data: rawTrades } = useRawTrades(id);
  const trades = useMemo(() => (rawTrades || []).map(mapApiTradeToTrade), [rawTrades]);
  const [priceRange, setPriceRange] = useState('1d');
  const { data: priceHistory = [] } = usePriceHistory(id, priceRange);
  const { data: ohlcvData = [] } = useOhlcv(eigen?.poolAddress, eigen?.chainId ?? 143, priceRange);
  const { data: geckoPool } = useGeckoPoolInfo(eigen?.poolAddress, eigen?.chainId ?? 143);

  const optimisticStatuses = useEigenStore((s) => s.optimisticStatuses);
  const setOptimisticStatus = useEigenStore((s) => s.setOptimisticStatus);
  const [showTerminate, setShowTerminate] = useState(false);
  const [showLiquidate, setShowLiquidate] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showTakeProfit, setShowTakeProfit] = useState(false);
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [isTakingProfit, setIsTakingProfit] = useState(false);
  const [takeProfitError, setTakeProfitError] = useState<string | null>(null);
  const [isTogglingReactiveSell, setIsTogglingReactiveSell] = useState(false);
  const [liquidationError, setLiquidationError] = useState<string | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const { address: connectedAddress } = useAccount();
  const { signLiquidate } = useSignedLiquidate();
  const { signAdjust } = useSignedAdjust();
  const { signTakeProfit } = useSignedTakeProfit();
  const { signDelete } = useSignedDelete();
  const { signTerminate } = useSignedTerminate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isTerminatingApi, setIsTerminatingApi] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const suspendHook = useSuspend();
  const resumeHook = useResume();
  const terminateHook = useTerminate();
  const withdrawHook = useWithdraw();
  const depositHook = useDeposit();
  const lpPosition = useLPPosition(id || '');
  const collectFeesHook = useCollectFees();
  const compoundFeesHook = useCompoundFees();
  const removeLiquidityHook = useRemoveLiquidity();
  const seedPoolConcentratedHook = useSeedPoolConcentrated();
  const { data: reputation } = useAgentReputation(eigen?.agent8004Id, eigen?.agent8004ChainId || 143);
  const liquidateAbortRef = useRef<AbortController | null>(null);
  const [showRemoveLP, setShowRemoveLP] = useState(false);
  const [removeLpLoading, setRemoveLpLoading] = useState(false);
  const [removeLpError, setRemoveLpError] = useState<string | null>(null);
  const [showCreateLP, setShowCreateLP] = useState(false);
  const [lpEthAmount, setLpEthAmount] = useState('');
  const [lpTokenAmount, setLpTokenAmount] = useState('');
  const [lpConcentration, setLpConcentration] = useState<ConcentrationPreset>('wide');

  // Get the active tx (whichever action was triggered last)
  const activeTx = [suspendHook, resumeHook, terminateHook, withdrawHook, depositHook, collectFeesHook, compoundFeesHook, removeLiquidityHook, seedPoolConcentratedHook].find(
    (h) => h.isPending || h.isConfirming || h.isSuccess || h.error
  );

  // All hooks must be called before any early returns
  const [liquidationReady, setLiquidationReady] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [showDepositInput, setShowDepositInput] = useState(false);
  const [gasToastDismissed, setGasToastDismissed] = useState(false);
  const [gasToastCopied, setGasToastCopied] = useState(false);

  // ── ERC-8004 hole: track island width for SVG overlay coordinates ─────
  // Callback ref so ResizeObserver attaches even if the element mounts after
  // the loading skeleton (useRef + useEffect([]) misses late-mounting refs).
  const [islandEl, setIslandEl] = useState<HTMLDivElement | null>(null);
  const islandRef = useCallback((node: HTMLDivElement | null) => {
    setIslandEl(node);
  }, []);
  const [islandWidth, setIslandWidth] = useState(0);
  useEffect(() => {
    if (!islandEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setIslandWidth(Math.ceil(e.contentRect.width));
    });
    ro.observe(islandEl);
    return () => ro.disconnect();
  }, [islandEl]);

  const handleLiquidate = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsLiquidating(true);
    setLiquidationError(null);
    setShowLiquidate(false);
    setLiquidationReady(false);

    try {
      const { signature, timestamp } = await signLiquidate(id);
      await liquidateEigen(id, connectedAddress, signature, timestamp);
      setOptimisticStatus(eigen.id, 'liquidating');

      // Poll until liquidated
      const controller = new AbortController();
      liquidateAbortRef.current = controller;

      const poll = async () => {
        for (let i = 0; i < 120; i++) {
          if (controller.signal.aborted) break;
          await new Promise((r) => setTimeout(r, 5000));
          if (controller.signal.aborted) break;
          try {
            const updated = await fetchEigenApi(id);
            const status = updated.config?.status || updated.status;
            if (status === 'liquidated') {
              setOptimisticStatus(eigen.id, 'liquidated');
              setIsLiquidating(false);
              setLiquidationReady(true);
              queryClient.invalidateQueries({ queryKey: ['eigen', id] });
              return;
            }
          } catch {
            // Keep polling on transient errors
          }
        }
        if (!controller.signal.aborted) {
          setLiquidationError('Liquidation timed out. Tokens may still be selling.');
          setIsLiquidating(false);
        }
      };

      poll();
    } catch (error) {
      const msg = (error as Error).message || String(error);
      if (msg.includes('Unknown RPC') || msg.includes('unknown error')) {
        setLiquidationError('Wallet signing failed — try disconnecting and reconnecting your wallet, then retry.');
      } else if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setLiquidationError('Signature request was rejected.');
      } else {
        setLiquidationError(msg);
      }
      setIsLiquidating(false);
    }
  }, [eigen, id, connectedAddress, setOptimisticStatus, signLiquidate, queryClient]);

  // Step 1: Withdraw ETH from vault after liquidation
  const handleWithdrawAfterLiquidation = useCallback(async () => {
    if (!eigen || !id) return;

    try {
      const updated = await fetchEigenApi(id);
      const balance = updated.balance || '0';
      const balanceBigInt = BigInt(balance);
      if (balanceBigInt > BigInt(0)) {
        const { formatEther: fmtEth } = await import('viem');
        withdrawHook.withdraw(eigen.id, fmtEth(balanceBigInt));
      } else {
        // No balance to withdraw — skip to terminate
        terminateHook.terminate(eigen.id);
        setLiquidationReady(false);
        setOptimisticStatus(eigen.id, 'terminated');
      }
    } catch (error) {
      console.error('Failed to withdraw after liquidation:', (error as Error).message);
    }
  }, [eigen, id, withdrawHook, terminateHook, setOptimisticStatus]);

  // Cleanup liquidation polling on unmount
  useEffect(() => {
    return () => {
      liquidateAbortRef.current?.abort();
    };
  }, []);

  // Step 2: After withdraw confirms, terminate
  useEffect(() => {
    if (withdrawHook.isSuccess && liquidationReady) {
      terminateHook.terminate(eigen!.id);
      setLiquidationReady(false);
      setOptimisticStatus(eigen!.id, 'terminated');
    }
  }, [withdrawHook.isSuccess, liquidationReady, eigen, terminateHook, setOptimisticStatus]);

  const handleAdjust = useCallback(async (configUpdates: Record<string, number | string | null>) => {
    if (!eigen || !id || !connectedAddress) return;
    setIsAdjusting(true);
    setAdjustError(null);
    try {
      const { signature, timestamp } = await signAdjust(id);
      await adjustEigenConfig(id, connectedAddress, signature, timestamp, configUpdates);
      queryClient.invalidateQueries({ queryKey: ['eigen', id] });
      setShowAdjust(false);
    } catch (error) {
      setAdjustError((error as Error).message);
    } finally {
      setIsAdjusting(false);
    }
  }, [eigen, id, connectedAddress, signAdjust, queryClient]);

  const handleTakeProfit = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsTakingProfit(true);
    setTakeProfitError(null);
    setShowTakeProfit(false);
    try {
      const { signature, timestamp } = await signTakeProfit(id);
      await takeProfitEigen(id, { ownerAddress: connectedAddress, signature, timestamp, percent: 100 });
      queryClient.invalidateQueries({ queryKey: ['eigen', id] });
    } catch (error) {
      setTakeProfitError((error as Error).message);
    } finally {
      setIsTakingProfit(false);
    }
  }, [eigen, id, connectedAddress, signTakeProfit, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsDeleting(true);
    setDeleteError(null);
    setShowDelete(false);
    try {
      const { signature, timestamp } = await signDelete(id);
      await deleteEigen(id, connectedAddress, signature, timestamp);
      window.location.href = '/app';
    } catch (error) {
      setDeleteError((error as Error).message);
      setIsDeleting(false);
    }
  }, [eigen, id, connectedAddress, signDelete]);

  const handleTerminateApi = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsTerminatingApi(true);
    setShowTerminate(false);
    try {
      const { signature, timestamp } = await signTerminate(id);
      await terminateEigenApi(id, connectedAddress, signature, timestamp);
      setOptimisticStatus(eigen.id, 'terminated');
      queryClient.invalidateQueries({ queryKey: ['eigen', id] });
    } catch (error) {
      console.error('Failed to terminate via API:', (error as Error).message);
    } finally {
      setIsTerminatingApi(false);
    }
  }, [eigen, id, connectedAddress, signTerminate, setOptimisticStatus, queryClient]);

  const handleToggleReactiveSell = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsTogglingReactiveSell(true);
    try {
      const newMode = eigen.reactiveSellMode ? 0 : 1;
      const { signature, timestamp } = await signAdjust(id);
      await adjustEigenConfig(id, connectedAddress, signature, timestamp, {
        reactiveSellMode: newMode,
      });
      queryClient.invalidateQueries({ queryKey: ['eigen', id] });
    } catch (error) {
      console.error('Failed to toggle reactive sell:', (error as Error).message);
    } finally {
      setIsTogglingReactiveSell(false);
    }
  }, [eigen, id, connectedAddress, signAdjust, queryClient]);

  const handleSavePrompt = useCallback(async () => {
    if (!eigen || !id || !connectedAddress) return;
    setIsSavingPrompt(true);
    setPromptError(null);
    try {
      const { signature, timestamp } = await signAdjust(id);
      await adjustEigenConfig(id, connectedAddress, signature, timestamp, {
        customPrompt: promptDraft.trim() || null,
      });
      queryClient.invalidateQueries({ queryKey: ['eigen', id] });
      setIsEditingPrompt(false);
    } catch (error) {
      setPromptError((error as Error).message);
    } finally {
      setIsSavingPrompt(false);
    }
  }, [eigen, id, connectedAddress, signAdjust, promptDraft, queryClient]);

  if (isLoading) {
    return (
      <>
        <AppPageShell label="Eigen Detail" title="Loading..." variant="full-bleed" bodyClassName="!rounded-tr-none" compact>
          <SkeletonEigenDetail />
        </AppPageShell>
        <SkeletonEigenGrid />
      </>
    );
  }

  if (isError) {
    return (
      <AppPageShell label="Eigen Detail" title="Error">
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          }
          title="Failed to load eigen"
          description="Could not reach the keeper API. The service may be restarting."
          actions={
            <div className="flex gap-2">
              <GlowButton variant="secondary" size="sm" onClick={() => refetch()}>Retry</GlowButton>
              <Link href="/app">
                <GlowButton variant="ghost" size="sm">Back to Fleet</GlowButton>
              </Link>
            </div>
          }
        />
      </AppPageShell>
    );
  }

  if (!eigen) {
    return (
      <AppPageShell label="Eigen Detail" title="Not Found">
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          }
          title="Eigen not found"
          description="This eigen may have been removed or the ID is invalid."
          actions={
            <Link href="/app">
              <GlowButton variant="secondary" size="sm">Back to Fleet</GlowButton>
            </Link>
          }
        />
      </AppPageShell>
    );
  }

  // Apply optimistic status override
  const displayStatus = optimisticStatuses[eigen.id] ?? eigen.status;

  function handleSuspend() {
    suspendHook.suspend(eigen!.id);
    setOptimisticStatus(eigen!.id, 'suspended');
  }

  function handleResume() {
    resumeHook.resume(eigen!.id);
    setOptimisticStatus(eigen!.id, 'active');
  }

  function handleTerminate() {
    terminateHook.terminate(eigen!.id);
    setOptimisticStatus(eigen!.id, 'terminated');
    setShowTerminate(false);
  }

  function handleWithdraw() {
    if (!eigen) return;
    withdrawHook.withdraw(eigen.id, String(eigen.ethBalance));
  }

  const inventoryEthValue = eigen.ethBalance;
  const inventoryTokenValue = eigen.tokenBalance * eigen.currentPrice;
  const totalInventory = inventoryEthValue + inventoryTokenValue;

  // Real P&L = what you can actually withdraw - what you deposited
  const totalValue = inventoryEthValue + inventoryTokenValue;
  const realReturn = totalValue - eigen.ethDeposited;
  const realReturnPercent = eigen.ethDeposited > 0 ? (realReturn / eigen.ethDeposited) * 100 : 0;

  // Paper metrics (for breakdown display only)
  const totalCosts = eigen.protocolFeeAccrued + eigen.totalGasSpent;
  const paperPnl = eigen.realizedPnl + eigen.unrealizedPnl - totalCosts;
  const ethRatio = totalInventory > 0 ? (inventoryEthValue / totalInventory) * 100 : 50;

  // ── Market Making Performance metrics ──────────────────────────────
  const daysActive = Math.max((Date.now() - new Date(eigen.createdAt).getTime()) / 86_400_000, 0.01);
  const dailyVolume = eigen.volumeGenerated / daysActive;
  const capitalEfficiency = eigen.ethDeposited > 0 ? eigen.volumeGenerated / eigen.ethDeposited : 0;
  const avgTradeSize = eigen.tradesExecuted > 0 ? eigen.volumeGenerated / eigen.tradesExecuted : 0;
  const volumeTarget = eigen.volumeTarget * daysActive;
  const volumeAttainment = volumeTarget > 0 ? (eigen.volumeGenerated / volumeTarget) * 100 : 0;
  const costPerVolume = eigen.volumeGenerated > 0 ? (eigen.totalGasSpent / eigen.volumeGenerated) * 100 : 0;
  const netPnl = eigen.realizedPnl + eigen.unrealizedPnl + eigen.lpFeesEarned - eigen.totalGasSpent;
  const netRoi = eigen.ethDeposited > 0 ? (netPnl / eigen.ethDeposited) * 100 : 0;
  const priceImpact = eigen.entryPrice > 0 ? ((eigen.currentPrice - eigen.entryPrice) / eigen.entryPrice) * 100 : 0;
  const tradesPerDay = eigen.tradesExecuted / daysActive;

  // ── Strategy Stage derivation ──────────────────────────────────────
  const strategyStage = (() => {
    if (displayStatus === 'pending_lp') return { name: 'Pending LP', icon: '⏳', color: '#D97706', description: 'Token deployed but vault/LP not yet created on-chain.', progress: 0 };
    if (displayStatus === 'pending_funding') return { name: 'Pending Funding', icon: '⏳', color: '#D97706', description: 'Vault awaiting initial funding.', progress: 0 };
    if (displayStatus === 'suspended') return { name: 'Paused', icon: '⏸', color: '#706F84', description: 'Agent is suspended. Resume to continue operations.', progress: 0 };
    if (displayStatus === 'terminated') return { name: 'Terminated', icon: '⏹', color: '#C76E6E', description: 'Agent has been shut down.', progress: 100 };
    if (displayStatus === 'closed') return { name: 'Closed', icon: '⏹', color: '#706F84', description: 'Agent is closed. Vault no longer active on-chain.', progress: 100 };
    if (isLiquidating) return { name: 'Liquidating', icon: '⚡', color: '#E5A64E', description: 'Selling all token positions before withdrawal.', progress: 85 };

    const hoursActive = daysActive * 24;
    const tokenPct = totalInventory > 0 ? (inventoryTokenValue / totalInventory) * 100 : 0;

    if (hoursActive < 2 && eigen.tradesExecuted < 10)
      return { name: 'Bootstrapping', icon: '🔧', color: '#A78BFA', description: 'Initializing positions and calibrating spread.', progress: 5 };
    if (volumeAttainment < 25)
      return { name: 'Ramping Up', icon: '📈', color: '#7B3FE4', description: `${volumeAttainment.toFixed(0)}% of daily target. Building momentum.`, progress: Math.min(volumeAttainment, 25) };
    if (volumeAttainment >= 25 && volumeAttainment < 80)
      return { name: 'Active Generation', icon: '⚙️', color: '#6DB89B', description: `Hitting ${volumeAttainment.toFixed(0)}% of target. ${tradesPerDay.toFixed(0)} trades/day.`, progress: Math.min(volumeAttainment, 80) };
    if (volumeAttainment >= 80 && volumeAttainment < 100)
      return { name: 'Near Target', icon: '🎯', color: '#6DB89B', description: `${volumeAttainment.toFixed(0)}% attainment. Approaching daily goal.`, progress: volumeAttainment };
    if (volumeAttainment >= 100)
      return { name: 'Target Exceeded', icon: '✅', color: '#6DB89B', description: `${volumeAttainment.toFixed(0)}% of target reached. Outperforming.`, progress: 100 };
    if (tokenPct > 70)
      return { name: 'Heavy Token', icon: '⚖️', color: '#E5A64E', description: `${tokenPct.toFixed(0)}% in token. Rebalance may help.`, progress: 60 };

    return { name: 'Active', icon: '▶', color: '#6DB89B', description: 'Market making in progress.', progress: 50 };
  })();

  return (
    <>
      <AppPageShell label="Eigen Detail" title={`Eigen-${(eigen.id ?? id ?? '').slice(0, 6)}`} variant="full-bleed" bodyClassName="!rounded-tr-none lg:!rounded-br-none eigen-detail-island lg:pt-8" compact ref={islandRef}>
        {/* ── ERC-8004 hole — SVG overlay with evenodd transparent cutout ───── */}
        {/* Inline SVG renders path edges at native device-pixel resolution   */}
        {/* (pixel-perfect on Retina). fillRule="evenodd" makes the inner     */}
        {/* sub-path transparent, showing the dark animated bg through.        */}
        {islandWidth > 0 && (
          <svg
            className="hidden lg:block absolute inset-0 w-full h-full z-[0] pointer-events-none"
            style={{ overflow: 'hidden' }}
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              fill="white"
              d={`M0,0 H${islandWidth} V9999 H0 Z M${islandWidth - 326},125 L${islandWidth - 24},125 A24,24 0 0,0 ${islandWidth},101 L${islandWidth},${341 + 22} A22,22 0 0,0 ${islandWidth - 22},341 L${islandWidth - 326},341 A24,24 0 0,1 ${islandWidth - 350},317 L${islandWidth - 350},149 A24,24 0 0,1 ${islandWidth - 326},125 Z`}
            />
          </svg>
        )}
        {/* ── ERC-8004 hole content — positioned relative to app-island-body ── */}
        <div className="hidden lg:block absolute top-[125px] right-0 w-[340px] z-[2]">
          <div className="relative px-5 py-4 pb-5">
            {/* Header row */}
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7B3FE4 0%, #A78BFA 100%)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-white">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="font-display text-[14px] text-white/90">ERC-8004</span>
              <div className="flex-1" />
              {eigen.agent8004Id ? (
                <span className="text-[9px] font-medium text-[#6DB89B] bg-[#6DB89B]/10 px-2.5 py-1 rounded-full uppercase tracking-wider">Minted</span>
              ) : (
                <span className="text-[9px] font-medium text-[#A78BFA] bg-[#A78BFA]/10 px-2.5 py-1 rounded-full uppercase tracking-wider">Pending</span>
              )}
            </div>

            {/* Metadata grid — stacked rows for breathing room */}
            <div className="space-y-2.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-white/35">Owner</span>
                <span className="font-mono text-[10px] text-white/60">{truncateAddress(eigen.ownerAddress)}</span>
              </div>
              <div className="h-px bg-white/6" />
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-1.5">
                  <span className="text-white/35">ID</span>
                  <span className="font-mono text-white/80">{eigen.agent8004Id ? `#${eigen.agent8004Id}` : '\u2014'}</span>
                </div>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <span className="text-white/35">Chain</span>
                  <span className="font-mono text-white/80">{eigen.chainId === 143 ? 'Monad' : 'Base'}</span>
                </div>
                {reputation && reputation.totalFeedback > 0 && (
                  <>
                    <div className="w-px h-3 bg-white/10" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/35">Rep</span>
                      <span className="font-mono text-white/80">{reputation.totalFeedback}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="h-px bg-white/6" />
              <div className="flex items-center justify-between">
                <span className="text-white/35">Registry</span>
                <span className="font-mono text-[10px] text-white/50">{truncateAddress(ERC8004_IDENTITY_REGISTRY)}</span>
              </div>
            </div>

            {/* Footer link */}
            <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {eigen.agent8004Id ? (
                <a
                  href={eigen.chainId === 143
                    ? `https://monadscan.com/token/${ERC8004_IDENTITY_REGISTRY}?a=${eigen.agent8004Id}`
                    : `https://basescan.org/token/${ERC8004_IDENTITY_REGISTRY}?a=${eigen.agent8004Id}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[10px] text-[#A78BFA]/70 hover:text-[#A78BFA] transition-colors"
                >
                  View on {eigen.chainId === 143 ? 'MonadScan' : 'BaseScan'}
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : (
                <p className="text-[10px] text-white/25 italic">Mints on deployment</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Header content ────────────────────────────────────────────────── */}
        <div className="relative z-[1] mx-auto px-4 sm:px-6 lg:px-10 pt-3 pb-[39px]">

          {/* Row 1: breadcrumb + status left, actions right — single tight row */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="detail-breadcrumb flex items-center gap-1.5">
                <Link href="/app" className="hover:text-eigen-violet transition-colors">Fleet</Link>
                <span className="text-txt-disabled/30">/</span>
                <span className="text-txt-primary">{eigen.tokenSymbol}</span>
              </div>
              <ClassBadge agentClass={eigen.class} size="md" />
              <StatusDot status={displayStatus} showLabel />
              {displayStatus === 'active' && (
                <span className="flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-status-success opacity-40 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-success" />
                  </span>
                  <span className="text-[10px] text-txt-disabled">{formatRuntime(eigen.createdAt)}</span>
                </span>
              )}
            </div>
            {connectedAddress && eigen?.ownerAddress && connectedAddress.toLowerCase() === eigen.ownerAddress.toLowerCase() && (
              <div className="flex items-center gap-1.5 lg:mr-4">
                {displayStatus !== 'terminated' && displayStatus !== 'closed' && displayStatus !== 'liquidated' && displayStatus !== 'pending_lp' && displayStatus !== 'pending_funding' ? (
                  <>
                    {displayStatus === 'active' ? (
                      <GlowButton variant="ghost" size="sm" onClick={handleSuspend} loading={suspendHook.isPending || suspendHook.isConfirming}>Suspend</GlowButton>
                    ) : (
                      <GlowButton variant="secondary" size="sm" onClick={handleResume} loading={resumeHook.isPending || resumeHook.isConfirming}>Resume</GlowButton>
                    )}
                    <GlowButton variant="ghost" size="sm" onClick={() => setShowAdjust(true)}>Adjust</GlowButton>
                    <GlowButton variant="ghost" size="sm" onClick={() => setShowTakeProfit(true)} loading={isTakingProfit}>Take Profit</GlowButton>
                    <div className="h-4 w-px bg-border-subtle mx-0.5" />
                    <GlowButton variant="ghost" size="sm" onClick={() => setShowTerminate(true)} loading={isTerminatingApi}>Terminate</GlowButton>
                    <GlowButton variant="danger" size="sm" onClick={() => setShowLiquidate(true)} loading={isLiquidating}>Liquidate</GlowButton>
                  </>
                ) : (
                  <GlowButton variant="danger" size="sm" onClick={() => setShowDelete(true)} loading={isDeleting}>Delete</GlowButton>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Token identity + volume + strategy stage */}
          <div className="flex items-end gap-8 lg:gap-12 mt-3 mb-1 lg:pr-[360px]">
            {/* Token name + logo */}
            <div className="flex-shrink-0 flex items-center gap-3.5">
              {/* Token logo — DexScreener with gradient fallback */}
              <div className="relative flex-shrink-0">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-full overflow-hidden border-2 border-[#E8E6E0] shadow-sm">
                  {eigen.tokenImageUrl ? (
                    <img
                      src={eigen.tokenImageUrl}
                      alt={eigen.tokenSymbol}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                    />
                  ) : eigen.tokenAddress ? (
                    <img
                      src={`https://dd.dexscreener.com/ds-data/tokens/${eigen.chainId === 143 ? 'monad' : 'base'}/${eigen.tokenAddress}.png`}
                      alt={eigen.tokenSymbol}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                    />
                  ) : null}
                  <div className={`w-full h-full flex items-center justify-center font-display text-lg text-white ${eigen.tokenImageUrl || eigen.tokenAddress ? 'hidden' : ''}`}
                    style={{ background: `linear-gradient(135deg, #7B3FE4 0%, #1A1A2E 100%)` }}>
                    {eigen.tokenSymbol?.charAt(0) || '?'}
                  </div>
                </div>
              </div>
              <div>
                <h2 className="font-display text-4xl md:text-5xl tracking-[-0.03em] leading-none text-txt-primary">
                  ${eigen.tokenSymbol}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[12px] text-txt-muted">{eigen.tokenName}</span>
                  <span className="font-mono text-[10px] text-txt-disabled bg-[#F5F3EE] px-1.5 py-0.5 rounded">{truncateAddress(eigen.id)}</span>
                </div>
              </div>
            </div>

            {/* Volume */}
            <div className="flex-shrink-0">
              <p className="text-[9px] uppercase tracking-[0.14em] text-eigen-violet font-medium mb-0.5">Volume Generated</p>
              <div className="font-mono text-4xl md:text-5xl font-bold leading-none" style={{ background: 'linear-gradient(135deg, #1A1A2E 40%, #7B3FE4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {formatEth(eigen.volumeGenerated)}
                <span className="text-[0.35em] font-medium" style={{ WebkitTextFillColor: '#706F84' }}> MON</span>
              </div>
              <p className="text-[11px] text-txt-disabled mt-0.5">
                from {formatEth(eigen.ethDeposited)} deposited
              </p>
            </div>

            {/* Strategy Stage — fills middle gap; min-h keeps island tall enough for the ERC-8004 hole (y=363 with inverse radius) */}
            <div className="hidden lg:flex flex-col flex-1 items-end justify-end lg:min-h-[120px]">
              <div className="w-full max-w-[320px]">
                <p className="text-[10px] uppercase tracking-[0.14em] text-txt-disabled font-medium mb-2">Strategy Stage</p>
                <div className="flex items-baseline gap-3 mb-2.5">
                  <span className="font-display text-2xl tracking-[-0.01em] leading-none" style={{ color: strategyStage.color }}>
                    {strategyStage.name}
                  </span>
                  <span className="text-[10px] font-mono text-txt-disabled">{strategyStage.progress.toFixed(0)}%</span>
                </div>
                <p className="text-[12px] text-txt-muted leading-relaxed mb-3">{strategyStage.description}</p>
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-[#F0EDE8] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${strategyStage.progress}%`, background: `linear-gradient(90deg, ${strategyStage.color}, ${strategyStage.color}dd)` }}
                  />
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <span className="text-[10px] text-txt-disabled">{daysActive.toFixed(1)}d active</span>
                </div>

                {/* Agent Instructions — custom AI strategy prompt */}
                {connectedAddress && eigen?.ownerAddress && connectedAddress.toLowerCase() === eigen.ownerAddress.toLowerCase() && (
                  <div className="mt-3">
                    {isEditingPrompt ? (
                      <div className="border border-[#E8E6E0] rounded-xl bg-white/60 p-3">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-txt-disabled font-medium mb-1.5">Agent Instructions</p>
                        <textarea
                          value={promptDraft}
                          onChange={(e) => setPromptDraft(e.target.value.slice(0, 2000))}
                          placeholder="e.g. Buy more aggressively on 5%+ dips. Reduce position size during low volume hours."
                          className="w-full h-20 text-[12px] text-txt-primary bg-[#F5F3EE] border border-[#E8E6E0] rounded-lg p-2 resize-none focus:outline-none focus:border-eigen-violet/40 placeholder:text-txt-disabled/60"
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] font-mono text-txt-disabled">{promptDraft.length}/2000</span>
                          <div className="flex items-center gap-1.5">
                            {promptError && <span className="text-[10px] text-status-danger mr-1">{promptError}</span>}
                            <button
                              onClick={() => { setIsEditingPrompt(false); setPromptError(null); }}
                              className="text-[11px] text-txt-muted hover:text-txt-primary px-2 py-1 rounded-md transition-colors"
                              disabled={isSavingPrompt}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSavePrompt}
                              disabled={isSavingPrompt}
                              className="text-[11px] font-medium text-white bg-eigen-violet hover:bg-eigen-violet/90 px-3 py-1 rounded-md transition-colors disabled:opacity-50"
                            >
                              {isSavingPrompt ? 'Signing...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPromptDraft(eigen?.customPrompt || ''); setIsEditingPrompt(true); setPromptError(null); }}
                        className="w-full text-left group"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] uppercase tracking-[0.14em] text-txt-disabled font-medium">Agent Instructions</span>
                          <span className="text-[9px] text-eigen-violet opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
                        </div>
                        {eigen?.customPrompt ? (
                          <p className="text-[11px] text-txt-muted leading-relaxed line-clamp-2">{eigen.customPrompt}</p>
                        ) : (
                          <p className="text-[11px] text-txt-disabled/60 italic">No custom strategy instructions set</p>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Scorecard strip — bottom left */}
          <div className="mt-3 mb-4 max-w-lg">
            <div className="grid grid-cols-3 gap-0 border border-[#E8E6E0] rounded-xl overflow-hidden">
              {([
                { label: 'Efficiency', value: `${capitalEfficiency.toFixed(1)}`, suffix: '\u00d7' },
                { label: 'Net ROI', value: `${netRoi > 0 ? '+' : ''}${netRoi.toFixed(1)}`, suffix: '%', pnl: netRoi },
                { label: 'Attainment', value: `${Math.min(volumeAttainment, 999).toFixed(0)}`, suffix: '%', highlight: volumeAttainment >= 100 },
              ] as const).map((s, i) => (
                <div
                  key={s.label}
                  className={`text-center py-3 px-2 ${i < 2 ? 'border-r border-[#E8E6E0]' : ''}`}
                  style={{ background: 'linear-gradient(180deg, #FAFAF7 0%, #FFFFFF 100%)' }}
                >
                  <p className="text-[8px] uppercase tracking-[0.14em] text-txt-disabled font-medium">{s.label}</p>
                  <div className="mt-0.5">
                    <span
                      className={`font-mono text-xl md:text-2xl font-bold leading-none ${
                        'pnl' in s && s.pnl !== undefined
                          ? s.pnl > 0 ? 'text-status-success' : s.pnl < 0 ? 'text-status-danger' : 'text-txt-primary'
                          : 'highlight' in s && s.highlight ? 'text-status-success' : ''
                      }`}
                      style={!('pnl' in s) && !('highlight' in s && s.highlight) ? { background: 'linear-gradient(135deg, #1A1A2E 40%, #7B3FE4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : undefined}
                    >
                      {s.value}
                    </span>
                    <span className="text-[0.6em] font-mono font-semibold text-txt-muted ml-0.5">{s.suffix}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TxStatus */}
          {activeTx && (
            <div className="mb-3">
              <TxStatus
                hash={activeTx.hash}
                isPending={activeTx.isPending}
                isConfirming={activeTx.isConfirming}
                isSuccess={activeTx.isSuccess}
                error={activeTx.error}
              />
            </div>
          )}

          {/* Low Balance Warning */}
          {eigen.lowBalance?.needsDeposit && displayStatus === 'active' && (
            <div className="flex items-center gap-3 rounded-2xl bg-[#FEF7ED] border border-amber-200/50 pl-4 pr-4 py-3 mb-3">
              <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-amber-500">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-display text-xs text-txt-primary">Low balance</span>
                <span className="text-[11px] text-txt-muted ml-2">Add ETH to continue volume generation</span>
              </div>
              <GlowButton variant="primary" size="sm" onClick={() => setShowDepositInput(true)}>Add ETH</GlowButton>
            </div>
          )}

          {/* Mobile-only ERC-8004 */}
          <div className="lg:hidden mt-3 mb-3">
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(19,21,23,0.95)', border: '1px solid rgba(123,63,228,0.15)' }}>
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7B3FE4 0%, #A78BFA 100%)' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-white">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <span className="font-display text-[13px] text-white/90">ERC-8004</span>
                  <div className="flex-1" />
                  {eigen.agent8004Id ? (
                    <span className="text-[9px] font-medium text-[#6DB89B] bg-[#6DB89B]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Minted</span>
                  ) : (
                    <span className="text-[9px] font-medium text-[#A78BFA] bg-[#A78BFA]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Pending</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] flex-wrap">
                  <span className="text-white/35">ID <span className="font-mono text-white/80">{eigen.agent8004Id ? `#${eigen.agent8004Id}` : '\u2014'}</span></span>
                  <span className="text-white/35">Chain <span className="font-mono text-white/80">{eigen.chainId === 143 ? 'Monad' : 'Base'}</span></span>
                  <span className="text-white/35">Registry <span className="font-mono text-[10px] text-white/50">{truncateAddress(ERC8004_IDENTITY_REGISTRY)}</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </AppPageShell>

      {/* ── Combined inverse-L section: white cards on anti-diagonal, dark bg shows through ── */}
      <div className="relative z-[3] lg:-mt-[8px]">
        <div className="grid grid-cols-1 lg:grid-cols-[44%_56%] gap-6 lg:gap-0">

          {/* Top-left: dark bg (transparent), terminal panel */}
          <div className="order-1 lg:col-start-1 lg:row-start-1 p-5 lg:p-5 lg:pl-8 lg:pr-8">
            {/* Pair + market cap strip */}
            <div className="flex items-end justify-between px-0.5 pb-2.5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium mb-0.5">Market Cap</p>
                <p className="font-display text-lg md:text-xl text-white/90 tracking-tight leading-none whitespace-nowrap">
                  {(() => {
                    const mcap = geckoPool?.fdvUsd ?? geckoPool?.marketCapUsd ?? (eigen.marketCap != null && eigen.marketCap > 0 ? eigen.marketCap : null);
                    return mcap != null && mcap > 0
                      ? <>${formatCompact(mcap)}</>
                      : <span className="text-white/30">&mdash;</span>;
                  })()}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <a
                    href={`https://dexscreener.com/${eigen.chainId === 143 ? 'monad' : 'base'}/${eigen.poolAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[10px] text-white/35 hover:text-[#A78BFA] transition-colors border border-white/10 rounded-full px-2.5 py-0.5"
                  >
                    DexScreener
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                  {eigen.chainId === 143 && eigen.tokenAddress && (
                    <a
                      href={`https://nad.fun/token/${eigen.tokenAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] text-white/35 hover:text-[#A78BFA] transition-colors border border-white/10 rounded-full px-2.5 py-0.5"
                    >
                      nad.fun
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/45 font-medium mb-0.5">Pool Pair</p>
                <p className="font-display text-lg md:text-xl text-white/90 tracking-tight leading-none whitespace-nowrap">
                  ${eigen.tokenSymbol}<span className="text-white/35 text-[0.55em] ml-0.5">/{eigen.chainId === 143 ? 'MON' : 'ETH'}</span>
                </p>
                <div className="flex justify-end gap-1 mt-1.5">
                  {['1h', '4h', '1d', '7d', '30d'].map((range) => (
                    <button
                      key={range}
                      onClick={() => setPriceRange(range)}
                      className={`px-2.5 py-1 text-[10px] font-mono font-medium rounded-full transition-all min-h-[44px] md:min-h-0 border ${priceRange === range
                          ? 'text-white border-eigen-violet/40 bg-eigen-violet/10'
                          : 'text-white/35 border-white/10 hover:text-white/60 hover:border-white/20'
                        }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Unified terminal panel — glassmorphic ultraviolet crystal */}
            <div
              className="rounded-2xl overflow-hidden shadow-[0_8px_60px_rgba(123,63,228,0.15),0_2px_20px_rgba(0,0,0,0.3)]"
              style={{
                background: 'linear-gradient(135deg, rgba(123,63,228,0.08) 0%, rgba(15,17,23,0.85) 40%, rgba(123,63,228,0.05) 100%)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(123,63,228,0.15)',
              }}
            >
              {/* Chart area */}
              <PriceChart key={ohlcvData.length > 0 ? 'candle' : 'line'} ohlcvData={ohlcvData} lineData={priceHistory} symbol={eigen.tokenSymbol} className="h-[300px]" theme="dark" />

              {/* Trade history header */}
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{ borderTop: '1px solid rgba(123,63,228,0.12)', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(123,63,228,0.04)' }}
              >
                <span className="font-display text-[12px] italic text-[#A78BFA]">Trade History</span>
                <span className="font-mono text-[10px] text-[#A78BFA]/70 bg-[rgba(123,63,228,0.10)] px-2 py-0.5 rounded-full">{trades.length}</span>
              </div>

              {/* Trade rows */}
              <div className="max-h-[240px] overflow-y-auto">
                {trades.length === 0 ? (
                  <div className="flex items-center justify-center py-8 font-mono text-xs text-white/40">
                    Awaiting trades
                  </div>
                ) : (
                  trades.map((trade, i) => {
                    const isBuy = trade.type === 'buy' || trade.type === 'profit_take';
                    const isSell = trade.type === 'sell' || trade.type === 'liquidation' || trade.type === 'reactive_sell';
                    const sideColor = isBuy ? 'text-[#6DB89B]' : isSell ? 'text-[#C76E6E]' : 'text-white/30';
                    const labels: Record<string, string> = {
                      buy: 'BUY', sell: 'SELL', rebalance: 'RBL',
                      profit_take: 'TAKE', liquidation: 'LIQ',
                      fee_claim: 'FEE', reactive_sell: 'R.SL',
                    };
                    return (
                      <div
                        key={trade.id}
                        className={`grid grid-cols-[3.2rem_2.5rem_1fr_auto_auto] items-center gap-3 px-4 py-[6px] text-[11px] transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.03]'
                          }`}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(123,63,228,0.08)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? '' : 'rgba(255,255,255,0.03)'}
                      >
                        <span className="font-mono text-white/50 tabular-nums">
                          {formatTimestamp(trade.createdAt)}
                        </span>
                        <span className={`font-sans font-semibold text-[10px] ${sideColor}`}>
                          {labels[trade.type] || trade.type.slice(0, 4).toUpperCase()}
                        </span>
                        <span className="font-mono text-white/80 tabular-nums truncate">
                          {formatEth(trade.ethAmount)} <span className="text-white/40">MON</span>
                        </span>
                        <span className={`font-mono text-[10px] tabular-nums text-right min-w-[4rem] ${trade.pnlImpact > 0 ? 'text-[#6DB89B]' : trade.pnlImpact < 0 ? 'text-[#C76E6E]' : 'text-transparent'
                          }`}>
                          {trade.pnlImpact !== 0 ? `${trade.pnlImpact > 0 ? '+' : ''}${formatEth(trade.pnlImpact)}` : ''}
                        </span>
                        {trade.txHash ? (
                          <a
                            href={`https://monadvision.com/tx/${trade.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-white/30 hover:text-[#A78BFA] transition-colors w-[3.5rem] text-right"
                          >
                            {trade.txHash.slice(0, 6)}
                          </a>
                        ) : <span className="w-[3.5rem]" />}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Top-right: white card, analytics charts */}
          <div className="order-2 lg:col-start-2 lg:row-start-1 float-card merged-panel-tr !shadow-none p-5 lg:p-6 lg:pr-8">
            {/* Concave bridge: SVG quarter-circle, pixel-perfect, matches bridge cutout radius (56px) */}
            <svg
              className="hidden lg:block absolute top-[7px] -left-[56px]"
              width="56"
              height="56"
              viewBox="0 0 56 56"
              fill="none"
              aria-hidden="true"
            >
              <path d="M0,0 L56,0 L56,56 A56,56 0 0,0 0,0Z" fill="#FFFFFF" />
            </svg>
            {rawTrades && rawTrades.length > 0 ? (
              <div className="space-y-3">
                <div className="p-3 bg-[#FAFAF7] border border-[#E8E6E0] rounded-xl">
                  <h3 className="detail-section-title mb-2">Volume &amp; Balance</h3>
                  <PnlChart trades={rawTrades} ethDeposited={eigen.ethDeposited} className="h-[170px]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#FAFAF7] border border-[#E8E6E0] rounded-xl">
                    <h3 className="detail-section-title mb-2">Volume by Hour</h3>
                    <VolumeChart trades={rawTrades} className="h-[150px]" />
                  </div>
                  <div className="p-3 bg-[#FAFAF7] border border-[#E8E6E0] rounded-xl">
                    <h3 className="detail-section-title mb-2">Distribution</h3>
                    <TradeDistribution trades={rawTrades} className="h-[150px]" />
                  </div>
                </div>

                {/* ── Performance Ledger — below charts ── */}
                <div className="px-1 pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="detail-section-title">Performance Ledger</span>
                    <div className="flex-1 border-b border-[#E8E6E0]" />
                  </div>
                  <div className="space-y-0">
                    {[
                      { label: 'Daily Volume', value: formatEth(dailyVolume), suffix: 'MON/d' },
                      { label: 'Avg Trade Size', value: formatEth(avgTradeSize), suffix: 'MON' },
                      { label: 'Trades', value: eigen.tradesExecuted.toLocaleString(), suffix: `(${tradesPerDay.toFixed(1)}/d)` },
                      { label: 'Win Rate', value: `${eigen.winRate.toFixed(1)}%`, suffix: '' },
                      { label: 'Gas Efficiency', value: `${costPerVolume.toFixed(3)}%`, suffix: 'cost/vol' },
                      { label: 'LP Fees Earned', value: formatEth(eigen.lpFeesEarned), suffix: 'MON' },
                      { label: 'Net P&L', value: `${netPnl > 0 ? '+' : ''}${formatEth(netPnl)}`, suffix: 'MON', pnl: netPnl },
                      { label: 'Remaining', value: formatEth(eigen.ethBalance), suffix: 'MON' },
                    ].map((row, i) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-[7px]"
                        style={i > 0 ? { borderTop: '1px solid #F0EDE8' } : undefined}
                      >
                        <span className="text-[11px] text-txt-muted">{row.label}</span>
                        <span className={`font-mono text-[12px] font-medium tabular-nums ${
                          'pnl' in row && (row as any).pnl !== undefined
                            ? (row as any).pnl > 0 ? 'text-status-success' : (row as any).pnl < 0 ? 'text-status-danger' : 'text-txt-primary'
                            : 'text-txt-primary'
                        }`}>
                          {row.value}
                          {row.suffix && <span className="text-txt-disabled font-normal text-[10px] ml-1">{row.suffix}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-14 font-display italic text-sm text-txt-disabled">
                Awaiting trade data for charts
              </div>
            )}
          </div>

          {/* Bottom-left: white card, metrics + actions */}
          <div className="order-4 lg:order-3 lg:col-start-1 lg:row-start-2 float-card merged-panel-bl !shadow-none p-5 lg:p-6 lg:pl-8">
            <div className="space-y-4">
              {/* Value Breakdown + Costs side by side */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <span className="detail-section-title">Value Breakdown</span>
                  <div className="space-y-1">
                    <WaterfallRow label="Vault Balance" value={eigen.ethBalance} percent={eigen.ethDeposited > 0 ? (eigen.ethBalance / eigen.ethDeposited) * 100 : 0} />
                    <WaterfallRow label="Token Value" value={inventoryTokenValue} percent={eigen.ethDeposited > 0 ? (inventoryTokenValue / eigen.ethDeposited) * 100 : 0} />
                    <WaterfallRow label="LP Fees" value={eigen.lpFeesEarned} percent={eigen.ethDeposited > 0 ? (eigen.lpFeesEarned / eigen.ethDeposited) * 100 : 0} />
                    <div className="border-t border-border-subtle" />
                    <WaterfallRow label="Deposited" value={-eigen.ethDeposited} isCost />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="detail-section-title">Operating Costs</span>
                  <div className="space-y-1">
                    <WaterfallRow label="Realized P&L" value={eigen.realizedPnl} percent={eigen.ethDeposited > 0 ? (eigen.realizedPnl / eigen.ethDeposited) * 100 : 0} />
                    <WaterfallRow label="Protocol Fees" value={-eigen.protocolFeeAccrued} isCost />
                    <WaterfallRow label="Gas Spent" value={-eigen.totalGasSpent} isCost />
                  </div>
                </div>
              </div>

              {/* Inventory + LP split bars */}
              <div className="border-t border-border-subtle pt-3 space-y-2.5">
                {/* Trading inventory bar */}
                <div>
                  <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-txt-disabled mb-1">
                    <span>ETH {Math.round(ethRatio)}%</span>
                    <span>Inventory Split</span>
                    <span>Token {Math.round(100 - ethRatio)}%</span>
                  </div>
                  <div className="h-4 rounded-xl bg-[#F5F3EE] overflow-hidden flex">
                    <div
                      className="h-full bg-txt-primary/70 rounded-l-full transition-all"
                      style={{ width: `${ethRatio}%` }}
                    />
                    <div
                      className="h-full bg-eigen-violet/60 rounded-r-full transition-all"
                      style={{ width: `${100 - ethRatio}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-txt-disabled mt-0.5">
                    <span>{formatEth(inventoryEthValue)} ETH</span>
                    <span>{eigen.tokenBalance.toLocaleString()} {eigen.tokenSymbol}</span>
                  </div>
                </div>

                {/* LP fees bar */}
                {(eigen.lpFeesEarned > 0 || eigen.lpFeesClaimed > 0) && (() => {
                  const totalLpFees = eigen.lpFeesEarned;
                  const claimedPct = totalLpFees > 0 ? (eigen.lpFeesClaimed / totalLpFees) * 100 : 0;
                  const unclaimedPct = 100 - claimedPct;
                  return (
                    <div>
                      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-txt-disabled mb-1">
                        <span>Claimed {Math.round(claimedPct)}%</span>
                        <span>LP Fees</span>
                        <span>Unclaimed {Math.round(unclaimedPct)}%</span>
                      </div>
                      <div className="h-3 rounded-xl bg-[#F5F3EE] overflow-hidden flex">
                        <div
                          className="h-full bg-status-success/60 rounded-l-full transition-all"
                          style={{ width: `${claimedPct}%` }}
                        />
                        <div
                          className="h-full bg-[#7B3FE4]/40 rounded-r-full transition-all"
                          style={{ width: `${unclaimedPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-txt-disabled mt-0.5">
                        <span>{formatEth(eigen.lpFeesClaimed)} ETH</span>
                        <span>{formatEth(eigen.lpFeesEarned - eigen.lpFeesClaimed)} ETH</span>
                      </div>
                    </div>
                  );
                })()}

                {/* ── UniswapV4 LP Performance ── */}
                {(() => {
                  const zeroAddr = '0x0000000000000000000000000000000000000000';
                  // LP position exists if either: on-chain EigenLP has it, or keeper config has a pool (atomic launch)
                  const hasOnChainLP = lpPosition.token && lpPosition.token !== zeroAddr;
                  const hasConfigLP = eigen.lpPoolId && eigen.lpPoolId !== zeroAddr && !/^0x0+$/.test(eigen.lpPoolId);
                  const hasLP = hasOnChainLP || hasConfigLP;
                  const lpFeeYield = eigen.ethDeposited > 0 ? (eigen.lpFeesEarned / eigen.ethDeposited) * 100 : 0;
                  const unclaimedFees = eigen.lpFeesEarned - eigen.lpFeesClaimed;
                  const feesBarWidth = eigen.ethDeposited > 0 ? Math.min((eigen.lpFeesEarned / eigen.ethDeposited) * 100, 100) : 0;

                  return (
                    <div className="relative rounded-xl border border-[#E8E6E0] overflow-hidden" style={{ background: 'linear-gradient(180deg, #FAFAF7 0%, #FFFFFF 100%)' }}>
                      {/* Header */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E6E0]/60">
                        <img src="/logos/uniswap.svg" alt="V4 LP" width={70} height={70} className="flex-shrink-0 -my-2" />
                        <span className="text-[13px] font-medium text-txt-primary tracking-wide self-end -mb-[2px] -ml-2">V4 LP</span>
                        <div className="flex-1" />
                        {hasLP ? (
                          <span className="flex items-center gap-1">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full rounded-full bg-status-success opacity-40 animate-ping" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-success" />
                            </span>
                            <span className="text-[9px] text-status-success font-medium uppercase tracking-wider">Active</span>
                          </span>
                        ) : (
                          <span className="text-[9px] text-txt-disabled font-medium uppercase tracking-wider">
                            {lpPosition.isLoading ? 'Loading…' : 'No Position'}
                          </span>
                        )}
                      </div>

                      <div className="px-3 py-2.5 space-y-2.5">
                        {/* Position details row */}
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-txt-disabled">Pair</span>
                          <span className="font-mono font-medium text-txt-primary">{eigen.tokenSymbol}/ETH</span>
                          <div className="w-px h-3 bg-[#E8E6E0]" />
                          <span className="text-txt-disabled">Fee</span>
                          <span className="font-mono font-medium text-txt-primary">0.99%</span>
                          <div className="w-px h-3 bg-[#E8E6E0]" />
                          <span className="text-txt-disabled">Range</span>
                          <span className="font-medium text-txt-primary">Full</span>
                          {hasLP && lpPosition.tokenId && (
                            <>
                              <div className="w-px h-3 bg-[#E8E6E0]" />
                              <span className="text-txt-disabled">NFT</span>
                              <span className="font-mono font-medium text-txt-primary">#{lpPosition.tokenId.toString()}</span>
                            </>
                          )}
                        </div>

                        {/* Fee yield bar — fees earned relative to deposited ETH */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] uppercase tracking-wider text-txt-disabled">Fee Yield</span>
                            <span className={`text-[11px] font-mono font-bold ${lpFeeYield > 0 ? 'text-status-success' : 'text-txt-disabled'}`}>
                              {lpFeeYield > 0 ? '+' : ''}{lpFeeYield.toFixed(2)}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#F0EDE8] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(feesBarWidth, feesBarWidth > 0 ? 2 : 0)}%`,
                                background: 'linear-gradient(90deg, #7B3FE4 0%, #6DB89B 100%)',
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[9px] text-txt-disabled">
                              {formatEth(eigen.lpFeesEarned)} earned
                            </span>
                            <span className="text-[9px] text-txt-disabled">
                              of {formatEth(eigen.ethDeposited)} deposited
                            </span>
                          </div>
                        </div>

                        {/* Compact metrics row */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center rounded-lg py-1.5" style={{ background: 'rgba(123,63,228,0.04)' }}>
                            <p className="text-[8px] uppercase tracking-wider text-txt-disabled">Earned</p>
                            <p className="font-mono text-[12px] font-bold text-txt-primary mt-0.5">{formatEth(eigen.lpFeesEarned)}</p>
                            <p className="text-[8px] text-txt-disabled">MON</p>
                          </div>
                          <div className="text-center rounded-lg py-1.5" style={{ background: 'rgba(109,184,155,0.06)' }}>
                            <p className="text-[8px] uppercase tracking-wider text-txt-disabled">Claimed</p>
                            <p className="font-mono text-[12px] font-bold text-status-success mt-0.5">{formatEth(eigen.lpFeesClaimed)}</p>
                            <p className="text-[8px] text-txt-disabled">MON</p>
                          </div>
                          <div className="text-center rounded-lg py-1.5" style={{ background: unclaimedFees > 0 ? 'rgba(123,63,228,0.06)' : 'rgba(0,0,0,0.02)' }}>
                            <p className="text-[8px] uppercase tracking-wider text-txt-disabled">Unclaimed</p>
                            <p className={`font-mono text-[12px] font-bold mt-0.5 ${unclaimedFees > 0 ? 'text-[#7B3FE4]' : 'text-txt-disabled'}`}>{formatEth(unclaimedFees)}</p>
                            <p className="text-[8px] text-txt-disabled">MON</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Action buttons — only visible to eigen owner — LP moved to dark panel */}
              {connectedAddress && eigen?.ownerAddress && connectedAddress.toLowerCase() === eigen.ownerAddress.toLowerCase() && (
                <>
                  {(displayStatus === 'pending_lp' || displayStatus === 'pending_funding') ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/30">
                      <div className="flex items-center gap-2 text-xs text-amber-600">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                        <span>{displayStatus === 'pending_lp' ? 'Vault not yet created on-chain. Token was deployed but LP/vault setup failed.' : 'Awaiting vault funding.'}</span>
                      </div>
                    </div>
                  ) : displayStatus === 'terminated' ? (
                    eigen.ethBalance > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-subtle">
                        <GlowButton
                          variant="primary"
                          size="sm"
                          onClick={handleWithdraw}
                          loading={withdrawHook.isPending || withdrawHook.isConfirming}
                        >
                          Withdraw Remaining ETH
                        </GlowButton>
                        <span className="text-caption text-txt-disabled">
                          {formatEth(eigen.ethBalance)} ETH still in vault
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border-subtle">
                      {showDepositInput ? (
                        <div className="flex items-center gap-2.5 w-full">
                          <input
                            type="number"
                            step="0.001"
                            min="0.001"
                            placeholder="ETH amount"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            className="w-32 px-3 py-1.5 text-sm font-mono bg-[#F9F8F5] border border-[#E8E6E0] rounded-xl text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-eigen-violet/30"
                          />
                          <GlowButton
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              if (depositAmount && parseFloat(depositAmount) > 0) {
                                depositHook.deposit(eigen.id, depositAmount);
                                setShowDepositInput(false);
                                setDepositAmount('');
                              }
                            }}
                            loading={depositHook.isPending || depositHook.isConfirming}
                          >
                            Confirm
                          </GlowButton>
                          <button
                            onClick={() => { setShowDepositInput(false); setDepositAmount(''); }}
                            className="text-xs text-txt-disabled hover:text-txt-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <GlowButton
                            variant="primary"
                            size="sm"
                            onClick={() => setShowDepositInput(true)}
                          >
                            Add ETH
                          </GlowButton>
                          <GlowButton
                            variant="ghost"
                            size="sm"
                            onClick={handleWithdraw}
                            loading={withdrawHook.isPending || withdrawHook.isConfirming}
                          >
                            Withdraw
                          </GlowButton>
                        </>
                      )}
                      <div className="flex items-center gap-2 ml-auto group relative">
                        <span className="text-xs text-txt-muted">Auto Sell</span>
                        <button
                          onClick={handleToggleReactiveSell}
                          className={`relative w-10 h-5 rounded-full transition-colors ${eigen.reactiveSellMode ? 'bg-status-success' : 'bg-bg-hover'
                            }`}
                          disabled={isTogglingReactiveSell}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${eigen.reactiveSellMode ? 'translate-x-5' : ''
                            }`} />
                        </button>
                        <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 rounded-lg bg-bg-card border border-border-subtle text-xs text-txt-muted whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-lg">
                          Triggers a sell on each external buy
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Bottom-right: dark bg (transparent), parameters + key stats */}
          <div className="order-3 lg:order-4 lg:col-start-2 lg:row-start-2 p-5 lg:p-6 lg:pl-8 lg:pr-8">

            {/* ── Price & Position — hero row with large numbers ── */}
            <div className="flex items-start gap-6 mb-5">
              <div className="flex-1">
                <span className="text-[10px] text-white/40 uppercase tracking-[0.14em]">Entry</span>
                <p className="font-mono text-xl font-bold text-white/90 leading-tight mt-0.5">{formatPrice(eigen.entryPrice)}</p>
              </div>
              <div className="flex-1">
                <span className="text-[10px] text-white/40 uppercase tracking-[0.14em]">Current</span>
                <p className="font-mono text-xl font-bold text-white/90 leading-tight mt-0.5">{formatPrice(eigen.currentPrice)}</p>
              </div>
              <div className="flex-1 text-right">
                <span className="text-[10px] text-white/40 uppercase tracking-[0.14em]">Impact</span>
                <p className={`font-mono text-xl font-bold leading-tight mt-0.5 ${priceImpact > 0 ? 'text-[#6DB89B]' : priceImpact < 0 ? 'text-[#C76E6E]' : 'text-white/90'}`}>
                  {priceImpact > 0 ? '+' : ''}{priceImpact.toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Parameters — compact 3-column grid */}
            <span className="font-display text-sm italic text-white/50">Parameters</span>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2.5 mt-2">
              <DarkParamRow label="Volume Target" value={`${eigen.volumeTarget} ETH/day`} />
              <DarkParamRow label="Frequency" value={`${eigen.tradeFrequency} trades/hr`} />
              <DarkParamRow label="Order Size" value={`${eigen.orderSizePctMin}-${eigen.orderSizePctMax}%`} />
              <DarkParamRow label="Spread" value={`${eigen.spreadWidth}%`} />
              <DarkParamRow label="Profit Target" value={`${eigen.profitTarget}%`} />
              <DarkParamRow label="Stop Loss" value={`${eigen.stopLoss}%`} />
              <DarkParamRow label="Rebalance" value={`${eigen.rebalanceThreshold}`} />
              <DarkParamRow label="Wallets" value={String(eigen.walletCount)} />
              <DarkParamRow label="Reactive Sell" value={eigen.reactiveSellMode ? `ON (${eigen.reactiveSellPct}%)` : 'OFF'} />
            </div>

            {/* On-Chain Reputation (ERC-8004) */}
            {eigen.agent8004Id && reputation && reputation.totalFeedback > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="font-display text-sm italic text-white/50">On-Chain Reputation</span>
                <div className="grid grid-cols-4 gap-3 mt-2">
                  {reputation.recentFeedback
                    .filter((f, i, arr) => arr.findIndex((x) => x.tag1 === f.tag1) === i)
                    .slice(0, 4)
                    .map((f) => (
                      <div key={f.tag1} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-white/45 uppercase tracking-[0.12em]">{f.tag1}</span>
                        <span className="font-mono text-xs text-white">
                          {f.tag1 === 'volume' ? `${(f.value / 100).toFixed(2)} MON`
                            : f.tag1 === 'pnl' ? `${f.value > 0 ? '+' : ''}${(f.value / 100).toFixed(0)} bps`
                            : f.tag1 === 'win-rate' ? `${(f.value / 100).toFixed(1)}%`
                            : f.tag1 === 'uptime' ? `${(f.value / 100).toFixed(1)}%`
                            : String(f.value)}
                        </span>
                      </div>
                    ))
                  }
                </div>
                <p className="text-[10px] text-white/30 mt-1.5">
                  {reputation.totalFeedback} on-chain signals via ERC-8004
                </p>
              </div>
            )}

            {/* ── EigenLP Position ── */}
            {(() => {
              const zeroAddr = '0x0000000000000000000000000000000000000000';
              const hasLP = lpPosition.token && lpPosition.token !== zeroAddr;
              const noLP = !lpPosition.token || lpPosition.token === zeroAddr;
              const canCreate = noLP && displayStatus === 'active' && eigen.tokenAddress;

              return (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-display text-sm italic text-white/50">EigenLP</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    {hasLP ? (
                      <span className="flex items-center gap-1.5">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-[#6DB89B] opacity-40 animate-ping" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#6DB89B]" />
                        </span>
                        <span className="text-[10px] text-[#6DB89B] font-medium uppercase tracking-wider">Active</span>
                      </span>
                    ) : lpPosition.isLoading ? (
                      <span className="text-[10px] text-white/30 font-medium uppercase tracking-wider">Loading…</span>
                    ) : (
                      <span className="text-[10px] text-white/30 font-medium uppercase tracking-wider">No Position</span>
                    )}
                  </div>

                  {/* LP ledger — dark style */}
                  <div className="space-y-0 mb-3">
                    {(hasLP ? [
                      { label: 'Pool', value: lpPosition.poolId ? `${lpPosition.poolId.slice(0, 8)}…${lpPosition.poolId.slice(-6)}` : '—', mono: true },
                      { label: 'Position NFT', value: lpPosition.tokenId ? `#${lpPosition.tokenId.toString()}` : '—', mono: true },
                      { label: 'Fee Tier', value: '0.99%', mono: false },
                      { label: 'Tick Spacing', value: lpPosition.tickSpacing?.toString() || '198', mono: true },
                      { label: 'Range', value: 'Full Range', mono: false },
                      { label: 'Pair', value: `${eigen.tokenSymbol} / MON`, mono: false },
                      { label: 'Fees Earned', value: `${formatEth(eigen.lpFeesEarned)} MON`, mono: true, highlight: eigen.lpFeesEarned > 0 },
                      { label: 'Fees Claimed', value: `${formatEth(eigen.lpFeesClaimed)} MON`, mono: true },
                      { label: 'Unclaimed', value: `${formatEth(eigen.lpFeesEarned - eigen.lpFeesClaimed)} MON`, mono: true, highlight: (eigen.lpFeesEarned - eigen.lpFeesClaimed) > 0 },
                    ] : [
                      { label: 'Pair', value: `${eigen.tokenSymbol} / MON`, mono: false },
                      { label: 'Protocol', value: 'Uniswap V4', mono: false },
                      { label: 'Fee Tier', value: '0.99%', mono: false },
                      { label: 'Fees Earned', value: `${formatEth(eigen.lpFeesEarned)} MON`, mono: true, highlight: eigen.lpFeesEarned > 0 },
                      { label: 'Fees Claimed', value: `${formatEth(eigen.lpFeesClaimed)} MON`, mono: true },
                    ]).map((row, i) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-[6px]"
                        style={i > 0 ? { borderTop: '1px solid rgba(255,255,255,0.06)' } : undefined}
                      >
                        <span className="text-[10px] text-white/45 uppercase tracking-[0.12em]">{row.label}</span>
                        <span className={`text-[12px] font-medium tabular-nums ${row.mono ? 'font-mono' : 'font-sans'} ${
                          'highlight' in row && row.highlight ? 'text-[#6DB89B]' : 'text-white/90'
                        }`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* LP Action buttons */}
                  {hasLP && (
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <GlowButton
                        variant="secondary"
                        size="sm"
                        onClick={() => collectFeesHook.collectFees(eigen.id)}
                        loading={collectFeesHook.isPending || collectFeesHook.isConfirming}
                      >
                        Claim Fees
                      </GlowButton>
                      <GlowButton
                        variant="secondary"
                        size="sm"
                        onClick={() => compoundFeesHook.compoundFees(eigen.id)}
                        loading={compoundFeesHook.isPending || compoundFeesHook.isConfirming}
                      >
                        Compound
                      </GlowButton>
                      {showRemoveLP ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <GlowButton
                              variant="danger"
                              size="sm"
                              onClick={async () => {
                                setRemoveLpLoading(true);
                                setRemoveLpError(null);
                                try {
                                  // Try direct on-chain call first (user is eigenOwner)
                                  // If that fails (keeper is eigenOwner), fall back to keeper API
                                  if (lpPosition.eigenOwner?.toLowerCase() === connectedAddress?.toLowerCase()) {
                                    removeLiquidityHook.removeLiquidity(eigen.id);
                                    setShowRemoveLP(false);
                                  } else {
                                    const res = await fetch(`${process.env.NEXT_PUBLIC_KEEPER_API_URL || 'http://localhost:3001'}/api/eigens/${eigen.id}/remove-lp`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ owner_address: connectedAddress }),
                                    });
                                    const data = await res.json();
                                    if (!res.ok) throw new Error(data.error || 'Failed to remove LP');
                                    setShowRemoveLP(false);
                                  }
                                  queryClient.invalidateQueries({ queryKey: ['eigen', id] });
                                } catch (err: any) {
                                  setRemoveLpError(err.message);
                                } finally {
                                  setRemoveLpLoading(false);
                                }
                              }}
                              loading={removeLpLoading}
                            >
                              Confirm Withdraw
                            </GlowButton>
                            <button
                              onClick={() => { setShowRemoveLP(false); setRemoveLpError(null); }}
                              className="text-xs text-white/40 hover:text-white/60"
                            >
                              Cancel
                            </button>
                          </div>
                          {removeLpError && (
                            <p className="text-xs text-red-400">{removeLpError}</p>
                          )}
                        </div>
                      ) : (
                        <GlowButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowRemoveLP(true)}
                        >
                          Remove LP
                        </GlowButton>
                      )}
                    </div>
                  )}

                  {/* Create LP — for active eigens with no position */}
                  {canCreate && (
                    <>
                      {!showCreateLP ? (
                        <GlowButton variant="secondary" size="sm" onClick={() => setShowCreateLP(true)}>
                          Create LP Position
                        </GlowButton>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5 block">Concentration</span>
                            <div className="grid grid-cols-4 gap-2">
                              {(Object.keys(CONCENTRATION_PRESETS) as ConcentrationPreset[]).map((key) => {
                                const preset = CONCENTRATION_PRESETS[key];
                                return (
                                  <button
                                    key={key}
                                    onClick={() => setLpConcentration(key)}
                                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${lpConcentration === key
                                        ? 'border-[#7B3FE4]/60 bg-[#7B3FE4]/15 text-[#A78BFA]'
                                        : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                                      }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-white/30 mt-1">
                              {CONCENTRATION_PRESETS[lpConcentration].description}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">ETH Amount</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0.001"
                                placeholder="0.1"
                                value={lpEthAmount}
                                onChange={(e) => setLpEthAmount(e.target.value)}
                                className="w-full px-3 py-1.5 text-xs font-mono bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-white/25"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Token Amount</label>
                              <input
                                type="number"
                                step="1"
                                min="1"
                                placeholder="1000000"
                                value={lpTokenAmount}
                                onChange={(e) => setLpTokenAmount(e.target.value)}
                                className="w-full px-3 py-1.5 text-xs font-mono bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-white/25"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <GlowButton
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                if (!lpEthAmount || !lpTokenAmount) return;
                                const ethFloat = parseFloat(lpEthAmount);
                                const tokenFloat = parseFloat(lpTokenAmount);
                                if (ethFloat <= 0 || tokenFloat <= 0) return;

                                const price = ethFloat / tokenFloat;
                                const sqrtPrice = Math.sqrt(price);
                                const sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * 2 ** 96));
                                const tokenAmount = BigInt(Math.floor(tokenFloat * 1e18));
                                const preset = CONCENTRATION_PRESETS[lpConcentration];

                                seedPoolConcentratedHook.seedPoolConcentrated(
                                  eigen.id,
                                  eigen.tokenAddress as `0x${string}`,
                                  sqrtPriceX96,
                                  tokenAmount,
                                  lpEthAmount,
                                  preset.tickLower,
                                  preset.tickUpper,
                                );
                              }}
                              loading={seedPoolConcentratedHook.isPending || seedPoolConcentratedHook.isConfirming}
                            >
                              Create Pool & Add LP
                            </GlowButton>
                            <button
                              onClick={() => setShowCreateLP(false)}
                              className="text-xs text-white/40 hover:text-white/60"
                            >
                              Cancel
                            </button>
                          </div>

                          {seedPoolConcentratedHook.isSuccess && (
                            <p className="text-[10px] text-[#6DB89B]">LP position created successfully</p>
                          )}
                          {seedPoolConcentratedHook.error && (
                            <p className="text-[10px] text-[#C76E6E]">
                              {seedPoolConcentratedHook.error.message || 'Transaction failed'}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Status messages for LP actions */}
                  {collectFeesHook.isSuccess && (
                    <p className="text-[10px] text-[#6DB89B] mt-2">Fees claimed successfully</p>
                  )}
                  {compoundFeesHook.isSuccess && (
                    <p className="text-[10px] text-[#6DB89B] mt-2">Fees compounded into LP</p>
                  )}
                  {removeLiquidityHook.isSuccess && (
                    <p className="text-[10px] text-[#6DB89B] mt-2">Liquidity withdrawn</p>
                  )}
                  {(collectFeesHook.error || compoundFeesHook.error || removeLiquidityHook.error || removeLpError) && (
                    <p className="text-[10px] text-[#C76E6E] mt-2">
                      {removeLpError || (collectFeesHook.error || compoundFeesHook.error || removeLiquidityHook.error)?.message || 'Transaction failed'}
                    </p>
                  )}

                  {/* Loading state */}
                  {lpPosition.isLoading && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="h-3 w-3 rounded-full border-2 border-[#7B3FE4]/30 border-t-[#7B3FE4] animate-spin" />
                      <span className="text-[10px] text-white/30">Loading LP position…</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Full-width alerts below the grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 space-y-4">
          {isLiquidating && (
            <div className="rounded-2xl border border-status-warning/30 bg-status-warning/5 px-5 py-3 text-sm text-status-warning">
              Liquidating all token positions... This may take a few trade cycles.
            </div>
          )}
          {liquidationReady && (
            <div className="rounded-2xl border border-accent-lime/30 bg-accent-lime/5 px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-display text-sm text-white">Tokens sold. Ready to withdraw ETH.</p>
                <p className="text-xs text-white/60 mt-1">Click to terminate the eigen and withdraw all ETH to your wallet.</p>
              </div>
              <GlowButton
                onClick={handleWithdrawAfterLiquidation}
                loading={withdrawHook.isPending || withdrawHook.isConfirming}
              >
                Withdraw ETH
              </GlowButton>
            </div>
          )}
          {liquidationError && (
            <div className="rounded-2xl border border-status-danger/30 bg-status-danger/5 px-5 py-3 text-sm text-status-danger">
              {liquidationError}
            </div>
          )}
          {takeProfitError && (
            <div className="rounded-2xl border border-status-danger/30 bg-status-danger/5 px-5 py-3 text-sm text-status-danger">
              {takeProfitError}
            </div>
          )}
          {deleteError && (
            <div className="rounded-2xl border border-status-danger/30 bg-status-danger/5 px-5 py-3 text-sm text-status-danger">
              {deleteError}
            </div>
          )}
        </div>
      </div>

      {/* Gas Warning Toast — floating bottom-right */}
      {eigen.gasWarning?.needsFunding && !gasToastDismissed && (
        <div className="fixed bottom-5 right-5 z-50 w-80 rounded-lg border border-amber-500/15 bg-bg-card backdrop-blur-sm shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden animate-[slideUp_0.3s_ease-out]">
          <div className="h-1 bg-amber-400/80" />
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-amber-500">
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="font-display text-sm text-txt-primary">Agent needs gas</p>
                  <p className="text-[11px] text-txt-muted mt-0.5">Send Monad ETH to the keeper wallet</p>
                </div>
              </div>
              <button
                onClick={() => setGasToastDismissed(true)}
                className="text-txt-disabled hover:text-txt-muted transition-colors flex-shrink-0 -mt-0.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] font-mono text-txt-primary bg-bg-elevated px-2.5 py-1.5 rounded-lg border border-border-subtle select-all truncate">
                {eigen.gasWarning.keeperAddress}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(eigen.gasWarning!.keeperAddress);
                  setGasToastCopied(true);
                  setTimeout(() => setGasToastCopied(false), 2000);
                }}
                className={`flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-all flex-shrink-0 ${
                  gasToastCopied
                    ? 'text-status-success border-status-success/30 bg-status-success/5'
                    : 'text-txt-muted border-border-subtle hover:border-txt-disabled hover:text-txt-primary bg-bg-elevated'
                }`}
              >
                {gasToastCopied ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs (outside content flow) */}
      <ConfirmDialog
        open={showTakeProfit}
        title={`Take Profit — ${eigen?.id?.slice(0, 10)}...`}
        description="This will sell 100% of tokens across all sub-wallets and return ETH to the vault. Sells are staggered across wallets. The eigen will continue running after the sell."
        confirmLabel="Take Profit"
        onConfirm={handleTakeProfit}
        onCancel={() => setShowTakeProfit(false)}
      />

      <ConfirmDialog
        open={showLiquidate}
        title={`Liquidate & Terminate ${eigen?.id?.slice(0, 10)}...`}
        description="This will sell all token positions across all sub-wallets, return ETH to the vault, then terminate the eigen. All remaining ETH will be withdrawn. This action cannot be undone."
        confirmLabel="Liquidate & Terminate"
        onConfirm={handleLiquidate}
        onCancel={() => setShowLiquidate(false)}
      />

      <ConfirmDialog
        open={showTerminate}
        title={`Terminate ${eigen?.id?.slice(0, 10)}...`}
        description={`Terminating this eigen will withdraw the vault ETH balance only. Any tokens held in sub-wallets will NOT be sold. Use "Liquidate & Terminate" to sell tokens first.`}
        confirmLabel="Terminate Eigen"
        onConfirm={handleTerminate}
        onCancel={() => setShowTerminate(false)}
      />

      <ConfirmDialog
        open={showDelete}
        title={`Delete ${eigen?.id?.slice(0, 10)}...`}
        description="This will permanently remove this eigen from the dashboard. This action cannot be undone. The on-chain vault state is unaffected."
        confirmLabel="Delete Eigen"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />

      {showAdjust && (
        <AdjustModal
          eigen={eigen}
          isSubmitting={isAdjusting}
          error={adjustError}
          onSave={handleAdjust}
          onClose={() => { setShowAdjust(false); setAdjustError(null); }}
        />
      )}
    </>
  );
}

function WaterfallRow({ label, value, percent, isCost }: { label: string; value: number; percent?: number; isCost?: boolean }) {
  const absValue = Math.abs(value);
  const isNeg = value < 0;
  const color = isCost ? 'text-status-danger' : value > 0 ? 'text-status-success' : value < 0 ? 'text-status-danger' : 'text-txt-muted';
  const barColor = isCost ? 'bg-status-danger/20' : value > 0 ? 'bg-status-success/20' : value < 0 ? 'bg-status-danger/20' : 'bg-bg-hover';
  const barWidth = percent !== undefined ? Math.min(Math.abs(percent), 100) : Math.min(absValue * 200, 100);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-txt-muted w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-3.5 rounded-lg bg-[#F5F3EE] overflow-hidden">
        <div className={`h-full rounded-lg transition-all ${barColor}`} style={{ width: `${Math.max(barWidth, 1)}%` }} />
      </div>
      <span className={`font-mono text-[11px] font-medium w-24 text-right flex-shrink-0 ${color}`}>
        {isNeg ? '' : '+'}{formatEth(value)} ETH
      </span>
    </div>
  );
}

function MetricRow({ label, value, suffix, pnl }: { label: string; value: string; suffix?: string; pnl?: number }) {
  const color = pnl !== undefined
    ? pnl > 0 ? 'text-status-success' : pnl < 0 ? 'text-status-danger' : 'text-txt-primary'
    : 'text-txt-primary';

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-txt-disabled uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-xs ${color}`}>
        {value}
        {suffix && <span className="text-txt-disabled ml-1">{suffix}</span>}
      </span>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-txt-disabled uppercase tracking-wider">{label}</span>
      <span className="font-mono text-xs text-txt-primary">{value}</span>
    </div>
  );
}

function DarkParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-white/45 uppercase tracking-[0.12em]">{label}</span>
      <span className="font-mono text-[11px] text-white/90 mt-0.5">{value}</span>
    </div>
  );
}

function DarkMetricRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-white/45 uppercase tracking-[0.12em]">{label}</span>
      <span className="font-mono text-[11px] text-white/90 mt-0.5">
        {value}
        {suffix && <span className="text-white/40 ml-0.5 text-[10px]">{suffix}</span>}
      </span>
    </div>
  );
}

interface AdjustField {
  key: string;
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  getValue: (e: Eigen) => number;
}

const ADJUST_FIELDS: AdjustField[] = [
  { key: 'volumeTarget', label: 'Volume Target', suffix: 'MON/day', min: 0.1, max: 200, step: 0.1, getValue: (e) => e.volumeTarget },
  { key: 'tradeFrequency', label: 'Trade Frequency', suffix: 'trades/hr', min: 1, max: 200, step: 1, getValue: (e) => e.tradeFrequency },
  { key: 'orderSizePctMin', label: 'Order Size Min', suffix: '% of balance', min: 1, max: 50, step: 1, getValue: (e) => e.orderSizePctMin },
  { key: 'orderSizePctMax', label: 'Order Size Max', suffix: '% of balance', min: 5, max: 80, step: 1, getValue: (e) => e.orderSizePctMax },
  { key: 'profitTarget', label: 'Profit Target', suffix: '%', min: 5, max: 1000, step: 5, getValue: (e) => e.profitTarget },
  { key: 'stopLoss', label: 'Stop Loss', suffix: '%', min: 5, max: 95, step: 5, getValue: (e) => e.stopLoss },
  { key: 'slippageBps', label: 'Slippage Tolerance', suffix: 'bps', min: 50, max: 1000, step: 50, getValue: (e) => e.slippageBps },
  { key: 'rebalanceThreshold', label: 'Rebalance Threshold', suffix: '', min: 0.1, max: 0.95, step: 0.05, getValue: (e) => e.rebalanceThreshold },
];

function AdjustModal({
  eigen,
  isSubmitting,
  error,
  onSave,
  onClose,
}: {
  eigen: Eigen;
  isSubmitting: boolean;
  error: string | null;
  onSave: (updates: Record<string, number>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const f of ADJUST_FIELDS) {
      init[f.key] = f.getValue(eigen);
    }
    return init;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updates: Record<string, number> = {};
    for (const f of ADJUST_FIELDS) {
      const current = f.getValue(eigen);
      if (values[f.key] !== current) {
        updates[f.key] = values[f.key]!;
      }
    }
    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }
    onSave(updates);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-card border border-border-subtle rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-medium text-txt-primary">Adjust Parameters</h2>
          <p className="text-caption text-txt-muted mt-1">Modify trading parameters for {eigen?.id?.slice(0, 10)}...</p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {ADJUST_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4">
              <label className="text-xs text-txt-muted w-40 flex-shrink-0">
                {f.label}
                <span className="text-txt-disabled ml-1">{f.suffix}</span>
              </label>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: parseFloat(e.target.value) || 0 }))}
                className="w-28 px-3 py-1.5 text-xs font-mono text-txt-primary bg-bg-base border border-border-subtle rounded-lg focus:outline-none focus:border-txt-muted text-right"
              />
            </div>
          ))}

          {error && (
            <div className="text-xs text-status-danger bg-status-danger/5 border border-status-danger/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
            <GlowButton type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</GlowButton>
            <GlowButton type="submit" variant="primary" size="sm" loading={isSubmitting}>
              Save & Sign
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
}
