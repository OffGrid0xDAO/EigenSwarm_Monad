import { useQuery } from '@tanstack/react-query';
import { fetchOhlcv, fetchGeckoPoolInfo, getGeckoNetwork, type OhlcvCandle, type GeckoPoolInfo } from '@/lib/geckoTerminal';

export function useOhlcv(poolAddress: string | undefined, chainId: number, range: string) {
  return useQuery<OhlcvCandle[]>({
    queryKey: ['ohlcv', poolAddress, chainId, range],
    queryFn: () => (poolAddress ? fetchOhlcv(poolAddress, chainId, range) : []),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!poolAddress && !!getGeckoNetwork(chainId),
    retry: 1,
    retryDelay: 5_000,
  });
}

export function useGeckoPoolInfo(poolAddress: string | undefined, chainId: number) {
  return useQuery<GeckoPoolInfo | null>({
    queryKey: ['geckoPoolInfo', poolAddress, chainId],
    queryFn: () => (poolAddress ? fetchGeckoPoolInfo(poolAddress, chainId) : null),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!poolAddress && !!getGeckoNetwork(chainId),
    retry: 1,
  });
}
