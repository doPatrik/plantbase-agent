import { loadConfig, loadEmbeddingConfig, loadRagConfig } from './config.js';

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

describe('loadEmbeddingConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('should return the OpenAI key, default model, and fixed dimension', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    delete process.env.OPENAI_EMBEDDING_MODEL;
    const config = loadEmbeddingConfig('/');
    expect(config.apiKey).toBe('sk-openai-123');
    expect(config.model).toBe('text-embedding-3-small');
    expect(config.dimension).toBe(1536);
  });

  it('should honor a custom OPENAI_EMBEDDING_MODEL', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
    expect(loadEmbeddingConfig('/').model).toBe('text-embedding-3-large');
  });

  it('should throw when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadEmbeddingConfig('/')).toThrow(/OPENAI_API_KEY/);
  });
});

describe('loadRagConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('should default maxAgentIterations to 6 and debug to false', () => {
    delete process.env.MAX_AGENT_ITERATIONS;
    delete process.env.DEBUG;
    const config = loadRagConfig('/');
    expect(config.maxAgentIterations).toBe(6);
    expect(config.debug).toBe(false);
  });

  it('should parse MAX_AGENT_ITERATIONS as a number and DEBUG=true as boolean', () => {
    process.env.MAX_AGENT_ITERATIONS = '10';
    process.env.DEBUG = 'true';
    const config = loadRagConfig('/');
    expect(config.maxAgentIterations).toBe(10);
    expect(config.debug).toBe(true);
  });

  it('should reject a non-positive MAX_AGENT_ITERATIONS', () => {
    process.env.MAX_AGENT_ITERATIONS = '0';
    expect(() => loadRagConfig('/')).toThrow(/MAX_AGENT_ITERATIONS/);
  });
});
