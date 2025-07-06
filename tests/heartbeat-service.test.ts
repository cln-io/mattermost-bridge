import { HeartbeatService } from '../src/heartbeat-service';
import { HeartbeatConfig } from '../src/types';
import axios from 'axios';

jest.mock('axios');

describe('HeartbeatService', () => {
  let service: HeartbeatService;
  let config: HeartbeatConfig;
  const mockAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    config = {
      url: 'https://heartbeat.example.com',
      intervalMinutes: 5
    };
    
    service = new HeartbeatService(config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('should start heartbeat service and send initial heartbeat', () => {
      mockAxios.get.mockResolvedValue({ status: 200 });
      const consoleSpy = jest.spyOn(console, 'log');

      service.start();

      expect(mockAxios.get).toHaveBeenCalledWith('https://heartbeat.example.com', {
        timeout: 10000,
        headers: { 'User-Agent': 'Mattermost-Bridge-Heartbeat/1.0' }
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Starting heartbeat service'));
    });

    it('should not start if no URL is configured', () => {
      service = new HeartbeatService({ intervalMinutes: 5 });
      const consoleSpy = jest.spyOn(console, 'log');

      service.start();

      expect(mockAxios.get).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No heartbeat URL configured'));
    });

    it('should not start if already active', () => {
      mockAxios.get.mockResolvedValue({ status: 200 });
      const consoleSpy = jest.spyOn(console, 'log');

      service.start();
      service.start();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already running'));
    });

    it('should schedule periodic heartbeats', async () => {
      mockAxios.get.mockResolvedValue({ status: 200 });

      service.start();
      expect(mockAxios.get).toHaveBeenCalledTimes(1);

      // Fast forward 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();

      expect(mockAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('should stop heartbeat service', () => {
      mockAxios.get.mockResolvedValue({ status: 200 });
      const consoleSpy = jest.spyOn(console, 'log');

      service.start();
      service.stop();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Stopping heartbeat service'));
      
      // Verify no more heartbeats after stopping
      jest.advanceTimersByTime(10 * 60 * 1000);
      expect(mockAxios.get).toHaveBeenCalledTimes(1); // Only initial heartbeat
    });

    it('should not log if not active', () => {
      const consoleSpy = jest.spyOn(console, 'log');

      service.stop();

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendHeartbeat', () => {
    beforeEach(() => {
      service.start();
    });

    it('should handle successful heartbeat', async () => {
      mockAxios.get.mockResolvedValue({ status: 200 });
      const consoleSpy = jest.spyOn(console, 'log');

      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Heartbeat #2 sent'));
    });

    it('should handle non-200 status', async () => {
      mockAxios.get.mockResolvedValue({ status: 404 });
      const consoleSpy = jest.spyOn(console, 'warn');

      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('failed with status 404'));
    });

    it('should handle network errors', async () => {
      const error = new Error('Network error');
      (error as any).code = 'ECONNREFUSED';
      mockAxios.get.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error');

      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Heartbeat #2 failed'), 'Network error');
    });
  });

  describe('getStatus', () => {
    it('should return status when active', () => {
      service.start();
      
      const status = service.getStatus();

      expect(status).toEqual({
        active: true,
        url: 'https://heartbeat.example.com',
        intervalMinutes: 5,
        heartbeatCount: 1,
        nextHeartbeatTime: expect.any(String)
      });
    });

    it('should return status when inactive', () => {
      const status = service.getStatus();

      expect(status).toEqual({
        active: false,
        url: 'https://heartbeat.example.com',
        intervalMinutes: 5,
        heartbeatCount: 0,
        nextHeartbeatTime: null
      });
    });
  });
});