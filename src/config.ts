import dotenv from 'dotenv';
import { Config } from './types';
import fs from 'fs';
import path from 'path';

const LOG_PREFIX = '[config           ]';

// Check if .env.local exists and prefer it over .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  console.log(`${LOG_PREFIX} 🔧 Loading configuration from .env.local (development mode)`);
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  console.log(`${LOG_PREFIX} 🔧 Loading configuration from .env`);
  dotenv.config({ path: envPath });
} else {
  console.log(`${LOG_PREFIX} 🔧 Loading configuration from environment variables`);
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

  // Parse dry-run mode
  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    console.log(`${LOG_PREFIX} 🏃‍♂️ DRY RUN MODE ENABLED - Messages will NOT be posted to target channel`);
  }

  // Parse email exclusion list
  const dontForwardFor: string[] = [];
  if (process.env.DONT_FORWARD_FOR) {
    const domains = process.env.DONT_FORWARD_FOR.split(',').map(d => d.trim()).filter(d => d.length > 0);
    dontForwardFor.push(...domains);
    console.log(`${LOG_PREFIX} 🚫 Email exclusion filter enabled for domains: ${domains.join(', ')}`);
    console.log(`${LOG_PREFIX} 📧 Messages from users with these email domains will NOT be forwarded`);
  }

  // Parse footer icon configuration
  const footerIcon = process.env.FOOTER_ICON?.trim();
  if (footerIcon) {
    console.log(`${LOG_PREFIX} 🎨 Custom footer icon configured: ${footerIcon}`);
  } else {
    console.log(`${LOG_PREFIX} 🎨 No footer icon configured (FOOTER_ICON is empty)`);
  }

  // Log information about the new attachment-based system
  console.log(`${LOG_PREFIX} 📎 Using minimal baby blue attachments with profile pictures`);
  console.log(`${LOG_PREFIX} 🖼️ Profile pictures will be downloaded from source and uploaded to target`);
  console.log(`${LOG_PREFIX} 💾 Profile pictures are cached to avoid re-uploading`);
  console.log(`${LOG_PREFIX} 📁 File attachments will be forwarded from source to target`);
  console.log(`${LOG_PREFIX} 👤 Author names show: Nickname - @username (if nickname set)`);
  console.log(`${LOG_PREFIX} 🎨 Format: [Profile Picture] AuthorName | Message | Footer: ServerName • #channel • Time`);

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
      sourceChannelId: process.env.SOURCE_CHANNEL_ID!,
      targetChannelId: process.env.TARGET_CHANNEL_ID!
    },
    heartbeat: {
      url: heartbeatUrl,
      intervalMinutes: heartbeatInterval
    },
    logging: {
      level: logLevel,
      debugWebSocketEvents: debugWebSocketEvents,
      eventSummaryIntervalMinutes: eventSummaryIntervalMinutes
    },
    dryRun: dryRun,
    dontForwardFor: dontForwardFor,
    footerIcon: footerIcon || undefined
  };
}