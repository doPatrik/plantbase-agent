import { describe, it, expect } from 'vitest';
import {
  retrievalDebugRequestSchema,
  retrievalDebugResultSchema,
} from './retrieval-debug.js';

describe('retrievalDebugRequestSchema', () => {
  it('elfogad egy csak-query kérést', () => {
    const r = retrievalDebugRequestSchema.safeParse({ query: 'pozsgás' });
    expect(r.success).toBe(true);
  });
  it('elutasítja az üres query-t', () => {
    expect(retrievalDebugRequestSchema.safeParse({ query: '' }).success).toBe(
      false,
    );
  });
  it('elutasítja a nem-pozitív topK-t', () => {
    expect(
      retrievalDebugRequestSchema.safeParse({ query: 'x', topK: 0 }).success,
    ).toBe(false);
  });
});

describe('retrievalDebugResultSchema', () => {
  it('validál egy teljes eredmény-objektumot', () => {
    const branch = {
      retrieval: [
        {
          rank: 0,
          documentId: 1,
          title: 'T',
          headingPath: null,
          sourcePath: 'a.md',
          similarity: 0.5,
          contentPreview: '...',
        },
      ],
      rerank: {
        degraded: false,
        results: [
          {
            rank: 0,
            documentId: 1,
            title: 'T',
            headingPath: null,
            sourcePath: 'a.md',
            similarity: 0.5,
            contentPreview: '...',
            prevRank: 0,
          },
        ],
      },
    };
    const r = retrievalDebugResultSchema.safeParse({
      query: 'q',
      hydeDoc: 'h',
      raw: branch,
      hyde: branch,
    });
    expect(r.success).toBe(true);
  });
});
