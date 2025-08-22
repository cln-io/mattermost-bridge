import fs from 'fs';
import path from 'path';
import { MattermostMessage } from './types';
import { emoji } from './logger-utils';

interface TrackedChannel {
  channelId: string;
  lastForwardedMessageId: string;
  lastForwardedTimestamp: number;
  lastUpdateTime: string;
}

interface TrackingData {
  version: number;
  channels: Record<string, TrackedChannel>;
}

export class MessageTracker {
  private readonly LOG_PREFIX = '[message-tracker ]';
  private dataPath: string;
  private data: TrackingData = { version: 1, channels: {} };
  private enabled: boolean;
  private persistenceEnabled: boolean = true;

  constructor(enabled: boolean = false, persistencePath?: string) {
    this.enabled = enabled;
    
    // Default to /data/tracking if no path specified (Docker volume mount point)
    this.dataPath = persistencePath || '/data/tracking/message-state.json';
    
    if (!this.enabled) {
      console.log(`${this.LOG_PREFIX} ${emoji('🔕')}Message tracking disabled`.trim());
      this.data = { version: 1, channels: {} };
      return;
    }

    console.log(`${this.LOG_PREFIX} ${emoji('💾')}Message tracking enabled - persistence at: ${this.dataPath}`.trim());
    this.loadOrInitialize();
  }

  private loadOrInitialize(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`${this.LOG_PREFIX} ${emoji('📁')}Created tracking directory: ${dir}`.trim());
        } catch (mkdirError: any) {
          // If we can't create the directory (permission denied), switch to in-memory only
          if (mkdirError.code === 'EACCES' || mkdirError.code === 'EPERM') {
            console.warn(`${this.LOG_PREFIX} ${emoji('⚠️')}Cannot create directory ${dir} (permission denied)`.trim());
            console.warn(`${this.LOG_PREFIX} ${emoji('💭')}Running in MEMORY-ONLY mode - tracking state will be lost on restart`.trim());
            console.warn(`${this.LOG_PREFIX} ${emoji('🐳')}To enable persistence, ensure the Docker volume is properly mounted and writable`.trim());
            this.persistenceEnabled = false;
            this.data = { version: 1, channels: {} };
            return;
          } else {
            throw mkdirError;
          }
        }
      }

      // Load existing data or create new
      if (fs.existsSync(this.dataPath)) {
        const rawData = fs.readFileSync(this.dataPath, 'utf8');
        this.data = JSON.parse(rawData);
        const channelCount = Object.keys(this.data.channels).length;
        console.log(`${this.LOG_PREFIX} ${emoji('📂')}Loaded tracking data for ${channelCount} channel(s)`.trim());
      } else {
        this.data = { version: 1, channels: {} };
        this.save();
        if (this.persistenceEnabled) {
          console.log(`${this.LOG_PREFIX} ${emoji('🆕')}Initialized new tracking file at ${this.dataPath}`.trim());
        }
      }
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to load tracking data:`.trim(), error);
      
      // If it's a permission error, handle it gracefully
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        console.warn(`${this.LOG_PREFIX} ${emoji('💭')}Running in MEMORY-ONLY mode - tracking state will be lost on restart`.trim());
        console.warn(`${this.LOG_PREFIX} ${emoji('🐳')}To enable persistence, ensure the Docker volume is properly mounted and writable`.trim());
        this.persistenceEnabled = false;
      }
      
      this.data = { version: 1, channels: {} };
    }
  }

  private save(): void {
    if (!this.enabled || !this.persistenceEnabled) return;
    
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
    } catch (error: any) {
      console.error(`${this.LOG_PREFIX} ${emoji('❌')}Failed to save tracking data:`.trim(), error);
      
      // If it's a permission error, disable persistence for future saves
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        console.warn(`${this.LOG_PREFIX} ${emoji('⚠️')}Disabling persistence due to permission error`.trim());
        this.persistenceEnabled = false;
      }
    }
  }

  public trackForwardedMessage(channelId: string, message: MattermostMessage): void {
    if (!this.enabled) return;

    this.data.channels[channelId] = {
      channelId,
      lastForwardedMessageId: message.id,
      lastForwardedTimestamp: message.create_at,
      lastUpdateTime: new Date().toISOString()
    };

    this.save();
    
    if (process.env.DEBUG_WEBSOCKET_EVENTS === 'true') {
      console.log(`${this.LOG_PREFIX} ${emoji('✅')}Tracked message ${message.id} for channel ${channelId}`.trim());
    }
  }

  public getLastForwardedMessage(channelId: string): TrackedChannel | null {
    if (!this.enabled) return null;
    return this.data.channels[channelId] || null;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getAllTrackedChannels(): string[] {
    return Object.keys(this.data.channels);
  }

  public clearChannel(channelId: string): void {
    if (!this.enabled) return;
    
    delete this.data.channels[channelId];
    this.save();
    console.log(`${this.LOG_PREFIX} ${emoji('🗑️')}Cleared tracking for channel ${channelId}`.trim());
  }

  public getStats(): { channelCount: number; oldestTracking: string | null } {
    const channels = Object.values(this.data.channels);
    if (channels.length === 0) {
      return { channelCount: 0, oldestTracking: null };
    }

    const oldest = channels.reduce((min, ch) => 
      ch.lastUpdateTime < min.lastUpdateTime ? ch : min
    );

    return {
      channelCount: channels.length,
      oldestTracking: oldest.lastUpdateTime
    };
  }
}