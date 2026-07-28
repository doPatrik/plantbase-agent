// Retrieval stage (SP3a): TISZTA KÓD, nincs LLM. A (HyDE) query-szöveget beágyazza
// (OpenAI text-embedding-3-small, embedding.ts), majd a pgvector vektorkeresést
// futtatja a read-only kapcsolaton (searchChunks). Mindkét primitív injektálható
// (teszthez fake), a default a valós implementáció.

import { embedQuery as defaultEmbedQuery } from '../embedding.js';
import {
  searchChunks as defaultSearchChunks,
  type SearchResult,
} from '../knowledge-store.js';

export type EmbedQueryFn = (text: string) => Promise<number[]>;
export type SearchChunksFn = (
  embedding: readonly number[],
  k: number,
) => Promise<SearchResult[]>;

export interface RetrieveDeps {
  readonly topK: number;
  readonly embedQuery?: EmbedQueryFn;
  readonly searchChunks?: SearchChunksFn;
}

export type Retrieve = (queryText: string) => Promise<SearchResult[]>;

/** Létrehozza a retrieval-függvényt (embed → search, topK-val). */
export function createRetrieve(deps: RetrieveDeps): Retrieve {
  const embed = deps.embedQuery ?? ((text) => defaultEmbedQuery(text));
  const search =
    deps.searchChunks ?? ((embedding, k) => defaultSearchChunks(embedding, k));
  return async (queryText) => {
    const embedding = await embed(queryText);
    return search(embedding, deps.topK);
  };
}
