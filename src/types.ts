export interface MattermostConfig {
  name: string;
  server: string;
  username: string;
  password: string;
  mfaSeed?: string;
  team?: string; // Team name for generating message links
  botToken?: string; // Bot token for authentication (skips username/password if provided)
}

export interface BridgeRule {
  sourceChannelId: string | string[];
  targetChannelId: string;
}

export interface HeartbeatConfig {
  url?: string;
  intervalMinutes: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  debugWebSocketEvents: boolean;
  eventSummaryIntervalMinutes: number; // New field for event summary interval
  statsChannelUpdates: 'none' | 'summary' | 'logs'; // Control what gets posted to status channel
  disableEmoji: boolean; // Disable emojis in console output
  timezone: string; // Timezone for timestamp formatting (e.g., 'Europe/Brussels', 'CET')
}

export interface Config {
  left: MattermostConfig;
  right: MattermostConfig;
  rule: BridgeRule;
  heartbeat: HeartbeatConfig;
  logging: LoggingConfig;
  dryRun: boolean; // New field for dry-run mode
  dontForwardFor: string[]; // List of email domains to exclude
  footerIcon?: string; // Optional footer icon URL
  leftMessageEmoji?: string; // Emoji to add to original message after bridging
  catchUp: CatchUpConfig; // Message catch-up configuration
  requestAcknowledgement: boolean; // Enable acknowledgement button on messages
}

export interface CatchUpConfig {
  enabled: boolean;
  persistencePath?: string;
  maxMessagesToRecover: number;
}

export interface MattermostMessage {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  username?: string;
  nickname?: string; // User's display nickname
  create_at: number;
  edit_at?: number; // Timestamp when message was edited
  file_ids?: string[]; // File attachment IDs
}

export interface Channel {
  id: string;
  name: string;
  display_name: string;
  team_id: string;
  type: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  displayName: string;
  type: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  is_bot?: boolean;
  bot_description?: string;
}

// Message attachment interface for minimal formatting
export interface MessageAttachment {
  color?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  text?: string;
  footer?: string;
  footer_icon?: string;
  fallback?: string;
}