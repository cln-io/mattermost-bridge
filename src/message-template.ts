import { MattermostMessage, MattermostConfig, Config } from './types';

const LOG_PREFIX = '[message-template ]';

export function applyTemplate(
  template: string, 
  message: MattermostMessage, 
  sourceConfig: MattermostConfig,
  config?: Config
): string {
  // Generate link to original message
  const messageLink = generateMessageLink(message, sourceConfig);
  
  // Convert \n escape sequences to actual newlines
  const processedTemplate = template.replace(/\\n/g, '\n');
  
  return processedTemplate
    .replace(/\{\{username\}\}/g, message.username || 'Unknown')
    .replace(/\{\{message\}\}/g, message.message)
    .replace(/\{\{user_id\}\}/g, message.user_id)
    .replace(/\{\{timestamp\}\}/g, formatTimestamp(message.create_at, config?.logging?.timezone))
    .replace(/\{\{link\}\}/g, messageLink)
    .replace(/\{\{source_name\}\}/g, sourceConfig.name);
}

function generateMessageLink(message: MattermostMessage, sourceConfig: MattermostConfig): string {
  // Normalize server URL to prevent double slashes
  const normalizedServer = sourceConfig.server.replace(/\/+$/, '');
  
  // Mattermost message link format: 
  // https://server/team/pl/message_id
  if (!sourceConfig.team) {
    return `${normalizedServer}/pl/${message.id}`;
  }
  
  return `${normalizedServer}/${sourceConfig.team}/pl/${message.id}`;
}

function formatTimestamp(timestamp: number, timezone?: string): string {
  const date = new Date(timestamp);
  const tz = timezone || 'UTC';
  
  return date.toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}