export const EIGENLAUNCHER_ABI = [
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
  {
    type: 'function',
    name: 'identityRegistry',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ── Owner ────────────────────────────────────────────────────────
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
    name: 'setVault',
    inputs: [{ name: '_vault', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setEigenLP',
    inputs: [{ name: '_eigenLP', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setIdentityRegistry',
    inputs: [{ name: '_identityRegistry', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ── Events ──────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'VaultUpdated',
    inputs: [
      { name: 'oldVault', type: 'address', indexed: true },
      { name: 'newVault', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'EigenLPUpdated',
    inputs: [
      { name: 'oldLP', type: 'address', indexed: true },
      { name: 'newLP', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'IdentityRegistryUpdated',
    inputs: [
      { name: 'oldRegistry', type: 'address', indexed: true },
      { name: 'newRegistry', type: 'address', indexed: true },
    ],
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
      { name: 'agentURI', type: 'string' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'launchWithoutAgent',
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
      { name: '_identityRegistry', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },

  // ── Receive ───────────────────────────────────────────────────────
  {
    type: 'receive',
    stateMutability: 'payable',
  },
] as const;
