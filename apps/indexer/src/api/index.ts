import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { Hono } from 'hono';
import { count, desc, eq, graphql, replaceBigInts, sum } from 'ponder';
import { formatEther } from 'viem';

const app = new Hono();

// ── Rate limiting (in-memory, per-IP) ────────────────────────────────────

const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;       // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function getRateLimitKey(c: any): string {
  return c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
}

app.use('*', async (c, next) => {
  const key = getRateLimitKey(c);
  const now = Date.now();
  let entry = rateMap.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateMap.set(key, entry);
  }

  entry.count++;

  if (entry.count > RATE_LIMIT) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  c.header('X-RateLimit-Limit', String(RATE_LIMIT));
  c.header('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT - entry.count)));

  await next();
});

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key);
  }
}, 5 * 60_000);

// ── Input validation helpers ─────────────────────────────────────────────

const HEX_REGEX = /^0x[0-9a-fA-F]+$/;

function isValidHexId(id: string): boolean {
  return HEX_REGEX.test(id) && id.length <= 66; // bytes32 = 0x + 64 hex chars
}

function safeInt(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// ── GraphQL endpoint ─────────────────────────────────────────────────────

app.use('/graphql', graphql({ db, schema }));

// ── REST API ─────────────────────────────────────────────────────────────

// GET /api/eigens — list all eigens (paginated)
app.get('/api/eigens', async (c) => {
  const limit = safeInt(c.req.query('limit'), 50, 100);
  const offset = safeInt(c.req.query('offset'), 0, 100_000);

  const result = await db
    .select()
    .from(schema.eigen)
    .orderBy(desc(schema.eigen.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

// GET /api/eigens/:id — single eigen
app.get('/api/eigens/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidHexId(id)) return c.json({ error: 'Invalid eigen ID' }, 400);

  const result = await db
    .select()
    .from(schema.eigen)
    .where(eq(schema.eigen.id, id as `0x${string}`))
    .limit(1);

  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(replaceBigInts(result[0]!, (b) => formatEther(b)));
});

// GET /api/eigens/:id/trades — paginated trade history
app.get('/api/eigens/:id/trades', async (c) => {
  const eigenId = c.req.param('id');
  if (!isValidHexId(eigenId)) return c.json({ error: 'Invalid eigen ID' }, 400);

  const limit = safeInt(c.req.query('limit'), 50, 100);
  const offset = safeInt(c.req.query('offset'), 0, 100_000);

  const result = await db
    .select()
    .from(schema.tradeEvent)
    .where(eq(schema.tradeEvent.eigenId, eigenId as `0x${string}`))
    .orderBy(desc(schema.tradeEvent.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

// GET /api/eigens/:id/deposits — paginated deposit history
app.get('/api/eigens/:id/deposits', async (c) => {
  const eigenId = c.req.param('id');
  if (!isValidHexId(eigenId)) return c.json({ error: 'Invalid eigen ID' }, 400);

  const limit = safeInt(c.req.query('limit'), 50, 100);
  const offset = safeInt(c.req.query('offset'), 0, 100_000);

  const result = await db
    .select()
    .from(schema.deposit)
    .where(eq(schema.deposit.eigenId, eigenId as `0x${string}`))
    .orderBy(desc(schema.deposit.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

// GET /api/lp/positions — list all LP positions (paginated)
app.get('/api/lp/positions', async (c) => {
  const limit = safeInt(c.req.query('limit'), 50, 100);
  const offset = safeInt(c.req.query('offset'), 0, 100_000);

  const result = await db
    .select()
    .from(schema.lpPosition)
    .orderBy(desc(schema.lpPosition.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

// GET /api/lp/positions/:eigenId — single LP position
app.get('/api/lp/positions/:eigenId', async (c) => {
  const eigenId = c.req.param('eigenId');
  if (!isValidHexId(eigenId)) return c.json({ error: 'Invalid eigen ID' }, 400);

  const result = await db
    .select()
    .from(schema.lpPosition)
    .where(eq(schema.lpPosition.id, eigenId as `0x${string}`))
    .limit(1);

  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(replaceBigInts(result[0]!, (b) => formatEther(b)));
});

// GET /api/eigens — list eigens (paginated, from on-chain indexer)
app.get('/api/eigens', async (c) => {
  const limit = safeInt(c.req.query('limit'), 50, 100);
  const offset = safeInt(c.req.query('offset'), 0, 100_000);

  const result = await db
    .select()
    .from(schema.eigen)
    .orderBy(desc(schema.eigen.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

// GET /api/eigens/:id — single eigen
app.get('/api/eigens/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidHexId(id)) return c.json({ error: 'Invalid eigen ID' }, 400);

  const result = await db
    .select()
    .from(schema.eigen)
    .where(eq(schema.eigen.id, id as `0x${string}`))
    .limit(1);

  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(replaceBigInts(result[0]!, (b) => formatEther(b)));
});

// GET /api/stats — aggregate protocol stats
app.get('/api/stats', async (c) => {
  const [eigenCount] = await db
    .select({ count: count() })
    .from(schema.eigen);

  const [activeCount] = await db
    .select({ count: count() })
    .from(schema.eigen)
    .where(eq(schema.eigen.status, 'ACTIVE'));

  const [tradeCount] = await db
    .select({ count: count() })
    .from(schema.tradeEvent);

  const [tvl] = await db
    .select({ total: sum(schema.eigen.balance) })
    .from(schema.eigen);

  return c.json({
    totalEigens: eigenCount?.count ?? 0,
    activeEigens: activeCount?.count ?? 0,
    totalTrades: tradeCount?.count ?? 0,
    tvlWei: tvl?.total?.toString() ?? '0',
  });
});

export default app;
