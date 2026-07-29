// Költség-becslő (SP5): a tudás-út (router → HyDE → embed → retrieve → rerank →
// answer) teljes futtatása egyetlen kérdésre, stage-enkénti token-usage gyűjtve.
// Újrahasznosítja a meglévő stage-eket (createRouter/createHyde/createRerank/
// createAnswer) — nem másolja a pipeline-logikát. A route mindig "knowledge": a
// becslő a scope szerint mindig a tudás-utat méri, függetlenül attól, hogy a
// kérdés valós forgalomban milyen route-ra menne.

import type { StageUsageDto } from '@plantbase/shared';
import { loadConfig, loadRagConfig, loadEmbeddingConfig } from '../config.js';
import { embedTextsWithUsage } from '../embedding.js';
import { searchChunks as defaultSearchChunks } from '../knowledge-store.js';
import type { SearchChunksFn } from './retrieval.js';
import { createRagModels } from './models.js';
import { createRouter, type Router } from './router.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRerank, type Rerank } from './rerank.js';
import { createAnswer, type Answer } from './answer.js';
import type { StageUsage } from './usage.js';

/** Alacsony szintű, usage-t és modell-azonosítót is visszaadó embedder. */
export type EmbedQueryWithUsageFn = (
  text: string,
) => Promise<{ embedding: number[]; totalTokens: number; model: string }>;

export interface CostEstimateDeps {
  readonly router: Router;
  readonly hyde: Hyde;
  readonly embedQueryWithUsage: EmbedQueryWithUsageFn;
  readonly searchChunks: SearchChunksFn;
  readonly rerank: Rerank;
  readonly answer: Answer;
  readonly topK: number;
}

const UNKNOWN_MODEL = 'unknown';

function zero(model: string = UNKNOWN_MODEL): StageUsage {
  return { model, inputTokens: 0, outputTokens: 0 };
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const _ of stream) {
    /* csak a usage Promise beteljesítéséhez fogyasztjuk a streamet */
  }
}

/** A tudás-út teljes futtatása egyetlen kérdésre, stage-enkénti usage-gyel. */
export async function runCostEstimate(
  query: string,
  deps: CostEstimateDeps,
): Promise<readonly StageUsageDto[]> {
  const stages: StageUsageDto[] = [];

  const routerResult = await deps.router(query);
  stages.push({ stage: 'router', ...(routerResult.usage ?? zero()) });

  const hydeResult = await deps.hyde(query);
  stages.push({ stage: 'hyde', ...(hydeResult.usage ?? zero()) });

  const {
    embedding,
    totalTokens,
    model: embeddingModel,
  } = await deps.embedQueryWithUsage(hydeResult.text);
  stages.push({
    stage: 'embedding',
    model: embeddingModel,
    inputTokens: totalTokens,
    outputTokens: 0,
  });

  const retrieved = await deps.searchChunks(embedding, deps.topK);
  const reranked = await deps.rerank(query, retrieved);
  stages.push({ stage: 'rerank', ...(reranked.usage ?? zero()) });

  const answered = deps.answer({ question: query, chunks: reranked.chunks });
  await drain(answered.textStream);
  const answerUsage = (await answered.usage) ?? zero();
  stages.push({ stage: 'answer', ...answerUsage });

  return stages;
}

/** A valós wiring: modelleket és primitíveket a configból építi (a chat-pipeline mintájára). */
export function createDefaultCostEstimateDeps(): CostEstimateDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    router: createRouter({
      model: models.router,
      modelId: ragConfig.routerModel,
    }),
    hyde: createHyde({ model: models.hyde, modelId: ragConfig.hydeModel }),
    embedQueryWithUsage: async (text) => {
      const embeddingConfig = loadEmbeddingConfig();
      const { embeddings, totalTokens } = await embedTextsWithUsage([text], {
        config: embeddingConfig,
      });
      return {
        embedding: embeddings[0],
        totalTokens,
        model: embeddingConfig.model,
      };
    },
    searchChunks: (embedding, k) => defaultSearchChunks(embedding, k),
    rerank: createRerank({
      model: models.rerank,
      topN: ragConfig.rerankTopN,
      modelId: ragConfig.rerankModel,
    }),
    answer: createAnswer({
      model: models.answer,
      modelId: ragConfig.answerModel,
    }),
    topK: ragConfig.topK,
  };
}
