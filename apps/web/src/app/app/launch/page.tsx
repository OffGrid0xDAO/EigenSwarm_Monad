'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { usePrivy, useWallets as usePrivyWallets } from '@privy-io/react-auth';
import { parseEther } from 'viem';
import { GlowButton } from '@/components/ui/GlowButton';
import { ParamInput } from '@/components/ui/ParamInput';
import {
  CLASS_CONFIGS,
  generateEigenId,
  PROTOCOL_FEE_BPS,
  GAS_BUDGET_PER_WALLET,
  type AgentClass,
} from '@eigenswarm/shared';
import { useSignedRegister } from '@/hooks/useSignedAction';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { ChainSelector } from '@/components/ui/ChainSelector';
import { createMonadToken as apiCreateMonadToken, seedMonadV4Pool, launchToken } from '@/lib/api';

const SUPPORTED_CHAINS = [
  { id: 143, name: 'Monad', token: 'MON' },
  { id: 8453, name: 'Base', token: 'ETH' },
] as const;

type LaunchPhase =
  | 'configure'
  | 'deploying_token'
  | 'bundled_launch'
  | 'minting_agent'
  | 'creating_monad_token'
  | 'seeding_v4_pool'
  | 'registering'
  | 'complete';


function sanitizeTokenInput(value: string): string {
  // Strip RTL/LTR override characters, zero-width characters, and other control chars
  return value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');
}

export default function LaunchPage() {
  const router = useRouter();
  const { address: wagmiAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { authenticated } = usePrivy();
  const { wallets } = usePrivyWallets();
  // Privy external wallets may not sync to wagmi — resolve address from either source
  const privyAddress = wallets?.[0]?.address as `0x${string}` | undefined;
  const address = wagmiAddress || privyAddress;

  // Chain selection
  const [selectedChainId, setSelectedChainId] = useState(143);
  const isMonad = selectedChainId === 143;
  const nativeToken = SUPPORTED_CHAINS.find((c) => c.id === selectedChainId)?.token || 'ETH';

  // Shared token config
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenDesc, setTokenDesc] = useState('');
  const [tokenImage, setTokenImage] = useState('');

  // Base-specific config
  const [feeType, setFeeType] = useState<'static' | 'dynamic'>('static');
  const [mevProtection, setMevProtection] = useState(true);
  const [totalEthInput, setTotalEthInput] = useState('');
  const [devBuyPct, setDevBuyPct] = useState(60); // % of total ETH → dev buy; rest → LP + vault
  const [walletCount, setWalletCount] = useState<number | undefined>(undefined);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Monad-specific config
  const [devBuyMon, setDevBuyMon] = useState('0');
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [seedV4, setSeedV4] = useState(false);
  const [v4LpMon, setV4LpMon] = useState('1');

  // Agent config
  const [selectedClass, setSelectedClass] = useState<AgentClass>('operator');
  const [params, setParams] = useState({
    volumeTarget: 5,
    tradeFrequency: 30,
    profitTarget: 50,
    stopLoss: 30,
  });
  const [eigenId] = useState(() => generateEigenId());

  // Launch state
  const [phase, setPhase] = useState<LaunchPhase>('configure');
  const [deployedTokenAddress, setDeployedTokenAddress] = useState('');
  const [clankerError, setClankerError] = useState('');
  const [lpError, setLpError] = useState('');
  const [regSig, setRegSig] = useState<{ signature: string; timestamp: number } | null>(null);
  const [lpPoolId, setLpPoolId] = useState('');
  const [monadResult, setMonadResult] = useState<{
    eigenId: string;
    tokenAddress: string;
    txHash: string;
    imageUri?: string;
  } | null>(null);
  const [v4Result, setV4Result] = useState<{
    poolId: string;
    tokenId: string;
    txHash: string;
  } | null>(null);

  const classConfig = CLASS_CONFIGS[selectedClass];
  const { signRegister } = useSignedRegister();
  const [launchTxHash, setLaunchTxHash] = useState('');
  const [agent8004Id, setAgent8004Id] = useState<string | null>(null);

  // Base: ETH split — dev buy vs LP (backend auto-carves small vault deposit from LP portion)
  const totalEth = parseFloat(totalEthInput) || 0;
  const hasEth = totalEth > 0;
  const effectiveWalletCount = walletCount ?? classConfig.walletCountRange[0];
  const protocolFee = totalEth * (PROTOCOL_FEE_BPS / 10000);
  const gasBudget = parseFloat(GAS_BUDGET_PER_WALLET) * effectiveWalletCount;
  const deployableEth = Math.max(0, totalEth - protocolFee - gasBudget);
  const devBuyPortion = deployableEth * (devBuyPct / 100);
  const lpPortion = deployableEth - devBuyPortion;

  // ── Monad Launch Flow ──────────────────────────────────────────────

  async function handleMonadLaunch() {
    if (!address || !walletClient) return;

    // Sign authentication message
    let sig: { signature: string; timestamp: number };
    try {
      sig = await signRegister(eigenId);
    } catch {
      return; // User rejected
    }

    // Phase 1: Create token on nad.fun (auto-registers eigen config)
    setPhase('creating_monad_token');
    setClankerError('');
    setLpError('');

    try {
      const result = await apiCreateMonadToken({
        eigenId,
        name: tokenName,
        symbol: tokenSymbol,
        description: tokenDesc,
        imageUrl: tokenImage || undefined,
        devBuyMon: parseFloat(devBuyMon) > 0 ? devBuyMon : undefined,
        class: selectedClass,
        website: website || undefined,
        twitter: twitter || undefined,
        telegram: telegram || undefined,
        ownerAddress: address,
        signature: sig.signature,
        timestamp: sig.timestamp,
      });

      setMonadResult({
        eigenId: result.eigenId,
        tokenAddress: result.tokenAddress,
        txHash: result.txHash,
        imageUri: result.imageUri,
      });
      setDeployedTokenAddress(result.tokenAddress);
      console.log(`[Launch] Monad token created: ${result.tokenAddress} eigen=${result.eigenId}`);

      // Phase 2: Optionally seed V4 pool
      if (seedV4 && parseFloat(v4LpMon) > 0) {
        setPhase('seeding_v4_pool');

        const v4 = await seedMonadV4Pool(result.eigenId, {
          ownerAddress: address,
          signature: sig.signature,
          timestamp: sig.timestamp,
          monAmount: v4LpMon,
        });

        setV4Result({ poolId: v4.poolId, tokenId: v4.tokenId, txHash: v4.txHash });
        console.log(`[Launch] V4 pool seeded: poolId=${v4.poolId}`);
      }

      setPhase('complete');

      setTimeout(() => {
        router.push(`/app/eigen/${result.eigenId}`);
      }, 1500);
    } catch (err: any) {
      console.error('[Launch] Monad launch failed:', err);
      setClankerError(err?.message || 'Token creation failed');
      setPhase('configure');
    }
  }

  // ── Base Launch Flow ───────────────────────────────────────────────
  // Single user transaction: send ETH to keeper, keeper handles everything
  // (Clanker deploy + LP seed + vault creation + 8004 agent mint)

  async function handleBaseLaunch() {
    // Resolve wallet client — prefer wagmi, fall back to Privy wallet provider
    let activeWalletClient = walletClient as any;
    if (!activeWalletClient && wallets?.[0] && address) {
      try {
        const provider = await wallets[0].getEthereumProvider();
        const { createWalletClient, custom } = await import('viem');
        const { base: baseChain } = await import('wagmi/chains');
        activeWalletClient = createWalletClient({
          account: address as `0x${string}`,
          chain: baseChain,
          transport: custom(provider),
        });
      } catch (err) {
        console.error('[Launch] Failed to get Privy wallet client:', err);
      }
    }

    console.log('[Launch] handleBaseLaunch', { address, walletClient: !!activeWalletClient, publicClient: !!publicClient });
    if (!address || !activeWalletClient || !publicClient) {
      const missing = !address ? 'address' : !activeWalletClient ? 'walletClient' : 'publicClient';
      console.error('[Launch] Missing:', missing);
      setClankerError(`Connect your wallet first (missing: ${missing})`);
      return;
    }

    // Pre-sign the register message
    console.log('[Launch] Requesting signature...');
    let sig: { signature: string; timestamp: number };
    try {
      sig = await signRegister('pending');
      setRegSig(sig);
      console.log('[Launch] Signature obtained');
    } catch (err: any) {
      console.error('[Launch] Sign failed:', err);
      setClankerError(err?.shortMessage || err?.message || 'Signature rejected');
      return;
    }

    setClankerError('');
    setLpError('');

    // Phase 1: Send ETH to keeper (single user tx)
    setPhase('deploying_token');

    const ethAmount = totalEth;
    if (ethAmount <= 0) {
      setClankerError('Must send ETH for token launch');
      setPhase('configure');
      return;
    }

    let ethTxHash: `0x${string}`;
    try {
      // Fetch keeper deposit address
      const KEEPER_API_URL = process.env.NEXT_PUBLIC_KEEPER_API_URL || 'http://localhost:3001';
      let depositAddress: string;
      try {
        const infoRes = await fetch(`${KEEPER_API_URL}/api/launch/info`);
        if (!infoRes.ok) throw new Error('info endpoint unavailable');
        const info = await infoRes.json();
        depositAddress = info.depositAddress;
      } catch {
        // Fallback to env-configured keeper address
        depositAddress = process.env.NEXT_PUBLIC_KEEPER_ADDRESS || '';
      }

      // Send ETH — single on-chain transaction
      ethTxHash = await activeWalletClient.sendTransaction({
        to: depositAddress as `0x${string}`,
        value: parseEther(ethAmount.toString()),
      });
      console.log(`[Launch] ETH sent to keeper: ${ethTxHash} (${ethAmount} ETH)`);
      await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    } catch (err: any) {
      console.error('[Launch] ETH transfer failed:', err);
      setClankerError(err?.shortMessage || err?.message || 'ETH transfer failed');
      setPhase('configure');
      return;
    }

    // Phase 2: Keeper deploys token + seeds LP + creates vault + mints 8004 agent
    setPhase('bundled_launch');

    try {
      const result = await launchToken(ethTxHash, {
        name: tokenName,
        symbol: tokenSymbol,
        image: tokenImage || undefined,
        description: tokenDesc || undefined,
        class: selectedClass,
        feeType,
        walletCount: effectiveWalletCount,
        allocation: {
          devBuyPct,
          liquidityPct: 100 - devBuyPct,
          volumePct: 0,
        },
        ownerAddress: address,
        ...sig,
      });

      setDeployedTokenAddress(result.tokenAddress);
      if (result.poolId) setLpPoolId(result.poolId);
      if (result.agent8004Id) setAgent8004Id(result.agent8004Id);
      setLaunchTxHash(result.txHashes.deploy);

      console.log(`[Launch] Complete: token=${result.tokenAddress} eigen=${result.eigenId} agent=#${result.agent8004Id}`);
      setPhase('complete');

      // Redirect to eigen detail page after brief delay so user sees success
      setTimeout(() => {
        router.push(`/app/eigen/${result.eigenId}`);
      }, 1500);
    } catch (err: any) {
      console.error('[Launch] Keeper launch failed:', err);
      setClankerError(err?.message || 'Launch failed');
      setPhase('configure');
    }
  }

  async function handleLaunch() {
    console.log('[Launch] handleLaunch called', { isMonad, selectedChainId, address, hasEth, totalEth, tokenName, tokenSymbol });
    if (isMonad) {
      await handleMonadLaunch();
    } else {
      await handleBaseLaunch();
    }
  }

  const isLaunching = phase !== 'configure' && phase !== 'complete';

  return (
    <AppPageShell
      label="Launch"
      title="Launch Token + Deploy Eigen"
      subtitle={
        isMonad
          ? 'Create a nad.fun token, optionally seed a V4 pool, and deploy a market-making agent on Monad.'
          : 'Deploy a Clanker token, create an EigenLP pool, and deploy an agent that market-makes on your pool \u2014 100% of trading fees go to you.'
      }
    >
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Chain selector — top right */}
        <div className="flex items-center justify-end">
          <ChainSelector chains={SUPPORTED_CHAINS} selectedId={selectedChainId} onChange={setSelectedChainId} disabled={isLaunching} />
        </div>

        {/* Phase indicator */}
        {phase !== 'configure' && (
          <div className="subtle-card p-4">
            <div className="flex items-center gap-4">
              {isMonad ? (
                <>
                  <PhaseStep
                    label="Create Token"
                    active={phase === 'creating_monad_token'}
                    done={['seeding_v4_pool', 'complete'].includes(phase)}
                  />
                  {seedV4 && (
                    <>
                      <div className="h-px flex-1 bg-border-subtle" />
                      <PhaseStep
                        label="Seed V4 Pool"
                        active={phase === 'seeding_v4_pool'}
                        done={phase === 'complete'}
                      />
                    </>
                  )}
                  <div className="h-px flex-1 bg-border-subtle" />
                  <PhaseStep label="Complete" active={false} done={phase === 'complete'} />
                </>
              ) : (
                <>
                  <PhaseStep label="Send MON" active={phase === 'deploying_token'} done={['bundled_launch', 'complete'].includes(phase)} />
                  <div className="h-px flex-1 bg-border-subtle" />
                  <PhaseStep
                    label="Deploy + LP + Agent"
                    active={phase === 'bundled_launch'}
                    done={phase === 'complete'}
                  />
                </>
              )}
            </div>
            {deployedTokenAddress && (
              <p className="text-xs font-mono text-txt-muted mt-3">
                Token: {deployedTokenAddress}
              </p>
            )}
          </div>
        )}

        {clankerError && (
          <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4">
            <p className="text-xs text-status-danger">{clankerError}</p>
          </div>
        )}

        {lpError && (
          <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4">
            <p className="text-xs text-status-danger">LP pool creation failed: {lpError}</p>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Token Configuration */}
          <div className="space-y-6">
            <div className="subtle-card p-5 space-y-5">
              <h2 className="text-sm font-semibold text-txt-primary">Token Configuration</h2>

              <div>
                <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Token Name</label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(sanitizeTokenInput(e.target.value))}
                  placeholder="My Token"
                  disabled={isLaunching}
                  className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Symbol</label>
                <input
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(sanitizeTokenInput(e.target.value.toUpperCase()))}
                  placeholder="TOKEN"
                  maxLength={10}
                  disabled={isLaunching}
                  className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Image URL</label>
                <input
                  type="text"
                  value={tokenImage}
                  onChange={(e) => setTokenImage(e.target.value)}
                  placeholder="https://... or ipfs://..."
                  disabled={isLaunching}
                  className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                  Description <span className="text-txt-disabled">({tokenDesc.length}/280)</span>
                </label>
                <textarea
                  value={tokenDesc}
                  onChange={(e) => setTokenDesc(sanitizeTokenInput(e.target.value.slice(0, 280)))}
                  placeholder="Describe your token..."
                  rows={3}
                  disabled={isLaunching}
                  className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors resize-none disabled:opacity-50"
                />
              </div>

              {/* ── Chain-specific token config ── */}
              {isMonad ? (
                <div className="pt-2 border-t border-border-subtle space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Website</label>
                    <input
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://..."
                      disabled={isLaunching}
                      className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Twitter</label>
                      <input
                        type="text"
                        value={twitter}
                        onChange={(e) => setTwitter(e.target.value)}
                        placeholder="@handle"
                        disabled={isLaunching}
                        className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Telegram</label>
                      <input
                        type="text"
                        value={telegram}
                        onChange={(e) => setTelegram(e.target.value)}
                        placeholder="t.me/..."
                        disabled={isLaunching}
                        className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                      Dev Buy ({nativeToken})
                    </label>
                    <input
                      type="number"
                      value={devBuyMon}
                      onChange={(e) => setDevBuyMon(e.target.value)}
                      min={0}
                      step={0.1}
                      disabled={isLaunching}
                      className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                    />
                    <p className="text-caption text-txt-disabled mt-1">
                      Atomic dev buy during token creation on nad.fun bonding curve
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-txt-muted">Seed V4 Pool</span>
                      <p className="text-caption text-txt-disabled">Create a Uniswap V4 pool for the agent to trade on</p>
                    </div>
                    <button
                      onClick={() => setSeedV4(!seedV4)}
                      disabled={isLaunching}
                      className={`w-9 h-5 rounded-full transition-colors ${seedV4 ? 'bg-txt-primary' : 'bg-bg-hover'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${seedV4 ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>

                  {seedV4 && (
                    <div>
                      <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                        V4 Pool {nativeToken} Amount
                      </label>
                      <input
                        type="number"
                        value={v4LpMon}
                        onChange={(e) => setV4LpMon(e.target.value)}
                        min={0}
                        step={0.1}
                        disabled={isLaunching}
                        className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                      />
                      <p className="text-caption text-txt-disabled mt-1">
                        {nativeToken} to seed into the V4 liquidity pool
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Base: Total ETH + dev buy split */}
                  <div className="pt-2 border-t border-border-subtle space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Total MON</label>
                      <input
                        type="number"
                        value={totalEthInput}
                        onChange={(e) => setTotalEthInput(e.target.value)}
                        min={0}
                        step={0.01}
                        placeholder="0.0"
                        disabled={isLaunching}
                        className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                      />
                    </div>

                    {hasEth && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                            Wallets: {effectiveWalletCount} ({classConfig.walletCountRange[0]}-{classConfig.walletCountRange[1]})
                          </label>
                          <input
                            type="range"
                            value={effectiveWalletCount}
                            onChange={(e) => setWalletCount(Number(e.target.value))}
                            min={classConfig.walletCountRange[0]}
                            max={classConfig.walletCountRange[1]}
                            step={1}
                            disabled={isLaunching}
                            className="w-full accent-txt-primary"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                            Dev Buy: {devBuyPct}%
                          </label>
                          <input
                            type="range"
                            value={devBuyPct}
                            onChange={(e) => setDevBuyPct(Number(e.target.value))}
                            min={10}
                            max={90}
                            step={5}
                            disabled={isLaunching}
                            className="w-full accent-txt-primary"
                          />
                        </div>

                        <div className="rounded-lg bg-bg-elevated p-3 space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-txt-muted">Protocol fee ({PROTOCOL_FEE_BPS / 100}%)</span>
                            <span className="font-mono text-txt-primary">-{protocolFee.toFixed(4)} ETH</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-txt-muted">Gas budget ({effectiveWalletCount} wallets)</span>
                            <span className="font-mono text-txt-primary">-{gasBudget.toFixed(4)} ETH</span>
                          </div>
                          <div className="flex justify-between text-xs border-t border-border-subtle pt-1.5">
                            <span className="text-txt-muted">Deployable</span>
                            <span className="font-mono text-txt-primary font-medium">{deployableEth.toFixed(4)} ETH</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-txt-muted">Dev buy (buys tokens)</span>
                            <span className="font-mono text-txt-primary">{devBuyPortion.toFixed(4)} ETH</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-txt-muted">LP + vault</span>
                            <span className="font-mono text-txt-primary">{lpPortion.toFixed(4)} ETH</span>
                          </div>
                          <p className="text-caption text-txt-disabled pt-1.5 border-t border-border-subtle">
                            All tokens go to LP. Tokens the pool doesn't consume become market-making inventory.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Advanced options */}
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs font-medium text-txt-muted hover:text-txt-primary transition-colors flex items-center gap-1"
                  >
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                      className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                    >
                      <path d="M3 1.5l4 3.5-4 3.5V1.5z" />
                    </svg>
                    Advanced Options
                  </button>

                  {showAdvanced && (
                    <div className="space-y-4 pt-2 border-t border-border-subtle">
                      <div>
                        <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-2">Fee Type</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setFeeType('static')}
                            disabled={isLaunching}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${feeType === 'static' ? 'bg-bg-hover text-txt-primary border border-border-hover' : 'bg-bg-elevated text-txt-muted border border-border-subtle'
                              }`}
                          >
                            Static (1%)
                          </button>
                          <button
                            onClick={() => setFeeType('dynamic')}
                            disabled={isLaunching}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${feeType === 'dynamic' ? 'bg-bg-hover text-txt-primary border border-border-hover' : 'bg-bg-elevated text-txt-muted border border-border-subtle'
                              }`}
                          >
                            Dynamic (0.25-5%)
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-txt-muted">MEV Protection</span>
                          <p className="text-caption text-txt-disabled">2-block delay for anti-snipe</p>
                        </div>
                        <button
                          onClick={() => setMevProtection(!mevProtection)}
                          disabled={isLaunching}
                          className={`w-9 h-5 rounded-full transition-colors ${mevProtection ? 'bg-txt-primary' : 'bg-bg-hover'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${mevProtection ? 'translate-x-4' : ''}`} />
                        </button>
                      </div>

                      {/* Fee info box */}
                      <div className="rounded-lg bg-bg-elevated p-3 space-y-3">
                        <span className="text-caption text-txt-disabled uppercase tracking-wider">Fee Capture</span>

                        <div className="flex justify-between items-center text-xs">
                          <span className="text-txt-primary">EigenLP Pool (agent trades here)</span>
                          <span className="font-mono font-medium text-status-success">100% yours</span>
                        </div>
                        <p className="text-caption text-txt-disabled">
                          Your agent market-makes on its own EigenLP pool. No fees go to Clanker, no fees go to third-party deployers. You keep everything.
                        </p>

                        <div className="pt-2 border-t border-border-subtle space-y-1.5">
                          <span className="text-caption text-txt-disabled">Clanker Pool (not used by agent)</span>
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-txt-disabled">
                              <span>40% to deployer frontend (Bankrbot, Warpcast, etc.)</span>
                            </div>
                            <div className="flex justify-between text-xs text-txt-disabled">
                              <span>40% to creator</span>
                            </div>
                            <div className="flex justify-between text-xs text-txt-disabled">
                              <span>20% to Clanker protocol</span>
                            </div>
                          </div>
                          <p className="text-caption text-txt-disabled">
                            Your agent avoids the Clanker pool entirely &mdash; no 60% fee leakage to Clanker and third-party frontends.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: Agent Configuration */}
          <div className="space-y-6">
            <div className="subtle-card p-5 space-y-5">
              <h2 className="text-sm font-semibold text-txt-primary">Agent Configuration</h2>

              {/* Class selector */}
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(CLASS_CONFIGS) as AgentClass[]).map((cls) => {
                  const config = CLASS_CONFIGS[cls];
                  const isSelected = selectedClass === cls;
                  return (
                    <button
                      key={cls}
                      onClick={() => setSelectedClass(cls)}
                      disabled={isLaunching}
                      className={`
                      p-3 rounded-lg border text-left text-xs transition-all
                      ${isSelected
                          ? 'border-border-hover bg-bg-elevated'
                          : 'border-border-subtle hover:border-border-hover'
                        }
                    `}
                    >
                      <span className="font-medium text-txt-primary">{config.label}</span>
                      <span className="block text-txt-disabled mt-0.5">{config.volumeRange[0]}-{config.volumeRange[1]} {nativeToken}/day</span>
                    </button>
                  );
                })}
              </div>

              {/* Key params */}
              <ParamInput
                label="Volume Target"
                value={params.volumeTarget}
                onChange={(v) => setParams((p) => ({ ...p, volumeTarget: v }))}
                min={classConfig.volumeRange[0]}
                max={classConfig.volumeRange[1]}
                step={0.1}
                unit={`${nativeToken}/day`}
              />
              <ParamInput
                label="Profit Target"
                value={params.profitTarget}
                onChange={(v) => setParams((p) => ({ ...p, profitTarget: v }))}
                min={10}
                max={500}
                step={5}
                unit="%"
              />
              <ParamInput
                label="Stop Loss"
                value={params.stopLoss}
                onChange={(v) => setParams((p) => ({ ...p, stopLoss: v }))}
                min={10}
                max={90}
                step={5}
                unit="%"
              />

              {/* Fee info — Base only */}
              {!isMonad && (
                <p className="text-caption text-txt-disabled">Fee: {classConfig.protocolFee}% of P&L</p>
              )}

              {/* Monad vaultless info */}
              {isMonad && (
                <div className="rounded-lg bg-bg-elevated p-3 space-y-2">
                  <span className="text-caption text-txt-disabled uppercase tracking-wider">Vaultless Architecture</span>
                  <p className="text-caption text-txt-disabled">
                    On Monad, agents trade directly from sub-wallets &mdash; no vault deposit required. The keeper manages gas and trading funds automatically.
                  </p>
                  <p className="text-caption text-txt-disabled">
                    Fee: {classConfig.protocolFee}% of realized P&amp;L
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        {launchTxHash && (
          <div className="subtle-card p-4">
            <p className="text-xs font-mono text-txt-muted">
              Bundler tx: {launchTxHash}
            </p>
          </div>
        )}

        {monadResult && (
          <div className="subtle-card p-4 space-y-2">
            <p className="text-xs font-mono text-txt-muted">Token: {monadResult.tokenAddress}</p>
            <p className="text-xs font-mono text-txt-muted">Eigen ID: {monadResult.eigenId}</p>
            <p className="text-xs font-mono text-txt-muted">Tx: {monadResult.txHash}</p>
            {v4Result && (
              <>
                <p className="text-xs font-mono text-txt-muted">V4 Pool: {v4Result.poolId}</p>
                <p className="text-xs font-mono text-txt-muted">V4 Tx: {v4Result.txHash}</p>
              </>
            )}
          </div>
        )}

        {/* Deploy button */}
        <GlowButton
          size="lg"
          className="w-full"
          disabled={
            !tokenName || !tokenSymbol || isLaunching || phase === 'complete' ||
            (!isMonad && !hasEth)
          }
          loading={isLaunching}
          onClick={handleLaunch}
        >
          {phase === 'complete'
            ? 'Launched!'
            : phase === 'creating_monad_token'
              ? 'Creating Token on nad.fun...'
              : phase === 'seeding_v4_pool'
                ? 'Seeding V4 Pool...'
                : phase === 'deploying_token'
                  ? 'Deploying Token...'
                  : phase === 'bundled_launch'
                    ? 'Seeding LP + Creating Eigen...'
                    : phase === 'registering'
                      ? 'Registering...'
                      : isMonad
                        ? 'Launch on Monad'
                        : 'Launch Token & Deploy Eigen'}
        </GlowButton>
      </div>
    </AppPageShell>
  );
}

function PhaseStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-caption font-bold ${done ? 'bg-status-success text-white' : active ? 'bg-txt-primary text-white animate-pulse' : 'bg-bg-hover text-txt-disabled'
        }`}>
        {done ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 5l2 2 4-4" />
          </svg>
        ) : null}
      </div>
      <span className={`text-xs font-medium ${active ? 'text-txt-primary' : done ? 'text-status-success' : 'text-txt-disabled'}`}>
        {label}
      </span>
    </div>
  );
}
