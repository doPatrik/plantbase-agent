// LLM-router (SP3a): eldönti, hogy a kérdés a tudásbázisra (knowledge), a
// katalógusra (catalog), vagy mindkettőre (both) vonatkozik. Olcsó Haiku modell,
// zod-strukturált kimenet (generateObject). A generateObject injektálható a
// teszthez (DI-minta, vö. embedding.ts embedMany). A generateObject usage-e
// (SP5) opcionálisan átjön, hogy a costEstimate/trace mérni tudja a költséget.

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import {
  chatRouteSchema,
  type ChatRoute,
  type ChatMessage,
} from '@plantbase/shared';
import { formatHistoryForPrompt } from './history.js';
import type { StageUsage } from './usage.js';

/** A router strukturált kimenete. */
export interface RouterResult {
  readonly route: ChatRoute;
  readonly reasoning: string;
  /** A router-hívás token-usage-e (SP5); hiányzik, ha a generateObject nem adott usage-t. */
  readonly usage?: StageUsage;
}

const routerSchema = z.object({
  route: chatRouteSchema,
  reasoning: z.string(),
});

/** Szűk, injektálható generateObject (csak amit a router/rerank használ). */
export type GenerateObjectFn = <T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
}) => Promise<{
  object: T;
  usage?: { inputTokens: number; outputTokens: number };
}>;

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object, usage } = await generateObject({
    model,
    schema,
    system,
    prompt,
  });
  return {
    object,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
};

const ROUTER_SYSTEM = `Te a Plantbase asszisztens útvonalválasztója vagy. Döntsd el, honnan jöhet a válasz:
- "knowledge": általános növénygondozási / ismeretkérdés (a tudásbázis cikkeiből).
- "catalog": konkrét termékadat a webshop katalógusából (ár, készlet, méret, szűrés, kategória).
- "both": mindkettő kell (pl. "milyen pozsgást vegyek és hogyan gondozzam").
Adj rövid magyar indoklást (reasoning).`;

export interface RouterDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5); alapból "unknown". */
  readonly modelId?: string;
  readonly generateObject?: GenerateObjectFn;
}

export type Router = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<RouterResult>;

/** Létrehozza a router-függvényt (a modell és a generateObject bekötve). */
export function createRouter(deps: RouterDeps): Router {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question, history = []) => {
    const { object, usage } = await run({
      model: deps.model,
      schema: routerSchema,
      system: ROUTER_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return {
      ...object,
      usage: usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined,
    };
  };
}
