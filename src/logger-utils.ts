// Define all log prefix names in one place
export const LOG_PREFIXES = {
  BRIDGE: 'bridge',
  CONFIG: 'config',
  MAIN: 'main',
  MESSAGE_TEMPLATE: 'message-template',
  MATTERMOST_CLIENT: 'mattermost-client',
  HEARTBEAT_SERVICE: 'heartbeat-service'
} as const;

// Calculate the maximum length
const maxLength = Math.max(...Object.values(LOG_PREFIXES).map(prefix => prefix.length));

// Create padded prefix function
export function createLogPrefix(prefixName: string): string {
  const paddedName = prefixName.padEnd(maxLength);
  return `[${paddedName}]`;
}

// Pre-create all padded prefixes for convenience
export const PADDED_PREFIXES = {
  BRIDGE: createLogPrefix(LOG_PREFIXES.BRIDGE),
  CONFIG: createLogPrefix(LOG_PREFIXES.CONFIG),
  MAIN: createLogPrefix(LOG_PREFIXES.MAIN),
  MESSAGE_TEMPLATE: createLogPrefix(LOG_PREFIXES.MESSAGE_TEMPLATE),
  MATTERMOST_CLIENT: createLogPrefix(LOG_PREFIXES.MATTERMOST_CLIENT),
  HEARTBEAT_SERVICE: createLogPrefix(LOG_PREFIXES.HEARTBEAT_SERVICE)
} as const;

// Store config reference
let configInstance: { logging: { disableEmoji: boolean } } | null = null;

// Initialize config reference
export function initializeEmojiConfig(config: { logging: { disableEmoji: boolean } }) {
  configInstance = config;
}

// Helper function to conditionally include emojis
export function emoji(emojiChar: string, fallback: string = ''): string {
  // Check config first, then fall back to env var for early logging
  const disableEmoji = configInstance?.logging.disableEmoji ?? process.env.DISABLE_EMOJI === 'true';
  return disableEmoji ? fallback : emojiChar;
}