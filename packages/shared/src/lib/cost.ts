// A /api/debug/cost kontraktusa (SP5): a tudás-út teljes futtatásának
// stage-enkénti (router/hyde/embedding/rerank/answer) token-usage-e + a
// modellenkénti default listaárak. A computeStageCost pure util — a frontend
// ezzel számolja élőben (LLM-hívás nélkül) a szerkeszthető árakból az USD-t.

import { z } from 'zod';

export interface StageUsageDto {
  readonly stage: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const stageUsageDtoSchema = z.object({
  stage: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export interface ModelPrice {
  readonly inputPerM: number;
  readonly outputPerM: number;
}

export const modelPriceSchema = z.object({
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
});

export interface CostEstimate {
  readonly query: string;
  /** A becslő a scope szerint mindig a tudás-utat méri. */
  readonly route: 'knowledge';
  readonly stages: readonly StageUsageDto[];
  readonly defaultPrices: Readonly<Record<string, ModelPrice>>;
}

export const costEstimateSchema = z.object({
  query: z.string(),
  route: z.literal('knowledge'),
  stages: z.array(stageUsageDtoSchema),
  defaultPrices: z.record(z.string(), modelPriceSchema),
});

export const costEstimateRequestSchema = z.object({
  query: z.string().min(1, 'A query nem lehet üres.'),
});
export type CostEstimateRequest = z.infer<typeof costEstimateRequestSchema>;

export interface StageCost {
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly totalUsd: number;
}

/** Pure util: egy stage usage-éből az USD-költség. Ismeretlen (hiányzó) árra nulla. */
export function computeStageCost(
  usage: StageUsageDto,
  price: ModelPrice | undefined,
): StageCost {
  if (!price) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalUsd: 0 };
  }
  const inputCostUsd = (usage.inputTokens / 1_000_000) * price.inputPerM;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * price.outputPerM;
  return {
    inputCostUsd,
    outputCostUsd,
    totalUsd: inputCostUsd + outputCostUsd,
  };
}
