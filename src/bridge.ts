import { MattermostClient } from './mattermost-client';
import { Config, MattermostMessage, ChannelInfo } from './types';
import { createMessageAttachment } from './message-attachment';
import { HeartbeatService } from './heartbeat-service';
import { PADDED_PREFIXES, emoji } from './logger-utils';

export class MattermostBridge {
  private leftClient: MattermostClient;
  private rightClient: MattermostClient;
  private heartbeatService: HeartbeatService;
  private sourceChannelId: string = '';
  private targetChannelId: string = '';
  private sourceChannelInfo: ChannelInfo | null = null;
  private targetChannelInfo: ChannelInfo | null = null;
  private readonly LOG_PREFIX = PADDED_PREFIXES.BRIDGE;
  
  // Cache for uploaded profile pictures to avoid re-uploading
  private profilePictureCache: Map<string, string> = new Map();
  
  // Centralized event tracking
  private leftEvents: Map<string, number> = new Map();
  private bridgeEvents: Map<string, number> = new Map();
  private eventSummaryTimer: NodeJS.Timeout | null = null;
  private lastEventSummaryTime: Date = new Date();
  private eventSummaryCount: number = 0;

  constructor(private config: Config) {
    this.leftClient = new MattermostClient(config.left, config.logging, false, this.trackLeftEvent.bind(this));
    this.rightClient = new MattermostClient(config.right, config.logging, true);
    this.heartbeatService = new HeartbeatService(config.heartbeat);
  }

  async start(): Promise<void> {
    console.log(`${this.LOG_PREFIX} ${emoji('🚀')}Starting Mattermost Bridge...`.trim());
    
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
      this.sourceChannelId = this.config.rule.sourceChannelId;
      this.targetChannelId = this.config.rule.targetChannelId;

      // Resolve source channel info
      console.log(`${this.LOG_PREFIX} ${emoji('🔍')}[${this.config.left.name}] Looking up channel: ${this.sourceChannelId}`.trim());
      this.sourceChannelInfo = await this.leftClient.getChannelById(this.sourceChannelId);
      
      if (!this.sourceChannelInfo) {
        throw new Error(`Source channel '${this.sourceChannelId}' not found on ${this.config.left.name}`);
      }
      
      console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.left.name}] Found channel: #${this.sourceChannelInfo.name} (${this.sourceChannelInfo.displayName})`.trim());

      // Resolve target channel info
      console.log(`${this.LOG_PREFIX} ${emoji('🔍')}[${this.config.right.name}] Looking up channel: ${this.targetChannelId}`.trim());
      this.targetChannelInfo = await this.rightClient.getChannelById(this.targetChannelId);
      
      if (!this.targetChannelInfo) {
        throw new Error(`Target channel '${this.targetChannelId}' not found on ${this.config.right.name}`);
      }
      
      console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.right.name}] Found channel: #${this.targetChannelInfo.name} (${this.targetChannelInfo.displayName})`.trim());
      console.log('');

      // Step 4: Display bridge configuration
      console.log(`${this.LOG_PREFIX} ${emoji('📡')}Bridge Configuration:`.trim());
      console.log(`${this.LOG_PREFIX}    Source: #${this.sourceChannelInfo.name} (${this.sourceChannelId}) on ${this.config.left.name}`);
      console.log(`${this.LOG_PREFIX}    Target: #${this.targetChannelInfo.name} (${this.targetChannelId}) on ${this.config.right.name}`);
      console.log(`${this.LOG_PREFIX}    Format: Minimal attachments with profile pictures`);
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX}    Mode: DRY RUN (messages will NOT be posted)`);
      }
      if (this.config.dontForwardFor.length > 0) {
        console.log(`${this.LOG_PREFIX}    Email Filter: Excluding messages from ${this.config.dontForwardFor.join(', ')}`);
      }
      console.log('');

      // Step 5: Start listening for messages
      this.leftClient.connectWebSocket(
        this.sourceChannelId, 
        this.handleMessage.bind(this),
        this.sourceChannelInfo.name
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

  private async handleMessage(message: MattermostMessage): Promise<void> {
    try {
      const sourceChannelName = this.sourceChannelInfo?.name || this.sourceChannelId;
      const targetChannelName = this.targetChannelInfo?.name || this.targetChannelId;
      
      console.log(`${this.LOG_PREFIX} ${emoji('📨')}[#${sourceChannelName}] ${message.nickname ? `${message.nickname} (@${message.username})` : message.username}: ${message.message}`.trim());
      
      // Check if message has file attachments
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('📎')}Message has ${message.file_ids.length} file attachment(s)`.trim());
      }
      
      // Get user details to check email domain
      const user = await this.leftClient.getUser(message.user_id);
      
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
          console.log(`${this.LOG_PREFIX} ${emoji('🚫')}Message from ${user.username} (${user.email}) excluded due to email domain filter`.trim());
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
        console.log(`${this.LOG_PREFIX} ${emoji('🖼️')}Using cached profile picture for ${displayName}`.trim());
      } else {
        // Download profile picture from source
        console.log(`${this.LOG_PREFIX} ${emoji('📥')}Downloading profile picture for ${displayName}...`.trim());
        const imageBuffer = await this.leftClient.downloadProfilePicture(message.user_id);
        
        if (imageBuffer) {
          // Upload to target server
          console.log(`${this.LOG_PREFIX} ${emoji('📤')}Uploading profile picture for ${displayName}...`.trim());
          const uploadedUrl = await this.rightClient.uploadProfilePicture(
            imageBuffer, 
            `${message.user_id}_profile.png`, 
            this.targetChannelId
          );
          
          if (uploadedUrl) {
            profilePictureUrl = uploadedUrl;
            // Cache the uploaded URL
            this.profilePictureCache.set(message.user_id, uploadedUrl);
            console.log(`${this.LOG_PREFIX} ${emoji('✅')}Profile picture uploaded and cached for ${displayName}`.trim());
          } else {
            console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}Failed to upload profile picture for ${displayName}`.trim());
          }
        } else {
          console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}Failed to download profile picture for ${displayName}`.trim());
        }
      }
      
      // Handle file attachments
      let uploadedFileIds: string[] = [];
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('📎')}Processing ${message.file_ids.length} file attachment(s)...`.trim());
        
        const filesToUpload: { buffer: Buffer; filename: string }[] = [];
        
        for (const fileId of message.file_ids) {
          console.log(`${this.LOG_PREFIX} ${emoji('📥')}Downloading file: ${fileId}`.trim());
          const fileData = await this.leftClient.downloadFile(fileId);
          
          if (fileData) {
            filesToUpload.push(fileData);
            console.log(`${this.LOG_PREFIX} ${emoji('✅')}Downloaded file: ${fileData.filename}`.trim());
          } else {
            console.log(`${this.LOG_PREFIX} ${emoji('❌')}Failed to download file: ${fileId}`.trim());
          }
        }
        
        if (filesToUpload.length > 0) {
          console.log(`${this.LOG_PREFIX} ${emoji('📤')}Uploading ${filesToUpload.length} file(s) to target server...`.trim());
          uploadedFileIds = await this.rightClient.uploadMultipleFiles(filesToUpload, this.targetChannelId);
          console.log(`${this.LOG_PREFIX} ${emoji('✅')}Successfully uploaded ${uploadedFileIds.length} file(s)`.trim());
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
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}[DRY RUN] Would post to #${targetChannelName} on ${this.config.right.name}:`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Author: ${attachment.author_name}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Message: ${attachment.text}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Footer: ${attachment.footer}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Color: ${attachment.color} (baby blue)`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Profile Picture: ${attachment.author_icon || 'none'}`.trim());
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] Footer Icon: ${attachment.footer_icon || 'none'}`.trim());
        if (uploadedFileIds.length > 0) {
          console.log(`${this.LOG_PREFIX} ${emoji('📝')}[DRY RUN] File Attachments: ${uploadedFileIds.length} file(s)`.trim());
        }
        console.log(`${this.LOG_PREFIX} ${emoji('🏃‍♂️')}[DRY RUN] Message NOT sent (dry-run mode)`.trim());
        
        // Track dry run event for status updates
        this.trackBridgeEvent('message_dry_run');
      } else {
        // Post message with attachment and files
        await this.rightClient.postMessageWithAttachment(
          this.targetChannelId, 
          '', // Empty main message text
          attachment,
          uploadedFileIds.length > 0 ? uploadedFileIds : undefined
        );
        
        const fileInfo = uploadedFileIds.length > 0 ? ` with ${uploadedFileIds.length} file(s)` : '';
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}Message bridged to #${targetChannelName} on ${this.config.right.name}${fileInfo}`.trim());
        
        // Add emoji reaction to original message if configured
        if (this.config.leftMessageEmoji) {
          await this.leftClient.addReaction(message.id, this.config.leftMessageEmoji);
        }
        
        // Track message bridging event on destination client for status updates
        this.trackBridgeEvent('message_bridged');
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Error bridging message:`.trim(), error);
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
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): No events - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} ${emoji('📊')}${summaryText}`.trim());
    } else {
      const sections = [];
      if (leftSummary) sections.push(leftSummary);
      if (bridgeSummary) sections.push(bridgeSummary);
      
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): ${sections.join(', ')} - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} ${emoji('📊')}${summaryText}`.trim());
    }
    
    // Post to monitoring channel on right client
    if (this.rightClient && await this.rightClient.getStatusChannelId()) {
      try {
        await this.postEventSummaryToMonitoring(summaryText);
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

  async stop(): Promise<void> {
    console.log(`${this.LOG_PREFIX} ${emoji('🛑')}Stopping bridge...`.trim());
    await this.stopEventSummaryTimer();
    this.heartbeatService.stop();
    await this.leftClient.disconnect();
    await this.rightClient.disconnect();
    
    // Clear profile picture cache
    this.profilePictureCache.clear();
    console.log(`${this.LOG_PREFIX} ${emoji('🗑️')}Cleared profile picture cache`.trim());
  }
}