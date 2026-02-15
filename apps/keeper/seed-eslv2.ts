/**
 * Seed script: Register EigenSwarmLive2 (ESLV2) in the keeper database.
 *
 * Usage: cd apps/keeper && npx tsx seed-eslv2.ts
 */
import 'dotenv/config';
import { getDb, insertEigenConfig, getEigenConfig, updateGraduationStatus } from './src/db';

const EIGEN_ID = 'test-eigen-v5'; // keccak256 of this matches the on-chain eigenId
const TOKEN_ADDRESS = '0x51ad02755bff243408941d52c55f87e4966cdddf';
const TOKEN_SYMBOL = 'ESLV2';
const TOKEN_NAME = 'EigenSwarmLive2';
const OWNER_ADDRESS = '0xA7708f216B35A8cCAF7c39486ACFba4934613263';

// LP metadata from the atomicLaunch
const LP_POOL_ID = '0x1786fb1893ca425a45a20b87abaeb7e8d083afb634720d903de0f472d1e45e9e';
const LP_TOKEN_ID = 328391;
const LP_POOL_FEE = 9900;
const LP_POOL_TICK_SPACING = 198;
const LP_CONTRACT_ADDRESS = '0xEf8b421B15Dd0Aa59392431753029A184F3eEc54';

function main() {
  // Initialize DB
  getDb();

  // Check if already exists
  const existing = getEigenConfig(EIGEN_ID);
  if (existing) {
    console.log(`Eigen ${EIGEN_ID} already exists in DB. Skipping insert.`);
    console.log(`  token: ${existing.token_address}`);
    console.log(`  status: ${existing.status}`);
    console.log(`  graduation: ${existing.graduation_status}`);
    return;
  }

  // Insert the eigen config
  insertEigenConfig({
    eigenId: EIGEN_ID,
    tokenAddress: TOKEN_ADDRESS,
    tokenSymbol: TOKEN_SYMBOL,
    tokenName: TOKEN_NAME,
    ownerAddress: OWNER_ADDRESS,
    chainId: 143,

    // Trading parameters — conservative for market making
    volumeTarget: 5,         // target 5 MON daily volume
    tradeFrequency: 20,      // ~20 seconds between trades
    orderSizeMin: 0.05,      // min 0.05 MON per trade
    orderSizeMax: 0.2,       // max 0.2 MON per trade
    spreadWidth: 1.2,
    profitTarget: 50,
    stopLoss: 30,
    rebalanceThreshold: 0.6,
    walletCount: 5,          // 5 sub-wallets

    // LP pool metadata
    lpPoolId: LP_POOL_ID,
    lpTokenId: LP_TOKEN_ID,
    lpPoolFee: LP_POOL_FEE,
    lpPoolTickSpacing: LP_POOL_TICK_SPACING,
    lpContractAddress: LP_CONTRACT_ADDRESS,
  });

  // Set graduation status to 'bonding_curve' — token is still on nad.fun bonding curve
  // The graduation monitor will update this to 'graduated' when the curve fills
  updateGraduationStatus(EIGEN_ID, 'bonding_curve');

  console.log(`Eigen ${EIGEN_ID} registered successfully!`);
  console.log(`  Token: ${TOKEN_NAME} (${TOKEN_SYMBOL}) @ ${TOKEN_ADDRESS}`);
  console.log(`  Chain: Monad (143)`);
  console.log(`  Owner: ${OWNER_ADDRESS}`);
  console.log(`  Graduation: bonding_curve (will auto-upgrade on graduation)`);
  console.log(`  LP Pool: ${LP_POOL_ID}`);
  console.log(`  LP Token ID: ${LP_TOKEN_ID}`);
  console.log(`  Wallets: 5 sub-wallets`);
  console.log(`\nKeeper will pick this up on the next trade cycle.`);
}

main();
