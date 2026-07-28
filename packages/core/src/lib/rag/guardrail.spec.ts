import { checkGrounding, NO_GROUNDING_MESSAGE } from './guardrail.js';
import type { SearchResult } from '../knowledge-store.js';

const withSim = (sim: number): SearchResult => ({
  chunk_id: 1,
  document_id: 1,
  content: 'c',
  heading_path: null,
  title: 't',
  source_url: null,
  source_path: 'p.md',
  similarity: sim,
});

describe('checkGrounding', () => {
  it('is not grounded on zero results', () => {
    const result = checkGrounding([], 0.35);
    expect(result.grounded).toBe(false);
    expect(result.maxSimilarity).toBe(0);
  });

  it('is not grounded when max similarity is below the threshold', () => {
    const result = checkGrounding([withSim(0.2), withSim(0.34)], 0.35);
    expect(result.grounded).toBe(false);
    expect(result.maxSimilarity).toBeCloseTo(0.34);
  });

  it('is grounded when max similarity meets the threshold', () => {
    const result = checkGrounding([withSim(0.35), withSim(0.1)], 0.35);
    expect(result.grounded).toBe(true);
    expect(result.maxSimilarity).toBeCloseTo(0.35);
  });

  it('exposes a Hungarian no-grounding message', () => {
    expect(NO_GROUNDING_MESSAGE).toMatch(/tudásbázis/i);
  });
});
