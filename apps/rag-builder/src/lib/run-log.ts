// A rag-builder futás-összegzőjéből egy JSONL run-log rekordot állít elő
// (költség/token-történet). A fájlírás a main.ts-ben, a core createJsonlLogger-rel
// megy; ez a modul csak a rekord alakját adja (tiszta, tesztelhető).

import type { BuildSummary } from './pipeline.js';

/** Egy rag-builder futás naplósora (logs/rag-builder/<timestamp>.jsonl). */
export interface RunLogRecord {
  readonly ts: string;
  readonly command: 'build';
  readonly force: boolean;
  readonly built: number;
  readonly skipped: number;
  readonly chunks: number;
  readonly errors: number;
  readonly embeddedTokens: number;
  readonly estimatedCostUsd: number;
  readonly model: string | null;
  readonly pricePerMillionTokens: number | null;
}

export interface RunLogMeta {
  readonly ts: string;
  readonly force: boolean;
  readonly model: string | null;
  readonly pricePerMillionTokens: number | null;
}

/** A BuildSummary + metaadat → egy JSONL-be írható run-log rekord. */
export function buildRunRecord(
  summary: BuildSummary,
  meta: RunLogMeta,
): RunLogRecord {
  return {
    ts: meta.ts,
    command: 'build',
    force: meta.force,
    built: summary.built,
    skipped: summary.skipped,
    chunks: summary.chunks,
    errors: summary.errors,
    embeddedTokens: summary.embeddedTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
    model: meta.model,
    pricePerMillionTokens: meta.pricePerMillionTokens,
  };
}
