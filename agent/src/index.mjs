// Headless CLI entry (dev run + bun-compiled binary). The reusable loop lives in
// agent.mjs so the macOS Electron app can run the same agent in-process.
import { loadConfig, printPairing } from './config.mjs';
import { startAgent } from './agent.mjs';

const cfg = loadConfig();
console.log(`[agent] room=${cfg.room}`);
printPairing(cfg);
const agent = startAgent(cfg);
process.on('SIGINT', () => { console.log('\n[agent] bye'); agent.stop(); process.exit(0); });
