import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TracePanel, describeTrace } from './trace-panel';
import type { TraceEvent } from '@plantbase/shared';

describe('describeTrace', () => {
  it('router eseményt leír', () => {
    const d = describeTrace({
      type: 'router',
      route: 'knowledge',
      reasoning: 'r',
    });
    expect(d.label).toContain('Router');
    expect(d.detail).toContain('knowledge');
  });

  it('retrieval eseményt leír a similarityvel', () => {
    const d = describeTrace({
      type: 'retrieval',
      topK: 8,
      resultCount: 5,
      maxSimilarity: 0.62,
    });
    expect(d.detail).toContain('0.62');
    expect(d.detail).toContain('5');
  });
});

describe('TracePanel', () => {
  it('üres trace → nem renderel', () => {
    const { container } = render(<TracePanel trace={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a stage-eket kilistázza', () => {
    const trace: TraceEvent[] = [
      { type: 'router', route: 'both', reasoning: 'mindkettő' },
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.7 },
      { type: 'rerank', inputCount: 8, outputCount: 4, degraded: false },
      {
        type: 'guardrail',
        grounded: true,
        maxSimilarity: 0.7,
        threshold: 0.35,
      },
    ];
    render(<TracePanel trace={trace} />);
    fireEvent.click(screen.getByText(/engine trace/));
    expect(screen.getByText(/Router/)).toBeInTheDocument();
    expect(screen.getByText(/Retrieval/)).toBeInTheDocument();
    expect(screen.getByText(/Rerank/)).toBeInTheDocument();
    expect(screen.getByText(/Guardrail/)).toBeInTheDocument();
  });
});
