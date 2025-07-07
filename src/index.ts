import { loadConfig } from './config';
import { MattermostBridge } from './bridge';
import { emoji, initializeEmojiConfig } from './logger-utils';

const LOG_PREFIX = '[main             ]';

export async function main() {
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
    
    const bridge = new MattermostBridge(config);
    
    // Handle graceful shutdown for Docker
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n${LOG_PREFIX} ${emoji('🛑')}Received ${signal}, shutting down gracefully...`.trim());
      await bridge.stop();
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
      await bridge.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error(`${LOG_PREFIX} ${emoji('💥')}Unhandled Rejection at:`.trim(), promise, 'reason:', reason);
      await bridge.stop();
      process.exit(1);
    });

    await bridge.start();
    
  } catch (error) {
    console.error(`${LOG_PREFIX} ${emoji('💥')}Application failed to start:`.trim(), error);
    process.exit(1);
  }
}

// Run the application
if (require.main === module) {
  main().catch(console.error);
}