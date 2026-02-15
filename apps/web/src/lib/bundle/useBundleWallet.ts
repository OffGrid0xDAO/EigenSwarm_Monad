'use client';

import { useAccount, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { CHAIN_IDS } from './contracts';
import type { Abi, Address } from 'viem';

export type BundleWalletStatus = 'disconnected' | 'connected' | 'wrong-chain';

export interface BundleWalletState {
    address: Address | undefined;
    chainId: number | undefined;
    status: BundleWalletStatus;
    isWrongChain: boolean;
    isConnected: boolean;
}

export interface BundleWalletActions {
    switchToMonad: () => Promise<void>;
    writeContract: (params: {
        address: Address;
        abi: Abi;
        functionName: string;
        args?: unknown[];
        value?: bigint;
    }) => Promise<`0x${string}`>;
    login: () => void;
}

/**
 * Hook that bridges wagmi/Privy wallet to the Bundle feature's needs.
 * Replaces the custom Bundle wallet provider.
 */
export function useBundleWallet(): BundleWalletState & BundleWalletActions {
    const { address, chainId } = useAccount();
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const { switchChainAsync } = useSwitchChain();
    const { login, authenticated, ready } = usePrivy();

    const isConnected = ready && authenticated && !!address;
    const isWrongChain = isConnected && chainId !== CHAIN_IDS.MONAD;

    let status: BundleWalletStatus = 'disconnected';
    if (isConnected && !isWrongChain) status = 'connected';
    else if (isConnected && isWrongChain) status = 'wrong-chain';

    const switchToMonad = async () => {
        await switchChainAsync({ chainId: CHAIN_IDS.MONAD });
    };

    const writeContract = async (params: {
        address: Address;
        abi: Abi;
        functionName: string;
        args?: unknown[];
        value?: bigint;
    }): Promise<`0x${string}`> => {
        if (!walletClient) throw new Error('Wallet not connected');
        if (!publicClient) throw new Error('Public client not available');

        const { request } = await publicClient.simulateContract({
            account: address,
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args || [],
            value: params.value,
        });

        const hash = await walletClient.writeContract(request);
        return hash;
    };

    return {
        address,
        chainId,
        status,
        isWrongChain,
        isConnected,
        switchToMonad,
        writeContract,
        login,
    };
}
