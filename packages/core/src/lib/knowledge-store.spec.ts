import {
  toVectorLiteral,
  assertEmbeddingDim,
  upsertDocument,
  replaceChunks,
  searchChunks,
  getChunkStats,
  type Queryable,
} from './knowledge-store.js';

interface Call {
  text: string;
  params: readonly unknown[];
}

/** Fake pg kliens: rögzíti a hívásokat, a RETURNING-re kanonikus sort ad vissza. */
function fakeClient(
  responder: (text: string) => Record<string, unknown>[] = () => [],
): { client: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const client: Queryable = {
    async query(text, params = []) {
      calls.push({ text, params });
      return { rows: responder(text) };
    },
  };
  return { client, calls };
}

describe('toVectorLiteral', () => {
  it('should format numbers as a pgvector bracket literal', () => {
    expect(toVectorLiteral([0.1, 0.2, -3])).toBe('[0.1,0.2,-3]');
  });
});

describe('assertEmbeddingDim', () => {
  it('should throw on a dimension mismatch', () => {
    expect(() => assertEmbeddingDim([1, 2, 3], 1536)).toThrow(/1536/);
  });
  it('should accept a matching dimension', () => {
    expect(() => assertEmbeddingDim(new Array(4).fill(0), 4)).not.toThrow();
  });
});

describe('upsertDocument', () => {
  it('should upsert on source_path and return the document id', async () => {
    const { client, calls } = fakeClient((text) =>
      text.includes('INSERT INTO documents') ? [{ id: 42 }] : [],
    );
    const id = await upsertDocument(client, {
      source_path: 'plants-101__snake.md',
      title: 'Snake',
      source_url: 'https://x/y',
      category: 'plants-101',
      content_hash: 'abc',
      char_count: 100,
    });
    expect(id).toBe(42);
    expect(calls[0].text).toMatch(/INSERT INTO documents/);
    expect(calls[0].text).toMatch(/ON CONFLICT \("?source_path"?\)/);
    expect(calls[0].params).toEqual([
      'plants-101__snake.md',
      'Snake',
      'https://x/y',
      'plants-101',
      'abc',
      100,
    ]);
  });
});

describe('replaceChunks', () => {
  it('should delete old chunks then insert each new chunk with a vector param', async () => {
    const { client, calls } = fakeClient();
    const embedding = Array.from({ length: 1536 }, (_, i) =>
      i === 0 ? 0.1 : i === 1 ? 0.2 : 0,
    );
    const count = await replaceChunks(client, 42, [
      {
        chunk_index: 0,
        content: 'hello',
        heading_path: 'H1',
        token_count: 2,
        embedding,
      },
    ]);
    expect(count).toBe(1);
    expect(calls[0].text).toMatch(/DELETE FROM document_chunks/);
    expect(calls[0].params).toEqual([42]);
    expect(calls[1].text).toMatch(/INSERT INTO document_chunks/);
    expect(calls[1].params.slice(0, 5)).toEqual([42, 0, 'hello', 'H1', 2]);
    expect(typeof calls[1].params[5]).toBe('string');
    expect((calls[1].params[5] as string).startsWith('[0.1,0.2,')).toBe(true);
  });
});

describe('searchChunks', () => {
  it('should order by cosine distance, select similarity, and pass [vector, k]', async () => {
    const { client, calls } = fakeClient(() => [
      {
        chunk_id: 1,
        document_id: 7,
        content: 'c',
        heading_path: null,
        title: 't',
        source_url: null,
        similarity: 0.83,
      },
    ]);
    const embedding = Array.from({ length: 1536 }, (_, i) =>
      i === 0 ? 0.1 : i === 1 ? 0.2 : 0,
    );
    const results = await searchChunks(embedding, 5, { client });
    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBe(0.83);
    expect(calls[0].text).toMatch(/1 - \(.*embedding.*<=>.*\)/);
    expect(calls[0].text).toMatch(/ORDER BY.*embedding.*<=>/);
    expect(calls[0].params).toEqual([toVectorLiteral(embedding), 5]);
  });

  it('should reject a wrong-dimension query embedding before querying', async () => {
    const { client, calls } = fakeClient();
    await expect(searchChunks([0.1, 0.2, 0.3], 5, { client })).rejects.toThrow(
      /1536/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('getChunkStats', () => {
  it('should return the stats row coerced to numbers', async () => {
    const { client } = fakeClient(() => [
      {
        document_count: '2',
        chunk_count: '10',
        embedded_chunk_count: '10',
        avg_chunk_chars: '512.5',
        min_chunk_chars: '100',
        max_chunk_chars: '900',
      },
    ]);
    const stats = await getChunkStats({ client });
    expect(stats.document_count).toBe(2);
    expect(stats.chunk_count).toBe(10);
    expect(stats.avg_chunk_chars).toBeCloseTo(512.5);
  });
});
