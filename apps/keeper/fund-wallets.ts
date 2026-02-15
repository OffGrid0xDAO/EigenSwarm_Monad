/**
 * Fund sub-wallets for ESLV2 market making.
 * Sends MON from master wallet to each sub-wallet.
 *
 * Usage: cd apps/keeper && npx tsx fund-wallets.ts
 */
import 'dotenv/config';
import { formatEther, parseEther, createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { keccak256, concat, toHex } from 'viem';

const EIGEN_ID = 'eigen-eigen-1771171519177';
const WALLET_COUNT = 5;
const MON_PER_WALLET = parseEther('2'); // 2 MON per wallet for trading

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
});

const masterKey = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;
if (!masterKey) throw new Error('KEEPER_PRIVATE_KEY not set');

const masterAccount = privateKeyToAccount(masterKey);
const publicClient = createPublicClient({ chain: monad, transport: http() });
const walletClient = createWalletClient({
  account: masterAccount,
  chain: monad,
  transport: http(),
});

function deriveSubKey(eigenId: string, index: number): `0x${string}` {
  return keccak256(
    concat([
      masterKey,
      toHex(eigenId),
      toHex(index, { size: 32 }),
    ]),
  );
}

async function main() {
  const masterBalance = await publicClient.getBalance({ address: masterAccount.address });
  console.log(`Master wallet: ${masterAccount.address}`);
  console.log(`Master balance: ${formatEther(masterBalance)} MON`);
  console.log(`Funding ${WALLET_COUNT} wallets with ${formatEther(MON_PER_WALLET)} MON each`);
  console.log(`Total: ${formatEther(MON_PER_WALLET * BigInt(WALLET_COUNT))} MON\n`);

  const totalNeeded = MON_PER_WALLET * BigInt(WALLET_COUNT);
  if (masterBalance < totalNeeded + parseEther('0.1')) {
    console.error(`Insufficient balance. Need ${formatEther(totalNeeded)} + gas, have ${formatEther(masterBalance)}`);
    return;
  }

  for (let i = 0; i < WALLET_COUNT; i++) {
    const subKey = deriveSubKey(EIGEN_ID, i);
    const subAccount = privateKeyToAccount(subKey);

    const existingBalance = await publicClient.getBalance({ address: subAccount.address });
    if (existingBalance >= MON_PER_WALLET) {
      console.log(`Wallet ${i}: ${subAccount.address} — already has ${formatEther(existingBalance)} MON, skipping`);
      continue;
    }

    console.log(`Wallet ${i}: ${subAccount.address} — sending ${formatEther(MON_PER_WALLET)} MON...`);
    const hash = await walletClient.sendTransaction({
      to: subAccount.address,
      value: MON_PER_WALLET,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  tx: ${hash}`);
  }

  console.log('\nDone! Sub-wallets funded. Keeper will start trading on next cycle.');
}

main().catch(console.error);
