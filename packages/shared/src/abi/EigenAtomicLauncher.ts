export const EIGEN_ATOMIC_LAUNCHER_ABI = [
  // ── Read Functions ────────────────────────────────────────────────
  {
    type: 'function',
    name: 'bondingCurveRouter',
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
    name: 'vault',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deployFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ── Write Functions ───────────────────────────────────────────────
  {
    type: 'function',
    name: 'atomicLaunch',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'tokenURI', type: 'string' },
      { name: 'salt', type: 'bytes32' },
      { name: 'actionId', type: 'uint8' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'eigenId', type: 'bytes32' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tradingFeeBps', type: 'uint256' },
      { name: 'devBuyMon', type: 'uint256' },
      { name: 'lpMon', type: 'uint256' },
      { name: 'vaultDepositMon', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [{ name: 'token', type: 'address' }],
    stateMutability: 'payable',
  },

  // ── Admin ─────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'setBondingCurveRouter',
    inputs: [{ name: '_bondingCurveRouter', type: 'address' }],
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
    name: 'setVault',
    inputs: [{ name: '_vault', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDeployFee',
    inputs: [{ name: '_deployFee', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rescueTokens',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rescueMon',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ── Events ────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'AtomicLaunch',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'eigenId', type: 'bytes32', indexed: true },
      { name: 'onBehalfOf', type: 'address', indexed: true },
      { name: 'devBuyMon', type: 'uint256', indexed: false },
      { name: 'lpMon', type: 'uint256', indexed: false },
      { name: 'vaultDepositMon', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BondingCurveRouterUpdated',
    inputs: [
      { name: 'oldRouter', type: 'address', indexed: true },
      { name: 'newRouter', type: 'address', indexed: true },
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
    name: 'VaultUpdated',
    inputs: [
      { name: 'oldVault', type: 'address', indexed: true },
      { name: 'newVault', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'DeployFeeUpdated',
    inputs: [
      { name: 'oldFee', type: 'uint256', indexed: false },
      { name: 'newFee', type: 'uint256', indexed: false },
    ],
  },

  // ── Receive ───────────────────────────────────────────────────────
  {
    type: 'receive',
    stateMutability: 'payable',
  },
] as const;
