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
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
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

  // Bot/webhook posts carry their body in props.attachments, leaving message.message empty.
  // Flatten any source attachments into the body so the content survives the bridge.
  const renderedAttachments = renderAttachmentsToText(message.props?.attachments ?? []);
  const bodyText = [message.message, renderedAttachments]
    .filter(part => part && part.trim() !== '')
    .join('\n\n');

  // Create minimal attachment with baby blue color
  const attachment: MessageAttachment = {
    color: "#87CEEB", // Baby blue
    author_name: authorName,
    author_link: messageLink,
    author_icon: userProfilePictureUrl,
    text: bodyText,
    footer: `${sourceConfig.name} • #${sourceChannelName} • ${timeString}`,
    fallback: `${authorName} in #${sourceChannelName}: ${bodyText}${fileInfo}`
  };

  // Only add footer_icon if a URL is provided
  if (footerIconUrl) {
    attachment.footer_icon = footerIconUrl;
  }

  console.log(`${LOG_PREFIX} 📎 Created baby blue attachment for ${authorName}`);
  
  return attachment;
}

/**
 * Flattens Mattermost message attachments (as posted by bots/webhooks) into a single
 * markdown text block. For each attachment we keep pretext, title, text and fields in
 * reading order, skipping empty parts. Multiple attachments are separated by a blank line.
 */
function renderAttachmentsToText(attachments: any[]): string {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }

  return attachments
    .map(att => {
      if (!att || typeof att !== 'object') {
        return '';
      }

      const parts: string[] = [];

      if (att.pretext && String(att.pretext).trim() !== '') {
        parts.push(String(att.pretext).trim());
      }
      if (att.title && String(att.title).trim() !== '') {
        parts.push(`**${String(att.title).trim()}**`);
      }
      if (att.text && String(att.text).trim() !== '') {
        parts.push(String(att.text).trim());
      }
      if (Array.isArray(att.fields)) {
        for (const field of att.fields) {
          if (!field) continue;
          const fieldTitle = field.title ? String(field.title).trim() : '';
          const fieldValue = field.value !== undefined && field.value !== null
            ? String(field.value).trim()
            : '';
          if (fieldTitle && fieldValue) {
            parts.push(`**${fieldTitle}**\n${fieldValue}`);
          } else if (fieldValue) {
            parts.push(fieldValue);
          } else if (fieldTitle) {
            parts.push(`**${fieldTitle}**`);
          }
        }
      }

      return parts.join('\n');
    })
    .filter(block => block.trim() !== '')
    .join('\n\n');
}

function generateMessageLink(message: MattermostMessage, sourceConfig: MattermostConfig): string {
  const normalizedServer = sourceConfig.server.replace(/\/+$/, '');
  
  if (!sourceConfig.team) {
    return `${normalizedServer}/pl/${message.id}`;
  }
  
  return `${normalizedServer}/${sourceConfig.team}/pl/${message.id}`;
}