import { MattermostBridge } from '../src/bridge';
import { MattermostClient } from '../src/mattermost-client';
import { HeartbeatService } from '../src/heartbeat-service';
import { Config, MattermostMessage, ChannelInfo } from '../src/types';
import { createMessageAttachment } from '../src/message-attachment';

jest.mock('../src/mattermost-client');
jest.mock('../src/heartbeat-service');
jest.mock('../src/message-attachment');

describe('MattermostBridge', () => {
  let bridge: MattermostBridge;
  let config: Config;
  let mockLeftClient: jest.Mocked<MattermostClient>;
  let mockRightClient: jest.Mocked<MattermostClient>;
  let mockHeartbeatService: jest.Mocked<HeartbeatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      left: {
        name: 'LeftServer',
        server: 'https://left.mattermost.com',
        username: 'leftuser',
        password: 'leftpass',
        team: 'leftteam'
      },
      right: {
        name: 'RightServer',
        server: 'https://right.mattermost.com',
        username: 'rightuser',
        password: 'rightpass',
        team: 'rightteam'
      },
      rule: {
        sourceChannelId: 'source123',
        targetChannelId: 'target456'
      },
      heartbeat: {
        url: 'https://heartbeat.example.com',
        intervalMinutes: 5
      },
      logging: {
        level: 'info',
        debugWebSocketEvents: false,
        eventSummaryIntervalMinutes: 10,
        updateDmChannelHeader: false,
        disableEmoji: false,
        timezone: 'UTC'
      },
      dryRun: false,
      dontForwardFor: ['@example.com'],
      footerIcon: 'https://icon.example.com/footer.png',
      leftMessageEmoji: 'envelope_with_arrow'
    };

    mockLeftClient = new MattermostClient(config.left, config.logging) as jest.Mocked<MattermostClient>;
    mockRightClient = new MattermostClient(config.right, config.logging) as jest.Mocked<MattermostClient>;
    mockHeartbeatService = new HeartbeatService(config.heartbeat) as jest.Mocked<HeartbeatService>;
    
    // Add missing mock methods
    mockRightClient.getStatusChannelId = jest.fn();
    mockRightClient.postMessage = jest.fn();
    mockRightClient.postOrUpdateBridgeSummary = jest.fn();
    mockLeftClient.addReaction = jest.fn();
    mockRightClient.addReaction = jest.fn();

    (MattermostClient as jest.MockedClass<typeof MattermostClient>).mockImplementation((cfg) => {
      if (cfg === config.left) return mockLeftClient;
      if (cfg === config.right) return mockRightClient;
      throw new Error('Unexpected config');
    });

    (HeartbeatService as jest.MockedClass<typeof HeartbeatService>).mockImplementation(() => mockHeartbeatService);

    bridge = new MattermostBridge(config);
  });

  afterEach(async () => {
    // Clean up any running timers
    if (bridge) {
      await bridge.stop();
    }
  });

  describe('start', () => {
    const sourceChannelInfo: ChannelInfo = {
      id: 'source123',
      name: 'source-channel',
      displayName: 'Source Channel',
      type: 'O'
    };

    const targetChannelInfo: ChannelInfo = {
      id: 'target456',
      name: 'target-channel',
      displayName: 'Target Channel',
      type: 'O'
    };

    beforeEach(() => {
      mockLeftClient.ping.mockResolvedValue();
      mockRightClient.ping.mockResolvedValue();
      mockLeftClient.login.mockResolvedValue();
      mockRightClient.login.mockResolvedValue();
      mockLeftClient.getChannelById.mockResolvedValue(sourceChannelInfo);
      mockRightClient.getChannelById.mockResolvedValue(targetChannelInfo);
      mockLeftClient.connectWebSocket.mockImplementation();
      mockHeartbeatService.start.mockImplementation();
    });

    it('should successfully start the bridge', async () => {
      await bridge.start();

      expect(mockLeftClient.ping).toHaveBeenCalled();
      expect(mockRightClient.ping).toHaveBeenCalled();
      expect(mockLeftClient.login).toHaveBeenCalled();
      expect(mockRightClient.login).toHaveBeenCalled();
      expect(mockLeftClient.getChannelById).toHaveBeenCalledWith('source123');
      expect(mockRightClient.getChannelById).toHaveBeenCalledWith('target456');
      expect(mockLeftClient.connectWebSocket).toHaveBeenCalledWith(
        'source123',
        expect.any(Function),
        'source-channel'
      );
      expect(mockHeartbeatService.start).toHaveBeenCalled();
    });

    it('should handle ping failure on left server', async () => {
      mockLeftClient.ping.mockRejectedValue(new Error('Connection failed'));

      await expect(bridge.start()).rejects.toThrow('Connection failed');
      expect(mockRightClient.ping).not.toHaveBeenCalled();
    });

    it('should handle ping failure on right server', async () => {
      mockRightClient.ping.mockRejectedValue(new Error('Connection failed'));

      await expect(bridge.start()).rejects.toThrow('Connection failed');
      expect(mockLeftClient.login).not.toHaveBeenCalled();
    });

    it('should handle login failure', async () => {
      mockLeftClient.login.mockRejectedValue(new Error('Auth failed'));

      await expect(bridge.start()).rejects.toThrow('Auth failed');
      expect(mockLeftClient.getChannelById).not.toHaveBeenCalled();
    });

    it('should handle source channel not found', async () => {
      mockLeftClient.getChannelById.mockResolvedValue(null);

      await expect(bridge.start()).rejects.toThrow("Source channel 'source123' not found on LeftServer");
    });

    it('should handle target channel not found', async () => {
      mockRightClient.getChannelById.mockResolvedValue(null);

      await expect(bridge.start()).rejects.toThrow("Target channel 'target456' not found on RightServer");
    });

    it('should log dry run mode when enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      bridge = new MattermostBridge({ ...config, dryRun: true });

      await bridge.start();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
    });
  });

  describe('handleMessage', () => {
    let handleMessage: (message: MattermostMessage) => Promise<void>;
    const mockMessage: MattermostMessage = {
      id: 'msg123',
      channel_id: 'source123',
      user_id: 'user123',
      message: 'Test message',
      username: 'testuser',
      nickname: 'Test User',
      create_at: Date.now(),
      file_ids: []
    };

    beforeEach(async () => {
      const sourceChannelInfo: ChannelInfo = {
        id: 'source123',
        name: 'source-channel',
        displayName: 'Source Channel',
        type: 'O'
      };

      const targetChannelInfo: ChannelInfo = {
        id: 'target456',
        name: 'target-channel',
        displayName: 'Target Channel',
        type: 'O'
      };

      mockLeftClient.ping.mockResolvedValue();
      mockRightClient.ping.mockResolvedValue();
      mockLeftClient.login.mockResolvedValue();
      mockRightClient.login.mockResolvedValue();
      mockLeftClient.getChannelById.mockResolvedValue(sourceChannelInfo);
      mockRightClient.getChannelById.mockResolvedValue(targetChannelInfo);
      mockHeartbeatService.start.mockImplementation();

      mockLeftClient.connectWebSocket.mockImplementation((channelId, onMsg) => {
        handleMessage = onMsg;
      });

      await bridge.start();
    });

    it('should bridge a simple message', async () => {
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com',
        nickname: 'Test User'
      });

      mockLeftClient.downloadProfilePicture.mockResolvedValue(Buffer.from('image'));
      mockRightClient.uploadProfilePicture.mockResolvedValue('https://right.com/profile.png');
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'Test User - @testuser',
        text: 'Test message'
      });

      mockRightClient.postMessageWithAttachment.mockResolvedValue();

      await handleMessage(mockMessage);

      expect(mockLeftClient.getUser).toHaveBeenCalledWith('user123');
      expect(mockLeftClient.downloadProfilePicture).toHaveBeenCalledWith('user123');
      expect(mockRightClient.uploadProfilePicture).toHaveBeenCalled();
      expect(mockRightClient.postMessageWithAttachment).toHaveBeenCalled();
    });

    it('should use cached profile picture on second message', async () => {
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });

      mockLeftClient.downloadProfilePicture.mockResolvedValue(Buffer.from('image'));
      mockRightClient.uploadProfilePicture.mockResolvedValue('https://right.com/profile.png');
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'testuser',
        text: 'Test message'
      });

      // First message
      await handleMessage(mockMessage);
      expect(mockLeftClient.downloadProfilePicture).toHaveBeenCalledTimes(1);

      // Second message from same user
      await handleMessage(mockMessage);
      expect(mockLeftClient.downloadProfilePicture).toHaveBeenCalledTimes(1); // Not called again
      expect(mockRightClient.uploadProfilePicture).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should exclude messages from filtered email domains', async () => {
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@example.com', // Matches excluded domain
        nickname: 'Test User'
      });

      await handleMessage(mockMessage);

      expect(mockRightClient.postMessageWithAttachment).not.toHaveBeenCalled();
    });

    it('should handle file attachments', async () => {
      const messageWithFiles: MattermostMessage = {
        ...mockMessage,
        file_ids: ['file1', 'file2']
      };

      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });

      mockLeftClient.downloadFile
        .mockResolvedValueOnce({ buffer: Buffer.from('file1'), filename: 'doc1.pdf' })
        .mockResolvedValueOnce({ buffer: Buffer.from('file2'), filename: 'doc2.pdf' });

      mockRightClient.uploadMultipleFiles.mockResolvedValue(['newfile1', 'newfile2']);
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'testuser',
        text: 'Test message'
      });

      await handleMessage(messageWithFiles);

      expect(mockLeftClient.downloadFile).toHaveBeenCalledWith('file1');
      expect(mockLeftClient.downloadFile).toHaveBeenCalledWith('file2');
      expect(mockRightClient.uploadMultipleFiles).toHaveBeenCalledWith(
        [
          { buffer: Buffer.from('file1'), filename: 'doc1.pdf' },
          { buffer: Buffer.from('file2'), filename: 'doc2.pdf' }
        ],
        'target456'
      );
      expect(mockRightClient.postMessageWithAttachment).toHaveBeenCalledWith(
        'target456',
        '',
        expect.any(Object),
        ['newfile1', 'newfile2']
      );
    });

    it('should handle dry run mode', async () => {
      bridge = new MattermostBridge({ ...config, dryRun: true });
      
      // Re-setup with dry run bridge
      mockLeftClient.connectWebSocket.mockImplementation((channelId, onMsg) => {
        handleMessage = onMsg;
      });
      await bridge.start();

      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });

      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'testuser',
        text: 'Test message',
        footer: 'LeftServer • #source-channel • 12:00 PM',
        footer_icon: 'https://icon.example.com/footer.png'
      });

      const consoleSpy = jest.spyOn(console, 'log');

      await handleMessage(mockMessage);

      expect(mockRightClient.postMessageWithAttachment).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
    });

    it('should handle profile picture download failure', async () => {
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });

      mockLeftClient.downloadProfilePicture.mockResolvedValue(null);
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'testuser',
        text: 'Test message'
      });

      await handleMessage(mockMessage);

      expect(mockRightClient.uploadProfilePicture).not.toHaveBeenCalled();
      expect(createMessageAttachment).toHaveBeenCalledWith(
        mockMessage,
        config.left,
        'source-channel',
        undefined, // No profile picture URL
        'https://icon.example.com/footer.png',
        config
      );
    });

    it('should add emoji reaction to original message after bridging', async () => {
      const handleMessage = (bridge as any).handleMessage.bind(bridge);
      
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'user@domain.com',
        nickname: 'Test User'
      });
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'Test User - @testuser',
        text: 'Test message'
      });

      await handleMessage(mockMessage);

      expect(mockLeftClient.addReaction).toHaveBeenCalledWith('msg123', 'envelope_with_arrow');
      expect(mockRightClient.postMessageWithAttachment).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockLeftClient.getUser.mockRejectedValue(new Error('User fetch failed'));
      const consoleSpy = jest.spyOn(console, 'error');

      await handleMessage(mockMessage);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error bridging message'),
        expect.any(Error)
      );
      expect(mockRightClient.postMessageWithAttachment).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop all services and clear cache', async () => {
      const consoleSpy = jest.spyOn(console, 'log');

      await bridge.stop();

      expect(mockHeartbeatService.stop).toHaveBeenCalled();
      expect(mockLeftClient.disconnect).toHaveBeenCalled();
      expect(mockRightClient.disconnect).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared profile picture cache'));
    });
  });

  describe('centralized event tracking', () => {
    beforeEach(async () => {
      const sourceChannelInfo: ChannelInfo = {
        id: 'source123',
        name: 'source-channel',
        displayName: 'Source Channel',
        type: 'O'
      };

      const targetChannelInfo: ChannelInfo = {
        id: 'target456',
        name: 'target-channel',
        displayName: 'Target Channel',
        type: 'O'
      };

      mockLeftClient.ping.mockResolvedValue();
      mockRightClient.ping.mockResolvedValue();
      mockLeftClient.login.mockResolvedValue();
      mockRightClient.login.mockResolvedValue();
      mockLeftClient.getChannelById.mockResolvedValue(sourceChannelInfo);
      mockRightClient.getChannelById.mockResolvedValue(targetChannelInfo);
      mockHeartbeatService.start.mockImplementation();
      mockLeftClient.connectWebSocket.mockImplementation();
      
      // Mock for getStatusChannelId
      mockRightClient.getStatusChannelId.mockResolvedValue('status123');
      mockRightClient.postMessage.mockResolvedValue(undefined);
      mockRightClient.postOrUpdateBridgeSummary.mockResolvedValue(undefined);
    });

    it('should start centralized event summary timer on bridge start', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      
      await bridge.start();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting centralized event summary')
      );
    });

    it('should track left client events via callback', async () => {
      let eventCallback: ((eventType: string) => void) | undefined;
      
      // Capture the event callback passed to left client
      (MattermostClient as jest.MockedClass<typeof MattermostClient>).mockImplementation((cfg, logging, isDest, callback) => {
        if (cfg === config.left) {
          eventCallback = callback;
          return mockLeftClient;
        }
        return mockRightClient;
      });
      
      bridge = new MattermostBridge(config);
      
      expect(eventCallback).toBeDefined();
      
      // Test that callback tracks events (we can't directly test private methods)
      if (eventCallback) {
        eventCallback('hello');
        eventCallback('posted');
        // These calls should work without throwing
      }
    });

    it('should handle bridge event tracking', async () => {
      const mockMessage: MattermostMessage = {
        id: 'msg123',
        channel_id: 'source123',
        user_id: 'user123',
        message: 'Test message',
        username: 'testuser',
        create_at: Date.now(),
        file_ids: []
      };

      let handleMessage: (message: MattermostMessage) => Promise<void>;
      
      mockLeftClient.connectWebSocket.mockImplementation((channelId, onMsg) => {
        handleMessage = onMsg;
      });
      
      await bridge.start();
      
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });
      
      mockLeftClient.downloadProfilePicture.mockResolvedValue(Buffer.from('image'));
      mockRightClient.uploadProfilePicture.mockResolvedValue('https://right.com/profile.png');
      
      (createMessageAttachment as jest.Mock).mockReturnValue({
        color: '#87CEEB',
        author_name: 'testuser',
        text: 'Test message'
      });
      
      mockRightClient.postMessageWithAttachment.mockResolvedValue();
      
      await handleMessage!(mockMessage);
      
      // Verify that bridge events would be tracked (message_bridged event)
      expect(mockRightClient.postMessageWithAttachment).toHaveBeenCalled();
    });

    it('should handle dry run event tracking', async () => {
      const dryRunBridge = new MattermostBridge({ ...config, dryRun: true });
      
      const mockMessage: MattermostMessage = {
        id: 'msg123',
        channel_id: 'source123',
        user_id: 'user123',
        message: 'Test message',
        username: 'testuser',
        create_at: Date.now(),
        file_ids: []
      };

      let handleMessage: (message: MattermostMessage) => Promise<void>;
      
      mockLeftClient.connectWebSocket.mockImplementation((channelId, onMsg) => {
        handleMessage = onMsg;
      });
      
      await dryRunBridge.start();
      
      mockLeftClient.getUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
        email: 'testuser@allowed.com'
      });
      
      const consoleSpy = jest.spyOn(console, 'log');
      
      await handleMessage!(mockMessage);
      
      // Verify dry run logging and that bridge events would be tracked (message_dry_run event)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
    });

    it('should update existing bridge summary messages instead of creating new ones', async () => {
      await bridge.start();
      
      // Create a mock for the logEventSummary method by triggering it manually
      // We can't directly access private methods, but we can test the flow through the timer
      
      // Verify that the bridge uses postOrUpdateBridgeSummary instead of postMessage
      const logEventSummary = (bridge as any).logEventSummary;
      if (logEventSummary) {
        await logEventSummary.call(bridge);
        
        // Should use the update method, not create new messages
        expect(mockRightClient.postOrUpdateBridgeSummary).toHaveBeenCalled();
      }
    });
  });
});