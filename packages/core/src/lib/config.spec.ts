import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('should return apiKey and model from the environment', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    const config = loadConfig('/'); // gyökérből indulva nincs .env, a process.env számít
    expect(config.apiKey).toBe('sk-test-123');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.maxTokens).toBeGreaterThan(0);
  });

  it('should fall back to a default model when ANTHROPIC_MODEL is unset', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    delete process.env.ANTHROPIC_MODEL;
    const config = loadConfig('/');
    expect(config.model.length).toBeGreaterThan(0);
  });

  it('should throw when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    expect(() => loadConfig('/')).toThrow(/ANTHROPIC_API_KEY/);
  });
});
