'use client';

import { useState, useCallback } from 'react';
import {
    createWalletClient,
    createPublicClient,
    http,
    parseEther,
    formatEther,
    encodeFunctionData,
    type Address,
    type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { useBundleWallet } from '@/lib/bundle/useBundleWallet';
import { CONTRACTS, ABIS, CHAIN_IDS } from '@/lib/bundle/contracts';
import { monad } from '@/lib/bundle/chains';

interface WalletEntry {
    address: Address;
    privateKey: Hex;
    status: string;
}

type SellPhase = 'idle' | 'funding' | 'collecting' | 'approving' | 'selling' | 'success' | 'error';

const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
] as const;

export function BundleSellComponent() {
    const { address, isConnected, isWrongChain, switchToMonad, writeContract, login } = useBundleWallet();

    const [tokenAddress, setTokenAddress] = useState('');
    const [wallets, setWallets] = useState<WalletEntry[]>([]);
    const [csvText, setCsvText] = useState('');
    const [phase, setPhase] = useState<SellPhase>('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const [error, setError] = useState('');
    const [txHash, setTxHash] = useState('');
    const [fundAmount, setFundAmount] = useState('0.01');
    const [slippageBps, setSlippageBps] = useState(300);

    const chainId = CHAIN_IDS.MONAD;

    const parseCSV = (text: string) => {
        const lines = text.trim().split('\n').filter(Boolean);
        const parsed: WalletEntry[] = [];
        for (const line of lines) {
            const parts = line.split(',').map((s) => s.trim());
            if (parts.length >= 2) {
                parsed.push({
                    address: parts[0] as Address,
                    privateKey: parts[1] as Hex,
                    status: 'pending',
                });
            }
        }
        setWallets(parsed);
        return parsed;
    };

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result as string;
            setCsvText(text);
            parseCSV(text);
        };
        reader.readAsText(file);
    };

    const handleCSVPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setCsvText(text);
        if (text.trim()) {
            parseCSV(text);
        }
    };

    // Fund wallets with MON for gas
    const handleFundWallets = useCallback(async () => {
        if (!address || wallets.length === 0) return;
        setError('');
        setPhase('funding');
        setStatusMessage('Funding wallets with MON for gas...');

        try {
            const fundWalletsAddress = CONTRACTS.FUND_WALLETS_BY_CHAIN[chainId] as Address;
            const walletAddresses = wallets.map((w) => w.address);
            const amounts = wallets.map(() => parseEther(fundAmount));
            const totalValue = amounts.reduce((sum, a) => sum + a, 0n);

            const hash = await writeContract({
                address: fundWalletsAddress,
                abi: ABIS.FUND_WALLETS as any,
                functionName: 'fundWallets',
                args: [walletAddresses, amounts],
                value: totalValue,
            });

            setStatusMessage(`Funded! Tx: ${hash.slice(0, 10)}...`);
            setWallets((prev) => prev.map((w) => ({ ...w, status: 'funded' })));
            setPhase('idle');
        } catch (err: any) {
            console.error('[BundleSell] Fund error:', err);
            setError(err?.shortMessage || err?.message || 'Funding failed');
            setPhase('error');
        }
    }, [address, wallets, chainId, fundAmount, writeContract]);

    // Collect MON from wallets back to main wallet
    const handleCollectMon = useCallback(async () => {
        if (!address || wallets.length === 0) return;
        setError('');
        setPhase('collecting');
        setStatusMessage('Collecting MON from wallets...');

        try {
            const publicClient = createPublicClient({
                chain: monad,
                transport: http(),
            });

            let collected = 0;
            for (let i = 0; i < wallets.length; i++) {
                const w = wallets[i];
                setStatusMessage(`Collecting from wallet ${i + 1}/${wallets.length}...`);
                try {
                    const account = privateKeyToAccount(w.privateKey);
                    const client = createWalletClient({
                        account,
                        chain: monad,
                        transport: http(),
                    });
                    const balance = await publicClient.getBalance({ address: w.address });
                    if (balance > parseEther('0.001')) {
                        const gasEstimate = 21000n;
                        const gasPrice = await publicClient.getGasPrice();
                        const gasCost = gasEstimate * gasPrice;
                        const sendAmount = balance - gasCost;
                        if (sendAmount > 0n) {
                            await client.sendTransaction({
                                to: address,
                                value: sendAmount,
                            });
                            collected++;
                        }
                    }
                } catch (err) {
                    console.warn(`[BundleSell] Collect from wallet ${i} failed:`, err);
                }
            }

            setStatusMessage(`Collected MON from ${collected} wallets`);
            setPhase('idle');
        } catch (err: any) {
            console.error('[BundleSell] Collect error:', err);
            setError(err?.shortMessage || err?.message || 'Collection failed');
            setPhase('error');
        }
    }, [address, wallets]);

    // Approve token sell from all wallets
    const handleApproveAll = useCallback(async () => {
        if (!tokenAddress || wallets.length === 0) return;
        setError('');
        setPhase('approving');

        try {
            const bundleSellAddress = CONTRACTS.BUNDLE_SELL_BY_CHAIN[chainId] as Address;
            const publicClient = createPublicClient({
                chain: monad,
                transport: http(),
            });

            let approved = 0;
            for (let i = 0; i < wallets.length; i++) {
                const w = wallets[i];
                setStatusMessage(`Approving wallet ${i + 1}/${wallets.length}...`);
                try {
                    const account = privateKeyToAccount(w.privateKey);
                    const client = createWalletClient({
                        account,
                        chain: monad,
                        transport: http(),
                    });

                    const balance = await publicClient.readContract({
                        address: tokenAddress as Address,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [w.address],
                    });

                    if ((balance as bigint) > 0n) {
                        const hash = await client.writeContract({
                            address: tokenAddress as Address,
                            abi: ERC20_ABI,
                            functionName: 'approve',
                            args: [bundleSellAddress, balance as bigint],
                            chain: monad,
                            account,
                        });
                        await publicClient.waitForTransactionReceipt({ hash });
                        approved++;
                    }
                } catch (err) {
                    console.warn(`[BundleSell] Approve from wallet ${i} failed:`, err);
                }
            }

            setStatusMessage(`Approved ${approved} wallets`);
            setWallets((prev) => prev.map((w) => ({ ...w, status: 'approved' })));
            setPhase('idle');
        } catch (err: any) {
            console.error('[BundleSell] Approve error:', err);
            setError(err?.shortMessage || err?.message || 'Approval failed');
            setPhase('error');
        }
    }, [tokenAddress, wallets, chainId]);

    // Execute bundle sell
    const handleBundleSell = useCallback(async () => {
        if (!address || !tokenAddress || wallets.length === 0) return;
        setError('');
        setPhase('selling');
        setStatusMessage('Executing bundle sell...');

        try {
            const bundleSellAddress = CONTRACTS.BUNDLE_SELL_BY_CHAIN[chainId] as Address;
            const walletAddresses = wallets.map((w) => w.address);

            const hash = await writeContract({
                address: bundleSellAddress,
                abi: ABIS.BUNDLE_SELL as any,
                functionName: 'bundleSell',
                args: [
                    tokenAddress as Address,
                    walletAddresses,
                    BigInt(slippageBps),
                ],
            });

            setTxHash(hash);
            setPhase('success');
            setStatusMessage('Bundle sell executed successfully!');
        } catch (err: any) {
            console.error('[BundleSell] Sell error:', err);
            setError(err?.shortMessage || err?.message || 'Bundle sell failed');
            setPhase('error');
        }
    }, [address, tokenAddress, wallets, chainId, slippageBps, writeContract]);

    const isProcessing = !['idle', 'success', 'error'].includes(phase);

    if (!isConnected) {
        return (
            <div className="text-center py-16">
                <p className="text-txt-muted mb-4">Connect your wallet to sell tokens</p>
                <button onClick={login} className="px-6 py-3 rounded-xl bg-eigen-violet text-white font-medium hover:brightness-110 transition-all">
                    Connect Wallet
                </button>
            </div>
        );
    }

    if (isWrongChain) {
        return (
            <div className="text-center py-16">
                <p className="text-txt-muted mb-4">Switch to Monad network to continue</p>
                <button onClick={switchToMonad} className="px-6 py-3 rounded-xl bg-eigen-violet text-white font-medium hover:brightness-110 transition-all">
                    Switch to Monad
                </button>
            </div>
        );
    }

    if (phase === 'success') {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="w-16 h-16 rounded-full bg-status-success/10 flex items-center justify-center mx-auto">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-status-success">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
                <h3 className="text-lg font-semibold text-txt-primary">Bundle Sell Complete!</h3>
                {txHash && (
                    <a
                        href={`https://monadvision.com/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-eigen-violet hover:underline"
                    >
                        View Transaction ↗
                    </a>
                )}
                <button onClick={() => { setPhase('idle'); setTxHash(''); }} className="mt-4 px-4 py-2 rounded-lg border border-border-subtle text-txt-secondary text-sm hover:border-border-hover transition-colors">
                    Sell More
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Status bar */}
            {isProcessing && (
                <div className="rounded-xl border border-eigen-violet/20 bg-eigen-violet/5 p-4 flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-eigen-violet border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-txt-primary">{statusMessage}</span>
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-4">
                    <p className="text-sm text-status-danger">{error}</p>
                    <button onClick={() => { setError(''); setPhase('idle'); }} className="mt-2 text-xs text-txt-muted hover:text-txt-primary">
                        Dismiss
                    </button>
                </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Left: Token + Wallets */}
                <div className="space-y-5">
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Token Address</h3>
                        <input
                            type="text"
                            value={tokenAddress}
                            onChange={(e) => setTokenAddress(e.target.value)}
                            placeholder="0x..."
                            disabled={isProcessing}
                            className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                        />
                    </div>

                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Wallet CSV</h3>
                        <p className="text-caption text-txt-disabled">
                            Format: <span className="font-mono">address,privateKey</span> (one per line)
                        </p>

                        <label className="cursor-pointer block">
                            <div className="bg-bg-elevated border border-dashed border-border-subtle rounded-lg px-3.5 py-3 text-sm text-txt-muted text-center hover:border-border-hover transition-colors">
                                Click to upload CSV file
                            </div>
                            <input type="file" accept=".csv,.txt" onChange={handleCSVUpload} className="hidden" disabled={isProcessing} />
                        </label>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Or paste CSV data</label>
                            <textarea
                                value={csvText}
                                onChange={handleCSVPaste}
                                placeholder="0xAddr1,0xKey1&#10;0xAddr2,0xKey2"
                                rows={4}
                                disabled={isProcessing}
                                className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors resize-none disabled:opacity-50"
                            />
                        </div>

                        {wallets.length > 0 && (
                            <div className="rounded-lg bg-bg-elevated p-3">
                                <span className="text-xs text-txt-muted">{wallets.length} wallets loaded</span>
                                <div className="mt-2 max-h-[120px] overflow-y-auto space-y-1">
                                    {wallets.map((w, i) => (
                                        <div key={i} className="flex items-center justify-between text-caption">
                                            <span className="font-mono text-txt-primary truncate max-w-[200px]">{w.address}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-caption ${w.status === 'approved' ? 'bg-status-success/10 text-status-success' :
                                                    w.status === 'funded' ? 'bg-eigen-violet/10 text-eigen-violet' :
                                                        'bg-bg-hover text-txt-disabled'
                                                }`}>
                                                {w.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="space-y-5">
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Actions</h3>

                        {/* Step 1: Fund */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-eigen-violet/10 text-eigen-violet text-xs font-bold flex items-center justify-center">1</span>
                                <span className="text-sm font-medium text-txt-primary">Fund Wallets</span>
                            </div>
                            <div className="ml-8">
                                <div className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <label className="block text-caption text-txt-disabled mb-1">MON per wallet</label>
                                        <input
                                            type="number"
                                            value={fundAmount}
                                            onChange={(e) => setFundAmount(e.target.value)}
                                            min={0}
                                            step={0.001}
                                            disabled={isProcessing}
                                            className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-sm font-mono text-txt-primary focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                                        />
                                    </div>
                                    <button
                                        onClick={handleFundWallets}
                                        disabled={isProcessing || wallets.length === 0}
                                        className="px-4 py-2 rounded-lg bg-eigen-violet text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Fund
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Step 2: Approve */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-eigen-violet/10 text-eigen-violet text-xs font-bold flex items-center justify-center">2</span>
                                <span className="text-sm font-medium text-txt-primary">Approve Token Sales</span>
                            </div>
                            <div className="ml-8">
                                <button
                                    onClick={handleApproveAll}
                                    disabled={isProcessing || wallets.length === 0 || !tokenAddress}
                                    className="w-full py-2.5 rounded-lg border border-eigen-violet/30 text-eigen-violet text-sm font-medium hover:bg-eigen-violet/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Approve All Wallets
                                </button>
                            </div>
                        </div>

                        {/* Step 3: Sell */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-eigen-violet/10 text-eigen-violet text-xs font-bold flex items-center justify-center">3</span>
                                <span className="text-sm font-medium text-txt-primary">Execute Bundle Sell</span>
                            </div>
                            <div className="ml-8 space-y-2">
                                <div>
                                    <label className="block text-caption text-txt-disabled mb-1">
                                        Slippage: {(slippageBps / 100).toFixed(1)}%
                                    </label>
                                    <input
                                        type="range"
                                        value={slippageBps}
                                        onChange={(e) => setSlippageBps(Number(e.target.value))}
                                        min={50}
                                        max={2000}
                                        step={50}
                                        disabled={isProcessing}
                                        className="w-full accent-eigen-violet"
                                    />
                                </div>
                                <button
                                    onClick={handleBundleSell}
                                    disabled={isProcessing || wallets.length === 0 || !tokenAddress}
                                    className="w-full py-3 rounded-xl bg-eigen-violet text-white font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-eigen-violet/20"
                                >
                                    Execute Bundle Sell
                                </button>
                            </div>
                        </div>

                        {/* Step 4: Collect */}
                        <div className="space-y-2 border-t border-border-subtle pt-4">
                            <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-bg-hover text-txt-muted text-xs font-bold flex items-center justify-center">4</span>
                                <span className="text-sm font-medium text-txt-muted">Collect Remaining MON</span>
                            </div>
                            <div className="ml-8">
                                <button
                                    onClick={handleCollectMon}
                                    disabled={isProcessing || wallets.length === 0}
                                    className="w-full py-2.5 rounded-lg border border-border-subtle text-txt-secondary text-sm font-medium hover:border-border-hover hover:text-txt-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Collect MON from Wallets
                                </button>
                                <p className="text-caption text-txt-disabled mt-1">Optional — reclaim leftover gas MON</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
