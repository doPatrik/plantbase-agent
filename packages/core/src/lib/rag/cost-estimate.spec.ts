import { describe, it, expect } from 'vitest';
import { runCostEstimate, type CostEstimateDeps } from './cost-estimate.js';
import type { SearchResult } from '../knowledge-store.js';

const chunk = (id: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: 0.6,
});

function baseDeps(overrides: Partial<CostEstimateDeps> = {}): CostEstimateDeps {
  return {
    router: async () => ({
      route: 'knowledge',
      reasoning: 'r',
      usage: { model: 'router-model', inputTokens: 10, outputTokens: 2 },
    }),
    hyde: async () => ({
      text: 'hyde doc',
      usage: { model: 'hyde-model', inputTokens: 20, outputTokens: 5 },
    }),
    embedQueryWithUsage: async () => ({
      embedding: [0.1, 0.2],
      totalTokens: 8,
      model: 'text-embedding-3-small',
    }),
    searchChunks: async () => [chunk(1), chunk(2)],
    rerank: async (_q, chunks) => ({
      chunks: [...chunks],
      degraded: false,
      usage: { model: 'rerank-model', inputTokens: 30, outputTokens: 8 },
    }),
    answer: () => ({
      textStream: (async function* () {
        yield 'Válasz';
      })(),
      sources: [],
      usage: Promise.resolve({
        model: 'answer-model',
        inputTokens: 40,
        outputTokens: 15,
      }),
    }),
    topK: 12,
    ...overrides,
  };
}

describe('runCostEstimate', () => {
  it('stage-enként gyűjti a usage-et router → hyde → embedding → rerank → answer sorrendben', async () => {
    const stages = await runCostEstimate('kérdés', baseDeps());
    expect(stages.map((s) => s.stage)).toEqual([
      'router',
      'hyde',
      'embedding',
      'rerank',
      'answer',
    ]);
    expect(stages[0]).toEqual({
      stage: 'router',
      model: 'router-model',
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(stages[2]).toEqual({
      stage: 'embedding',
      model: 'text-embedding-3-small',
      inputTokens: 8,
      outputTokens: 0,
    });
    expect(stages[4]).toEqual({
      stage: 'answer',
      model: 'answer-model',
      inputTokens: 40,
      outputTokens: 15,
    });
  });

  it('a hyde dokumentumot embeddeli (nem a nyers kérdést)', async () => {
    let embedded = '';
    await runCostEstimate(
      'kérdés',
      baseDeps({
        hyde: async () => ({ text: 'hipotetikus válasz' }),
        embedQueryWithUsage: async (text) => {
          embedded = text;
          return { embedding: [], totalTokens: 1, model: 'm' };
        },
      }),
    );
    expect(embedded).toBe('hipotetikus válasz');
  });

  it('usage nélküli stage-ekre 0/"unknown" alapértéket ad', async () => {
    const stages = await runCostEstimate(
      'kérdés',
      baseDeps({
        router: async () => ({ route: 'knowledge', reasoning: 'r' }),
        hyde: async () => ({ text: 'x' }),
        rerank: async (_q, chunks) => ({
          chunks: [...chunks],
          degraded: false,
        }),
      }),
    );
    expect(stages[0]).toEqual({
      stage: 'router',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(stages[1]).toEqual({
      stage: 'hyde',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(stages[3]).toEqual({
      stage: 'rerank',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
