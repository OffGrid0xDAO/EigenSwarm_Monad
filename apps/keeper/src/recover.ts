/**
 * Local recovery script — discovers eigens from on-chain events and recovers ETH.
 *
 * Does NOT rely on the local SQLite DB (which may be empty).
 * Instead, scans EigenCreated + EigenCreatedWithAgent events from ALL vault versions.
 *
 * Vault versions scanned:
 *   V0: 0xC9D2797C4e294a42ef6e9e5d1193fb65695A795A (oldest)
 *   V1: 0x3609e894F94EedCDD131bEA2f3C3a31Fd149393B
 *   V2: 0x71ED55BEEb05CF6032502D7CB3768BEE932F0887 (current)
 *
 * Recovery steps per eigen:
 *   1. Vault ETH balance → withdraw (if keeper is on-chain owner)
 *   2. LP position → removeLiquidity
 *   3. Sub-wallet tokens → sell via pool
 *   4. Sub-wallet stranded ETH → sweep to keeper
 *
 * Usage:
 *   npx tsx src/recover.ts                    # dry run (scan only)
 *   npx tsx src/recover.ts --execute          # execute recovery txs
 */

import 'dotenv/config';
import {
  createPublicClient, createWalletClient, http, formatEther, parseEther,
  parseAbiItem,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ERC20_ABI, EIGENVAULT_ABI, EIGENVAULT_ADDRESS,
  EIGENLP_ABI, EIGENLP_ADDRESS,
} from '@eigenswarm/shared';
import { deriveSubKey, getMasterPrivateKey } from './key-manager';
import { executeSell } from './sell-executor';
import { resolvePool } from './pool-resolver';

// ── Config ─────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--execute');
const LP_ADDR = (process.env.EIGENLP_ADDRESS || EIGENLP_ADDRESS) as `0x${string}`;
const START_BLOCK = BigInt(process.env.EIGENVAULT_START_BLOCK || '26000000'); // early enough to catch V0

// All vault versions (oldest → newest)
// startBlock is near each contract's deployment — avoids scanning millions of empty blocks
const VAULT_VERSIONS: { label: string; address: `0x${string}`; startBlock: bigint }[] = [
  { label: 'V0', address: '0xC9D2797C4e294a42ef6e9e5d1193fb65695A795A', startBlock: 39000000n },
  { label: 'V1', address: '0x3609e894F94EedCDD131bEA2f3C3a31Fd149393B', startBlock: 40500000n },
  { label: 'V2 (current)', address: EIGENVAULT_ADDRESS as `0x${string}`, startBlock: 42039040n },
];

// Use public Base RPC to avoid Alchemy rate limits
const RPC_URL = process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com';

// Event signatures
const EIGEN_CREATED_EVENT = parseAbiItem(
  'event EigenCreated(bytes32 indexed eigenId, address indexed owner, uint256 feeRateBps)'
);
const EIGEN_CREATED_WITH_AGENT_EVENT = parseAbiItem(
  'event EigenCreatedWithAgent(bytes32 indexed eigenId, uint256 indexed agentId, uint256 feeRateBps)'
);

// Minimal ABI for reading from potentially older vault contracts
const MINIMAL_VAULT_ABI = [
  { type: 'function', name: 'getEigenInfo', inputs: [{ name: 'eigenId', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }, { name: '', type: 'bool' }, { name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getEigenOwner', inputs: [{ name: 'eigenId', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'eigenOwner', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'eigenBalances', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'eigenActive', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'eigenId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balances', inputs: [{ name: '', type: 'bytes32' }, { name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// ── Clients ────────────────────────────────────────────────────────────

const client = createPublicClient({ chain: base, transport: http(RPC_URL) });

const keeperKey = getMasterPrivateKey();
const keeperAccount = privateKeyToAccount(keeperKey);
const keeperAddr = keeperAccount.address;

const keeperWallet = createWalletClient({
  account: keeperAccount,
  chain: base,
  transport: http(RPC_URL),
});

function getSubWalletClient(eigenId: string, index: number) {
  const key = deriveSubKey(eigenId, index);
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    privateKey: key,
    client: createWalletClient({ account, chain: base, transport: http(RPC_URL) }),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface DiscoveredEigen {
  eigenId: `0x${string}`;
  owner: `0x${string}` | null; // null for EigenCreatedWithAgent (owner derived from NFT)
  agentId: bigint | null;
  vaultAddress: `0x${string}`;
  vaultLabel: string;
}

/** Read eigen info from a vault, trying multiple ABI patterns for compat */
async function readEigenInfo(vaultAddr: `0x${string}`, eigenId: `0x${string}`): Promise<{
  balance: bigint;
  active: boolean;
  owner: `0x${string}`;
} | null> {
  // Try getEigenInfo first (current vault)
  try {
    const info = await client.readContract({
      address: vaultAddr,
      abi: EIGENVAULT_ABI,
      functionName: 'getEigenInfo',
      args: [eigenId],
    }) as [string, boolean, bigint];

    const owner = await client.readContract({
      address: vaultAddr,
      abi: EIGENVAULT_ABI,
      functionName: 'getEigenOwner',
      args: [eigenId],
    }) as `0x${string}`;

    return { balance: info[2], active: info[1], owner };
  } catch { /* try fallback */ }

  // Fallback: try reading individual storage vars (older vaults)
  try {
    const [balance, active, owner] = await Promise.all([
      client.readContract({
        address: vaultAddr,
        abi: MINIMAL_VAULT_ABI,
        functionName: 'eigenBalances',
        args: [eigenId],
      }).catch(() => 0n) as Promise<bigint>,
      client.readContract({
        address: vaultAddr,
        abi: MINIMAL_VAULT_ABI,
        functionName: 'eigenActive',
        args: [eigenId],
      }).catch(() => false) as Promise<boolean>,
      client.readContract({
        address: vaultAddr,
        abi: MINIMAL_VAULT_ABI,
        functionName: 'eigenOwner',
        args: [eigenId],
      }).catch(() => '0x0000000000000000000000000000000000000000' as `0x${string}`) as Promise<`0x${string}`>,
    ]);

    if (balance > 0n || owner !== '0x0000000000000000000000000000000000000000') {
      return { balance, active, owner };
    }
  } catch { /* not readable */ }

  // Last resort: check raw ETH balance of the vault contract itself
  // (won't help per-eigen, but at least we tried)
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== EigenSwarm Recovery Script (Multi-Vault) ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --execute to run for real)' : 'EXECUTING — real transactions!'}`);
  console.log(`Keeper: ${keeperAddr}`);
  console.log(`EigenLP: ${LP_ADDR}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Vaults to scan:`);
  for (const v of VAULT_VERSIONS) {
    console.log(`  ${v.label}: ${v.address} (from block ${v.startBlock})`);
  }
  console.log('');

  const currentBlock = await client.getBlockNumber();
  console.log(`Current block: ${currentBlock}\n`);

  // ── Discover eigens from ALL vault versions ──────────────────────
  const allEigens: DiscoveredEigen[] = [];

  for (const vault of VAULT_VERSIONS) {
    // Quick check: skip vaults with 0 ETH balance (nothing to recover)
    const vaultBal = await client.getBalance({ address: vault.address });
    console.log(`── ${vault.label} (${vault.address.slice(0, 14)}...): ${formatEther(vaultBal)} ETH ──`);
    if (vaultBal === 0n) {
      console.log(`  Empty vault, skipping event scan.\n`);
      continue;
    }

    const CHUNK = 50_000n; // publicnode supports up to 50k block ranges
    let found = 0;
    let skipWithAgent = false; // set true if older vault doesn't have this event

    for (let from = vault.startBlock; from <= currentBlock; from += CHUNK) {
      const to = from + CHUNK - 1n > currentBlock ? currentBlock : from + CHUNK - 1n;

      // Scan EigenCreated events
      try {
        const logs = await client.getLogs({
          address: vault.address,
          event: EIGEN_CREATED_EVENT,
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          allEigens.push({
            eigenId: log.args.eigenId!,
            owner: log.args.owner!,
            agentId: null,
            vaultAddress: vault.address,
            vaultLabel: vault.label,
          });
          found++;
        }
      } catch (e) {
        console.log(`  Warning: EigenCreated chunk ${from}-${to} failed: ${(e as Error).message.slice(0, 80)}`);
      }

      // Scan EigenCreatedWithAgent events
      if (!skipWithAgent) {
        try {
          const logs = await client.getLogs({
            address: vault.address,
            event: EIGEN_CREATED_WITH_AGENT_EVENT,
            fromBlock: from,
            toBlock: to,
          });
          for (const log of logs) {
            allEigens.push({
              eigenId: log.args.eigenId!,
              owner: null, // owner is NFT holder, resolved at read time
              agentId: log.args.agentId!,
              vaultAddress: vault.address,
              vaultLabel: vault.label,
            });
            found++;
          }
        } catch (e) {
          if (from === vault.startBlock) {
            // Older vault doesn't have this event — skip for remaining chunks
            console.log(`  Note: EigenCreatedWithAgent not available on ${vault.label}`);
            skipWithAgent = true;
          }
        }
      }

      // Rate limit: small delay between chunks to avoid 429s
      if ((from - vault.startBlock) % (CHUNK * 10n) === 0n && from > vault.startBlock) {
        await sleep(200);
      }
    }

    console.log(`  Found ${found} eigens on ${vault.label}\n`);
  }

  // Deduplicate by eigenId (an eigen might appear on multiple vaults if migrated)
  const seen = new Set<string>();
  const eigens: DiscoveredEigen[] = [];
  for (const e of allEigens) {
    const key = `${e.eigenId}-${e.vaultAddress}`;
    if (!seen.has(key)) {
      seen.add(key);
      eigens.push(e);
    }
  }

  console.log(`\nTotal unique eigens found across all vaults: ${eigens.length}\n`);

  let totalVaultEth = 0n;
  let totalLpEth = 0n;
  let totalTokenValue = 0n;
  let totalSubWalletEth = 0n;
  let totalRecovered = 0n;

  for (const eigen of eigens) {
    const { eigenId: bytes32Id, vaultAddress, vaultLabel, agentId } = eigen;
    const shortId = bytes32Id.slice(0, 14);

    // ── 1. Vault balance + ownership ────────────────────────────
    const info = await readEigenInfo(vaultAddress, bytes32Id);
    if (!info) continue;

    const { balance: vaultBalance, active: isActive, owner: onChainOwner } = info;

    // ── 2. LP position ──────────────────────────────────────────
    let lpTokenId = 0n;
    let lpTokenAddr: `0x${string}` | null = null;
    try {
      const pos = await client.readContract({
        address: LP_ADDR,
        abi: EIGENLP_ABI,
        functionName: 'getPosition',
        args: [bytes32Id],
      }) as unknown as [bigint, `0x${string}`, `0x${string}`, `0x${string}`, number, number];
      lpTokenId = pos[0];
      lpTokenAddr = pos[2];
    } catch { /* no LP */ }

    const hasAnything = vaultBalance > 0n || lpTokenId > 0n;
    if (!hasAnything) continue;

    console.log(`── ${shortId}... [${vaultLabel}] vault=${vaultAddress.slice(0, 14)}... ──`);
    if (agentId) console.log(`  Agent ID: ${agentId}`);
    console.log(`  Owner: ${onChainOwner}`);

    if (vaultBalance > 0n) {
      console.log(`  Vault: ${formatEther(vaultBalance)} ETH (active=${isActive})`);
      totalVaultEth += vaultBalance;
    }
    if (lpTokenId > 0n) {
      console.log(`  LP: tokenId=${lpTokenId} token=${lpTokenAddr?.slice(0, 10) || '?'}`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN]\n`);
      continue;
    }

    // ═══ EXECUTE ═══════════════════════════════════════════════

    // Step 1: Remove LP (keeper must be eigenOwner on LP contract)
    if (lpTokenId > 0n) {
      try {
        console.log(`  -> Removing LP...`);
        const ethBefore = await client.getBalance({ address: keeperAddr });

        const { request } = await client.simulateContract({
          account: keeperAccount,
          address: LP_ADDR,
          abi: EIGENLP_ABI,
          functionName: 'removeLiquidity',
          args: [bytes32Id, 0n, 0n],
        });
        const tx = await keeperWallet.writeContract(request);
        await client.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });

        const ethAfter = await client.getBalance({ address: keeperAddr });
        const ethGain = ethAfter > ethBefore ? ethAfter - ethBefore : 0n;
        totalLpEth += ethGain;
        totalRecovered += ethGain;
        console.log(`  OK LP removed: +${formatEther(ethGain)} ETH (tx: ${tx.slice(0, 14)}...)`);

        // Sell tokens received from LP removal
        if (lpTokenAddr && lpTokenAddr !== '0x0000000000000000000000000000000000000000') {
          try {
            const tokenBal = await client.readContract({
              address: lpTokenAddr,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [keeperAddr],
            }) as bigint;
            if (tokenBal > 0n) {
              console.log(`  -> Selling ${formatEther(tokenBal)} tokens (${lpTokenAddr.slice(0, 10)}...)...`);
              const pool = await resolvePool(lpTokenAddr, bytes32Id.slice(0, 14));
              if (pool) {
                const sellResult = await executeSell(bytes32Id.slice(0, 14), lpTokenAddr, tokenBal, pool, keeperWallet, 0n);
                totalTokenValue += sellResult.ethReceived;
                totalRecovered += sellResult.ethReceived;
                console.log(`  OK Sold tokens: +${formatEther(sellResult.ethReceived)} ETH`);
              } else {
                console.log(`  SKIP token sell: no pool found`);
              }
            }
          } catch (e) {
            console.log(`  FAIL token sell: ${(e as Error).message.slice(0, 120)}`);
          }
        }
      } catch (e) {
        console.log(`  FAIL LP: ${(e as Error).message.slice(0, 120)}`);
      }
    }

    // Step 2: Withdraw vault (keeper must be on-chain owner)
    if (vaultBalance > 0n && onChainOwner.toLowerCase() === keeperAddr.toLowerCase()) {
      try {
        console.log(`  -> Withdrawing ${formatEther(vaultBalance)} ETH from vault (${vaultLabel})...`);
        // Try current ABI first, fallback to minimal
        const tx = await keeperWallet.writeContract({
          address: vaultAddress,
          abi: EIGENVAULT_ABI,
          functionName: 'withdraw',
          args: [bytes32Id, vaultBalance],
        });
        await client.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
        totalRecovered += vaultBalance;
        console.log(`  OK Withdrawn: +${formatEther(vaultBalance)} ETH`);
      } catch (e) {
        // Try minimal ABI as fallback
        try {
          const tx = await keeperWallet.writeContract({
            address: vaultAddress,
            abi: MINIMAL_VAULT_ABI,
            functionName: 'withdraw',
            args: [bytes32Id, vaultBalance],
          });
          await client.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
          totalRecovered += vaultBalance;
          console.log(`  OK Withdrawn (fallback ABI): +${formatEther(vaultBalance)} ETH`);
        } catch (e2) {
          console.log(`  FAIL withdraw: ${(e2 as Error).message.slice(0, 120)}`);
        }
      }
    } else if (vaultBalance > 0n) {
      console.log(`  SKIP vault: owner is ${onChainOwner} not keeper (${keeperAddr.slice(0, 10)}...)`);
    }

    console.log('');
  }

  // ── Sub-wallet scan from local DB (if available) ─────────────
  console.log(`\n── Sub-wallet scan (from local DB) ──`);
  try {
    const { getAllEigenConfigs, getSubWallets } = await import('./db');
    const configs = getAllEigenConfigs().filter((c) => c.chain_id === 143);

    if (configs.length === 0) {
      console.log(`  Local DB empty — sub-wallet recovery requires the production DB.`);
      console.log(`  To recover sub-wallet funds, run this script on Railway or copy the DB locally.\n`);
    }

    for (const config of configs) {
      const eigenId = config.eigen_id;
      const tokenAddr = config.token_address as `0x${string}`;
      const validToken = tokenAddr && tokenAddr !== '0x' &&
        tokenAddr !== '0x0000000000000000000000000000000000000000';

      for (let i = 0; i < (config.wallet_count || 1); i++) {
        const sw = getSubWalletClient(eigenId, i);
        try {
          const [tokenBal, ethBal] = await Promise.all([
            validToken ? client.readContract({
              address: tokenAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [sw.address],
            }) as Promise<bigint> : Promise.resolve(0n),
            client.getBalance({ address: sw.address }),
          ]);

          if (tokenBal > 0n) {
            console.log(`  ${eigenId} wallet[${i}] ${sw.address.slice(0, 10)}: ${formatEther(tokenBal)} tokens`);
            if (!DRY_RUN && validToken) {
              try {
                // Fund for gas
                if (ethBal < parseEther('0.0002')) {
                  const fundTx = await keeperWallet.sendTransaction({
                    to: sw.address, value: parseEther('0.0003'),
                  });
                  await client.waitForTransactionReceipt({ hash: fundTx });
                }
                const pool = await resolvePool(tokenAddr, eigenId);
                if (pool) {
                  const sellResult = await executeSell(eigenId, tokenAddr, tokenBal, pool, sw.client, 0n);
                  totalTokenValue += sellResult.ethReceived;
                  totalRecovered += sellResult.ethReceived;
                  console.log(`    Sold: +${formatEther(sellResult.ethReceived)} ETH`);
                }
              } catch (e) {
                console.log(`    Sell failed: ${(e as Error).message.slice(0, 80)}`);
              }
            }
          }

          if (ethBal > parseEther('0.00005')) {
            const amt = ethBal - parseEther('0.00005');
            console.log(`  ${eigenId} wallet[${i}] ${sw.address.slice(0, 10)}: ${formatEther(amt)} ETH`);
            totalSubWalletEth += amt;
            if (!DRY_RUN && amt > 0n) {
              try {
                const tx = await sw.client.sendTransaction({ to: keeperAddr, value: amt });
                await client.waitForTransactionReceipt({ hash: tx });
                totalRecovered += amt;
                console.log(`    Swept to keeper`);
              } catch (e) {
                console.log(`    Sweep failed: ${(e as Error).message.slice(0, 80)}`);
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.log(`  DB unavailable: ${(e as Error).message.slice(0, 80)}`);
  }

  // ── Check raw ETH balance on old vault contracts ───────────────
  console.log(`\n── Vault contract ETH balances ──`);
  for (const vault of VAULT_VERSIONS) {
    try {
      const bal = await client.getBalance({ address: vault.address });
      if (bal > 0n) {
        console.log(`  ${vault.label} (${vault.address.slice(0, 14)}...): ${formatEther(bal)} ETH`);
      } else {
        console.log(`  ${vault.label}: 0 ETH`);
      }
    } catch {
      console.log(`  ${vault.label}: failed to read balance`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(`\n=== SUMMARY ===`);
  console.log(`Eigens found on-chain: ${eigens.length}`);
  console.log(`Vault balances: ${formatEther(totalVaultEth)} ETH`);
  console.log(`LP ETH recovered: ${formatEther(totalLpEth)} ETH`);
  console.log(`Token sell proceeds: ${formatEther(totalTokenValue)} ETH`);
  console.log(`Sub-wallet ETH: ${formatEther(totalSubWalletEth)} ETH`);
  if (!DRY_RUN) {
    console.log(`\nTotal recovered: ${formatEther(totalRecovered)} ETH`);
  }

  try {
    const bal = await client.getBalance({ address: keeperAddr });
    console.log(`Keeper balance: ${formatEther(bal)} ETH`);
  } catch { /* rpc limit */ }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
