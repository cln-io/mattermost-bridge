// Simple test to verify Jest is working correctly
describe('Sanity Check', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should verify Jest and TypeScript are working together', () => {
    const message: string = 'Hello, Jest!';
    expect(message).toBe('Hello, Jest!');
  });

  it('should handle async tests', async () => {
    const promise = Promise.resolve('success');
    await expect(promise).resolves.toBe('success');
  });
});