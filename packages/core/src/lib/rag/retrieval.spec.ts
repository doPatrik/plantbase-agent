import { createRetrieve } from './retrieval.js';
import type { SearchResult } from '../knowledge-store.js';

const chunk = (id: number, sim: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: sim,
});

describe('createRetrieve', () => {
  it('embeds the query text and searches with topK', async () => {
    let embeddedText = '';
    let usedK = 0;
    const retrieve = createRetrieve({
      topK: 12,
      embedQuery: async (text) => {
        embeddedText = text;
        return new Array(1536).fill(0.02);
      },
      searchChunks: async (_embedding, k) => {
        usedK = k;
        return [chunk(1, 0.6), chunk(2, 0.5)];
      },
    });
    const results = await retrieve('hipotetikus válasz szövege');
    expect(embeddedText).toBe('hipotetikus válasz szövege');
    expect(usedK).toBe(12);
    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBeCloseTo(0.6);
  });
});
