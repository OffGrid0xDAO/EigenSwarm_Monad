import { useState, useRef } from 'react';
import { createPublicClient, createWalletClient, http, erc20Abi, getAddress, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { useWallet } from '../lib/wallet';
import { CONTRACTS, ABIS } from '../lib/contracts';
import { monad } from '../lib/chains';

const transport = http(monad.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: monad, transport });
const ZERO = '0x0000000000000000000000000000000000000000';

type WalletRow = { address: string; privateKey: string };

function parseCsv(csv: string): WalletRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const rows: WalletRow[] = [];
  for (const line of lines) {
    const idx = line.indexOf(',');
    if (idx === -1) continue;
    const address = line.slice(0, idx).trim();
    const privateKey = line.slice(idx + 1).trim();
    if (address.startsWith('0x') && privateKey.startsWith('0x')) rows.push({ address, privateKey });
  }
  return rows;
}

export function BundleSell() {
  const { chainId, address: connectedAddress, writeContract } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [sellPct, setSellPct] = useState('100');
  const [slippage, setSlippage] = useState('2');
  const [status, setStatus] = useState<'idle' | 'approving' | 'collecting' | 'executing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [approveResults, setApproveResults] = useState<{ address: string; ok: boolean; error?: string }[]>([]);
  const [bundleTxHash, setBundleTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monPerWallet, setMonPerWallet] = useState('0.01');
  const [fundTxHash, setFundTxHash] = useState<string | null>(null);
  const [fundError, setFundError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [collectResults, setCollectResults] = useState<{ address: string; ok: boolean; amount?: string; error?: string }[]>([]);
  const [collecting, setCollecting] = useState(false);

  const wallets = csvText ? parseCsv(csvText) : [];
  const isMonad = chainId === monad.id;
  const bundleSellAddress = (CONTRACTS.BUNDLE_SELL_BY_CHAIN as Record<number, string>)[monad.id] ?? ZERO;
  const fundWalletsAddress = (CONTRACTS.FUND_WALLETS_BY_CHAIN as Record<number, string>)[monad.id] ?? ZERO;
  const isContractDeployed = bundleSellAddress !== ZERO;
  const isFundWalletsDeployed = fundWalletsAddress !== ZERO;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
    setStatus('idle');
    setApproveResults([]);
    setBundleTxHash(null);
    setFundTxHash(null);
    setCollectResults([]);
    setError(null);
    setFundError(null);
  };

  const handleFundWallets = async () => {
    if (!isMonad || !isFundWalletsDeployed || wallets.length === 0 || !connectedAddress) {
      setFundError('Connect wallet, deploy FundWallets, and load CSV.');
      return;
    }
    const raw = monPerWallet.trim();
    if (!raw || parseFloat(raw) <= 0) {
      setFundError('Enter a positive MON amount per wallet.');
      return;
    }
    let amountEach: bigint;
    try {
      amountEach = parseEther(raw);
    } catch {
      setFundError('Invalid MON amount.');
      return;
    }
    const recipients = [...new Set(wallets.map((w) => getAddress(w.address)))] as `0x${string}`[];
    const totalMon = BigInt(recipients.length) * amountEach;
    setFundError(null);
    setFunding(true);
    try {
      const hash = await writeContract({
        chainId: monad.id,
        address: fundWalletsAddress as `0x${string}`,
        abi: ABIS.FUND_WALLETS as readonly unknown[],
        functionName: 'fund',
        args: [recipients, amountEach],
        value: totalMon,
      });
      setFundTxHash(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fund failed';
      setFundError(msg);
    } finally {
      setFunding(false);
    }
  };

  const handleCollectMon = async () => {
    if (!isMonad || wallets.length === 0 || !connectedAddress) {
      setError('Connect wallet and load CSV.');
      return;
    }
    const to = getAddress(connectedAddress) as `0x${string}`;
    const gasPrice = await publicClient.getGasPrice();
    const gasLimit = 21000n;
    const gasCost = gasLimit * gasPrice;
    setStatus('collecting');
    setError(null);
    setCollectResults([]);
    setCollecting(true);
    const out: { address: string; ok: boolean; amount?: string; error?: string }[] = [];
    try {
      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        setProgress(`Collect ${i + 1}/${wallets.length}: ${w.address.slice(0, 10)}…`);
        try {
          const balance = await publicClient.getBalance({ address: getAddress(w.address) as `0x${string}` });
          const sendAmount = balance > gasCost ? balance - gasCost : 0n;
          if (sendAmount === 0n) {
            out.push({ address: w.address, ok: false, error: 'Insufficient balance' });
            continue;
          }
          const account = privateKeyToAccount(w.privateKey as `0x${string}`);
          const walletClient = createWalletClient({ chain: monad, transport, account });
          await walletClient.sendTransaction({
            to,
            value: sendAmount,
          });
          out.push({ address: w.address, ok: true, amount: formatEther(sendAmount) });
        } catch (err) {
          out.push({ address: w.address, ok: false, error: err instanceof Error ? err.message : 'Failed' });
        }
      }
      setCollectResults(out);
    } finally {
      setCollecting(false);
      setStatus('idle');
      setProgress('');
    }
  };

  const isBusy = status === 'approving' || status === 'collecting' || status === 'executing';

  const handleApprove = async () => {
    if (!tokenAddress.trim() || wallets.length === 0 || !isContractDeployed) {
      setError('Set token, upload CSV, and deploy BundleSell first.');
      return;
    }
    const pct = Math.min(100, Math.max(0, parseFloat(sellPct) || 0));
    const token = tokenAddress.trim() as `0x${string}`;
    const spender = getAddress(bundleSellAddress) as `0x${string}`;
    setStatus('approving');
    setError(null);
    const out: { address: string; ok: boolean; error?: string }[] = [];
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      setProgress(`Approve ${i + 1}/${wallets.length}: ${w.address.slice(0, 10)}…`);
      try {
        const balance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [getAddress(w.address) as `0x${string}`],
        });
        if (balance === 0n) {
          out.push({ address: w.address, ok: false, error: 'Zero balance' });
          continue;
        }
        const account = privateKeyToAccount(w.privateKey as `0x${string}`);
        const walletClient = createWalletClient({ chain: monad, transport, account });
        const maxAllowance = 2n ** 256n - 1n;
        await walletClient.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, maxAllowance],
        });
        out.push({ address: w.address, ok: true });
      } catch (err) {
        out.push({ address: w.address, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }
    setApproveResults(out);
    setStatus('idle');
    setProgress('');
  };

  const handleExecuteBundleSell = async () => {
    if (!tokenAddress.trim() || wallets.length === 0 || !isContractDeployed || !connectedAddress) {
      setError('Connect your wallet (MON will be sent here), ensure CSV and token are set.');
      return;
    }
    const pct = Math.min(100, Math.max(0, parseFloat(sellPct) || 0));
    const slippageBps = BigInt(Math.round((parseFloat(slippage) || 2) * 100));
    const sellDeadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const token = tokenAddress.trim() as `0x${string}`;

    setError(null);
    try {
      const froms: `0x${string}`[] = [];
      const amounts: bigint[] = [];
      for (const w of wallets) {
        const owner = getAddress(w.address) as `0x${string}`;
        const balance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner],
        });
        const amount = (balance * BigInt(Math.round(pct * 100))) / 10000n;
        if (amount > 0n) {
          froms.push(owner);
          amounts.push(amount);
        }
      }
      if (froms.length === 0) {
        setError('No wallet has a positive amount to sell.');
        setStatus('idle');
        return;
      }

      setStatus('executing');
      setProgress('Submitting…');
      const hash = await writeContract({
        chainId: monad.id,
        address: bundleSellAddress as `0x${string}`,
        abi: ABIS.BUNDLE_SELL as readonly unknown[],
        functionName: 'bundleSell',
        args: [token, froms, amounts, slippageBps, sellDeadline],
        value: 0n,
        gas: 3_000_000n,
      });
      setBundleTxHash(hash);
      setStatus('done');
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bundle sell failed');
      setStatus('idle');
      setProgress('');
    }
  };

  return (
    <div className="flex-1 page-wrap">
      <div className="page-inner">
        <div className="hero-block">
          <h1 className="hero-title text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Bundle Sell
          </h1>
          <p className="hero-subtitle text-[var(--text-secondary)] text-sm sm:text-base leading-relaxed">
            Each CSV wallet approves the contract, then you execute the bundle sell in one tx. Each wallet needs MON for gas. MON from the sell goes to your connected wallet.
          </p>
        </div>

        <div className="form-sections">
          <div className="form-col-left">
            <section className="section-card">
              <h2 className="section-heading">Wallets CSV</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Same format as exported: one line per wallet, <code className="font-mono bg-black/20 px-1 rounded">address,privateKey</code>.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Upload CSV"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary w-full py-2.5 px-3 text-sm"
              >
                Choose CSV file
              </button>
              {wallets.length > 0 && (
                <p className="text-xs text-emerald-400 mt-2">Loaded {wallets.length} wallet(s)</p>
              )}
            </section>

            <section className="section-card">
              <h2 className="section-heading">Fund all wallets with MON (1 tx)</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Send the same amount of MON to each CSV wallet in a single transaction (for gas when using approvals).
              </p>
              <div className="form-group">
                <label className="form-label">MON per wallet</label>
                <input
                  type="text"
                  value={monPerWallet}
                  onChange={(e) => setMonPerWallet(e.target.value)}
                  placeholder="0.01"
                  className="input-field font-mono py-2.5 px-3 text-sm w-full"
                />
              </div>
              {wallets.length > 0 && monPerWallet.trim() && (
                <p className="text-[10px] text-[var(--text-muted)] mb-2">
                  Total: {wallets.length} × {monPerWallet.trim()} = {(wallets.length * (parseFloat(monPerWallet) || 0)).toFixed(4)} MON
                </p>
              )}
              {!isFundWalletsDeployed && (
                <p className="text-xs text-amber-200 mb-2">
                  Deploy first: <code className="font-mono text-[10px]">npm run deploy:fund-wallets</code>, then set <code className="font-mono text-[10px]">FUND_WALLETS_BY_CHAIN</code> in <code className="font-mono text-[10px]">src/lib/contracts.ts</code>.
                </p>
              )}
              {fundError && <p className="text-xs text-red-400 mb-2">{fundError}</p>}
              {funding && (
                <p className="text-xs text-amber-200 mb-2">
                  Confirm in your wallet (e.g. MetaMask). Check for a popup or extension notification.
                </p>
              )}
              {!connectedAddress && (
                <p className="text-xs text-[var(--text-muted)] mb-2">Connect your wallet first.</p>
              )}
              {connectedAddress && !isMonad && (
                <p className="text-xs text-amber-200 mb-2">Switch to Monad network to fund.</p>
              )}
              <button
                type="button"
                onClick={handleFundWallets}
                disabled={funding || !isMonad || !isFundWalletsDeployed || wallets.length === 0 || !connectedAddress || !monPerWallet.trim()}
                className="btn-secondary w-full py-2.5 px-3 text-sm"
              >
                {funding ? 'Confirm in wallet…' : 'Fund all (1 tx)'}
              </button>
              {fundTxHash && (
                <p className="text-xs text-emerald-400 mt-2">
                  Fund tx:{' '}
                  <a href={`https://monadvision.com/tx/${fundTxHash}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                    View
                  </a>
                </p>
              )}
            </section>

            <section className="section-card">
              <h2 className="section-heading">Collect MON from all wallets</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Send all MON from each CSV wallet to your connected wallet. One tx per wallet (gas is deducted from each wallet&apos;s balance).
              </p>
              {collecting && progress && (
                <p className="text-xs text-amber-200 mb-2">{progress}</p>
              )}
              {!connectedAddress && (
                <p className="text-xs text-[var(--text-muted)] mb-2">Connect your wallet first.</p>
              )}
              {connectedAddress && !isMonad && (
                <p className="text-xs text-amber-200 mb-2">Switch to Monad network.</p>
              )}
              <button
                type="button"
                onClick={handleCollectMon}
                disabled={collecting || !isMonad || wallets.length === 0 || !connectedAddress}
                className="btn-secondary w-full py-2.5 px-3 text-sm"
              >
                {collecting ? 'Collecting…' : 'Collect MON to connected wallet'}
              </button>
              {collectResults.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs font-mono text-[var(--text-muted)]">
                  {collectResults.map((r, i) => (
                    <li key={i}>
                      {r.address.slice(0, 8)}…{r.address.slice(-6)} {r.ok ? `✓ ${r.amount ?? ''} MON` : `✗ ${r.error ?? ''}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="section-card">
              <h2 className="section-heading">Approve token</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Each CSV wallet approves the BundleSell contract to spend its tokens (each needs MON for gas). Do this before executing the bundle sell.
              </p>
              {status === 'approving' && progress && (
                <p className="text-xs text-amber-200 mb-2">{progress}</p>
              )}
              <button
                type="button"
                onClick={handleApprove}
                disabled={isBusy || !isMonad || !isContractDeployed || wallets.length === 0 || !tokenAddress.trim()}
                className="btn-secondary w-full py-2.5 px-3 text-sm"
              >
                {status === 'approving' ? 'Approving…' : 'Approve from each wallet'}
              </button>
              {approveResults.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs font-mono text-[var(--text-muted)]">
                  {approveResults.map((r, i) => (
                    <li key={i}>
                      {r.address.slice(0, 8)}…{r.address.slice(-6)} {r.ok ? '✓' : `✗ ${r.error ?? ''}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="form-col-right">
            <section className="section-card">
              <h2 className="section-heading">Sell settings</h2>
              <div className="form-group">
                <label className="form-label">Token address</label>
                <input
                  type="text"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  placeholder="0x..."
                  className="input-field font-mono py-2.5 px-3 text-sm w-full"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Sell (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={sellPct}
                  onChange={(e) => setSellPct(e.target.value)}
                  className="input-field py-2 px-3 text-sm"
                  style={{ width: '6rem' }}
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">0–100% of each wallet’s balance</p>
              </div>
              <div className="form-group">
                <label className="form-label">Slippage (%)</label>
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="input-field py-2 px-3 text-sm"
                  style={{ width: '5rem' }}
                />
              </div>
            </section>

            {!isContractDeployed && (
              <div className="section-card" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)' }}>
                <p className="text-amber-200 text-xs m-0">
                  Deploy the BundleSell contract first: <code className="font-mono text-[10px]">npm run deploy:bundle-sell</code>, then set <code className="font-mono text-[10px]">BUNDLE_SELL_BY_CHAIN</code> in <code className="font-mono text-[10px]">src/lib/contracts.ts</code>.
                </p>
              </div>
            )}

            {!isMonad && (
              <div className="section-card" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)' }}>
                <p className="text-amber-200 text-xs m-0">Switch to Monad to run bundle sell.</p>
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
            {isBusy && progress && (
              <p className="text-xs text-[var(--text-secondary)]">{progress}</p>
            )}

            <div className="cta-block">
              <button
                type="button"
                onClick={handleExecuteBundleSell}
                disabled={isBusy || !isMonad || !isContractDeployed || wallets.length === 0 || !tokenAddress.trim() || !connectedAddress}
                className="btn-primary w-full text-sm py-3"
              >
                {status === 'executing' && 'Submitting…'}
                {status === 'idle' && 'Execute bundle sell'}
                {status === 'done' && 'Bundle sell done'}
              </button>
            </div>

            {bundleTxHash && (
              <section className="section-card mt-4" style={{ borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)' }}>
                <p className="text-emerald-200 text-xs m-0">
                  Bundle sell done.{' '}
                  <a href={`https://monadvision.com/tx/${bundleTxHash}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                    View tx
                  </a>
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
