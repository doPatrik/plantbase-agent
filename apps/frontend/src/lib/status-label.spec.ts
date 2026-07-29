import { describe, it, expect } from 'vitest';
import { statusLabel } from './status-label';
import type { TraceEvent } from '@plantbase/shared';

describe('statusLabel', () => {
  it('üres trace → általános címke', () => {
    expect(statusLabel([])).toBe('Gondolkodom…');
  });

  it('a legutóbbi ismert stage címkéjét adja', () => {
    const trace: TraceEvent[] = [
      { type: 'router', route: 'knowledge', reasoning: '' },
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.6 },
    ];
    expect(statusLabel(trace)).toBe('Dokumentumok keresése…');
  });

  it('minden ismert stage-hez van magyar címke', () => {
    const cases: [TraceEvent['type'], string][] = [
      ['router', 'Útvonalválasztás…'],
      ['hyde', 'Hipotetikus válasz…'],
      ['retrieval', 'Dokumentumok keresése…'],
      ['rerank', 'Reranking…'],
      ['guardrail', 'Ellenőrzés…'],
      ['answer-start', 'Válasz generálása…'],
    ];
    for (const [type, label] of cases) {
      expect(statusLabel([{ type } as TraceEvent])).toBe(label);
    }
  });

  it('ismeretlen/nem-stage esemény után visszaesik az utolsó ismertre', () => {
    const trace: TraceEvent[] = [
      { type: 'rerank', inputCount: 8, outputCount: 4, degraded: false },
      {
        type: 'usage',
        stage: 'rerank',
        model: 'haiku',
        inputTokens: 1,
        outputTokens: 1,
      },
    ];
    expect(statusLabel(trace)).toBe('Reranking…');
  });
});
