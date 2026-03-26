/**
 * BTC Oracle Node — Entry point
 * Decentralized oracle for OpNet, DLC-backed price feeds on Bitcoin L1
 */

import { OracleNode } from './oracle/OracleNode.js';
import { loadConfig } from './config/config.js';

async function main() {
    const config = await loadConfig();

    console.log('[btc-oracle] Starting oracle node...');
    console.log(`[btc-oracle] Network: ${config.network}`);
    console.log(`[btc-oracle] Assets: ${config.assets.join(', ')}`);

    const node = new OracleNode(config);
    await node.start();

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[btc-oracle] Shutting down...');
        await node.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('[btc-oracle] Fatal error:', err);
    process.exit(1);
});
