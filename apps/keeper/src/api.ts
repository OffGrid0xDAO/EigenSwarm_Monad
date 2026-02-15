import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { formatEther, parseEther, keccak256, toHex, verifyMessage } from 'viem';
import crypto from 'crypto';
import {
  getDb,
  insertEigenConfig,
  getAllEigenConfigs,
  getEigenConfig,
  getEigenConfigsByOwner,
  getTradesByEigen,
  getTradeStats,
  getTokenPositionsByEigen,
  getSubWallets,
  getPriceSnapshots,
  getAllTokenPositions,
  updateEigenConfig,
  updateEigenConfigStatus,
  updateGraduationStatus,
  isPaymentUsed,
  recordPayment,
  deletePayment,
  insertAgentApiKey,
  getAgentApiKeyByHash,
  getAgentApiKeysByOwner,
  deactivateAgentApiKey,
  touchAgentApiKey,
  getEigenConfigsByChain,
  getEigensWithout8004,
  getTradeVolumeByEigenIds,
  updateAgent8004Id,
  insertProtocolFee,
  deleteEigenConfig,
} from './db';
import { isErc8004Enabled, registerAgent, buildAgentCard, resolveAgent8004Owner } from './erc8004';
import { fetchAllEigens, fetchEigen, fetchRecentTrades, checkPonderHealth, type PonderEigen } from './ponder';
import { getPricingResponse, getPackage, buildPaymentRequirements, build402Response, build402Headers, getPaymentHeader, verifyAndSettlePayment, derivePaymentKey } from './x402';
import { getPositionSummary } from './pnl-tracker';
import { executeTakeProfit } from './trader';
import { getTokenBalance } from './sell-executor';
import { getWalletsForEigen } from './wallet-manager';
import { encryptPrivateKey } from './crypto';
import {
  upsertImportedWallet,
  deleteImportedWallets,
  updateWalletSource,
} from './db';
import { resolvePool, computeV4PoolId, ZERO_ADDRESS } from './pool-resolver';
import { getTokenPriceWithFallback } from './price-oracle';
import { publicClient, getPublicClient, getWalletClient, getKeeperAddress } from './client';
import { ERC20_ABI, EIGENVAULT_ABI, EIGENVAULT_ADDRESS, EIGENLP_ABI, EIGEN_ATOMIC_LAUNCHER_ABI, eigenIdToBytes32, getSupportedChainIds, isChainSupported, getChainConfig } from '@eigenswarm/shared';
import { getCachedOnChainEigens, discoverEigensFromChain } from './recovery';
import { swapUsdcToEth, swapUsdcAndFundEigen, checkTreasuryHealth, verifyEthPayment } from './treasury';
import { createMonadToken, restartGraduationMonitor, type CreateMonadTokenParams } from './monad-trader';
import { uploadImageToNadFun, uploadMetadataToNadFun, mineSaltFromNadFun, generatePlaceholderSvg } from './nadfun-api';
import { createMonadV4Pool, priceToSqrtPriceX96 } from './monad-lp';
import { deployBaseToken, buildClankerDeployTx } from './base-deployer';
import { readClankerPoolPrice, seedBaseLPBundled, seedBaseLPWithAgent, seedBaseLPDirect, atomicDeployAndLaunch } from './base-lp';
import {
  generateEigenId,
  CLASS_CONFIGS,
  EIGENLP_FEE,
  EIGENLP_TICK_SPACING,
  EIGENLP_ADDRESS,
  EIGENLAUNCHER_ADDRESS,
  EIGENFACTORY_ADDRESS,
  PROTOCOL_FEE_BPS,
  GAS_BUDGET_PER_WALLET,
  type AgentClass,
} from '@eigenswarm/shared';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

function applyCorsAndSecurityHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  // Allow all origins if no whitelist configured, or match against whitelist.
  // Security relies on on-chain payment verification, not origin checking.
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT, X-ETH-PAYMENT, X-API-KEY');
  res.setHeader('Vary', 'Origin');

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function json(res: ServerResponse, data: unknown, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 65536; // 64KB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const SIGNATURE_MAX_AGE_SECONDS = 300; // 5 minutes

async function verifyEip191(message: string, signature: string, expectedAddress: string): Promise<boolean> {
  return verifyMessage({
    address: expectedAddress as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
}

function buildRegisterMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Register\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildLiquidateMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Liquidate\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildAdjustMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Adjust\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildTakeProfitMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm TakeProfit\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildFundMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Fund\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildDeleteMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Delete\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildTerminateApiMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Terminate\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function buildWithdrawMessage(eigenId: string, owner: string, timestamp: number): string {
  return `EigenSwarm Withdraw\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${timestamp}`;
}

function isTimestampValid(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  // Only accept timestamps in the past (with a small 5s clock-skew allowance)
  // Must be within SIGNATURE_MAX_AGE_SECONDS of current time
  return timestamp <= now + 5 && now - timestamp <= SIGNATURE_MAX_AGE_SECONDS;
}

/**
 * Verify eigen ownership: DB config → ponder indexer → on-chain vault fallback.
 * Returns true if callerAddress matches any of the three ownership sources.
 */
async function verifyEigenOwnership(eigenId: string, callerAddress: string, configOwnerAddress: string, chainId?: number): Promise<boolean> {
  // 1. Check DB config owner
  if (configOwnerAddress.toLowerCase() === callerAddress.toLowerCase()) return true;

  // 2. Check ponder indexer
  const bytes32Id = eigenIdToBytes32(eigenId);
  const ponderEigen = await fetchEigen(bytes32Id).catch(() => null);
  if (ponderEigen?.owner?.toLowerCase() === callerAddress.toLowerCase()) return true;

  // 3. On-chain vault fallback — read getEigenOwner directly from the contract
  try {
    const client = getPublicClient(chainId);
    const vaultAddress = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
    const onChainOwner = await client.readContract({
      address: vaultAddress,
      abi: EIGENVAULT_ABI,
      functionName: 'getEigenOwner',
      args: [bytes32Id],
    }) as `0x${string}`;
    if (onChainOwner && onChainOwner.toLowerCase() === callerAddress.toLowerCase()) return true;
  } catch (e) {
    console.warn(`[API] On-chain ownership check failed for ${eigenId}:`, (e as Error).message);
  }

  return false;
}

// ── Rate Limiter ────────────────────────────────────────────────────────

interface RateLimitEntry { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateLimitEntry>();
const postRateLimitMap = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests/min for all endpoints
const POST_RATE_LIMIT_MAX = 10; // 10 requests/min for POST endpoints

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  for (const [key, entry] of postRateLimitMap) {
    if (now > entry.resetAt) postRateLimitMap.delete(key);
  }
}, 5 * 60_000);

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string, isPost: boolean): boolean {
  const now = Date.now();

  // General rate limit
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;

  // POST-specific rate limit
  if (isPost) {
    let postEntry = postRateLimitMap.get(ip);
    if (!postEntry || now > postEntry.resetAt) {
      postEntry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      postRateLimitMap.set(ip, postEntry);
    }
    postEntry.count++;
    if (postEntry.count > POST_RATE_LIMIT_MAX) return false;
  }

  return true;
}

// ── Eigen ID Resolution ─────────────────────────────────────────────────
// The frontend may pass either the short "ES-xxxx" form or the on-chain
// bytes32 hash. This helper resolves either form to the short config ID.

// Cache for bytes32 → ES-xxx resolution (avoids full table scan per request)
const eigenIdHashCache = new Map<string, string>();
let eigenIdCacheBuiltAt = 0;
const EIGEN_ID_CACHE_TTL = 60_000; // 1 minute

function resolveEigenId(rawId: string): string {
  // Validate format: must be ES-xxx or 0x + 64 hex (bytes32)
  if (EIGEN_ID_RE.test(rawId)) return rawId;

  if (BYTES32_RE.test(rawId)) {
    // Rebuild cache if stale
    const now = Date.now();
    if (now - eigenIdCacheBuiltAt > EIGEN_ID_CACHE_TTL) {
      eigenIdHashCache.clear();
      const configs = getAllEigenConfigs();
      for (const c of configs) {
        eigenIdHashCache.set(eigenIdToBytes32(c.eigen_id), c.eigen_id);
      }
      eigenIdCacheBuiltAt = now;
    }
    return eigenIdHashCache.get(rawId) || rawId;
  }

  // Invalid format — return as-is (will 404 downstream)
  return rawId;
}

// ── Eigen Owner Resolution (Phase 3: NFT-based ownership) ───────────────
// If the eigen has an 8004 agent ID, resolves the current NFT holder as owner.
// Otherwise falls back to the stored owner_address in the database.

async function resolveEigenOwner(eigenId: string): Promise<string> {
  const config = getEigenConfig(eigenId);
  if (!config) return '';

  // If eigen has an 8004 agent ID, resolve via NFT ownership
  if (config.agent_8004_id) {
    try {
      const nftOwner = await resolveAgent8004Owner(
        config.agent_8004_id,
        config.agent_8004_chain_id || 8453,
      );
      if (nftOwner) return nftOwner;
    } catch {
      // Fall through to DB owner
    }
  }

  return config.owner_address || '';
}

// ── Input Validation ────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EIGEN_ID_RE = /^ES-[a-f0-9]{12}$/;              // Short form: ES-xxxxxxxxxxxx
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/;             // On-chain hash form

// ── API Key Authentication ────────────────────────────────────────────

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  return `esk_${crypto.randomBytes(32).toString('hex')}`;
}

// Per-API-key rate limiter (in-memory, resets on restart)
const apiKeyRateMap = new Map<string, RateLimitEntry>();

// Cleanup stale API key rate entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiKeyRateMap) {
    if (now > entry.resetAt) apiKeyRateMap.delete(key);
  }
}, 5 * 60_000);

function checkApiKeyRateLimit(keyHash: string, limit: number): boolean {
  const now = Date.now();
  let entry = apiKeyRateMap.get(keyHash);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    apiKeyRateMap.set(keyHash, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

interface AuthResult {
  authenticated: boolean;
  ownerAddress?: string;
  authMethod?: 'eip191' | 'apikey';
  error?: string;
}

/**
 * Dual auth: accepts either EIP-191 signature or X-API-KEY header.
 * For EIP-191: requires ownerAddress, signature, timestamp in body.
 * For API key: requires X-API-KEY header, no body auth fields needed.
 */
async function authenticateRequest(
  req: IncomingMessage,
  body?: Record<string, unknown>,
  messageBuilder?: (owner: string, timestamp: number) => string,
): Promise<AuthResult> {
  // Check API key first
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return { authenticated: false, error: 'Invalid API key' };
    }
    // Enforce per-key rate limit (stored in DB, default 60/min)
    if (!checkApiKeyRateLimit(keyHash, keyRecord.rate_limit)) {
      return { authenticated: false, error: 'Rate limit exceeded for this API key' };
    }
    touchAgentApiKey(keyHash);
    return {
      authenticated: true,
      ownerAddress: keyRecord.owner_address,
      authMethod: 'apikey',
    };
  }

  // Fall back to EIP-191
  if (!body) {
    return { authenticated: false, error: 'Authentication required (X-API-KEY header or EIP-191 signature)' };
  }

  const ownerAddress = body.ownerAddress as string;
  const signature = body.signature as string;
  const timestamp = body.timestamp as number;

  if (!ownerAddress || !signature || !timestamp) {
    return { authenticated: false, error: 'ownerAddress, signature and timestamp required (or use X-API-KEY header)' };
  }

  if (!isTimestampValid(timestamp)) {
    return { authenticated: false, error: 'Signature expired or invalid timestamp' };
  }

  if (!messageBuilder) {
    return { authenticated: false, error: 'Internal: no message builder provided' };
  }

  const message = messageBuilder(ownerAddress, timestamp);
  const valid = await verifyEip191(message, signature, ownerAddress);
  if (!valid) {
    return { authenticated: false, error: 'Invalid signature' };
  }

  return {
    authenticated: true,
    ownerAddress,
    authMethod: 'eip191',
  };
}

function validateEigenConfigInput(data: Record<string, unknown>): string | null {
  // Address validation
  if (data.tokenAddress !== undefined && (typeof data.tokenAddress !== 'string' || !ADDRESS_RE.test(data.tokenAddress))) {
    return 'Invalid tokenAddress format (expected 0x + 40 hex chars)';
  }
  if (data.ownerAddress !== undefined && (typeof data.ownerAddress !== 'string' || !ADDRESS_RE.test(data.ownerAddress))) {
    return 'Invalid ownerAddress format (expected 0x + 40 hex chars)';
  }

  // Numeric range checks
  const numChecks: [string, number, number][] = [
    ['volumeTarget', 0.1, 200],
    ['tradeFrequency', 1, 200],
    ['orderSizeMin', 0.001, 1],
    ['orderSizeMax', 0.001, 5],
    ['orderSizePctMin', 1, 50],
    ['orderSizePctMax', 5, 80],
    ['spreadWidth', 0.1, 10],
    ['profitTarget', 5, 1000],
    ['stopLoss', 5, 95],
    ['rebalanceThreshold', 0.1, 0.95],
    ['walletCount', 1, 100],
    ['reactiveSellMode', 0, 1],
    ['reactiveSellPct', 1, 200],
  ];

  for (const [field, min, max] of numChecks) {
    const val = data[field];
    if (val !== undefined) {
      if (typeof val !== 'number' || !isFinite(val) || val < min || val > max) {
        return `${field} must be a number between ${min} and ${max}`;
      }
    }
  }

  // Custom prompt validation (string, max 2000 chars)
  if (data.customPrompt !== undefined) {
    if (data.customPrompt !== null && data.customPrompt !== '') {
      if (typeof data.customPrompt !== 'string') {
        return 'customPrompt must be a string';
      }
      if (data.customPrompt.length > 2000) {
        return 'customPrompt must be 2000 characters or less';
      }
    }
  }

  // Cross-field validation
  if (data.orderSizeMin !== undefined && data.orderSizeMax !== undefined) {
    if ((data.orderSizeMax as number) < (data.orderSizeMin as number)) {
      return 'orderSizeMax must be >= orderSizeMin';
    }
  }

  return null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const path = url.pathname;

  // Apply CORS and security headers to all responses
  applyCorsAndSecurityHeaders(req, res);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp, method === 'POST' || method === 'PATCH' || method === 'DELETE')) {
    res.setHeader('Retry-After', '60');
    return json(res, { error: 'Too many requests' }, 429);
  }

  // GET /api/health
  if (method === 'GET' && path === '/api/health') {
    // Fast path: respond immediately with basic status, gather details with 3s timeout
    let ponderOk = false;
    let gasStatus: { keeperAddress: string; keeperBalance: string; needsFunding: boolean } | null = null;
    try {
      const details = await Promise.race([
        (async () => {
          const pOk = await checkPonderHealth();
          let gas: { keeperAddress: string; keeperBalance: string; needsFunding: boolean } | null = null;
          try {
            const keeperAddr = getKeeperAddress();
            const keeperBal = await publicClient.getBalance({ address: keeperAddr });
            gas = {
              keeperAddress: keeperAddr,
              keeperBalance: keeperBal.toString(),
              needsFunding: keeperBal < 300000000000000n,
            };
          } catch { }
          return { pOk, gas };
        })(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (details) {
        ponderOk = details.pOk;
        gasStatus = details.gas;
      }
    } catch { }
    return json(res, {
      status: 'ok',
      ponder: ponderOk ? 'connected' : 'unreachable',
      gas: gasStatus,
      timestamp: new Date().toISOString(),
    });
  }

  // POST /api/eigens — receive eigen config from frontend
  if (method === 'POST' && path === '/api/eigens') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      if (!data.eigenId) {
        return json(res, { error: 'eigenId required' }, 400);
      }

      if (typeof data.eigenId !== 'string' || !/^ES-[0-9a-f]{4,12}$/.test(data.eigenId)) {
        return json(res, { error: 'Invalid eigenId format (expected ES-xxxx or ES-xxxxxxxxxxxx)' }, 400);
      }

      if (!data.ownerAddress) {
        return json(res, { error: 'ownerAddress required' }, 400);
      }

      if (!data.signature || !data.timestamp) {
        return json(res, { error: 'signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const registerMsg = buildRegisterMessage(data.eigenId, data.ownerAddress, data.timestamp);
      const registerValid = await verifyEip191(registerMsg, data.signature, data.ownerAddress);
      if (!registerValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      // Prevent overwriting existing configs
      const existing = getEigenConfig(data.eigenId);
      if (existing) {
        return json(res, { error: 'Eigen config already exists' }, 409);
      }

      // Validate input ranges and formats
      const validationError = validateEigenConfigInput(data);
      if (validationError) {
        return json(res, { error: validationError }, 400);
      }

      insertEigenConfig(data);
      console.log(`[API] Registered eigen config: ${data.eigenId}`);

      // ERC-8004: If frontend already minted the agent, store it; otherwise mint now
      const chainId = data.chainId || 143;
      if (data.agent8004Id) {
        // Frontend already minted — just store the ID
        const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
        const agentCardUri = `${baseUrl}/api/eigens/${data.eigenId}/agent-card`;
        updateAgent8004Id(data.eigenId, String(data.agent8004Id), chainId, agentCardUri);
        console.log(`[API] Stored frontend-minted ERC-8004 agent #${data.agent8004Id} for ${data.eigenId}`);
      } else {
        // No agent provided — mint one now (blocking)
        try {
          const agentId = await registerAgent(data.eigenId, chainId);
          console.log(`[API] Minted ERC-8004 agent #${agentId} for ${data.eigenId}`);
        } catch (err) {
          console.warn(`[ERC-8004] Agent mint failed for ${data.eigenId}:`, (err as Error).message);
        }
      }

      return json(res, { success: true, eigenId: data.eigenId }, 201);
    } catch (error) {
      return json(res, { error: 'Invalid JSON' }, 400);
    }
  }

  // GET /api/eigens — list all eigens (merged: Ponder on-chain + local config)
  // Supports ?owner=0x... filter
  if (method === 'GET' && path === '/api/eigens') {
    try {
      const ownerFilter = url.searchParams.get('owner')?.toLowerCase();

      // Always load all configs — the merge loop filters by owner using
      // both the config owner_address AND the Ponder on-chain owner, so
      // pre-filtering at DB level would miss configs whose on-chain owner
      // differs from the stored owner_address.
      // Race ponder fetch against a 3s timeout — don't block API if Ponder is down
      let ponderEigens = await Promise.race([
        fetchAllEigens().catch(() => [] as PonderEigen[]),
        new Promise<PonderEigen[]>((resolve) => setTimeout(() => resolve([]), 3000)),
      ]);
      const configs = getAllEigenConfigs();

      // If Ponder returned nothing, use on-chain fallback data
      if (ponderEigens.length === 0) {
        const onChain = getCachedOnChainEigens();
        if (onChain.length > 0) {
          ponderEigens = onChain;
          console.log(`[API] Using on-chain fallback: ${onChain.length} eigens`);
        } else {
          // Trigger async scan for next request
          discoverEigensFromChain().catch(() => { });
        }
      }

      // Map configs by their bytes32 hash (matching Ponder's on-chain ID format)
      const configByBytes32 = new Map(configs.map((c) => [eigenIdToBytes32(c.eigen_id), c]));
      const configByShort = new Map(configs.map((c) => [c.eigen_id, c]));
      const ponderMap = new Map(ponderEigens.map((p) => [p.id, p]));

      // Merge using config short IDs as the canonical ID,
      // matching with Ponder via bytes32 hash
      const merged = [];
      const matchedPonderIds = new Set<string>();

      // First: iterate configs and find matching Ponder data
      for (const config of configs) {
        const bytes32 = eigenIdToBytes32(config.eigen_id);
        const ponder = ponderMap.get(bytes32);
        if (ponder) matchedPonderIds.add(bytes32);
        const id = config.eigen_id;

        // If owner filter is set, only include matching eigens
        if (ownerFilter) {
          const configOwner = config?.owner_address?.toLowerCase();
          const ponderOwner = ponder?.owner?.toLowerCase();
          if (configOwner !== ownerFilter && ponderOwner !== ownerFilter) continue;
        }

        // Get trade stats for P&L data
        const stats = getTradeStats(id);
        const positions = getTokenPositionsByEigen(id);
        let totalTokenAmount = 0n;
        let totalCost = 0;
        for (const pos of positions) {
          totalTokenAmount += BigInt(pos.amount_raw);
          totalCost += pos.total_cost_eth;
        }

        // Detect config-only eigens that never got created on-chain:
        // If config says "active" but no Ponder data and no pool/LP data, it's pending_lp
        const ponderStatus = ponder?.status?.toLowerCase();
        // Ponder's TERMINATED/SUSPENDED always wins over local DB
        let resolvedStatus = (ponderStatus === 'terminated' || ponderStatus === 'suspended')
          ? ponderStatus
          : config.status || ponderStatus || 'active';
        // Eigens not tracked by Ponder (V1 vault) with no active balance → closed
        // But skip brand-new eigens (< 30 min old) that Ponder hasn't indexed yet
        if (!ponder && resolvedStatus !== 'closed' && resolvedStatus !== 'terminated') {
          const createdAt = config.created_at ? new Date(config.created_at + 'Z').getTime() : 0;
          const ageMs = Date.now() - createdAt;
          if (ageMs > 30 * 60 * 1000) {
            resolvedStatus = 'closed';
          }
        }
        // Eigens in Ponder with 0 balance that are still marked active → pending_lp or closed
        if (resolvedStatus === 'active' && ponder && BigInt(ponder.balance || '0') === 0n && !config.lp_pool_id) {
          resolvedStatus = 'pending_lp';
        }

        merged.push({
          id,
          owner: ponder?.owner || config.owner_address || '',
          status: resolvedStatus,
          balance: ponder?.balance || '0',
          totalDeposited: ponder?.totalDeposited || '0',
          totalWithdrawn: ponder?.totalWithdrawn || '0',
          totalTraded: ponder?.totalTraded || '0',
          totalFees: ponder?.totalFees || '0',
          tradeCount: ponder?.tradeCount || stats.totalBuys + stats.totalSells,
          createdAt: ponder?.createdAt || 0,
          config: config,
          pnl: {
            totalBuys: stats.totalBuys,
            totalSells: stats.totalSells,
            totalRealizedPnl: stats.totalRealizedPnl,
            winCount: stats.winCount,
            lossCount: stats.lossCount,
            winRate: (stats.winCount + stats.lossCount) > 0
              ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
              : 0,
            tokenBalance: totalTokenAmount.toString(),
            totalCostEth: totalCost,
            totalGasCost: stats.totalGasCost,
          },
        });
      }

      // Also include Ponder eigens that have no matching config
      for (const pe of ponderEigens) {
        if (matchedPonderIds.has(pe.id)) continue;
        if (ownerFilter && pe.owner.toLowerCase() !== ownerFilter) continue;
        merged.push({
          id: pe.id,
          owner: pe.owner,
          status: pe.status?.toLowerCase() || 'active',
          balance: pe.balance,
          totalDeposited: pe.totalDeposited,
          totalWithdrawn: pe.totalWithdrawn,
          totalTraded: pe.totalTraded,
          totalFees: pe.totalFees,
          tradeCount: pe.tradeCount,
          createdAt: pe.createdAt,
          config: null,
          pnl: { totalBuys: 0, totalSells: 0, totalRealizedPnl: 0, winCount: 0, lossCount: 0, winRate: 0, tokenBalance: '0', totalCostEth: 0, totalGasCost: 0 },
        });
      }

      return json(res, { data: merged });
    } catch (error) {
      // Fallback: try on-chain data, then local config
      const localConfigs = getAllEigenConfigs();
      const onChain = getCachedOnChainEigens();

      if (onChain.length > 0) {
        // Return on-chain eigens in the same merged format
        const ownerFilter = url.searchParams.get('owner')?.toLowerCase();
        const fallback = onChain
          .filter((pe) => !ownerFilter || pe.owner.toLowerCase() === ownerFilter)
          .map((pe) => ({
            id: pe.id,
            owner: pe.owner,
            status: pe.status?.toLowerCase() || 'active',
            balance: pe.balance,
            totalDeposited: pe.totalDeposited,
            totalWithdrawn: pe.totalWithdrawn,
            totalTraded: pe.totalTraded,
            totalFees: pe.totalFees,
            tradeCount: pe.tradeCount,
            createdAt: pe.createdAt,
            config: null,
            pnl: { totalBuys: 0, totalSells: 0, totalRealizedPnl: 0, winCount: 0, lossCount: 0, winRate: 0, tokenBalance: '0', totalCostEth: 0, totalGasCost: 0 },
          }));
        return json(res, { data: fallback, source: 'on-chain-fallback' });
      }

      return json(res, { data: localConfigs, source: 'local-only' });
    }
  }

  // GET /api/eigens/:id — single eigen detail
  const eigenMatch = path.match(/^\/api\/eigens\/([^/]+)$/);
  if (method === 'GET' && eigenMatch) {
    const eigenId = resolveEigenId(eigenMatch[1]!);
    const ponderQueryId = eigenIdToBytes32(eigenId);
    try {
      // Race ponder fetch against 3s timeout
      let ponderEigen = await Promise.race([
        fetchEigen(ponderQueryId).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      const config = getEigenConfig(eigenId);

      // If Ponder didn't find it, check on-chain cache
      if (!ponderEigen) {
        const onChain = getCachedOnChainEigens();
        ponderEigen = onChain.find((e) => e.id === ponderQueryId) || null;
      }

      if (!ponderEigen && !config) return json(res, { error: 'Not found' }, 404);

      const stats = getTradeStats(eigenId);
      const positions = getTokenPositionsByEigen(eigenId);
      let totalTokenAmount = 0n;
      let totalCost = 0;
      for (const pos of positions) {
        totalTokenAmount += BigInt(pos.amount_raw);
        totalCost += pos.total_cost_eth;
      }

      // Check keeper gas status (with 2s timeout to avoid blocking)
      let gasWarning: { needsFunding: boolean; keeperAddress: string; keeperBalance: string } | null = null;
      try {
        const keeperAddr = getKeeperAddress();
        const keeperBal = await Promise.race([
          publicClient.getBalance({ address: keeperAddr }),
          new Promise<bigint>((resolve) => setTimeout(() => resolve(0n), 2000)),
        ]);
        if (keeperBal > 0n && keeperBal < 300000000000000n) {
          gasWarning = {
            needsFunding: true,
            keeperAddress: keeperAddr,
            keeperBalance: keeperBal.toString(),
          };
        }
      } catch { }

      // Check vault balance — warn frontend if too low to trade
      let lowBalance: { needsDeposit: boolean; currentBalance: string; minimumBalance: string } | null = null;
      if (ponderEigen) {
        const vaultBalance = BigInt(ponderEigen.balance);
        const minTradeBalance = 100000000000000n; // 0.0001 ETH
        if (config?.status === 'active' && vaultBalance < minTradeBalance) {
          lowBalance = {
            needsDeposit: true,
            currentBalance: ponderEigen.balance,
            minimumBalance: minTradeBalance.toString(),
          };
        }
      }

      // Compute volume & trade count from local trades (more accurate than Ponder)
      const trades = getTradesByEigen(eigenId, 10000);
      let totalVolume = 0n;
      for (const t of trades) {
        totalVolume += BigInt(t.eth_amount);
      }

      return json(res, {
        data: {
          ...ponderEigen,
          // Override Ponder's totalTraded/tradeCount with local DB values
          totalTraded: totalVolume.toString(),
          tradeCount: trades.length,
          config: config || null,
          pnl: {
            ...stats,
            winRate: (stats.winCount + stats.lossCount) > 0
              ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
              : 0,
            tokenBalance: totalTokenAmount.toString(),
            totalCostEth: totalCost,
            totalGasCost: stats.totalGasCost,
          },
          gasWarning,
          lowBalance,
          // ERC-8004 identity
          agent8004Id: config?.agent_8004_id || null,
          agent8004ChainId: config?.agent_8004_chain_id || null,
          agentCardUri: config?.agent_card_uri || null,
        },
      });
    } catch (error) {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Not found' }, 404);
      return json(res, { data: { config }, source: 'local-only' });
    }
  }

  // GET /api/eigens/:id/trades — local trade history (richer than Ponder)
  const tradesMatch = path.match(/^\/api\/eigens\/([^/]+)\/trades$/);
  if (method === 'GET' && tradesMatch) {
    const eigenId = resolveEigenId(tradesMatch[1]!);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 10000);
    const trades = getTradesByEigen(eigenId, limit);
    return json(res, { data: trades });
  }

  // GET /api/eigens/:id/pnl — computed P&L summary
  const pnlMatch = path.match(/^\/api\/eigens\/([^/]+)\/pnl$/);
  if (method === 'GET' && pnlMatch) {
    const eigenId = resolveEigenId(pnlMatch[1]!);
    const config = getEigenConfig(eigenId);
    if (!config) return json(res, { error: 'Not found' }, 404);

    const stats = getTradeStats(eigenId);

    const pnlWork = async () => {
      const pool = config.token_address
        ? await resolvePool(config.token_address as `0x${string}`, eigenId).catch(() => null)
        : null;
      return getPositionSummary(eigenId, pool);
    };

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    const summary = await Promise.race([pnlWork().catch(() => null), timeout]);

    return json(res, {
      data: {
        eigenId,
        tokenAddress: config.token_address,
        position: summary,
        stats,
      },
    });
  }

  // GET /api/eigens/:id/positions — token positions with values
  const positionsMatch = path.match(/^\/api\/eigens\/([^/]+)\/positions$/);
  if (method === 'GET' && positionsMatch) {
    const eigenId = resolveEigenId(positionsMatch[1]!);
    const positions = getTokenPositionsByEigen(eigenId);
    return json(res, { data: positions });
  }

  // GET /api/eigens/:id/price-history — price snapshots for charts
  const priceHistoryMatch = path.match(/^\/api\/eigens\/([^/]+)\/price-history$/);
  if (method === 'GET' && priceHistoryMatch) {
    const eigenId = resolveEigenId(priceHistoryMatch[1]!);
    const config = getEigenConfig(eigenId);
    if (!config?.token_address) return json(res, { data: [] });

    const range = url.searchParams.get('range') || '1d';
    const rangeMs: Record<string, number> = {
      '1h': 3600_000,
      '4h': 14400_000,
      '1d': 86400_000,
      '7d': 604800_000,
      '30d': 2592000_000,
    };
    const ms = rangeMs[range] || 86400_000;
    const since = new Date(Date.now() - ms).toISOString();

    const snapshots = getPriceSnapshots(config.token_address, since, 1000);
    return json(res, { data: snapshots });
  }

  // GET /api/eigens/:id/wallets — sub-wallet addresses and stats
  const walletsMatch = path.match(/^\/api\/eigens\/([^/]+)\/wallets$/);
  if (method === 'GET' && walletsMatch) {
    const eigenId = resolveEigenId(walletsMatch[1]!);

    // Require API key authentication to view wallet details
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'X-API-KEY required to view wallet details' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }
    const config = getEigenConfig(eigenId);
    if (!config) return json(res, { error: 'Not found' }, 404);
    if (config.owner_address.toLowerCase() !== keyRecord.owner_address.toLowerCase()) {
      return json(res, { error: 'Unauthorized' }, 403);
    }
    touchAgentApiKey(keyHash);

    const wallets = getSubWallets(eigenId);
    return json(res, { data: wallets });
  }

  // GET /api/portfolio?owner=0x... — aggregated portfolio stats
  if (method === 'GET' && path === '/api/portfolio') {
    const owner = url.searchParams.get('owner')?.toLowerCase();
    if (!owner) return json(res, { error: 'owner query parameter required' }, 400);

    // Load all configs then cross-reference with Ponder on-chain owners,
    // since config.owner_address may differ from the actual on-chain owner.
    const allConfigs = getAllEigenConfigs();
    const ponderEigens = await fetchAllEigens().catch(() => []);
    const ponderOwnerMap = new Map(ponderEigens.map((p) => [p.id, p.owner.toLowerCase()]));

    const configs = allConfigs.filter((c) => {
      if (c.owner_address.toLowerCase() === owner) return true;
      const ponderOwner = ponderOwnerMap.get(eigenIdToBytes32(c.eigen_id));
      return ponderOwner === owner;
    });

    let totalRealizedPnl = 0;
    let totalUnrealizedPnl = 0;
    let totalLpFees = 0;
    let totalEthDeployed = 0;
    let activeCount = 0;

    for (const config of configs) {
      const stats = getTradeStats(config.eigen_id);
      totalRealizedPnl += stats.totalRealizedPnl;

      // Get unrealized from positions
      const positions = getTokenPositionsByEigen(config.eigen_id);
      for (const pos of positions) {
        const amount = BigInt(pos.amount_raw);
        if (amount > 0n) {
          // Estimate unrealized from stored cost vs current
          // (for accurate unrealized, would need live price, but we use snapshots)
          totalUnrealizedPnl += 0; // Will be supplemented by live price on next snapshot
        }
      }

      if (config.status === 'active') activeCount++;
    }

    // Aggregate volume via single SQL query instead of loading all trades per eigen
    const eigenIds = configs.map((c) => c.eigen_id);
    const totalVolume = getTradeVolumeByEigenIds(eigenIds);

    return json(res, {
      data: {
        owner,
        totalRealizedPnl,
        totalUnrealizedPnl,
        totalVolumeGenerated: totalVolume,
        totalLpFeesEarned: totalLpFees,
        activeEigens: activeCount,
        totalEthDeployed,
        eigenCount: configs.length,
      },
    });
  }

  // GET /api/tokens/:address/verify — on-chain token verification (auto-detects chain via DexScreener)
  const tokenVerifyMatch = path.match(/^\/api\/tokens\/(0x[a-fA-F0-9]{40})\/verify$/);
  if (method === 'GET' && tokenVerifyMatch) {
    const tokenAddress = tokenVerifyMatch[1]! as `0x${string}`;
    const chainIdParam = url.searchParams.get('chainId');

    // Fetch DexScreener for pool/price data (also auto-detects chain when not specified)
    let verifyChainId = chainIdParam ? parseInt(chainIdParam, 10) : 0;
    let dexScreenerData: { chainId: string; dexId: string; pairAddress: string; priceNative?: string; priceUsd?: string; liquidity?: number } | null = null;

    try {
      const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { signal: AbortSignal.timeout(5000) });
      if (dsRes.ok) {
        const dsData = await dsRes.json();
        const pairs = dsData.pairs || [];
        if (pairs.length > 0) {
          const chainMap: Record<string, number> = { base: 8453, ethereum: 1, arbitrum: 42161, optimism: 10, monad: 143 };
          // If chainId specified, prefer pairs on that chain; otherwise pick highest liquidity
          const targetChainName = verifyChainId
            ? Object.entries(chainMap).find(([, id]) => id === verifyChainId)?.[0]
            : null;
          const filtered = targetChainName ? pairs.filter((p: any) => p.chainId === targetChainName) : pairs;
          const sorted = (filtered.length > 0 ? filtered : pairs).sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
          const best = sorted[0];
          if (!verifyChainId) {
            verifyChainId = chainMap[best.chainId] || 143;
          }
          dexScreenerData = {
            chainId: best.chainId,
            dexId: best.dexId,
            pairAddress: best.pairAddress,
            priceNative: best.priceNative,
            priceUsd: best.priceUsd,
            liquidity: best.liquidity?.usd,
          };
        }
      }
    } catch { }

    if (!verifyChainId) verifyChainId = 143; // Final fallback to Monad
    const client = getPublicClient(verifyChainId);

    try {
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
        }).catch(() => 'Unknown'),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }).catch(() => '???'),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }).catch(() => 18),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }).catch(() => 0n),
      ]);

      // Try to resolve pool
      let pool: { version: string; address: string; fee: number } | null = null;
      let price = 0;
      let nadfun = null;

      if (verifyChainId === 143) {
        // Base: use Clanker pool resolver
        const resolved = await resolvePool(tokenAddress).catch(() => null);
        if (resolved) {
          pool = { version: resolved.version, address: resolved.poolAddress, fee: resolved.fee };
          price = await getTokenPriceWithFallback(tokenAddress, resolved).catch(() => 0);
        }
      } else if (verifyChainId === 143) {
        // Monad: check nad.fun via Lens contract
        const chain = getChainConfig(143);
        if (chain.nadfunLens) {
          try {
            const NADFUN_LENS_ABI = [
              { type: 'function', name: 'isGraduated', inputs: [{ name: '_token', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
              { type: 'function', name: 'getProgress', inputs: [{ name: '_token', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
            ] as const;

            const [graduated, progress] = await Promise.all([
              client.readContract({ address: chain.nadfunLens, abi: NADFUN_LENS_ABI, functionName: 'isGraduated', args: [tokenAddress] }).catch(() => null),
              client.readContract({ address: chain.nadfunLens, abi: NADFUN_LENS_ABI, functionName: 'getProgress', args: [tokenAddress] }).catch(() => null),
            ]);

            if (graduated !== null) {
              const progressBps = progress !== null ? Number(progress) : 0;
              nadfun = {
                isNadfun: true,
                graduated: graduated as boolean,
                progress: progressBps / 100,
                bondingCurveRouter: chain.nadfunBondingCurveRouter,
                dexRouter: chain.nadfunDexRouter,
              };
            }
          } catch { }
        }
      }

      // Fallback: populate pool & price from DexScreener when on-chain resolution didn't find one
      if (!pool && dexScreenerData) {
        pool = {
          version: dexScreenerData.dexId,
          address: dexScreenerData.pairAddress,
          fee: 0,
        };
      }
      if (price === 0 && dexScreenerData?.priceNative) {
        price = parseFloat(dexScreenerData.priceNative);
      }

      return json(res, {
        data: {
          address: tokenAddress,
          chainId: verifyChainId,
          name,
          symbol,
          decimals,
          totalSupply: totalSupply.toString(),
          valid: true,
          pool,
          price,
          nadfun,
          dexscreener: dexScreenerData,
        },
      });
    } catch (error) {
      return json(res, {
        data: {
          address: tokenAddress,
          valid: false,
          error: 'Failed to read token contract',
        },
      });
    }
  }

  // POST /api/tokens/create-monad — create a new token on nad.fun with optional dev buy
  if (method === 'POST' && path === '/api/tokens/create-monad') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      // Validate required fields
      if (!data.name || !data.symbol || !data.description) {
        return json(res, { error: 'name, symbol, and description required' }, 400);
      }
      if (!data.ownerAddress || !data.signature || !data.timestamp) {
        return json(res, { error: 'ownerAddress, signature and timestamp required' }, 400);
      }
      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      // Use client-provided eigenId (they signed a message containing it)
      const eigenId = data.eigenId || generateEigenId();

      // Prevent duplicate eigen configs
      const existing = getEigenConfig(eigenId);
      if (existing) {
        return json(res, { error: 'Eigen config already exists' }, 409);
      }

      const registerMsg = buildRegisterMessage(eigenId, data.ownerAddress, data.timestamp);
      const valid = await verifyEip191(registerMsg, data.signature, data.ownerAddress);
      if (!valid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      // Download image from URL if provided
      let imageBuffer: Buffer;
      let imageContentType: CreateMonadTokenParams['imageContentType'] = 'image/png';

      if (data.imageUrl) {
        // Validate image URL to prevent SSRF
        try {
          const imgUrl = new URL(data.imageUrl);
          if (imgUrl.protocol !== 'https:') {
            return json(res, { error: 'Image URL must use HTTPS' }, 400);
          }
          // Block private/reserved IP ranges and cloud metadata endpoints
          const hostname = imgUrl.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname === '[::1]' ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') || hostname.startsWith('172.17.') ||
            hostname.startsWith('172.18.') || hostname.startsWith('172.19.') ||
            hostname.startsWith('172.2') || hostname.startsWith('172.30.') ||
            hostname.startsWith('172.31.') ||
            hostname.startsWith('192.168.') ||
            hostname === '169.254.169.254' ||
            hostname.startsWith('169.254.') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname.endsWith('.amazonaws.com') ||
            hostname === 'metadata.google.internal' ||
            hostname === 'metadata.google.com'
          ) {
            return json(res, { error: 'Image URL cannot point to private/internal addresses' }, 400);
          }
        } catch {
          return json(res, { error: 'Invalid image URL' }, 400);
        }

        const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
        try {
          const imgRes = await fetch(data.imageUrl, { signal: AbortSignal.timeout(8000) });
          if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);

          // Check Content-Length before downloading body
          const contentLength = imgRes.headers.get('content-length');
          if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
            throw new Error('Image too large (max 10MB)');
          }

          const ct = imgRes.headers.get('content-type') || 'image/png';
          if (!ct.startsWith('image/')) {
            throw new Error('URL does not serve an image content type');
          }
          if (ct.includes('jpeg') || ct.includes('jpg')) imageContentType = 'image/jpeg';
          else if (ct.includes('webp')) imageContentType = 'image/webp';
          else if (ct.includes('svg')) imageContentType = 'image/svg+xml';

          const arrayBuf = await imgRes.arrayBuffer();
          if (arrayBuf.byteLength > MAX_IMAGE_SIZE) {
            throw new Error('Image too large (max 10MB)');
          }
          imageBuffer = Buffer.from(arrayBuf);
        } catch (error) {
          console.error('[API] Failed to download image:', (error as Error).message);
          return json(res, { error: 'Failed to download image' }, 400);
        }
      } else if (data.imageBase64) {
        // Limit base64 payload to ~10MB decoded
        if (typeof data.imageBase64 !== 'string' || data.imageBase64.length > 14_000_000) {
          return json(res, { error: 'imageBase64 too large (max ~10MB)' }, 400);
        }
        imageBuffer = Buffer.from(data.imageBase64, 'base64');
        if (data.imageContentType) imageContentType = data.imageContentType;
      } else {
        return json(res, { error: 'imageUrl or imageBase64 required' }, 400);
      }

      // Parse dev buy amount — use parseEther for precision (avoids float * 1e18 rounding)
      const devBuyMon = data.devBuyMon
        ? parseEther(String(data.devBuyMon))
        : undefined;

      // Create token on nad.fun
      console.log(`[API] Creating Monad token: ${data.name} ($${data.symbol}) for ${data.ownerAddress}`);
      const result = await createMonadToken({
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        image: imageBuffer,
        imageContentType,
        website: data.website,
        twitter: data.twitter,
        telegram: data.telegram,
        initialBuyMon: devBuyMon,
      });

      // Auto-register eigen config — wrap in try/catch to log orphaned tokens
      const eigenClass = data.class || 'operator';
      try {
        insertEigenConfig({
          eigenId,
          tokenAddress: result.tokenAddress,
          tokenSymbol: data.symbol,
          tokenName: data.name,
          class: eigenClass,
          ownerAddress: data.ownerAddress,
          chainId: 143,
          poolAddress: result.poolAddress,
          poolVersion: 'nadfun',
        });

        // Set graduation status to bonding_curve
        updateGraduationStatus(eigenId, 'bonding_curve');

        // Restart graduation monitor to watch the new token
        restartGraduationMonitor();

        // Register as ERC-8004 agent if enabled
        if (isErc8004Enabled()) {
          try {
            const agentId = await registerAgent(eigenId, 143);
            console.log(`[API] Registered 8004 agent for ${eigenId}: #${agentId}`);
          } catch (err) {
            console.warn(`[API] 8004 agent registration failed:`, err);
          }
        }
      } catch (dbError) {
        console.error(`[API] DB insert failed after token creation — ORPHANED TOKEN: ${result.tokenAddress} tx=${result.transactionHash} eigenId=${eigenId}`, dbError);
        return json(res, { error: `Token created at ${result.tokenAddress} but DB registration failed. Contact support with this tx: ${result.transactionHash}` }, 500);
      }

      console.log(`[API] Monad token created: ${result.tokenAddress} eigen=${eigenId}`);

      return json(res, {
        success: true,
        tokenAddress: result.tokenAddress,
        poolAddress: result.poolAddress,
        txHash: result.transactionHash,
        eigenId,
        imageUri: result.imageUri,
      }, 201);
    } catch (error) {
      console.error('[API] Token creation failed:', (error as Error).message);
      return json(res, { error: 'Token creation failed' }, 500);
    }
  }

  // GET /api/pricing — volume package pricing for agents
  if (method === 'GET' && path === '/api/pricing') {
    return json(res, getPricingResponse());
  }

  // GET /api/launch/info — deposit address for ETH direct launches
  if (method === 'GET' && path === '/api/launch/info') {
    return json(res, { depositAddress: getKeeperAddress() });
  }

  // POST /api/launch/dry-run — simulate a launch without executing on-chain txs
  if (method === 'POST' && path === '/api/launch/dry-run') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      if (!data.name || !data.symbol) {
        return json(res, { error: 'name and symbol required' }, 400);
      }

      const agentClass: AgentClass = data.class || 'operator';
      const classConfig = CLASS_CONFIGS[agentClass];
      if (!classConfig) {
        return json(res, { error: `Unknown class: ${data.class}. Use sentinel, operator, architect, or sovereign.` }, 400);
      }

      const allocation = {
        devBuyPct: data.allocation?.devBuyPct ?? 60,
        liquidityPct: data.allocation?.liquidityPct ?? 30,
        volumePct: data.allocation?.volumePct ?? 10,
      };
      for (const [key, val] of Object.entries(allocation)) {
        if (typeof val !== 'number' || !isFinite(val) || val < 0 || val > 100) {
          return json(res, { error: `${key} must be a number between 0 and 100` }, 400);
        }
      }
      const totalPct = allocation.devBuyPct + allocation.liquidityPct + allocation.volumePct;
      if (totalPct !== 100) {
        return json(res, { error: `allocation percentages must sum to 100, got ${totalPct}` }, 400);
      }

      // Simulate with provided ETH amount (or default 0.01)
      const simulatedEth = parseEther(String(data.ethAmount || '0.01'));
      const MIN_LAUNCH_ETH = parseEther('0.001');
      if (simulatedEth < MIN_LAUNCH_ETH) {
        return json(res, { error: `Insufficient ETH: ${formatEther(simulatedEth)}, minimum 0.001 ETH` }, 400);
      }

      // Protocol fee deduction (5%)
      const protocolFee = (simulatedEth * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      const afterFeeEth = simulatedEth - protocolFee;

      // Wallet count validation
      const requestedWalletCount = data.walletCount ?? classConfig.walletCountRange[0];
      if (requestedWalletCount < classConfig.walletCountRange[0] || requestedWalletCount > classConfig.walletCountRange[1]) {
        return json(res, {
          error: `walletCount ${requestedWalletCount} out of range for ${agentClass} class. Allowed: ${classConfig.walletCountRange[0]}-${classConfig.walletCountRange[1]}`,
        }, 400);
      }

      // Gas budget deduction
      const gasBudget = parseEther(GAS_BUDGET_PER_WALLET) * BigInt(requestedWalletCount);
      const deployableEth = afterFeeEth - gasBudget;

      // Pricing multiplier for min deposit
      const additionalWallets = requestedWalletCount - classConfig.walletCountRange[0];
      const walletMultiplier = 1 + (additionalWallets * 0.1);
      const adjustedMinDeposit = classConfig.minDeposit * walletMultiplier;

      // Compute ETH split on deployable amount
      const devBuyEth = (deployableEth * BigInt(allocation.devBuyPct)) / 100n;
      let liquidityEth = (deployableEth * BigInt(allocation.liquidityPct)) / 100n;
      let volumeEth = deployableEth - devBuyEth - liquidityEth;

      const MIN_VAULT_DEPOSIT = 10000000000000n;
      let autoCarved = false;
      if (volumeEth < MIN_VAULT_DEPOSIT && liquidityEth > MIN_VAULT_DEPOSIT * 2n) {
        const vaultCarve = liquidityEth / 20n;
        liquidityEth -= vaultCarve;
        volumeEth += vaultCarve;
        autoCarved = true;
      }

      // Check keeper gas balance
      const keeperBalance = await getPublicClient(143).getBalance({ address: getKeeperAddress() });
      const gasEstimate = parseEther('0.003');

      const launcherAddr = (process.env.EIGENLAUNCHER_ADDRESS || EIGENLAUNCHER_ADDRESS) as string;
      const hasLauncher = launcherAddr && launcherAddr !== '0x0000000000000000000000000000000000000000';

      return json(res, {
        dryRun: true,
        validation: 'passed',
        input: {
          name: data.name,
          symbol: data.symbol,
          class: agentClass,
          classConfig: {
            label: classConfig.label,
            minDeposit: classConfig.minDeposit,
            adjustedMinDeposit,
            protocolFee: classConfig.protocolFee,
            tradingFeeBps: classConfig.protocolFee * 100,
            walletCountRange: classConfig.walletCountRange,
          },
          feeType: data.feeType || 'static',
          ethAmount: formatEther(simulatedEth),
          walletCount: requestedWalletCount,
        },
        fees: {
          protocolFee: formatEther(protocolFee),
          protocolFeeBps: PROTOCOL_FEE_BPS,
          gasBudget: formatEther(gasBudget),
          walletCount: requestedWalletCount,
          deployableEth: formatEther(deployableEth),
        },
        allocation: {
          devBuyEth: formatEther(devBuyEth),
          liquidityEth: formatEther(liquidityEth),
          volumeEth: formatEther(volumeEth),
          autoCarved,
          pctSplit: `${allocation.devBuyPct}/${allocation.liquidityPct}/${allocation.volumePct}`,
        },
        infrastructure: {
          keeperAddress: getKeeperAddress(),
          keeperGasBalance: formatEther(keeperBalance),
          keeperHasEnoughGas: keeperBalance >= gasEstimate,
          eigenLauncherAvailable: hasLauncher,
          eigenLauncherAddress: hasLauncher ? launcherAddr : null,
        },
        steps: [
          `1. Verify ETH payment on Base`,
          `2. Deduct ${formatEther(protocolFee)} ETH protocol fee (${PROTOCOL_FEE_BPS / 100}%) + ${formatEther(gasBudget)} ETH gas budget (${requestedWalletCount} wallets)`,
          `3. Deploy token via Clanker SDK (dev buy ${formatEther(devBuyEth)} ETH → tokens to keeper)`,
          `4. Wait 3s for Clanker pool initialization`,
          `5. Read pool sqrtPriceX96 from Clanker V4 pool`,
          `6. ${hasLauncher ? 'EigenLauncher.launch()' : 'EigenBundler.launch()'}: seed LP (${formatEther(liquidityEth)} ETH + tokens) + create vault (${formatEther(volumeEth)} ETH) + mint 8004 agent`,
          `7. Register eigen config in DB, activate trading`,
        ],
      });
    } catch (error) {
      return json(res, { error: `Dry-run failed: ${(error as Error).message}` }, 400);
    }
  }

  // POST /api/agents/buy-volume — x402 payment flow for agents
  if (method === 'POST' && path === '/api/agents/buy-volume') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      if (!data.tokenAddress || !data.packageId) {
        return json(res, { error: 'tokenAddress and packageId required' }, 400);
      }

      if (!ADDRESS_RE.test(data.tokenAddress)) {
        return json(res, { error: 'Invalid tokenAddress format (expected 0x + 40 hex chars)' }, 400);
      }

      const pkg = getPackage(data.packageId);
      if (!pkg) {
        return json(res, { error: `Unknown package: ${data.packageId}. Use GET /api/pricing to see available packages.` }, 400);
      }

      // Verify token is a real ERC-20 with a trading pool
      const tokenAddr = data.tokenAddress as `0x${string}`;
      const eigenChainIdForVerify = typeof data.chainId === 'number' && isChainSupported(data.chainId)
        ? data.chainId
        : 143;
      const verifyClient = getPublicClient(eigenChainIdForVerify);

      // Verify contract has bytecode (rejects EOAs and self-destructed contracts)
      try {
        const bytecode = await verifyClient.getCode({ address: tokenAddr });
        if (!bytecode || bytecode === '0x' || bytecode.length < 10) {
          return json(res, { error: 'tokenAddress has no contract bytecode — not a valid token' }, 400);
        }
      } catch {
        return json(res, { error: 'Failed to check tokenAddress bytecode' }, 400);
      }

      let tokenSymbol = data.tokenSymbol || '';
      let tokenName = data.tokenName || '';

      try {
        const [onChainSymbol, onChainName] = await Promise.all([
          verifyClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
          verifyClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
        ]);

        if (!onChainSymbol && !onChainName) {
          return json(res, { error: 'tokenAddress is not a valid ERC-20 contract' }, 400);
        }

        // Auto-fill symbol/name from on-chain if not provided
        if (!tokenSymbol && onChainSymbol) tokenSymbol = onChainSymbol as string;
        if (!tokenName && onChainName) tokenName = onChainName as string;
      } catch {
        return json(res, { error: 'Failed to verify tokenAddress — contract may not exist on this chain' }, 400);
      }

      // Check for a trading pool (resolvePool for Base, DexScreener as fallback)
      let hasPool = false;
      if (eigenChainIdForVerify === 143) {
        const pool = await resolvePool(tokenAddr).catch(() => null);
        if (pool) hasPool = true;
      }

      if (!hasPool) {
        // DexScreener fallback for any chain
        try {
          const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, { signal: AbortSignal.timeout(5000) });
          if (dsRes.ok) {
            const dsData = await dsRes.json();
            if (dsData.pairs && dsData.pairs.length > 0) hasPool = true;
          }
        } catch { }
      }

      if (!hasPool) {
        return json(res, { error: 'No trading pool found for this token. Ensure the token has liquidity on a supported DEX.' }, 400);
      }

      // Check for x402 payment proof (v2: PAYMENT-SIGNATURE, v1: X-PAYMENT)
      const xPayment = getPaymentHeader(req.headers);
      const paymentTxHash = xPayment ? derivePaymentKey(xPayment) : undefined;

      // Check for payment replay
      if (paymentTxHash && isPaymentUsed(paymentTxHash)) {
        return json(res, { error: 'Payment already used' }, 409);
      }

      // Lock the payment key immediately to prevent race conditions
      if (paymentTxHash) {
        try {
          recordPayment({
            txHash: paymentTxHash,
            payerAddress: 'pending',
            amountUsdc: 0,
            packageId: pkg.id,
            eigenId: 'pending',
          });
        } catch {
          // Already recorded by concurrent request
          return json(res, { error: 'Payment already used' }, 409);
        }
      }

      if (!xPayment || !paymentTxHash) {
        // No payment — respond 402 with x402-compliant payment requirements
        const paymentRequired = build402Response(pkg, path);
        res.writeHead(402, build402Headers(paymentRequired));
        res.end(JSON.stringify(paymentRequired));
        return;
      }

      // Verify and settle payment via x402 facilitator
      const requirements = buildPaymentRequirements(pkg, path);
      console.log(`[x402] Verifying payment via facilitator for ${pkg.priceUSDC} USDC`);
      const verification = await verifyAndSettlePayment(xPayment, requirements);

      if (!verification.valid) {
        deletePayment(paymentTxHash);
        console.error('[API] Payment verification failed:', verification.error);
        return json(res, { error: 'Payment verification failed' }, 402);
      }

      // Payment verified — create the eigen
      const eigenChainId = eigenChainIdForVerify;
      const eigenId = keccak256(toHex(`agent-${data.tokenAddress}-${Date.now()}`));
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Resolve owner: prefer API key owner, fall back to USDC payer
      let ownerAddress = verification.from;
      const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
      if (apiKeyHeader) {
        const keyRecord = getAgentApiKeyByHash(hashApiKey(apiKeyHeader));
        if (keyRecord) {
          ownerAddress = keyRecord.owner_address;
          touchAgentApiKey(hashApiKey(apiKeyHeader));
        }
      }

      insertEigenConfig({
        eigenId,
        tokenAddress: data.tokenAddress,
        tokenSymbol: tokenSymbol,
        tokenName: tokenName,
        class: 'operator',
        volumeTarget: pkg.ethVolume,
        tradeFrequency: Math.ceil(pkg.ethVolume * 2.4),
        orderSizeMin: Math.max(0.005, pkg.ethVolume * 0.01),
        orderSizeMax: pkg.ethVolume * 0.05,
        chainId: eigenChainId,
        ownerAddress,
      });

      // Update the pending payment record with verified details
      try {
        const paymentDb = getDb();
        paymentDb.prepare(
          'UPDATE used_payments SET payer_address = ?, amount_usdc = ?, eigen_id = ? WHERE tx_hash = ?'
        ).run(verification.from, verification.amount, eigenId, paymentTxHash);
      } catch {
        // Payment already fully recorded — safe to continue
      }

      console.log(`[x402] Agent purchased ${pkg.id} package for ${data.tokenAddress} — eigen ${eigenId}`);
      console.log(`[x402] Payment: ${verification.amount} USDC from ${verification.from}`);

      // Swap received USDC → ETH and fund the eigen on the vault
      let fundingResult: { funded: boolean; swapTxHash?: string; fundTxHash?: string; ethReceived?: string; error?: string } = { funded: false };
      try {
        fundingResult = await swapUsdcAndFundEigen(
          eigenId,
          verification.amount,
          verification.from as `0x${string}`,
          500n, // 5% trading fee
          eigenChainId,
        );
        if (fundingResult.funded) {
          console.log(`[x402] Funded eigen ${eigenId}: swapped ${verification.amount} USDC → ${fundingResult.ethReceived} ETH`);
        } else {
          console.warn(`[x402] Funding failed for ${eigenId}: ${fundingResult.error}`);
        }
      } catch (error) {
        console.warn(`[x402] Treasury auto-fund failed: ${(error as Error).message}`);
        fundingResult.error = (error as Error).message;
      }

      // Update DB status if funding failed so trading loop skips this eigen
      if (!fundingResult.funded) {
        updateEigenConfigStatus(eigenId, 'pending_funding');
      }

      return json(res, {
        success: true,
        eigenId,
        chainId: eigenChainId,
        package: pkg.id,
        ethVolume: pkg.ethVolume,
        duration: pkg.duration,
        status: fundingResult.funded ? 'active' : 'pending_funding',
        expiresAt,
        paidBy: verification.from,
        paidAmount: verification.amount,
        paymentTx: verification.settleTxHash || paymentTxHash,
        funding: {
          funded: fundingResult.funded,
          swapTx: fundingResult.swapTxHash || null,
          fundTx: fundingResult.fundTxHash || null,
          ethReceived: fundingResult.ethReceived || null,
          error: fundingResult.error || null,
        },
      }, 201);
    } catch (error) {
      console.error('[API] Invalid request:', (error as Error).message);
      return json(res, { error: 'Invalid request' }, 400);
    }
  }

  // POST /api/launch — Full token launch: deploy Clanker + dev buy + LP + eigen + 8004 agent
  // Accepts either:
  //   - X-ETH-PAYMENT header: user sent ETH directly to keeper (frontend flow)
  //   - X-PAYMENT header: user paid USDC via x402 (agent/API flow)
  if (method === 'POST' && path === '/api/launch') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      // Validate required fields
      if (!data.name || !data.symbol) {
        return json(res, { error: 'name and symbol required' }, 400);
      }

      // Validate agent class
      const agentClass: AgentClass = data.class || 'operator';
      const classConfig = CLASS_CONFIGS[agentClass];
      if (!classConfig) {
        return json(res, { error: `Unknown class: ${data.class}. Use sentinel, operator, architect, or sovereign.` }, 400);
      }

      // Chain detection — Monad-first, Base disabled
      const chainId = data.chainId ?? 143;
      if (chainId === 8453) {
        return json(res, { error: 'Base deployment currently disabled. Use Monad (chainId: 143).' }, 400);
      }

      // Parse allocation percentages (default: 60% dev buy, 30% LP, 10% volume)
      const allocation = {
        devBuyPct: data.allocation?.devBuyPct ?? 60,
        liquidityPct: data.allocation?.liquidityPct ?? 30,
        volumePct: data.allocation?.volumePct ?? 10,
      };
      // Each percentage must be 0–100 and they must sum to 100
      for (const [key, val] of Object.entries(allocation)) {
        if (typeof val !== 'number' || !isFinite(val) || val < 0 || val > 100) {
          return json(res, { error: `${key} must be a number between 0 and 100` }, 400);
        }
      }
      const totalPct = allocation.devBuyPct + allocation.liquidityPct + allocation.volumePct;
      if (totalPct !== 100) {
        return json(res, { error: `allocation percentages must sum to 100, got ${totalPct}` }, 400);
      }

      // ── Determine payment chain & method ─────────────────────────────
      const paymentChainId = typeof data.paymentChainId === 'number' && isChainSupported(data.paymentChainId)
        ? data.paymentChainId
        : 143;
      const paymentNetwork: 'monad' | 'base' = paymentChainId === 8453 ? 'base' : 'monad';

      const ethPaymentTxHash = req.headers['x-eth-payment'] as string | undefined;
      const xPayment = getPaymentHeader(req.headers);
      // For ETH: dedup key = tx hash. For x402 USDC: dedup key = sha256 of signed payload.
      const paymentTxHash = ethPaymentTxHash || (xPayment ? derivePaymentKey(xPayment) : undefined);

      if (!paymentTxHash) {
        // No payment — return 402 with x402-compliant payment requirements
        const pkgId = data.packageId || 'starter';
        const pkg = getPackage(pkgId);
        if (pkg) {
          const paymentRequired = build402Response(pkg, '/api/launch', paymentNetwork);
          res.writeHead(402, build402Headers(paymentRequired));
          res.end(JSON.stringify(paymentRequired));
          return;
        }
        return json(res, { error: 'Payment required. Send X-PAYMENT or PAYMENT-SIGNATURE header with x402 signed payload.' }, 402);
      }

      // Payment replay check
      if (isPaymentUsed(paymentTxHash)) {
        return json(res, { error: 'Payment already used' }, 409);
      }

      // Lock payment hash immediately to prevent race conditions
      try {
        recordPayment({
          txHash: paymentTxHash,
          payerAddress: 'pending',
          amountUsdc: 0,
          packageId: data.packageId || 'eth-direct',
          eigenId: 'pending-launch',
        });
      } catch {
        return json(res, { error: 'Payment already used' }, 409);
      }

      let totalEthReceived: bigint;
      let ownerAddress: string;
      let swapTxHash: string | null = null;

      if (ethPaymentTxHash) {
        // ── ETH Payment: verify direct ETH transfer ────────────────
        console.log(`[Launch] Verifying ETH payment tx: ${ethPaymentTxHash}`);
        const ethVerification = await verifyEthPayment(
          ethPaymentTxHash as `0x${string}`,
          paymentChainId,
        );

        if (!ethVerification.valid) {
          deletePayment(paymentTxHash); // Release lock so user can retry
          console.error('[Launch] ETH payment verification failed:', ethVerification.error);
          return json(res, { error: `ETH payment verification failed: ${ethVerification.error}` }, 402);
        }

        totalEthReceived = ethVerification.amount;

        // Default owner = whoever sent the ETH (trustless)
        ownerAddress = ethVerification.from;

        // Owner override logic:
        // If ownerAddress matches ETH sender → no sig needed (already proven by ETH tx).
        // If ownerAddress differs from ETH sender → require valid signature to prevent hijacking.
        if (data.ownerAddress) {
          if (data.ownerAddress.toLowerCase() === ethVerification.from.toLowerCase()) {
            // Same address as ETH sender — ownership is already proven on-chain
            ownerAddress = data.ownerAddress;
          } else if (data.signature && data.timestamp) {
            // Different address — verify signature to prove they authorized this
            if (!isTimestampValid(data.timestamp)) {
              deletePayment(paymentTxHash);
              return json(res, { error: 'Signature expired' }, 400);
            }
            const sigValid = await verifyEip191(
              buildRegisterMessage(data.eigenId || 'pending', data.ownerAddress, data.timestamp),
              data.signature,
              data.ownerAddress,
            ).catch(() => false);
            if (!sigValid) {
              deletePayment(paymentTxHash);
              return json(res, { error: 'Invalid signature — cannot verify owner' }, 403);
            }
            ownerAddress = data.ownerAddress;
          }
          // If no sig and different address → ignore override, keep ETH sender
        }

        // Update payment record
        try {
          const paymentDb = getDb();
          paymentDb.prepare(
            'UPDATE used_payments SET payer_address = ?, amount_usdc = 0, eigen_id = ? WHERE tx_hash = ?',
          ).run(ethVerification.from, 'pending-launch', ethPaymentTxHash);
        } catch { /* Already recorded */ }

        console.log(`[Launch] ETH payment verified: ${formatEther(totalEthReceived)} ETH from ${ethVerification.from}`);
      } else {
        // ── USDC Payment via x402: verify + settle via facilitator, then swap ──
        if (!data.packageId) {
          return json(res, { error: 'packageId required for USDC payment' }, 400);
        }
        const pkg = getPackage(data.packageId);
        if (!pkg) {
          return json(res, { error: `Unknown package: ${data.packageId}` }, 400);
        }

        const requirements = buildPaymentRequirements(pkg, '/api/launch', paymentNetwork);
        console.log(`[Launch] Verifying x402 payment via facilitator for ${pkg.priceUSDC} USDC on ${paymentNetwork}`);
        const verification = await verifyAndSettlePayment(xPayment!, requirements, paymentNetwork);

        if (!verification.valid) {
          deletePayment(paymentTxHash);
          console.error('[Launch] x402 payment verification failed:', verification.error);
          return json(res, { error: 'Payment verification failed' }, 402);
        }

        ownerAddress = verification.from;
        const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
        if (apiKeyHeader) {
          const keyRecord = getAgentApiKeyByHash(hashApiKey(apiKeyHeader));
          if (keyRecord) {
            ownerAddress = keyRecord.owner_address;
            touchAgentApiKey(hashApiKey(apiKeyHeader));
          }
        }

        // Update payment record
        try {
          const paymentDb = getDb();
          paymentDb.prepare(
            'UPDATE used_payments SET payer_address = ?, amount_usdc = ?, eigen_id = ? WHERE tx_hash = ?',
          ).run(verification.from, verification.amount, 'pending-launch', paymentTxHash);
        } catch { /* Already recorded */ }

        // Swap USDC → MON on payment chain
        try {
          const swapResult = await swapUsdcToEth(verification.amount, paymentChainId);
          totalEthReceived = swapResult.ethReceived;
          swapTxHash = swapResult.swapTxHash;
          console.log(`[Launch] Swapped ${verification.amount} USDC → ${formatEther(totalEthReceived)} ETH`);
        } catch (error) {
          deletePayment(paymentTxHash);
          console.error('[Launch] USDC→ETH swap failed:', (error as Error).message);
          return json(res, { error: 'USDC to ETH swap failed. Payment released — you can retry.' }, 500);
        }
      }

      // ── Common launch flow (ETH or USDC) ────────────────────────────

      // Minimum ETH check — below this, Clanker deploy + LP seed will fail or waste gas
      const MIN_LAUNCH_ETH = parseEther('0.001'); // 0.001 ETH
      if (totalEthReceived < MIN_LAUNCH_ETH) {
        deletePayment(paymentTxHash);
        return json(res, {
          error: `Insufficient ETH for launch: ${formatEther(totalEthReceived)} ETH received, minimum ${formatEther(MIN_LAUNCH_ETH)} ETH required`,
        }, 400);
      }

      // Sanitize token name & symbol (prevent injection in logs / agent cards / DB)
      const sanitizedName = String(data.name).replace(/[^\w\s\-.'()&!$]/g, '').trim().slice(0, 64);
      const sanitizedSymbol = String(data.symbol).replace(/[^\w\-$]/g, '').trim().slice(0, 16).toUpperCase();
      if (!sanitizedName || !sanitizedSymbol) {
        deletePayment(paymentTxHash);
        return json(res, { error: 'name and symbol must contain valid characters' }, 400);
      }
      // Sanitize description — strip control chars, limit length
      const sanitizedDescription = data.description
        ? String(data.description).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 500)
        : '';

      // Always generate eigenId server-side to prevent collisions / injection
      const eigenId = generateEigenId();

      console.log(`[Launch] Starting token launch: ${sanitizedName} ($${sanitizedSymbol}) for ${ownerAddress}, ETH=${formatEther(totalEthReceived)}`);

      // ── Step 2a: Protocol fee + gas budget deduction ───────────────
      const protocolFee = (totalEthReceived * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
      const afterFeeEth = totalEthReceived - protocolFee;
      const requestedWalletCount = data.walletCount ?? classConfig.walletCountRange[0];
      if (requestedWalletCount < classConfig.walletCountRange[0] || requestedWalletCount > classConfig.walletCountRange[1]) {
        deletePayment(paymentTxHash);
        return json(res, { error: `walletCount ${requestedWalletCount} out of range for class ${agentClass} (${classConfig.walletCountRange[0]}-${classConfig.walletCountRange[1]})` }, 400);
      }
      const gasBudget = parseEther(GAS_BUDGET_PER_WALLET) * BigInt(requestedWalletCount);
      const deployableEth = afterFeeEth - gasBudget;
      const additionalWallets = requestedWalletCount - classConfig.walletCountRange[0];
      const walletMultiplier = 1 + (additionalWallets * 0.1);
      const adjustedMinDeposit = parseEther(String(classConfig.minDeposit * walletMultiplier));
      if (deployableEth < adjustedMinDeposit) {
        deletePayment(paymentTxHash);
        return json(res, { error: `Insufficient ETH after fees: ${formatEther(deployableEth)} deployable, min ${formatEther(adjustedMinDeposit)} required for ${requestedWalletCount} wallets` }, 400);
      }
      console.log(`[Launch] Fees: protocol=${formatEther(protocolFee)}, gas=${formatEther(gasBudget)} (${requestedWalletCount}w), deployable=${formatEther(deployableEth)}`);

      // ── Step 2b: Split deployable ETH by allocation ────────────────
      const devBuyEth = (deployableEth * BigInt(allocation.devBuyPct)) / 100n;
      let liquidityEth = (deployableEth * BigInt(allocation.liquidityPct)) / 100n;
      let volumeEth = deployableEth - devBuyEth - liquidityEth; // remainder to avoid rounding loss

      // Auto-carve vault deposit from LP portion if not explicitly set.
      // The vault needs some ETH for initial buy orders; as the agent sells
      // dev-bought tokens, ETH flows back into the vault via returnEth().
      const MIN_VAULT_DEPOSIT = 10000000000000n; // 0.00001 ETH minimum
      if (volumeEth < MIN_VAULT_DEPOSIT && liquidityEth > MIN_VAULT_DEPOSIT * 2n) {
        const vaultCarve = liquidityEth / 20n; // 5% of LP ETH → vault
        liquidityEth -= vaultCarve;
        volumeEth += vaultCarve;
      }

      console.log(
        `[Launch] ETH split: devBuy=${formatEther(devBuyEth)}, ` +
        `LP=${formatEther(liquidityEth)}, volume=${formatEther(volumeEth)}`,
      );

      // ── Step 3+4: Deploy Token ──────────────────────────────────────────
      // Monad: nad.fun token creation (bonding curve + graduation monitor)
      // Base: disabled (see chainId check above)

      let tokenAddress: `0x${string}`;
      let deployTxHash: string;
      let lpPoolId = '';
      let lpTokenId: number | null = null;
      let lpTxHash = '';
      let agent8004Id: string | null = null;

      if (chainId === 143) {
        const monadChainConfig = getChainConfig(143);
        const ATOMIC_LAUNCHER_ADDR = monadChainConfig.eigenAtomicLauncher;
        const useAtomicLauncher = ATOMIC_LAUNCHER_ADDR && devBuyEth > 0n && liquidityEth > 0n;

        if (useAtomicLauncher) {
          // ── Path A: Atomic Launcher (1 tx) ────────────────────────
          // create token on nad.fun + dev buy + V4 LP + vault — all atomic
          console.log(`[Launch] Using Monad atomic launcher at ${ATOMIC_LAUNCHER_ADDR}`);

          try {
            const masterWallet = getWalletClient(143);
            const monadClient = getPublicClient(143);

            // Read deploy fee from contract
            const deployFee = await monadClient.readContract({
              address: ATOMIC_LAUNCHER_ADDR,
              abi: EIGEN_ATOMIC_LAUNCHER_ABI,
              functionName: 'deployFee',
            }) as bigint;

            const eigenIdBytes32 = eigenIdToBytes32(eigenId);
            // Default initial price for V4 pool (~0.00005 MON/token)
            const defaultSqrtPriceX96 = 5602277097478614n;
            const tradingFeeBps = BigInt(Math.round(classConfig.protocolFee * 100));

            // ── Upload image + metadata to nad.fun API for proper visibility ──
            let imageUri = '';
            if (data.image) {
              // data.image can be a URL or base64
              if (data.image.startsWith('http')) {
                imageUri = data.image;
              } else {
                // base64 → buffer → upload to nad.fun
                const base64Data = data.image.replace(/^data:image\/\w+;base64,/, '');
                const imgBuffer = Buffer.from(base64Data, 'base64');
                const mimeMatch = data.image.match(/^data:(image\/\w+);base64,/);
                const contentType = mimeMatch ? mimeMatch[1] : 'image/png';
                const uploaded = await uploadImageToNadFun(imgBuffer, contentType);
                imageUri = uploaded.imageUri;
              }
            } else {
              // No image provided — upload placeholder SVG
              const svgBuffer = generatePlaceholderSvg(sanitizedName, sanitizedSymbol);
              const uploaded = await uploadImageToNadFun(svgBuffer, 'image/svg+xml');
              imageUri = uploaded.imageUri;
            }

            // Upload metadata to nad.fun
            const { metadataUri } = await uploadMetadataToNadFun({
              imageUri,
              name: sanitizedName,
              symbol: sanitizedSymbol,
              description: sanitizedDescription,
              website: data.website,
              twitter: data.twitter,
              telegram: data.telegram,
            });
            const tokenURI = metadataUri;

            // Mine salt from nad.fun (ensures token address ends in 7777)
            const { salt } = await mineSaltFromNadFun({
              creator: ATOMIC_LAUNCHER_ADDR,
              name: sanitizedName,
              symbol: sanitizedSymbol,
              metadataUri,
            });

            const totalValue = deployFee + devBuyEth + liquidityEth + volumeEth;

            const txHash = await masterWallet.writeContract({
              address: ATOMIC_LAUNCHER_ADDR,
              abi: EIGEN_ATOMIC_LAUNCHER_ABI,
              functionName: 'atomicLaunch',
              args: [
                sanitizedName,
                sanitizedSymbol,
                tokenURI,
                salt,
                1, // actionId: 1 for nad.fun official flow
                0n, // minTokensOut: 0 (no slippage check on deploy)
                eigenIdBytes32,
                defaultSqrtPriceX96,
                tradingFeeBps,
                devBuyEth,
                liquidityEth,
                volumeEth,
                ownerAddress as `0x${string}`,
              ],
              value: totalValue,
            });

            const receipt = await monadClient.waitForTransactionReceipt({ hash: txHash });

            // Parse AtomicLaunch event to get token address
            const atomicLaunchTopic = keccak256(toHex('AtomicLaunch(address,bytes32,address,uint256,uint256,uint256)'));
            const launchLog = receipt.logs.find((log: { topics: string[] }) => log.topics[0] === atomicLaunchTopic);
            if (!launchLog || !launchLog.topics[1]) {
              throw new Error('AtomicLaunch event not found in receipt');
            }
            tokenAddress = `0x${launchLog.topics[1].slice(26)}` as `0x${string}`;
            deployTxHash = txHash;

            console.log(`[Launch] Atomic launch complete: token=${tokenAddress} tx=${txHash}`);

            // Compute V4 pool ID (atomic launcher creates pool with fee=9900, tickSpacing=198, hooks=0x0)
            const ATOMIC_LP_FEE = 9900;
            const ATOMIC_LP_TICK_SPACING = 198;
            const computedPoolId = computeV4PoolId(
              ZERO_ADDRESS,
              tokenAddress,
              ATOMIC_LP_FEE,
              ATOMIC_LP_TICK_SPACING,
              ZERO_ADDRESS,
            );
            lpPoolId = computedPoolId;
            console.log(`[Launch] Computed V4 pool ID: ${computedPoolId}`);

            // Insert eigen config with LP pool data
            insertEigenConfig({
              eigenId,
              tokenAddress,
              tokenSymbol: sanitizedSymbol,
              tokenName: sanitizedName,
              class: agentClass,
              volumeTarget: data.volumeTarget ?? classConfig.volumeRange[0],
              tradeFrequency: Math.ceil((data.volumeTarget ?? classConfig.volumeRange[0]) * 2.4),
              orderSizeMin: classConfig.orderSize[0],
              orderSizeMax: classConfig.orderSize[1],
              spreadWidth: classConfig.spreadWidth[0],
              profitTarget: data.profitTarget ?? 50,
              stopLoss: data.stopLoss ?? 30,
              rebalanceThreshold: 0.7,
              walletCount: requestedWalletCount,
              ownerAddress,
              chainId: 143,
              gasBudgetEth: parseFloat(formatEther(gasBudget)),
              protocolFeeEth: parseFloat(formatEther(protocolFee)),
              poolVersion: 'atomic',
              lpPoolId: computedPoolId,
              lpPoolFee: ATOMIC_LP_FEE,
              lpPoolTickSpacing: ATOMIC_LP_TICK_SPACING,
            });
            insertProtocolFee(eigenId, formatEther(protocolFee), 'launch');

            // Graduation status: bonding curve + V4 pool seeded atomically
            updateGraduationStatus(eigenId, 'bonding_curve');
            restartGraduationMonitor();

            // ── Fund sub-wallets for market making ──────────────
            const wallets = getWalletsForEigen(eigenId, requestedWalletCount);
            const fundingTxs: string[] = [];
            // Volume is now in the vault; fund wallets from gas budget for trade execution
            const gasPerWallet = gasBudget / BigInt(wallets.length);

            if (gasPerWallet > 0n) {
              const keeperAddr = getKeeperAddress();
              const baseNonce = await monadClient.getTransactionCount({ address: keeperAddr });

              const sendPromises = wallets.map((wallet, i) =>
                masterWallet.sendTransaction({
                  to: wallet.address,
                  value: gasPerWallet,
                  nonce: baseNonce + i,
                }).then((hash) => {
                  fundingTxs.push(hash);
                  return hash;
                }).catch((err) => {
                  console.error(`[Launch] Failed to fund wallet ${wallet.address}:`, err);
                  return null;
                }),
              );
              await Promise.all(sendPromises);

              await Promise.all(
                fundingTxs.map((tx) =>
                  monadClient.waitForTransactionReceipt({ hash: tx as `0x${string}` }).catch((e: unknown) => {
                    console.error(`[Launch] Failed to confirm funding tx ${tx}:`, e);
                  }),
                ),
              );

              console.log(`[Launch] Funded ${fundingTxs.length}/${wallets.length} wallets with ${formatEther(gasPerWallet)} MON each`);
            }

            // ── Mint ERC-8004 agent NFT ─────────────────────────
            if (isErc8004Enabled()) {
              try {
                agent8004Id = await registerAgent(eigenId, 143);
                console.log(`[Launch] Minted 8004 agent #${agent8004Id}`);
              } catch (err) {
                console.warn(`[Launch] 8004 registration failed (non-fatal):`, err);
              }
            }

            // Update payment record
            try {
              const paymentDb = getDb();
              paymentDb.prepare('UPDATE used_payments SET eigen_id = ? WHERE tx_hash = ?').run(eigenId, paymentTxHash);
            } catch { /* safe */ }

            return json(res, {
              success: true,
              tokenAddress,
              tokenSymbol: sanitizedSymbol,
              eigenId,
              agent8004Id,
              poolId: lpPoolId || null,
              allocation: {
                totalEth: formatEther(totalEthReceived),
                devBuyEth: formatEther(devBuyEth),
                liquidityEth: formatEther(liquidityEth),
                volumeEth: formatEther(volumeEth),
              },
              txHashes: {
                swap: swapTxHash || null,
                deploy: deployTxHash,
                lp: deployTxHash, // Same tx — atomic
              },
              fees: {
                protocolFee: formatEther(protocolFee),
                protocolFeeBps: PROTOCOL_FEE_BPS,
                gasBudget: formatEther(gasBudget),
                walletCount: requestedWalletCount,
                deployableEth: formatEther(deployableEth),
              },
              status: 'active',
              ownerAddress,
              graduationStatus: 'bonding_curve',
              walletsCreated: wallets.length,
              walletsFunded: fundingTxs.length,
              monPerWallet: formatEther(gasPerWallet),
              launchMode: 'atomic',
            }, 201);
          } catch (error) {
            deletePayment(paymentTxHash);
            const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
            const failedTxHash = (error as any)?.cause?.transactionHash || (error as any)?.transactionHash || null;
            console.error('[Launch] Atomic launcher failed:', errMsg);
            if (failedTxHash) console.error('[Launch] Failed tx:', failedTxHash);
            return json(res, { error: `Atomic launch failed: ${errMsg}. Payment released — you can retry.`, txHash: failedTxHash }, 500);
          }
        } else {
          // ── Path B: Multi-step nad.fun (fallback) ─────────────────
          // Used when atomic launcher not configured or devBuy/LP is zero
          console.log(`[Launch] Using Monad multi-step nad.fun path`);

          try {
            const devBuyMon = devBuyEth > 0n ? devBuyEth : undefined;

            const result = await createMonadToken({
              name: sanitizedName,
              symbol: sanitizedSymbol,
              description: sanitizedDescription,
              image: data.image ? Buffer.from(data.image, 'base64') : Buffer.from(''),
              imageContentType: data.imageContentType || 'image/png',
              website: data.website,
              twitter: data.twitter,
              telegram: data.telegram,
              initialBuyMon: devBuyMon,
            });

            tokenAddress = result.tokenAddress as `0x${string}`;
            deployTxHash = result.transactionHash;

            // Insert eigen config with bonding_curve status
            insertEigenConfig({
              eigenId,
              tokenAddress,
              tokenSymbol: sanitizedSymbol,
              tokenName: sanitizedName,
              class: agentClass,
              volumeTarget: data.volumeTarget ?? classConfig.volumeRange[0],
              tradeFrequency: Math.ceil((data.volumeTarget ?? classConfig.volumeRange[0]) * 2.4),
              orderSizeMin: classConfig.orderSize[0],
              orderSizeMax: classConfig.orderSize[1],
              spreadWidth: classConfig.spreadWidth[0],
              profitTarget: data.profitTarget ?? 50,
              stopLoss: data.stopLoss ?? 30,
              rebalanceThreshold: 0.7,
              walletCount: requestedWalletCount,
              ownerAddress,
              chainId: 143,
              gasBudgetEth: parseFloat(formatEther(gasBudget)),
              protocolFeeEth: parseFloat(formatEther(protocolFee)),
              poolAddress: result.poolAddress,
              poolVersion: 'nadfun',
            });
            insertProtocolFee(eigenId, formatEther(protocolFee), 'launch');

            updateGraduationStatus(eigenId, 'bonding_curve');
            restartGraduationMonitor();

            console.log(`[Launch] Monad nad.fun launch complete: token=${tokenAddress} pool=${result.poolAddress}`);

            // ── Fund sub-wallets with market-making MON ──────────────
            const tradingMon = volumeEth + liquidityEth;
            const wallets = getWalletsForEigen(eigenId, requestedWalletCount);
            const monPerWallet = wallets.length > 0 ? tradingMon / BigInt(wallets.length) : 0n;
            const fundingTxs: string[] = [];

            if (monPerWallet > 0n) {
              const masterWallet = getWalletClient(143);
              const monadClient = getPublicClient(143);
              const keeperAddr = getKeeperAddress();

              const baseNonce = await monadClient.getTransactionCount({ address: keeperAddr });

              const sendPromises = wallets.map((wallet, i) =>
                masterWallet.sendTransaction({
                  to: wallet.address,
                  value: monPerWallet,
                  nonce: baseNonce + i,
                }).then((txHash) => {
                  fundingTxs.push(txHash);
                  return txHash;
                }).catch((err) => {
                  console.error(`[Launch] Failed to fund wallet ${wallet.address}:`, err);
                  return null;
                }),
              );
              await Promise.all(sendPromises);

              await Promise.all(
                fundingTxs.map((tx) =>
                  monadClient.waitForTransactionReceipt({ hash: tx as `0x${string}` }).catch((e: unknown) => {
                    console.error(`[Launch] Failed to confirm funding tx ${tx}:`, e);
                  }),
                ),
              );

              console.log(`[Launch] Funded ${fundingTxs.length}/${wallets.length} wallets with ${formatEther(monPerWallet)} MON each`);
            }

            // ── Mint ERC-8004 agent NFT ─────────────────────────────
            if (isErc8004Enabled()) {
              try {
                agent8004Id = await registerAgent(eigenId, 143);
                console.log(`[Launch] Minted 8004 agent #${agent8004Id}`);
              } catch (err) {
                console.warn(`[Launch] 8004 registration failed (non-fatal):`, err);
              }
            }

            // Update payment record
            try {
              const paymentDb = getDb();
              paymentDb.prepare('UPDATE used_payments SET eigen_id = ? WHERE tx_hash = ?').run(eigenId, paymentTxHash);
            } catch { /* safe */ }

            return json(res, {
              success: true,
              tokenAddress,
              tokenSymbol: sanitizedSymbol,
              eigenId,
              agent8004Id,
              poolId: result.poolAddress || null,
              allocation: {
                totalEth: formatEther(totalEthReceived),
                devBuyEth: formatEther(devBuyEth),
                liquidityEth: '0',
                volumeEth: formatEther(tradingMon),
              },
              txHashes: {
                swap: swapTxHash || null,
                deploy: deployTxHash,
                lp: null,
              },
              fees: {
                protocolFee: formatEther(protocolFee),
                protocolFeeBps: PROTOCOL_FEE_BPS,
                gasBudget: formatEther(gasBudget),
                walletCount: requestedWalletCount,
                deployableEth: formatEther(deployableEth),
              },
              status: 'active',
              ownerAddress,
              graduationStatus: 'bonding_curve',
              walletsCreated: wallets.length,
              walletsFunded: fundingTxs.length,
              monPerWallet: formatEther(monPerWallet),
              launchMode: 'multi-step',
              liquidityReservedForV4: '0',
            }, 201);
          } catch (error) {
            deletePayment(paymentTxHash);
            const errMsg = (error as any)?.shortMessage || (error as Error).message;
            console.error('[Launch] Monad nad.fun launch failed:', errMsg);
            return json(res, { error: `Monad launch failed: ${errMsg}. Payment released — you can retry.` }, 500);
          }
        }
      }

      // ── Base paths (disabled — chainId=8453 is rejected above) ─────────
      const LP_ADDRESS = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;
      const FACTORY_ADDR = process.env.EIGENFACTORY_ADDRESS || EIGENFACTORY_ADDRESS;
      const useAtomicFactory = FACTORY_ADDR && FACTORY_ADDR !== '0x0000000000000000000000000000000000000000';

      if (useAtomicFactory && liquidityEth > 0n && devBuyEth > 0n) {
        // ── Path A: Fully atomic via EigenFactory ────────────────────
        console.log(`[Launch] Using atomic EigenFactory path`);

        try {
          // Build Clanker deploy calldata (without sending)
          // devBuy.recipient = EigenFactory so tokens land in the contract
          const clankerTx = await buildClankerDeployTx({
            name: sanitizedName,
            symbol: sanitizedSymbol,
            image: data.image,
            description: sanitizedDescription,
            tokenAdmin: ownerAddress as `0x${string}`,
            feeType: data.feeType || 'static',
            devBuyEth: parseFloat(formatEther(devBuyEth)),
            devBuyRecipient: FACTORY_ADDR as `0x${string}`,
          });

          tokenAddress = clankerTx.expectedAddress;

          // Insert eigen config before launch (needed for agent card)
          insertEigenConfig({
            eigenId,
            tokenAddress,
            tokenSymbol: sanitizedSymbol,
            tokenName: sanitizedName,
            class: agentClass,
            volumeTarget: data.volumeTarget ?? classConfig.volumeRange[0],
            tradeFrequency: Math.ceil((data.volumeTarget ?? classConfig.volumeRange[0]) * 2.4),
            orderSizeMin: classConfig.orderSize[0],
            orderSizeMax: classConfig.orderSize[1],
            spreadWidth: classConfig.spreadWidth[0],
            profitTarget: data.profitTarget ?? 50,
            stopLoss: data.stopLoss ?? 30,
            rebalanceThreshold: 0.7,
            walletCount: requestedWalletCount,
            ownerAddress,
            chainId: 143,
            gasBudgetEth: parseFloat(formatEther(gasBudget)),
            protocolFeeEth: parseFloat(formatEther(protocolFee)),
          });
          insertProtocolFee(eigenId, formatEther(protocolFee), 'launch');

          // Build agent card
          const config = getEigenConfig(eigenId);
          const agentCard = buildAgentCard(eigenId, config!, {
            totalBuys: 0, totalSells: 0, winRate: 0, totalRealizedPnl: 0,
          });
          const agentURI = JSON.stringify(agentCard);

          // Calculate sqrtPriceX96 for EigenLP from initial Clanker tick
          // Use a default initial price (Clanker starts at ~0.00005 ETH/token)
          // This is safe because in the atomic path, no one can manipulate it
          const defaultSqrtPriceX96 = 5602277097478614n;

          // Single tx: deploy + LP + vault + 8004
          const result = await atomicDeployAndLaunch({
            eigenId,
            clankerTx,
            sqrtPriceX96: defaultSqrtPriceX96,
            lpEthAmount: liquidityEth,
            vaultDepositEth: volumeEth,
            tradingFeeBps: BigInt(classConfig.protocolFee * 100),
            agentURI,
            onBehalfOf: ownerAddress as `0x${string}`,
          });

          tokenAddress = result.tokenAddress;
          deployTxHash = result.txHash;
          lpPoolId = result.poolId;
          lpTokenId = result.tokenId;
          lpTxHash = result.txHash;
          agent8004Id = result.agentId;

          // Store agent ID in DB
          if (agent8004Id) {
            const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
            updateAgent8004Id(eigenId, agent8004Id, 8453, `${baseUrl}/api/eigens/${eigenId}/agent-card`);
          }

          console.log(`[Launch] Atomic factory launch complete: token=${tokenAddress}, poolId=${lpPoolId}, agentId=${agent8004Id}`);
        } catch (error) {
          deletePayment(paymentTxHash);
          const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
          const txHash = (error as any)?.cause?.transactionHash || (error as any)?.transactionHash || null;
          console.error('[Launch] Atomic factory launch failed:', errMsg);
          if (txHash) console.error('[Launch] Failed tx hash (debug on Tenderly):', txHash);
          console.error('[Launch] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error as any), 2)?.slice(0, 1000));
          return json(res, { error: `Atomic launch failed: ${errMsg}. Payment released — you can retry.`, txHash }, 500);
        }
      } else {
        // ── Path B: Fallback — separate Clanker deploy + EigenLauncher ──
        console.log(`[Launch] Using fallback 2-step path`);

        try {
          const deployResult = await deployBaseToken({
            name: sanitizedName,
            symbol: sanitizedSymbol,
            image: data.image,
            description: sanitizedDescription,
            tokenAdmin: ownerAddress as `0x${string}`,
            feeType: data.feeType || 'static',
            devBuyEth: devBuyEth > 0n ? parseFloat(formatEther(devBuyEth)) : 0,
          });
          tokenAddress = deployResult.tokenAddress;
          deployTxHash = deployResult.txHash;
          console.log(`[Launch] Token deployed: ${tokenAddress}`);
        } catch (error) {
          deletePayment(paymentTxHash);
          console.error('[Launch] Token deployment failed:', (error as Error).message);
          return json(res, { error: 'Token deployment failed. Payment released — you can retry.' }, 500);
        }

        // Insert eigen config
        insertEigenConfig({
          eigenId,
          tokenAddress,
          tokenSymbol: sanitizedSymbol,
          tokenName: sanitizedName,
          class: agentClass,
          volumeTarget: data.volumeTarget ?? classConfig.volumeRange[0],
          tradeFrequency: Math.ceil((data.volumeTarget ?? classConfig.volumeRange[0]) * 2.4),
          orderSizeMin: classConfig.orderSize[0],
          orderSizeMax: classConfig.orderSize[1],
          spreadWidth: classConfig.spreadWidth[0],
          profitTarget: data.profitTarget ?? 50,
          stopLoss: data.stopLoss ?? 30,
          rebalanceThreshold: 0.7,
          walletCount: requestedWalletCount,
          ownerAddress,
          chainId: 143,
          gasBudgetEth: parseFloat(formatEther(gasBudget)),
          protocolFeeEth: parseFloat(formatEther(protocolFee)),
        });
        insertProtocolFee(eigenId, formatEther(protocolFee), 'launch');

        console.log(`[Launch] Eigen config registered: ${eigenId}`);

        if (liquidityEth > 0n) {
          try {
            // Wait for Clanker pool to be initialized on-chain
            if (process.env.X402_TEST_MODE !== 'true') {
              await new Promise((r) => setTimeout(r, 3000));
            }

            const sqrtPriceX96 = await readClankerPoolPrice(tokenAddress);
            if (!sqrtPriceX96) {
              console.warn('[Launch] Could not read Clanker pool price — skipping LP seed');
            } else {
              console.log(`[Launch] Clanker pool sqrtPriceX96: ${sqrtPriceX96}`);

              // Read token balance in keeper wallet (from dev buy)
              let tokenBalance: bigint;
              if (process.env.X402_TEST_MODE === 'true') {
                tokenBalance = 1000000000000000000000000n;
              } else {
                const tokenClient = getPublicClient(143);
                tokenBalance = await tokenClient.readContract({
                  address: tokenAddress,
                  abi: [{ type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const,
                  functionName: 'balanceOf',
                  args: [getKeeperAddress()],
                }) as bigint;
              }

              if (tokenBalance > 0n) {
                const config = getEigenConfig(eigenId);
                const agentCard = buildAgentCard(eigenId, config!, {
                  totalBuys: 0, totalSells: 0, winRate: 0, totalRealizedPnl: 0,
                });
                const agentURI = JSON.stringify(agentCard);

                const launchResult = await seedBaseLPWithAgent({
                  eigenId,
                  tokenAddress,
                  sqrtPriceX96,
                  tokenAmount: tokenBalance,
                  lpEthAmount: liquidityEth,
                  vaultDepositEth: volumeEth,
                  tradingFeeBps: BigInt(classConfig.protocolFee * 100),
                  agentURI,
                  onBehalfOf: ownerAddress as `0x${string}`,
                });
                lpPoolId = launchResult.poolId;
                lpTokenId = launchResult.tokenId;
                lpTxHash = launchResult.txHash;
                agent8004Id = launchResult.agentId;

                if (agent8004Id) {
                  const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
                  updateAgent8004Id(eigenId, agent8004Id, 8453, `${baseUrl}/api/eigens/${eigenId}/agent-card`);
                }

                console.log(`[Launch] Fallback launch complete: poolId=${lpPoolId}, tokenId=${lpTokenId}, agentId=${agent8004Id}`);
              } else {
                console.warn('[Launch] No tokens in keeper wallet — skipping LP seed');
              }
            }
          } catch (error) {
            const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
            console.error('[Launch] LP seed / agent mint failed:', errMsg);
            lpTxHash = `error: ${errMsg}`;
            // Mark eigen as pending_lp so frontend knows vault doesn't exist on-chain
            updateEigenConfigStatus(eigenId, 'pending_lp');
          }
        }
      }

      // Update eigen config with LP data (if LP seed succeeded)
      const hasValidPool = lpPoolId && lpPoolId !== '0x' && lpPoolId !== ('0x' + '0'.repeat(64));
      if (hasValidPool) {
        const db = getDb();
        db.prepare(`
          UPDATE eigen_configs SET
            lp_pool_id = ?, lp_token_id = ?, lp_pool_fee = ?,
            lp_pool_tick_spacing = ?, lp_contract_address = ?,
            pool_address = ?, pool_version = 'v4', pool_fee = ?,
            pool_tick_spacing = ?
          WHERE eigen_id = ?
        `).run(lpPoolId, lpTokenId, EIGENLP_FEE, EIGENLP_TICK_SPACING, LP_ADDRESS,
          LP_ADDRESS, EIGENLP_FEE, EIGENLP_TICK_SPACING, eigenId);
        console.log(`[Launch] Eigen config updated with LP data: poolId=${lpPoolId}, tokenId=${lpTokenId}`);
      } else {
        console.warn(`[Launch] No valid LP pool data to store (poolId=${lpPoolId})`);
      }

      // Update payment record with final eigenId
      try {
        const paymentDb = getDb();
        paymentDb.prepare(
          'UPDATE used_payments SET eigen_id = ? WHERE tx_hash = ?',
        ).run(eigenId, paymentTxHash);
      } catch { /* safe */ }

      // Determine final status: if vault/LP creation failed, status is pending_lp
      const vaultCreated = hasValidPool && lpTxHash && !lpTxHash.startsWith('error:');
      const finalStatus = vaultCreated ? 'active' : 'pending_lp';

      return json(res, {
        success: true,
        tokenAddress,
        tokenSymbol: sanitizedSymbol,
        eigenId,
        agent8004Id,
        poolId: lpPoolId || null,
        allocation: {
          totalEth: formatEther(totalEthReceived),
          devBuyEth: formatEther(devBuyEth),
          liquidityEth: formatEther(liquidityEth),
          volumeEth: formatEther(volumeEth),
        },
        txHashes: {
          swap: swapTxHash || null,
          deploy: deployTxHash,
          lp: lpTxHash || null,
        },
        fees: {
          protocolFee: formatEther(protocolFee),
          protocolFeeBps: PROTOCOL_FEE_BPS,
          gasBudget: formatEther(gasBudget),
          walletCount: requestedWalletCount,
          deployableEth: formatEther(deployableEth),
        },
        status: finalStatus,
        ownerAddress,
        warning: !vaultCreated ? 'Token deployed but vault/LP creation failed. Use /api/eigens/:id/seed-lp to retry.' : undefined,
      }, 201);
    } catch (error) {
      console.error('[Launch] Failed:', (error as Error).message);
      // Try to release payment lock if we have a tx hash (may not exist if error was in early parsing)
      try {
        const ethPay = req.headers['x-eth-payment'] as string | undefined;
        const usdcPay = req.headers['x-payment'] as string | undefined;
        const txHash = ethPay || usdcPay;
        if (txHash) deletePayment(txHash);
      } catch { /* safe */ }
      return json(res, { error: 'Launch failed' }, 500);
    }
  }

  // POST /api/eigens/:id/seed-lp — retry LP seed + vault + 8004 for a failed launch
  const seedLpMatch = path.match(/^\/api\/eigens\/([^/]+)\/seed-lp$/);
  if (method === 'POST' && seedLpMatch) {
    const eigenId = resolveEigenId(seedLpMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      // Check if LP already seeded
      if (config.lp_pool_id) {
        return json(res, { error: 'LP already seeded', poolId: config.lp_pool_id }, 409);
      }

      const tokenAddress = config.token_address as `0x${string}`;
      const ownerAddress = config.owner_address as `0x${string}`;
      const classConfig = CLASS_CONFIGS[config.class as AgentClass];
      if (!classConfig) return json(res, { error: `Unknown class: ${config.class}` }, 400);

      const LP_ADDR = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;

      // Read Clanker pool price
      console.log(`[SeedLP] Reading Clanker pool price for ${tokenAddress}...`);
      const sqrtPriceX96 = await readClankerPoolPrice(tokenAddress);
      if (!sqrtPriceX96) {
        return json(res, { error: 'Could not read Clanker pool price — pool may not be initialized' }, 400);
      }
      console.log(`[SeedLP] sqrtPriceX96: ${sqrtPriceX96}`);

      // Read token balance
      const tokenClient = getPublicClient(143);
      const tokenBalance = await tokenClient.readContract({
        address: tokenAddress,
        abi: [{ type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const,
        functionName: 'balanceOf',
        args: [getKeeperAddress()],
      }) as bigint;

      if (tokenBalance <= 0n) {
        return json(res, { error: 'No tokens in keeper wallet' }, 400);
      }

      // Parse body for ETH amounts (optional override)
      let lpEthAmount: bigint;
      let vaultDepositEth: bigint;
      try {
        const body = await readBody(req);
        const data = body ? JSON.parse(body) : {};
        lpEthAmount = data.lpEthAmount ? BigInt(data.lpEthAmount) : parseEther('0.0003');
        vaultDepositEth = data.vaultDepositEth ? BigInt(data.vaultDepositEth) : parseEther('0.0001');
      } catch {
        lpEthAmount = parseEther('0.0003');
        vaultDepositEth = parseEther('0.0001');
      }

      // Check keeper ETH balance
      const keeperEth = await tokenClient.getBalance({ address: getKeeperAddress() });
      const totalNeeded = lpEthAmount + vaultDepositEth + parseEther('0.0005'); // + gas buffer
      if (keeperEth < totalNeeded) {
        return json(res, {
          error: `Insufficient ETH: have ${formatEther(keeperEth)}, need ~${formatEther(totalNeeded)} (LP=${formatEther(lpEthAmount)}, vault=${formatEther(vaultDepositEth)}, gas≈0.0005)`,
        }, 400);
      }

      console.log(`[SeedLP] Starting LP seed for ${eigenId}: token=${tokenAddress}, tokenBalance=${tokenBalance}, lpEth=${formatEther(lpEthAmount)}, vaultEth=${formatEther(vaultDepositEth)}`);

      let result: { poolId: string; tokenId: number; agentId?: string; txHash: string };

      // Use direct seedPool path (no bundler required) — works without redeploying EigenVault
      const lpResult = await seedBaseLPDirect({
        eigenId,
        tokenAddress,
        sqrtPriceX96,
        tokenAmount: tokenBalance,
        ethAmount: lpEthAmount,
      });
      result = { poolId: lpResult.poolId, tokenId: lpResult.tokenId, txHash: lpResult.txHash };

      // Create vault on EigenVault (if vaultDepositEth > 0)
      let vaultCreated = false;
      if (vaultDepositEth > 0n) {
        try {
          const vaultAddr = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
          const vaultWallet = getWalletClient(143);
          const vaultPublic = getPublicClient(143);
          const bytes32Id = eigenIdToBytes32(eigenId);
          const tradingFeeBps = BigInt((classConfig.protocolFee || 2) * 100);

          const ownerAddr = config.owner_address as `0x${string}`;
          console.log(`[SeedLP] Creating vault: deposit=${formatEther(vaultDepositEth)} ETH, feeBps=${tradingFeeBps}, owner=${ownerAddr}`);
          const vaultTx = await vaultWallet.writeContract({
            address: vaultAddr,
            abi: EIGENVAULT_ABI,
            functionName: 'createEigenFor',
            args: [bytes32Id, tradingFeeBps, ownerAddr],
            value: vaultDepositEth,
          });
          await vaultPublic.waitForTransactionReceipt({ hash: vaultTx });
          vaultCreated = true;
          console.log(`[SeedLP] Vault created: ${vaultTx}`);
        } catch (err) {
          console.error(`[SeedLP] Vault creation failed (non-fatal):`, (err as Error).message);
        }
      }

      // Mint 8004 agent separately (from keeper EOA)
      try {
        const agent8004 = await registerAgent(eigenId, 143);
        if (agent8004) {
          result.agentId = agent8004;
          const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
          updateAgent8004Id(eigenId, agent8004, 8453, `${baseUrl}/api/eigens/${eigenId}/agent-card`);
          console.log(`[SeedLP] 8004 agent minted: #${agent8004}`);
        }
      } catch (err) {
        console.error(`[SeedLP] 8004 agent mint failed (non-fatal):`, (err as Error).message);
      }

      // Update DB with LP data
      const db = getDb();
      db.prepare(`
        UPDATE eigen_configs SET
          lp_pool_id = ?, lp_token_id = ?, lp_pool_fee = ?,
          lp_pool_tick_spacing = ?, lp_contract_address = ?
        WHERE eigen_id = ?
      `).run(result.poolId, result.tokenId, EIGENLP_FEE, EIGENLP_TICK_SPACING, LP_ADDR, eigenId);

      console.log(`[SeedLP] Complete: poolId=${result.poolId}, tokenId=${result.tokenId}, agentId=${result.agentId || 'none'}`);

      return json(res, {
        success: true,
        eigenId,
        poolId: result.poolId,
        tokenId: result.tokenId,
        agentId: result.agentId || null,
        txHash: result.txHash,
      });
    } catch (error) {
      const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
      console.error(`[SeedLP] Failed for ${eigenId}:`, errMsg);
      return json(res, { error: errMsg }, 500);
    }
  }

  // POST /api/eigens/:id/create-vault — create vault eigen on EigenVault
  const createVaultMatch = path.match(/^\/api\/eigens\/([^/]+)\/create-vault$/);
  if (method === 'POST' && createVaultMatch) {
    const eigenId = resolveEigenId(createVaultMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const vaultAddr = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
      const vaultWallet = getWalletClient(143);
      const vaultPublic = getPublicClient(143);
      const bytes32Id = eigenIdToBytes32(eigenId);

      // Check if vault already exists on-chain
      const eigenActive = await vaultPublic.readContract({
        address: vaultAddr,
        abi: EIGENVAULT_ABI,
        functionName: 'eigenActive',
        args: [bytes32Id],
      });
      if (eigenActive) {
        return json(res, { error: 'Vault already exists', eigenId }, 409);
      }

      // Parse body for ETH deposit amount
      let depositEth: bigint;
      try {
        const body = await readBody(req);
        const data = body ? JSON.parse(body) : {};
        depositEth = data.depositEth ? BigInt(data.depositEth) : parseEther('0.001');
      } catch {
        depositEth = parseEther('0.001');
      }

      const classConfig = CLASS_CONFIGS[config.class as AgentClass];
      const tradingFeeBps = BigInt((classConfig?.protocolFee || 2) * 100);

      // Check keeper ETH balance
      const keeperEth = await vaultPublic.getBalance({ address: getKeeperAddress() });
      if (keeperEth < depositEth + parseEther('0.0005')) {
        return json(res, { error: `Insufficient ETH: have ${formatEther(keeperEth)}, need ${formatEther(depositEth)} + gas` }, 400);
      }

      const ownerAddress = config.owner_address as `0x${string}`;
      console.log(`[CreateVault] Creating vault for ${eigenId}: deposit=${formatEther(depositEth)} ETH, feeBps=${tradingFeeBps}, owner=${ownerAddress}`);
      const vaultTx = await vaultWallet.writeContract({
        address: vaultAddr,
        abi: EIGENVAULT_ABI,
        functionName: 'createEigenFor',
        args: [bytes32Id, tradingFeeBps, ownerAddress],
        value: depositEth,
      });
      await vaultPublic.waitForTransactionReceipt({ hash: vaultTx });
      console.log(`[CreateVault] Vault created: ${vaultTx}`);

      return json(res, { success: true, eigenId, txHash: vaultTx, depositEth: formatEther(depositEth) });
    } catch (error) {
      const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
      console.error(`[CreateVault] Failed for ${eigenId}:`, errMsg);
      return json(res, { error: errMsg }, 500);
    }
  }

  // POST /api/eigens/:id/register-agent — mint 8004 agent for an eigen
  const registerAgentMatch = path.match(/^\/api\/eigens\/([^/]+)\/register-agent$/);
  if (method === 'POST' && registerAgentMatch) {
    const eigenId = resolveEigenId(registerAgentMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);
      if (config.agent_8004_id) {
        return json(res, { error: 'Agent already registered', agentId: config.agent_8004_id }, 409);
      }

      console.log(`[RegisterAgent] Minting 8004 agent for ${eigenId}...`);
      const agentId = await registerAgent(eigenId, 143);
      const baseUrl = process.env.EIGENSWARM_BASE_URL || 'https://eigenswarm.com';
      console.log(`[RegisterAgent] Agent minted: #${agentId}`);

      return json(res, { success: true, eigenId, agentId, agentCardUri: `${baseUrl}/api/eigens/${eigenId}/agent-card` });
    } catch (error) {
      const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
      console.error(`[RegisterAgent] Failed for ${eigenId}:`, errMsg);
      return json(res, { error: errMsg }, 500);
    }
  }

  // PATCH /api/eigens/:id — update eigen config parameters
  const patchEigenMatch = path.match(/^\/api\/eigens\/([^/]+)$/);
  if (method === 'PATCH' && patchEigenMatch) {
    const eigenId = resolveEigenId(patchEigenMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      if (!data.ownerAddress || !data.signature || !data.timestamp) {
        return json(res, { error: 'ownerAddress, signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const adjustMsg = buildAdjustMessage(eigenId, data.ownerAddress, data.timestamp);
      const adjustValid = await verifyEip191(adjustMsg, data.signature, data.ownerAddress);
      if (!adjustValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      // Check ownership against config, ponder, and on-chain vault
      const callerAddress = data.ownerAddress.toLowerCase();
      const isOwner = await verifyEigenOwnership(eigenId, callerAddress, config.owner_address, config.chain_id);
      if (!isOwner) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      // Validate and extract allowed update fields
      const validationError = validateEigenConfigInput(data.config || {});
      if (validationError) {
        return json(res, { error: validationError }, 400);
      }

      const cfg = data.config || {};
      const updates: Record<string, number | string | null> = {};
      const fieldMap: Record<string, string> = {
        volumeTarget: 'volume_target',
        tradeFrequency: 'trade_frequency',
        orderSizeMin: 'order_size_min',
        orderSizeMax: 'order_size_max',
        orderSizePctMin: 'order_size_pct_min',
        orderSizePctMax: 'order_size_pct_max',
        spreadWidth: 'spread_width',
        profitTarget: 'profit_target',
        stopLoss: 'stop_loss',
        rebalanceThreshold: 'rebalance_threshold',
        walletCount: 'wallet_count',
        slippageBps: 'slippage_bps',
        reactiveSellMode: 'reactive_sell_mode',
        reactiveSellPct: 'reactive_sell_pct',
        customPrompt: 'custom_prompt',
      };

      for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
        if (cfg[camelKey] !== undefined) {
          // customPrompt can be a string or null (to clear it)
          if (camelKey === 'customPrompt') {
            updates[snakeKey] = cfg[camelKey] === '' ? null : cfg[camelKey];
          } else {
            updates[snakeKey] = cfg[camelKey];
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        return json(res, { error: 'No valid config fields to update' }, 400);
      }

      updateEigenConfig(eigenId, updates as any);
      console.log(`[API] Updated config for ${eigenId}: ${Object.keys(updates).join(', ')}`);

      const updated = getEigenConfig(eigenId);
      return json(res, { success: true, config: updated });
    } catch (error) {
      console.error('[API] Failed to update config:', (error as Error).message);
      return json(res, { error: 'Failed to update config' }, 500);
    }
  }

  // POST /api/eigens/:id/remove-lp — keeper removes LP on behalf of user (workaround for ownership bug)
  const removeLpMatch = path.match(/^\/api\/eigens\/([^/]+)\/remove-lp$/);
  if (method === 'POST' && removeLpMatch) {
    const eigenId = resolveEigenId(removeLpMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      // Verify the request is from the actual owner
      const body = JSON.parse(await readBody(req));
      const callerAddress = (body?.owner_address || '').toLowerCase();
      if (!callerAddress || callerAddress !== config.owner_address?.toLowerCase()) {
        return json(res, { error: 'Not authorized — owner mismatch' }, 403);
      }

      const LP_ADDR = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;
      const wallet = getWalletClient(143);
      const client = getPublicClient(143);
      const bytes32Id = eigenIdToBytes32(eigenId);

      // Verify LP position exists
      const position = await client.readContract({
        address: LP_ADDR,
        abi: EIGENLP_ABI,
        functionName: 'getPosition',
        args: [bytes32Id],
      }) as any[];

      const tokenId = position[0] as bigint;
      if (!tokenId || tokenId === 0n) {
        return json(res, { error: 'No LP position found' }, 404);
      }

      // Get keeper's ETH + token balances before
      const keeperAddr = getKeeperAddress();
      const tokenAddr = position[2] as `0x${string}`;
      const ethBefore = await client.getBalance({ address: keeperAddr });
      const tokenBefore = tokenAddr ? await client.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [keeperAddr],
      }) as bigint : 0n;

      // Keeper calls removeLiquidity (keeper is pos.eigenOwner due to seeding bug)
      // Pass 0n for min amounts — keeper-side removal, no MEV risk
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: LP_ADDR,
        abi: EIGENLP_ABI,
        functionName: 'removeLiquidity',
        args: [bytes32Id],
      });
      const txHash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });

      // Check what the keeper received
      const ethAfter = await client.getBalance({ address: keeperAddr });
      const tokenAfter = tokenAddr ? await client.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [keeperAddr],
      }) as bigint : 0n;

      const ethReceived = ethAfter - ethBefore;
      const tokenReceived = tokenAfter - tokenBefore;
      const ownerAddr = config.owner_address as `0x${string}`;

      // Forward ETH to user
      let ethTxHash: string | null = null;
      if (ethReceived > 0n) {
        const ethTx = await wallet.sendTransaction({
          account: wallet.account!,
          chain: wallet.chain,
          to: ownerAddr,
          value: BigInt(ethReceived),
        });
        await client.waitForTransactionReceipt({ hash: ethTx, timeout: 90_000 });
        ethTxHash = ethTx;
      }

      // Forward tokens to user
      let tokenTxHash: string | null = null;
      if (tokenReceived > 0n && tokenAddr) {
        const tokenTx = await wallet.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ownerAddr, tokenReceived],
        });
        await client.waitForTransactionReceipt({ hash: tokenTx, timeout: 90_000 });
        tokenTxHash = tokenTx;
      }

      console.log(`[RemoveLP] ${eigenId}: removed LP, forwarded ${ethReceived} ETH + ${tokenReceived} tokens to ${ownerAddr}`);

      return json(res, {
        success: true,
        eigenId,
        removeTxHash: txHash,
        ethReceived: ethReceived.toString(),
        tokenReceived: tokenReceived.toString(),
        ethForwardTxHash: ethTxHash,
        tokenForwardTxHash: tokenTxHash,
      });
    } catch (error) {
      const errMsg = (error as any)?.shortMessage || (error as any)?.details || (error as Error).message;
      console.error(`[RemoveLP] Failed for ${eigenId}:`, errMsg);
      return json(res, { error: errMsg }, 500);
    }
  }

  // POST /api/eigens/:id/liquidate — begin liquidation process
  const liquidateMatch = path.match(/^\/api\/eigens\/([^/]+)\/liquidate$/);
  if (method === 'POST' && liquidateMatch) {
    const eigenId = resolveEigenId(liquidateMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      // Validate ownership via signed request body
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      if (!data.ownerAddress) {
        return json(res, { error: 'ownerAddress required' }, 400);
      }

      if (!data.signature || !data.timestamp) {
        return json(res, { error: 'signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const liquidateMsg = buildLiquidateMessage(eigenId, data.ownerAddress, data.timestamp);
      const liquidateValid = await verifyEip191(liquidateMsg, data.signature, data.ownerAddress);
      if (!liquidateValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      const callerAddress = (data.ownerAddress || '').toLowerCase();
      const isOwner = await verifyEigenOwnership(eigenId, callerAddress, config.owner_address, config.chain_id);
      if (!isOwner) {
        return json(res, { error: 'Unauthorized: ownerAddress must match the eigen owner' }, 403);
      }

      if (config.status === 'liquidating' || config.status === 'liquidated') {
        return json(res, { status: config.status, eigenId });
      }

      updateEigenConfigStatus(eigenId, 'liquidating');
      console.log(`[API] Eigen ${eigenId} marked for liquidation`);
      return json(res, { status: 'liquidating', eigenId });
    } catch (error) {
      console.error('[API] Failed to initiate liquidation:', (error as Error).message);
      return json(res, { error: 'Failed to initiate liquidation' }, 500);
    }
  }

  // POST /api/eigens/:id/take-profit — trigger distributed sells across sub-wallets
  const takeProfitMatch = path.match(/^\/api\/eigens\/([^/]+)\/take-profit$/);
  if (method === 'POST' && takeProfitMatch) {
    const eigenId = resolveEigenId(takeProfitMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      if (!data.ownerAddress) {
        return json(res, { error: 'ownerAddress required' }, 400);
      }

      if (!data.signature || !data.timestamp) {
        return json(res, { error: 'signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const takeProfitMsg = buildTakeProfitMessage(eigenId, data.ownerAddress, data.timestamp);
      const takeProfitValid = await verifyEip191(takeProfitMsg, data.signature, data.ownerAddress);
      if (!takeProfitValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      const callerAddress = (data.ownerAddress || '').toLowerCase();
      const isOwner = await verifyEigenOwnership(eigenId, callerAddress, config.owner_address, config.chain_id);
      if (!isOwner) {
        return json(res, { error: 'Unauthorized: ownerAddress must match the eigen owner' }, 403);
      }

      const percent = typeof data.percent === 'number' && data.percent > 0 && data.percent <= 100
        ? data.percent
        : 100;

      console.log(`[API] Take profit for ${eigenId}: ${percent}%`);

      // Execute take profit asynchronously — respond immediately
      executeTakeProfit(eigenId, percent).catch((error) => {
        console.error(`[API] Take profit execution failed for ${eigenId}:`, (error as Error).message);
      });

      return json(res, { status: 'executing', eigenId, percent });
    } catch (error) {
      console.error('[API] Failed to initiate take profit:', (error as Error).message);
      return json(res, { error: 'Failed to initiate take profit' }, 500);
    }
  }

  // DELETE /api/eigens/:id — delete eigen config (only for terminated/closed/liquidated eigens)
  const deleteEigenMatch = path.match(/^\/api\/eigens\/([^/]+)$/);
  if (method === 'DELETE' && deleteEigenMatch) {
    const eigenId = resolveEigenId(deleteEigenMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      if (!data.ownerAddress || !data.signature || !data.timestamp) {
        return json(res, { error: 'ownerAddress, signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const deleteMsg = buildDeleteMessage(eigenId, data.ownerAddress, data.timestamp);
      const deleteValid = await verifyEip191(deleteMsg, data.signature, data.ownerAddress);
      if (!deleteValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      const callerAddress = data.ownerAddress.toLowerCase();
      const isOwner = await verifyEigenOwnership(eigenId, callerAddress, config.owner_address, config.chain_id);
      if (!isOwner) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      // Only allow deletion for terminal statuses
      const terminalStatuses = ['terminated', 'closed', 'liquidated'];
      if (!terminalStatuses.includes(config.status)) {
        return json(res, { error: `Cannot delete eigen with status '${config.status}'. Must be terminated, closed, or liquidated.` }, 400);
      }

      deleteEigenConfig(eigenId);
      console.log(`[API] Deleted eigen config: ${eigenId} by ${callerAddress}`);
      return json(res, { success: true, eigenId });
    } catch (error) {
      console.error('[API] Failed to delete eigen:', (error as Error).message);
      return json(res, { error: 'Failed to delete eigen' }, 500);
    }
  }

  // POST /api/eigens/:id/terminate — terminate eigen via signed request
  const terminateApiMatch = path.match(/^\/api\/eigens\/([^/]+)\/terminate$/);
  if (method === 'POST' && terminateApiMatch) {
    const eigenId = resolveEigenId(terminateApiMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      if (!data.ownerAddress || !data.signature || !data.timestamp) {
        return json(res, { error: 'ownerAddress, signature and timestamp required' }, 400);
      }

      if (!isTimestampValid(data.timestamp)) {
        return json(res, { error: 'Signature expired or invalid timestamp' }, 400);
      }

      const terminateMsg = buildTerminateApiMessage(eigenId, data.ownerAddress, data.timestamp);
      const terminateValid = await verifyEip191(terminateMsg, data.signature, data.ownerAddress);
      if (!terminateValid) {
        return json(res, { error: 'Invalid signature' }, 403);
      }

      const callerAddress = data.ownerAddress.toLowerCase();
      const isOwner = await verifyEigenOwnership(eigenId, callerAddress, config.owner_address, config.chain_id);
      if (!isOwner) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      if (config.status === 'terminated') {
        return json(res, { success: true, eigenId, message: 'Already terminated' });
      }

      updateEigenConfigStatus(eigenId, 'terminated');
      console.log(`[API] Terminated eigen: ${eigenId} by ${callerAddress}`);
      return json(res, { success: true, eigenId });
    } catch (error) {
      console.error('[API] Failed to terminate eigen:', (error as Error).message);
      return json(res, { error: 'Failed to terminate eigen' }, 500);
    }
  }

  // POST /api/eigens/:id/seed-v4-pool — create V4 pool and seed LP on Monad
  const seedPoolMatch = path.match(/^\/api\/eigens\/([^/]+)\/seed-v4-pool$/);
  if (method === 'POST' && seedPoolMatch) {
    const eigenId = resolveEigenId(seedPoolMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);
      if (config.chain_id !== 143) return json(res, { error: 'Only Monad eigens can seed V4 pools' }, 400);
      if (config.lp_token_id) return json(res, { error: 'LP position already exists' }, 409);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      // Auth
      const auth = await authenticateRequest(req, data, buildRegisterMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 400);
      }

      // Verify ownership (config → ponder → on-chain vault)
      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      // Parse amounts — use parseEther for MON to avoid float precision loss
      const tokenAmount = data.tokenAmount ? BigInt(data.tokenAmount) : 0n;
      const monAmount = data.monAmount ? parseEther(String(data.monAmount)) : 0n;

      if (tokenAmount <= 0n && monAmount <= 0n) {
        return json(res, { error: 'tokenAmount or monAmount required' }, 400);
      }

      // Calculate sqrtPriceX96 from price or use provided value
      let sqrtPriceX96: bigint;
      if (data.sqrtPriceX96) {
        sqrtPriceX96 = BigInt(data.sqrtPriceX96);
      } else if (data.priceMonPerToken) {
        // price = MON per token (how many tokens per 1 MON)
        sqrtPriceX96 = priceToSqrtPriceX96(parseFloat(data.priceMonPerToken));
      } else {
        return json(res, { error: 'sqrtPriceX96 or priceMonPerToken required' }, 400);
      }

      console.log(`[API] Seeding V4 pool for ${eigenId}: ${formatEther(monAmount)} MON`);

      const result = await createMonadV4Pool({
        eigenId,
        tokenAddress: config.token_address as `0x${string}`,
        sqrtPriceX96,
        tokenAmount,
        monAmount,
      });

      return json(res, {
        success: true,
        poolId: result.poolId,
        tokenId: result.tokenId.toString(),
        txHash: result.txHash,
      }, 201);
    } catch (error) {
      console.error('[API] V4 pool seed failed:', (error as Error).message);
      return json(res, { error: 'Pool seed failed' }, 500);
    }
  }

  // ── Treasury Health ──────────────────────────────────────────────────

  if (method === 'GET' && path === '/api/treasury') {
    try {
      const health = await checkTreasuryHealth();
      return json(res, health);
    } catch (error) {
      console.error('[API] Failed to check treasury:', (error as Error).message);
      return json(res, { error: 'Failed to check treasury' }, 500);
    }
  }

  // ── Agent API Key Management ─────────────────────────────────────────

  // POST /api/agent/keys — generate a new API key (authenticated via EIP-191)
  if (method === 'POST' && path === '/api/agent/keys') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      const auth = await authenticateRequest(req, data, buildRegisterMessage.bind(null, 'agent-key'));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 400);
      }

      const label = typeof data.label === 'string' ? data.label.slice(0, 100) : '';
      const rateLimit = typeof data.rateLimit === 'number' && data.rateLimit > 0 && data.rateLimit <= 600
        ? data.rateLimit
        : 60;

      const rawKey = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12);

      insertAgentApiKey({
        keyHash,
        keyPrefix,
        ownerAddress: auth.ownerAddress!,
        label,
        rateLimit,
      });

      console.log(`[API] Agent API key created for ${auth.ownerAddress!.slice(0, 10)}... (prefix: ${keyPrefix})`);

      // Return the raw key ONLY on creation — it cannot be retrieved again
      return json(res, {
        success: true,
        apiKey: rawKey,
        prefix: keyPrefix,
        label,
        rateLimit,
        warning: 'Store this key securely. It cannot be retrieved after this response.',
      }, 201);
    } catch (error) {
      console.error('[API] Invalid request:', (error as Error).message);
      return json(res, { error: 'Invalid request' }, 400);
    }
  }

  // GET /api/agent/keys — list your API keys (authenticated)
  if (method === 'GET' && path === '/api/agent/keys') {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'X-API-KEY header required' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }
    touchAgentApiKey(keyHash);

    const keys = getAgentApiKeysByOwner(keyRecord.owner_address);
    return json(res, {
      data: keys.map((k) => ({
        id: k.id,
        prefix: k.key_prefix,
        label: k.label,
        rateLimit: k.rate_limit,
        active: k.active === 1,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
      })),
    });
  }

  // DELETE /api/agent/keys/:prefix — revoke an API key
  const deleteKeyMatch = path.match(/^\/api\/agent\/keys\/([a-zA-Z0-9_]+)$/);
  if (method === 'POST' && deleteKeyMatch && path.includes('/revoke')) {
    // Handle as POST /api/agent/keys/:prefix/revoke for compatibility
  }
  if ((method === 'DELETE' || method === 'POST') && deleteKeyMatch) {
    const prefix = deleteKeyMatch[1]!;
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'X-API-KEY header required' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }

    // Find the key to revoke among the owner's keys
    const keys = getAgentApiKeysByOwner(keyRecord.owner_address);
    const target = keys.find((k) => k.key_prefix === prefix);
    if (!target) {
      return json(res, { error: 'Key not found' }, 404);
    }

    deactivateAgentApiKey(target.key_hash);
    console.log(`[API] Agent API key revoked: ${prefix}`);
    return json(res, { success: true, revoked: prefix });
  }

  // ── Chain Info ──────────────────────────────────────────────────────────

  // GET /api/chains — list supported chains
  if (method === 'GET' && path === '/api/chains') {
    return json(res, {
      data: getSupportedChainIds().map((id) => {
        try {
          const { getChainConfig } = require('@eigenswarm/shared');
          const chain = getChainConfig(id);
          return {
            chainId: chain.chainId,
            name: chain.name,
            shortName: chain.shortName,
            nativeToken: chain.nativeToken,
            blockExplorer: chain.blockExplorer,
            hasEigenVault: !!chain.eigenvault,
            hasUniswapV3: !!chain.uniswapV3Router,
            hasUniswapV4: !!chain.uniswapV4UniversalRouter,
          };
        } catch {
          return { chainId: id };
        }
      }),
    });
  }

  // ── Agent-Specific Endpoints ────────────────────────────────────────────

  // POST /api/agent/eigens — create an eigen via API key (agent-friendly)
  if (method === 'POST' && path === '/api/agent/eigens') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      const auth = await authenticateRequest(req, data, buildRegisterMessage.bind(null, data.eigenId || ''));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!data.tokenAddress) {
        return json(res, { error: 'tokenAddress required' }, 400);
      }

      const chainId = typeof data.chainId === 'number' && isChainSupported(data.chainId)
        ? data.chainId
        : 143;

      const validationError = validateEigenConfigInput(data);
      if (validationError) {
        return json(res, { error: validationError }, 400);
      }

      const eigenId = data.eigenId || keccak256(toHex(`agent-${auth.ownerAddress}-${data.tokenAddress}-${Date.now()}`));

      const existing = getEigenConfig(eigenId);
      if (existing) {
        return json(res, { error: 'Eigen config already exists' }, 409);
      }

      insertEigenConfig({
        eigenId,
        tokenAddress: data.tokenAddress,
        tokenSymbol: data.tokenSymbol || '',
        tokenName: data.tokenName || '',
        class: data.class || 'operator',
        volumeTarget: data.volumeTarget,
        tradeFrequency: data.tradeFrequency,
        orderSizeMin: data.orderSizeMin,
        orderSizeMax: data.orderSizeMax,
        spreadWidth: data.spreadWidth,
        profitTarget: data.profitTarget,
        stopLoss: data.stopLoss,
        rebalanceThreshold: data.rebalanceThreshold,
        walletCount: data.walletCount,
        ownerAddress: auth.ownerAddress,
        chainId,
      });

      console.log(`[API] Agent created eigen: ${eigenId} (chain: ${chainId}, auth: ${auth.authMethod})`);
      return json(res, { success: true, eigenId, chainId }, 201);
    } catch (error) {
      console.error('[API] Invalid request:', (error as Error).message);
      return json(res, { error: 'Invalid request' }, 400);
    }
  }

  // GET /api/agent/eigens — list eigens owned by authenticated agent
  if (method === 'GET' && path === '/api/agent/eigens') {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'X-API-KEY header required' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }
    touchAgentApiKey(keyHash);

    const chainIdParam = url.searchParams.get('chainId');
    const chainId = chainIdParam ? parseInt(chainIdParam, 10) : undefined;

    let configs = getEigenConfigsByOwner(keyRecord.owner_address);
    if (chainId && isChainSupported(chainId)) {
      configs = configs.filter((c) => c.chain_id === chainId);
    }

    const result = configs.map((config) => {
      const stats = getTradeStats(config.eigen_id);
      return {
        eigenId: config.eigen_id,
        chainId: config.chain_id,
        tokenAddress: config.token_address,
        tokenSymbol: config.token_symbol,
        status: config.status,
        class: config.class,
        stats: {
          totalBuys: stats.totalBuys,
          totalSells: stats.totalSells,
          totalRealizedPnl: stats.totalRealizedPnl,
          winRate: (stats.winCount + stats.lossCount) > 0
            ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
            : 0,
        },
        createdAt: config.created_at,
      };
    });

    return json(res, { data: result });
  }

  // PATCH /api/agent/eigens/:id — update eigen config via API key
  const agentPatchMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)$/);
  if (method === 'PATCH' && agentPatchMatch) {
    const eigenId = resolveEigenId(agentPatchMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      const auth = await authenticateRequest(req, data, buildAdjustMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      // Verify ownership (config → ponder → on-chain vault)
      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      const cfg = data.config || data;
      const validationError = validateEigenConfigInput(cfg);
      if (validationError) {
        return json(res, { error: validationError }, 400);
      }

      const updates: Record<string, number> = {};
      const fieldMap: Record<string, string> = {
        volumeTarget: 'volume_target',
        tradeFrequency: 'trade_frequency',
        orderSizeMin: 'order_size_min',
        orderSizeMax: 'order_size_max',
        orderSizePctMin: 'order_size_pct_min',
        orderSizePctMax: 'order_size_pct_max',
        spreadWidth: 'spread_width',
        profitTarget: 'profit_target',
        stopLoss: 'stop_loss',
        rebalanceThreshold: 'rebalance_threshold',
        walletCount: 'wallet_count',
        slippageBps: 'slippage_bps',
        reactiveSellMode: 'reactive_sell_mode',
        reactiveSellPct: 'reactive_sell_pct',
      };

      for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
        if (cfg[camelKey] !== undefined) {
          updates[snakeKey] = cfg[camelKey];
        }
      }

      if (Object.keys(updates).length === 0) {
        return json(res, { error: 'No valid config fields to update' }, 400);
      }

      updateEigenConfig(eigenId, updates);
      console.log(`[API] Agent updated config for ${eigenId}: ${Object.keys(updates).join(', ')}`);

      const updated = getEigenConfig(eigenId);
      return json(res, { success: true, config: updated });
    } catch (error) {
      console.error('[API] Failed to update config:', (error as Error).message);
      return json(res, { error: 'Failed to update config' }, 500);
    }
  }

  // POST /api/agent/eigens/:id/liquidate — liquidate via API key
  const agentLiquidateMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)\/liquidate$/);
  if (method === 'POST' && agentLiquidateMatch) {
    const eigenId = resolveEigenId(agentLiquidateMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      const auth = await authenticateRequest(req, data, buildLiquidateMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      if (config.status === 'liquidating' || config.status === 'liquidated') {
        return json(res, { status: config.status, eigenId });
      }

      updateEigenConfigStatus(eigenId, 'liquidating');
      console.log(`[API] Agent initiated liquidation for ${eigenId}`);
      return json(res, { status: 'liquidating', eigenId });
    } catch (error) {
      console.error('[API] Failed to initiate liquidation:', (error as Error).message);
      return json(res, { error: 'Failed to initiate liquidation' }, 500);
    }
  }

  // POST /api/agent/eigens/:id/take-profit — take profit via API key
  const agentTakeProfitMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)\/take-profit$/);
  if (method === 'POST' && agentTakeProfitMatch) {
    const eigenId = resolveEigenId(agentTakeProfitMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      const auth = await authenticateRequest(req, data, buildTakeProfitMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      const percent = typeof data.percent === 'number' && data.percent > 0 && data.percent <= 100
        ? data.percent
        : 100;

      console.log(`[API] Agent take profit for ${eigenId}: ${percent}%`);
      executeTakeProfit(eigenId, percent).catch((error) => {
        console.error(`[API] Take profit execution failed for ${eigenId}:`, (error as Error).message);
      });

      return json(res, { status: 'executing', eigenId, percent });
    } catch (error) {
      console.error('[API] Failed to initiate take profit:', (error as Error).message);
      return json(res, { error: 'Failed to initiate take profit' }, 500);
    }
  }

  // POST /api/agent/eigens/:id/fund — fund an eigen via x402 payment
  const agentFundMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)\/fund$/);
  if (method === 'POST' && agentFundMatch) {
    const eigenId = resolveEigenId(agentFundMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      // Auth: API key or EIP-191
      const auth = await authenticateRequest(req, data, buildFundMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      // Ownership check (config → ponder → on-chain vault)
      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      // Require a volume package to determine payment amount
      const packageId = data.packageId || 'starter';
      const pkg = getPackage(packageId);
      if (!pkg) {
        return json(res, { error: `Unknown package: ${packageId}` }, 400);
      }

      // Check for x402 payment proof (v2: PAYMENT-SIGNATURE, v1: X-PAYMENT)
      const xPayment = getPaymentHeader(req.headers);
      const paymentTxHash = xPayment ? derivePaymentKey(xPayment) : undefined;

      if (paymentTxHash && isPaymentUsed(paymentTxHash)) {
        return json(res, { error: 'Payment already used' }, 409);
      }

      // Lock the payment key immediately to prevent race conditions
      if (paymentTxHash) {
        try {
          recordPayment({
            txHash: paymentTxHash,
            payerAddress: 'pending',
            amountUsdc: 0,
            packageId: pkg.id,
            eigenId: 'pending',
          });
        } catch {
          // Already recorded by concurrent request
          return json(res, { error: 'Payment already used' }, 409);
        }
      }

      if (!xPayment || !paymentTxHash) {
        // No payment — respond 402 with x402-compliant payment requirements
        const paymentRequired = build402Response(pkg, path);
        res.writeHead(402, build402Headers(paymentRequired));
        res.end(JSON.stringify(paymentRequired));
        return;
      }

      // Verify and settle payment via x402 facilitator
      const requirements = buildPaymentRequirements(pkg, path);
      console.log(`[x402] Verifying fund payment via facilitator for ${pkg.priceUSDC} USDC`);
      const verification = await verifyAndSettlePayment(xPayment, requirements);

      if (!verification.valid) {
        deletePayment(paymentTxHash);
        console.error('[API] Payment verification failed:', verification.error);
        return json(res, { error: 'Payment verification failed' }, 402);
      }

      // Update the pending payment record with verified details
      try {
        const paymentDb = getDb();
        paymentDb.prepare(
          'UPDATE used_payments SET payer_address = ?, amount_usdc = ?, eigen_id = ? WHERE tx_hash = ?'
        ).run(verification.from, verification.amount, eigenId, paymentTxHash);
      } catch {
        // Payment already fully recorded — safe to continue
      }

      console.log(`[x402] Fund eigen ${eigenId}: ${verification.amount} USDC from ${verification.from}`);

      // Swap USDC → ETH and fund the eigen vault
      let fundingResult: { funded: boolean; swapTxHash?: string; fundTxHash?: string; ethReceived?: string; error?: string } = { funded: false };
      try {
        fundingResult = await swapUsdcAndFundEigen(
          eigenId,
          verification.amount,
          verification.from as `0x${string}`,
          500n,
          config.chain_id || 8453,
        );
        if (fundingResult.funded) {
          updateEigenConfigStatus(eigenId, 'active');
          console.log(`[x402] Funded eigen ${eigenId}: ${fundingResult.ethReceived} ETH`);
        } else {
          updateEigenConfigStatus(eigenId, 'pending_funding');
          console.warn(`[x402] Funding failed for ${eigenId}: ${fundingResult.error}`);
        }
      } catch (error) {
        updateEigenConfigStatus(eigenId, 'pending_funding');
        console.warn(`[x402] Treasury auto-fund failed for ${eigenId}: ${(error as Error).message}`);
        fundingResult.error = (error as Error).message;
      }

      return json(res, {
        success: true,
        eigenId,
        status: fundingResult.funded ? 'active' : 'pending_funding',
        paidAmount: verification.amount,
        paymentTx: verification.settleTxHash || paymentTxHash,
        funding: {
          funded: fundingResult.funded,
          swapTx: fundingResult.swapTxHash || null,
          fundTx: fundingResult.fundTxHash || null,
          ethReceived: fundingResult.ethReceived || null,
          error: fundingResult.error || null,
        },
      });
    } catch (error) {
      console.error('[API] Invalid request:', (error as Error).message);
      return json(res, { error: 'Invalid request' }, 400);
    }
  }

  // POST /api/agent/eigens/:id/withdraw — withdraw vault ETH to owner via keeper
  const agentWithdrawMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)\/withdraw$/);
  if (method === 'POST' && agentWithdrawMatch) {
    const eigenId = resolveEigenId(agentWithdrawMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      const auth = await authenticateRequest(req, data, buildWithdrawMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      if (config.status === 'liquidated' || config.status === 'terminated') {
        return json(res, { error: 'Eigen already terminated' }, 400);
      }

      const bytes32Id = eigenIdToBytes32(eigenId);
      const chainId = config.chain_id || 143;
      const vaultAddress = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
      const walletClient = getWalletClient(chainId);

      let txHash: string;
      let amountDisplay: string;

      if (data.amount === 'all') {
        // Use keeperWithdrawAll on-chain — settles fees and withdraws max atomically,
        // avoiding TOCTOU race between getNetBalance read and keeperWithdraw write.
        txHash = await walletClient.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'keeperWithdrawAll',
          args: [bytes32Id as `0x${string}`],
        });
        amountDisplay = 'all';
      } else if (typeof data.amount === 'string' || typeof data.amount === 'number') {
        const amountWei = parseEther(String(data.amount));
        if (amountWei <= 0n) {
          return json(res, { error: 'Amount must be positive' }, 400);
        }
        txHash = await walletClient.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'keeperWithdraw',
          args: [bytes32Id as `0x${string}`, amountWei],
        });
        amountDisplay = formatEther(amountWei);
      } else {
        return json(res, { error: 'Missing amount (ETH amount or "all")' }, 400);
      }

      console.log(`[API] keeperWithdraw for ${eigenId}: ${amountDisplay} ETH, tx=${txHash}`);
      return json(res, { success: true, eigenId, amount: amountDisplay, txHash });
    } catch (error) {
      console.error('[API] Withdraw failed:', (error as Error).message);
      return json(res, { error: 'Withdraw failed' }, 500);
    }
  }

  // POST /api/agent/eigens/:id/terminate — terminate eigen + send vault ETH to owner
  const agentTerminateMatch = path.match(/^\/api\/agent\/eigens\/([^/]+)\/terminate$/);
  if (method === 'POST' && agentTerminateMatch) {
    const eigenId = resolveEigenId(agentTerminateMatch[1]!);
    try {
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');

      const auth = await authenticateRequest(req, data, buildTerminateApiMessage.bind(null, eigenId));
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      if (config.status === 'liquidated' || config.status === 'terminated') {
        return json(res, { status: config.status, eigenId });
      }

      // Check on-chain token balances in sub-wallets (not SQLite which can be stale/wiped).
      // This prevents terminating the vault while tokens are stranded in sub-wallets.
      let hasTokens = false;
      if (config.token_address && config.wallet_count > 0) {
        try {
          const wallets = getWalletsForEigen(eigenId, config.wallet_count);
          for (const wallet of wallets) {
            try {
              const bal = await getTokenBalance(
                config.token_address as `0x${string}`,
                wallet.address as `0x${string}`,
              );
              if (bal > 0n) {
                hasTokens = true;
                break;
              }
            } catch {
              // If we can't read a wallet's balance, assume tokens may exist
              hasTokens = true;
              break;
            }
          }
        } catch {
          // If wallet derivation fails, fall back to DB check
          const positions = getTokenPositionsByEigen(eigenId);
          hasTokens = positions.some((p: { amount_raw: string }) => BigInt(p.amount_raw) > 0n);
        }
      }

      if (hasTokens) {
        // Tokens remain — start liquidation first (sells tokens, then auto-terminates)
        updateEigenConfigStatus(eigenId, 'liquidating');
        console.log(`[API] Terminate requested for ${eigenId} — tokens remain, starting liquidation first`);
        return json(res, { status: 'liquidating', eigenId, message: 'Tokens are being sold. Vault will auto-terminate when liquidation completes.' });
      }

      // No tokens remaining — call keeperTerminate directly
      const bytes32Id = eigenIdToBytes32(eigenId);
      const chainId = config.chain_id || 143;
      const vaultAddress = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
      const walletClient = getWalletClient(chainId);

      let txHash: string | null = null;
      try {
        txHash = await walletClient.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'keeperTerminate',
          args: [bytes32Id as `0x${string}`],
        });
        console.log(`[API] keeperTerminate for ${eigenId}: tx=${txHash}`);
      } catch (error) {
        console.warn(`[API] keeperTerminate failed for ${eigenId}:`, (error as Error).message);
      }

      updateEigenConfigStatus(eigenId, 'terminated');
      return json(res, { status: 'terminated', eigenId, txHash });
    } catch (error) {
      console.error('[API] Terminate failed:', (error as Error).message);
      return json(res, { error: 'Terminate failed' }, 500);
    }
  }

  // POST /api/eigens/:id/import-wallets — import bundle wallets for market making
  const importWalletsMatch = path.match(/^\/api\/eigens\/([^/]+)\/import-wallets$/);
  if (method === 'POST' && importWalletsMatch) {
    try {
      const eigenId = resolveEigenId(importWalletsMatch[1]!);
      const config = getEigenConfig(eigenId);
      if (!config) return json(res, { error: 'Eigen not found' }, 404);

      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr);

      // Authenticate
      const auth = await authenticateRequest(req, body, (owner, ts) =>
        `EigenSwarm ImportWallets\neigenId: ${eigenId}\nowner: ${owner.toLowerCase()}\ntimestamp: ${ts}`,
      );
      if (!auth.authenticated) {
        return json(res, { error: auth.error }, auth.error === 'Invalid signature' ? 403 : 401);
      }

      if (!(await verifyEigenOwnership(eigenId, auth.ownerAddress!, config.owner_address, config.chain_id))) {
        return json(res, { error: 'Unauthorized: must be eigen owner' }, 403);
      }

      // Validate wallets array
      const { wallets } = body;
      if (!Array.isArray(wallets) || wallets.length === 0) {
        return json(res, { error: 'wallets array required (non-empty)' }, 400);
      }
      if (wallets.length > 100) {
        return json(res, { error: 'Maximum 100 wallets allowed' }, 400);
      }

      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        if (!w.address || !ADDRESS_RE.test(w.address)) {
          return json(res, { error: `Invalid address at index ${i}` }, 400);
        }
        if (!w.privateKey || typeof w.privateKey !== 'string' || w.privateKey.length < 64) {
          return json(res, { error: `Invalid privateKey at index ${i}` }, 400);
        }
      }

      // Clear existing imported wallets and store new ones (encrypted)
      deleteImportedWallets(eigenId);

      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        const encryptedKey = encryptPrivateKey(w.privateKey);
        upsertImportedWallet({
          eigenId,
          walletIndex: i,
          address: w.address,
          encryptedPrivateKey: encryptedKey,
        });
      }

      // Update eigen config to use imported wallets
      updateWalletSource(eigenId, 'imported');
      updateEigenConfig(eigenId, { wallet_count: wallets.length });

      console.log(`[API] Imported ${wallets.length} wallets for ${eigenId} (encrypted)`);
      return json(res, {
        success: true,
        eigenId,
        walletCount: wallets.length,
        walletSource: 'imported',
      });
    } catch (error) {
      console.error('[API] Import wallets failed:', (error as Error).message);
      return json(res, { error: 'Import wallets failed' }, 500);
    }
  }

  // GET /api/eigens/:id/agent-card — ERC-8004 Agent Card JSON
  const agentCardMatch = path.match(/^\/api\/eigens\/([^/]+)\/agent-card$/);
  if (method === 'GET' && agentCardMatch) {
    const eigenId = resolveEigenId(agentCardMatch[1]!);
    const config = getEigenConfig(eigenId);
    if (!config) return json(res, { error: 'Not found' }, 404);

    const stats = getTradeStats(eigenId);
    const winRate = (stats.winCount + stats.lossCount) > 0
      ? (stats.winCount / (stats.winCount + stats.lossCount)) * 100
      : 0;

    const card = buildAgentCard(eigenId, config, {
      totalBuys: stats.totalBuys,
      totalSells: stats.totalSells,
      winRate,
      totalRealizedPnl: stats.totalRealizedPnl,
    });

    return json(res, card);
  }

  // POST /api/admin/register-8004-batch — batch register existing eigens
  if (method === 'POST' && path === '/api/admin/register-8004-batch') {
    if (!isErc8004Enabled()) {
      return json(res, { error: 'ERC8004_ENABLED is not set to true' }, 400);
    }

    // Admin authentication required
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'Admin authentication required (X-API-KEY header)' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }
    touchAgentApiKey(keyHash);

    try {
      const eigens = getEigensWithout8004();
      if (eigens.length === 0) {
        return json(res, { message: 'All eigens already registered', registered: 0 });
      }

      const results: { eigenId: string; agent8004Id?: string; error?: string }[] = [];

      for (const eigen of eigens) {
        try {
          const agentId = await registerAgent(eigen.eigen_id, eigen.chain_id || 8453);
          results.push({ eigenId: eigen.eigen_id, agent8004Id: agentId });
        } catch (error) {
          results.push({ eigenId: eigen.eigen_id, error: (error as Error).message });
          console.error(`[8004 Batch] Failed for ${eigen.eigen_id}:`, (error as Error).message);
        }
      }

      const successCount = results.filter((r) => r.agent8004Id).length;
      console.log(`[8004 Batch] Registered ${successCount}/${eigens.length} eigens`);
      return json(res, { registered: successCount, total: eigens.length, results });
    } catch (error) {
      console.error('[API] Batch registration failed:', (error as Error).message);
      return json(res, { error: 'Batch registration failed' }, 500);
    }
  }

  // POST /api/admin/rescue-ownership — fix eigens where keeper is incorrectly the owner
  if (method === 'POST' && path === '/api/admin/rescue-ownership') {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return json(res, { error: 'Admin authentication required (X-API-KEY header)' }, 401);
    }
    const keyHash = hashApiKey(apiKey);
    const keyRecord = getAgentApiKeyByHash(keyHash);
    if (!keyRecord) {
      return json(res, { error: 'Invalid API key' }, 401);
    }
    touchAgentApiKey(keyHash);

    try {
      const body = await readBody(req);
      const data = body ? JSON.parse(body) : {};
      const chainId = data.chainId || 143;

      const vaultAddr = (process.env.EIGENVAULT_ADDRESS || EIGENVAULT_ADDRESS) as `0x${string}`;
      const walletClient = getWalletClient(chainId);
      const publicClient = getPublicClient(chainId);
      const keeperAddr = getKeeperAddress();

      // Get all eigens and check which ones have keeper as on-chain owner
      const allConfigs = getAllEigenConfigs();
      const results: { eigenId: string; rescued?: boolean; error?: string }[] = [];

      for (const config of allConfigs) {
        if (config.chain_id !== chainId) continue;
        try {
          const bytes32Id = eigenIdToBytes32(config.eigen_id);
          const onChainOwner = await publicClient.readContract({
            address: vaultAddr,
            abi: EIGENVAULT_ABI,
            functionName: 'getEigenOwner',
            args: [bytes32Id],
          }) as `0x${string}`;

          // If on-chain owner is keeper but DB owner is different, rescue it
          if (onChainOwner.toLowerCase() === keeperAddr.toLowerCase() &&
            config.owner_address.toLowerCase() !== keeperAddr.toLowerCase()) {
            const tx = await walletClient.writeContract({
              address: vaultAddr,
              abi: EIGENVAULT_ABI,
              functionName: 'rescueEigenOwnership',
              args: [bytes32Id, config.owner_address as `0x${string}`],
            });
            await publicClient.waitForTransactionReceipt({ hash: tx });
            results.push({ eigenId: config.eigen_id, rescued: true });
            console.log(`[Rescue] Fixed ownership for ${config.eigen_id} → ${config.owner_address} (tx: ${tx})`);
          }
        } catch (error) {
          results.push({ eigenId: config.eigen_id, error: (error as Error).message });
        }
      }

      const rescuedCount = results.filter((r) => r.rescued).length;
      console.log(`[Rescue] Fixed ${rescuedCount} eigens`);
      return json(res, { rescued: rescuedCount, results });
    } catch (error) {
      console.error('[API] Rescue failed:', (error as Error).message);
      return json(res, { error: 'Rescue failed' }, 500);
    }
  }

  // 404
  json(res, { error: 'Not found' }, 404);
}

export function startApi(port: number): void {
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      console.error('[API] Unhandled error:', (error as Error).message);
      if (!res.headersSent) {
        json(res, { error: 'Internal server error' }, 500);
      }
    }
  });
  server.listen(port, () => {
    console.log(`[API] Listening on http://localhost:${port}`);
  });
  server.timeout = 30_000; // 30 second timeout
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
}
