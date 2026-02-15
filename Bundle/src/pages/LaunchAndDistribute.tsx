import { useState, useRef, useEffect } from 'react';
import { parseEther, encodePacked, keccak256, createPublicClient, http, decodeEventLog, decodeErrorResult } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { useWallet } from '../lib/wallet';
import { CONTRACTS, ABIS, DEPLOY_FEE } from '../lib/contracts';
import { uploadImageToSupabase, isUploadConfigured } from '../lib/upload';
import { saveLaunch } from '../lib/supabase';
import { supportedChains, sepolia, monad } from '../lib/chains';
import { isNadFunApiAvailable, uploadImage as nadfunUploadImage, uploadMetadata as nadfunUploadMetadata, mineSalt as nadfunMineSalt } from '../lib/nadfunApi';

const SUPPORTED_CHAIN_IDS = new Set(supportedChains.map((c) => c.id));
const publicClients = {
  [sepolia.id]: createPublicClient({
    chain: sepolia,
    transport: http(sepolia.rpcUrls.default.http[0]),
  }),
  [monad.id]: createPublicClient({
    chain: monad,
    transport: http(monad.rpcUrls.default.http[0]),
  }),
} as const;

function getExplorerTxUrl(chainId: number, txHash: string): string {
  const chain = supportedChains.find((c) => c.id === chainId);
  const base = chain?.blockExplorers?.default?.url;
  return base ? `${base}/tx/${txHash}` : '#';
}
function getExplorerAddressUrl(chainId: number, address: string): string {
  const chain = supportedChains.find((c) => c.id === chainId);
  const base = chain?.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : '#';
}

interface RecipientRow {
  id: string;
  address: string;
  monAmount: string;
}

/** Store private keys for generated wallets (keyed by address) for export only */
function useGeneratedKeys() {
  const ref = useRef<Record<string, string>>({});
  const get = (address: string) => ref.current[address];
  const set = (address: string, key: string) => { ref.current[address] = key; };
  const setAll = (entries: { address: string; privateKey: string }[]) => {
    ref.current = {};
    entries.forEach(({ address, privateKey }) => { ref.current[address] = privateKey; });
  };
  const getAll = () => ({ ...ref.current });
  return { get, setAll, getAll };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function LaunchAndDistribute() {
  const { address, status, chainId, switchChain, writeContract, isWrongChain } = useWallet();
  const isConnected = status === 'connected' && !!address;
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenURI, setTokenURI] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTxHashRef = useRef<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [walletCount, setWalletCount] = useState('5');
  const [totalDistributeMon, setTotalDistributeMon] = useState('');
  const [slippage, setSlippage] = useState('2');
  const generatedKeys = useGeneratedKeys();
  const [txHash, setTxHash] = useState<string | null>(null);
  const [launchedTokenAddress, setLaunchedTokenAddress] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const totalDistribute = recipients.reduce((sum, r) => sum + parseFloat(r.monAmount || '0'), 0);
  const totalMon = 10 + totalDistribute;
  const launchContractAddress = chainId != null ? (CONTRACTS.LAUNCH_AND_BUNDLE_BUY_BY_CHAIN[chainId] ?? ZERO_ADDRESS) : ZERO_ADDRESS;
  const isContractDeployed = launchContractAddress !== ZERO_ADDRESS;

  const generateWallets = () => {
    const n = Math.min(Math.max(1, parseInt(walletCount, 10) || 1), 100);
    setWalletCount(String(n));
    const keys: { address: string; privateKey: string }[] = [];
    const newRecipients: RecipientRow[] = [];
    for (let i = 0; i < n; i++) {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      keys.push({ address: account.address, privateKey });
      newRecipients.push({ id: `${Date.now()}-${i}`, address: account.address, monAmount: '' });
    }
    generatedKeys.setAll(keys);
    setRecipients(newRecipients);
    setTotalDistributeMon('');
  };

  const distributeWithRandomness = () => {
    const total = parseFloat(totalDistributeMon || '0');
    if (total <= 0 || recipients.length === 0) return;
    const n = recipients.length;
    const weights = Array.from({ length: n }, () => 0.9 + Math.random() * 0.2);
    const sumW = weights.reduce((a, b) => a + b, 0);
    const amounts = weights.map((w) => (total * (w / sumW)));
    const sumAmounts = amounts.reduce((a, b) => a + b, 0);
    const rounded = amounts.map((a, i) => (i < n - 1 ? Number(a.toFixed(6)) : Number((total - amounts.slice(0, n - 1).reduce((s, x) => s + Number(x.toFixed(6)), 0)).toFixed(6))));
    setRecipients((prev) => prev.map((r, i) => ({ ...r, monAmount: String(rounded[i]) })));
  };

  const exportKeys = () => {
    const keys = generatedKeys.getAll();
    const lines = Object.entries(keys).map(([addr, key]) => `${addr},${key}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet-keys-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSubmitError('Please choose an image file (PNG, JPG, GIF, WebP).');
      return;
    }
    setLogoFile(file);
    setSubmitError(null);
    setTokenURI('');
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setTokenURI('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Persist launch and recipients to Supabase after successful tx
  useEffect(() => {
    if (!isSuccess || !txHash || !address) return;
    if (savedTxHashRef.current === txHash) return;
    savedTxHashRef.current = txHash;
    saveLaunch({
      creator_address: address,
      name,
      symbol,
      token_uri: tokenURI,
      tx_hash: txHash,
      recipients: recipients.map((r) => ({ address: r.address, mon_amount: r.monAmount })),
      total_mon: totalDistribute.toFixed(6),
      slippage_bps: Math.round(parseFloat(slippage) * 100),
    }).then(({ error }) => {
      if (error) console.error('Failed to save launch to Supabase:', error.message);
    });
  }, [isSuccess, txHash, address, name, symbol, tokenURI, recipients, totalDistribute, slippage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setTxError(null);
    if (!isConnected || !address) {
      alert('Connect your wallet first.');
      return;
    }
    if (isWrongChain || (chainId == null || !SUPPORTED_CHAIN_IDS.has(chainId))) {
      try {
        await switchChain(monad.id);
      } catch {
        // user rejected
      }
      setSubmitError('Switch to Monad or Sepolia in your wallet (use the header), then try again.');
      return;
    }
    if (!isContractDeployed) {
      alert('LaunchAndBundleBuy contract is not deployed. Deploy it and set LAUNCH_AND_BUNDLE_BUY in src/lib/contracts.ts');
      return;
    }
    const addrs = recipients.map((r) => r.address);
    const amounts = recipients.map((r) => r.monAmount);
    if (recipients.length === 0 || addrs.some((a) => !a.trim()) || amounts.some((a) => !a || parseFloat(a) <= 0)) {
      alert('Generate wallets, set total MON, and click Distribute with randomness.');
      return;
    }
    if (addrs.some((a) => !a || a.length < 40)) {
      alert('Generate wallets and distribute amounts first.');
      return;
    }
    if (!logoFile) {
      setSubmitError('Choose a logo image.');
      return;
    }
    const currentChainId = chainId!;
    const useNadFunApi = isNadFunApiAvailable(currentChainId);
    if (!useNadFunApi && !isUploadConfigured()) {
      setSubmitError('On Monad we use nad.fun API. On other chains add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env');
      return;
    }

    setIsUploadingImage(true);
    let tokenURIForCreate: string;
    let saltForCreate: `0x${string}`;
    let actionId: number;

    try {
      if (useNadFunApi) {
        const contentType = logoFile.type || 'image/png';
        const imageResult = await nadfunUploadImage(currentChainId, logoFile, contentType);
        const metadataResult = await nadfunUploadMetadata(currentChainId, {
          imageUri: imageResult.imageUri,
          name,
          symbol,
          description: '',
        });
        const saltResult = await nadfunMineSalt(currentChainId, {
          creator: address!,
          name,
          symbol,
          metadataUri: metadataResult.metadataUri,
        });
        tokenURIForCreate = metadataResult.metadataUri;
        saltForCreate = saltResult.salt;
        actionId = 1;
        setTokenURI(metadataResult.metadataUri);
      } else {
        tokenURIForCreate = await uploadImageToSupabase(logoFile);
        setTokenURI(tokenURIForCreate);
        saltForCreate = keccak256(encodePacked(['address', 'uint256'], [address!, BigInt(Date.now())]));
        actionId = 0;
      }
    } catch (err) {
      setIsUploadingImage(false);
      setSubmitError(err instanceof Error ? err.message : 'Image/metadata upload failed.');
      return;
    }
    setIsUploadingImage(false);
    const monAmountsWei = amounts.map((a) => parseEther(a));
    const totalWei = DEPLOY_FEE + monAmountsWei.reduce((s, n) => s + n, 0n);
    const slippageBps = BigInt(Math.round(parseFloat(slippage) * 100));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    setIsPending(true);
    const launchAbi = ABIS.LAUNCH_AND_BUNDLE_BUY as readonly unknown[];
    const launchArgs = [name, symbol, tokenURIForCreate, saltForCreate, actionId, addrs, monAmountsWei, slippageBps, deadline] as const;
    try {
      const client = publicClients[currentChainId as keyof typeof publicClients];
      if (client && address) {
        try {
          await client.simulateContract({
            address: launchContractAddress as `0x${string}`,
            abi: launchAbi,
            functionName: 'launchAndDistribute',
            args: launchArgs,
            value: totalWei,
            account: address as `0x${string}`,
          });
        } catch (simErr: unknown) {
          const revertMessage = formatRevertMessage(simErr, launchAbi);
          setIsPending(false);
          setTxError(revertMessage);
          return;
        }
      }
      let gasLimit: bigint | undefined;
      if (client && address) {
        try {
          const estimated = await client.estimateContractGas({
            address: launchContractAddress as `0x${string}`,
            abi: launchAbi,
            functionName: 'launchAndDistribute',
            args: launchArgs,
            value: totalWei,
            account: address as `0x${string}`,
          });
          gasLimit = (estimated * 130n) / 100n;
          if (gasLimit < 2_000_000n) gasLimit = 2_000_000n;
        } catch {
          gasLimit = 8_000_000n;
        }
      } else {
        gasLimit = 8_000_000n;
      }
      const hash = await writeContract({
        chainId: currentChainId,
        address: launchContractAddress as `0x${string}`,
        abi: ABIS.LAUNCH_AND_BUNDLE_BUY as readonly unknown[],
        functionName: 'launchAndDistribute',
        args: launchArgs,
        value: totalWei,
        gas: gasLimit,
      });
      setTxHash(hash);
      setIsPending(false);
      setIsConfirming(true);
      if (client) {
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status === 'reverted') {
          setIsConfirming(false);
          setTxError('Transaction reverted on-chain. Nad.fun may only support tokens created via their frontend or official API.');
          return;
        }
        // Parse TokenLaunchedAndDistributed(token, creator, recipientCount, totalDistributed)
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: ABIS.LAUNCH_AND_BUNDLE_BUY as readonly unknown[],
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'TokenLaunchedAndDistributed' && decoded.args?.token) {
              setLaunchedTokenAddress(decoded.args.token as string);
              break;
            }
          } catch {
            // not our event, skip
          }
        }
      }
      setIsConfirming(false);
      setIsSuccess(true);
    } catch (err) {
      setIsPending(false);
      setIsConfirming(false);
      const revertMessage = formatRevertMessage(err, launchAbi);
      setTxError(revertMessage);
    }
  };

  function formatRevertMessage(err: unknown, abi: readonly unknown[]): string {
    const data = (err as { data?: unknown; cause?: { data?: unknown } })?.data ?? (err as { cause?: { data?: unknown } })?.cause?.data;
    if (data && typeof data === 'string' && data.startsWith('0x')) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        if (decoded.errorName === 'CreateFailed') return 'Token create failed. Nad.fun router may only allow creation from their frontend or API signer.';
        if (decoded.errorName === 'BuyFailed' && decoded.args?.[0] !== undefined) return `Buy failed for recipient ${Number(decoded.args[0]) + 1}. Try increasing slippage.`;
        if (decoded.errorName === 'InvalidValue') return 'Invalid value sent (deploy fee + distribution total).';
        if (decoded.errorName === 'InvalidArrayLength') return 'Recipients and amounts length mismatch.';
        return `Reverted: ${decoded.errorName}${decoded.args?.length ? `(${decoded.args.join(', ')})` : ''}`;
      } catch {
        // ignore decode error
      }
    }
    return err instanceof Error ? err.message : 'Transaction failed';
  }

  return (
    <div className="flex-1 page-wrap">
      <div className="page-inner">
        <div className="hero-block">
          <h1 className="hero-title text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Launch & Distribute
          </h1>
          <p className="hero-subtitle text-[var(--text-secondary)] text-sm sm:text-base leading-relaxed">
            Create a token on nad.fun and send it to multiple wallets in one transaction.
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            On Monad we use nad.fun’s official API (image + metadata + salt) so your token is created and supported on nad.fun.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="form-sections">
          <div className="form-col-left">
            <section className="section-card">
              <h2 className="section-heading">Token details</h2>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Token"
                  required
                  className="input-field font-mono py-2.5 px-3 text-sm"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="MTK"
                  required
                  className="input-field font-mono py-2.5 px-3 text-sm"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Logo image</label>
                {!isUploadConfigured() ? (
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-xs text-[var(--text-muted)]">
                    Add <code className="font-mono bg-black/20 px-1 py-0.5 rounded">VITE_SUPABASE_URL</code> and <code className="font-mono bg-black/20 px-1 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code> to your <code className="font-mono bg-black/20 px-1 py-0.5 rounded">.env</code> to enable logo uploads.
                  </div>
                ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoSelect}
                      className="hidden"
                      aria-label="Choose logo image"
                    />
                    {!logoFile ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full rounded-[var(--radius)] border-2 border-dashed border-[var(--border)] bg-[var(--bg-elevated)] py-10 text-sm text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)] transition-colors"
                      >
                        Click to choose image (PNG, JPG, WebP…)
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                          <div
                            className="shrink-0 overflow-hidden rounded-xl bg-[var(--bg-input)]"
                            style={{ width: 64, height: 64 }}
                          >
                            {logoPreview ? (
                              <img
                                src={logoPreview}
                                alt="Logo preview"
                                className="object-cover object-center"
                                style={{ width: 64, height: 64, maxWidth: 64, maxHeight: 64, display: 'block' }}
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate">{logoFile.name}</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Uploaded when you launch
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={clearLogo}
                            className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="form-col-right">
            <section className="section-card scroll-area">
              <h2 className="section-heading">Distribution</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Generate new wallets; we distribute the total MON across them with slight randomness.
              </p>
              <div className="form-group">
                <label className="form-label">Number of wallets</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={walletCount}
                    onChange={(e) => setWalletCount(e.target.value)}
                    className="input-field py-2 px-3 text-sm"
                    style={{ width: '6rem' }}
                  />
                  <button type="button" onClick={generateWallets} className="btn-accent-secondary text-sm py-2 px-4">
                    Generate wallets
                  </button>
                </div>
              </div>
              {recipients.length > 0 && (
                <>
                  <div className="form-group">
                    <label className="form-label">Total MON to distribute</label>
                    <div className="flex gap-2 flex-wrap items-center">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={totalDistributeMon}
                        onChange={(e) => setTotalDistributeMon(e.target.value)}
                        placeholder="e.g. 100"
                        className="input-field py-2 px-3 text-sm"
                        style={{ width: '8rem' }}
                      />
                      <button
                        type="button"
                        onClick={distributeWithRandomness}
                        disabled={!totalDistributeMon || parseFloat(totalDistributeMon) <= 0}
                        className="btn-primary text-sm py-2 px-4"
                      >
                        Distribute with randomness
                      </button>
                    </div>
                  </div>
                  <div className="recipient-list">
                    {recipients.map((row) => (
                      <div key={row.id} className="recipient-row">
                        <span className="flex-1 min-w-0 font-mono text-xs text-[var(--text-secondary)] truncate" title={row.address}>
                          {row.address.slice(0, 10)}…{row.address.slice(-8)}
                        </span>
                        <span className="text-sm font-mono text-white tabular-nums shrink-0">
                          {row.monAmount ? `${parseFloat(row.monAmount).toFixed(4)} MON` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <button type="button" onClick={exportKeys} className="btn-secondary text-xs py-1.5 px-3">
                      Export private keys (CSV)
                    </button>
                  </div>
                </>
              )}
              <div className="slippage-block">
                <label className="form-label">Slippage (%)</label>
                <input
                  type="number"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  step="0.5"
                  min="0.5"
                  max="50"
                  className="input-field py-2 px-2 text-sm"
                  style={{ width: '5rem' }}
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">Use 2–3% to avoid BuyFailed on first buys.</p>
              </div>
            </section>

            <section className="section-card">
              <h2 className="section-heading">Summary</h2>
              <div className="summary-rows">
                <div className="summary-row text-[var(--text-secondary)] text-sm">
                  <span>Deploy fee</span>
                  <span className="font-mono text-white tabular-nums">10 MON</span>
                </div>
                <div className="summary-row text-[var(--text-secondary)] text-sm">
                  <span>Distribution ({recipients.length})</span>
                  <span className="font-mono text-white tabular-nums">{totalDistribute.toFixed(6)} MON</span>
                </div>
                <div className="summary-total">
                  <span className="text-sm font-medium text-[var(--text-primary)]">Total</span>
                  <span className="text-lg font-semibold text-white font-mono tabular-nums">{totalMon.toFixed(4)} MON</span>
                </div>
              </div>
            </section>

            {!isContractDeployed && (
              <div className="section-card" style={{ padding: '14px 20px' }}>
                <p className="text-amber-200/90 text-xs m-0">
                  Deploy <code className="font-mono bg-black/20 px-1 py-0.5 rounded text-[10px]">LaunchAndBundleBuy</code> and set <code className="font-mono bg-black/20 px-1 py-0.5 rounded text-[10px]">LAUNCH_AND_BUNDLE_BUY</code> in <code className="font-mono bg-black/20 px-1 py-0.5 rounded text-[10px]">contracts.ts</code>.
                </p>
              </div>
            )}

            {submitError && (
              <p className="text-xs text-red-400 -mb-2">{submitError}</p>
            )}
            <div className="cta-block">
              <button
                type="submit"
                disabled={!isConnected || isPending || isConfirming || isUploadingImage || !isContractDeployed || !logoFile || recipients.length === 0 || !recipients.every((r) => r.monAmount && parseFloat(r.monAmount) > 0)}
                className="btn-primary w-full text-sm py-3"
              >
                {isUploadingImage
                  ? 'Uploading image…'
                  : isPending
                    ? 'Confirm in wallet…'
                    : isConfirming
                      ? 'Launching…'
                      : 'Launch & Distribute'}
              </button>
            </div>
          </div>
        </form>

        {txError && (
          <div className="section-card mt-4 flex-shrink-0" style={{ padding: '12px 20px', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}>
            <p className="text-red-200 text-xs m-0">{txError}</p>
          </div>
        )}

        {isSuccess && txHash && chainId && (
          <div className="section-card mt-4 flex-shrink-0" style={{ padding: '12px 20px', borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)' }}>
            <p className="text-emerald-200 text-xs font-medium m-0">
              Launched.{' '}
              <a href={getExplorerTxUrl(chainId, txHash)} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline">View tx</a>
              {launchedTokenAddress && (
                <>
                  {' · '}
                  <a href={getExplorerAddressUrl(chainId, launchedTokenAddress)} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline">Token</a>
                  {' '}
                  <span className="font-mono text-[10px] text-[var(--text-muted)]" title={launchedTokenAddress}>
                    {launchedTokenAddress.slice(0, 10)}…{launchedTokenAddress.slice(-8)}
                  </span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
