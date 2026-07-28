// DEBUG engine-trace formázás a terminálra (SP3a). Egy TraceEvent → egy ember-
// olvasható sor (stderr-re megy, hogy ne keveredjen a válasz stdout-streamjével).
// Az answer-delta eseményeket NEM írjuk ki (a token maga a stdout-streamben jön).

import type { TraceEvent } from '@plantbase/shared';

function fixed(n: number): string {
  return n.toFixed(2);
}

/** Egy trace-esemény ember-olvasható sora, vagy null (ha nem írjuk ki). */
export function formatTraceEvent(event: TraceEvent): string | null {
  switch (event.type) {
    case 'router':
      return `[trace] router → ${event.route} (${event.reasoning})`;
    case 'hyde':
      return `[trace] hyde → ${event.hydeDoc.slice(0, 80)}…`;
    case 'retrieval':
      return `[trace] retrieval → ${event.resultCount} találat (max sim ${fixed(event.maxSimilarity)})`;
    case 'rerank':
      return `[trace] rerank → ${event.inputCount}→${event.outputCount}${event.degraded ? ' (degradált)' : ''}`;
    case 'guardrail':
      return `[trace] guardrail → grounded=${event.grounded} (max sim ${fixed(event.maxSimilarity)}, küszöb ${fixed(event.threshold)})`;
    case 'answer-start':
      return '[trace] answer → generálás…';
    case 'usage':
      return `[trace] usage(${event.stage}) → be ${event.inputTokens} / ki ${event.outputTokens} tok (${event.model})`;
    case 'error':
      return `[trace] error(${event.stage}) → ${event.message}`;
    case 'answer-delta':
      return null;
  }
}
