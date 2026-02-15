import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchEigens,
  fetchEigen,
  fetchTrades,
  fetchEigenPnl,
  fetchPriceHistory,
  fetchPortfolio,
  fetchWallets,
  fetchTokenVerification,
  registerEigenConfig,
} from '@/lib/api';
import { mapApiEigenToEigen, mapApiTradeToTrade, mapApiPortfolio } from '@/lib/mappers';
import type { Eigen, Trade, PortfolioStats } from '@eigenswarm/shared';

// ── Eigen list ──────────────────────────────────────────────────────────

export function useEigens(ownerAddress?: string) {
  return useQuery({
    queryKey: ['eigens', ownerAddress],
    queryFn: async (): Promise<Eigen[]> => {
      const data = await fetchEigens(ownerAddress);
      return data.map((e) => mapApiEigenToEigen(e));
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: true,
  });
}

// ── Single eigen ────────────────────────────────────────────────────────

export function useEigen(id: string | undefined) {
  return useQuery({
    queryKey: ['eigen', id],
    queryFn: async (): Promise<Eigen | null> => {
      if (!id) return null;
      const [data, pnl] = await Promise.all([
        fetchEigen(id),
        fetchEigenPnl(id).catch(() => null),
      ]);
      return mapApiEigenToEigen(data, pnl);
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
    enabled: !!id,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
}

// ── Trades ──────────────────────────────────────────────────────────────

export function useTrades(eigenId: string | undefined) {
  return useQuery({
    queryKey: ['trades', eigenId],
    queryFn: async (): Promise<Trade[]> => {
      if (!eigenId) return [];
      const data = await fetchTrades(eigenId);
      return data.map(mapApiTradeToTrade);
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
    enabled: !!eigenId,
  });
}

// ── P&L ─────────────────────────────────────────────────────────────────

export function useEigenPnl(id: string | undefined) {
  return useQuery({
    queryKey: ['eigenPnl', id],
    queryFn: () => (id ? fetchEigenPnl(id) : null),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!id,
  });
}

// ── Price history ───────────────────────────────────────────────────────

export function usePriceHistory(eigenId: string | undefined, range = '1d') {
  return useQuery({
    queryKey: ['priceHistory', eigenId, range],
    queryFn: () => (eigenId ? fetchPriceHistory(eigenId, range) : []),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!eigenId,
  });
}

// ── Wallets ─────────────────────────────────────────────────────────────

export function useWallets(eigenId: string | undefined) {
  return useQuery({
    queryKey: ['wallets', eigenId],
    queryFn: () => (eigenId ? fetchWallets(eigenId) : []),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!eigenId,
  });
}

// ── Portfolio ───────────────────────────────────────────────────────────

export function usePortfolio(ownerAddress?: string) {
  return useQuery({
    queryKey: ['portfolio', ownerAddress],
    queryFn: async (): Promise<PortfolioStats | null> => {
      if (!ownerAddress) return null;
      const data = await fetchPortfolio(ownerAddress);
      return mapApiPortfolio(data);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!ownerAddress,
  });
}

// ── Token verification ──────────────────────────────────────────────────

export function useTokenVerification(address: string | undefined, chainId?: number) {
  return useQuery({
    queryKey: ['tokenVerify', address, chainId],
    queryFn: () => (address ? fetchTokenVerification(address, chainId) : null),
    enabled: !!address && address.length === 42 && address.startsWith('0x'),
    staleTime: 60_000,
  });
}

// ── Register eigen mutation ─────────────────────────────────────────────

export function useRegisterEigen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: registerEigenConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eigens'] });
    },
  });
}
