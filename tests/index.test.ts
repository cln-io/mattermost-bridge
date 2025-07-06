import { loadConfig } from '../src/config';
import { MattermostBridge } from '../src/bridge';

jest.mock('../src/config');
jest.mock('../src/bridge');

describe('index', () => {
  let mockBridge: jest.Mocked<MattermostBridge>;
  let processExitSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules(); // Reset module cache to ensure fresh import
    
    mockBridge = {
      start: jest.fn(),
      stop: jest.fn()
    } as any;

    (MattermostBridge as jest.MockedClass<typeof MattermostBridge>).mockImplementation(() => mockBridge);
    
    (loadConfig as jest.Mock).mockReturnValue({
      left: { name: 'Left' },
      right: { name: 'Right' },
      dryRun: false
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

    // Import will run the main function
    await import('../src/index');
    
    // Wait for the main function to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(loadConfig).toHaveBeenCalled();
    expect(MattermostBridge).toHaveBeenCalled();
    expect(mockBridge.start).toHaveBeenCalled();
  });

  it('should display dry run banner when enabled', async () => {
    (loadConfig as jest.Mock).mockReturnValue({
      left: { name: 'Left' },
      right: { name: 'Right' },
      dryRun: true
    });

    await import('../src/index');
    
    // Wait for the main function to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN MODE'));
  });

  it('should handle SIGINT gracefully', async () => {
    await import('../src/index');
    
    // Wait for the main function to complete and set up event handlers
    await new Promise(resolve => setImmediate(resolve));

    process.emit('SIGINT');

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should handle SIGTERM gracefully', async () => {
    await import('../src/index');
    
    // Wait for the main function to complete and set up event handlers
    await new Promise(resolve => setImmediate(resolve));

    process.emit('SIGTERM');

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should handle uncaught exceptions', async () => {
    await import('../src/index');
    
    // Wait for the main function to complete and set up event handlers
    await new Promise(resolve => setImmediate(resolve));

    const error = new Error('Uncaught error');
    process.emit('uncaughtException', error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Uncaught Exception'), error);
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle unhandled rejections', async () => {
    await import('../src/index');
    
    // Wait for the main function to complete and set up event handlers
    await new Promise(resolve => setImmediate(resolve));

    const reason = new Error('Unhandled rejection');
    const promise = Promise.reject(reason);
    process.emit('unhandledRejection', reason, promise);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled Rejection'),
      promise,
      'reason:',
      reason
    );
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle startup errors', async () => {
    const error = new Error('Startup failed');
    mockBridge.start.mockRejectedValue(error);

    await import('../src/index');
    
    // Wait for async operations
    await new Promise(resolve => setImmediate(resolve));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Application failed to start'), error);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});