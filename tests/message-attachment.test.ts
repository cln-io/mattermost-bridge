import { createMessageAttachment } from '../src/message-attachment';
import { MattermostMessage, MattermostConfig } from '../src/types';

describe('createMessageAttachment', () => {
  let dateToLocaleTimeStringSpy: jest.SpyInstance;
  
  beforeAll(() => {
    // Mock toLocaleTimeString to return consistent results in 24-hour format
    dateToLocaleTimeStringSpy = jest.spyOn(Date.prototype, 'toLocaleTimeString')
      .mockImplementation(function(this: Date, locales, options) {
        // For 2024-01-15T14:30:00Z, return 14:30
        if (this.getTime() === new Date('2024-01-15T14:30:00Z').getTime()) {
          return '14:30';
        }
        // For 2024-01-15T09:15:00Z, return 09:15
        if (this.getTime() === new Date('2024-01-15T09:15:00Z').getTime()) {
          return '09:15';
        }
        // For 2024-01-15T00:00:00Z, return 00:00
        if (this.getTime() === new Date('2024-01-15T00:00:00Z').getTime()) {
          return '00:00';
        }
        // For 2024-01-15T23:45:00Z, return 23:45
        if (this.getTime() === new Date('2024-01-15T23:45:00Z').getTime()) {
          return '23:45';
        }
        // For 2024-01-15T12:00:00Z, return 12:00
        if (this.getTime() === new Date('2024-01-15T12:00:00Z').getTime()) {
          return '12:00';
        }
        // Default fallback
        return this.toISOString().substr(11, 5);
      });
  });
  
  afterAll(() => {
    dateToLocaleTimeStringSpy.mockRestore();
  });

  const sourceConfig: MattermostConfig = {
    name: 'SourceServer',
    server: 'https://source.mattermost.com',
    username: 'sourceuser',
    password: 'sourcepass',
    team: 'sourceteam'
  };

  const baseMessage: MattermostMessage = {
    id: 'msg123',
    channel_id: 'channel123',
    user_id: 'user123',
    message: 'Test message content',
    username: 'testuser',
    create_at: new Date('2024-01-15T14:30:00Z').getTime()
  };

  it('should create attachment with username only', () => {
    const attachment = createMessageAttachment(
      baseMessage,
      sourceConfig,
      'test-channel'
    );

    expect(attachment).toEqual({
      color: '#87CEEB',
      author_name: 'testuser',
      author_link: 'https://source.mattermost.com/sourceteam/pl/msg123',
      author_icon: undefined,
      text: 'Test message content',
      footer: 'SourceServer • #test-channel • 14:30',
      fallback: 'testuser in #test-channel: Test message content'
    });
  });

  it('should create attachment with nickname', () => {
    const messageWithNickname = {
      ...baseMessage,
      nickname: 'Test User'
    };

    const attachment = createMessageAttachment(
      messageWithNickname,
      sourceConfig,
      'test-channel'
    );

    expect(attachment.author_name).toBe('Test User - @testuser');
    expect(attachment.fallback).toBe('Test User - @testuser in #test-channel: Test message content');
  });

  it('should include profile picture URL if provided', () => {
    const attachment = createMessageAttachment(
      baseMessage,
      sourceConfig,
      'test-channel',
      'https://example.com/profile.png'
    );

    expect(attachment.author_icon).toBe('https://example.com/profile.png');
  });

  it('should include footer icon if provided', () => {
    const attachment = createMessageAttachment(
      baseMessage,
      sourceConfig,
      'test-channel',
      undefined,
      'https://example.com/footer.png'
    );

    expect(attachment.footer_icon).toBe('https://example.com/footer.png');
  });

  it('should include file attachment info in fallback', () => {
    const messageWithFiles = {
      ...baseMessage,
      file_ids: ['file1', 'file2', 'file3']
    };

    const attachment = createMessageAttachment(
      messageWithFiles,
      sourceConfig,
      'test-channel'
    );

    expect(attachment.fallback).toBe('testuser in #test-channel: Test message content [3 file(s)]');
  });

  it('should handle missing username', () => {
    const messageNoUsername = {
      ...baseMessage,
      username: undefined
    };

    const attachment = createMessageAttachment(
      messageNoUsername,
      sourceConfig,
      'test-channel'
    );

    expect(attachment.author_name).toBe('Unknown');
  });

  it('should handle empty nickname', () => {
    const messageEmptyNickname = {
      ...baseMessage,
      nickname: '   '
    };

    const attachment = createMessageAttachment(
      messageEmptyNickname,
      sourceConfig,
      'test-channel'
    );

    expect(attachment.author_name).toBe('testuser');
  });

  it('should generate correct link without team', () => {
    const configNoTeam = {
      ...sourceConfig,
      team: undefined
    };

    const attachment = createMessageAttachment(
      baseMessage,
      configNoTeam,
      'test-channel'
    );

    expect(attachment.author_link).toBe('https://source.mattermost.com/pl/msg123');
  });

  it('should handle server URL with trailing slash', () => {
    const configTrailingSlash = {
      ...sourceConfig,
      server: 'https://source.mattermost.com/'
    };

    const attachment = createMessageAttachment(
      baseMessage,
      configTrailingSlash,
      'test-channel'
    );

    expect(attachment.author_link).toBe('https://source.mattermost.com/sourceteam/pl/msg123');
  });

  it('should format time correctly for different hours', () => {
    // Test morning time
    const morningMessage = {
      ...baseMessage,
      create_at: new Date('2024-01-15T09:15:00Z').getTime()
    };
    let attachment = createMessageAttachment(morningMessage, sourceConfig, 'test-channel');
    expect(attachment.footer).toContain('09:15');

    // Test midnight
    const midnightMessage = {
      ...baseMessage,
      create_at: new Date('2024-01-15T00:00:00Z').getTime()
    };
    attachment = createMessageAttachment(midnightMessage, sourceConfig, 'test-channel');
    expect(attachment.footer).toContain('00:00');

    // Test noon
    const noonMessage = {
      ...baseMessage,
      create_at: new Date('2024-01-15T12:00:00Z').getTime()
    };
    attachment = createMessageAttachment(noonMessage, sourceConfig, 'test-channel');
    expect(attachment.footer).toContain('12:00');
  });
});