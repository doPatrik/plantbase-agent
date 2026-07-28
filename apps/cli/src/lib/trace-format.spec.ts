import { formatTraceEvent } from './trace-format.js';
import type { TraceEvent } from '@plantbase/shared';

describe('formatTraceEvent', () => {
  it('formats a router event', () => {
    const event: TraceEvent = {
      type: 'router',
      route: 'knowledge',
      reasoning: 'r',
    };
    const line = formatTraceEvent(event);
    expect(line).toContain('router');
    expect(line).toContain('knowledge');
  });

  it('formats a guardrail event with similarity and threshold', () => {
    const event: TraceEvent = {
      type: 'guardrail',
      grounded: false,
      maxSimilarity: 0.21,
      threshold: 0.35,
    };
    const line = formatTraceEvent(event);
    expect(line).toContain('guardrail');
    expect(line).toContain('0.21');
    expect(line).toContain('0.35');
  });

  it('suppresses answer-delta events (returns null)', () => {
    expect(formatTraceEvent({ type: 'answer-delta', text: 'x' })).toBeNull();
  });

  it('formats an answer-start event', () => {
    expect(formatTraceEvent({ type: 'answer-start' })).toContain('answer');
  });
});
