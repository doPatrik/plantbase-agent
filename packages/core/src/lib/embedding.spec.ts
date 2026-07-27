import { embedTexts, embedQuery } from './embedding.js';

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
