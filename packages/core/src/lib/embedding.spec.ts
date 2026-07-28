import { embedTexts, embedQuery, embedTextsWithUsage } from './embedding.js';

describe('embedTexts', () => {
  it('should return an empty array without calling the model for empty input', async () => {
    let called = false;
    const result = await embedTexts([], {
      embedMany: async (values) => {
        called = true;
        return values.map(() => [0]);
      },
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('should pass values through to the injected embedder and return its vectors', async () => {
    const received: string[][] = [];
    const result = await embedTexts(['a', 'b'], {
      embedMany: async (values) => {
        received.push([...values]);
        return values.map((_, i) => [i, i + 1]);
      },
    });
    expect(received).toEqual([['a', 'b']]);
    expect(result).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

describe('embedQuery', () => {
  it('should embed a single string and return the first vector', async () => {
    const result = await embedQuery('hello', {
      embedMany: async (values) => values.map(() => [9, 8, 7]),
    });
    expect(result).toEqual([9, 8, 7]);
  });
});

describe('embedTextsWithUsage', () => {
  it('should return empty embeddings and zero tokens for empty input without calling the model', async () => {
    let called = false;
    const result = await embedTextsWithUsage([], {
      embedMany: async (values) => {
        called = true;
        return { embeddings: values.map(() => [0]), totalTokens: 1 };
      },
    });
    expect(result).toEqual({ embeddings: [], totalTokens: 0 });
    expect(called).toBe(false);
  });

  it('should return the vectors and reported token usage from the injected embedder', async () => {
    const result = await embedTextsWithUsage(['a', 'b'], {
      embedMany: async (values) => ({
        embeddings: values.map((_, i) => [i, i + 1]),
        totalTokens: 7,
      }),
    });
    expect(result.embeddings).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(result.totalTokens).toBe(7);
  });
});
