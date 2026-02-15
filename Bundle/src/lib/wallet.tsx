import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatEther,
  type WalletClient,
  type Chain,
  type Address,
  type Hash,
} from "viem";
import { sepolia, monad, supportedChains } from "./chains";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const chainsById: Record<number, Chain> = { [sepolia.id]: sepolia, [monad.id]: monad };
const supportedChainIds = new Set(supportedChains.map((c) => c.id));

type WalletState = {
  address: string | null;
  chainId: number | null;
  balance: string | null;
  symbol: string;
  status: "disconnected" | "connecting" | "connected";
  error: string | null;
};

type WalletContextValue = WalletState & {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
  writeContract: (params: {
    chainId: number;
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: unknown[];
    value: bigint;
    gas?: bigint;
  }) => Promise<Hash>;
  isWrongChain: boolean;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function getChain(chainId: number): Chain {
  return chainsById[chainId] ?? sepolia;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    balance: null,
    symbol: "ETH",
    status: "disconnected",
    error: null,
  });

  const fetchBalance = useCallback(async (address: string, chainId: number) => {
    const chain = getChain(chainId);
    const client = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    });
    const balance = await client.getBalance({ address: address as Address });
    const chainSymbol = chain.nativeCurrency.symbol;
    return { balance: formatEther(balance), symbol: chainSymbol };
  }, []);

  const updateChainAndBalance = useCallback(
    async (address: string, chainIdHex: string) => {
      const chainId = parseInt(chainIdHex, 16);
      const chain = getChain(chainId);
      const { balance, symbol } = await fetchBalance(address, chainId);
      setState((s) => ({
        ...s,
        address,
        chainId,
        balance,
        symbol,
        status: "connected",
        error: null,
      }));
    },
    [fetchBalance]
  );

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState((s) => ({ ...s, error: "No wallet found. Install MetaMask.", status: "disconnected" }));
      return;
    }
    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
        params: [],
      })) as string[];
      if (!accounts.length) {
        setState((s) => ({ ...s, status: "disconnected" }));
        return;
      }
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      await updateChainAndBalance(accounts[0], chainIdHex);
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "disconnected",
        error: err instanceof Error ? err.message : "Connection failed",
      }));
    }
  }, [updateChainAndBalance]);

  const disconnect = useCallback(() => {
    setState({
      address: null,
      chainId: null,
      balance: null,
      symbol: "ETH",
      status: "disconnected",
      error: null,
    });
  }, []);

  const switchChain = useCallback(async (chainId: number) => {
    if (!window.ethereum || !state.address) return;
    const hex = `0x${chainId.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
      await updateChainAndBalance(state.address, hex);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 4902) {
        const chain = getChain(chainId);
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.default.http,
              blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
            },
          ],
        });
        await updateChainAndBalance(state.address, hex);
      }
    }
  }, [state.address, updateChainAndBalance]);

  const writeContract = useCallback(
    async (params: {
      chainId: number;
      address: Address;
      abi: readonly unknown[];
      functionName: string;
      args: unknown[];
      value: bigint;
      gas?: bigint;
    }) => {
      if (!window.ethereum || !state.address) throw new Error("Wallet not connected");
      const chain = getChain(params.chainId);
      const account = { address: state.address as Address, type: "json-rpc" as const };
      const client = createWalletClient({
        chain,
        transport: custom(window.ethereum),
        account,
      }) as WalletClient;
      const hash = await client.writeContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        value: params.value,
        ...(params.gas != null && { gas: params.gas }),
      });
      return hash;
    },
    [state.address]
  );

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      if (!list.length) disconnect();
      else if (state.address && list[0] !== state.address) updateChainAndBalance(list[0], `0x${(state.chainId ?? 0).toString(16)}`);
    };
    const onChain = (raw: unknown) => {
      if (!state.address) return;
      const hex = typeof raw === "string" ? raw : `0x${Number(raw).toString(16)}`;
      updateChainAndBalance(state.address, hex);
    };
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum?.on?.("accountsChanged", () => {});
      window.ethereum?.on?.("chainChanged", () => {});
    };
  }, [state.address, state.chainId, disconnect, updateChainAndBalance]);

  const value: WalletContextValue = {
    ...state,
    connect,
    disconnect,
    switchChain,
    writeContract,
    isWrongChain: state.chainId != null && !supportedChainIds.has(state.chainId),
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
