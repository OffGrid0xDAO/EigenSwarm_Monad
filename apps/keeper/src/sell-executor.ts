import { type WalletClient, parseEther, formatEther, maxUint160, maxUint48, encodeAbiParameters, parseAbiParameters } from 'viem';
import { publicClient, getKeeperAddress } from './client';
import { encodeSwap, type PoolInfo, type Permit2Data } from './swap-encoder';
import { ERC20_ABI, EIGENVAULT_ABI, EIGENVAULT_ADDRESS, WETH_ADDRESS, PERMIT2_ADDRESS, UNISWAP_V4_UNIVERSAL_ROUTER, UNISWAP_V3_SWAP_ROUTER } from '@eigenswarm/shared';

const UNISWAP_V3_SWAP_ROUTER_ADDR = UNISWAP_V3_SWAP_ROUTER as `0x${string}`;

const VAULT_ADDRESS = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;

// Keeper gas auto-funding: when sell proceeds come back, top up the keeper wallet if low
const KEEPER_LOW_GAS_THRESHOLD = parseEther('0.0003');  // Fund keeper if below this
const KEEPER_TOP_UP_AMOUNT = parseEther('0.0002');      // Standard top-up amount

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
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ── Permit2 ABI ─────────────────────────────────────────────────────────

const PERMIT2_ABI = [
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ── Permit2 EIP-712 Signature ──────────────────────────────────────────

const PERMIT2_DOMAIN = {
  name: 'Permit2',
  chainId: 143, // Monad
  verifyingContract: PERMIT2_ADDRESS as `0x${string}`,
};

const PERMIT_SINGLE_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const;

/**
 * Generate a Permit2 PermitSingle EIP-712 signature for inline use
 * in the Universal Router's PERMIT2_PERMIT command.
 *
 * This replaces the separate Permit2.approve() call with a single
 * atomic signature included in the swap transaction.
 */
async function signPermit2Single(
  tokenAddress: `0x${string}`,
  walletClient: WalletClient,
): Promise<Permit2Data> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  // Get current nonce from Permit2
  const [, , nonce] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [account.address, tokenAddress, UNISWAP_V4_UNIVERSAL_ROUTER],
  });

  const expiration = Math.floor(Date.now() / 1000) + 2592000; // 30 days
  const sigDeadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 minutes

  const permitSingleValue = {
    details: {
      token: tokenAddress,
      amount: maxUint160,
      expiration,
      nonce: Number(nonce),
    },
    spender: UNISWAP_V4_UNIVERSAL_ROUTER as `0x${string}`,
    sigDeadline,
  };

  // Sign the EIP-712 typed data
  const signature = await walletClient.signTypedData({
    account,
    domain: PERMIT2_DOMAIN,
    types: PERMIT_SINGLE_TYPES,
    primaryType: 'PermitSingle',
    message: permitSingleValue,
  });

  // ABI-encode the PermitSingle struct + signature for the PERMIT2_PERMIT command
  // Layout: PermitSingle (flat struct) + bytes offset + bytes data
  const permitSingleEncoded = encodeAbiParameters(
    [
      {
        type: 'tuple', components: [
          {
            name: 'details', type: 'tuple', components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint160' },
              { name: 'expiration', type: 'uint48' },
              { name: 'nonce', type: 'uint48' },
            ]
          },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ]
      },
      { type: 'bytes' },
    ],
    [
      {
        details: {
          token: tokenAddress,
          amount: maxUint160,
          expiration,
          nonce: Number(nonce),
        },
        spender: UNISWAP_V4_UNIVERSAL_ROUTER as `0x${string}`,
        sigDeadline,
      },
      signature,
    ],
  );

  return {
    permitSingle: permitSingleEncoded,
    signature,
  };
}

// ── Token Approval ──────────────────────────────────────────────────────

export async function approveTokenIfNeeded(
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  walletClient: WalletClient,
): Promise<bigint> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, spender],
  });

  if (allowance >= amount) return 0n; // Already approved

  console.log(`[SellExecutor] Approving ${spender} to spend ${tokenAddress}...`);

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amount],
    chain: walletClient.chain,
    account: account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Token approval reverted: ${hash}`);
  }
  console.log(`[SellExecutor] Approval confirmed: ${hash}`);
  return receipt.gasUsed * receipt.effectiveGasPrice;
}

/**
 * For V4 sells via Universal Router, tokens must be approved through Permit2:
 * 1. ERC20 approve token → Permit2 (one-time infinite)
 * 2. Permit2 approve token → Universal Router (one-time infinite)
 */
export async function approveViaPermit2IfNeeded(
  tokenAddress: `0x${string}`,
  amount: bigint,
  walletClient: WalletClient,
): Promise<bigint> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  // Step 1: Approve token to Permit2 (ERC20 approval)
  let gasCost = await approveTokenIfNeeded(tokenAddress, PERMIT2_ADDRESS, amount, walletClient);

  // Step 2: Check Permit2 allowance for Universal Router
  const [allowedAmount, expiration] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [account.address, tokenAddress, UNISWAP_V4_UNIVERSAL_ROUTER],
  });

  if (allowedAmount >= amount && expiration > Math.floor(Date.now() / 1000)) return gasCost;

  console.log(`[SellExecutor] Setting Permit2 allowance for Universal Router on ${tokenAddress}...`);

  const hash = await walletClient.writeContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'approve',
    args: [tokenAddress, UNISWAP_V4_UNIVERSAL_ROUTER, maxUint160, Number(maxUint48)],
    chain: walletClient.chain,
    account: account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Permit2 approval reverted: ${hash}`);
  }
  console.log(`[SellExecutor] Permit2 allowance set: ${hash}`);
  return gasCost + receipt.gasUsed * receipt.effectiveGasPrice;
}

// ── Get Token Balance ───────────────────────────────────────────────────

export async function getTokenBalance(
  tokenAddress: `0x${string}`,
  walletAddress: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
}

// ── WETH Unwrap ─────────────────────────────────────────────────────────

async function unwrapWethIfNeeded(walletClient: WalletClient): Promise<{ amount: bigint; gasCost: bigint }> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  const wethBalance = await publicClient.readContract({
    address: WETH_ADDRESS as `0x${string}`,
    abi: WETH_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (wethBalance <= 0n) return { amount: 0n, gasCost: 0n };

  console.log(`[SellExecutor] Unwrapping ${formatEther(wethBalance)} WETH → ETH...`);

  const hash = await walletClient.writeContract({
    address: WETH_ADDRESS as `0x${string}`,
    abi: WETH_ABI,
    functionName: 'withdraw',
    args: [wethBalance],
    chain: walletClient.chain,
    account: account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[SellExecutor] WETH unwrapped: ${hash}`);
  return { amount: wethBalance, gasCost: receipt.gasUsed * receipt.effectiveGasPrice };
}

// ── Return ETH to Vault ─────────────────────────────────────────────────

async function returnEthToVault(
  eigenId: `0x${string}`,
  ethAmount: bigint,
  walletClient: WalletClient,
): Promise<{ hash: string; gasCost: bigint }> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi: EIGENVAULT_ABI,
    functionName: 'returnEth',
    args: [eigenId],
    value: ethAmount,
    chain: walletClient.chain,
    account: account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, gasCost: receipt.gasUsed * receipt.effectiveGasPrice };
}

// ── Keeper Gas Auto-Funding ────────────────────────────────────────────

/**
 * Check keeper wallet gas balance and fund from sub-wallet sell proceeds if low.
 * This is the PRIMARY mechanism to keep the keeper funded — it runs after every sell.
 * Keeper funding is prioritized over returnEth because a dead keeper = no more trades.
 */
async function fundKeeperFromProceeds(subWalletClient: WalletClient): Promise<bigint> {
  const keeperAddress = getKeeperAddress();
  const subAccount = subWalletClient.account;
  if (!subAccount) return 0n;

  // Don't fund self
  if (subAccount.address.toLowerCase() === keeperAddress.toLowerCase()) return 0n;

  try {
    const keeperBalance = await publicClient.getBalance({ address: keeperAddress });

    if (keeperBalance >= KEEPER_LOW_GAS_THRESHOLD) return 0n;

    const subBalance = await publicClient.getBalance({ address: subAccount.address });
    // Simple ETH transfer on Base costs ~0.00005 ETH
    const TRANSFER_GAS = parseEther('0.00005');

    // Calculate how much to send — scale based on how low the keeper is
    let sendAmount: bigint;
    if (keeperBalance < parseEther('0.0001')) {
      // Keeper critically low — send as much as possible (keeper health > vault return)
      sendAmount = subBalance > TRANSFER_GAS ? subBalance - TRANSFER_GAS : 0n;
    } else {
      // Keeper just below threshold — send standard top-up if we can afford it
      const GAS_RESERVE = parseEther('0.0002'); // Reserve for returnEth + transfer
      sendAmount = subBalance > GAS_RESERVE + KEEPER_TOP_UP_AMOUNT
        ? KEEPER_TOP_UP_AMOUNT
        : subBalance > TRANSFER_GAS + parseEther('0.0001')
          ? subBalance - TRANSFER_GAS - parseEther('0.0001') // Send what we can, keep minimal reserve
          : 0n;
    }

    if (sendAmount <= 0n) {
      console.warn(`[SellExecutor] Keeper gas low (${formatEther(keeperBalance)} ETH) but sub-wallet has insufficient funds to top up`);
      return 0n;
    }

    console.log(`[SellExecutor] Keeper gas low (${formatEther(keeperBalance)} ETH) — topping up with ${formatEther(sendAmount)} ETH from sell proceeds`);

    const hash = await subWalletClient.sendTransaction({
      to: keeperAddress,
      value: sendAmount,
      chain: subWalletClient.chain,
      account: subAccount,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[SellExecutor] Keeper funded: ${hash}`);
    return receipt.gasUsed * receipt.effectiveGasPrice;
  } catch (error) {
    console.warn(`[SellExecutor] Failed to auto-fund keeper:`, (error as Error).message);
    // Non-fatal — continue with the sell
    return 0n;
  }
}

// ── Keeper Emergency Funding from Sub-Wallets ───────────────────────────

/**
 * When the keeper is critically low on gas, sweep ETH from sub-wallets
 * directly to the keeper (simple transfer, cheaper than returnEth contract call).
 * This breaks the gas death spiral where the keeper can't fund sub-wallets
 * and sub-wallets can't return ETH to vault.
 */
export async function fundKeeperFromSubWallet(
  walletClient: WalletClient,
): Promise<bigint> {
  const account = walletClient.account;
  if (!account) return 0n;

  const keeperAddress = getKeeperAddress();
  if (account.address.toLowerCase() === keeperAddress.toLowerCase()) return 0n;

  const balance = await publicClient.getBalance({ address: account.address });
  // Simple ETH transfer on Base: 21k gas + L1 data fee ≈ 0.00005 ETH
  const TRANSFER_COST = parseEther('0.00005');

  if (balance <= TRANSFER_COST) return 0n;

  const sendAmount = balance - TRANSFER_COST;

  try {
    const hash = await walletClient.sendTransaction({
      to: keeperAddress,
      value: sendAmount,
      chain: walletClient.chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[SellExecutor] Emergency: sent ${formatEther(sendAmount)} ETH from ${account.address.slice(0, 10)} to keeper`);
    return sendAmount;
  } catch (error) {
    console.warn(`[SellExecutor] Emergency keeper funding failed from ${account.address.slice(0, 10)}: ${(error as Error).message}`);
    return 0n;
  }
}

// ── Gas Estimation for returnEth ─────────────────────────────────────────

// Fixed gas reserve for returnEth contract call on Base.
// Base L2 gas is cheap (~0.01 gwei). Total tx cost = L2 gas + L1 blob data fee ≈ 0.00005-0.0001 ETH.
// Using a fixed value avoids 2 extra RPC calls (estimateGas + getGasPrice) per sell.
const RETURN_ETH_GAS_RESERVE = parseEther('0.0001');

// ── Execute Sell ────────────────────────────────────────────────────────

export interface SellResult {
  txHash: string;
  ethReceived: bigint;
  returnTxHash: string;
  totalGasCost: bigint;
}

/**
 * Execute a sell: approve token, swap token→WETH, unwrap WETH, return ETH to vault.
 *
 * Flow:
 * 1. Approve router to spend tokens
 * 2. Execute swap (token → WETH via V3/V4)
 * 3. Unwrap WETH → native ETH (V3 outputs WETH, V4 handles unwrap internally)
 * 4. Call EigenVault.returnEth() to credit ETH back
 */
export async function executeSell(
  eigenId: string,
  tokenAddress: `0x${string}`,
  tokenAmount: bigint,
  pool: PoolInfo,
  walletClient: WalletClient,
  minEthOut?: bigint,
): Promise<SellResult> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  // 1. Prepare approvals and encode the sell swap
  console.log(`[SellExecutor] Encoding ${pool.version} sell: token=${tokenAddress.slice(0, 10)} amount=${formatEther(tokenAmount)} minOut=${minEthOut ? formatEther(minEthOut) : 'none'} pool.hooks=${pool.hooks?.slice(0, 10) || 'none'} isWETH=${pool.isWETHPair}`);

  let totalGasCost = 0n;
  let permit2Data: Permit2Data | undefined;

  if (pool.version === 'v4') {
    // V4 sells: ERC20 approve to Permit2 + inline Permit2 signature
    // Step 1: ERC20 approve token → Permit2 (one-time, if not already done)
    totalGasCost += await approveTokenIfNeeded(tokenAddress, PERMIT2_ADDRESS, tokenAmount, walletClient);
    // Step 2: Generate Permit2 EIP-712 signature (included inline in the swap tx)
    console.log(`[SellExecutor] Signing Permit2 permit for V4 sell...`);
    permit2Data = await signPermit2Single(tokenAddress, walletClient);
    console.log(`[SellExecutor] Permit2 signature generated`);
  } else {
    // V3 sells: direct router approval
    totalGasCost += await approveTokenIfNeeded(tokenAddress, UNISWAP_V3_SWAP_ROUTER_ADDR, tokenAmount, walletClient);
  }

  const { router, calldata } = encodeSwap({
    direction: 'sell',
    tokenAddress,
    amount: tokenAmount,
    pool,
    recipient: account.address,
    minAmountOut: minEthOut,
    permit2Data,
  });

  console.log(`[SellExecutor] Router: ${router} calldata length: ${calldata.length}`);

  // 2. Execute the sell swap
  // Capture balance before swap to calculate actual sell proceeds later
  const preSwapBalance = await publicClient.getBalance({ address: account.address });

  console.log(`[SellExecutor] Sending sell tx from ${account.address.slice(0, 10)}...`);
  const txHash = await walletClient.sendTransaction({
    to: router,
    data: calldata,
    chain: walletClient.chain,
    account: account,
  });

  console.log(`[SellExecutor] Sell tx sent: ${txHash} — waiting for receipt...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`[SellExecutor] Sell tx status: ${receipt.status} gas: ${receipt.gasUsed}`);
  totalGasCost += receipt.gasUsed * receipt.effectiveGasPrice;

  if (receipt.status === 'reverted') {
    throw new Error(`Sell tx reverted on-chain: ${txHash}. Pool: ${pool.version} hooks=${pool.hooks || 'none'} isWETH=${pool.isWETHPair}. Check tx on basescan.`);
  }

  // 4. Unwrap any WETH received (V3 sells output WETH, not native ETH)
  const unwrapResult = await unwrapWethIfNeeded(walletClient);
  const wethUnwrapped = unwrapResult.amount;
  totalGasCost += unwrapResult.gasCost;

  // 5. Calculate actual sell proceeds BEFORE keeper funding/returnEth
  // For V3 and V4-WETH: proceeds = WETH unwrapped (exact)
  // For V4-native: proceeds ≈ balance increase (slightly undercounted by gas)
  let ethReceived: bigint;
  if (wethUnwrapped > 0n) {
    ethReceived = wethUnwrapped;
  } else {
    const postSwapBalance = await publicClient.getBalance({ address: account.address });
    ethReceived = postSwapBalance > preSwapBalance ? postSwapBalance - preSwapBalance : 0n;
  }
  console.log(`[SellExecutor] Sell proceeds: ${formatEther(ethReceived)} ETH (weth=${formatEther(wethUnwrapped)})`);

  // 6. Auto-fund keeper wallet from sell proceeds if keeper gas is low
  totalGasCost += await fundKeeperFromProceeds(walletClient);

  // 7. Calculate how much ETH to return (all balance minus estimated gas for returnEth)
  // On Base (OP Stack), the L1 data fee dominates tx cost (~0.001 ETH per call).
  // We estimate dynamically and fall back to a generous static reserve.
  const ethBalance = await publicClient.getBalance({ address: account.address });
  const gasReserve = RETURN_ETH_GAS_RESERVE;
  const returnAmount = ethBalance > gasReserve ? ethBalance - gasReserve : 0n;

  if (returnAmount <= 0n) {
    console.warn(`[SellExecutor] Sell proceeds too small to return (${formatEther(ethBalance)} ETH < ${formatEther(gasReserve)} gas reserve). ETH will accumulate in wallet for later recovery.`);
    return { txHash, ethReceived, returnTxHash: 'pending-recovery', totalGasCost };
  }

  console.log(`[SellExecutor] Sold tokens, returning ${formatEther(returnAmount)} ETH to vault...`);

  // 7. Return ETH to the vault
  try {
    const returnResult = await returnEthToVault(
      eigenId as `0x${string}`,
      returnAmount,
      walletClient,
    );
    totalGasCost += returnResult.gasCost;

    console.log(`[SellExecutor] ETH returned to vault: ${returnResult.hash}`);
    return { txHash, ethReceived, returnTxHash: returnResult.hash, totalGasCost };
  } catch (error) {
    // If returnEth fails (e.g., gas spike), the sell still succeeded on-chain.
    // Log the error but don't propagate — ETH will be recovered later.
    console.warn(`[SellExecutor] returnEth failed after successful swap (${formatEther(returnAmount)} ETH stranded in wallet): ${(error as Error).message}`);
    return { txHash, ethReceived, returnTxHash: 'pending-recovery', totalGasCost };
  }
}

// ── Recover stranded WETH ───────────────────────────────────────────────

/**
 * Recover any WETH stuck in a sub-wallet from previous V3 sells.
 * Unwraps WETH → ETH and returns it to the vault.
 */
export async function recoverWeth(
  eigenId: string,
  walletClient: WalletClient,
): Promise<bigint> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  const unwrapResult = await unwrapWethIfNeeded(walletClient);
  if (unwrapResult.amount <= 0n) return 0n;

  // Auto-fund keeper from recovered WETH if needed
  await fundKeeperFromProceeds(walletClient);

  const ethBalance = await publicClient.getBalance({ address: account.address });
  const gasReserve = RETURN_ETH_GAS_RESERVE;
  const returnAmount = ethBalance > gasReserve ? ethBalance - gasReserve : 0n;

  if (returnAmount <= 0n) return 0n;

  try {
    await returnEthToVault(eigenId as `0x${string}`, returnAmount, walletClient);
    console.log(`[SellExecutor] Recovered ${formatEther(returnAmount)} ETH from stranded WETH`);
    return returnAmount;
  } catch (error) {
    console.warn(`[SellExecutor] WETH recovery returnEth failed: ${(error as Error).message}`);
    return 0n;
  }
}

/**
 * Recover stranded native ETH from a sub-wallet.
 * After sells where returnEth failed, ETH accumulates in wallets.
 *
 * Strategy:
 * 1. Try returnEthToVault (sends ETH back to vault on-chain)
 * 2. If balance is too small for returnEth gas (~0.001 ETH contract call),
 *    fall back to a simple ETH transfer to keeper (~0.0003 gas).
 *    This consolidates dust from multiple wallets into the keeper.
 */
export async function recoverStrandedEth(
  eigenId: string,
  walletClient: WalletClient,
): Promise<bigint> {
  const account = walletClient.account;
  if (!account) throw new Error('Wallet client has no account');

  const ethBalance = await publicClient.getBalance({ address: account.address });
  const gasReserve = RETURN_ETH_GAS_RESERVE;
  const returnAmount = ethBalance > gasReserve ? ethBalance - gasReserve : 0n;

  if (returnAmount > 0n) {
    // Enough for a returnEth contract call
    try {
      const returnResult = await returnEthToVault(eigenId as `0x${string}`, returnAmount, walletClient);
      console.log(`[SellExecutor] Recovered ${formatEther(returnAmount)} stranded ETH from wallet ${account.address.slice(0, 10)}`);
      return returnAmount;
    } catch (error) {
      console.warn(`[SellExecutor] Stranded ETH recovery via returnEth failed: ${(error as Error).message}`);
      // Fall through to simple transfer below
    }
  }

  // Balance too small for returnEth — try simple transfer to keeper instead.
  // A simple ETH transfer costs ~0.00005 ETH on Base.
  const SIMPLE_TRANSFER_COST = parseEther('0.00005');
  if (ethBalance > SIMPLE_TRANSFER_COST + parseEther('0.00002')) {
    const sendAmount = ethBalance - SIMPLE_TRANSFER_COST;
    try {
      const keeperAddress = getKeeperAddress();
      if (account.address.toLowerCase() === keeperAddress.toLowerCase()) return 0n;

      const hash = await walletClient.sendTransaction({
        to: keeperAddress,
        value: sendAmount,
        chain: walletClient.chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[SellExecutor] Recovered ${formatEther(sendAmount)} stranded ETH from ${account.address.slice(0, 10)} to keeper (simple transfer)`);
      return sendAmount;
    } catch (error) {
      console.warn(`[SellExecutor] Stranded ETH simple transfer failed: ${(error as Error).message}`);
    }
  }

  return 0n;
}
