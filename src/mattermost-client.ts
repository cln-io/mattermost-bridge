import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import http from 'http';
import https from 'https';
import { authenticator } from 'otplib';
import { MattermostConfig, MattermostMessage, Channel, ChannelInfo, User, LoggingConfig, MessageAttachment } from './types';
import FormData from 'form-data';
import { emoji } from './logger-utils';
import { LogBuffer } from './log-buffer';

export class MattermostClient {
  private api: AxiosInstance;
  private token: string = '';
  private ws: WebSocket | null = null;
  private userId: string = '';
  private statusChannelId: string = '';
  private readonly LOG_PREFIX = '[mattermost-client]';
  private monitoredChannels: Set<string> = new Set();
  private messageHandler: ((msg: MattermostMessage) => Promise<void>) | null = null;
  private messageEditHandler: ((msg: MattermostMessage) => Promise<void>) | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private lastPongTime: number = 0;
  private lastMessageTime: number = 0;
  private reconnectAttempts: number = 0;
  // 0 means unlimited (browser-like behaviour)
  private maxReconnectAttempts: number = 0;
  private wsSequence: number = 1;
  private lastStatusCheck: number = 0;
  private lastAuthCheck: number = 0;
  private sessionCheckInProgress: boolean = false;
  private processingMessages: Set<string> = new Set();
  private wsConnectionId: string = '';
  private wsConnectionCount: number = 0;
  // Manage reconnection and intentional closes to avoid loops
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionallyClosing: boolean = false;
  
  // Cache for channel information to avoid repeated API calls
  private channelCache: Map<string, ChannelInfo> = new Map();
  
  constructor(private config: MattermostConfig, private loggingConfig: LoggingConfig, private isDestination: boolean = false, private eventCallback?: (eventType: string) => void, private logBuffer?: LogBuffer) {
    // Normalize server URL to prevent double slashes
    const normalizedServer = this.normalizeServerUrl(config.server);
    
    this.api = axios.create({
      baseURL: `${normalizedServer}/api/v4`,
      timeout: 10000
    });
    
    console.log(`${this.LOG_PREFIX} ${emoji('🔧')}[${config.name}] Normalized server URL: ${normalizedServer}`.trim());
    
    // Only log debugging info if debug mode is enabled
    if (this.loggingConfig.debugWebSocketEvents) {
      console.log(`${this.LOG_PREFIX} ${emoji('🔧')}[${config.name}] Debug WebSocket events enabled`.trim());
    }
  }

  private normalizeServerUrl(serverUrl: string): string {
    // Remove trailing slashes and normalize the URL
    const normalized = serverUrl.replace(/\/+$/, '');
    
    // Ensure it starts with http:// or https://
    if (!normalized.match(/^https?:\/\//)) {
      throw new Error(`Invalid server URL format: ${serverUrl}. Must start with http:// or https://`);
    }
    
    return normalized;
  }

  private generateTOTP(): string | null {
    if (!this.config.mfaSeed) {
      return null;
    }
    
    try {
      const token = authenticator.generate(this.config.mfaSeed);
      return token;
    } catch (error) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Failed to generate TOTP:`.trim(), error);
      throw new Error('Failed to generate TOTP code');
    }
  }



  async ping(): Promise<void> {
    try {
      const normalizedServer = this.normalizeServerUrl(this.config.server);
      console.log(`${this.LOG_PREFIX} ${emoji('🏓')}Pinging ${this.config.name} (${normalizedServer})...`.trim());
      
      const startTime = Date.now();
      const response = await this.api.get('/system/ping');
      const duration = Date.now() - startTime;
      
      if (response.status === 200) {
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}${this.config.name} is reachable (${duration}ms)`.trim());
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to ping ${this.config.name}:`.trim(), error.response?.data || error.message);
      throw new Error(`Cannot reach ${this.config.name} at ${this.config.server}`);
    }
  }

  async login(): Promise<void> {
    try {
      const normalizedServer = this.normalizeServerUrl(this.config.server);
      console.log(`${this.LOG_PREFIX} Logging into ${this.config.name} (${normalizedServer})...`);

      // Check if bot token is provided
      if (this.config.botToken) {
        console.log(`${this.LOG_PREFIX} ${emoji('🤖')}[${this.config.name}] Using bot token authentication`.trim());

        // Bot authentication - set the token directly
        this.token = this.config.botToken;
        this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

        // Get bot user info
        const response = await this.api.get('/users/me');
        this.userId = response.data.id;

        console.log(`${this.LOG_PREFIX} ${emoji('✅')}Successfully authenticated to ${this.config.name} as bot: ${response.data.username}`.trim());

        // Bot accounts don't have status channel updates
        if (this.loggingConfig.statsChannelUpdates !== 'none' && this.isDestination) {
          console.log(`${this.LOG_PREFIX} ${emoji('🤖')}[${this.config.name}] Bot account detected - status channel updates disabled`.trim());
        }

        return;
      }

      // Regular username/password authentication with TOTP retry logic
      let loginAttempt = 0;
      const maxAttempts = 2;
      let lastError: any = null;
      let loginResponse: any = null;

      while (loginAttempt < maxAttempts) {
        loginAttempt++;

        try {
          // Prepare login payload
          const loginPayload: any = {
            login_id: this.config.username,
            password: this.config.password
          };

          // Generate and include TOTP if MFA seed is provided
          if (this.config.mfaSeed) {
            const totpCode = this.generateTOTP();
            if (totpCode) {
              loginPayload.token = totpCode;
              console.log(`${this.LOG_PREFIX} ${emoji('🔐')}[${this.config.name}] TOTP Code: ${totpCode}`.trim());
              console.log(`${this.LOG_PREFIX} ${emoji('🕐')}[${this.config.name}] Time remaining: ${30 - (Math.floor(Date.now() / 1000) % 30)}s`.trim());
              console.log(`${this.LOG_PREFIX} ${emoji('📤')}[${this.config.name}] Including MFA token in login request`.trim());
            } else {
              console.log(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Failed to generate TOTP code`.trim());
              throw new Error(`Failed to generate TOTP code for ${this.config.name}`);
            }
          } else {
            console.log(`${this.LOG_PREFIX} ${emoji('ℹ️')}[${this.config.name}] No MFA seed configured`.trim());
          }

          loginResponse = await this.api.post('/users/login', loginPayload);

          this.token = loginResponse.headers.token;
          this.userId = loginResponse.data.id;

          // Set auth header for future requests
          this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

          console.log(`${this.LOG_PREFIX} ${emoji('✅')}Successfully logged in to ${this.config.name} as ${loginResponse.data.username}`.trim());

          // Success - break out of retry loop
          break;
        } catch (error: any) {
          lastError = error;

          // Check if this is an invalid MFA token error (401)
          const is401 = error.response?.status === 401;
          const isInvalidMFA = is401 && error.response?.data?.message?.toLowerCase().includes('mfa');

          if (isInvalidMFA && loginAttempt < maxAttempts && this.config.mfaSeed) {
            // First attempt failed - wait for TOTP to refresh
            const timeRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
            const waitTime = timeRemaining + 1; // Wait for next TOTP code + 1 second buffer

            console.warn(`${this.LOG_PREFIX} ${emoji('⏱️')}[${this.config.name}] Invalid MFA token (attempt ${loginAttempt}/${maxAttempts}). Waiting ${waitTime}s for next TOTP code...`.trim());

            // Wait for the TOTP code to refresh
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

            console.log(`${this.LOG_PREFIX} ${emoji('🔄')}[${this.config.name}] Retrying login with fresh TOTP code...`.trim());
          } else {
            // Not a TOTP issue, or we've exhausted retries - throw the error
            throw error;
          }
        }
      }

      // If we exhausted all attempts, throw the last error with full details
      if (loginAttempt >= maxAttempts && lastError) {
        throw lastError;
      }

      // Set up status channel for status updates if enabled and user is not a bot (only for destination)
      if (this.loggingConfig.statsChannelUpdates !== 'none' && this.isDestination && loginResponse) {
        if (loginResponse.data.is_bot) {
          console.log(`${this.LOG_PREFIX} ${emoji('🤖')}[${this.config.name}] Bot account detected - status channel updates disabled`.trim());
        } else {
          try {
            const statusChannel = await this.findOrCreateStatusChannel();
            if (statusChannel) {
              this.statusChannelId = statusChannel.id;
              console.log(`${this.LOG_PREFIX} ${emoji('📬')}[${this.config.name}] Status channel updates enabled: (status)[${this.statusChannelId}]`.trim());
              
              // Post or update initial status message
              try {
                await this.postOrUpdateStatusMessage(this.statusChannelId, `${emoji('☑️')}All good - awaiting status updates`.trim());
              } catch (error) {
                console.warn(`${this.LOG_PREFIX} ${emoji('⚠️')}[${this.config.name}] Failed to post initial status message:`.trim(), error);
              }
            } else {
              console.warn(`${this.LOG_PREFIX} ${emoji('⚠️')}[${this.config.name}] Could not find or create status channel - status updates disabled`.trim());
            }
          } catch (error) {
            console.warn(`${this.LOG_PREFIX} ${emoji('⚠️')}[${this.config.name}] Failed to set up status channel:`.trim(), error);
          }
        }
      } else {
        console.log(`${this.LOG_PREFIX} ${emoji('ℹ️')}[${this.config.name}] Status channel updates disabled (STATS_CHANNEL_UPDATES=none)`.trim());
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Login failed for ${this.config.name}:`.trim(), error.response?.data || error.message);
      if (this.config.mfaSeed && error.response?.status === 401) {
        console.error(`${this.LOG_PREFIX} ${emoji('💡')}[${this.config.name}] Hint: Check if MFA seed is correct and TOTP code is valid`.trim());
      }
      throw error;
    }
  }

  async getChannelById(channelId: string): Promise<ChannelInfo | null> {
    // Check cache first
    if (this.channelCache.has(channelId)) {
      return this.channelCache.get(channelId)!;
    }

    try {
      const response = await this.api.get(`/channels/${channelId}`);
      const channel = response.data;
      
      const channelInfo: ChannelInfo = {
        id: channel.id,
        name: channel.name,
        displayName: channel.display_name || channel.name,
        type: channel.type
      };

      // Cache the result
      this.channelCache.set(channelId, channelInfo);
      
      return channelInfo;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Channel ID not found: (unknown)[${channelId}]`.trim());
        // Cache null result to avoid repeated API calls
        this.channelCache.set(channelId, null as any);
        return null;
      }
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Error getting channel (unknown)[${channelId}]:`.trim(), error.response?.data || error.message);
      throw error;
    }
  }

  async getChannelByName(channelName: string): Promise<Channel | null> {
    try {
      // First get teams
      const teamsResponse = await this.api.get('/users/me/teams');
      const teams = teamsResponse.data;
      
      if (teams.length === 0) {
        throw new Error('No teams found');
      }

      // Search for channel in the first team (you might want to make this configurable)
      const teamId = teams[0].id;
      const channelsResponse = await this.api.get(`/teams/${teamId}/channels/name/${channelName}`);
      
      return channelsResponse.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`${this.LOG_PREFIX} Channel '${channelName}' not found`);
        return null;
      }
      console.error(`${this.LOG_PREFIX} Error getting channel ${channelName}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async updateChannelHeader(channelId: string, header: string): Promise<void> {
    try {
      await this.api.patch(`/channels/${channelId}`, {
        header: header
      });
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error updating channel header:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getCurrentUser(): Promise<User> {
    try {
      const response = await this.api.get('/users/me');
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting current user:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getDirectMessageChannel(userId: string): Promise<Channel | null> {
    try {
      // Get direct message channel with the specified user
      const response = await this.api.post('/channels/direct', [this.userId, userId]);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting direct message channel:`, error.response?.data || error.message);
      return null;
    }
  }

  async createPrivateChannel(name: string, displayName: string): Promise<Channel | null> {
    try {
      // First get teams to find the team ID
      const teamsResponse = await this.api.get('/users/me/teams');
      const teams = teamsResponse.data;
      
      if (teams.length === 0) {
        throw new Error('No teams found');
      }
      
      // Use the first team (you might want to make this configurable)
      const teamId = teams[0].id;
      
      const response = await this.api.post('/channels', {
        team_id: teamId,
        name: name,
        display_name: displayName,
        type: 'P', // P = Private channel
        purpose: 'Mattermost bridge status updates'
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error creating private channel:`, error.response?.data || error.message);
      return null;
    }
  }

  async findOrCreateStatusChannel(): Promise<Channel | null> {
    try {
      // First try to find existing channel
      const existingChannel = await this.getChannelByName('mattermost-bridge-status');
      if (existingChannel) {
        console.log(`${this.LOG_PREFIX} ${emoji('📋')}[${this.config.name}] Found existing status channel: (${existingChannel.name})[${existingChannel.id}]`.trim());
        return existingChannel;
      }
      
      // Channel doesn't exist, create it
      console.log(`${this.LOG_PREFIX} ${emoji('📋')}[${this.config.name}] Creating new status channel...`.trim());
      const newChannel = await this.createPrivateChannel('mattermost-bridge-status', 'mattermost-bridge-status');
      
      if (newChannel) {
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.name}] Created status channel: (${newChannel.name})[${newChannel.id}]`.trim());
      }
      
      return newChannel;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error finding or creating status channel:`, error.response?.data || error.message);
      return null;
    }
  }

  async postMessage(channelId: string, message: string): Promise<any> {
    try {
      const response = await this.api.post('/posts', {
        channel_id: channelId,
        message: message
      });
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting message:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getPost(postId: string): Promise<any> {
    try {
      const response = await this.api.get(`/posts/${postId}`);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting post:`, error.response?.data || error.message);
      return null;
    }
  }

  async updateMessage(postId: string, message: string, props?: any): Promise<void> {
    try {
      const updateData: any = {
        id: postId,
        message: message
      };
      
      if (props) {
        updateData.props = props;
      }
      
      await this.api.put(`/posts/${postId}`, updateData);
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error updating message:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getChannelPosts(channelId: string, page: number = 0, perPage: number = 60): Promise<any> {
    try {
      const response = await this.api.get(`/channels/${channelId}/posts?page=${page}&per_page=${perPage}`);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting channel posts:`, error.response?.data || error.message);
      throw error;
    }
  }

  async findStatusMessage(channelId: string): Promise<any | null> {
    try {
      const posts = await this.getChannelPosts(channelId);
      
      // Look for posts by the current user that contain "mattermost-bridge-status"
      for (const postId of posts.order) {
        const post = posts.posts[postId];
        if (post.user_id === this.userId && post.message.includes('mattermost-bridge-status')) {
          return post;
        }
      }
      
      return null;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error finding status message:`, error.response?.data || error.message);
      return null;
    }
  }

  async postOrUpdateStatusMessage(channelId: string, statusText: string): Promise<void> {
    try {
      const timestamp = new Date().toLocaleString('en-CA', { 
        hour12: false, 
        timeZone: this.loggingConfig.timezone 
      });
      const fullMessage = `${emoji('☑️')}**mattermost-bridge-status [${timestamp}]**: ${statusText}`.trim();
      
      // Try to find our oldest message (any message by us) - same logic as bridge summaries
      const existingPost = await this.findBridgeSummaryMessage(channelId);
      
      if (existingPost) {
        // Update our existing message (could be "beep", "boop", or previous status)
        await this.updateMessage(existingPost.id, fullMessage);
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[${this.config.name}] Updated our oldest message with status: "${statusText}"`.trim());
      } else {
        // Post new message
        await this.postMessage(channelId, fullMessage);
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.name}] Posted new status message: "${statusText}"`.trim());
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting or updating status message:`, error.response?.data || error.message);
      throw error;
    }
  }

  async postOrUpdateBridgeSummary(channelId: string, summaryText: string): Promise<void> {
    try {
      const timestamp = new Date().toLocaleString('en-CA', { 
        hour12: false, 
        timeZone: this.loggingConfig.timezone 
      });
      const fullMessage = `${emoji('📊')}**Bridge Activity Summary [${timestamp}]**: ${summaryText}`.trim();
      
      // Try to find our oldest message (any message by us)
      const existingPost = await this.findBridgeSummaryMessage(channelId);
      
      if (existingPost) {
        // Update our existing message (could be "beep", "boop", or previous summary)
        await this.updateMessage(existingPost.id, fullMessage);
        console.log(`${this.LOG_PREFIX} ${emoji('📝')}[${this.config.name}] Updated our oldest message with bridge summary: "${summaryText}"`.trim());
      } else {
        // Post new message
        await this.postMessage(channelId, fullMessage);
        console.log(`${this.LOG_PREFIX} ${emoji('✅')}[${this.config.name}] Posted new bridge summary: "${summaryText}"`.trim());
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting or updating bridge summary:`, error.response?.data || error.message);
      throw error;
    }
  }

  async findBridgeSummaryMessage(channelId: string): Promise<any | null> {
    try {
      const posts = await this.getChannelPosts(channelId);
      
      // Look for the oldest post by the current user (ourselves)
      // We'll update ANY message we posted, not just specific content
      // posts.order is from newest to oldest, so we need to iterate backwards
      // Skip system messages (they cannot be edited)
      for (let i = posts.order.length - 1; i >= 0; i--) {
        const postId = posts.order[i];
        const post = posts.posts[postId];
        
        // Only consider posts by ourselves that are NOT system messages
        if (post.user_id === this.userId && post.type === '') {
          return post; // Return the oldest regular post by ourselves
        }
      }
      
      return null;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error finding our oldest message:`, error.response?.data || error.message);
      return null;
    }
  }


  async postMessageWithAttachment(channelId: string, message: string, attachment: MessageAttachment, fileIds?: string[]): Promise<any> {
    try {
      const postData: any = {
        channel_id: channelId,
        message: message,
        props: {
          attachments: [attachment]
        }
      };

      // Add file IDs if provided
      if (fileIds && fileIds.length > 0) {
        postData.file_ids = fileIds;
      }

      const response = await this.api.post('/posts', postData);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting message with attachment:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getUser(userId: string): Promise<User> {
    try {
      const response = await this.api.get(`/users/${userId}`);
      const user = response.data;
      
      return user;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting user (unknown)[${userId}]:`, error.response?.data || error.message);
      throw error;
    }
  }

  getUserProfilePictureUrl(userId: string): string {
    const normalizedServer = this.normalizeServerUrl(this.config.server);
    return `${normalizedServer}/api/v4/users/${userId}/image`;
  }

  async downloadProfilePicture(userId: string): Promise<Buffer | null> {
    try {
      const response = await this.api.get(`/users/${userId}/image`, {
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Failed to download profile picture for user (unknown)[${userId}]:`.trim(), error.response?.status || error.message);
      return null;
    }
  }

  async uploadFile(fileBuffer: Buffer, filename: string, channelId: string): Promise<string | null> {
    try {
      const form = new FormData();
      form.append('files', fileBuffer, filename);
      form.append('channel_id', channelId);

      const response = await this.api.post('/files', form, {
        headers: {
          ...form.getHeaders(),
        }
      });

      if (response.data.file_infos && response.data.file_infos.length > 0) {
        const fileInfo = response.data.file_infos[0];
        return fileInfo.id; // Return file ID instead of URL
      }
      return null;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to upload file:`, error.response?.data || error.message);
      return null;
    }
  }

  async getFileInfo(fileId: string): Promise<any> {
    try {
      const response = await this.api.get(`/files/${fileId}/info`);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to get file info for ${fileId}:`, error.response?.data || error.message);
      return null;
    }
  }

  async downloadFile(fileId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    try {
      // First get file info to get the filename
      const fileInfo = await this.getFileInfo(fileId);
      if (!fileInfo) {
        return null;
      }

      // Then download the file
      const response = await this.api.get(`/files/${fileId}`, {
        responseType: 'arraybuffer'
      });

      return {
        buffer: Buffer.from(response.data),
        filename: fileInfo.name
      };
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to download file ${fileId}:`, error.response?.data || error.message);
      return null;
    }
  }

  async uploadMultipleFiles(files: { buffer: Buffer; filename: string }[], channelId: string): Promise<string[]> {
    const uploadedFileIds: string[] = [];
    
    for (const file of files) {
      const fileId = await this.uploadFile(file.buffer, file.filename, channelId);
      if (fileId) {
        uploadedFileIds.push(fileId);
      }
    }
    
    return uploadedFileIds;
  }

  async uploadProfilePicture(fileBuffer: Buffer, filename: string, channelId: string): Promise<string | null> {
    try {
      const form = new FormData();
      form.append('files', fileBuffer, filename);
      form.append('channel_id', channelId);

      const response = await this.api.post('/files', form, {
        headers: {
          ...form.getHeaders(),
        }
      });

      if (response.data.file_infos && response.data.file_infos.length > 0) {
        const fileInfo = response.data.file_infos[0];
        const normalizedServer = this.normalizeServerUrl(this.config.server);
        return `${normalizedServer}/api/v4/files/${fileInfo.id}`;
      }
      return null;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to upload profile picture:`, error.response?.data || error.message);
      return null;
    }
  }

  connectWebSocket(channelIds: string | string[], onMessage: (msg: MattermostMessage) => Promise<void>): void {
    // Store the channels we're monitoring
    const channelsArray = Array.isArray(channelIds) ? channelIds : [channelIds];
    this.monitoredChannels = new Set(channelsArray);
    this.messageHandler = onMessage;
    
    // IMPORTANT: Only one WebSocket connection should exist
    if (this.ws) {
      const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      const currentState = states[this.ws.readyState] || `UNKNOWN(${this.ws.readyState})`;
      
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        console.log(`${this.LOG_PREFIX} ✅ [${this.config.name}] WebSocket already ${currentState}, not creating duplicate connection`);
        return;
      }
      
      // Only create new connection if old one is truly dead
      console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Old WebSocket is ${currentState}, cleaning up before new connection`);
      this.ws.removeAllListeners();
      this.ws = null;
    }
    // Use normalized server URL for WebSocket connection
    const normalizedServer = this.normalizeServerUrl(this.config.server);
    const wsUrl = normalizedServer.replace('http', 'ws') + '/api/v4/websocket';
    
    console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] Connecting WebSocket to monitor ${channelsArray.length} channel(s)`);
    
    if (this.loggingConfig.debugWebSocketEvents) {
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] WebSocket URL: ${wsUrl}`);
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] Monitoring channels: ${channelsArray.join(', ')}`);
    }
    
    // Generate unique connection ID for debugging
    this.wsConnectionCount++;
    this.wsConnectionId = `${Date.now()}-${this.wsConnectionCount}`;
    
    console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] Creating WebSocket connection #${this.wsConnectionCount} (ID: ${this.wsConnectionId})`);
    
    // Build browser-like headers to satisfy strict proxies/WAFs
    const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const headers: Record<string, string> = {
      Origin: this.normalizeServerUrl(this.config.server),
      'User-Agent': browserUA
    };

    // Enable TCP keep-alive like browsers do via the underlying Agent
    const isSecure = wsUrl.startsWith('wss://');
    const agent = isSecure
      ? new https.Agent({ keepAlive: true })
      : new http.Agent({ keepAlive: true });

    this.ws = new WebSocket(wsUrl, undefined, {
      headers,
      agent,
      // Keep close to browser defaults while staying conservative
      handshakeTimeout: 15000,
      // Some proxies mis-handle compression. Disable by default for stability.
      perMessageDeflate: false
    });

    // Capture this connection's ID to detect stale events from prior sockets
    const connectionIdForHandlers = this.wsConnectionId;

    this.ws.on('open', () => {
      // Ignore opens from stale sockets (shouldn't normally happen but safe-guard anyway)
      if (connectionIdForHandlers !== this.wsConnectionId) {
        if (this.loggingConfig.debugWebSocketEvents) {
          console.log(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Ignoring OPEN from stale socket (ID: ${connectionIdForHandlers})`);
        }
        return;
      }
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] WebSocket OPENED (Connection ID: ${this.wsConnectionId})`);

      // Try to enable OS-level TCP keepalive on the raw socket if available
      try {
        const sock: any = (this.ws as any)?._socket;
        if (sock && typeof sock.setKeepAlive === 'function') {
          sock.setKeepAlive(true, 30000);
        }
      } catch { /* noop */ }
      
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.lastMessageTime = Date.now();
      
      // Cancel any pending reconnect from previous close
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Authenticate WebSocket
      this.wsSequence = 1;
      this.sendWebSocketMessage('authentication_challenge', {
        token: this.token
      });
      
      this.startHeartbeat();
    });

    // Log HTTP upgrade failures to aid diagnosis when a proxy drops us
    this.ws.on('unexpected-response', (_req: any, res: any) => {
      try {
        console.error(
          `${this.LOG_PREFIX} ❌ [${this.config.name}] WebSocket unexpected-response: ` +
          `status=${res?.statusCode}, headers=${JSON.stringify(res?.headers || {})}`
        );
      } catch { /* noop */ }
    });

    this.ws.on('pong', () => {
      if (connectionIdForHandlers !== this.wsConnectionId) return; // stale
      this.lastPongTime = Date.now();
      if (this.loggingConfig.debugWebSocketEvents) {
        console.log(`${this.LOG_PREFIX} 🏓 [${this.config.name}] Pong received`);
      }
    });

    this.ws.on('message', async (data: WebSocket.Data) => {
      if (connectionIdForHandlers !== this.wsConnectionId) return; // stale
      try {
        const event = JSON.parse(data.toString());
        const eventType = event.event as string;
        
        // Update last message time for any received message
        this.lastMessageTime = Date.now();

        // Report event to bridge if callback is provided and this is the left client
        if (eventType && this.eventCallback && !this.isDestination) {
          this.eventCallback(eventType);
        }

        // Log raw event JSON when debug mode is enabled
        if (this.loggingConfig.debugWebSocketEvents && eventType) {
          console.log(
            `${this.LOG_PREFIX} 🔍 [${this.config.name}] Raw WebSocket event:`,
            JSON.stringify(event, null, 2)
          );
        }


        // Always log 'posted' (new message) and 'hello' events
        if (eventType === 'posted') {
          const post = JSON.parse(event.data.post);
          
          // Log detailed info about received message
          const receivedAt = Date.now();
          console.log(
            `${this.LOG_PREFIX} 📥 [${this.config.name}] ` +
            `Received 'posted' event - Message ID: ${post.id}, ` +
            `Connection: ${this.wsConnectionId}, ` +
            `Time: ${receivedAt}`
          );
          
          // Check if we're already processing this message (prevents concurrent duplicates)
          if (this.processingMessages.has(post.id)) {
            console.log(
              `${this.LOG_PREFIX} 🚫 [${this.config.name}] ` +
              `DUPLICATE DETECTED! Message ${post.id} already being processed. ` +
              `Connection: ${this.wsConnectionId}`
            );
            return;
          }
          
          // Mark as processing to prevent concurrent handling
          this.processingMessages.add(post.id);
          
          // Check if this channel is being monitored
          if (!this.monitoredChannels.has(post.channel_id)) {
            if (this.loggingConfig.debugWebSocketEvents) {
              console.log(
                `${this.LOG_PREFIX} 🚫 [${this.config.name}] ` +
                `Ignoring message from unmonitored channel: ${post.channel_id}`
              );
            }
            return; // Skip this message
          }
          
          const user = await this.getUser(post.user_id);
          
          // Set context for LogBuffer if available
          if (this.logBuffer) {
            const channelInfo = await this.getChannelById(post.channel_id);
            const channelName = channelInfo?.name || post.channel_id;
            this.logBuffer.setChannelContext('websocket', `${channelName}[${post.channel_id}]`);
            this.logBuffer.setUserContext('websocket', `${user.username}[${post.user_id}]`);
          }
          
          const message: MattermostMessage = {
            id:         post.id,
            channel_id: post.channel_id,
            user_id:    post.user_id,
            message:    post.message,
            username:   user.username,
            nickname:   user.nickname || undefined,
            create_at:  post.create_at,
            file_ids:   post.file_ids || []
          };

          if (this.loggingConfig.debugWebSocketEvents) {
            console.log(
              `${this.LOG_PREFIX} ✉️ [${this.config.name}] ` +
              `Message ${message.id} from (${user.username})[${post.user_id}] received in channel (${post.channel_id})`
            );
          }

          if (this.messageHandler) {
            await this.messageHandler(message);
          }
          
          // Remove from processing set after handler completes
          this.processingMessages.delete(post.id);
          
          // Clear WebSocket context after processing
          if (this.logBuffer) {
            this.logBuffer.clearChannelContext('websocket');
            this.logBuffer.clearUserContext('websocket');
          }

        } else if (eventType === 'hello') {
          this.lastMessageTime = Date.now();
          console.log(
            `${this.LOG_PREFIX} 👋 [${this.config.name}] Received hello event`
          );
        } else if (eventType === 'status_change' || eventType === 'statuses') {
          // Response to get_statuses - indicates connection is healthy
          this.lastMessageTime = Date.now();
          if (this.loggingConfig.debugWebSocketEvents) {
            console.log(
              `${this.LOG_PREFIX} ✅ [${this.config.name}] Status response received - connection healthy`
            );
          }

        } else if (eventType === 'post_edited') {
          const post = JSON.parse(event.data.post);
          
          // Check for concurrent duplicate edits
          const editKey = `edit_${post.id}_${post.edit_at}`;
          if (this.processingMessages.has(editKey)) {
            if (this.loggingConfig.debugWebSocketEvents) {
              console.log(
                `${this.LOG_PREFIX} 🚫 [${this.config.name}] ` +
                `Already processing edit for message ${post.id}`
              );
            }
            return;
          }
          
          // Mark as processing
          this.processingMessages.add(editKey);
          
          // Check if this channel is being monitored
          if (this.monitoredChannels.has(post.channel_id)) {
            const user = await this.getUser(post.user_id);
            
            // Set context for LogBuffer if available
            if (this.logBuffer) {
              const channelInfo = await this.getChannelById(post.channel_id);
              const channelName = channelInfo?.name || post.channel_id;
              this.logBuffer.setChannelContext('websocket', `${channelName}[${post.channel_id}]`);
              this.logBuffer.setUserContext('websocket', `${user.username}[${post.user_id}]`);
            }
            
            const editedMessage: MattermostMessage = {
              id:         post.id,
              channel_id: post.channel_id,
              user_id:    post.user_id,
              message:    post.message,
              username:   user.username,
              nickname:   user.nickname || undefined,
              create_at:  post.create_at,
              edit_at:    post.edit_at,
              file_ids:   post.file_ids || []
            };

            if (this.loggingConfig.debugWebSocketEvents) {
              console.log(
                `${this.LOG_PREFIX} ✏️ [${this.config.name}] ` +
                `Message ${editedMessage.id} edited by (${user.username})[${post.user_id}] in channel (${post.channel_id})`
              );
            }

            if (this.messageEditHandler) {
              await this.messageEditHandler(editedMessage);
            }
            
            // Remove from processing set after handler completes
            this.processingMessages.delete(editKey);
            
            // Clear WebSocket context after processing
            if (this.logBuffer) {
              this.logBuffer.clearChannelContext('websocket');
              this.logBuffer.clearUserContext('websocket');
            }
          }

        // All other event-type logs only if debug is on
        } else if (this.loggingConfig.debugWebSocketEvents) {
          switch (eventType) {
            case 'status_change':
              console.log(
                `${this.LOG_PREFIX} 📊 [${this.config.name}] ` +
                `Status change for user_id=${event.data.user_id}, status=${event.data.status}`
              );
              break;
            case 'typing':
              console.log(
                `${this.LOG_PREFIX} ⌨️ [${this.config.name}] Typing event`
              );
              break;
            // add more cases as needed...
            default:
              console.log(
                `${this.LOG_PREFIX} ❓ [${this.config.name}] ` +
                `Unhandled event type='${eventType}', data keys=${event.data ? Object.keys(event.data).join(',') : 'none'}`
              );
          }
        }
      } catch (error) {
        console.error(
          `${this.LOG_PREFIX} ❌ [${this.config.name}] Error processing WebSocket message:`,
          error
        );
        // Always dump full details on error, regardless of debug mode
        console.error(
          `${this.LOG_PREFIX} ❌ [${this.config.name}] Full error details:`,
          {
            error: error instanceof Error ? {
              ...error,
              stack: error.stack
            } : error,
            rawData: data.toString()
          }
        );
      }
    });

    this.ws.on('error', (error) => {
      if (connectionIdForHandlers !== this.wsConnectionId) return; // stale
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] WebSocket error:`, error);
      // Always dump full error information, regardless of debug mode
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Full WebSocket error details:`, {
        error: error instanceof Error ? {
          // Spread first to get all properties, then override with stack if needed
          ...error,
          stack: error.stack
        } : error,
        wsState: this.ws ? {
          readyState: this.ws.readyState,
          url: this.ws.url,
          protocol: this.ws.protocol,
          bufferedAmount: this.ws.bufferedAmount
        } : 'WebSocket is null',
        connectionInfo: {
          server: this.config.server,
          name: this.config.name,
          wsUrl: wsUrl
        }
      });
    });

    this.ws.on('close', async (code: number, reason: Buffer) => {
      // Ignore closes from stale sockets to avoid spurious reconnects
      if (connectionIdForHandlers !== this.wsConnectionId) {
        if (this.loggingConfig.debugWebSocketEvents) {
          console.log(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Ignoring CLOSE from stale socket (ID: ${connectionIdForHandlers})`);
        }
        return;
      }

      const reasonText = (() => { try { return reason?.toString(); } catch { return ''; } })();
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] WebSocket CLOSED (Connection ID: ${this.wsConnectionId}) code=${code} reason=${reasonText}`);

      // Check if the session is still valid; if not, re-login before reconnecting
      void this.checkSession('ws-close');
      
      // Clear the WebSocket reference and stop heartbeat
      this.ws = null;
      this.stopHeartbeat();

      // If we intentionally closed (disconnect/forceReconnect), do not schedule reconnect
      if (this.intentionallyClosing) {
        if (this.loggingConfig.debugWebSocketEvents) {
          console.log(`${this.LOG_PREFIX} 🔕 [${this.config.name}] Close was intentional; skipping auto-reconnect`);
        }
        this.intentionallyClosing = false; // reset flag
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      }

      // Check if we should attempt reconnection
      // If maxReconnectAttempts === 0, treat as unlimited (browser-like)
      if (this.maxReconnectAttempts === 0 || this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const base = 5000 * Math.pow(1.5, this.reconnectAttempts - 1);
        const jitter = Math.floor(Math.random() * 1000); // add small jitter to avoid thundering herd
        const backoffDelay = Math.min(base + jitter, 30000);
        const maxLabel = this.maxReconnectAttempts === 0 ? '∞' : String(this.maxReconnectAttempts);
        console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Will reconnect (attempt ${this.reconnectAttempts}/${maxLabel}) in ${backoffDelay}ms`);

        // Cancel any existing scheduled reconnect and schedule a new one
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null; // clear reference when it fires
          // Double-check we haven't already reconnected
          if (!this.ws && this.monitoredChannels.size > 0 && this.messageHandler) {
            console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Initiating reconnection...`);
            this.connectWebSocket(Array.from(this.monitoredChannels), this.messageHandler);
          } else if (this.ws) {
            console.log(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Skipping reconnect - WebSocket already exists`);
          }
        }, backoffDelay);
      } else {
        console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Max reconnection attempts reached. Manual intervention required.`);
      }
    });
  }

  setMessageEditHandler(onMessageEdit: (msg: MattermostMessage) => Promise<void>): void {
    this.messageEditHandler = onMessageEdit;
  }

  getWebSocketHealth(): string | null {
    if (!this.ws) return null;
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const state = states[this.ws.readyState] || `UNKNOWN(${this.ws.readyState})`;
    
    // Add health info based on last message time
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (state === 'OPEN' && timeSinceLastMessage > 120000) { // 2 minutes
      return `${state} (stale: ${Math.round(timeSinceLastMessage/1000)}s)`;
    }
    
    return state;
  }

  forceReconnect(): void {
    console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] FORCE RECONNECT requested (Current connection: ${this.wsConnectionId})`);
    
    // Only force reconnect if we're not already connecting
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      console.log(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Already connecting, skipping force reconnect`);
      return;
    }
    
    if (this.ws) {
      console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Closing existing WebSocket (ID: ${this.wsConnectionId})`);
      this.intentionallyClosing = true;
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reset reconnect attempts to allow force reconnection
    this.reconnectAttempts = 0;
    
    // Reconnect with existing channels and handler
    if (this.monitoredChannels.size > 0 && this.messageHandler) {
      console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Starting forced reconnection in 1 second...`);
      setTimeout(() => {
        if (!this.ws && this.messageHandler) { // Double-check we didn't reconnect already and handler exists
          this.connectWebSocket(Array.from(this.monitoredChannels), this.messageHandler);
        }
      }, 1000);
    }
  }

  private startHeartbeat(): void {
    this.lastPongTime = Date.now();
    this.lastStatusCheck = Date.now();
    this.lastAuthCheck = Date.now();
    
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) { // 1 = OPEN
        console.log(`${this.LOG_PREFIX} 💔 [${this.config.name}] WebSocket not open during heartbeat, stopping ping`);
        this.stopHeartbeat();
        return;
      }

      const now = Date.now();
      const timeSinceLastPong = now - this.lastPongTime;
      const timeSinceLastMessage = now - this.lastMessageTime;
      const timeSinceLastStatusCheck = now - this.lastStatusCheck;
      
      // If we haven't received a pong in 65 seconds (60 + 5 buffer like Go client), consider connection stale
      if (timeSinceLastPong > 65000) {
        console.log(`${this.LOG_PREFIX} 💔 [${this.config.name}] No pong received for ${timeSinceLastPong}ms, forcing reconnection`);
        this.forceReconnect();
        return;
      }
      
      // Send get_statuses every 30 seconds as an active health check
      // This matches Mattermost's approach rather than passive timeout
      if (timeSinceLastStatusCheck > 30000) {
        this.sendWebSocketMessage('get_statuses', null);
        this.lastStatusCheck = Date.now();
        
        if (this.loggingConfig.debugWebSocketEvents) {
          console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Sent get_statuses for health check`);
        }
      }

      // Every ~3 minutes, verify the REST session is still valid.
      if (now - this.lastAuthCheck > 180000) {
        void this.checkSession('heartbeat');
      }
      
      // If we haven't received ANY message in 90 seconds after status check, force reconnect
      // This is more aggressive than before but matches the Go client's approach
      if (timeSinceLastMessage > 90000) {
        console.log(`${this.LOG_PREFIX} 💔 [${this.config.name}] No messages for ${Math.round(timeSinceLastMessage/1000)}s after status check, forcing reconnection`);
        this.forceReconnect();
        return;
      }

      if (this.loggingConfig.debugWebSocketEvents) {
        console.log(`${this.LOG_PREFIX} 🏓 [${this.config.name}] Sending ping (last msg: ${Math.round(timeSinceLastMessage/1000)}s ago)`);
      }
      
      this.ws.ping();
    }, 30000); // Check every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Lightweight session checker: verifies REST auth; on 401/403, re-login.
  private async checkSession(trigger: string): Promise<void> {
    const now = Date.now();
    // Throttle session checks to avoid bursts
    if (this.sessionCheckInProgress || now - this.lastAuthCheck < 30000) {
      return;
    }
    this.sessionCheckInProgress = true;
    try {
      await this.api.get('/users/me');
      this.lastAuthCheck = now;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        console.warn(`${this.LOG_PREFIX} 🔐 [${this.config.name}] Session appears expired (trigger=${trigger}, status=${status}). Re-authenticating...`);
        try {
          await this.login();
          // Refresh WS auth by reconnecting with the new token
          this.forceReconnect();
        } catch (loginErr) {
          console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Re-authentication failed:`, loginErr);
        }
      }
    } finally {
      this.sessionCheckInProgress = false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.intentionallyClosing = true;
      this.ws.close();
      this.ws = null;
    }
    this.monitoredChannels.clear();
    this.messageHandler = null;
    this.messageEditHandler = null;
    
    // Clear caches to free memory
    this.channelCache.clear();
    this.processingMessages.clear();
  }

  // Methods to access cached information without API calls
  getCachedChannel(channelId: string): ChannelInfo | null {
    return this.channelCache.get(channelId) || null;
  }

  // Method to pre-populate cache (useful for optimization)
  setCachedChannel(channelId: string, channel: ChannelInfo): void {
    this.channelCache.set(channelId, channel);
  }

  async getStatusChannelId(): Promise<string | null> {
    return this.statusChannelId;
  }

  async addReaction(messageId: string, emojiName: string): Promise<void> {
    try {
      await this.api.post('/reactions', {
        post_id: messageId,
        emoji_name: emojiName,
        user_id: this.userId
      });
      
      console.log(`${this.LOG_PREFIX} ${emoji('👍')}[${this.config.name}] Added reaction :${emojiName}: to message ${messageId}`.trim());
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Failed to add reaction :${emojiName}: to message ${messageId}:`.trim(), error.response?.data || error.message);
      // Don't throw error - reactions are not critical to bridge functionality
    }
  }

  async getMessagesSince(channelId: string, sinceTimestamp: number, limit: number = 100): Promise<MattermostMessage[]> {
    try {
      console.log(`${this.LOG_PREFIX} ${emoji('🔍')}[${this.config.name}] Fetching messages from channel ${channelId} since ${new Date(sinceTimestamp).toISOString()}`.trim());
      console.log(`${this.LOG_PREFIX} ${emoji('🐛')}[${this.config.name}] Debug: sinceTimestamp=${sinceTimestamp}, limit=${limit}`.trim());

      let posts: any = {};
      let order: string[] = [];

      // Try the since parameter first
      try {
        const sinceMs = Math.floor(sinceTimestamp);
        const response = await this.api.get(`/channels/${channelId}/posts`, {
          params: {
            since: sinceMs,
            per_page: limit
          }
        });

        posts = response.data.posts || {};
        order = response.data.order || [];
        console.log(`${this.LOG_PREFIX} ${emoji('🐛')}[${this.config.name}] Debug: API response with since filter - posts count=${Object.keys(posts).length}, order length=${order.length}`.trim());
      } catch (sinceError) {
        console.log(`${this.LOG_PREFIX} ${emoji('⚠️')}[${this.config.name}] Since parameter failed, trying alternative approach: ${sinceError}`.trim());
      }

      // If since parameter didn't work or returned no results, fall back to fetching recent posts and filtering
      if (Object.keys(posts).length === 0) {
        console.log(`${this.LOG_PREFIX} ${emoji('🔄')}[${this.config.name}] Fallback: Fetching recent posts and filtering manually`.trim());

        // Fetch more posts to ensure we don't miss anything due to API limitations
        const fallbackLimit = Math.min(limit * 3, 300); // Fetch up to 3x the limit but cap at 300
        const fallbackResponse = await this.api.get(`/channels/${channelId}/posts`, {
          params: {
            per_page: fallbackLimit
          }
        });

        const allPosts = fallbackResponse.data.posts || {};
        const allOrder = fallbackResponse.data.order || [];

        console.log(`${this.LOG_PREFIX} ${emoji('🐛')}[${this.config.name}] Debug: Fallback fetched ${Object.keys(allPosts).length} total posts`.trim());

        // Filter posts manually by timestamp
        const filteredOrder = allOrder.filter((postId: string) => {
          const post = allPosts[postId];
          return post && post.create_at >= sinceTimestamp;
        });

        // Take only the requested limit after filtering
        order = filteredOrder.slice(0, limit);
        posts = {};
        for (const postId of order) {
          posts[postId] = allPosts[postId];
        }

        console.log(`${this.LOG_PREFIX} ${emoji('🐛')}[${this.config.name}] Debug: After manual filtering - ${order.length} posts match since timestamp`.trim());

        if (order.length > 0) {
          const latestPost = allPosts[allOrder[0]];
          if (latestPost) {
            console.log(`${this.LOG_PREFIX} ${emoji('🐛')}[${this.config.name}] Debug: Latest post timestamp=${latestPost.create_at} (${new Date(latestPost.create_at).toISOString()}), since=${sinceTimestamp} (${new Date(sinceTimestamp).toISOString()})`.trim());
          }
        }
      }
      
      // Convert posts to our message format
      const messages: MattermostMessage[] = [];
      
      for (const postId of order) {
        const post = posts[postId];
        if (!post) continue;
        
        // Skip system messages
        if (post.type && post.type.startsWith('system_')) continue;
        
        // Get user info
        const user = await this.getUser(post.user_id);
        
        messages.push({
          id: post.id,
          channel_id: post.channel_id,
          user_id: post.user_id,
          message: post.message,
          username: user.username,
          nickname: user.nickname || undefined,
          create_at: post.create_at,
          edit_at: post.edit_at,
          file_ids: post.file_ids || []
        });
      }
      
      // Sort by create_at ascending (oldest first)
      messages.sort((a, b) => a.create_at - b.create_at);
      
      console.log(`${this.LOG_PREFIX} ${emoji('📨')}[${this.config.name}] Found ${messages.length} messages to catch up`.trim());
      
      return messages;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}[${this.config.name}] Failed to get messages since ${sinceTimestamp}:`.trim(), error.response?.data || error.message);
      return [];
    }
  }
  
  private sendWebSocketMessage(action: string, data: any): void {
    if (!this.ws || this.ws.readyState !== 1) {
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Cannot send WebSocket message - not connected`);
      return;
    }
    
    const message = {
      seq: this.wsSequence++,
      action: action,
      data: data
    };
    
    this.ws.send(JSON.stringify(message));
  }

}
