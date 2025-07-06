import { LOG_PREFIXES, PADDED_PREFIXES, createLogPrefix } from '../src/logger-utils';

describe('logger-utils', () => {
  describe('LOG_PREFIXES', () => {
    it('should contain all expected prefixes', () => {
      expect(LOG_PREFIXES).toEqual({
        BRIDGE: 'bridge',
        CONFIG: 'config',
        MAIN: 'main',
        MESSAGE_TEMPLATE: 'message-template',
        MATTERMOST_CLIENT: 'mattermost-client',
        HEARTBEAT_SERVICE: 'heartbeat-service'
      });
    });
  });

  describe('createLogPrefix', () => {
    it('should pad short prefixes', () => {
      expect(createLogPrefix('test')).toBe('[test             ]');
    });

    it('should handle exact length prefixes', () => {
      expect(createLogPrefix('mattermost-client')).toBe('[mattermost-client]');
    });

    it('should handle empty string', () => {
      expect(createLogPrefix('')).toBe('[                 ]');
    });
  });

  describe('PADDED_PREFIXES', () => {
    it('should have all prefixes padded to same length', () => {
      const lengths = Object.values(PADDED_PREFIXES).map(p => p.length);
      const uniqueLengths = [...new Set(lengths)];
      
      expect(uniqueLengths).toHaveLength(1);
    });

    it('should match expected format', () => {
      expect(PADDED_PREFIXES.BRIDGE).toBe('[bridge           ]');
      expect(PADDED_PREFIXES.CONFIG).toBe('[config           ]');
      expect(PADDED_PREFIXES.MAIN).toBe('[main             ]');
      expect(PADDED_PREFIXES.MESSAGE_TEMPLATE).toBe('[message-template ]');
      expect(PADDED_PREFIXES.MATTERMOST_CLIENT).toBe('[mattermost-client]');
      expect(PADDED_PREFIXES.HEARTBEAT_SERVICE).toBe('[heartbeat-service]');
    });
  });
});