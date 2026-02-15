import { config, validateConfig } from './config.js';
import { initTables } from './db.js';
import { startTelegramMonitor } from './telegram.js';
import { startPortfolioMonitor } from './portfolio-monitor.js';

async function main() {
  console.log('┌──────────────────────────────────────┐');
  console.log('│  TG Sniper → Fomolt Paper Trader     │');
  console.log('└──────────────────────────────────────┘');

  validateConfig();
  console.log(`[Config] Trade amount: $${config.tradeAmountUsdc} USDC per signal`);
  console.log(`[Config] Monitoring chats: ${config.telegram.chatIds.length ? config.telegram.chatIds.join(', ') : 'auto-resolve by name'}`);

  initTables();

  const client = await startTelegramMonitor();

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\n[Sniper] Shutting down...');
    await client.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await client.disconnect();
    process.exit(0);
  });

  startPortfolioMonitor();

  console.log('[Sniper] Running. Ctrl+C to stop.');
}

main().catch(err => {
  console.error('[Sniper] Fatal error:', err);
  process.exit(1);
});
