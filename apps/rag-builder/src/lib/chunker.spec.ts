import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from './chunker.js';
import { estimateTokens } from './token-estimate.js';

// Segéd: n szó, ~4 char/szó → ~n token.
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('chunkMarkdown', () => {
  it('returns [] for empty or whitespace-only body', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n  \n')).toEqual([]);
  });

  it('builds a breadcrumb heading_path from nested headings', () => {
    const body = '# Care\n\n## Water\n\nWater weekly.';
    const chunks = chunkMarkdown(body, { target: 10 });
    expect(chunks[0].heading_path).toBe('Care > Water');
  });

  it('assigns sequential chunk_index in document order tied to packing', () => {
    // Két nagy szekció; target alatt nem vonódnak össze (overlap/minMerge 0),
    // ezért a chunk-szám előre megjósolható: pontosan 2.
    const body = `## A\n\nALPHA ${words(400)}\n\n## B\n\nBETA ${words(400)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      overlap: 0,
      minMerge: 0,
    });
    expect(chunks.length).toBe(2);
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1]);
    // Dokumentum-sorrend: az első chunk az A szekció, a második a B.
    expect(chunks[0].content).toContain('ALPHA');
    expect(chunks[0].content).not.toContain('BETA');
    expect(chunks[1].content).toContain('BETA');
  });

  it('merges small adjacent sections up toward the target', () => {
    const body = '## A\n\nshort a\n\n## B\n\nshort b\n\n## C\n\nshort c';
    const chunks = chunkMarkdown(body, { target: 512, overlap: 0 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading_path).toBe('A'); // first segment's path
  });

  it('hard-splits a single oversized section on paragraph boundaries', () => {
    const body = `## Big\n\n${words(500)}\n\n${words(500)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      hardSplit: 400,
      overlap: 0,
      minMerge: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.token_count).toBeLessThanOrEqual(700);
    }
  });

  it('adds overlap: the start of a later chunk repeats the tail of the previous one', () => {
    const body = `## A\n\n${words(400)}\n\n## B\n\nUNIQUEMARKER ${words(400)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      overlap: 40,
      minMerge: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // A második chunk eleje tartalmaz szöveget az elsőből (overlap).
    const first = chunks[0].content;
    const secondHead = chunks[1].content.slice(0, 200);
    const lastWordOfFirst = first.trim().split(/\s+/).slice(-1)[0];
    expect(secondHead).toContain(lastWordOfFirst);
  });

  it('sets token_count from the final (post-overlap) content', () => {
    // Legalább két chunk, overlap > 0: a második chunk overlapet kap az elsőből,
    // így a content bővül — a token_count-nak a VÉGSŐ (overlap utáni) tartalmat
    // kell tükröznie. Egy pre-overlap regresszió itt bukna el.
    const body = `## A\n\n${words(400)}\n\n## B\n\n${words(400)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      overlap: 40,
      minMerge: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // A második chunk ténylegesen kapott overlapet: az első chunk utolsó szava
    // megjelenik a második chunk elején.
    const lastWordOfFirst = chunks[0].content.trim().split(/\s+/).slice(-1)[0];
    expect(chunks[1].content.slice(0, 200)).toContain(lastWordOfFirst);
    // A token_count a végleges, overlap utáni contentből számol.
    expect(chunks[1].token_count).toBe(estimateTokens(chunks[1].content));
  });
});
