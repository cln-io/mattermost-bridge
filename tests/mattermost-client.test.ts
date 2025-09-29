import { MattermostClient } from '../src/mattermost-client';
import { MattermostConfig, LoggingConfig } from '../src/types';
import axios from 'axios';
import WebSocket from 'ws';
import { authenticator } from 'otplib';
import FormData from 'form-data';

jest.mock('axios');
jest.mock('ws');
jest.mock('otplib');
jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
  }));
});

describe('MattermostClient', () => {
  let client: MattermostClient;
  let config: MattermostConfig;
  let loggingConfig: LoggingConfig;
  let mockAxiosInstance: any;
  let mockWs: jest.Mocked<WebSocket>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      name: 'TestServer',
      server: 'https://test.mattermost.com',
      username: 'testuser',
      password: 'testpass',
      team: 'testteam'
    };

    loggingConfig = {
      level: 'info',
      debugWebSocketEvents: false,
      eventSummaryIntervalMinutes: 10,
      statsChannelUpdates: 'none' as const,
      disableEmoji: false,
      timezone: 'UTC'
    };

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      defaults: { headers: { common: {} } }
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
    
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    (WebSocket as jest.MockedClass<typeof WebSocket>).mockImplementation(() => mockWs);

    client = new MattermostClient(config, loggingConfig);
  });

  describe('constructor', () => {
    it('should normalize server URL', () => {
      config.server = 'https://test.mattermost.com/';
      client = new MattermostClient(config, loggingConfig);

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://test.mattermost.com/api/v4',
        timeout: 10000
      });
    });

    it('should throw error for invalid server URL', () => {
      config.server = 'invalid-url';

      expect(() => new MattermostClient(config, loggingConfig)).toThrow('Invalid server URL format');
    });
  });

  describe('ping', () => {
    it('should successfully ping server', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 200 });

      await client.ping();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/system/ping');
    });

    it('should handle ping failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(client.ping()).rejects.toThrow('Cannot reach TestServer');
    });
  });

  describe('login', () => {
    it('should login without MFA', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });

      await client.login();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/users/login', {
        login_id: 'testuser',
        password: 'testpass'
      });
      expect(mockAxiosInstance.defaults.headers.common['Authorization']).toBe('Bearer auth-token');
    });

    it('should login with MFA', async () => {
      config.mfaSeed = 'JBSWY3DPEHPK3PXP';
      client = new MattermostClient(config, loggingConfig);
      
      (authenticator.generate as jest.Mock).mockReturnValue('123456');
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });

      await client.login();

      expect(authenticator.generate).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/users/login', {
        login_id: 'testuser',
        password: 'testpass',
        token: '123456'
      });
    });

    it('should handle MFA generation failure', async () => {
      config.mfaSeed = 'INVALID_SEED';
      client = new MattermostClient(config, loggingConfig);
      
      (authenticator.generate as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid seed');
      });

      await expect(client.login()).rejects.toThrow('Failed to generate TOTP code');
    });

    it('should handle login failure', async () => {
      const error = new Error('Login failed') as any;
      error.response = { status: 401, data: { message: 'Invalid credentials' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(client.login()).rejects.toThrow('Login failed');
    });
  });

  describe('channel operations', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });
      await client.login();
    });

    it('should get channel by ID', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          id: 'channel123',
          name: 'test-channel',
          display_name: 'Test Channel',
          type: 'O'
        }
      });

      const channel = await client.getChannelById('channel123');

      expect(channel).toEqual({
        id: 'channel123',
        name: 'test-channel',
        displayName: 'Test Channel',
        type: 'O'
      });
    });

    it('should return null for non-existent channel', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 404 }
      });

      const channel = await client.getChannelById('nonexistent');

      expect(channel).toBeNull();
    });

    it('should get channel by name', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: [{ id: 'team123' }] })
        .mockResolvedValueOnce({
          data: {
            id: 'channel123',
            name: 'test-channel',
            display_name: 'Test Channel'
          }
        });

      const channel = await client.getChannelByName('test-channel');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/users/me/teams');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/teams/team123/channels/name/test-channel');
      expect(channel).toBeDefined();
    });

    it('should update channel header', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: {} });

      await client.updateChannelHeader('channel123', 'New header text');

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/channels/channel123', {
        header: 'New header text'
      });
    });

    it('should handle channel header update failure', async () => {
      const error = new Error('Update failed') as any;
      error.response = { data: { message: 'Permission denied' } };
      mockAxiosInstance.patch.mockRejectedValue(error);

      await expect(client.updateChannelHeader('channel123', 'New header')).rejects.toThrow('Update failed');
    });
  });

  describe('message operations', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });
      await client.login();
    });

    it('should post a simple message', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'post123' } });

      await client.postMessage('channel123', 'Test message');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/posts', {
        channel_id: 'channel123',
        message: 'Test message'
      });
    });

    it('should post message with attachment', async () => {
      const attachment = {
        color: '#87CEEB',
        author_name: 'Test User',
        text: 'Test message'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'post123' } });

      await client.postMessageWithAttachment('channel123', '', attachment, ['file1', 'file2']);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/posts', {
        channel_id: 'channel123',
        message: '',
        props: { attachments: [attachment] },
        file_ids: ['file1', 'file2']
      });
    });
  });

  describe('user operations', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });
      await client.login();
    });

    it('should get user details', async () => {
      const userData = {
        id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        nickname: 'Test User'
      };
      mockAxiosInstance.get.mockResolvedValue({ data: userData });

      const user = await client.getUser('user123');

      expect(user).toEqual(userData);
    });

    it('should generate user profile picture URL', () => {
      const url = client.getUserProfilePictureUrl('user123');

      expect(url).toBe('https://test.mattermost.com/api/v4/users/user123/image');
    });

    it('should download profile picture', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      mockAxiosInstance.get.mockResolvedValue({ data: imageBuffer });

      const result = await client.downloadProfilePicture('user123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/users/user123/image', {
        responseType: 'arraybuffer'
      });
      expect(result).toEqual(imageBuffer);
    });

    it('should handle profile picture download failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

      const result = await client.downloadProfilePicture('user123');

      expect(result).toBeNull();
    });
  });

  describe('file operations', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });
      await client.login();
    });

    it('should upload file', async () => {
      const fileBuffer = Buffer.from('file-content');
      const mockAppend = jest.fn();
      const mockGetHeaders = jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' });
      
      (FormData as jest.MockedClass<typeof FormData>).mockImplementation(() => ({
        append: mockAppend,
        getHeaders: mockGetHeaders
      } as any));
      
      mockAxiosInstance.post.mockResolvedValue({
        data: { file_infos: [{ id: 'file123' }] }
      });

      const fileId = await client.uploadFile(fileBuffer, 'test.txt', 'channel123');

      expect(FormData).toHaveBeenCalled();
      expect(mockAppend).toHaveBeenCalledWith('files', fileBuffer, 'test.txt');
      expect(mockAppend).toHaveBeenCalledWith('channel_id', 'channel123');
      expect(fileId).toBe('file123');
    });

    it('should download file', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { name: 'test.txt' } })
        .mockResolvedValueOnce({ data: Buffer.from('file-content') });

      const result = await client.downloadFile('file123');

      expect(result).toEqual({
        buffer: Buffer.from('file-content'),
        filename: 'test.txt'
      });
    });

    it('should upload multiple files', async () => {
      const files = [
        { buffer: Buffer.from('file1'), filename: 'file1.txt' },
        { buffer: Buffer.from('file2'), filename: 'file2.txt' }
      ];

      mockAxiosInstance.post.mockResolvedValue({
        data: { file_infos: [{ id: 'file123' }] }
      });

      const fileIds = await client.uploadMultipleFiles(files, 'channel123');

      expect(fileIds).toEqual(['file123', 'file123']);
    });
  });

  describe('WebSocket operations', () => {
    let onMessage: jest.Mock;
    let wsOpenHandler: () => void;
    let wsMessageHandler: (data: any) => void;
    let wsErrorHandler: (error: Error) => void;
    let wsCloseHandler: () => void;

    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        headers: { token: 'auth-token' },
        data: { id: 'user123', username: 'testuser' }
      });
      await client.login();

      onMessage = jest.fn();
      
      mockWs.on.mockImplementation((event, handler) => {
        if (event === 'open') wsOpenHandler = handler;
        if (event === 'message') wsMessageHandler = handler;
        if (event === 'error') wsErrorHandler = handler;
        if (event === 'close') wsCloseHandler = handler;
        return mockWs;
      });

      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should connect WebSocket and authenticate', () => {
      client.connectWebSocket('channel123', onMessage);

      // Expect browser-like options passed to WebSocket constructor
      expect(WebSocket).toHaveBeenCalledWith(
        'wss://test.mattermost.com/api/v4/websocket',
        undefined,
        expect.objectContaining({
          headers: expect.any(Object)
        })
      );

      // Trigger open event
      wsOpenHandler();

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        seq: 1,
        action: 'authentication_challenge',
        data: { token: 'auth-token' }
      }));
    });

    it('should handle posted messages for monitored channel', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { id: 'user123', username: 'testuser', nickname: 'Test User' }
      });

      client.connectWebSocket('channel123', onMessage);
      wsOpenHandler();

      const postEvent = {
        event: 'posted',
        data: {
          post: JSON.stringify({
            id: 'post123',
            channel_id: 'channel123',
            user_id: 'user123',
            message: 'Test message',
            create_at: Date.now()
          })
        }
      };

      await wsMessageHandler(JSON.stringify(postEvent));

      expect(onMessage).toHaveBeenCalledWith({
        id: 'post123',
        channel_id: 'channel123',
        user_id: 'user123',
        message: 'Test message',
        username: 'testuser',
        nickname: 'Test User',
        create_at: expect.any(Number),
        file_ids: []
      });
    });

    it('should ignore messages from other channels', async () => {
      client.connectWebSocket('channel123', onMessage);
      wsOpenHandler();

      const postEvent = {
        event: 'posted',
        data: {
          post: JSON.stringify({
            id: 'post123',
            channel_id: 'other-channel',
            user_id: 'user123',
            message: 'Test message'
          })
        }
      };

      await wsMessageHandler(JSON.stringify(postEvent));

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should support monitoring multiple channels', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { id: 'user123', username: 'testuser', nickname: 'Test User' }
      });

      client.connectWebSocket(['channel1', 'channel2', 'channel3'], onMessage);
      wsOpenHandler();

      // Message from channel1 - should be processed
      const message1 = {
        event: 'posted',
        data: {
          post: JSON.stringify({
            id: 'msg1',
            channel_id: 'channel1',
            user_id: 'user123',
            message: 'Message 1',
            create_at: Date.now()
          })
        }
      };

      await wsMessageHandler(JSON.stringify(message1));
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
        id: 'msg1',
        channel_id: 'channel1'
      }));

      // Message from channel2 - should be processed
      const message2 = {
        event: 'posted',
        data: {
          post: JSON.stringify({
            id: 'msg2',
            channel_id: 'channel2',
            user_id: 'user123',
            message: 'Message 2',
            create_at: Date.now()
          })
        }
      };

      await wsMessageHandler(JSON.stringify(message2));
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
        id: 'msg2',
        channel_id: 'channel2'
      }));

      // Message from unmonitored channel - should be ignored
      const message4 = {
        event: 'posted',
        data: {
          post: JSON.stringify({
            id: 'msg4',
            channel_id: 'channel4',
            user_id: 'user123',
            message: 'Message 4',
            create_at: Date.now()
          })
        }
      };

      onMessage.mockClear();
      await wsMessageHandler(JSON.stringify(message4));
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should handle WebSocket errors', () => {
      const consoleSpy = jest.spyOn(console, 'error');
      client.connectWebSocket('channel123', onMessage);

      const error = new Error('WebSocket error');
      wsErrorHandler(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket error'),
        error
      );
    });

    it('should reconnect on close', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const randomSpy = jest.spyOn(global.Math, 'random').mockReturnValue(0);
      client.connectWebSocket('channel123', onMessage);

      // Trigger the close handler
      await wsCloseHandler();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WebSocket CLOSED'));

      // Fast forward 5 seconds (no jitter due to mocked Math.random)
      jest.advanceTimersByTime(5000);

      // We use unlimited reconnects now; label is ∞
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Will reconnect (attempt 1/'));
      expect(WebSocket).toHaveBeenCalledTimes(2);
      randomSpy.mockRestore();
    });


    it('should handle debug mode for WebSocket events', () => {
      loggingConfig.debugWebSocketEvents = true;
      client = new MattermostClient(config, loggingConfig);
      
      const consoleSpy = jest.spyOn(console, 'log');
      
      client.connectWebSocket('channel123', onMessage);
      wsOpenHandler();

      wsMessageHandler(JSON.stringify({
        event: 'status_change',
        data: { user_id: 'user123', status: 'online' }
      }));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Raw WebSocket event'),
        expect.any(String)
      );
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket connection', async () => {
      client.connectWebSocket('channel123', jest.fn());
      await client.disconnect();

      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('addReaction', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { id: 'user123' },
        headers: { token: 'test-token' }
      });
      await client.login();
    });

    it('should add emoji reaction to message', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await client.addReaction('post123', 'thumbsup');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/reactions', {
        post_id: 'post123',
        emoji_name: 'thumbsup',
        user_id: 'user123'
      });
    });

    it('should handle reaction API errors gracefully', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('API Error'));
      const consoleSpy = jest.spyOn(console, 'error');

      await client.addReaction('post123', 'thumbsup');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to add reaction'),
        'API Error'
      );
    });
  });
});
