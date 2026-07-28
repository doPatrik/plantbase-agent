import { describe, it, expect } from 'vitest';
import { buildRunRecord } from './run-log.js';
import type { BuildSummary } from './pipeline.js';

const summary: BuildSummary = {
  built: 12,
  skipped: 190,
  chunks: 448,
  errors: 0,
  embeddedTokens: 304812,
  estimatedCostUsd: 0.0061,
};

describe('buildRunRecord', () => {
  it('maps the summary and meta into a JSONL-ready record', () => {
    const record = buildRunRecord(summary, {
      ts: '2026-07-28T10:00:00.000Z',
      force: false,
      model: 'text-embedding-3-small',
      pricePerMillionTokens: 0.02,
    });

    expect(record).toEqual({
      ts: '2026-07-28T10:00:00.000Z',
      command: 'build',
      force: false,
      built: 12,
      skipped: 190,
      chunks: 448,
      errors: 0,
      embeddedTokens: 304812,
      estimatedCostUsd: 0.0061,
      model: 'text-embedding-3-small',
      pricePerMillionTokens: 0.02,
    });
  });

  it('serializes to a single JSON line', () => {
    const record = buildRunRecord(summary, {
      ts: '2026-07-28T10:00:00.000Z',
      force: true,
      model: null,
      pricePerMillionTokens: null,
    });
    const line = JSON.stringify(record);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line).force).toBe(true);
    expect(JSON.parse(line).model).toBeNull();
  });
});
