import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusIndicator } from './status-indicator';
import type { TraceEvent } from '@plantbase/shared';

describe('StatusIndicator', () => {
  it('üres trace → „Gondolkodom…"', () => {
    render(<StatusIndicator trace={[]} />);
    expect(screen.getByText('Gondolkodom…')).toBeInTheDocument();
  });

  it('retrieval trace → „Dokumentumok keresése…"', () => {
    const trace: TraceEvent[] = [
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.6 },
    ];
    render(<StatusIndicator trace={trace} />);
    expect(screen.getByText('Dokumentumok keresése…')).toBeInTheDocument();
  });
});
