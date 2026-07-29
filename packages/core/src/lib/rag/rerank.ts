// Rerank stage (SP3a): a top-K chunkot relevancia szerint újrarendezi (Haiku), és
// az első topN-et tartja meg. A modell a chunkok INDEXEIT adja vissza sorrendben
// (0-alapú), így a tartalmat nem kell visszaküldenie. Hibára / érvénytelen indexre
// DEGRADÁL: a nyers retrieval-sorrend első topN eleme megy tovább (degraded: true).
// Így a "rerank mindig lefut és nem dönti be a pipeline-t" garancia teljesül.
// A usage (SP5) csak sikeres hívásnál elérhető; degradált ágon undefined.

import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { SearchResult } from '../knowledge-store.js';
import type { GenerateObjectFn } from './router.js';
import { generateObject } from 'ai';
import type { StageUsage } from './usage.js';

const rerankSchema = z.object({
  ranking: z.array(z.number().int().nonnegative()),
});

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

const RERANK_SYSTEM = `Rangsorold a számozott dokumentum-részleteket a kérdés szempontjából relevancia szerint (legrelevánsabb elöl). A "ranking" mezőben a részletek 0-alapú indexeit add vissza, csökkenő relevancia sorrendben. Csak a valóban releváns részletek indexeit sorold fel.`;

export interface RerankOutcome {
  readonly chunks: SearchResult[];
  readonly degraded: boolean;
  /** A rerank-hívás token-usage-e (SP5); hiányzik degradált (hiba/érvénytelen) ágon. */
  readonly usage?: StageUsage;
}

export interface RerankDeps {
  readonly model: LanguageModel;
  readonly topN: number;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
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
      const { object, usage } = await run({
        model: deps.model,
        schema: rerankSchema,
        system: RERANK_SYSTEM,
        prompt: `Kérdés: ${question}\n\nRészletek:\n${numbered}`,
      });
      const stageUsage: StageUsage | undefined = usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined;
      const seen = new Set<number>();
      const picked: SearchResult[] = [];
      for (const index of object.ranking) {
        if (index < 0 || index >= chunks.length || seen.has(index)) {
          return {
            chunks: rawTopN(chunks, deps.topN),
            degraded: true,
            usage: stageUsage,
          };
        }
        seen.add(index);
        picked.push(chunks[index]);
        if (picked.length >= deps.topN) break;
      }
      if (picked.length === 0) {
        return {
          chunks: rawTopN(chunks, deps.topN),
          degraded: true,
          usage: stageUsage,
        };
      }
      return { chunks: picked, degraded: false, usage: stageUsage };
    } catch {
      return { chunks: rawTopN(chunks, deps.topN), degraded: true };
    }
  };
}
