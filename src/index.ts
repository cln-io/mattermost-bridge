import fs from 'fs';
import path from 'path';
import { loadConfig } from './config';
import { MattermostBridge } from './bridge';
import { emoji, initializeEmojiConfig } from './logger-utils';

const LOG_PREFIX = '[main             ]';

const MAX_RESTART_DELAY_S = 300; // Cap at 5 minutes
const RESTART_STATE_FILE = process.env.CATCH_UP_PERSISTENCE_PATH
  ? path.join(path.dirname(process.env.CATCH_UP_PERSISTENCE_PATH), '.restart-state.json')
  : '/tmp/.restart-state.json';
const RESTART_RESET_MS = 10 * 60 * 1000; // Reset counter after 10 min of uptime

function getRestartAttempt(): number {
  try {
    const data = JSON.parse(fs.readFileSync(RESTART_STATE_FILE, 'utf-8'));
    if (Date.now() - data.timestamp < RESTART_RESET_MS) return data.attempt;
  } catch { /* first run or stale */ }
  return 0;
}

function saveRestartAttempt(attempt: number): void {
  try {
    fs.writeFileSync(RESTART_STATE_FILE, JSON.stringify({ attempt, timestamp: Date.now() }));
  } catch { /* best effort */ }
}

function clearRestartAttempt(): void {
  try { fs.unlinkSync(RESTART_STATE_FILE); } catch { /* ignore */ }
}

export async function main() {
  let bridge: MattermostBridge | undefined;
  const attempt = getRestartAttempt();

  try {
    console.log(`${LOG_PREFIX} ${emoji('🔧')}Loading configuration...`.trim());
    const config = loadConfig();
    
    // Initialize emoji config
    initializeEmojiConfig(config);
    
    // Show prominent dry-run message if enabled
    if (config.dryRun) {
      console.log('');
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log(`║                    ${emoji('🏃‍♂️')}DRY RUN MODE ${emoji('🏃‍♂️')}                     ║`.trim());
      console.log('║                                                            ║');
      console.log('║   Messages will be displayed but NOT posted to target     ║');
      console.log('║   This is for testing only - no messages will be sent     ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
      console.log('');
      process.title = 'mattermost-bridge (DRY-RUN)';
    }
    
    bridge = new MattermostBridge(config);
    
    // Handle graceful shutdown for Docker
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n${LOG_PREFIX} ${emoji('🛑')}Received ${signal}, shutting down gracefully...`.trim());
      if (bridge) {
        await bridge.stop();
      }
      process.exit(0);
    };

    // Handle various termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
    
    // Handle SIGUSR1 to force event summary (for debugging)
    process.on('SIGUSR1', () => {
      console.log(`${LOG_PREFIX} ${emoji('📊')}Received SIGUSR1, forcing event summary...`.trim());
      // This would need to be implemented in the bridge class
      // For now, just log that we received the signal
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error(`${LOG_PREFIX} ${emoji('💥')}Uncaught Exception:`.trim(), error);
      if (bridge) {
        await bridge.stop();
      }
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error(`${LOG_PREFIX} ${emoji('💥')}Unhandled Rejection at:`.trim(), promise, 'reason:', reason);
      if (bridge) {
        await bridge.stop();
      }
      process.exit(1);
    });

    await bridge.start();
    clearRestartAttempt();

  } catch (error) {
    console.error(`${LOG_PREFIX} ${emoji('💥')}Application failed to start:`.trim(), error);
    if (bridge) {
      await bridge.stop();
    }
    const nextAttempt = attempt + 1;
    const delayS = Math.min(Math.pow(2, attempt) * 5, MAX_RESTART_DELAY_S);
    console.error(`${LOG_PREFIX} ${emoji('⏳')}Startup failure #${nextAttempt} — waiting ${delayS}s before exiting...`.trim());
    saveRestartAttempt(nextAttempt);
    await new Promise(resolve => setTimeout(resolve, delayS * 1000));
    process.exit(1);
    return; // Prevent further execution if process.exit is mocked
  }
}

// Run the application
if (require.main === module) {
  main().catch(console.error);
}