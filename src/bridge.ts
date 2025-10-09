import { MattermostClient } from './mattermost-client';
import { Config, MattermostMessage, ChannelInfo } from './types';
import { createMessageAttachment } from './message-attachment';
import { HeartbeatService } from './heartbeat-service';
import { PADDED_PREFIXES, emoji } from './logger-utils';
import { LogBuffer } from './log-buffer';
import { MessageTracker } from './message-tracker';

export class MattermostBridge {
  private leftClient: MattermostClient;
  private rightClient: MattermostClient;
  private heartbeatService: HeartbeatService;
  private sourceChannelIds: string[] = [];
  private targetChannelId: string = '';
  private sourceChannelInfos: Map<string, ChannelInfo> = new Map();
  private targetChannelInfo: ChannelInfo | null = null;
  private readonly LOG_PREFIX = PADDED_PREFIXES.BRIDGE;
  
  // Cache for uploaded profile pictures to avoid re-uploading
  private profilePictureCache: Map<string, string> = new Map();
  
  // Message ID mapping: source message ID -> target message ID
  private messageIdMap: Map<string, string> = new Map();
  
  // Centralized event tracking
  private leftEvents: Map<string, number> = new Map();
  private bridgeEvents: Map<string, number> = new Map();
  private eventSummaryTimer: NodeJS.Timeout | null = null;
  private lastEventSummaryTime: Date = new Date();
  private eventSummaryCount: number = 0;
  
  // Log buffer for capturing stdout
  private logBuffer: LogBuffer;
  
  // Message tracker for catch-up mode
  private messageTracker: MessageTracker;

  constructor(private config: Config) {
    // Create log buffer first so we can pass it to clients
    this.logBuffer = new LogBuffer(5000, config.logging.timezone); // Keep up to 5000 log lines
    
    // Initialize message tracker
    this.messageTracker = new MessageTracker(
      config.catchUp.enabled,
      config.catchUp.persistencePath
    );
    
    this.leftClient = new MattermostClient(config.left, config.logging, false, this.trackLeftEvent.bind(this), this.logBuffer);
    this.rightClient = new MattermostClient(config.right, config.logging, true, undefined, this.logBuffer);
    this.heartbeatService = new HeartbeatService(config.heartbeat);
  }

  async start(): Promise<void> {
    console.log(`${this.LOG_PREFIX} ${emoji('🚀')}Starting Mattermost Bridge...`.trim());
    
    // Start log buffer to capture and enhance all logs
    this.logBuffer.start();
    
    try {
      // Step 1: Ping both servers to check connectivity
      console.log(`${this.LOG_PREFIX} ${emoji('🏓')}Checking server connectivity...`.trim());
      await this.leftClient.ping();
      await this.rightClient.ping();
      console.log(`${this.LOG_PREFIX} ${emoji('✅')}Both servers are reachable`.trim());
      console.log('');

      // Step 2: Login to both instances
      console.log(`${this.LOG_PREFIX} ${emoji('🔐')}Authenticating with both servers...`.trim());
      await this.leftClient.login();
      await this.rightClient.login();
      console.log(`${this.LOG_PREFIX} ${emoji('✅')}Successfully authenticated with both servers`.trim());
      console.log('');

      // Step 3: Resolve channel information
      console.log(`${this.LOG_PREFIX} ${emoji('📋')}Resolving channel information...`.trim());
      
      // Handle source channel(s)
      if (Array.isArray(this.config.rule.sourceChannelId)) {
        this.sourceChannelIds = this.config.rule.sourceChannelId;
      } else {
        this.sourceChannelIds = [this.config.rule.sourceChannelId];
      }
      
      this.targetChannelId = this.config.rule.targetChannelId;

      // Resolve source channel(s) info
      for (const channelId of this.sourceChannelIds) {
        console.log(`${this.LOG_PREFIX} ${emoji('🔍')}[${this.config.left.name}] Looking up channel (${channelId})[${channelId}]`.trim());
        const channelInfo = await this.leftClient.getChannelById(channelId);
        
        if (!channelInfo) {
          throw new Error(`Source channel '${channelId}' not found on ${this.config.left.name}`);
        }
        
        this.sourceChannelInfos.set(channelId, channelInfo);
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.left.name}] Found channel: (${channelInfo.name})[${channelId}]`.trim());
      }

      // Resolve target channel info
      console.log(`${this.LOG_PREFIX} ${emoji('🔍')}[${this.config.right.name}] Looking up channel (${this.targetChannelId})[${this.targetChannelId}]`.trim());

      // Check if we can access the channel, and if not (403 error), try to join it first
      try {
        this.targetChannelInfo = await this.rightClient.getChannelById(this.targetChannelId);
      } catch (error: any) {
        if (error.response?.status === 403) {
          console.log(`${this.LOG_PREFIX} ${emoji('🔒')}[${this.config.right.name}] Permission denied - checking if bot needs to join channel...`.trim());

          // Check if bot is a member
          const isMember = await this.rightClient.isChannelMember(this.targetChannelId);

          if (!isMember) {
            console.log(`${this.LOG_PREFIX} ${emoji('🤖')}[${this.config.right.name}] Bot is not a member - attempting to join channel [${this.targetChannelId}]...`.trim());
            const joined = await this.rightClient.joinChannel(this.targetChannelId);

            if (!joined) {
              throw new Error(`Failed to join target channel '${this.targetChannelId}' on ${this.config.right.name}. Bot may need to be manually added to the channel.`);
            }

            // Try to get channel info again after joining
            this.targetChannelInfo = await this.rightClient.getChannelById(this.targetChannelId);
          } else {
            // Bot is a member but still got 403 - something else is wrong
            throw error;
          }
        } else {
          // Not a 403 error, re-throw
          throw error;
        }
      }

      if (!this.targetChannelInfo) {
        throw new Error(`Target channel '${this.targetChannelId}' not found on ${this.config.right.name}`);
      }

      console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.right.name}] Found channel: (${this.targetChannelInfo.name})[${this.targetChannelId}]`.trim());
      console.log('');

      // Step 4: Display bridge configuration
      console.log(`${this.LOG_PREFIX} ${emoji('📡')}Bridge Configuration:`.trim());
      if (this.sourceChannelIds.length === 1) {
        const channelInfo = this.sourceChannelInfos.get(this.sourceChannelIds[0])!;
        console.log(`${this.LOG_PREFIX}    Source: (${channelInfo.name})[${this.sourceChannelIds[0]}] on ${this.config.left.name}`);
      } else {
        console.log(`${this.LOG_PREFIX}    Sources (${this.sourceChannelIds.length} channels) on ${this.config.left.name}:`);
        for (const [channelId, channelInfo] of this.sourceChannelInfos) {
          console.log(`${this.LOG_PREFIX}        - (${channelInfo.name})[${channelId}]`);
        }
      }
      console.log(`${this.LOG_PREFIX}    Target: (${this.targetChannelInfo.name})[${this.targetChannelId}] on ${this.config.right.name}`);
      console.log(`${this.LOG_PREFIX}    Format: Minimal attachments with profile pictures`);
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX}    Mode: DRY RUN (messages will NOT be posted)`);
      }
      if (this.config.dontForwardFor.length > 0) {
        console.log(`${this.LOG_PREFIX}    Email Filter: Excluding messages from ${this.config.dontForwardFor.join(', ')}`);
      }
      console.log('');

      // Step 5: Catch up on missed messages if enabled
      if (this.messageTracker.isEnabled()) {
        console.log(`${this.LOG_PREFIX} ${emoji('🔄')}Starting catch-up process for missed messages...`.trim());
        await this.performCatchUp();
        console.log('');
      }

      // Step 6: Start listening for messages on all source channels
      this.leftClient.connectWebSocket(
        this.sourceChannelIds,
        (msg) => this.handleMessage(msg, msg.channel_id)
      );
      
      // Set up message edit handler
      this.leftClient.setMessageEditHandler(
        (msg) => this.handleMessageEdit(msg, msg.channel_id)
      );

      console.log(`${this.LOG_PREFIX} ${emoji('✅')}Bridge is now active and listening for messages...`.trim());
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}DRY RUN MODE - Messages will be logged but NOT posted`.trim());
      }
      console.log('');

      // Step 6: Start centralized event tracking
      this.startEventSummaryTimer();
      
      // Step 7: Start heartbeat monitoring (only after successful connection)
      this.heartbeatService.start();
      
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to start bridge:`.trim(), error);
      throw error;
    }
  }

  private async handleMessage(message: MattermostMessage, sourceChannelId: string): Promise<void> {
    const sourceChannelInfo = this.sourceChannelInfos.get(sourceChannelId);
    const sourceChannelName = sourceChannelInfo?.name || sourceChannelId;
    const targetChannelName = this.targetChannelInfo?.name || this.targetChannelId;
    
    try {
      // Get user details (cached for performance)
      const user = await this.leftClient.getUser(message.user_id);
      
      // Set channel and user context for log buffer using the most up-to-date info
      const channelContext = `${sourceChannelName}[${sourceChannelId}]`;
      const userContext = `${user.username}[${message.user_id}]`;
      this.logBuffer.setChannelContext('current', channelContext);
      this.logBuffer.setUserContext('current', userContext);
      
      console.log(`${this.LOG_PREFIX} ${emoji('📨')}(${sourceChannelName})[${sourceChannelId}] (${message.nickname ? `${message.nickname} (@${message.username})` : message.username})[${message.user_id}]: ${message.message}`.trim());
      
      // Check if message has file attachments
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('📎')}(${sourceChannelName})[${sourceChannelId}] Message has ${message.file_ids.length} file attachment(s)`.trim());
      }
      
      // Check if user's email matches any excluded domains
      if (this.config.dontForwardFor.length > 0 && user.email) {
        const userEmail = user.email.toLowerCase();
        const shouldExclude = this.config.dontForwardFor.some(domain => {
          const normalizedDomain = domain.toLowerCase();
          // If domain doesn't start with @, add it
          const domainToCheck = normalizedDomain.startsWith('@') ? normalizedDomain : '@' + normalizedDomain;
          return userEmail.endsWith(domainToCheck);
        });
        
        if (shouldExclude) {
          console.log(`${this.LOG_PREFIX} ${emoji('🚫')}(${sourceChannelName})[${sourceChannelId}] Message from ${user.username} (${user.email}) excluded due to email domain filter`.trim());
          // Track excluded message for status updates
          this.trackBridgeEvent('message_excluded');
          return; // Skip this message
        }
      }
      
      // Get or upload profile picture
      let profilePictureUrl: string | undefined;
      const displayName = message.nickname ? `${message.nickname} (@${message.username})` : message.username;
      
      // Check cache first
      if (this.profilePictureCache.has(message.user_id)) {
        profilePictureUrl = this.profilePictureCache.get(message.user_id);
        console.log(`${this.LOG_PREFIX} ${emoji('🖼️')}(${sourceChannelName})[${sourceChannelId}] Using cached profile picture for ${displayName}`.trim());
      } else {
        // Download profile picture from source
        console.log(`${this.LOG_PREFIX} ${emoji('📥')}(${sourceChannelName})[${sourceChannelId}] Downloading profile picture for ${displayName}...`.trim());
        const imageBuffer = await this.leftClient.downloadProfilePicture(message.user_id);
        
        if (imageBuffer) {
          // Upload to target server
          console.log(`${this.LOG_PREFIX} ${emoji('📤')}(${sourceChannelName})[${sourceChannelId}] Uploading profile picture for ${displayName}...`.trim());
          const uploadedUrl = await this.rightClient.uploadProfilePicture(
            imageBuffer, 
            `${message.user_id}_profile.png`, 
            this.targetChannelId
          );
          
          if (uploadedUrl) {
            profilePictureUrl = uploadedUrl;
            // Cache the uploaded URL
            this.profilePictureCache.set(message.user_id, uploadedUrl);
            console.log(`${this.LOG_PREFIX} ${emoji('✅')}(${sourceChannelName})[${sourceChannelId}] Profile picture uploaded and cached for ${displayName}`.trim());
          } else {
            console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}(${sourceChannelName})[${sourceChannelId}] Failed to upload profile picture for ${displayName}`.trim());
          }
        } else {
          console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}(${sourceChannelName})[${sourceChannelId}] Failed to download profile picture for ${displayName}`.trim());
        }
      }
      
      // Handle file attachments
      let uploadedFileIds: string[] = [];
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('📎')}(${sourceChannelName})[${sourceChannelId}] Processing ${message.file_ids.length} file attachment(s)...`.trim());
        
        const filesToUpload: { buffer: Buffer; filename: string }[] = [];
        
        for (const fileId of message.file_ids) {
          console.log(`${this.LOG_PREFIX} ${emoji('📥')}(${sourceChannelName})[${sourceChannelId}] Downloading file: ${fileId}`.trim());
          const fileData = await this.leftClient.downloadFile(fileId);
          
          if (fileData) {
            filesToUpload.push(fileData);
            console.log(`${this.LOG_PREFIX} ${emoji('✅')}(${sourceChannelName})[${sourceChannelId}] Downloaded file: ${fileData.filename}`.trim());
          } else {
            console.log(`${this.LOG_PREFIX} ${emoji('❌')}(${sourceChannelName})[${sourceChannelId}] Failed to download file: ${fileId}`.trim());
          }
        }
        
        if (filesToUpload.length > 0) {
          console.log(`${this.LOG_PREFIX} ${emoji('📤')}(${sourceChannelName})[${sourceChannelId}] Uploading ${filesToUpload.length} file(s) to target server...`.trim());
          uploadedFileIds = await this.rightClient.uploadMultipleFiles(filesToUpload, this.targetChannelId);
          console.log(`${this.LOG_PREFIX} ${emoji('✅')}(${sourceChannelName})[${sourceChannelId}] Successfully uploaded ${uploadedFileIds.length} file(s)`.trim());
        }
      }
      
      // Create minimal attachment with profile picture
      const attachment = createMessageAttachment(
        message, 
        this.config.left, 
        sourceChannelName,
        profilePictureUrl,
        this.config.footerIcon,
        this.config
      );
      
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Would post to (${targetChannelName})[${this.targetChannelId}] on ${this.config.right.name}:`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Author: ${attachment.author_name}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Message: ${attachment.text}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Footer: ${attachment.footer}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Color: ${attachment.color} (baby blue)`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Profile Picture: ${attachment.author_icon || 'none'}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Footer Icon: ${attachment.footer_icon || 'none'}`.trim());
        if (uploadedFileIds.length > 0) {
          console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] File Attachments: ${uploadedFileIds.length} file(s)`.trim());
        }
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Message NOT sent (dry-run mode)`.trim());
        
        // Track dry run event for status updates
        this.trackBridgeEvent('message_dry_run');
      } else {
        // Post message with attachment and files
        const postedMessage = await this.rightClient.postMessageWithAttachment(
          this.targetChannelId, 
          '', // Empty main message text
          attachment,
          uploadedFileIds.length > 0 ? uploadedFileIds : undefined
        );
        
        // Store the message ID mapping
        if (postedMessage && postedMessage.id) {
          this.messageIdMap.set(message.id, postedMessage.id);
          console.log(`${this.LOG_PREFIX} ${emoji('🔗')}(${sourceChannelName})[${sourceChannelId}] Mapped source message ${message.id} to target message ${postedMessage.id}`.trim());
          
          // Limit map size to prevent memory issues (keep last 1000 messages)
          if (this.messageIdMap.size > 1000) {
            const firstKey = this.messageIdMap.keys().next().value;
            if (firstKey) {
              this.messageIdMap.delete(firstKey);
            }
          }
        }
        
        const fileInfo = uploadedFileIds.length > 0 ? ` with ${uploadedFileIds.length} file(s)` : '';
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}(${sourceChannelName})[${sourceChannelId}] Message bridged to (${targetChannelName})[${this.targetChannelId}] on ${this.config.right.name}${fileInfo}`.trim());
        
        // Add emoji reaction to original message if configured
        if (this.config.leftMessageEmoji) {
          await this.leftClient.addReaction(message.id, this.config.leftMessageEmoji);
        }
        
        // Track message bridging event on destination client for status updates
        this.trackBridgeEvent('message_bridged');
        
        // Track the forwarded message for catch-up functionality
        this.messageTracker.trackForwardedMessage(sourceChannelId, message);
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}(${sourceChannelName})[${sourceChannelId}] Error bridging message:`.trim(), error);
    } finally {
      // Clear channel and user context to prevent bleeding between messages
      this.logBuffer.clearChannelContext('current');
      this.logBuffer.clearUserContext('current');
    }
  }

  private async handleMessageEdit(message: MattermostMessage, sourceChannelId: string): Promise<void> {
    try {
      // Track the event
      this.trackLeftEvent('post_edited');
      
      // Get cached channel info
      const sourceChannelInfo = this.sourceChannelInfos.get(sourceChannelId);
      const sourceChannelName = sourceChannelInfo?.name || sourceChannelId;
      const targetChannelName = this.targetChannelInfo?.name || this.targetChannelId;
      
      // Set context for LogBuffer
      this.logBuffer.setChannelContext('current', `${sourceChannelName}[${sourceChannelId}]`);
      this.logBuffer.setUserContext('current', `${message.username}[${message.user_id}]`);
      
      console.log(`${this.LOG_PREFIX} ${emoji('✏️')}(${sourceChannelName})[${sourceChannelId}] Processing edited message ${message.id} from (${message.username})[${message.user_id}]`.trim());
      
      // Check if this is from a user we should ignore
      if (this.config.dontForwardFor?.includes(message.user_id)) {
        console.log(`${this.LOG_PREFIX} ${emoji('🚫')}(${sourceChannelName})[${sourceChannelId}] Ignoring edited message from excluded user (${message.username})[${message.user_id}]`.trim());
        return;
      }
      
      // Look up the target message ID
      const targetMessageId = this.messageIdMap.get(message.id);
      
      if (!targetMessageId) {
        console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}(${sourceChannelName})[${sourceChannelId}] No target message found for edited source message ${message.id} - might be from before bridge started`.trim());
        return;
      }
      
      console.log(`${this.LOG_PREFIX} ${emoji('🔗')}(${sourceChannelName})[${sourceChannelId}] Found target message ${targetMessageId} for source message ${message.id}`.trim());
      
      // Get the original target message to preserve its structure
      const targetPost = await this.rightClient.getPost(targetMessageId);
      
      if (!targetPost) {
        console.log(`${this.LOG_PREFIX} ${emoji('❌')}(${sourceChannelName})[${sourceChannelId}] Failed to retrieve target message ${targetMessageId}`.trim());
        return;
      }
      
      // Validate that the target post can be edited
      if (targetPost.type && targetPost.type !== '') {
        console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}(${sourceChannelName})[${sourceChannelId}] Cannot edit system message ${targetMessageId} (type: ${targetPost.type})`.trim());
        return;
      }
      
      // Update the attachment with the new message content
      const attachment = createMessageAttachment(
        message,
        this.config.left,
        sourceChannelName,
        targetPost.props?.attachments?.[0]?.author_icon, // Preserve existing profile picture
        this.config.footerIcon,
        this.config
      );
      
      // Create updated post data
      const updatedPostData = {
        id: targetMessageId,
        message: '', // Keep empty main message
        props: {
          ...targetPost.props,
          attachments: [attachment]
        }
      };
      
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] Would update message ${targetMessageId} in (${targetChannelName})[${this.targetChannelId}]`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}(${sourceChannelName})[${sourceChannelId}] [DRY RUN] New text: ${attachment.text}`.trim());
        this.trackBridgeEvent('message_edit_dry_run');
      } else {
        // Update the message
        await this.rightClient.updateMessage(targetMessageId, '', updatedPostData.props);
        
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}(${sourceChannelName})[${sourceChannelId}] Message ${targetMessageId} updated in (${targetChannelName})[${this.targetChannelId}]`.trim());
        
        // Track message edit bridging event
        this.trackBridgeEvent('message_edit_bridged');
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Error bridging message edit:`.trim(), error);
    } finally {
      // Clear channel and user context to prevent bleeding between messages
      this.logBuffer.clearChannelContext('current');
      this.logBuffer.clearUserContext('current');
    }
  }

  private trackLeftEvent(eventType: string): void {
    this.leftEvents.set(eventType, (this.leftEvents.get(eventType) || 0) + 1);
  }

  private trackBridgeEvent(eventType: string): void {
    this.bridgeEvents.set(eventType, (this.bridgeEvents.get(eventType) || 0) + 1);
  }

  private startEventSummaryTimer(): void {
    if (this.eventSummaryTimer) {
      clearInterval(this.eventSummaryTimer);
    }

    const intervalMinutes = this.config.logging.eventSummaryIntervalMinutes;
    const intervalMs = intervalMinutes * 60 * 1000;

    console.log(`${this.LOG_PREFIX} ${emoji('📊')}Starting centralized event summary (every ${intervalMinutes} minutes)`.trim());
    if (this.config.logging.statsChannelUpdates === 'logs') {
      console.log(`${this.LOG_PREFIX} ${emoji('📝')}Combined summaries + logs to status channel enabled (last 30 lines per update)`.trim());
    } else if (this.config.logging.statsChannelUpdates === 'summary') {
      console.log(`${this.LOG_PREFIX} ${emoji('📊')}Event summaries will be posted to status channel`.trim());
    }
    
    this.eventSummaryTimer = setInterval(async () => {
      await this.logEventSummary();
    }, intervalMs);
    
    // Unref the timer so it doesn't prevent the process from exiting
    this.eventSummaryTimer.unref();
  }

  private async stopEventSummaryTimer(): Promise<void> {
    if (this.eventSummaryTimer) {
      clearInterval(this.eventSummaryTimer);
      this.eventSummaryTimer = null;
      await this.logEventSummary();
    }
  }

  private async logEventSummary(): Promise<void> {
    const now = new Date();
    const duration = Math.round((now.getTime() - this.lastEventSummaryTime.getTime()) / 1000);
    this.eventSummaryCount++;
    
    const intervalMs = this.config.logging.eventSummaryIntervalMinutes * 60 * 1000;
    const nextSummaryTime = new Date(now.getTime() + intervalMs);
    const nextTimeStr = nextSummaryTime.toLocaleString('en-CA', { 
      hour12: false, 
      timeZone: this.config.logging.timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Generate summary sections
    const leftSummary = this.generateEventSummary(this.leftEvents, 'Left');
    const bridgeSummary = this.generateEventSummary(this.bridgeEvents, 'Bridge');
    
    let summaryText: string;
    if (this.leftEvents.size === 0 && this.bridgeEvents.size === 0) {
      // Check WebSocket health when no events occur
      const wsHealth = this.leftClient.getWebSocketHealth();
      const healthInfo = wsHealth ? ` [WS: ${wsHealth}]` : ' [WS: disconnected]';
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): No events${healthInfo} - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} ${emoji('📊')}${summaryText}`.trim());
      
      // Force reconnection if WebSocket is in a bad state
      if (!wsHealth || wsHealth === 'CLOSED' || wsHealth === 'CLOSING') {
        console.log(`${this.LOG_PREFIX} ${emoji('🔄')}Forcing WebSocket reconnection due to bad state: ${wsHealth || 'null'}`.trim());
        this.leftClient.forceReconnect();
      }
    } else {
      const sections = [];
      if (leftSummary) sections.push(leftSummary);
      if (bridgeSummary) sections.push(bridgeSummary);
      
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): ${sections.join(', ')} - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} ${emoji('📊')}${summaryText}`.trim());
    }
    
    // Post to monitoring channel on right client
    if (this.rightClient && await this.rightClient.getStatusChannelId() && this.config.logging.statsChannelUpdates !== 'none') {
      try {
        if (this.config.logging.statsChannelUpdates === 'logs') {
          // Combine summary and logs into a single message
          await this.postCombinedSummaryAndLogs(summaryText);
        } else {
          // Just post the summary
          await this.postEventSummaryToMonitoring(summaryText);
        }
      } catch (error) {
        console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to post event summary to monitoring:`.trim(), error);
      }
    }
    
    // Reset counters
    this.leftEvents.clear();
    this.bridgeEvents.clear();
    this.lastEventSummaryTime = now;
  }

  private generateEventSummary(events: Map<string, number>, prefix: string): string {
    if (events.size === 0) return '';
    
    const summary = Array.from(events.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([event, count]) => `${event}: ${count}`)
      .join(', ');
    
    return `${prefix}: ${summary}`;
  }

  private async postEventSummaryToMonitoring(summaryText: string): Promise<void> {
    const statusChannelId = await this.rightClient.getStatusChannelId();
    if (!statusChannelId) {
      console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}No status channel available for event summary`.trim());
      return;
    }
    
    // Use the new postOrUpdateBridgeSummary method to find and update existing message
    await this.rightClient.postOrUpdateBridgeSummary(statusChannelId, summaryText);
    console.log(`${this.LOG_PREFIX} ${emoji('📊')}Posted/updated bridge summary in monitoring channel`.trim());
  }
  
  private async postCombinedSummaryAndLogs(summaryText: string): Promise<void> {
    const statusChannelId = await this.rightClient.getStatusChannelId();
    if (!statusChannelId) {
      console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}No status channel available for combined summary and logs`.trim());
      return;
    }
    
    // Get most recent logs from buffer
    const logs = this.logBuffer.getLast(30); // Get last 30 lines, don't clear buffer
    
    // Format combined message
    const timestamp = new Date().toLocaleString('en-CA', { 
      hour12: false, 
      timeZone: this.config.logging.timezone 
    });
    
    let combinedMessage = `${emoji('📊')}**Bridge Activity Summary [${timestamp}]**: ${summaryText}`;
    
    // Add logs section if we have logs
    if (logs.length > 0) {
      combinedMessage += '\n\n### Recent Logs (Last 30 Lines)\n```\n';
      combinedMessage += logs.join('\n');
      combinedMessage += '\n```';
    }
    
    try {
      // Try to find our oldest message (any message by us) and update it
      const existingPost = await this.rightClient.findBridgeSummaryMessage(statusChannelId);
      
      if (existingPost) {
        // Update our existing message
        await this.rightClient.updateMessage(existingPost.id, combinedMessage);
        const logInfo = logs.length > 0 ? ` and last ${logs.length} log lines` : '';
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}Updated existing message with bridge summary${logInfo}`.trim());
      } else {
        // Post new message if we don't have any existing messages
        await this.rightClient.postMessage(statusChannelId, combinedMessage);
        const logInfo = logs.length > 0 ? ` and last ${logs.length} log lines` : '';
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}Posted new bridge summary${logInfo}`.trim());
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to post combined summary and logs:`.trim(), error);
    }
  }

  async stop(): Promise<void> {
    console.log(`${this.LOG_PREFIX} ${emoji('🛑')}Stopping bridge...`.trim());
    await this.stopEventSummaryTimer();
    this.heartbeatService.stop();
    await this.leftClient.disconnect();
    await this.rightClient.disconnect();
    
    // Clear profile picture cache
    this.profilePictureCache.clear();
    console.log(`${this.LOG_PREFIX} ${emoji('🗑️')}Cleared profile picture cache`.trim());
    
    // Stop log buffer
    this.logBuffer.stop();
  }

  private async performCatchUp(): Promise<void> {
    try {
      let totalMessagesProcessed = 0;
      
      for (const channelId of this.sourceChannelIds) {
        const channelInfo = this.sourceChannelInfos.get(channelId);
        const channelName = channelInfo?.name || channelId;
        
        console.log(`${this.LOG_PREFIX} ${emoji('🔍')}Checking for missed messages in (${channelName})[${channelId}]...`.trim());
        
        // Get last tracked message for this channel
        const lastTracked = this.messageTracker.getLastForwardedMessage(channelId);
        
        let sinceTimestamp: number;
        if (lastTracked) {
          // Add 1ms to avoid re-processing the last tracked message
          sinceTimestamp = lastTracked.lastForwardedTimestamp + 1;
          console.log(`${this.LOG_PREFIX} ${emoji('📅')}Last tracked message: ${lastTracked.lastForwardedMessageId} at ${new Date(sinceTimestamp - 1).toISOString()}`.trim());
        } else {
          // No previous tracking - only look back 24 hours to avoid overwhelming on first run
          sinceTimestamp = Date.now() - (24 * 60 * 60 * 1000);
          console.log(`${this.LOG_PREFIX} ${emoji('🆕')}No tracking history - scanning last 24 hours from ${new Date(sinceTimestamp).toISOString()}`.trim());
        }
        
        // Get missed messages
        const missedMessages = await this.leftClient.getMessagesSince(
          channelId,
          sinceTimestamp,
          this.config.catchUp.maxMessagesToRecover
        );
        
        if (missedMessages.length === 0) {
          console.log(`${this.LOG_PREFIX} ${emoji('✅')}No missed messages in (${channelName})[${channelId}]`.trim());
          continue;
        }
        
        console.log(`${this.LOG_PREFIX} ${emoji('📨')}Processing ${missedMessages.length} missed messages from (${channelName})[${channelId}]`.trim());
        
        // Process messages in chronological order
        for (const message of missedMessages) {
          try {
            // Use a slightly modified version of handleMessage that includes catch-up context
            console.log(`${this.LOG_PREFIX} ${emoji('🔄')}[CATCH-UP] Processing message ${message.id} from @${message.username}`.trim());
            await this.handleMessage(message, channelId);
            totalMessagesProcessed++;
            
            // Small delay between messages to avoid overwhelming the target server
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to process catch-up message ${message.id}:`.trim(), error);
            // Continue processing other messages even if one fails
          }
        }
        
        // Small delay between channels
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (totalMessagesProcessed > 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}Catch-up completed: processed ${totalMessagesProcessed} missed messages`.trim());
        // Track the catch-up event
        this.trackBridgeEvent('catch_up_completed');
      } else {
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}Catch-up completed: no missed messages found`.trim());
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Error during catch-up process:`.trim(), error);
      // Don't throw - let the bridge continue even if catch-up fails
    }
  }
}