import { MattermostMessage, MattermostConfig, MessageAttachment, Config } from './types';
import { PADDED_PREFIXES } from './logger-utils';

const LOG_PREFIX = PADDED_PREFIXES.MESSAGE_TEMPLATE;

export function createMessageAttachment(
  message: MattermostMessage, 
  sourceConfig: MattermostConfig,
  sourceChannelName: string,
  userProfilePictureUrl?: string,
  footerIconUrl?: string,
  config?: Config
): MessageAttachment {
  // Generate link to original message
  const messageLink = generateMessageLink(message, sourceConfig);
  
  // Format timestamp as human-readable time in configured timezone
  const timestamp = new Date(message.create_at);
  const timezone = config?.logging?.timezone || 'UTC';
  const timeString = timestamp.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true,
    timeZone: timezone
  });
  
  // Format author name with nickname - @username if nickname exists
  let authorName = message.username || 'Unknown';
  if (message.nickname && message.nickname.trim() !== '') {
    authorName = `${message.nickname} - @${message.username}`;
  }
  
  // Create fallback text with file attachment info
  const fileInfo = message.file_ids && message.file_ids.length > 0 
    ? ` [${message.file_ids.length} file(s)]` 
    : '';
  
  // Create minimal attachment with baby blue color
  const attachment: MessageAttachment = {
    color: "#87CEEB", // Baby blue
    author_name: authorName,
    author_link: messageLink,
    author_icon: userProfilePictureUrl,
    text: message.message,
    footer: `${sourceConfig.name} • #${sourceChannelName} • ${timeString}`,
    fallback: `${authorName} in #${sourceChannelName}: ${message.message}${fileInfo}`
  };

  // Only add footer_icon if a URL is provided
  if (footerIconUrl) {
    attachment.footer_icon = footerIconUrl;
  }

  console.log(`${LOG_PREFIX} 📎 Created baby blue attachment for ${authorName}`);
  
  return attachment;
}

function generateMessageLink(message: MattermostMessage, sourceConfig: MattermostConfig): string {
  const normalizedServer = sourceConfig.server.replace(/\/+$/, '');
  
  if (!sourceConfig.team) {
    return `${normalizedServer}/pl/${message.id}`;
  }
  
  return `${normalizedServer}/${sourceConfig.team}/pl/${message.id}`;
}