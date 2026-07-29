// A RAG-pipeline orchestrátora (SP3a fő belépő; ez váltja le az askAgent-et).
// Router dönt az útvonalról, majd az útvonalnak megfelelő stage-eket futtatja.
// A knowledge-út determinisztikus kód-pipeline (HyDE → retrieval → rerank →
// guardrail → answer); a katalógus-út a catalog-agent. A stage-ek egy injektált
// onTrace(event) callbackre emittálnak; csak az answer-stage streamel tokent.
// Minden stage injektálható (teszt), a createDefaultChatDeps a valós wiring.

import {
  noopTrace,
  type ChatMessage,
  type OnTrace,
  type RagAnswer,
  type SourceRef,
} from '@plantbase/shared';
import { loadConfig, loadRagConfig } from '../config.js';
import {
  runSql as defaultRunSql,
  listCategories as defaultListCategories,
} from '../runsql.js';
import { createRagModels } from './models.js';
import { createRouter, type Router } from './router.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRetrieve, type Retrieve } from './retrieval.js';
import { createRerank, type Rerank } from './rerank.js';
import { checkGrounding, NO_GROUNDING_MESSAGE } from './guardrail.js';
import { createAnswer, type Answer } from './answer.js';
import { createCatalogAgent, type CatalogAgent } from './catalog-agent.js';
import { deriveQuestion } from './history.js';

/** A pipeline injektálható függőségei (teszthez fake, prod-hoz a default wiring). */
export interface ChatDeps {
  readonly router: Router;
  readonly hyde: Hyde;
  readonly retrieve: Retrieve;
  readonly rerank: Rerank;
  readonly answer: Answer;
  readonly catalogAgent: CatalogAgent;
  readonly groundingThreshold: number;
  /** A retrieve stage konfigurált top-K-ja (csak trace-hez, nem a lekéréshez). */
  readonly topK: number;
  readonly onTrace?: OnTrace;
}

/** A futó chat: a token-stream a fogyasztónak + a végleges válasz Promise-ként. */
export interface ChatRun {
  readonly textStream: AsyncIterable<string>;
  readonly result: Promise<RagAnswer>;
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}

/** Egy szöveges streamet teljesen elfogyaszt és összefűz. */
async function drain(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

/**
 * Lefuttatja a RAG-pipeline-t a kérdésre. A visszaadott textStream a válasz
 * tokenjeit adja; a result Promise a teljes szöveggel + forrásokkal resolve-ol.
 */
export async function runChat(
  messages: readonly ChatMessage[],
  deps: ChatDeps,
): Promise<ChatRun> {
  const onTrace = deps.onTrace ?? noopTrace;
  const question = deriveQuestion(messages);
  const history = messages.slice(0, -1);

  const routerResult = await deps.router(question, history);
  const { route, reasoning } = routerResult;
  onTrace({ type: 'router', route, reasoning });
  if (routerResult.usage) {
    onTrace({ type: 'usage', stage: 'router', ...routerResult.usage });
  }

  let resolveResult!: (answer: RagAnswer) => void;
  const result = new Promise<RagAnswer>((resolve) => {
    resolveResult = resolve;
  });

  // A knowledge-oldali kontextus (chunkok) előkészítése, ha kell.
  const needsKnowledge = route === 'knowledge' || route === 'both';
  const needsCatalog = route === 'catalog' || route === 'both';

  // --- Katalógus-kontextus (both esetén szövegként összegyűjtve) ---
  let catalogContext: string | undefined;
  if (route === 'both') {
    const catalogRun = deps.catalogAgent(question, history);
    catalogContext = await drain(catalogRun.textStream);
  }

  // --- Knowledge-oldal (HyDE → retrieval → rerank → guardrail) ---
  let sources: readonly SourceRef[] = [];
  let answerStream: AsyncIterable<string> | undefined;

  if (needsKnowledge) {
    const hydeResult = await deps.hyde(question, history);
    onTrace({ type: 'hyde', hydeDoc: hydeResult.text });
    if (hydeResult.usage) {
      onTrace({ type: 'usage', stage: 'hyde', ...hydeResult.usage });
    }

    const retrieved = await deps.retrieve(hydeResult.text);
    const maxRetrieved = retrieved.reduce(
      (m, c) => Math.max(m, c.similarity),
      0,
    );
    onTrace({
      type: 'retrieval',
      topK: deps.topK,
      resultCount: retrieved.length,
      maxSimilarity: maxRetrieved,
    });

    const reranked = await deps.rerank(question, retrieved);
    onTrace({
      type: 'rerank',
      inputCount: retrieved.length,
      outputCount: reranked.chunks.length,
      degraded: reranked.degraded,
    });
    if (reranked.usage) {
      onTrace({ type: 'usage', stage: 'rerank', ...reranked.usage });
    }

    const grounding = checkGrounding(reranked.chunks, deps.groundingThreshold);
    onTrace({
      type: 'guardrail',
      grounded: grounding.grounded,
      maxSimilarity: grounding.maxSimilarity,
      threshold: deps.groundingThreshold,
    });

    if (!grounding.grounded && route === 'knowledge') {
      // Tiszta knowledge-út, nincs elég megbízható forrás → canned üzenet,
      // NINCS answer-hívás.
      const stream = tee(single(NO_GROUNDING_MESSAGE), onTrace, (full) =>
        resolveResult({ text: full, route, sources: [] }),
      );
      return { textStream: stream, result };
    }

    // both + not-grounded: a knowledge-oldal nem szolgáltat forrást, de a
    // catalogContext már megvan → grounded válasz adható a katalógus-adatokból
    // (üres chunks-szal, hogy ne hivatkozzunk nem-megbízható forrásra).
    const answered = deps.answer({
      question,
      chunks: grounding.grounded ? reranked.chunks : [],
      catalogContext,
      history,
    });
    sources = answered.sources;
    answerStream = answered.textStream;
    answered.usage?.then((usage) =>
      onTrace({ type: 'usage', stage: 'answer', ...usage }),
    );
  } else if (needsCatalog) {
    // Tiszta katalógus-út: a catalog-agent streamje megy tovább, nincs forrás.
    answerStream = deps.catalogAgent(question, history).textStream;
  }

  if (!answerStream) {
    // Elvi ág: minden route lefedve; védőháló.
    const stream = tee(single(NO_GROUNDING_MESSAGE), onTrace, (full) =>
      resolveResult({ text: full, route, sources: [] }),
    );
    return { textStream: stream, result };
  }

  const finalSources = sources;
  const stream = tee(answerStream, onTrace, (full) =>
    resolveResult({ text: full, route, sources: finalSources }),
  );
  return { textStream: stream, result };
}

/**
 * A válasz-streamet "tee"-zi: minden darabra answer-delta trace-t emit-el és
 * akkumulál; a stream elején answer-start; a végén a done() callbackkel a teljes
 * szöveget átadja (a result Promise beállításához).
 */
async function* tee(
  source: AsyncIterable<string>,
  onTrace: OnTrace,
  done: (full: string) => void,
): AsyncIterable<string> {
  onTrace({ type: 'answer-start' });
  let full = '';
  for await (const part of source) {
    full += part;
    onTrace({ type: 'answer-delta', text: part });
    yield part;
  }
  done(full);
}

/** A valós wiring: modelleket és stage-eket a configból építi. */
export function createDefaultChatDeps(
  overrides: Partial<ChatDeps> = {},
): ChatDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    router: createRouter({
      model: models.router,
      modelId: ragConfig.routerModel,
    }),
    hyde: createHyde({ model: models.hyde, modelId: ragConfig.hydeModel }),
    retrieve: createRetrieve({ topK: ragConfig.topK }),
    rerank: createRerank({
      model: models.rerank,
      topN: ragConfig.rerankTopN,
      modelId: ragConfig.rerankModel,
    }),
    answer: createAnswer({
      model: models.answer,
      modelId: ragConfig.answerModel,
    }),
    catalogAgent: createCatalogAgent({
      model: models.catalog,
      runSql: (q) => defaultRunSql(q),
      listCategories: () => defaultListCategories(),
      maxIterations: ragConfig.maxAgentIterations,
    }),
    groundingThreshold: ragConfig.groundingThreshold,
    topK: ragConfig.topK,
    ...overrides,
  };
}
