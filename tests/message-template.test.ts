import { applyTemplate } from '../src/message-template';
import { MattermostMessage, MattermostConfig } from '../src/types';

describe('applyTemplate', () => {
  const sourceConfig: MattermostConfig = {
    name: 'TestServer',
    server: 'https://test.mattermost.com',
    username: 'testuser',
    password: 'testpass',
    team: 'testteam'
  };

  const message: MattermostMessage = {
    id: 'msg123',
    channel_id: 'channel123',
    user_id: 'user123',
    message: 'Hello, this is a test message!',
    username: 'johndoe',
    create_at: new Date('2024-01-15T10:30:00Z').getTime()
  };

  it('should replace all template variables', () => {
    const template = '{{username}} said: {{message}} [{{link}}]';
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toBe('johndoe said: Hello, this is a test message! [https://test.mattermost.com/testteam/pl/msg123]');
  });

  it('should handle newline escape sequences', () => {
    const template = 'From: {{username}}\\nMessage: {{message}}\\nTime: {{timestamp}}';
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toContain('From: johndoe\n');
    expect(result).toContain('Message: Hello, this is a test message!\n');
    expect(result).toContain('Time: 01/15/2024, 10:30:00');
  });

  it('should handle missing username', () => {
    const messageNoUsername = { ...message, username: undefined };
    const template = 'User: {{username}}';
    const result = applyTemplate(template, messageNoUsername, sourceConfig);

    expect(result).toBe('User: Unknown');
  });

  it('should include source name', () => {
    const template = '[{{source_name}}] {{message}}';
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toBe('[TestServer] Hello, this is a test message!');
  });

  it('should handle server without team', () => {
    const configNoTeam = { ...sourceConfig, team: undefined };
    const template = 'Link: {{link}}';
    const result = applyTemplate(template, message, configNoTeam);

    expect(result).toBe('Link: https://test.mattermost.com/pl/msg123');
  });

  it('should handle server URL with trailing slashes', () => {
    const configWithSlash = { ...sourceConfig, server: 'https://test.mattermost.com///' };
    const template = '{{link}}';
    const result = applyTemplate(template, message, configWithSlash);

    expect(result).toBe('https://test.mattermost.com/testteam/pl/msg123');
  });

  it('should handle all variables in complex template', () => {
    const template = `**{{username}}** (ID: {{user_id}})\\nMessage: "{{message}}"\\nPosted at: {{timestamp}}\\nView: {{link}}\\nServer: {{source_name}}`;
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toContain('**johndoe** (ID: user123)');
    expect(result).toContain('\nMessage: "Hello, this is a test message!"');
    expect(result).toContain('\nPosted at: 01/15/2024, 10:30:00');
    expect(result).toContain('\nView: https://test.mattermost.com/testteam/pl/msg123');
    expect(result).toContain('\nServer: TestServer');
  });

  it('should handle repeated variables', () => {
    const template = '{{username}} {{username}} {{username}}';
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toBe('johndoe johndoe johndoe');
  });

  it('should preserve non-variable text', () => {
    const template = 'Before {{username}} middle {{message}} after';
    const result = applyTemplate(template, message, sourceConfig);

    expect(result).toBe('Before johndoe middle Hello, this is a test message! after');
  });
});