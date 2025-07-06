import { MattermostClient } from './mattermost-client';
import { Config, MattermostMessage, ChannelInfo } from './types';
import { createMessageAttachment } from './message-attachment';
import { HeartbeatService } from './heartbeat-service';
import { PADDED_PREFIXES } from './logger-utils';

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

  constructor(private config: Config) {
    this.leftClient = new MattermostClient(config.left, config.logging, false);
    this.rightClient = new MattermostClient(config.right, config.logging, true);
    this.heartbeatService = new HeartbeatService(config.heartbeat);
  }

  async start(): Promise<void> {
    console.log(`${this.LOG_PREFIX} 🚀 Starting Mattermost Bridge...`);
    
    try {
      // Step 1: Ping both servers to check connectivity
      console.log(`${this.LOG_PREFIX} 🏓 Checking server connectivity...`);
      await this.leftClient.ping();
      await this.rightClient.ping();
      console.log(`${this.LOG_PREFIX} ✅ Both servers are reachable`);
      console.log('');

      // Step 2: Login to both instances
      console.log(`${this.LOG_PREFIX} 🔐 Authenticating with both servers...`);
      await this.leftClient.login();
      await this.rightClient.login();
      console.log(`${this.LOG_PREFIX} ✅ Successfully authenticated with both servers`);
      console.log('');

      // Step 3: Resolve channel information
      console.log(`${this.LOG_PREFIX} 📋 Resolving channel information...`);
      this.sourceChannelId = this.config.rule.sourceChannelId;
      this.targetChannelId = this.config.rule.targetChannelId;

      // Resolve source channel info
      console.log(`${this.LOG_PREFIX} 🔍 [${this.config.left.name}] Looking up channel: ${this.sourceChannelId}`);
      this.sourceChannelInfo = await this.leftClient.getChannelById(this.sourceChannelId);
      
      if (!this.sourceChannelInfo) {
        throw new Error(`Source channel '${this.sourceChannelId}' not found on ${this.config.left.name}`);
      }
      
      console.log(`${this.LOG_PREFIX} ✅ [${this.config.left.name}] Found channel: #${this.sourceChannelInfo.name} (${this.sourceChannelInfo.displayName})`);

      // Resolve target channel info
      console.log(`${this.LOG_PREFIX} 🔍 [${this.config.right.name}] Looking up channel: ${this.targetChannelId}`);
      this.targetChannelInfo = await this.rightClient.getChannelById(this.targetChannelId);
      
      if (!this.targetChannelInfo) {
        throw new Error(`Target channel '${this.targetChannelId}' not found on ${this.config.right.name}`);
      }
      
      console.log(`${this.LOG_PREFIX} ✅ [${this.config.right.name}] Found channel: #${this.targetChannelInfo.name} (${this.targetChannelInfo.displayName})`);
      console.log('');

      // Step 4: Display bridge configuration
      console.log(`${this.LOG_PREFIX} 📡 Bridge Configuration:`);
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

      console.log(`${this.LOG_PREFIX} ✅ Bridge is now active and listening for messages...`);
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX} 🏃‍♂️ DRY RUN MODE - Messages will be logged but NOT posted`);
      }
      console.log('');

      // Step 6: Start heartbeat monitoring (only after successful connection)
      this.heartbeatService.start();
      
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ❌ Failed to start bridge:`, error);
      throw error;
    }
  }

  private async handleMessage(message: MattermostMessage): Promise<void> {
    try {
      const sourceChannelName = this.sourceChannelInfo?.name || this.sourceChannelId;
      const targetChannelName = this.targetChannelInfo?.name || this.targetChannelId;
      
      console.log(`${this.LOG_PREFIX} 📨 [#${sourceChannelName}] ${message.nickname ? `${message.nickname} (@${message.username})` : message.username}: ${message.message}`);
      
      // Check if message has file attachments
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} 📎 Message has ${message.file_ids.length} file attachment(s)`);
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
          console.log(`${this.LOG_PREFIX} 🚫 Message from ${user.username} (${user.email}) excluded due to email domain filter`);
          // Track excluded message for status updates
          this.rightClient.trackBridgeEvent('message_excluded');
          return; // Skip this message
        }
      }
      
      // Get or upload profile picture
      let profilePictureUrl: string | undefined;
      const displayName = message.nickname ? `${message.nickname} (@${message.username})` : message.username;
      
      // Check cache first
      if (this.profilePictureCache.has(message.user_id)) {
        profilePictureUrl = this.profilePictureCache.get(message.user_id);
        console.log(`${this.LOG_PREFIX} 🖼️ Using cached profile picture for ${displayName}`);
      } else {
        // Download profile picture from source
        console.log(`${this.LOG_PREFIX} 📥 Downloading profile picture for ${displayName}...`);
        const imageBuffer = await this.leftClient.downloadProfilePicture(message.user_id);
        
        if (imageBuffer) {
          // Upload to target server
          console.log(`${this.LOG_PREFIX} 📤 Uploading profile picture for ${displayName}...`);
          const uploadedUrl = await this.rightClient.uploadProfilePicture(
            imageBuffer, 
            `${message.user_id}_profile.png`, 
            this.targetChannelId
          );
          
          if (uploadedUrl) {
            profilePictureUrl = uploadedUrl;
            // Cache the uploaded URL
            this.profilePictureCache.set(message.user_id, uploadedUrl);
            console.log(`${this.LOG_PREFIX} ✅ Profile picture uploaded and cached for ${displayName}`);
          } else {
            console.log(`${this.LOG_PREFIX} ⚠️ Failed to upload profile picture for ${displayName}`);
          }
        } else {
          console.log(`${this.LOG_PREFIX} ⚠️ Failed to download profile picture for ${displayName}`);
        }
      }
      
      // Handle file attachments
      let uploadedFileIds: string[] = [];
      if (message.file_ids && message.file_ids.length > 0) {
        console.log(`${this.LOG_PREFIX} 📎 Processing ${message.file_ids.length} file attachment(s)...`);
        
        const filesToUpload: { buffer: Buffer; filename: string }[] = [];
        
        for (const fileId of message.file_ids) {
          console.log(`${this.LOG_PREFIX} 📥 Downloading file: ${fileId}`);
          const fileData = await this.leftClient.downloadFile(fileId);
          
          if (fileData) {
            filesToUpload.push(fileData);
            console.log(`${this.LOG_PREFIX} ✅ Downloaded file: ${fileData.filename}`);
          } else {
            console.log(`${this.LOG_PREFIX} ❌ Failed to download file: ${fileId}`);
          }
        }
        
        if (filesToUpload.length > 0) {
          console.log(`${this.LOG_PREFIX} 📤 Uploading ${filesToUpload.length} file(s) to target server...`);
          uploadedFileIds = await this.rightClient.uploadMultipleFiles(filesToUpload, this.targetChannelId);
          console.log(`${this.LOG_PREFIX} ✅ Successfully uploaded ${uploadedFileIds.length} file(s)`);
        }
      }
      
      // Create minimal attachment with profile picture
      const attachment = createMessageAttachment(
        message, 
        this.config.left, 
        sourceChannelName,
        profilePictureUrl,
        this.config.footerIcon
      );
      
      if (this.config.dryRun) {
        console.log(`${this.LOG_PREFIX} 🏃‍♂️ [DRY RUN] Would post to #${targetChannelName} on ${this.config.right.name}:`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Author: ${attachment.author_name}`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Message: ${attachment.text}`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Footer: ${attachment.footer}`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Color: ${attachment.color} (baby blue)`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Profile Picture: ${attachment.author_icon || 'none'}`);
        console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] Footer Icon: ${attachment.footer_icon || 'none'}`);
        if (uploadedFileIds.length > 0) {
          console.log(`${this.LOG_PREFIX} 📝 [DRY RUN] File Attachments: ${uploadedFileIds.length} file(s)`);
        }
        console.log(`${this.LOG_PREFIX} 🏃‍♂️ [DRY RUN] Message NOT sent (dry-run mode)`);
        
        // Track dry run event for status updates
        this.rightClient.trackBridgeEvent('message_dry_run');
      } else {
        // Post message with attachment and files
        await this.rightClient.postMessageWithAttachment(
          this.targetChannelId, 
          '', // Empty main message text
          attachment,
          uploadedFileIds.length > 0 ? uploadedFileIds : undefined
        );
        
        const fileInfo = uploadedFileIds.length > 0 ? ` with ${uploadedFileIds.length} file(s)` : '';
        console.log(`${this.LOG_PREFIX} ✅ Message bridged to #${targetChannelName} on ${this.config.right.name}${fileInfo}`);
        
        // Track message bridging event on destination client for status updates
        this.rightClient.trackBridgeEvent('message_bridged');
      }
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ❌ Error bridging message:`, error);
    }
  }

  async stop(): Promise<void> {
    console.log(`${this.LOG_PREFIX} 🛑 Stopping bridge...`);
    this.heartbeatService.stop();
    await this.leftClient.disconnect();
    await this.rightClient.disconnect();
    
    // Clear profile picture cache
    this.profilePictureCache.clear();
    console.log(`${this.LOG_PREFIX} 🗑️ Cleared profile picture cache`);
  }
}