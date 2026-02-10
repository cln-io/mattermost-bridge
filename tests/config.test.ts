import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

jest.mock('fs');
jest.mock('dotenv');

describe('loadConfig', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockDotenv = dotenv as jest.Mocked<typeof dotenv>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules(); // Reset module cache to ensure fresh import
    // Clear all environment variables
    Object.keys(process.env).forEach(key => delete process.env[key]);
  });

  const setRequiredEnvVars = () => {
    process.env.MATTERMOST_LEFT_NAME = 'LeftServer';
    process.env.MATTERMOST_LEFT_SERVER = 'https://left.example.com';
    process.env.MATTERMOST_LEFT_USERNAME = 'leftuser';
    process.env.MATTERMOST_LEFT_PASSWORD_B64 = Buffer.from('leftpass').toString('base64');
    process.env.MATTERMOST_LEFT_TEAM = 'leftteam';
    process.env.MATTERMOST_RIGHT_NAME = 'RightServer';
    process.env.MATTERMOST_RIGHT_SERVER = 'https://right.example.com';
    process.env.MATTERMOST_RIGHT_USERNAME = 'rightuser';
    process.env.MATTERMOST_RIGHT_PASSWORD_B64 = Buffer.from('rightpass').toString('base64');
    process.env.SOURCE_CHANNEL_ID = 'source123';
    process.env.TARGET_CHANNEL_ID = 'target456';
  };

  it('should load configuration from .env.local if it exists', () => {
    mockFs.existsSync.mockImplementation(path => path.toString().includes('.env.local'));
    mockDotenv.config.mockImplementation();
    setRequiredEnvVars();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    // Verify the configuration is loaded correctly
    expect(config.left.password).toBe('leftpass');
    expect(config.right.password).toBe('rightpass');
    expect(config.left.name).toBe('LeftServer');
  });

  it('should load configuration from .env if .env.local does not exist', () => {
    mockFs.existsSync.mockImplementation(path => !path.toString().includes('.env.local') && path.toString().includes('.env'));
    mockDotenv.config.mockImplementation();
    setRequiredEnvVars();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    // Verify the configuration is loaded correctly
    expect(config.left.name).toBe('LeftServer');
    expect(config.right.name).toBe('RightServer');
  });

  it('should load configuration from environment variables if no .env files exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockDotenv.config.mockImplementation();
    setRequiredEnvVars();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    // Verify the configuration is loaded correctly
    expect(config).toBeDefined();
    expect(config.left.name).toBe('LeftServer');
    expect(config.right.name).toBe('RightServer');
  });

  it('should throw error for missing required environment variables', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockDotenv.config.mockImplementation();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    expect(() => loadConfig()).toThrow('Missing required environment variable: MATTERMOST_LEFT_NAME');
  });

  it('should decode base64 passwords correctly', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    
    const complexPassword = 'Complex!@#$%^&*()Password123';
    process.env.MATTERMOST_LEFT_PASSWORD_B64 = Buffer.from(complexPassword).toString('base64');

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.left.password).toBe(complexPassword);
  });

  it('should parse optional configurations correctly', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    
    process.env.HEARTBEAT_URL = 'https://heartbeat.example.com';
    process.env.HEARTBEAT_INTERVAL_MINUTES = '15';
    process.env.LOG_LEVEL = 'debug';
    process.env.DEBUG_WEBSOCKET_EVENTS = 'true';
    process.env.EVENT_SUMMARY_INTERVAL_MINUTES = '5';
    process.env.STATS_CHANNEL_UPDATES = 'summary';
    process.env.DRY_RUN = 'true';
    process.env.DONT_FORWARD_FOR = '@example.com,@test.com, @spaces.com ';
    process.env.FOOTER_ICON = 'https://icon.example.com/footer.png';
    process.env.MATTERMOST_LEFT_MFA_SEED = 'JBSWY3DPEHPK3PXP';
    process.env.MATTERMOST_RIGHT_MFA_SEED = 'GEZDGNBVGY3TQOJQ';
    process.env.TIMEZONE = 'Europe/Brussels';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.heartbeat.url).toBe('https://heartbeat.example.com');
    expect(config.heartbeat.intervalMinutes).toBe(15);
    expect(config.logging.level).toBe('debug');
    expect(config.logging.debugWebSocketEvents).toBe(true);
    expect(config.logging.eventSummaryIntervalMinutes).toBe(5);
    expect(config.logging.statsChannelUpdates).toBe('summary');
    expect(config.logging.disableEmoji).toBe(false);
    expect(config.logging.timezone).toBe('Europe/Brussels');
    expect(config.dryRun).toBe(true);
    expect(config.dontForwardFor).toEqual(['@example.com', '@test.com', '@spaces.com']);
    expect(config.footerIcon).toBe('https://icon.example.com/footer.png');
    expect(config.left.mfaSeed).toBe('JBSWY3DPEHPK3PXP');
    expect(config.right.mfaSeed).toBe('GEZDGNBVGY3TQOJQ');
  });

  it('should use default values for optional configurations', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.heartbeat.url).toBeUndefined();
    expect(config.heartbeat.intervalMinutes).toBe(15);
    expect(config.logging.level).toBe('info');
    expect(config.logging.debugWebSocketEvents).toBe(false);
    expect(config.logging.eventSummaryIntervalMinutes).toBe(10);
    expect(config.logging.statsChannelUpdates).toBe('none');
    expect(config.logging.disableEmoji).toBe(false);
    expect(config.logging.timezone).toBe('UTC');
    expect(config.dryRun).toBe(false);
    expect(config.dontForwardFor).toEqual([]);
    expect(config.footerIcon).toBeUndefined();
    expect(config.leftMessageEmoji).toBeUndefined();
  });

  it('should handle empty FOOTER_ICON environment variable', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.FOOTER_ICON = '   '; // Whitespace only

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.footerIcon).toBeUndefined();
  });

  it('should parse DISABLE_EMOJI environment variable', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.DISABLE_EMOJI = 'true';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.logging.disableEmoji).toBe(true);
    expect(config.logging.timezone).toBe('UTC');
  });

  it('should parse TIMEZONE environment variable', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.TIMEZONE = 'Europe/Brussels';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.logging.timezone).toBe('Europe/Brussels');
  });

  it('should parse LEFT_MESSAGE_EMOJI environment variable', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.LEFT_MESSAGE_EMOJI = 'white_check_mark';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.leftMessageEmoji).toBe('white_check_mark');
  });

  it('should parse SOURCE_CHANNEL_ID as a single string', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.SOURCE_CHANNEL_ID = 'single123';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.rule.sourceChannelId).toBe('single123');
  });

  it('should parse SOURCE_CHANNEL_ID as an array when comma-separated', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.SOURCE_CHANNEL_ID = 'channel1,channel2,channel3';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.rule.sourceChannelId).toEqual(['channel1', 'channel2', 'channel3']);
  });

  it('should handle SOURCE_CHANNEL_ID with spaces around commas', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.SOURCE_CHANNEL_ID = 'channel1, channel2 , channel3';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.rule.sourceChannelId).toEqual(['channel1', 'channel2', 'channel3']);
  });

  it('should filter out empty channel IDs', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.SOURCE_CHANNEL_ID = 'channel1,,channel2, ,channel3';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.rule.sourceChannelId).toEqual(['channel1', 'channel2', 'channel3']);
  });

  it('should parse REQUEST_ACKNOWLEDGEMENT as false by default', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.requestAcknowledgement).toBe(false);
  });

  it('should parse REQUEST_ACKNOWLEDGEMENT environment variable as true', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.REQUEST_ACKNOWLEDGEMENT = 'true';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.requestAcknowledgement).toBe(true);
  });

  it('should parse REQUEST_ACKNOWLEDGEMENT environment variable as false', () => {
    mockFs.existsSync.mockReturnValue(false);
    setRequiredEnvVars();
    process.env.REQUEST_ACKNOWLEDGEMENT = 'false';

    // Import after setting up mocks
    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    expect(config.requestAcknowledgement).toBe(false);
  });
});