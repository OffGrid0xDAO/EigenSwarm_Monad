export const EIGENFACTORY_ABI = [
  // ── Read Functions ────────────────────────────────────────────────
  {
    type: 'function',
    name: 'launcher',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ── Setters (onlyOwner) ─────────────────────────────────────────
  {
    type: 'function',
    name: 'setLauncher',
    inputs: [{ name: '_launcher', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ── Core Function ───────────────────────────────────────────────
  {
    type: 'function',
    name: 'deployAndLaunch',
    inputs: [
      { name: 'clankerFactory', type: 'address' },
      { name: 'clankerCalldata', type: 'bytes' },
      { name: 'clankerEthValue', type: 'uint256' },
      { name: 'expectedToken', type: 'address' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'eigenId', type: 'bytes32' },
      { name: 'tradingFeeBps', type: 'uint256' },
      { name: 'vaultDepositEth', type: 'uint256' },
      { name: 'agentURI', type: 'string' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },

  // ── Events ──────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'LauncherUpdated',
    inputs: [
      { name: 'oldLauncher', type: 'address', indexed: true },
      { name: 'newLauncher', type: 'address', indexed: true },
    ],
  },

  // ── Constructor ─────────────────────────────────────────────────
  {
    type: 'constructor',
    inputs: [{ name: '_launcher', type: 'address' }],
    stateMutability: 'nonpayable',
  },

  // ── Receive ─────────────────────────────────────────────────────
  {
    type: 'receive',
    stateMutability: 'payable',
  },
] as const;
