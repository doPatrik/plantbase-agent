// Debug-összehasonlítás (SP3b): ugyanarra a query-re HyDE ki/be × rerank előtt/után.
// Így közvetlenül látszik, mennyit rendez át a rerank, és mennyit segít a HyDE.
// Minden primitív injektálható (teszt); a createDefaultRetrievalDebugDeps a valós wiring.

import type {
  DebugHit,
  RerankedDebugHit,
  RetrievalDebugBranch,
  RetrievalDebugResult,
} from '@plantbase/shared';
import { loadConfig, loadRagConfig } from '../config.js';
import type { SearchResult } from '../knowledge-store.js';
import { createRagModels } from './models.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRerank, type Rerank } from './rerank.js';
import { type EmbedQueryFn, type SearchChunksFn } from './retrieval.js';
import { embedQuery as defaultEmbedQuery } from '../embedding.js';
import { searchChunks as defaultSearchChunks } from '../knowledge-store.js';

const PREVIEW_CHARS = 240;

export interface RetrievalDebugDeps {
  readonly hyde: Hyde;
  readonly embedQuery: EmbedQueryFn;
  readonly searchChunks: SearchChunksFn;
  readonly rerank: Rerank;
  readonly topK: number;
  readonly rerankTopN: number;
}

function toHit(c: SearchResult, rank: number): DebugHit {
  return {
    rank,
    documentId: c.document_id,
    title: c.title,
    headingPath: c.heading_path,
    sourcePath: c.source_path,
    similarity: c.similarity,
    contentPreview: c.content.slice(0, PREVIEW_CHARS),
  };
}

/** Egy ág: a queryText embeddingjével keres, majd a kérdésre rerankol. */
async function runBranch(
  queryText: string,
  rerankQuestion: string,
  deps: RetrievalDebugDeps,
): Promise<RetrievalDebugBranch> {
  const embedding = await deps.embedQuery(queryText);
  const retrieved = await deps.searchChunks(embedding, deps.topK);
  const outcome = await deps.rerank(rerankQuestion, retrieved);
  const rankById = new Map(retrieved.map((c, i) => [c.chunk_id, i]));
  const results: RerankedDebugHit[] = outcome.chunks.map((c, i) => ({
    ...toHit(c, i),
    prevRank: rankById.get(c.chunk_id) ?? -1,
  }));
  return {
    retrieval: retrieved.map((c, i) => toHit(c, i)),
    rerank: { degraded: outcome.degraded, results },
  };
}

/** HyDE ki/be × rerank előtt/után összehasonlítás egyetlen query-re. */
export async function runRetrievalDebug(
  query: string,
  deps: RetrievalDebugDeps,
): Promise<RetrievalDebugResult> {
  const hydeDoc = await deps.hyde(query);
  const raw = await runBranch(query, query, deps);
  const hyde = await runBranch(hydeDoc, query, deps);
  return { query, hydeDoc, raw, hyde };
}

/** A valós wiring: modelleket és primitíveket a configból építi. */
export function createDefaultRetrievalDebugDeps(
  overrides: Partial<RetrievalDebugDeps> = {},
): RetrievalDebugDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    hyde: createHyde({ model: models.hyde }),
    embedQuery: (text) => defaultEmbedQuery(text),
    searchChunks: (embedding, k) => defaultSearchChunks(embedding, k),
    rerank: createRerank({ model: models.rerank, topN: ragConfig.rerankTopN }),
    topK: ragConfig.topK,
    rerankTopN: ragConfig.rerankTopN,
    ...overrides,
  };
}
