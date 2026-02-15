export const EIGENBUNDLER_ABI = [
  // ── Read Functions ────────────────────────────────────────────────
  {
    type: 'function',
    name: 'vault',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'eigenLP',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ── Write Functions ───────────────────────────────────────────────
  {
    type: 'function',
    name: 'launch',
    inputs: [
      { name: 'eigenId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'tradingFeeBps', type: 'uint256' },
      { name: 'vaultDepositEth', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },

  // ── Constructor ───────────────────────────────────────────────────
  {
    type: 'constructor',
    inputs: [
      { name: '_vault', type: 'address' },
      { name: '_eigenLP', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },

  // ── Receive ───────────────────────────────────────────────────────
  {
    type: 'receive',
    stateMutability: 'payable',
  },
] as const;
