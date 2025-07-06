import axios from 'axios';
import { HeartbeatConfig } from './types';

export class HeartbeatService {
  private intervalId: NodeJS.Timeout | null = null;
  private isActive: boolean = false;
  private readonly LOG_PREFIX = '[heartbeat-service]';
  private heartbeatCount: number = 0;
  private nextHeartbeatTime: Date | null = null;

  constructor(private config: HeartbeatConfig) {}

  start(): void {
    if (!this.config.url) {
      console.log(`${this.LOG_PREFIX} ℹ️ No heartbeat URL configured - heartbeat monitoring disabled`);
      return;
    }

    if (this.isActive) {
      console.log(`${this.LOG_PREFIX} ⚠️  Heartbeat service is already running`);
      return;
    }

    console.log(`${this.LOG_PREFIX} 💓 Starting heartbeat service: ${this.config.url} (every ${this.config.intervalMinutes} minutes)`);

    // Send initial heartbeat immediately
    this.sendHeartbeat();

    // Schedule periodic heartbeats
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    
    // Calculate and log next heartbeat time
    this.nextHeartbeatTime = new Date(Date.now() + intervalMs);
    console.log(`${this.LOG_PREFIX} 💓 Next heartbeat scheduled for: ${this.nextHeartbeatTime.toTimeString().split(' ')[0]}`);
    
    this.intervalId = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);

    this.isActive = true;
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    console.log(`${this.LOG_PREFIX} 🛑 Stopping heartbeat service (sent ${this.heartbeatCount} heartbeats)`);
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isActive = false;
    this.nextHeartbeatTime = null;
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.config.url) {
      return;
    }

    try {
      const startTime = Date.now();
      this.heartbeatCount++;
      
      const response = await axios.get(this.config.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mattermost-Bridge-Heartbeat/1.0'
        }
      });
      
      const duration = Date.now() - startTime;
      const timestamp = new Date().toISOString();
      
      if (response.status === 200) {
        const intervalMs = this.config.intervalMinutes * 60 * 1000;
        this.nextHeartbeatTime = new Date(Date.now() + intervalMs);
        const nextTimeStr = this.nextHeartbeatTime.toTimeString().split(' ')[0]; // HH:MM:SS format
        
        console.log(`${this.LOG_PREFIX} 💓 [${timestamp}] Heartbeat #${this.heartbeatCount} sent (${duration}ms) - next at ${nextTimeStr}`);
      } else {
        console.warn(`${this.LOG_PREFIX} ⚠️  [${timestamp}] Heartbeat #${this.heartbeatCount} failed with status ${response.status} (${duration}ms)`);
      }
    } catch (error: any) {
      const timestamp = new Date().toISOString();
      console.error(`${this.LOG_PREFIX} ❌ [${timestamp}] Heartbeat #${this.heartbeatCount} failed:`, error.message);
      
      // Log more details about the error
      console.error(`${this.LOG_PREFIX} ❌ Error details:`, {
        url: this.config.url,
        code: error.code,
        syscall: error.syscall,
        hostname: error.hostname,
        port: error.port,
        stack: error.stack
      });
      
      // Don't throw error - heartbeat failures shouldn't crash the bridge
    }
  }

  getStatus(): { 
    active: boolean; 
    url?: string; 
    intervalMinutes: number;
    heartbeatCount: number;
    nextHeartbeatTime: string | null;
  } {
    return {
      active: this.isActive,
      url: this.config.url,
      intervalMinutes: this.config.intervalMinutes,
      heartbeatCount: this.heartbeatCount,
      nextHeartbeatTime: this.nextHeartbeatTime ? this.nextHeartbeatTime.toISOString() : null
    };
  }
}