import { createConfig } from 'ponder';
import { EIGENVAULT_ABI, EIGENLP_ABI } from '@eigenswarm/shared';

// Build RPC list: env var first, then public fallback
const PUBLIC_RPCS = [
  'https://rpc.monad.xyz',
];
const envRpc = process.env.PONDER_RPC_URL_143 || process.env.MONAD_RPC_URL || '';
const rpcList = [
  ...(envRpc ? [envRpc] : []),
  ...PUBLIC_RPCS,
];

export default createConfig({
  database: {
    kind: 'postgres',
    schema: process.env.PONDER_DATABASE_SCHEMA || 'es_v8',
  },
  chains: {
    monad: {
      id: 143,
      rpc: rpcList,
      pollingInterval: 2_000,
      maxRequestsPerSecond: 10,
    },
  },
  contracts: {
    EigenVault: {
      chain: 'monad',
      abi: EIGENVAULT_ABI,
      address: (process.env.EIGENVAULT_ADDRESS || '0x1003EdcD563Dcae3Bc1685b901fc692bbD2d941b') as `0x${string}`,
      startBlock: Number(process.env.EIGENVAULT_START_BLOCK || 55_529_643),
    },
    EigenLP: {
      chain: 'monad',
      abi: EIGENLP_ABI,
      address: (process.env.EIGENLP_ADDRESS || '0x6eD5322c6bC349b4dfca458814E8B6c0bf0558EB') as `0x${string}`,
      startBlock: Number(process.env.EIGENLP_START_BLOCK || 55_529_585),
    },
  },
});
