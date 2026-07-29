import { describe, it, expect } from 'vitest';
import type { SearchResult } from '../knowledge-store.js';
import {
  runRetrievalDebug,
  type RetrievalDebugDeps,
} from './retrieval-debug.js';

function chunk(id: number, sim: number): SearchResult {
  return {
    chunk_id: id,
    document_id: id,
    content: `tartalom-${id} és még hosszú szöveg`,
    heading_path: null,
    title: `cím-${id}`,
    source_url: null,
    source_path: `${id}.md`,
    similarity: sim,
  };
}

function makeDeps(over: Partial<RetrievalDebugDeps> = {}): RetrievalDebugDeps {
  const retrieved = [chunk(1, 0.6), chunk(2, 0.5), chunk(3, 0.4)];
  return {
    hyde: async () => ({ text: 'hipotetikus dokumentum' }),
    embedQuery: async () => Array(1536).fill(0),
    searchChunks: async () => retrieved,
    // rerank megfordítja a sorrendet, topN=2
    rerank: async (_q, chunks) => ({
      chunks: [chunks[2], chunks[0]],
      degraded: false,
    }),
    topK: 3,
    rerankTopN: 2,
    ...over,
  };
}

describe('runRetrievalDebug', () => {
  it('mindkét ágon visszaadja a retrieval- és rerank-sorrendet', async () => {
    const out = await runRetrievalDebug('kérdés', makeDeps());
    expect(out.query).toBe('kérdés');
    expect(out.hydeDoc).toBe('hipotetikus dokumentum');
    expect(out.raw.retrieval).toHaveLength(3);
    expect(out.raw.rerank.results).toHaveLength(2);
    // a raw retrieval rank sorrendben 0,1,2
    expect(out.raw.retrieval.map((h) => h.rank)).toEqual([0, 1, 2]);
    // rerank: az első reranked találat a nyers 3. elem (prevRank=2)
    expect(out.raw.rerank.results[0].prevRank).toBe(2);
    expect(out.raw.rerank.results[1].prevRank).toBe(0);
    expect(out.hyde.retrieval).toHaveLength(3);
  });

  it('a rerankTopN korlátozza a rerank-eredmények számát, a retrieval listát nem', async () => {
    const retrieved = [
      chunk(1, 0.9),
      chunk(2, 0.8),
      chunk(3, 0.7),
      chunk(4, 0.6),
    ];
    const out = await runRetrievalDebug(
      'kérdés',
      makeDeps({
        searchChunks: async () => retrieved,
        // rerank megfordítja a sorrendet, de 4 elemet ad vissza (a stage maga nem vág)
        rerank: async (_q, chunks) => ({
          chunks: [chunks[3], chunks[2], chunks[1], chunks[0]],
          degraded: false,
        }),
        rerankTopN: 2,
      }),
    );
    expect(out.raw.retrieval).toHaveLength(4);
    expect(out.hyde.retrieval).toHaveLength(4);
    expect(out.raw.rerank.results).toHaveLength(2);
    expect(out.hyde.rerank.results).toHaveLength(2);
    // az első két reranked találat a nyers 4. és 3. elem (prevRank=3,2)
    expect(out.raw.rerank.results[0].prevRank).toBe(3);
    expect(out.raw.rerank.results[1].prevRank).toBe(2);
  });

  it('a HyDE-ágban a HyDE-dokumentumot embeddeli, a raw-ban a nyers query-t', async () => {
    const embedded: string[] = [];
    const out = await runRetrievalDebug(
      'öntözés',
      makeDeps({
        embedQuery: async (text) => {
          embedded.push(text);
          return Array(1536).fill(0);
        },
      }),
    );
    expect(embedded).toContain('öntözés');
    expect(embedded).toContain(out.hydeDoc);
  });
});
