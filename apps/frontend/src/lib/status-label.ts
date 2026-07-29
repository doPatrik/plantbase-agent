import type { TraceEvent } from '@plantbase/shared';

const STAGE_LABELS: Record<string, string> = {
  router: 'Útvonalválasztás…',
  hyde: 'Hipotetikus válasz…',
  retrieval: 'Dokumentumok keresése…',
  rerank: 'Reranking…',
  guardrail: 'Ellenőrzés…',
  'answer-start': 'Válasz generálása…',
};

/**
 * A legutóbbi ismert pipeline-stage magyar loading-címkéje.
 * Üres trace vagy csak ismeretlen/mellékes esemény (usage/answer-delta/error)
 * esetén az általános „Gondolkodom…"-ot adja (ez a DEBUG=false eset is).
 */
export function statusLabel(trace: readonly TraceEvent[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const label = STAGE_LABELS[trace[i].type];
    if (label) return label;
  }
  return 'Gondolkodom…';
}
