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
      stop: jest.fn()
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
        eventSummaryIntervalMinutes: 10
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
        eventSummaryIntervalMinutes: 10
      },
      dryRun: true,
      dontForwardFor: []
    });

    await main();

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN MODE'));
  });

  it('should handle SIGINT gracefully', async () => {
    // Start main without awaiting to set up signal handlers
    const mainPromise = main();
    
    // Wait for the signal handlers to be set up
    await new Promise(resolve => setTimeout(resolve, 50));

    process.emit('SIGINT');

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle SIGTERM gracefully', async () => {
    // Start main without awaiting to set up signal handlers
    const mainPromise = main();
    
    // Wait for the signal handlers to be set up
    await new Promise(resolve => setTimeout(resolve, 50));

    process.emit('SIGTERM');

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle uncaught exceptions', async () => {
    // Start main without awaiting to set up signal handlers
    const mainPromise = main();
    
    // Wait for the signal handlers to be set up
    await new Promise(resolve => setTimeout(resolve, 50));

    const error = new Error('Uncaught error');
    process.emit('uncaughtException', error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Uncaught Exception'), error);
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    
    // Clean up
    await mainPromise.catch(() => {});
  });

  it('should handle unhandled rejections', async () => {
    // Start main without awaiting to set up signal handlers
    const mainPromise = main();
    
    // Wait for the signal handlers to be set up
    await new Promise(resolve => setTimeout(resolve, 50));

    const reason = new Error('Unhandled rejection');
    const promise = Promise.reject(reason);
    promise.catch(() => {}); // Prevent actual unhandled rejection
    process.emit('unhandledRejection', reason, promise);

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

    await main();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Application failed to start'), error);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});