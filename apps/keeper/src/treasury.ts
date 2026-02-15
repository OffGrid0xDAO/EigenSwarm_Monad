import { getPublicClient, getWalletClient, getKeeperAddress } from './client';
import { formatEther, parseEther, parseUnits, formatUnits } from 'viem';
import {
  EIGENVAULT_ABI,
  EIGENVAULT_ADDRESS,
  eigenIdToBytes32,
  getChainConfig,
  DEFAULT_CHAIN_ID,
  PROTOCOL_FEE_BPS,
} from '@eigenswarm/shared';
import { insertProtocolFee } from './db';

const VAULT_ADDRESS = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;

// USDC/WETH V3 pool fee tier (500 = 0.05%, most liquid on Base)
const USDC_WETH_FEE = 500;
const USDC_DECIMALS = 6;

// ── Minimal ABIs ────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const WETH_ABI = [
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const V3_EXACT_INPUT_SINGLE_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const;

// ── Treasury State ──────────────────────────────────────────────────────

interface TreasuryState {
  ethBalance: bigint;
  usdcBalance: bigint;
  usdcSwapped: number;
  eigensFunded: number;
}

let treasuryState: TreasuryState = {
  ethBalance: 0n,
  usdcBalance: 0n,
  usdcSwapped: 0,
  eigensFunded: 0,
};

export function getTreasuryState(): TreasuryState {
  return { ...treasuryState };
}

// ── Swap USDC → ETH (standalone) ─────────────────────────────────────────

/**
 * Swap keeper-held USDC into native ETH via Uniswap V3.
 *
 * Steps:
 *   1. Verify keeper has enough USDC balance
 *   2. Approve USDC to Uniswap V3 Router
 *   3. Swap USDC → WETH via exactInputSingle
 *   4. Unwrap WETH → native ETH
 *
 * Used by both swapUsdcAndFundEigen() and the /api/launch endpoint.
 */
export async function swapUsdcToEth(
  usdcAmount: number,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{ ethReceived: bigint; swapTxHash: `0x${string}` }> {
  // Test mode: skip on-chain operations
  if (process.env.X402_TEST_MODE === 'true') {
    // Simulate ~$2500/ETH price for realistic test amounts
    const simulatedEth = (usdcAmount / 2500).toFixed(18);
    console.log(`[Treasury] TEST MODE — simulating USDC→ETH swap for ${usdcAmount} USDC → ${simulatedEth} ETH`);
    return { ethReceived: parseEther(simulatedEth), swapTxHash: '0xTEST_SWAP_TX' as `0x${string}` };
  }

  const client = getPublicClient(chainId);
  const walletClient = getWalletClient(chainId);
  const keeperAddress = getKeeperAddress();
  const chain = getChainConfig(chainId);

  const usdcAddress = chain.usdc as `0x${string}`;
  const wethAddress = chain.weth;
  const v3Router = chain.uniswapV3Router as `0x${string}`;

  if (!usdcAddress) throw new Error(`No USDC address for chain ${chainId}`);
  if (!v3Router) throw new Error(`No V3 router for chain ${chainId}`);

  const usdcAmountRaw = parseUnits(usdcAmount.toString(), USDC_DECIMALS);

  // Step 1: Check USDC balance
  const usdcBalance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [keeperAddress],
  }) as bigint;

  console.log(`[Treasury] Keeper USDC balance: ${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);

  if (usdcBalance < usdcAmountRaw) {
    throw new Error(`Insufficient USDC: have ${formatUnits(usdcBalance, USDC_DECIMALS)}, need ${usdcAmount}`);
  }

  // Step 2: Approve USDC to V3 Router
  const currentAllowance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [keeperAddress, v3Router],
  }) as bigint;

  if (currentAllowance < usdcAmountRaw) {
    console.log(`[Treasury] Approving ${usdcAmount} USDC to V3 Router...`);
    const approveTx = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [v3Router, usdcAmountRaw],
    });
    const approveReceipt = await client.waitForTransactionReceipt({ hash: approveTx });
    if (approveReceipt.status !== 'success') {
      throw new Error('USDC approval to V3 Router reverted');
    }
    console.log(`[Treasury] USDC approved (tx: ${approveTx.slice(0, 10)}...)`);
  }

  // Step 3: Calculate minimum ETH output
  const minEthOut = await estimateMinEthOut(usdcAmount);

  // Step 4: Swap USDC → WETH via V3
  const wethBefore = await client.readContract({
    address: wethAddress,
    abi: WETH_ABI,
    functionName: 'balanceOf',
    args: [keeperAddress],
  }) as bigint;

  console.log(`[Treasury] Swapping ${usdcAmount} USDC → WETH (min out: ${formatEther(minEthOut)} ETH)...`);
  const swapTx = await walletClient.writeContract({
    address: v3Router,
    abi: V3_EXACT_INPUT_SINGLE_ABI,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: usdcAddress,
      tokenOut: wethAddress,
      fee: USDC_WETH_FEE,
      recipient: keeperAddress,
      amountIn: usdcAmountRaw,
      amountOutMinimum: minEthOut,
      sqrtPriceLimitX96: 0n,
    }],
  });
  const swapReceipt = await client.waitForTransactionReceipt({ hash: swapTx });

  if (swapReceipt.status !== 'success') {
    throw new Error('USDC→WETH swap reverted');
  }
  console.log(`[Treasury] Swap confirmed (tx: ${swapTx.slice(0, 10)}...)`);

  // Step 5: Unwrap only the WETH received from this swap
  const wethAfter = await client.readContract({
    address: wethAddress,
    abi: WETH_ABI,
    functionName: 'balanceOf',
    args: [keeperAddress],
  }) as bigint;

  const ethReceived = wethAfter - wethBefore;

  if (ethReceived > 0n) {
    console.log(`[Treasury] Unwrapping ${formatEther(ethReceived)} WETH → ETH (of ${formatEther(wethAfter)} total)...`);
    const unwrapTx = await walletClient.writeContract({
      address: wethAddress,
      abi: WETH_ABI,
      functionName: 'withdraw',
      args: [ethReceived],
    });
    const unwrapReceipt = await client.waitForTransactionReceipt({ hash: unwrapTx });
    if (unwrapReceipt.status !== 'success') {
      throw new Error('WETH unwrap reverted');
    }
    console.log(`[Treasury] WETH unwrapped (tx: ${unwrapTx.slice(0, 10)}...)`);
  }

  console.log(`[Treasury] Got ${formatEther(ethReceived)} ETH from ${usdcAmount} USDC`);

  // Update state
  treasuryState.usdcSwapped += usdcAmount;

  return { ethReceived, swapTxHash: swapTx };
}

// ── Swap USDC → ETH and Fund Eigen ─────────────────────────────────────

/**
 * Full pipeline: swap received USDC into ETH, then create/fund an eigen.
 *
 * After an agent pays USDC via x402, the keeper wallet holds that USDC.
 * This function converts it to ETH and deposits into the vault.
 */
export async function swapUsdcAndFundEigen(
  eigenId: string,
  usdcAmount: number,
  onBehalfOf: `0x${string}`,
  tradingFeeBps = 500n,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{
  funded: boolean;
  swapTxHash?: string;
  fundTxHash?: string;
  ethReceived?: string;
  protocolFee?: string;
  netDeposited?: string;
  error?: string;
}> {
  // Test mode: skip on-chain operations
  if (process.env.X402_TEST_MODE === 'true') {
    console.log(`[Treasury] TEST MODE — simulating USDC→ETH swap and funding ${eigenId} for ${onBehalfOf}`);
    return {
      funded: true,
      swapTxHash: '0xTEST_SWAP_TX',
      fundTxHash: '0xTEST_FUND_TX',
      ethReceived: '0.001',
    };
  }

  const client = getPublicClient(chainId);
  const walletClient = getWalletClient(chainId);
  const keeperAddress = getKeeperAddress();
  const chain = getChainConfig(chainId);
  const vaultAddress = VAULT_ADDRESS;

  try {
    // Steps 1-5: Swap USDC → ETH
    const { ethReceived, swapTxHash: swapTx } = await swapUsdcToEth(usdcAmount, chainId);

    // Step 6: Deduct protocol fee (5%)
    const protocolFee = (ethReceived * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
    const depositAmount = ethReceived - protocolFee;

    // Record protocol fee for audit trail (fee stays in keeper wallet)
    insertProtocolFee(eigenId, formatEther(protocolFee), 'buy_volume', swapTx);
    console.log(`[Treasury] Protocol fee: ${formatEther(protocolFee)} ETH (${PROTOCOL_FEE_BPS / 100}%), depositing ${formatEther(depositAmount)} ETH`);

    // Step 7: Fund eigen on vault
    const bytes32Id = eigenIdToBytes32(eigenId);

    let fundTx: `0x${string}`;
    try {
      const [, active] = await client.readContract({
        address: vaultAddress,
        abi: EIGENVAULT_ABI,
        functionName: 'getEigenInfo',
        args: [bytes32Id],
      }) as [string, boolean, bigint];

      if (active) {
        console.log(`[Treasury] Eigen ${eigenId} exists, depositing ${formatEther(depositAmount)} ETH`);
        fundTx = await walletClient.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'deposit',
          args: [bytes32Id],
          value: depositAmount,
        });
      } else {
        console.log(`[Treasury] Creating eigen ${eigenId} for ${onBehalfOf} with ${formatEther(depositAmount)} ETH`);
        fundTx = await walletClient.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'createEigenFor',
          args: [bytes32Id, tradingFeeBps, onBehalfOf],
          value: depositAmount,
        });
      }
    } catch {
      // getEigenInfo might fail if vault not deployed — try createEigenFor directly
      console.log(`[Treasury] Creating new eigen ${eigenId} for ${onBehalfOf} with ${formatEther(depositAmount)} ETH`);
      fundTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: EIGENVAULT_ABI,
        functionName: 'createEigenFor',
        args: [bytes32Id, tradingFeeBps, onBehalfOf],
        value: depositAmount,
      });
    }

    const fundReceipt = await client.waitForTransactionReceipt({ hash: fundTx });

    if (fundReceipt.status !== 'success') {
      return {
        funded: false,
        swapTxHash: swapTx,
        fundTxHash: fundTx,
        ethReceived: formatEther(ethReceived),
        error: 'Vault funding transaction reverted',
      };
    }

    // Update state
    treasuryState.eigensFunded += 1;
    treasuryState.ethBalance = await client.getBalance({ address: keeperAddress });

    console.log(`[Treasury] Eigen ${eigenId} funded: ${formatEther(depositAmount)} ETH (tx: ${fundTx.slice(0, 10)}...)`);

    return {
      funded: true,
      swapTxHash: swapTx,
      fundTxHash: fundTx,
      ethReceived: formatEther(ethReceived),
      protocolFee: formatEther(protocolFee),
      netDeposited: formatEther(depositAmount),
    };
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`[Treasury] Failed: ${msg.slice(0, 300)}`);
    // Sanitize error for callers — don't leak RPC/contract internals
    const safeError = msg.includes('Insufficient USDC') ? 'Insufficient USDC balance'
      : msg.includes('reverted') ? 'On-chain transaction reverted'
      : 'Treasury operation failed';
    return { funded: false, error: safeError };
  }
}

// ── Price Estimation ────────────────────────────────────────────────────

/**
 * Estimate minimum ETH output for a USDC amount (with slippage buffer).
 * Used as amountOutMinimum for the V3 swap.
 */
async function estimateMinEthOut(usdcAmount: number): Promise<bigint> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    );
    if (response.ok) {
      const data = await response.json();
      const ethPrice = data.ethereum?.usd;
      if (ethPrice && ethPrice > 0) {
        const ethAmount = usdcAmount / ethPrice;
        // 5% slippage tolerance for safety
        const ethWithSlippage = ethAmount * 0.95;
        return parseEther(ethWithSlippage.toFixed(8));
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: assume ETH ~$2500 with 10% buffer (conservative)
  const fallbackPrice = 2500;
  const ethAmount = (usdcAmount / fallbackPrice) * 0.90;
  return parseEther(ethAmount.toFixed(8));
}

// ── Verify ETH Payment ──────────────────────────────────────────────────

/**
 * Verify that an ETH transfer was sent to the keeper's address.
 * Returns the sender address and amount received.
 */
export async function verifyEthPayment(
  txHash: `0x${string}`,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{ valid: boolean; from: string; amount: bigint; error?: string }> {
  // Test mode: skip on-chain verification
  if (process.env.X402_TEST_MODE === 'true') {
    console.log(`[Treasury] TEST MODE — simulating ETH payment verification for ${txHash}`);
    return { valid: true, from: '0xTEST_PAYER', amount: parseEther('0.5') };
  }

  const client = getPublicClient(chainId);
  const keeperAddress = getKeeperAddress();

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Wait for receipt — the frontend sends the hash right after broadcast,
      // but the keeper's RPC node may not have seen the block yet.
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
      if (receipt.status !== 'success') {
        return { valid: false, from: '', amount: 0n, error: 'Transaction failed' };
      }

      const tx = await client.getTransaction({ hash: txHash });

      // Verify ETH was sent to keeper
      if (tx.to?.toLowerCase() !== keeperAddress.toLowerCase()) {
        return { valid: false, from: tx.from, amount: 0n, error: 'ETH not sent to keeper address' };
      }

      if (tx.value <= 0n) {
        return { valid: false, from: tx.from, amount: 0n, error: 'No ETH value in transaction' };
      }

      // Reject old transactions (>1 hour)
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const txAge = Date.now() / 1000 - Number(block.timestamp);
      if (txAge > 3600) {
        return { valid: false, from: tx.from, amount: 0n, error: 'Transaction too old (>1 hour)' };
      }

      console.log(`[Treasury] ETH payment verified: ${formatEther(tx.value)} ETH from ${tx.from}`);
      return { valid: true, from: tx.from, amount: tx.value };
    } catch (error) {
      const msg = (error as Error).message;
      console.error(`[Treasury] ETH payment verification attempt ${attempt}/${MAX_RETRIES} failed for ${txHash}:`, msg);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // backoff: 2s, 4s
        continue;
      }
      return { valid: false, from: '', amount: 0n, error: `Failed to verify ETH payment after ${MAX_RETRIES} attempts: ${msg}` };
    }
  }
  return { valid: false, from: '', amount: 0n, error: 'Failed to verify ETH payment' };
}

// ── Treasury Health Check ───────────────────────────────────────────────

export async function checkTreasuryHealth(chainId: number = DEFAULT_CHAIN_ID): Promise<{
  keeperAddress: string;
  ethBalance: string;
  usdcBalance: string;
  canFundEigens: boolean;
}> {
  const keeperAddress = getKeeperAddress();
  const client = getPublicClient(chainId);
  const chain = getChainConfig(chainId);

  const ethBalance = await client.getBalance({ address: keeperAddress });

  let usdcBalance = 0n;
  if (chain.usdc) {
    try {
      usdcBalance = await client.readContract({
        address: chain.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [keeperAddress],
      }) as bigint;
    } catch {}
  }

  treasuryState.ethBalance = ethBalance;
  treasuryState.usdcBalance = usdcBalance;

  return {
    keeperAddress,
    ethBalance: formatEther(ethBalance),
    usdcBalance: formatUnits(usdcBalance, USDC_DECIMALS),
    canFundEigens: ethBalance > parseEther('0.0005'), // Just enough for gas on Base
  };
}
