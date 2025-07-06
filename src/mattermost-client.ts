import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { authenticator } from 'otplib';
import { MattermostConfig, MattermostMessage, Channel, ChannelInfo, User, LoggingConfig, MessageAttachment } from './types';
import FormData from 'form-data';

export class MattermostClient {
  private api: AxiosInstance;
  private token: string = '';
  private ws: WebSocket | null = null;
  private userId: string = '';
  private dmChannelId: string = '';
  private readonly LOG_PREFIX = '[mattermost-client]';
  
  // Event tracking for summary
  private eventCounts: Map<string, number> = new Map();
  private eventSummaryTimer: NodeJS.Timeout | null = null;
  private lastEventSummaryTime: Date = new Date();
  private nextEventSummaryTime: Date | null = null;
  private eventSummaryCount: number = 0;

  constructor(private config: MattermostConfig, private loggingConfig: LoggingConfig) {
    // Normalize server URL to prevent double slashes
    const normalizedServer = this.normalizeServerUrl(config.server);
    
    this.api = axios.create({
      baseURL: `${normalizedServer}/api/v4`,
      timeout: 10000
    });
    
    console.log(`${this.LOG_PREFIX} 🔧 [${config.name}] Normalized server URL: ${normalizedServer}`);
    
    // Only log debugging info if debug mode is enabled
    if (this.loggingConfig.debugWebSocketEvents) {
      console.log(`${this.LOG_PREFIX} 🔧 [${config.name}] Debug WebSocket events enabled`);
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
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to generate TOTP:`, error);
      throw new Error('Failed to generate TOTP code');
    }
  }

  private startEventSummaryTimer(): void {
    // Clear any existing timer
    if (this.eventSummaryTimer) {
      clearInterval(this.eventSummaryTimer);
    }

    const intervalMinutes = this.loggingConfig.eventSummaryIntervalMinutes;
    const intervalMs = intervalMinutes * 60 * 1000;

    console.log(`${this.LOG_PREFIX} 📊 [${this.config.name}] Starting event summary timer (every ${intervalMinutes} minutes)`);
    
    // Calculate and log next summary time
    this.nextEventSummaryTime = new Date(Date.now() + intervalMs);
    console.log(`${this.LOG_PREFIX} 📊 [${this.config.name}] Next summary at: ${this.nextEventSummaryTime.toTimeString().split(' ')[0]}`);

    // Log event summary at the configured interval
    this.eventSummaryTimer = setInterval(async () => {
      await this.logEventSummary();
    }, intervalMs);
  }

  private async stopEventSummaryTimer(): Promise<void> {
    if (this.eventSummaryTimer) {
      clearInterval(this.eventSummaryTimer);
      this.eventSummaryTimer = null;
      // Log final summary before stopping
      await this.logEventSummary();
    }
  }

  private async logEventSummary(): Promise<void> {
    const now = new Date();
    const duration = Math.round((now.getTime() - this.lastEventSummaryTime.getTime()) / 1000);
    this.eventSummaryCount++;
    
    // Calculate next summary time
    const intervalMs = this.loggingConfig.eventSummaryIntervalMinutes * 60 * 1000;
    this.nextEventSummaryTime = new Date(now.getTime() + intervalMs);
    const nextTimeStr = this.nextEventSummaryTime.toTimeString().split(' ')[0]; // HH:MM:SS format
    
    let summaryText: string;
    if (this.eventCounts.size === 0) {
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): No events - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} 📊 [${this.config.name}] ${summaryText}`);
    } else {
      const summary = Array.from(this.eventCounts.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by count descending
        .map(([event, count]) => `${event}: ${count}`)
        .join(', ');
      
      summaryText = `Summary #${this.eventSummaryCount} (${duration}s): ${summary} - next at ${nextTimeStr}`;
      console.log(`${this.LOG_PREFIX} 📊 [${this.config.name}] ${summaryText}`);
    }
    
    // Update DM channel header with status if we have a DM channel
    if (this.dmChannelId) {
      try {
        const timestamp = now.toLocaleString();
        const headerText = `MMSync Status [${timestamp}]: ${summaryText}`;
        await this.updateChannelHeader(this.dmChannelId, headerText);
      } catch (error) {
        console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to update DM channel header:`, error);
      }
    }
    
    // Reset counters
    this.eventCounts.clear();
    this.lastEventSummaryTime = now;
  }

  private trackEvent(eventType: string): void {
    this.eventCounts.set(eventType, (this.eventCounts.get(eventType) || 0) + 1);
  }

  async ping(): Promise<void> {
    try {
      const normalizedServer = this.normalizeServerUrl(this.config.server);
      console.log(`${this.LOG_PREFIX} 🏓 Pinging ${this.config.name} (${normalizedServer})...`);
      
      const startTime = Date.now();
      const response = await this.api.get('/system/ping');
      const duration = Date.now() - startTime;
      
      if (response.status === 200) {
        console.log(`${this.LOG_PREFIX} ✅ ${this.config.name} is reachable (${duration}ms)`);
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ Failed to ping ${this.config.name}:`, error.response?.data || error.message);
      throw new Error(`Cannot reach ${this.config.name} at ${this.config.server}`);
    }
  }

  async login(): Promise<void> {
    try {
      const normalizedServer = this.normalizeServerUrl(this.config.server);
      console.log(`${this.LOG_PREFIX} Logging into ${this.config.name} (${normalizedServer})...`);
      
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
          console.log(`${this.LOG_PREFIX} 🔐 [${this.config.name}] TOTP Code: ${totpCode}`);
          console.log(`${this.LOG_PREFIX} 🕐 [${this.config.name}] Time remaining: ${30 - (Math.floor(Date.now() / 1000) % 30)}s`);
          console.log(`${this.LOG_PREFIX} 📤 [${this.config.name}] Including MFA token in login request`);
        } else {
          console.log(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to generate TOTP code`);
          throw new Error(`Failed to generate TOTP code for ${this.config.name}`);
        }
      } else {
        console.log(`${this.LOG_PREFIX} ℹ️ [${this.config.name}] No MFA seed configured`);
      }
      
      const response = await this.api.post('/users/login', loginPayload);

      this.token = response.headers.token;
      this.userId = response.data.id;
      
      // Set auth header for future requests
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
      
      console.log(`${this.LOG_PREFIX} ✅ Successfully logged in to ${this.config.name} as ${response.data.username}`);
      
      // Set up DM channel for status updates if enabled and user is not a bot
      if (this.loggingConfig.updateDmChannelHeader) {
        if (response.data.is_bot) {
          console.log(`${this.LOG_PREFIX} 🤖 [${this.config.name}] Bot account detected - DM channel header updates disabled`);
        } else {
          try {
            const dmChannel = await this.getDirectMessageChannel(this.userId);
            if (dmChannel) {
              this.dmChannelId = dmChannel.id;
              console.log(`${this.LOG_PREFIX} 📬 [${this.config.name}] DM channel header updates enabled: ${this.dmChannelId}`);
              
              // Set initial "all good" status immediately
              try {
                const timestamp = new Date().toLocaleString();
                const headerText = `MMSync Status [${timestamp}]: ✅ All good - awaiting status updates`;
                await this.updateChannelHeader(this.dmChannelId, headerText);
                console.log(`${this.LOG_PREFIX} ✅ [${this.config.name}] Initial DM channel header set: "All good - awaiting status updates"`);
              } catch (error) {
                console.warn(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Failed to set initial DM channel header:`, error);
              }
            } else {
              console.warn(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Could not find DM channel - header updates disabled`);
            }
          } catch (error) {
            console.warn(`${this.LOG_PREFIX} ⚠️ [${this.config.name}] Failed to set up DM channel for header updates:`, error);
          }
        }
      } else {
        console.log(`${this.LOG_PREFIX} ℹ️ [${this.config.name}] DM channel header updates disabled (UPDATE_DM_CHANNEL_HEADER=false)`);
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ❌ Login failed for ${this.config.name}:`, error.response?.data || error.message);
      if (this.config.mfaSeed && error.response?.status === 401) {
        console.error(`${this.LOG_PREFIX} 💡 [${this.config.name}] Hint: Check if MFA seed is correct and TOTP code is valid`);
      }
      throw error;
    }
  }

  async getChannelById(channelId: string): Promise<ChannelInfo | null> {
    try {
      const response = await this.api.get(`/channels/${channelId}`);
      const channel = response.data;
      
      return {
        id: channel.id,
        name: channel.name,
        displayName: channel.display_name || channel.name,
        type: channel.type
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`${this.LOG_PREFIX} ❌ [${this.config.name}] Channel ID '${channelId}' not found`);
        return null;
      }
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Error getting channel ${channelId}:`, error.response?.data || error.message);
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

  async postMessage(channelId: string, message: string): Promise<void> {
    try {
      await this.api.post('/posts', {
        channel_id: channelId,
        message: message
      });
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting message:`, error.response?.data || error.message);
      throw error;
    }
  }

  async postMessageWithAttachment(channelId: string, message: string, attachment: MessageAttachment, fileIds?: string[]): Promise<void> {
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

      await this.api.post('/posts', postData);
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error posting message with attachment:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getUser(userId: string): Promise<User> {
    try {
      const response = await this.api.get(`/users/${userId}`);
      return response.data;
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} Error getting user ${userId}:`, error.response?.data || error.message);
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
      console.error(`${this.LOG_PREFIX} ❌ [${this.config.name}] Failed to download profile picture for user ${userId}:`, error.response?.status || error.message);
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

  connectWebSocket(channelId: string, onMessage: (msg: MattermostMessage) => Promise<void>, channelName?: string): void {
    // Use normalized server URL for WebSocket connection
    const normalizedServer = this.normalizeServerUrl(this.config.server);
    const wsUrl = normalizedServer.replace('http', 'ws') + '/api/v4/websocket';
    
    const channelDisplay = channelName ? `#${channelName}` : channelId;
    console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] Connecting WebSocket to monitor channel: ${channelDisplay} (${channelId})`);
    
    if (this.loggingConfig.debugWebSocketEvents) {
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] WebSocket URL: ${wsUrl}`);
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] Note: WebSocket receives all channel events, filtering to: ${channelId}`);
    }
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      console.log(`${this.LOG_PREFIX} 🔌 WebSocket connected to ${this.config.name}`);
      
      // Start event summary timer after successful connection
      this.startEventSummaryTimer();
      
      // Authenticate WebSocket
      this.ws?.send(JSON.stringify({
        seq: 1,
        action: 'authentication_challenge',
        data: {
          token: this.token
        }
      }));
    });

    this.ws.on('message', async (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        const eventType = event.event as string;

        // Log raw event JSON when debug mode is enabled
        if (this.loggingConfig.debugWebSocketEvents && eventType) {
          console.log(
            `${this.LOG_PREFIX} 🔍 [${this.config.name}] Raw WebSocket event:`,
            JSON.stringify(event, null, 2)
          );
        }

        // Track all events for summary
        if (eventType) {
          this.trackEvent(eventType);
        }

        // Always log 'posted' (new message) and 'hello' events
        if (eventType === 'posted') {
          const post = JSON.parse(event.data.post);
          
          // IMPORTANT: Only process messages from the channel we're monitoring
          if (post.channel_id !== channelId) {
            if (this.loggingConfig.debugWebSocketEvents) {
              console.log(
                `${this.LOG_PREFIX} 🚫 [${this.config.name}] ` +
                `Ignoring message from different channel: ${post.channel_id} (monitoring: ${channelId})`
              );
            }
            return; // Skip this message
          }
          
          const user = await this.getUser(post.user_id);
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

          console.log(
            `${this.LOG_PREFIX} ✉️ [${this.config.name}] ` +
            `Received message from #${channelName || channelId} (${message.id})`
          );

          await onMessage(message);

        } else if (eventType === 'hello') {
          console.log(
            `${this.LOG_PREFIX} 👋 [${this.config.name}] Received hello event`
          );

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

    this.ws.on('close', async () => {
      console.log(`${this.LOG_PREFIX} 🔌 [${this.config.name}] WebSocket connection closed`);
      
      // Log final event summary before reconnecting
      await this.logEventSummary();
      
      // Stop the timer
      await this.stopEventSummaryTimer();
      
      // Reconnect after 5 seconds
      setTimeout(() => {
        console.log(`${this.LOG_PREFIX} 🔄 [${this.config.name}] Attempting to reconnect WebSocket...`);
        this.connectWebSocket(channelId, onMessage, channelName);
      }, 5000);
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Stop event summary timer
    await this.stopEventSummaryTimer();
  }

  // Debug method to manually trigger event summary
  async forceEventSummary(): Promise<void> {
    await this.logEventSummary();
  }
}