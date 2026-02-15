import 'dotenv/config';
import { getDb, getAllEigenConfigs, getEigenConfig, insertEigenConfig, updateGraduationStatus } from './db';
import { publicClient } from './client';
import { startApi } from './api';
import { executeTradeCycle, setAIConfig } from './trader';
import { checkPonderHealth } from './ponder';
import { snapshotAllPrices } from './price-oracle';
import { resolvePool } from './pool-resolver';
import { discoverEigensFromChain } from './recovery';
import { compoundAllFees } from './lp-compounder';
import { startGraduationMonitor } from './monad-trader';
import { initAIClient, type AIProvider } from './ai-evaluator';
import { initAITables } from './ai-logger';
import { postDailyReputationSignals } from './reputation-poster';

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '15000', 10);
const API_PORT = parseInt(process.env.PORT || process.env.KEEPER_API_PORT || '3001', 10);
const PRICE_SNAPSHOT_INTERVAL = parseInt(process.env.PRICE_SNAPSHOT_INTERVAL || '300000', 10); // 5 min
const LP_COMPOUND_INTERVAL = parseInt(process.env.LP_COMPOUND_INTERVAL || '3600000', 10); // 1 hour
const REPUTATION_POST_INTERVAL = parseInt(process.env.REPUTATION_POST_INTERVAL || '86400000', 10); // 24 hours

function validateStartup(): void {
  // Validate KEEPER_PRIVATE_KEY format
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) {
    throw new Error('KEEPER_PRIVATE_KEY is required');
  }
  if (!key.startsWith('0x') || key.length !== 66) {
    throw new Error(`KEEPER_PRIVATE_KEY must be 0x-prefixed and 66 chars (got ${key.length} chars, starts with "${key.slice(0, 4)}")`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('KEEPER_PRIVATE_KEY contains invalid hex characters');
  }

  // Validate required env vars
  const rpc = process.env.MONAD_RPC_URL;
  if (!rpc) {
    console.warn('[Keeper] WARNING: MONAD_RPC_URL not set — using default public RPC (rate limited)');
  }

  const ponder = process.env.PONDER_API_URL;
  if (!ponder) {
    console.warn('[Keeper] WARNING: PONDER_API_URL not set — using localhost default');
  }

  // Warn about optional but recommended env vars
  if (!process.env.ALERT_WEBHOOK_URL) {
    console.warn('[Keeper] WARNING: ALERT_WEBHOOK_URL not set — alerts will only go to stdout');
  }
}

async function main() {
  console.log('[EigenSwarm Keeper] Starting...');

  // 0. Validate environment (fail fast)
  validateStartup();

  // 1. Initialize database (off-chain config only)
  console.log('[Keeper] Initializing config database...');
  getDb();

  // 1a. Auto-seed EIGEN token config if DB is fresh (idempotent)
  if (!getEigenConfig('eigen-eigen-1771171519177')) {
    console.log('[Keeper] Seeding EIGEN token config...');
    insertEigenConfig({
      eigenId: 'eigen-eigen-1771171519177',
      tokenAddress: '0xFa00f6635D32782E0a9fCb4250C68989c5577777',
      tokenSymbol: 'EIGEN',
      tokenName: 'EigenSwarm',
      ownerAddress: '0xA7708f216B35A8cCAF7c39486ACFba4934613263',
      chainId: 143,
      volumeTarget: 5,
      tradeFrequency: 20,
      orderSizeMin: 0.05,
      orderSizeMax: 0.2,
      walletCount: 5,
      lpPoolId: '',
      lpTokenId: 0,
      lpPoolFee: 9900,
      lpPoolTickSpacing: 198,
      lpContractAddress: '0xEf8b421B15Dd0Aa59392431753029A184F3eEc54',
    });
    updateGraduationStatus('eigen-eigen-1771171519177', 'graduated');
    console.log('[Keeper] EIGEN token seeded (graduated/v4, 5 wallets)');
  }

  // 1b. Initialize AI evaluation layer
  const aiEnabled = process.env.AI_EVALUATION_ENABLED === 'true';
  const aiProvider = (process.env.AI_PROVIDER || 'gemini') as AIProvider;
  const aiApiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || '';
  const aiBaseUrl = process.env.AI_BASE_URL || '';

  // Ollama doesn't need an API key
  const needsKey = aiProvider !== 'ollama';

  if (aiEnabled && (aiApiKey || !needsKey)) {
    initAITables();
    const aiConfig = {
      enabled: true,
      provider: aiProvider,
      model: process.env.AI_MODEL || '',
      confidenceThreshold: parseInt(process.env.AI_CONFIDENCE_THRESHOLD || '70', 10),
      timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '2000', 10),
      apiKey: aiApiKey,
      apiBaseUrl: aiBaseUrl || undefined,
    };
    initAIClient(aiConfig);
    setAIConfig(aiConfig);
    console.log(`[Keeper] AI evaluation layer ENABLED (provider: ${aiProvider})`);
  } else if (aiEnabled && needsKey && !aiApiKey) {
    console.warn(`[Keeper] AI_EVALUATION_ENABLED=true but no API key set for ${aiProvider} — AI disabled`);
  }

  // 2. Verify RPC connection
  let rpcOk = false;
  try {
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`[Keeper] Connected to Monad — block #${blockNumber}`);
    rpcOk = true;
  } catch (error) {
    console.error('[Keeper] Failed to connect to Monad RPC:', (error as Error).message);
    console.log('[Keeper] Continuing in offline mode (API-only)...');
  }

  // 3. Check Ponder indexer connectivity
  const ponderOk = await checkPonderHealth();
  if (ponderOk) {
    console.log('[Keeper] Connected to Ponder indexer');
  } else {
    console.warn('[Keeper] Ponder indexer unreachable — will use on-chain fallback');
  }

  // 4. On-chain eigen discovery (runs when DB is empty or Ponder is down)
  const configs = getAllEigenConfigs();
  if (rpcOk && (configs.length === 0 || !ponderOk)) {
    console.log('[Keeper] Running on-chain eigen discovery...');
    try {
      const discovered = await discoverEigensFromChain();
      console.log(`[Keeper] On-chain discovery: ${discovered.length} eigens found`);
    } catch (error) {
      console.error('[Keeper] On-chain discovery failed:', (error as Error).message);
    }
  }

  // 5. Start HTTP API
  startApi(API_PORT);

  // 6. Start periodic price snapshot collection
  console.log(`[Keeper] Price snapshot interval: ${PRICE_SNAPSHOT_INTERVAL}ms`);
  // Take an immediate snapshot on startup
  snapshotAllPrices(resolvePool).catch(() => {});
  setInterval(async () => {
    try {
      await snapshotAllPrices(resolvePool);
    } catch (error) {
      console.error('[Keeper] Error collecting price snapshots:', (error as Error).message);
    }
  }, PRICE_SNAPSHOT_INTERVAL);

  // 6b. Start periodic LP fee compounding
  console.log(`[Keeper] LP compound interval: ${LP_COMPOUND_INTERVAL}ms`);
  compoundAllFees().catch(() => {});
  setInterval(async () => {
    try {
      await compoundAllFees();
    } catch (error) {
      console.error('[Keeper] Error compounding LP fees:', (error as Error).message);
    }
  }, LP_COMPOUND_INTERVAL);

  // 6c. Start ERC-8004 reputation posting (daily)
  if (process.env.ERC8004_ENABLED === 'true') {
    console.log(`[Keeper] ERC-8004 reputation posting interval: ${REPUTATION_POST_INTERVAL}ms`);
    postDailyReputationSignals().catch((err) => {
      console.warn('[Keeper] Initial reputation posting failed:', (err as Error).message);
    });
    setInterval(async () => {
      try {
        await postDailyReputationSignals();
      } catch (error) {
        console.error('[Keeper] Error posting reputation signals:', (error as Error).message);
      }
    }, REPUTATION_POST_INTERVAL);
  }

  // 6d. Start graduation monitor for nad.fun tokens on Monad
  try {
    startGraduationMonitor();
  } catch (error) {
    console.warn('[Keeper] Graduation monitor failed to start:', (error as Error).message);
  }

  // 7. Main trade loop
  console.log(`[Keeper] Entering main loop (poll interval: ${POLL_INTERVAL}ms)`);

  while (true) {
    try {
      await executeTradeCycle();
    } catch (error) {
      console.error('[Keeper] Error in trade cycle:', (error as Error).message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

main().catch((error) => {
  console.error('[Keeper] Fatal error:', error);
  process.exit(1);
});
