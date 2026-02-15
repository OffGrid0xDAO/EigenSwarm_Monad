export const REPUTATION_REGISTRY_8004_ABI = [
  // ── Read Functions ────────────────────────────────────────────────
  {
    type: 'function',
    name: 'getSummary',
    inputs: [{ name: 'agentId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'totalFeedback', type: 'uint256', internalType: 'uint256' },
      { name: 'averageValue', type: 'int256', internalType: 'int256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'readFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', internalType: 'uint256' },
      { name: 'index', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      { name: 'from', type: 'address', internalType: 'address' },
      { name: 'tag1', type: 'bytes32', internalType: 'bytes32' },
      { name: 'tag2', type: 'bytes32', internalType: 'bytes32' },
      { name: 'value', type: 'int256', internalType: 'int256' },
      { name: 'timestamp', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feedbackCount',
    inputs: [{ name: 'agentId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // ── Write Functions ───────────────────────────────────────────────
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', internalType: 'uint256' },
      { name: 'tag1', type: 'bytes32', internalType: 'bytes32' },
      { name: 'tag2', type: 'bytes32', internalType: 'bytes32' },
      { name: 'value', type: 'int256', internalType: 'int256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ── Events ────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'FeedbackGiven',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'from', type: 'address', indexed: true, internalType: 'address' },
      { name: 'tag1', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      { name: 'tag2', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      { name: 'value', type: 'int256', indexed: false, internalType: 'int256' },
    ],
  },
] as const;
