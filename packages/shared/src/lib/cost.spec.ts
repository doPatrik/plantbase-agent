import { describe, it, expect } from 'vitest';
import {
  computeStageCost,
  costEstimateSchema,
  type StageUsageDto,
} from './cost.js';

const usage: StageUsageDto = {
  stage: 'answer',
  model: 'claude-sonnet-4-6',
  inputTokens: 2_000_000,
  outputTokens: 1_000_000,
};

describe('computeStageCost', () => {
  it('kiszámolja az input/output/összesített USD-t az árból', () => {
    const cost = computeStageCost(usage, { inputPerM: 3, outputPerM: 15 });
    expect(cost.inputCostUsd).toBeCloseTo(6);
    expect(cost.outputCostUsd).toBeCloseTo(15);
    expect(cost.totalUsd).toBeCloseTo(21);
  });

  it('nulla token esetén nulla költséget ad', () => {
    const cost = computeStageCost(
      { ...usage, inputTokens: 0, outputTokens: 0 },
      { inputPerM: 3, outputPerM: 15 },
    );
    expect(cost.totalUsd).toBe(0);
  });

  it('ismeretlen (hiányzó) ár esetén nulla költséget ad', () => {
    const cost = computeStageCost(usage, undefined);
    expect(cost).toEqual({ inputCostUsd: 0, outputCostUsd: 0, totalUsd: 0 });
  });
});

describe('costEstimateSchema', () => {
  it('elfogadja az érvényes alakot', () => {
    const parsed = costEstimateSchema.safeParse({
      query: 'kérdés',
      route: 'knowledge',
      stages: [usage],
      defaultPrices: { 'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 } },
    });
    expect(parsed.success).toBe(true);
  });

  it('elutasítja a route: "catalog"-ot (a becslő mindig knowledge)', () => {
    const parsed = costEstimateSchema.safeParse({
      query: 'kérdés',
      route: 'catalog',
      stages: [],
      defaultPrices: {},
    });
    expect(parsed.success).toBe(false);
  });
});
