'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { GlowButton } from '@/components/ui/GlowButton';
import { StepFlow } from '@/components/ui/StepFlow';
import { ParamInput } from '@/components/ui/ParamInput';
import { TxStatus } from '@/components/ui/TxStatus';
import { CLASS_CONFIGS, generateEigenId, type AgentClass } from '@eigenswarm/shared';
import { useCreateEigen } from '@/hooks/useEigenVault';
import { useTokenVerification, useRegisterEigen } from '@/hooks/useEigenQueries';
import { useSignedRegister } from '@/hooks/useSignedAction';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { ChainSelector } from '@/components/ui/ChainSelector';

const STEPS = ['Target Token', 'Agent Class', 'Parameters', 'Fund & Deploy'];

const SUPPORTED_CHAINS = [
  { id: 143, name: 'Monad', token: 'MON' },
  { id: 8453, name: 'Base', token: 'ETH' },
] as const;

export default function DeployPage() {
  const router = useRouter();
  const { address, chainId: walletChainId } = useAccount();
  const [step, setStep] = useState(0);
  const [tokenAddress, setTokenAddress] = useState('');
  const [selectedChainId, setSelectedChainId] = useState(143); // Default to Monad
  const [selectedClass, setSelectedClass] = useState<AgentClass>('operator');
  const [params, setParams] = useState({
    volumeTarget: 5,
    tradeFrequency: 30,
    orderSizeMin: 0.005,
    orderSizeMax: 0.05,
    spreadWidth: 1.2,
    profitTarget: 50,
    stopLoss: 30,
    rebalanceThreshold: 0.7,
    walletCount: 3,
  });
  const [ethDeposit, setEthDeposit] = useState('0.2');
  const [eigenId] = useState(() => generateEigenId());

  const isMonad = selectedChainId === 143;
  const nativeToken = SUPPORTED_CHAINS.find((c) => c.id === selectedChainId)?.token || 'ETH';

  // Debounced token verification
  const [debouncedAddress, setDebouncedAddress] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAddress(tokenAddress), 500);
    return () => clearTimeout(timer);
  }, [tokenAddress]);

  // Auto-detect chain from DexScreener response
  const { data: tokenData, isLoading: isVerifying } = useTokenVerification(debouncedAddress, selectedChainId);

  // Update selected chain when DexScreener detects a different one
  useEffect(() => {
    if (tokenData?.chainId && tokenData.chainId !== selectedChainId) {
      setSelectedChainId(tokenData.chainId);
    }
  }, [tokenData?.chainId]);
  const { createEigen, hash, isPending, isConfirming, isSuccess, error } = useCreateEigen();
  const registerEigen = useRegisterEigen();
  const { signRegister } = useSignedRegister();

  const classConfig = CLASS_CONFIGS[selectedClass];

  const updateParam = (key: string, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const tokenVerified = tokenData?.valid === true;

  const deploySuccess = isMonad ? registerEigen.isSuccess : isSuccess;
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    if (deploySuccess) setShowSuccessModal(true);
  }, [deploySuccess]);

  async function handleDeploy() {
    if (!address) return;

    const { signature, timestamp } = await signRegister(eigenId);

    // On Base: create vault eigen on-chain. On Monad: skip vault (vaultless trading).
    if (!isMonad) {
      createEigen(eigenId, ethDeposit, classConfig.protocolFee * 100);
    }

    // Register config with keeper API
    registerEigen.mutate({
      eigenId,
      ownerAddress: address,
      tokenAddress,
      tokenSymbol: tokenData?.symbol || 'UNKNOWN',
      tokenName: tokenData?.name || 'Unknown Token',
      class: selectedClass,
      chainId: selectedChainId,
      ...params,
      ethDeposit: parseFloat(ethDeposit),
      signature,
      timestamp,
    });
  }

  return (
    <AppPageShell label="Add Agent" title="Add Agent" subtitle="Add an autonomous market-making agent to an existing token.">
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Chain selector — top right */}
      <div className="flex items-center justify-end">
        <ChainSelector chains={SUPPORTED_CHAINS} selectedId={selectedChainId} onChange={setSelectedChainId} />
      </div>

      <StepFlow steps={STEPS} currentStep={step} />

      {/* Step 1: Target Token */}
      {step === 0 && (
        <div className="space-y-6">

          <div>
            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-2">
              Token Contract Address
            </label>
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              placeholder="0x..."
              className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 font-mono text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors"
            />
            {isVerifying && tokenAddress.length === 42 && (
              <p className="text-xs text-txt-muted mt-2 animate-pulse">Verifying token on-chain...</p>
            )}
          </div>

          {tokenData && tokenVerified && (
            <div className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center border border-border-subtle">
                  <span className="text-xs font-bold text-txt-primary">{(tokenData.symbol || '?')[0]}</span>
                </div>
                <div>
                  <p className="font-medium text-sm text-txt-primary">{tokenData.name}</p>
                  <p className="text-xs text-txt-muted">${tokenData.symbol}</p>
                </div>
                {tokenData.pool && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-status-success">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6l2.5 2.5 4.5-5" />
                    </svg>
                    {tokenData.pool.version.includes('v') ? `Uniswap ${tokenData.pool.version.toUpperCase()}` : tokenData.pool.version.toUpperCase()} Pool Found
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border-subtle">
                <div>
                  <span className="text-caption text-txt-disabled uppercase tracking-wider">Price</span>
                  <p className="font-mono text-xs text-txt-primary">
                    {tokenData.price > 0 ? tokenData.price.toFixed(10) : '--'} {nativeToken}
                  </p>
                </div>
                <div>
                  <span className="text-caption text-txt-disabled uppercase tracking-wider">Decimals</span>
                  <p className="font-mono text-xs text-txt-primary">{tokenData.decimals}</p>
                </div>
                <div>
                  <span className="text-caption text-txt-disabled uppercase tracking-wider">Pool</span>
                  <p className="font-mono text-xs text-txt-primary">
                    {tokenData.pool ? (tokenData.pool.version.includes('v') ? `Uniswap ${tokenData.pool.version.toUpperCase()}` : tokenData.pool.version.toUpperCase()) : 'No pool'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {tokenData && !tokenVerified && (
            <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4">
              <p className="text-xs text-status-danger">Token not found or not a valid ERC20 contract.</p>
            </div>
          )}

          <GlowButton disabled={!tokenVerified} onClick={() => setStep(1)} className="w-full">
            Continue
          </GlowButton>
        </div>
      )}

      {/* Step 2: Agent Class */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            {(Object.keys(CLASS_CONFIGS) as AgentClass[]).map((cls) => {
              const config = CLASS_CONFIGS[cls];
              const isSelected = selectedClass === cls;
              return (
                <button
                  key={cls}
                  onClick={() => setSelectedClass(cls)}
                  className={`
                    relative flex flex-col gap-2 p-4 rounded-xl border text-left transition-all
                    ${isSelected
                      ? 'border-border-hover bg-bg-elevated'
                      : 'border-border-subtle bg-bg-card hover:border-border-hover'
                    }
                  `}
                >
                  {cls === 'operator' && (
                    <span className="absolute top-2 right-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-bg-hover text-txt-secondary">
                      Popular
                    </span>
                  )}
                  <span className="text-sm font-semibold text-txt-primary">{config.label}</span>
                  <span className="text-xs text-txt-muted">{config.volumeRange[0]}-{config.volumeRange[1]} {nativeToken}/day</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs text-txt-disabled">Min {config.minDeposit} {nativeToken}</span>
                    <span className="font-mono text-xs text-txt-disabled">{config.protocolFee}% fee</span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-txt-muted">{classConfig.description}</p>

          <div className="flex gap-3">
            <GlowButton variant="ghost" onClick={() => setStep(0)}>Back</GlowButton>
            <GlowButton onClick={() => setStep(2)} className="flex-1">Continue</GlowButton>
          </div>
        </div>
      )}

      {/* Step 3: Parameters */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Execution */}
            <div className="space-y-5">
              <h3 className="text-xs font-medium text-txt-muted uppercase tracking-wider">Execution</h3>
              <ParamInput
                label="Volume Target"
                value={params.volumeTarget}
                onChange={(v) => updateParam('volumeTarget', v)}
                min={classConfig.volumeRange[0]}
                max={classConfig.volumeRange[1]}
                step={0.1}
                unit={`${nativeToken}/day`}
              />
              <ParamInput
                label="Trade Frequency"
                value={params.tradeFrequency}
                onChange={(v) => updateParam('tradeFrequency', v)}
                min={classConfig.tradesPerHour[0]}
                max={classConfig.tradesPerHour[1]}
                step={1}
                unit="trades/hr"
              />
              <ParamInput
                label="Min Order Size"
                value={params.orderSizeMin}
                onChange={(v) => updateParam('orderSizeMin', v)}
                min={classConfig.orderSize[0]}
                max={classConfig.orderSize[1]}
                step={0.001}
                unit={nativeToken}
              />
              <ParamInput
                label="Spread Width"
                value={params.spreadWidth}
                onChange={(v) => updateParam('spreadWidth', v)}
                min={classConfig.spreadWidth[0]}
                max={classConfig.spreadWidth[1]}
                step={0.1}
                unit="%"
              />
            </div>

            {/* Risk */}
            <div className="space-y-5">
              <h3 className="text-xs font-medium text-txt-muted uppercase tracking-wider">Risk Management</h3>
              <ParamInput
                label="Profit Target"
                value={params.profitTarget}
                onChange={(v) => updateParam('profitTarget', v)}
                min={10}
                max={500}
                step={5}
                unit="%"
                tooltip="Percentage gain at which the agent begins DCA selling"
              />
              <ParamInput
                label="Stop Loss"
                value={params.stopLoss}
                onChange={(v) => updateParam('stopLoss', v)}
                min={10}
                max={90}
                step={5}
                unit="%"
                tooltip="Percentage loss at which the agent suspends trading"
              />
              <ParamInput
                label="Rebalance Threshold"
                value={params.rebalanceThreshold}
                onChange={(v) => updateParam('rebalanceThreshold', v)}
                min={0.3}
                max={0.9}
                step={0.05}
                tooltip="Inventory ratio that triggers a rebalance"
              />
              <ParamInput
                label="Wallet Count"
                value={params.walletCount}
                onChange={(v) => updateParam('walletCount', v)}
                min={1}
                max={10}
                step={1}
                tooltip="Number of execution wallets for trade distribution"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <GlowButton variant="ghost" onClick={() => setStep(1)}>Back</GlowButton>
            <GlowButton onClick={() => setStep(3)} className="flex-1">Continue</GlowButton>
          </div>
        </div>
      )}

      {/* Step 4: Fund & Deploy */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-2">
              {nativeToken} Deposit
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={ethDeposit}
                onChange={(e) => setEthDeposit(e.target.value)}
                min={classConfig.minDeposit}
                step={0.01}
                className="flex-1 bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 font-mono text-lg text-txt-primary focus:outline-none focus:border-border-hover transition-colors"
              />
              <span className="text-sm text-txt-muted font-mono">{nativeToken}</span>
            </div>
            <p className="text-xs text-txt-disabled mt-1">Minimum: {classConfig.minDeposit} {nativeToken}</p>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-3">
            <h3 className="text-xs font-medium text-txt-muted uppercase tracking-wider">Deployment Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Chain</span>
                <span className="font-mono text-txt-primary">{SUPPORTED_CHAINS.find((c) => c.id === selectedChainId)?.name || 'Unknown'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Token</span>
                <span className="font-mono text-txt-primary">${tokenData?.symbol || 'UNKNOWN'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Pool</span>
                <span className="font-mono text-txt-primary">
                  {tokenData?.pool ? (tokenData.pool.version.includes('v') ? `Uniswap ${tokenData.pool.version.toUpperCase()}` : tokenData.pool.version.toUpperCase()) : 'Auto-detect'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Agent Class</span>
                <span className="font-medium text-txt-primary">{classConfig.label}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Volume Target</span>
                <span className="font-mono text-txt-primary">{params.volumeTarget} {nativeToken}/day</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-txt-muted">Protocol Fee</span>
                <span className="font-mono text-txt-primary">{classConfig.protocolFee}% of P&L</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border-subtle pt-2 mt-2">
                <span className="text-txt-muted">{nativeToken} Deposit</span>
                <span className="font-mono font-medium text-txt-primary">{ethDeposit} {nativeToken}</span>
              </div>
            </div>
          </div>

          {!isMonad && (
            <TxStatus
              hash={hash}
              isPending={isPending}
              isConfirming={isConfirming}
              isSuccess={isSuccess}
              error={error}
            />
          )}

          {isMonad && registerEigen.isSuccess && (
            <div className="rounded-xl border border-status-success/30 bg-status-success/5 p-4">
              <p className="text-xs text-status-success">Eigen registered on Monad.</p>
            </div>
          )}

          {isMonad && registerEigen.isError && (
            <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4">
              <p className="text-xs text-status-danger">Registration failed: {(registerEigen.error as Error)?.message}</p>
            </div>
          )}

          <div className="flex gap-3">
            <GlowButton variant="ghost" onClick={() => setStep(2)} disabled={isPending || isConfirming || registerEigen.isPending}>
              Back
            </GlowButton>
            <GlowButton
              className="flex-1"
              onClick={handleDeploy}
              loading={isMonad ? registerEigen.isPending : (isPending || isConfirming)}
              disabled={
                (isMonad ? registerEigen.isPending || registerEigen.isSuccess : isPending || isConfirming || isSuccess)
                || parseFloat(ethDeposit) < classConfig.minDeposit
              }
            >
              {(isMonad ? registerEigen.isSuccess : isSuccess) ? 'Deployed!' : 'Deploy Eigen'}
            </GlowButton>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSuccessModal(false)} />
          <div className="relative bg-bg-card border border-border-subtle rounded-2xl p-8 max-w-md w-full shadow-2xl">
            {/* Success icon */}
            <div className="flex justify-center mb-5">
              <div className="w-14 h-14 rounded-full bg-status-success/10 border border-status-success/20 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-status-success">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-txt-primary text-center mb-2">
              Eigen Deployed Successfully
            </h3>
            <p className="text-sm text-txt-muted text-center mb-6">
              Your <span className="font-medium text-txt-primary">{classConfig.label}</span> eigen for <span className="font-mono text-txt-primary">${tokenData?.symbol || 'UNKNOWN'}</span> is now live.
            </p>

            <div className="space-y-3">
              <button
                onClick={() => router.push(`/app/eigen/${eigenId}`)}
                className="w-full flex items-center justify-center gap-2 bg-txt-primary text-white rounded-xl px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
                View Eigen Dashboard
              </button>

              {isMonad && tokenAddress && (
                <a
                  href={`https://nad.fun/token/${tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-sm font-medium text-txt-primary hover:border-border-hover transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  View on nad.fun
                </a>
              )}

              {!isMonad && tokenAddress && (
                <a
                  href={`https://dexscreener.com/base/${tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-sm font-medium text-txt-primary hover:border-border-hover transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  View on DexScreener
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </AppPageShell>
  );
}
