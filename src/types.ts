export interface MattermostConfig {
  name: string;
  server: string;
  username: string;
  password: string;
  mfaSeed?: string;
  team?: string; // Team name for generating message links
}

export interface BridgeRule {
  sourceChannelId: string;
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
  updateDmChannelHeader: boolean; // New field for DM channel header updates
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
}

export interface MattermostMessage {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  username?: string;
  nickname?: string; // User's display nickname
  create_at: number;
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