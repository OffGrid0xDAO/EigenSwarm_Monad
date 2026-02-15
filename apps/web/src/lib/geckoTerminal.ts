const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

/** Map chainId → GeckoTerminal network slug */
const CHAIN_NETWORK_MAP: Record<number, string> = {
  8453: 'base',
  // 143: 'monad', // add when GeckoTerminal supports Monad
};

export interface OhlcvCandle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GeckoPoolInfo {
  poolAddress: string;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  priceUsd: string | null;
  volumeUsd24h: number | null;
}

/** Maps UI range buttons to GeckoTerminal OHLCV params */
export const TIMEFRAME_CONFIG: Record<string, { timeframe: string; aggregate: number; limit: number }> = {
  '1h':  { timeframe: 'minute', aggregate: 1,  limit: 60  },
  '4h':  { timeframe: 'minute', aggregate: 5,  limit: 48  },
  '1d':  { timeframe: 'minute', aggregate: 15, limit: 96  },
  '7d':  { timeframe: 'hour',   aggregate: 1,  limit: 168 },
  '30d': { timeframe: 'hour',   aggregate: 4,  limit: 180 },
};

export function getGeckoNetwork(chainId: number): string | undefined {
  return CHAIN_NETWORK_MAP[chainId];
}

export async function fetchOhlcv(
  poolAddress: string,
  chainId: number,
  range: string,
): Promise<OhlcvCandle[]> {
  const network = CHAIN_NETWORK_MAP[chainId];
  if (!network) return [];

  const config = TIMEFRAME_CONFIG[range] || TIMEFRAME_CONFIG['1d'];
  const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${config.timeframe}?aggregate=${config.aggregate}&limit=${config.limit}&currency=usd&token=base`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) return [];

  const json = await res.json();
  const rawList: number[][] = json?.data?.attributes?.ohlcv_list || [];

  return rawList
    .map(([ts, o, h, l, c, v]) => ({
      time: ts,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
    }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchGeckoPoolInfo(
  poolAddress: string,
  chainId: number,
): Promise<GeckoPoolInfo | null> {
  const network = CHAIN_NETWORK_MAP[chainId];
  if (!network) return null;

  const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) return null;
  const json = await res.json();
  const attrs = json?.data?.attributes;
  if (!attrs) return null;

  return {
    poolAddress,
    fdvUsd: attrs.fdv_usd ? parseFloat(attrs.fdv_usd) : null,
    marketCapUsd: attrs.market_cap_usd ? parseFloat(attrs.market_cap_usd) : null,
    priceUsd: attrs.base_token_price_usd || null,
    volumeUsd24h: attrs.volume_usd?.h24 ? parseFloat(attrs.volume_usd.h24) : null,
  };
}
