import { index, onchainEnum, onchainTable, relations } from 'ponder';

// ── Enums ────────────────────────────────────────────────────────────────

export const eigenStatus = onchainEnum('eigen_status', [
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
]);

// ── Tables ───────────────────────────────────────────────────────────────

export const eigen = onchainTable(
  'eigen',
  (t) => ({
    id: t.hex().primaryKey(),               // bytes32 eigenId
    owner: t.hex().notNull(),               // address (resolved from agentId NFT if applicable)
    agentId: t.bigint(),                    // ERC-8004 agent NFT token ID (if created via agent)
    status: eigenStatus().notNull(),
    balance: t.bigint().notNull(),          // current ETH balance in wei
    totalDeposited: t.bigint().notNull(),   // lifetime deposits
    totalWithdrawn: t.bigint().notNull(),   // lifetime withdrawals
    totalTraded: t.bigint().notNull(),      // lifetime ETH spent on trades
    totalFees: t.bigint().notNull(),        // lifetime fees collected (trading + deploy)
    feeRateBps: t.integer().notNull(),      // trading fee rate in bps
    feeOwed: t.bigint().notNull(),          // accrued but unsettled trading fees
    tradeCount: t.integer().notNull(),
    createdAt: t.integer().notNull(),       // block timestamp
    createdBlock: t.bigint().notNull(),
    createdTxHash: t.hex().notNull(),
  }),
  (table) => ({
    statusIdx: index('eigen_status_idx').on(table.status),
    ownerIdx: index('eigen_owner_idx').on(table.owner),
    agentIdx: index('eigen_agent_idx').on(table.agentId),
  }),
);

export const deposit = onchainTable(
  'deposit',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    user: t.hex().notNull(),
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('deposit_eigen_idx').on(table.eigenId),
  }),
);

export const withdrawal = onchainTable(
  'withdrawal',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    user: t.hex().notNull(),
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('withdrawal_eigen_idx').on(table.eigenId),
  }),
);

export const tradeEvent = onchainTable(
  'trade_event',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    ethSpent: t.bigint().notNull(),
    router: t.hex().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('trade_eigen_idx').on(table.eigenId),
    timestampIdx: index('trade_timestamp_idx').on(table.timestamp),
    eigenTimestampIdx: index('trade_eigen_ts_idx').on(table.eigenId, table.timestamp),
  }),
);

export const feeCollection = onchainTable(
  'fee_collection',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('fee_eigen_idx').on(table.eigenId),
  }),
);

export const deployFee = onchainTable(
  'deploy_fee',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('deploy_fee_eigen_idx').on(table.eigenId),
  }),
);

export const routerApproval = onchainTable(
  'router_approval',
  (t) => ({
    id: t.text().primaryKey(),
    router: t.hex().notNull(),
    approved: t.boolean().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    routerIdx: index('router_approval_router_idx').on(table.router),
  }),
);

export const deployFeeUpdate = onchainTable('deploy_fee_update', (t) => ({
  id: t.text().primaryKey(),
  newFeeBps: t.integer().notNull(),
  block: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  timestamp: t.integer().notNull(),
}));

export const ethRescue = onchainTable('eth_rescue', (t) => ({
  id: t.text().primaryKey(),
  amount: t.bigint().notNull(),
  block: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  timestamp: t.integer().notNull(),
}));

export const keeperUpdate = onchainTable('keeper_update', (t) => ({
  id: t.text().primaryKey(),
  newKeeper: t.hex().notNull(),
  block: t.bigint().notNull(),
  txHash: t.hex().notNull(),
  timestamp: t.integer().notNull(),
}));

// ── EigenLP Tables ──────────────────────────────────────────────────────

export const lpPosition = onchainTable(
  'lp_position',
  (t) => ({
    id: t.hex().primaryKey(),               // bytes32 eigenId
    token: t.hex().notNull(),               // token address
    poolId: t.hex().notNull(),              // V4 pool ID
    tokenId: t.bigint().notNull(),          // position NFT token ID
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    tokenIdx: index('lp_position_token_idx').on(table.token),
  }),
);

export const lpFeeCollection = onchainTable(
  'lp_fee_collection',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    ethAmount: t.bigint().notNull(),
    tokenAmount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('lp_fee_eigen_idx').on(table.eigenId),
  }),
);

export const lpFeeCompound = onchainTable(
  'lp_fee_compound',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    ethCompounded: t.bigint().notNull(),
    tokenCompounded: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('lp_compound_eigen_idx').on(table.eigenId),
  }),
);

export const lpLiquidityRemoval = onchainTable(
  'lp_liquidity_removal',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    ethAmount: t.bigint().notNull(),
    tokenAmount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('lp_removal_eigen_idx').on(table.eigenId),
  }),
);

export const balanceMigration = onchainTable(
  'balance_migration',
  (t) => ({
    id: t.text().primaryKey(),
    eigenId: t.hex().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    eigenIdx: index('migration_eigen_idx').on(table.eigenId),
  }),
);

// ── Relations ────────────────────────────────────────────────────────────

export const eigenRelations = relations(eigen, ({ many }) => ({
  deposits: many(deposit),
  withdrawals: many(withdrawal),
  trades: many(tradeEvent),
  fees: many(feeCollection),
  deployFees: many(deployFee),
  migrations: many(balanceMigration),
}));

export const depositRelations = relations(deposit, ({ one }) => ({
  eigen: one(eigen, {
    fields: [deposit.eigenId],
    references: [eigen.id],
  }),
}));

export const withdrawalRelations = relations(withdrawal, ({ one }) => ({
  eigen: one(eigen, {
    fields: [withdrawal.eigenId],
    references: [eigen.id],
  }),
}));

export const tradeEventRelations = relations(tradeEvent, ({ one }) => ({
  eigen: one(eigen, {
    fields: [tradeEvent.eigenId],
    references: [eigen.id],
  }),
}));

export const feeCollectionRelations = relations(feeCollection, ({ one }) => ({
  eigen: one(eigen, {
    fields: [feeCollection.eigenId],
    references: [eigen.id],
  }),
}));

export const deployFeeRelations = relations(deployFee, ({ one }) => ({
  eigen: one(eigen, {
    fields: [deployFee.eigenId],
    references: [eigen.id],
  }),
}));

export const lpPositionRelations = relations(lpPosition, ({ many }) => ({
  feeCollections: many(lpFeeCollection),
  feeCompounds: many(lpFeeCompound),
}));

export const lpFeeCollectionRelations = relations(lpFeeCollection, ({ one }) => ({
  position: one(lpPosition, {
    fields: [lpFeeCollection.eigenId],
    references: [lpPosition.id],
  }),
}));

export const lpFeeCompoundRelations = relations(lpFeeCompound, ({ one }) => ({
  position: one(lpPosition, {
    fields: [lpFeeCompound.eigenId],
    references: [lpPosition.id],
  }),
}));

export const balanceMigrationRelations = relations(balanceMigration, ({ one }) => ({
  eigen: one(eigen, {
    fields: [balanceMigration.eigenId],
    references: [eigen.id],
  }),
}));
