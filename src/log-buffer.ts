export class LogBuffer {
  private buffer: string[] = [];
  private maxBufferSize: number;
  private timezone: string;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;
  private pendingBatch: string[] = [];
  private batchSize: number = 5;
  private channelContext: Map<string, string> = new Map();
  private userContext: Map<string, string> = new Map();
  
  constructor(maxBufferSize: number = 1000, timezone: string = 'UTC') {
    this.maxBufferSize = maxBufferSize;
    this.timezone = timezone;
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;
  }
  
  start(): void {
    // Intercept console methods
    console.log = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addToBuffer(`[LOG] ${this.formatMessageWithChannel(message)}`);
      this.originalConsoleLog.apply(console, args);
    };
    
    console.error = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addToBuffer(`[ERROR] ${this.formatMessageWithChannel(message)}`);
      this.originalConsoleError.apply(console, args);
    };
    
    console.warn = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addToBuffer(`[WARN] ${this.formatMessageWithChannel(message)}`);
      this.originalConsoleWarn.apply(console, args);
    };
  }
  
  stop(): void {
    // Restore original console methods
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }
  
  private formatMessageWithChannel(message: string): string {
    // Get current context information
    const channelInfo = this.getCurrentChannelContext();
    const userInfo = this.getCurrentUserContext();
    
    // If no context available, return message as-is
    if (!channelInfo && !userInfo) {
      return message;
    }
    
    // Check if message already has channel context in format (name)[id]
    const hasChannelContext = /\([^)]+\)\[[^\]]+\]/.test(message);
    
    // Check if message already has user context - look for (username)[id] pattern after channel context
    const hasUserContext = /\([^)]+\)\[[^\]]+\]\s*\([^)]+\)\[[^\]]+\]/.test(message) || 
                           (!hasChannelContext && /\([^)]+\)\[[^\]]+\]/.test(message) && userInfo);
    
    let contextPrefix = '';
    
    if (hasChannelContext && !hasUserContext && userInfo) {
      // Message has channel context but no user context, add user context
      // Find the channel context and insert user context after it
      return message.replace(/(\([^)]+\)\[[^\]]+\])/, `$1(${userInfo})`);
    } else if (!hasChannelContext) {
      // Message has no channel context, add what we have
      if (channelInfo && userInfo) {
        contextPrefix = `(${channelInfo})(${userInfo}) `;
      } else if (channelInfo) {
        contextPrefix = `(${channelInfo}) `;
      } else if (userInfo) {
        contextPrefix = `(${userInfo}) `;
      }
      return contextPrefix + message;
    }
    
    // Message already has all needed context or we can't determine what to add
    return message;
  }

  private getCurrentChannelContext(): string | null {
    // Try to extract channel info from current context
    // Look for the most recently set context
    const contexts = Array.from(this.channelContext.values());
    return contexts.length > 0 ? contexts[contexts.length - 1] : null;
  }

  private getCurrentUserContext(): string | null {
    // Try to extract user info from current context
    // Look for the most recently set context
    const contexts = Array.from(this.userContext.values());
    return contexts.length > 0 ? contexts[contexts.length - 1] : null;
  }

  setChannelContext(contextId: string, channelInfo: string): void {
    this.channelContext.set(contextId, channelInfo);
  }

  clearChannelContext(contextId: string): void {
    this.channelContext.delete(contextId);
  }

  setUserContext(contextId: string, userInfo: string): void {
    this.userContext.set(contextId, userInfo);
  }

  clearUserContext(contextId: string): void {
    this.userContext.delete(contextId);
  }

  private addToBuffer(message: string): void {
    const timestamp = new Date().toLocaleString('en-CA', { 
      hour12: false, 
      timeZone: this.timezone 
    });
    this.buffer.push(`${timestamp} ${message}`);
    
    // Keep buffer size under control
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }
  
  getAndClear(): string[] {
    const logs = [...this.buffer];
    this.buffer = [];
    return logs;
  }
  
  getLast(count: number): string[] {
    return this.buffer.slice(-count);
  }
  
  clear(): void {
    this.buffer = [];
  }
  
  size(): number {
    return this.buffer.length;
  }
}