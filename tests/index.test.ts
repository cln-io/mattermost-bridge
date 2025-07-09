import { loadConfig } from '../src/config';
import { MattermostBridge } from '../src/bridge';
import { main } from '../src/index';

jest.mock('../src/config');
jest.mock('../src/bridge');

describe('index', () => {
  let mockBridge: jest.Mocked<MattermostBridge>;
  let processExitSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockBridge = {
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined)
    } as any;

    (MattermostBridge as jest.MockedClass<typeof MattermostBridge>).mockImplementation(() => mockBridge);
    
    (loadConfig as jest.Mock).mockReturnValue({
      left: { 
        name: 'Left',
        server: 'https://left.example.com',
        username: 'user1',
        password: 'pass1'
      },
      right: { 
        name: 'Right',
        server: 'https://right.example.com',
        username: 'user2',
        password: 'pass2'
      },
      rule: {
        sourceChannelId: 'source123',
        targetChannelId: 'target456'
      },
      heartbeat: {
        intervalMinutes: 5
      },
      logging: {
        level: 'info',
        debugWebSocketEvents: false,
        eventSummaryIntervalMinutes: 10,
        statsChannelUpdates: 'none' as const,
        disableEmoji: false,
        timezone: 'UTC'
      },
      dryRun: false,
      dontForwardFor: []
    });

    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleLogSpy = jest.spyOn(console, 'log');
    consoleErrorSpy = jest.spyOn(console, 'error');
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    // Remove all listeners to prevent interference between tests
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGQUIT');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('should start bridge successfully', async () => {
    mockBridge.start.mockResolvedValue();

    await main();

    expect(loadConfig).toHaveBeenCalled();
    expect(MattermostBridge).toHaveBeenCalled();
    expect(mockBridge.start).toHaveBeenCalled();
  });

  it('should display dry run banner when enabled', async () => {
    (loadConfig as jest.Mock).mockReturnValue({
      left: { 
        name: 'Left',
        server: 'https://left.example.com',
        username: 'user1',
        password: 'pass1'
      },
      right: { 
        name: 'Right',
        server: 'https://right.example.com',
        username: 'user2',
        password: 'pass2'
      },
      rule: {
        sourceChannelId: 'source123',
        targetChannelId: 'target456'
      },
      heartbeat: {
        intervalMinutes: 5
      },
      logging: {
        level: 'info',
        debugWebSocketEvents: false,
        eventSummaryIntervalMinutes: 10,
        statsChannelUpdates: 'none' as const,
        disableEmoji: false,
        timezone: 'UTC'
      },
      dryRun: true,
      dontForwardFor: []
    });

    await main();

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN MODE'));
  });

  it('should handle SIGINT gracefully', async () => {
    // Mock bridge.start to resolve immediately so main() can set up handlers
    mockBridge.start.mockResolvedValue();
    
    // Start main and wait for setup
    const mainPromise = main();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now emit the signal
    process.emit('SIGINT');

    // Wait a bit for the async handler
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle SIGTERM gracefully', async () => {
    // Mock bridge.start to resolve immediately so main() can set up handlers
    mockBridge.start.mockResolvedValue();
    
    // Start main and wait for setup
    const mainPromise = main();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now emit the signal
    process.emit('SIGTERM');

    // Wait a bit for the async handler
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle uncaught exceptions', async () => {
    // Mock bridge.start to resolve immediately so main() can set up handlers
    mockBridge.start.mockResolvedValue();
    
    // Start main and wait for setup
    const mainPromise = main();
    await new Promise(resolve => setTimeout(resolve, 100));

    const error = new Error('Uncaught error');
    process.emit('uncaughtException', error);

    // Wait a bit for the async handler
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Uncaught Exception'), error);
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle unhandled rejections', async () => {
    // Mock bridge.start to resolve immediately so main() can set up handlers
    mockBridge.start.mockResolvedValue();
    
    // Start main and wait for setup
    const mainPromise = main();
    await new Promise(resolve => setTimeout(resolve, 100));

    const reason = new Error('Unhandled rejection');
    const promise = Promise.reject(reason);
    promise.catch(() => {}); // Prevent actual unhandled rejection
    process.emit('unhandledRejection', reason, promise);

    // Wait a bit for the async handler
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled Rejection'),
      promise,
      'reason:',
      reason
    );
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle startup errors', async () => {
    const error = new Error('Startup failed');
    mockBridge.start.mockRejectedValue(error);

    // Call main but don't await it since process.exit will terminate
    const mainPromise = main();
    
    // Wait for the async operations to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Application failed to start'), error);
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    
    // Clean up the promise
    await mainPromise.catch(() => {});
  });
});