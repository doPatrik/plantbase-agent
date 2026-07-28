// Rerank stage (SP3a): a top-K chunkot relevancia szerint újrarendezi (Haiku), és
// az első topN-et tartja meg. A modell a chunkok INDEXEIT adja vissza sorrendben
// (0-alapú), így a tartalmat nem kell visszaküldenie. Hibára / érvénytelen indexre
// DEGRADÁL: a nyers retrieval-sorrend első topN eleme megy tovább (degraded: true).
// Így a "rerank mindig lefut és nem dönti be a pipeline-t" garancia teljesül.

import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { SearchResult } from '../knowledge-store.js';
import type { GenerateObjectFn } from './router.js';
import { generateObject } from 'ai';

const rerankSchema = z.object({
  ranking: z.array(z.number().int().nonnegative()),
});

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object } = await generateObject({ model, schema, system, prompt });
  return { object };
};

const RERANK_SYSTEM = `Rangsorold a számozott dokumentum-részleteket a kérdés szempontjából relevancia szerint (legrelevánsabb elöl). A "ranking" mezőben a részletek 0-alapú indexeit add vissza, csökkenő relevancia sorrendben. Csak a valóban releváns részletek indexeit sorold fel.`;

/** A rerank kimenete: a megtartott chunkok + jelzés, hogy degradált-e. */
export interface RerankOutcome {
  readonly chunks: SearchResult[];
  readonly degraded: boolean;
}

export interface RerankDeps {
  readonly model: LanguageModel;
  readonly topN: number;
  readonly generateObject?: GenerateObjectFn;
}

export type Rerank = (
  question: string,
  chunks: readonly SearchResult[],
) => Promise<RerankOutcome>;

function rawTopN(
  chunks: readonly SearchResult[],
  topN: number,
): SearchResult[] {
  return chunks.slice(0, topN);
}

/** Létrehozza a rerank-függvényt. */
export function createRerank(deps: RerankDeps): Rerank {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question, chunks) => {
    if (chunks.length === 0) {
      return { chunks: [], degraded: false };
    }
    const numbered = chunks
      .map(
        (c, i) =>
          `[${i}] ${c.title}${c.heading_path ? ` — ${c.heading_path}` : ''}\n${c.content}`,
      )
      .join('\n\n');
    try {
      const { object } = await run({
        model: deps.model,
        schema: rerankSchema,
        system: RERANK_SYSTEM,
        prompt: `Kérdés: ${question}\n\nRészletek:\n${numbered}`,
      });
      const seen = new Set<number>();
      const picked: SearchResult[] = [];
      for (const index of object.ranking) {
        if (index < 0 || index >= chunks.length || seen.has(index)) {
          return { chunks: rawTopN(chunks, deps.topN), degraded: true };
        }
        seen.add(index);
        picked.push(chunks[index]);
        if (picked.length >= deps.topN) break;
      }
      if (picked.length === 0) {
        return { chunks: rawTopN(chunks, deps.topN), degraded: true };
      }
      return { chunks: picked, degraded: false };
    } catch {
      return { chunks: rawTopN(chunks, deps.topN), degraded: true };
    }
  };
}
