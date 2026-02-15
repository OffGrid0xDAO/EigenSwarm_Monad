import { ponder } from 'ponder:registry';
import {
  eigen,
  deposit,
  withdrawal,
  tradeEvent,
  feeCollection,
  deployFee,
  routerApproval,
  deployFeeUpdate,
  ethRescue,
  keeperUpdate,
  lpPosition,
  lpFeeCollection,
  lpFeeCompound,
  lpLiquidityRemoval,
  balanceMigration,
} from 'ponder:schema';

// ═══════════════════════════════════════════════════════════════════════════
// EigenLP Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

// ── PoolSeeded ────────────────────────────────────────────────────────────

ponder.on('EigenLP:PoolSeeded', async ({ event, context }) => {
  await context.db
    .insert(lpPosition)
    .values({
      id: event.args.eigenId,
      token: event.args.token,
      poolId: event.args.poolId,
      tokenId: BigInt(event.args.tokenId),
      block: event.block.number,
      txHash: event.transaction.hash,
      timestamp: Number(event.block.timestamp),
    })
    .onConflictDoUpdate({
      token: event.args.token,
      poolId: event.args.poolId,
      tokenId: BigInt(event.args.tokenId),
    });
});

// ── FeesCollected (LP) ────────────────────────────────────────────────────

ponder.on('EigenLP:FeesCollected', async ({ event, context }) => {
  await context.db.insert(lpFeeCollection).values({
    id: event.id,
    eigenId: event.args.eigenId,
    ethAmount: event.args.ethAmount,
    tokenAmount: event.args.tokenAmount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });
});

// ── FeesCompounded (LP) ──────────────────────────────────────────────────

ponder.on('EigenLP:FeesCompounded', async ({ event, context }) => {
  await context.db.insert(lpFeeCompound).values({
    id: event.id,
    eigenId: event.args.eigenId,
    ethCompounded: event.args.ethCompounded,
    tokenCompounded: event.args.tokenCompounded,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });
});

// ── LiquidityRemoved (LP) ────────────────────────────────────────────────

ponder.on('EigenLP:LiquidityRemoved', async ({ event, context }) => {
  await context.db.insert(lpLiquidityRemoval).values({
    id: event.id,
    eigenId: event.args.eigenId,
    ethAmount: event.args.ethAmount,
    tokenAmount: event.args.tokenAmount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V2-only Event Handlers (not duplicates of V1 above)
// ═══════════════════════════════════════════════════════════════════════════

// ── EigenCreated (V2 — same schema as V1) ────────────────────────────────

ponder.on('EigenVault:EigenCreated', async ({ event, context }) => {
  await context.db
    .insert(eigen)
    .values({
      id: event.args.eigenId,
      owner: event.args.owner,
      status: 'ACTIVE',
      balance: 0n,
      totalDeposited: 0n,
      totalWithdrawn: 0n,
      totalTraded: 0n,
      totalFees: 0n,
      feeRateBps: Number(event.args.feeRateBps),
      feeOwed: 0n,
      tradeCount: 0,
      createdAt: Number(event.block.timestamp),
      createdBlock: event.block.number,
      createdTxHash: event.transaction.hash,
    })
    .onConflictDoUpdate({
      owner: event.args.owner,
      status: 'ACTIVE',
      feeRateBps: Number(event.args.feeRateBps),
      createdAt: Number(event.block.timestamp),
      createdBlock: event.block.number,
      createdTxHash: event.transaction.hash,
    });
});

// ── EigenCreatedWithAgent (V2 — links eigen to ERC-8004 agent NFT) ──────
// Uses upsert because Ponder may reorder events within a block — this
// can fire before EigenCreated/DeployFeeCollected creates the row.

ponder.on('EigenVault:EigenCreatedWithAgent', async ({ event, context }) => {
  await context.db
    .insert(eigen)
    .values({
      id: event.args.eigenId,
      owner: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      status: 'ACTIVE',
      balance: 0n,
      totalDeposited: 0n,
      totalWithdrawn: 0n,
      totalTraded: 0n,
      totalFees: 0n,
      feeRateBps: Number(event.args.feeRateBps),
      feeOwed: 0n,
      tradeCount: 0,
      agentId: event.args.agentId,
      createdAt: Number(event.block.timestamp),
      createdBlock: event.block.number,
      createdTxHash: event.transaction.hash,
    })
    .onConflictDoUpdate({
      agentId: event.args.agentId,
      feeRateBps: Number(event.args.feeRateBps),
    });
});

// ── BalanceMigrated ─────────────────────────────────────────────────────

ponder.on('EigenVault:BalanceMigrated', async ({ event, context }) => {
  await context.db.insert(balanceMigration).values({
    id: event.id,
    eigenId: event.args.eigenId,
    from: event.args.from,
    to: event.args.to,
    amount: event.args.amount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });
});

// ── Deposited ─────────────────────────────────────────────────────────────

ponder.on('EigenVault:Deposited', async ({ event, context }) => {
  await context.db.insert(deposit).values({
    id: event.id,
    eigenId: event.args.eigenId,
    user: event.args.user,
    amount: event.args.amount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });

  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      balance: row.balance + event.args.amount,
      totalDeposited: row.totalDeposited + event.args.amount,
    }));
});

// ── Withdrawn ─────────────────────────────────────────────────────────────

ponder.on('EigenVault:Withdrawn', async ({ event, context }) => {
  await context.db.insert(withdrawal).values({
    id: event.id,
    eigenId: event.args.eigenId,
    user: event.args.user,
    amount: event.args.amount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });

  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      balance: row.balance - event.args.amount,
      totalWithdrawn: row.totalWithdrawn + event.args.amount,
    }));
});

// ── TradeExecuted ─────────────────────────────────────────────────────────

ponder.on('EigenVault:TradeExecuted', async ({ event, context }) => {
  await context.db.insert(tradeEvent).values({
    id: event.id,
    eigenId: event.args.eigenId,
    ethSpent: event.args.ethSpent,
    router: event.args.router,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });

  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      balance: row.balance - event.args.ethSpent,
      totalTraded: row.totalTraded + event.args.ethSpent,
      tradeCount: row.tradeCount + 1,
    }));
});

// ── EthReturned ───────────────────────────────────────────────────────────

ponder.on('EigenVault:EthReturned', async ({ event, context }) => {
  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      balance: row.balance + event.args.amount,
    }));
});

// ── FeeAccrued ────────────────────────────────────────────────────────────

ponder.on('EigenVault:FeeAccrued', async ({ event, context }) => {
  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set({
      feeOwed: event.args.totalOwed,
    });
});

// ── FeeCollected ──────────────────────────────────────────────────────────

ponder.on('EigenVault:FeeCollected', async ({ event, context }) => {
  await context.db.insert(feeCollection).values({
    id: event.id,
    eigenId: event.args.eigenId,
    amount: event.args.amount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });

  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      totalFees: row.totalFees + event.args.amount,
      feeOwed: 0n,
    }));
});

// ── DeployFeeCollected ────────────────────────────────────────────────────

ponder.on('EigenVault:DeployFeeCollected', async ({ event, context }) => {
  await context.db.insert(deployFee).values({
    id: event.id,
    eigenId: event.args.eigenId,
    amount: event.args.amount,
    block: event.block.number,
    txHash: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });

  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set((row) => ({
      totalFees: row.totalFees + event.args.amount,
    }));
});

// ── EigenSuspended ────────────────────────────────────────────────────────

ponder.on('EigenVault:EigenSuspended', async ({ event, context }) => {
  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set({ status: 'SUSPENDED' });
});

// ── EigenResumed ──────────────────────────────────────────────────────────

ponder.on('EigenVault:EigenResumed', async ({ event, context }) => {
  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set({ status: 'ACTIVE' });
});

// ── EigenTerminated ───────────────────────────────────────────────────────

ponder.on('EigenVault:EigenTerminated', async ({ event, context }) => {
  await context.db
    .update(eigen, { id: event.args.eigenId })
    .set({
      status: 'TERMINATED',
      balance: 0n,
      feeOwed: 0n,
    });
});
