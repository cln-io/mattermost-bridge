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