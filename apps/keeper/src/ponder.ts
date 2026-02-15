const PONDER_API_URL = process.env.PONDER_API_URL || 'http://localhost:42069';
const FETCH_TIMEOUT_MS = 10_000; // 10 second timeout
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export interface PonderEigen {
  id: string;
  owner: string;
  status: string;
  balance: string;       // ETH string from formatEther
  totalDeposited: string;
  totalWithdrawn: string;
  totalTraded: string;
  totalFees: string;
  feeRateBps: number;
  feeOwed: string;
  tradeCount: number;
  createdAt: number;
}

export interface PonderTrade {
  id: string;
  eigenId: string;
  ethSpent: string;
  router: string;
  timestamp: number;
  txHash: string;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(`${PONDER_API_URL}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Ponder GraphQL error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json() as { data: T; errors?: { message: string }[] };
      if (json.errors?.length) {
        throw new Error(`Ponder GraphQL error: ${json.errors[0]!.message}`);
      }
      return json.data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  throw lastError!;
}

interface PaginatedEigens {
  eigens: {
    items: PonderEigen[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function fetchActiveEigens(limit = 200): Promise<PonderEigen[]> {
  const PAGE_SIZE = 200;
  const allItems: PonderEigen[] = [];
  let after: string | null = null;

  // Paginate through all active eigens using cursor-based pagination
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: PaginatedEigens = await gql<PaginatedEigens>(`
      query($limit: Int!, $after: String) {
        eigens(where: { status: ACTIVE }, orderBy: "createdAt", orderDirection: "desc", limit: $limit, after: $after) {
          items {
            id
            owner
            status
            balance
            totalDeposited
            totalWithdrawn
            totalTraded
            totalFees
            feeRateBps
            feeOwed
            tradeCount
            createdAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `, { limit: PAGE_SIZE, after });

    allItems.push(...data.eigens.items);

    // Stop if we've reached the requested limit or no more pages
    if (!data.eigens.pageInfo.hasNextPage || allItems.length >= limit) {
      break;
    }

    after = data.eigens.pageInfo.endCursor;
  }

  return allItems.slice(0, limit);
}

export async function fetchEigen(eigenId: string): Promise<PonderEigen | null> {
  const data = await gql<{ eigen: PonderEigen | null }>(`
    query($id: String!) {
      eigen(id: $id) {
        id
        owner
        status
        balance
        totalDeposited
        totalWithdrawn
        totalTraded
        totalFees
        feeRateBps
        feeOwed
        tradeCount
        createdAt
      }
    }
  `, { id: eigenId });
  return data.eigen;
}

export async function fetchRecentTrades(eigenId: string, limit = 10): Promise<PonderTrade[]> {
  const data = await gql<{ tradeEvents: { items: PonderTrade[] } }>(`
    query($eigenId: String!, $limit: Int!) {
      tradeEvents(
        where: { eigenId: $eigenId }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
      ) {
        items {
          id
          eigenId
          ethSpent
          router
          timestamp
          txHash
        }
      }
    }
  `, { eigenId, limit });
  return data.tradeEvents.items;
}

export async function fetchAllEigens(limit = 500): Promise<PonderEigen[]> {
  const PAGE_SIZE = 200;
  const allItems: PonderEigen[] = [];
  let after: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: PaginatedEigens = await gql<PaginatedEigens>(`
      query($limit: Int!, $after: String) {
        eigens(orderBy: "createdAt", orderDirection: "desc", limit: $limit, after: $after) {
          items {
            id
            owner
            status
            balance
            totalDeposited
            totalWithdrawn
            totalTraded
            totalFees
            feeRateBps
            feeOwed
            tradeCount
            createdAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `, { limit: PAGE_SIZE, after });

    allItems.push(...data.eigens.items);

    if (!data.eigens.pageInfo.hasNextPage || allItems.length >= limit) {
      break;
    }

    after = data.eigens.pageInfo.endCursor;
  }

  return allItems.slice(0, limit);
}

export async function checkPonderHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`${PONDER_API_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ eigens(limit: 1) { items { id } } }' }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
