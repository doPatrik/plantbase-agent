import {
  loadConfig,
  loadEmbeddingConfig,
  loadRagConfig,
  loadModelPrices,
} from './config.js';

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

  it('should default the embedding price to 0.02 per million tokens', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    delete process.env.OPENAI_EMBEDDING_PRICE_PER_M;
    expect(loadEmbeddingConfig('/').pricePerMillionTokens).toBe(0.02);
  });

  it('should honor a custom OPENAI_EMBEDDING_PRICE_PER_M', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    process.env.OPENAI_EMBEDDING_PRICE_PER_M = '0.05';
    expect(loadEmbeddingConfig('/').pricePerMillionTokens).toBe(0.05);
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

describe('loadRagConfig (SP3a extensions)', () => {
  const KEYS = [
    'RAG_ROUTER_MODEL',
    'RAG_HYDE_MODEL',
    'RAG_RERANK_MODEL',
    'RAG_ANSWER_MODEL',
    'RAG_TOP_K',
    'RAG_RERANK_TOP_N',
    'RAG_GROUNDING_THRESHOLD',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('applies documented defaults when unset', () => {
    const cfg = loadRagConfig('/nonexistent-dir-for-test');
    expect(cfg.routerModel).toBe('claude-haiku-4-5');
    expect(cfg.hydeModel).toBe('claude-haiku-4-5');
    expect(cfg.rerankModel).toBe('claude-haiku-4-5');
    expect(cfg.answerModel).toBe('claude-sonnet-4-6');
    expect(cfg.topK).toBe(12);
    expect(cfg.rerankTopN).toBe(5);
    expect(cfg.groundingThreshold).toBeCloseTo(0.35);
  });

  it('reads overrides from env', () => {
    process.env.RAG_TOP_K = '20';
    process.env.RAG_GROUNDING_THRESHOLD = '0.4';
    process.env.RAG_ANSWER_MODEL = 'claude-sonnet-5';
    const cfg = loadRagConfig('/nonexistent-dir-for-test');
    expect(cfg.topK).toBe(20);
    expect(cfg.groundingThreshold).toBeCloseTo(0.4);
    expect(cfg.answerModel).toBe('claude-sonnet-5');
  });

  it('rejects a negative grounding threshold', () => {
    process.env.RAG_GROUNDING_THRESHOLD = '-0.1';
    expect(() => loadRagConfig('/nonexistent-dir-for-test')).toThrow(
      /RAG-konfiguráció/,
    );
  });
});

describe('loadModelPrices', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('a default Haiku/Sonnet/embedding árakat adja, ha nincs env-felülírás', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_EMBEDDING_PRICE_PER_M;
    delete process.env.RAG_PRICE_HAIKU_INPUT_PER_M;
    delete process.env.RAG_PRICE_HAIKU_OUTPUT_PER_M;
    delete process.env.RAG_PRICE_SONNET_INPUT_PER_M;
    delete process.env.RAG_PRICE_SONNET_OUTPUT_PER_M;
    const prices = loadModelPrices('/');
    expect(prices['claude-haiku-4-5']).toEqual({
      inputPerM: 1.0,
      outputPerM: 5.0,
    });
    expect(prices['claude-sonnet-4-6']).toEqual({
      inputPerM: 3.0,
      outputPerM: 15.0,
    });
    expect(prices['text-embedding-3-small']).toEqual({
      inputPerM: 0.02,
      outputPerM: 0,
    });
  });

  it('honorálja a RAG_PRICE_* env-felülírásokat', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    process.env.RAG_PRICE_HAIKU_INPUT_PER_M = '2';
    process.env.RAG_PRICE_HAIKU_OUTPUT_PER_M = '10';
    process.env.RAG_PRICE_SONNET_INPUT_PER_M = '6';
    process.env.RAG_PRICE_SONNET_OUTPUT_PER_M = '30';
    const prices = loadModelPrices('/');
    expect(prices['claude-haiku-4-5']).toEqual({
      inputPerM: 2,
      outputPerM: 10,
    });
    expect(prices['claude-sonnet-4-6']).toEqual({
      inputPerM: 6,
      outputPerM: 30,
    });
  });

  it('throw-ol, ha az OPENAI_API_KEY hiányzik (az embedding-ár is kell)', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadModelPrices('/')).toThrow(/OPENAI_API_KEY/);
  });
});
