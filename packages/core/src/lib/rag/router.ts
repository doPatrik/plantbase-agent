// LLM-router (SP3a): eldönti, hogy a kérdés a tudásbázisra (knowledge), a
// katalógusra (catalog), vagy mindkettőre (both) vonatkozik. Olcsó Haiku modell,
// zod-strukturált kimenet (generateObject). A generateObject injektálható a
// teszthez (DI-minta, vö. embedding.ts embedMany).

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { chatRouteSchema, type ChatRoute } from '@plantbase/shared';

/** A router strukturált kimenete. */
export interface RouterResult {
  readonly route: ChatRoute;
  readonly reasoning: string;
}

const routerSchema = z.object({
  route: chatRouteSchema,
  reasoning: z.string(),
});

/** Szűk, injektálható generateObject (csak amit a router használ). */
export type GenerateObjectFn = <T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
}) => Promise<{ object: T }>;

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object } = await generateObject({ model, schema, system, prompt });
  return { object };
};

const ROUTER_SYSTEM = `Te a Plantbase asszisztens útvonalválasztója vagy. Döntsd el, honnan jöhet a válasz:
- "knowledge": általános növénygondozási / ismeretkérdés (a tudásbázis cikkeiből).
- "catalog": konkrét termékadat a webshop katalógusából (ár, készlet, méret, szűrés, kategória).
- "both": mindkettő kell (pl. "milyen pozsgást vegyek és hogyan gondozzam").
Adj rövid magyar indoklást (reasoning).`;

export interface RouterDeps {
  readonly model: LanguageModel;
  readonly generateObject?: GenerateObjectFn;
}

export type Router = (question: string) => Promise<RouterResult>;

/** Létrehozza a router-függvényt (a modell és a generateObject bekötve). */
export function createRouter(deps: RouterDeps): Router {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question) => {
    const { object } = await run({
      model: deps.model,
      schema: routerSchema,
      system: ROUTER_SYSTEM,
      prompt: `Kérdés: ${question}`,
    });
    return object;
  };
}
