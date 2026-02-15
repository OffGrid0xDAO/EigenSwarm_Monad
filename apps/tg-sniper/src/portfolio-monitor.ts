import { config } from './config.js';

const API = config.fomolt.baseUrl;
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.fomolt.apiKey}`,
};

const LOG = '[Monitor]';
const STOP_LOSS_PCT = -30;
const TAKE_PROFIT_PCT = 50;
const FLAT_CLOSE_HOURS = 6;
const FLAT_THRESHOLD_PCT = 10;
const CHECK_INTERVAL_MS = 60_000; // 60 seconds
const FETCH_TIMEOUT_MS = 30_000;  // 30s timeout for Fomolt API
const SELL_RETRIES = 3;

let running = false;
let consecutiveErrors = 0;
const positionFirstSeen = new Map<string, number>();

interface Position {
  contractAddress: string;
  symbol: string;
  name: string;
  quantity: string;
  avgEntryPrice: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string;
}

export function startPortfolioMonitor() {
  if (running) return;
  running = true;
  console.log(`${LOG} Started — SL: ${STOP_LOSS_PCT}% | TP: +${TAKE_PROFIT_PCT}% | Flat: ±${FLAT_THRESHOLD_PCT}% after ${FLAT_CLOSE_HOURS}h | every ${CHECK_INTERVAL_MS / 1000}s`);
  loop();
}

async function loop() {
  while (running) {
    try {
      await checkPositions();
      if (consecutiveErrors > 0) {
        console.log(`${LOG} Recovered after ${consecutiveErrors} error(s)`);
        consecutiveErrors = 0;
      }
    } catch (err) {
      consecutiveErrors++;
      console.error(`${LOG} Error #${consecutiveErrors}:`, (err as Error).message);
    }
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

async function checkPositions() {
  const res = await fetch(`${API}/agent/paper/dex/portfolio`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = await res.json() as any;
  if (!json.success) return;

  const positions: Position[] = json.response.positions;
  if (positions.length === 0) return;

  for (const pos of positions) {
    const pnlPct = parseFloat(pos.unrealizedPnlPercent);
    const addr = pos.contractAddress.toLowerCase();

    if (!positionFirstSeen.has(addr)) {
      positionFirstSeen.set(addr, Date.now());
    }

    if (pnlPct <= STOP_LOSS_PCT) {
      console.log(`${LOG} STOP LOSS ${pos.symbol} at ${pnlPct.toFixed(1)}% (threshold: ${STOP_LOSS_PCT}%)`);
      await sellPosition(pos, `SL: ${pnlPct.toFixed(1)}%`);
      positionFirstSeen.delete(addr);
    } else if (pnlPct >= TAKE_PROFIT_PCT) {
      console.log(`${LOG} TAKE PROFIT ${pos.symbol} at +${pnlPct.toFixed(1)}% (threshold: +${TAKE_PROFIT_PCT}%)`);
      await sellPosition(pos, `TP: +${pnlPct.toFixed(1)}%`);
      positionFirstSeen.delete(addr);
    } else {
      const hoursHeld = (Date.now() - positionFirstSeen.get(addr)!) / 3_600_000;
      if (hoursHeld >= FLAT_CLOSE_HOURS && Math.abs(pnlPct) <= FLAT_THRESHOLD_PCT) {
        console.log(`${LOG} FLAT CLOSE ${pos.symbol} at ${pnlPct.toFixed(1)}% after ${hoursHeld.toFixed(1)}h`);
        await sellPosition(pos, `Flat ${pnlPct.toFixed(1)}% after ${hoursHeld.toFixed(1)}h`);
        positionFirstSeen.delete(addr);
      }
    }
  }

  // Clean up tracking for closed positions
  const current = new Set(positions.map(p => p.contractAddress.toLowerCase()));
  for (const addr of positionFirstSeen.keys()) {
    if (!current.has(addr)) positionFirstSeen.delete(addr);
  }
}

async function sellPosition(pos: Position, reason: string) {
  for (let attempt = 1; attempt <= SELL_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API}/agent/paper/dex/trade`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          contractAddress: pos.contractAddress,
          side: 'sell',
          quantity: pos.quantity,
          note: `Auto ${reason} | ${pos.symbol}`.slice(0, 280),
        }),
      });
      const json = await res.json() as any;
      if (json.success) {
        const t = json.response.trade;
        console.log(`${LOG} ✓ Sold ${t.symbol} for $${t.totalUsdc} | realized: $${t.realizedPnl}`);
        return;
      } else {
        console.error(`${LOG} ✗ Sell failed for ${pos.symbol} (attempt ${attempt}/${SELL_RETRIES}):`, json.response);
      }
    } catch (err) {
      console.error(`${LOG} ✗ Sell timeout for ${pos.symbol} (attempt ${attempt}/${SELL_RETRIES}):`, (err as Error).message);
    }
    if (attempt < SELL_RETRIES) await new Promise(r => setTimeout(r, 5000));
  }
  console.error(`${LOG} ✗✗ GAVE UP selling ${pos.symbol} after ${SELL_RETRIES} attempts — will retry next cycle`);
}
