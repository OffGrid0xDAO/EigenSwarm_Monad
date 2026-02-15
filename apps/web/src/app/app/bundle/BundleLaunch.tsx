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
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { useBundleWallet } from '@/lib/bundle/useBundleWallet';
import { CONTRACTS, ABIS, CHAIN_IDS, DEPLOY_FEE, DEFAULT_SLIPPAGE_BPS } from '@/lib/bundle/contracts';
import { monad } from '@/lib/bundle/chains';
import { uploadImage, uploadMetadata, mineSalt, isNadFunApiAvailable } from '@/lib/bundle/nadfunApi';
import { uploadImageToSupabase, isUploadConfigured } from '@/lib/bundle/upload';

interface Recipient {
    address: string;
    monAmount: string;
}

type LaunchStatus = 'idle' | 'uploading' | 'mining-salt' | 'distributing' | 'launching' | 'success' | 'error';

export function BundleLaunch() {
    const { address, isConnected, isWrongChain, switchToMonad, writeContract, login } = useBundleWallet();

    // Token config
    const [name, setName] = useState('');
    const [symbol, setSymbol] = useState('');
    const [description, setDescription] = useState('');
    const [website, setWebsite] = useState('');
    const [twitter, setTwitter] = useState('');
    const [telegram, setTelegram] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState('');

    // Recipients
    const [recipients, setRecipients] = useState<Recipient[]>([
        { address: '', monAmount: '0.1' },
    ]);
    const [walletCount, setWalletCount] = useState(3);
    const [monPerWallet, setMonPerWallet] = useState('0.1');
    const [useGeneratedWallets, setUseGeneratedWallets] = useState(true);

    // Slippage
    const [slippageBps, setSlippageBps] = useState(100);

    // Status
    const [status, setStatus] = useState<LaunchStatus>('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const [error, setError] = useState('');
    const [txHash, setTxHash] = useState('');
    const [tokenAddress, setTokenAddress] = useState('');

    const chainId = CHAIN_IDS.MONAD;

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onload = () => setImagePreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const addRecipient = () => {
        setRecipients([...recipients, { address: '', monAmount: '0.1' }]);
    };

    const removeRecipient = (index: number) => {
        setRecipients(recipients.filter((_, i) => i !== index));
    };

    const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
        const updated = [...recipients];
        updated[index] = { ...updated[index], [field]: value };
        setRecipients(updated);
    };

    const totalMon = useGeneratedWallets
        ? parseFloat(monPerWallet || '0') * walletCount
        : recipients.reduce((sum, r) => sum + parseFloat(r.monAmount || '0'), 0);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!address) return;

        setError('');
        setTxHash('');
        setTokenAddress('');

        try {
            // Step 1: Upload image
            setStatus('uploading');
            setStatusMessage('Uploading image...');

            let imageUri = '';
            if (imageFile) {
                if (isNadFunApiAvailable(chainId)) {
                    const blob = new Blob([await imageFile.arrayBuffer()], { type: imageFile.type });
                    const result = await uploadImage(chainId, blob, imageFile.type);
                    imageUri = result.imageUri;
                } else if (isUploadConfigured()) {
                    imageUri = await uploadImageToSupabase(imageFile);
                } else {
                    throw new Error('No image upload method available. Configure Supabase or use Monad mainnet for nad.fun API.');
                }
            }

            // Step 2: Upload metadata
            setStatusMessage('Uploading metadata...');
            const { metadataUri } = await uploadMetadata(chainId, {
                imageUri,
                name,
                symbol,
                description,
                website: website || undefined,
                twitter: twitter || undefined,
                telegram: telegram || undefined,
            });

            // Step 3: Mine salt
            setStatus('mining-salt');
            setStatusMessage('Mining salt for token address...');
            const { salt } = await mineSalt(chainId, {
                creator: CONTRACTS.LAUNCH_AND_BUNDLE_BUY_BY_CHAIN[chainId],
                name,
                symbol,
                metadataUri,
            });

            // Step 4: Generate wallets if needed
            let finalRecipients: { address: Address; monAmount: bigint }[];
            if (useGeneratedWallets) {
                setStatus('distributing');
                setStatusMessage(`Generating ${walletCount} wallets...`);
                finalRecipients = Array.from({ length: walletCount }, () => {
                    const pk = generatePrivateKey();
                    const account = privateKeyToAccount(pk);
                    return {
                        address: account.address,
                        monAmount: parseEther(monPerWallet),
                    };
                });
            } else {
                finalRecipients = recipients
                    .filter((r) => r.address && parseFloat(r.monAmount) > 0)
                    .map((r) => ({
                        address: r.address as Address,
                        monAmount: parseEther(r.monAmount),
                    }));
            }

            if (finalRecipients.length === 0) {
                throw new Error('At least one recipient is required.');
            }

            // Step 5: Execute launch contract
            setStatus('launching');
            setStatusMessage('Launching token & distributing...');

            const contractAddress = CONTRACTS.LAUNCH_AND_BUNDLE_BUY_BY_CHAIN[chainId] as Address;
            const recipientAddresses = finalRecipients.map((r) => r.address);
            const recipientAmounts = finalRecipients.map((r) => r.monAmount);
            const totalValue = finalRecipients.reduce((sum, r) => sum + r.monAmount, 0n) + DEPLOY_FEE;

            const hash = await writeContract({
                address: contractAddress,
                abi: ABIS.LAUNCH_AND_BUNDLE_BUY as any,
                functionName: 'launchAndBundleBuy',
                args: [
                    name,
                    symbol,
                    metadataUri,
                    salt,
                    recipientAddresses,
                    recipientAmounts,
                    BigInt(slippageBps),
                ],
                value: totalValue,
            });

            setTxHash(hash);
            setStatus('success');
            setStatusMessage('Token launched successfully!');
        } catch (err: any) {
            console.error('[BundleLaunch] Error:', err);
            setError(err?.shortMessage || err?.message || 'Launch failed');
            setStatus('error');
            setStatusMessage('');
        }
    }, [address, chainId, name, symbol, description, website, twitter, telegram, imageFile, recipients, walletCount, monPerWallet, useGeneratedWallets, slippageBps, writeContract]);

    const isProcessing = !['idle', 'success', 'error'].includes(status);

    if (!isConnected) {
        return (
            <div className="text-center py-16">
                <p className="text-txt-muted mb-4">Connect your wallet to launch a token</p>
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

    if (status === 'success') {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="w-16 h-16 rounded-full bg-status-success/10 flex items-center justify-center mx-auto">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-status-success">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
                <h3 className="text-lg font-semibold text-txt-primary">Token Launched!</h3>
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
                <button onClick={() => { setStatus('idle'); setTxHash(''); setTokenAddress(''); }} className="mt-4 px-4 py-2 rounded-lg border border-border-subtle text-txt-secondary text-sm hover:border-border-hover transition-colors">
                    Launch Another
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
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
                </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Left column: Token config */}
                <div className="space-y-5">
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Token Details</h3>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Token"
                                required
                                disabled={isProcessing}
                                className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Symbol</label>
                            <input
                                type="text"
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                placeholder="TOKEN"
                                maxLength={10}
                                required
                                disabled={isProcessing}
                                className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Description</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                                placeholder="Describe your token..."
                                rows={3}
                                disabled={isProcessing}
                                className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors resize-none disabled:opacity-50"
                            />
                            <p className="text-caption text-txt-disabled mt-1">{description.length}/280</p>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Logo Image</label>
                            <div className="flex items-center gap-3">
                                {imagePreview && (
                                    <img src={imagePreview} alt="Logo preview" className="w-12 h-12 rounded-xl object-cover border border-border-subtle" />
                                )}
                                <label className="flex-1 cursor-pointer">
                                    <div className="bg-bg-elevated border border-dashed border-border-subtle rounded-lg px-3.5 py-3 text-sm text-txt-muted text-center hover:border-border-hover transition-colors">
                                        {imageFile ? imageFile.name : 'Click to upload'}
                                    </div>
                                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" disabled={isProcessing} />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Social links */}
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Social Links</h3>
                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">Website</label>
                            <input
                                type="text"
                                value={website}
                                onChange={(e) => setWebsite(e.target.value)}
                                placeholder="https://..."
                                disabled={isProcessing}
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
                                    disabled={isProcessing}
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
                                    disabled={isProcessing}
                                    className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm text-txt-primary placeholder:text-txt-disabled focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right column: Distribution config */}
                <div className="space-y-5">
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Distribution</h3>

                        {/* Toggle: generated vs manual wallets */}
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-xs font-medium text-txt-muted">Auto-generate wallets</span>
                                <p className="text-caption text-txt-disabled">Generate fresh wallets automatically</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setUseGeneratedWallets(!useGeneratedWallets)}
                                disabled={isProcessing}
                                className={`w-9 h-5 rounded-full transition-colors ${useGeneratedWallets ? 'bg-eigen-violet' : 'bg-bg-hover'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${useGeneratedWallets ? 'translate-x-4' : ''}`} />
                            </button>
                        </div>

                        {useGeneratedWallets ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                                        Wallet Count: {walletCount}
                                    </label>
                                    <input
                                        type="range"
                                        value={walletCount}
                                        onChange={(e) => setWalletCount(Number(e.target.value))}
                                        min={1}
                                        max={20}
                                        step={1}
                                        disabled={isProcessing}
                                        className="w-full accent-eigen-violet"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">MON per wallet</label>
                                    <input
                                        type="number"
                                        value={monPerWallet}
                                        onChange={(e) => setMonPerWallet(e.target.value)}
                                        min={0}
                                        step={0.01}
                                        disabled={isProcessing}
                                        className="w-full bg-bg-elevated border border-border-subtle rounded-lg px-3.5 py-2.5 text-sm font-mono text-txt-primary focus:outline-none focus:border-border-hover transition-colors disabled:opacity-50"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                                    {recipients.map((r, i) => (
                                        <div key={i} className="flex gap-2 items-center bg-bg-elevated border border-border-subtle rounded-lg p-2.5">
                                            <input
                                                type="text"
                                                value={r.address}
                                                onChange={(e) => updateRecipient(i, 'address', e.target.value)}
                                                placeholder="0x..."
                                                disabled={isProcessing}
                                                className="flex-1 bg-transparent text-sm font-mono text-txt-primary placeholder:text-txt-disabled focus:outline-none min-w-0"
                                            />
                                            <input
                                                type="number"
                                                value={r.monAmount}
                                                onChange={(e) => updateRecipient(i, 'monAmount', e.target.value)}
                                                min={0}
                                                step={0.01}
                                                disabled={isProcessing}
                                                className="w-24 bg-transparent text-sm font-mono text-txt-primary text-right focus:outline-none"
                                            />
                                            <span className="text-xs text-txt-muted">MON</span>
                                            {recipients.length > 1 && (
                                                <button type="button" onClick={() => removeRecipient(i)} className="text-txt-disabled hover:text-status-danger transition-colors text-lg leading-none">
                                                    ×
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={addRecipient}
                                    disabled={isProcessing}
                                    className="w-full py-2 rounded-lg border border-dashed border-eigen-violet/30 text-xs font-medium text-eigen-violet hover:bg-eigen-violet/5 transition-colors"
                                >
                                    + Add Recipient
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Slippage & Summary */}
                    <div className="subtle-card p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-txt-primary">Settings & Summary</h3>

                        <div>
                            <label className="block text-xs font-medium text-txt-muted uppercase tracking-wider mb-1.5">
                                Slippage: {(slippageBps / 100).toFixed(1)}%
                            </label>
                            <input
                                type="range"
                                value={slippageBps}
                                onChange={(e) => setSlippageBps(Number(e.target.value))}
                                min={10}
                                max={1000}
                                step={10}
                                disabled={isProcessing}
                                className="w-full accent-eigen-violet"
                            />
                        </div>

                        <div className="rounded-lg bg-bg-elevated p-3 space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-txt-muted">Recipients</span>
                                <span className="font-mono text-txt-primary">{useGeneratedWallets ? walletCount : recipients.filter(r => r.address).length}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-txt-muted">Distribution MON</span>
                                <span className="font-mono text-txt-primary">{totalMon.toFixed(4)} MON</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-txt-muted">Deploy Fee</span>
                                <span className="font-mono text-txt-primary">{formatEther(DEPLOY_FEE)} MON</span>
                            </div>
                            <div className="flex justify-between text-xs border-t border-border-subtle pt-2">
                                <span className="text-txt-primary font-medium">Total</span>
                                <span className="font-mono text-txt-primary font-semibold">
                                    {(totalMon + parseFloat(formatEther(DEPLOY_FEE))).toFixed(4)} MON
                                </span>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isProcessing || !name || !symbol}
                            className="w-full py-3.5 rounded-xl bg-eigen-violet text-white font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-eigen-violet/20"
                        >
                            {isProcessing ? 'Processing...' : 'Launch Token & Distribute'}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    );
}
