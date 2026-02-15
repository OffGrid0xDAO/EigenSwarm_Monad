import { publicClient, getWalletClient } from './client';
import { getEigensWithLP, updateLpLastCompound } from './db';
import { EIGENLP_ABI, EIGENLP_ADDRESS, eigenIdToBytes32 } from '@eigenswarm/shared';
import { compoundMonadLpFees } from './monad-lp';

const LP_ADDRESS = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;
const MIN_COMPOUND_INTERVAL_MS = 3600_000; // 1 hour minimum between compounds

export async function compoundAllFees(): Promise<void> {
  const eigens = getEigensWithLP();
  if (eigens.length === 0) return;

  const now = Date.now();

  for (const eigen of eigens) {
    // Skip if compounded recently
    if (eigen.lp_last_compound_at) {
      const lastCompound = new Date(eigen.lp_last_compound_at).getTime();
      if (now - lastCompound < MIN_COMPOUND_INTERVAL_MS) continue;
    }

    try {
      if (eigen.chain_id === 143) {
        // Monad: compound via direct V4 PositionManager interaction
        const hash = await compoundMonadLpFees(eigen.eigen_id);
        if (hash) {
          updateLpLastCompound(eigen.eigen_id);
        }
      } else {
        // Base: compound via EigenLP contract
        await compoundBaseFees(eigen.eigen_id);
      }
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('revert') || msg.includes('insufficient')) {
        console.log(`[LPCompounder] No fees to compound for ${eigen.eigen_id}`);
      } else {
        console.error(`[LPCompounder] Error compounding ${eigen.eigen_id}:`, msg);
      }
    }
  }
}

async function compoundBaseFees(eigenId: string): Promise<void> {
  const walletClient = getWalletClient();
  const account = walletClient.account;
  if (!account) return;

  const eigenIdBytes = eigenIdToBytes32(eigenId);

  // Check if auto-compound is enabled for this position
  const autoCompound = await publicClient.readContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'autoCompoundEnabled',
    args: [eigenIdBytes],
  });
  if (!autoCompound) return;

  console.log(`[LPCompounder] Compounding fees for ${eigenId}...`);

  const hash = await walletClient.writeContract({
    address: LP_ADDRESS,
    abi: EIGENLP_ABI,
    functionName: 'compoundFees',
    args: [eigenIdBytes],
    chain: walletClient.chain,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    updateLpLastCompound(eigenId);
    console.log(`[LPCompounder] Compounded ${eigenId}: ${hash}`);
  } else {
    console.warn(`[LPCompounder] Compound reverted for ${eigenId}: ${hash}`);
  }
}
