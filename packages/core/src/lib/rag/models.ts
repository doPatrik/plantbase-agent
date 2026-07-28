// Model-registry a RAG-pipeline-hoz (SP3a). Az Anthropic modelleket a Vercel AI
// SDK `@ai-sdk/anthropic` providerén át hozzuk létre, szerepenként (router/hyde/
// rerank = olcsó Haiku; answer + katalógus = Sonnet). A modellneveket a config
// adja (env-felülírható), az apiKey az ANTHROPIC_API_KEY (AgentConfig).
// Az embedding NEM itt van: azt a meglévő embedding.ts (OpenAI) kezeli.

import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { RagConfig } from '../config.js';

/** A pipeline szerepenkénti nyelvi modelljei. */
export interface RagModels {
  readonly router: LanguageModel;
  readonly hyde: LanguageModel;
  readonly rerank: LanguageModel;
  readonly answer: LanguageModel;
  readonly catalog: LanguageModel;
}

/** Létrehozza a szerep-modelleket a configból és az Anthropic apiKey-ből. */
export function createRagModels(config: RagConfig, apiKey: string): RagModels {
  const anthropic = createAnthropic({ apiKey });
  return {
    router: anthropic(config.routerModel),
    hyde: anthropic(config.hydeModel),
    rerank: anthropic(config.rerankModel),
    answer: anthropic(config.answerModel),
    catalog: anthropic(config.answerModel),
  };
}
