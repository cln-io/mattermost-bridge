import dotenv from 'dotenv';
import { Config } from './types';
import fs from 'fs';
import path from 'path';
import { emoji } from './logger-utils';

const LOG_PREFIX = '[config           ]';

// Check if .env.local exists and prefer it over .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  console.log(`${LOG_PREFIX} ${emoji('🔧')}Loading configuration from .env.local (development mode)`.trim());
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  console.log(`${LOG_PREFIX} ${emoji('🔧')}Loading configuration from .env`.trim());
  dotenv.config({ path: envPath });
} else {
  console.log(`${LOG_PREFIX} ${emoji('🔧')}Loading configuration from environment variables`.trim());
  // This will use process.env as-is, useful for Docker where env vars are set directly
  dotenv.config();
}

export function loadConfig(): Config {
  const requiredEnvVars = [
    'MATTERMOST_LEFT_NAME',
    'MATTERMOST_LEFT_SERVER',
    'MATTERMOST_LEFT_USERNAME', 
    'MATTERMOST_LEFT_PASSWORD_B64',  // Changed from MATTERMOST_LEFT_PASSWORD
    'MATTERMOST_LEFT_TEAM',
    'MATTERMOST_RIGHT_NAME',
    'MATTERMOST_RIGHT_SERVER',
    'MATTERMOST_RIGHT_USERNAME',
    'MATTERMOST_RIGHT_PASSWORD_B64',  // Changed from MATTERMOST_RIGHT_PASSWORD
    'SOURCE_CHANNEL_ID',
    'TARGET_CHANNEL_ID'
  ];

  // Check for missing environment variables
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Decode base64 passwords
  const leftPassword = Buffer.from(process.env.MATTERMOST_LEFT_PASSWORD_B64!, 'base64').toString('utf-8');
  const rightPassword = Buffer.from(process.env.MATTERMOST_RIGHT_PASSWORD_B64!, 'base64').toString('utf-8');

  // Parse heartbeat configuration
  const heartbeatUrl = process.env.HEARTBEAT_URL;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '15', 10);

  // Parse logging configuration
  const logLevel = (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
  const debugWebSocketEvents = process.env.DEBUG_WEBSOCKET_EVENTS === 'true';
  const eventSummaryIntervalMinutes = parseInt(process.env.EVENT_SUMMARY_INTERVAL_MINUTES || '10', 10);
  // Parse stats channel updates configuration
  const statsChannelUpdates = process.env.STATS_CHANNEL_UPDATES?.toLowerCase() || 'none';
  if (!['none', 'summary', 'logs'].includes(statsChannelUpdates)) {
    console.error(`${LOG_PREFIX} ${emoji('❌')}Invalid STATS_CHANNEL_UPDATES value: ${statsChannelUpdates}. Must be 'none', 'summary', or 'logs'`.trim());
    process.exit(1);
  }
  const disableEmoji = process.env.DISABLE_EMOJI === 'true';
  const timezone = process.env.TIMEZONE || 'UTC';
  if (timezone !== 'UTC') {
    console.log(`${LOG_PREFIX} ${emoji('🌍')}Timezone configured: ${timezone}`.trim());
  }
  if (statsChannelUpdates === 'none') {
    console.log(`${LOG_PREFIX} ${emoji('🔕')}Status channel updates disabled (STATS_CHANNEL_UPDATES=none)`.trim());
  } else if (statsChannelUpdates === 'summary') {
    console.log(`${LOG_PREFIX} ${emoji('📊')}Status channel will receive event summaries only (STATS_CHANNEL_UPDATES=summary)`.trim());
  } else if (statsChannelUpdates === 'logs') {
    console.log(`${LOG_PREFIX} ${emoji('📝')}Status channel will receive event summaries and logs (STATS_CHANNEL_UPDATES=logs)`.trim());
  }

  // Parse dry-run mode
  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    console.log(`${LOG_PREFIX} ${emoji('🏃‍♂️')}DRY RUN MODE ENABLED - Messages will NOT be posted to target channel`.trim());
  }

  // Parse email exclusion list
  const dontForwardFor: string[] = [];
  if (process.env.DONT_FORWARD_FOR) {
    const domains = process.env.DONT_FORWARD_FOR.split(',').map(d => d.trim()).filter(d => d.length > 0);
    dontForwardFor.push(...domains);
    console.log(`${LOG_PREFIX} ${emoji('🚫')}Email exclusion filter enabled for domains: ${domains.join(', ')}`.trim());
    console.log(`${LOG_PREFIX} ${emoji('📧')}Messages from users with these email domains will NOT be forwarded`.trim());
  }

  // Parse footer icon configuration
  const footerIcon = process.env.FOOTER_ICON?.trim();
  if (footerIcon) {
    console.log(`${LOG_PREFIX} ${emoji('🎨')}Custom footer icon configured: ${footerIcon}`.trim());
  } else {
    console.log(`${LOG_PREFIX} ${emoji('🎨')}No footer icon configured (FOOTER_ICON is empty)`.trim());
  }

  // Parse left message emoji configuration
  const leftMessageEmoji = process.env.LEFT_MESSAGE_EMOJI?.trim();
  if (leftMessageEmoji) {
    console.log(`${LOG_PREFIX} ${emoji('📮')}Left message emoji: :${leftMessageEmoji}: (reacts to original messages after bridging)`.trim());
  } else {
    console.log(`${LOG_PREFIX} ${emoji('📮')}Left message emoji disabled (LEFT_MESSAGE_EMOJI not set)`.trim());
  }

  // Log information about the new attachment-based system
  console.log(`${LOG_PREFIX} ${emoji('📎')}Using minimal baby blue attachments with profile pictures`.trim());
  console.log(`${LOG_PREFIX} ${emoji('🖼️')}Profile pictures will be downloaded from source and uploaded to target`.trim());
  console.log(`${LOG_PREFIX} ${emoji('💾')}Profile pictures are cached to avoid re-uploading`.trim());
  console.log(`${LOG_PREFIX} ${emoji('📁')}File attachments will be forwarded from source to target`.trim());
  console.log(`${LOG_PREFIX} ${emoji('👤')}Author names show: Nickname - @username (if nickname set)`.trim());
  console.log(`${LOG_PREFIX} ${emoji('🎨')}Format: [Profile Picture] AuthorName | Message | Footer: ServerName • #channel • Time`.trim());

  // Parse source channel ID(s) - can be a single ID or comma-separated list
  let sourceChannelId: string | string[];
  const sourceChannelIdRaw = process.env.SOURCE_CHANNEL_ID!;
  
  if (sourceChannelIdRaw.includes(',')) {
    // Parse as array
    sourceChannelId = sourceChannelIdRaw.split(',').map(id => id.trim()).filter(id => id.length > 0);
    console.log(`${LOG_PREFIX} ${emoji('📋')}Monitoring ${sourceChannelId.length} source channels`.trim());
  } else {
    // Keep as single string
    sourceChannelId = sourceChannelIdRaw;
  }

  return {
    left: {
      name: process.env.MATTERMOST_LEFT_NAME!,
      server: process.env.MATTERMOST_LEFT_SERVER!,
      username: process.env.MATTERMOST_LEFT_USERNAME!,
      password: leftPassword,
      mfaSeed: process.env.MATTERMOST_LEFT_MFA_SEED,
      team: process.env.MATTERMOST_LEFT_TEAM!
    },
    right: {
      name: process.env.MATTERMOST_RIGHT_NAME!,
      server: process.env.MATTERMOST_RIGHT_SERVER!,
      username: process.env.MATTERMOST_RIGHT_USERNAME!,
      password: rightPassword,
      mfaSeed: process.env.MATTERMOST_RIGHT_MFA_SEED,
      team: process.env.MATTERMOST_RIGHT_TEAM
    },
    rule: {
      sourceChannelId: sourceChannelId,
      targetChannelId: process.env.TARGET_CHANNEL_ID!
    },
    heartbeat: {
      url: heartbeatUrl,
      intervalMinutes: heartbeatInterval
    },
    logging: {
      level: logLevel,
      debugWebSocketEvents: debugWebSocketEvents,
      eventSummaryIntervalMinutes: eventSummaryIntervalMinutes,
      statsChannelUpdates: statsChannelUpdates as 'none' | 'summary' | 'logs',
      disableEmoji: disableEmoji,
      timezone: timezone
    },
    dryRun: dryRun,
    dontForwardFor: dontForwardFor,
    footerIcon: footerIcon || undefined,
    leftMessageEmoji: leftMessageEmoji || undefined
  };
}