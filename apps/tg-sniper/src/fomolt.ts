import { config } from './config.js';

const API = config.fomolt.baseUrl;
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.fomolt.apiKey}`,
};

// ── Rate Limiter ────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  async wait(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = this.windowMs - (now - this.timestamps[0]) + 100;
      console.log(`[Fomolt] Rate limit — waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

const priceLimiter = new RateLimiter(14, 60_000);
const tradeLimiter = new RateLimiter(9, 60_000);

// ── Types ───────────────────────────────────────────────────────────────

export interface PriceResult {
  symbol: string;
  name: string;
  contractAddress: string;
  priceInUsdc: string;
}

export interface TradeResult {
  contractAddress: string;
  symbol: string;
  name: string;
  side: string;
  quantity: string;
  price: string;
  totalUsdc: string;
  note?: string;
}

// ── API Methods ─────────────────────────────────────────────────────────

export async function getPrice(contractAddress: string): Promise<PriceResult | null> {
  await priceLimiter.wait();
  try {
    const res = await fetch(
      `${API}/agent/paper/dex/price?contractAddress=${contractAddress}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    const json = await res.json() as any;
    if (!json.success) return null;
    return {
      symbol: json.response.token.symbol,
      name: json.response.token.name,
      contractAddress: json.response.token.contractAddress,
      priceInUsdc: json.response.priceInUsdc,
    };
  } catch (err) {
    console.error(`[Fomolt] Price check failed for ${contractAddress}:`, (err as Error).message);
    return null;
  }
}

export async function paperTrade(params: {
  contractAddress: string;
  amountUsdc: string;
  note?: string;
}): Promise<TradeResult | null> {
  await tradeLimiter.wait();
  try {
    const res = await fetch(`${API}/agent/paper/dex/trade`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        contractAddress: params.contractAddress,
        side: 'buy',
        amountUsdc: params.amountUsdc,
        note: params.note?.slice(0, 280),
      }),
    });
    const json = await res.json() as any;
    if (!json.success) {
      console.error(`[Fomolt] Trade failed:`, json.response);
      return null;
    }
    const t = json.response.trade;
    return {
      contractAddress: t.contractAddress,
      symbol: t.symbol,
      name: t.name,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      totalUsdc: t.totalUsdc,
      note: t.note,
    };
  } catch (err) {
    console.error(`[Fomolt] Trade request failed:`, (err as Error).message);
    return null;
  }
}
