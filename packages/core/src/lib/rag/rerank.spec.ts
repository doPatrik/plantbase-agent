import { createRerank } from './rerank.js';
import type { GenerateObjectFn } from './router.js';
import type { LanguageModel } from 'ai';
import type { SearchResult } from '../knowledge-store.js';

const model = { modelId: 'fake' } as unknown as LanguageModel;
const chunk = (id: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: 0.5,
});
const input = [chunk(0), chunk(1), chunk(2), chunk(3)];

describe('createRerank', () => {
  it('reorders by the model ranking and keeps topN', async () => {
    const generateObject = (async () =>
      ({ object: { ranking: [2, 0] } }) as never) as GenerateObjectFn;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(false);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([2, 0]);
  });

  it('degrades to the raw order (sliced to topN) when the model throws', async () => {
    const generateObject = (async () => {
      throw new Error('rerank model down');
    }) as GenerateObjectFn;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(true);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([0, 1]);
  });

  it('degrades on out-of-range indices', async () => {
    const generateObject = (async () =>
      ({ object: { ranking: [99] } }) as never) as GenerateObjectFn;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(true);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([0, 1]);
  });

  it('returns empty for empty input without calling the model', async () => {
    let called = false;
    const generateObject = (async () => {
      called = true;
      return { object: { ranking: [] } } as never;
    }) as GenerateObjectFn;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', []);
    expect(outcome.chunks).toEqual([]);
    expect(outcome.degraded).toBe(false);
    expect(called).toBe(false);
  });

  it('sikeres rerank esetén a usage-et StageUsage-ként adja vissza', async () => {
    const generateObject = (async () => ({
      object: { ranking: [2, 0] },
      usage: { inputTokens: 300, outputTokens: 12 },
    })) as GenerateObjectFn;
    const rerank = createRerank({
      model,
      topN: 2,
      modelId: 'claude-haiku-4-5',
      generateObject,
    });
    const outcome = await rerank('kérdés', input);
    expect(outcome.usage).toEqual({
      model: 'claude-haiku-4-5',
      inputTokens: 300,
      outputTokens: 12,
    });
  });

  it('degradált (hibás) rerank esetén a usage undefined', async () => {
    const generateObject = (async () => {
      throw new Error('rerank model down');
    }) as GenerateObjectFn;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.usage).toBeUndefined();
  });
});
