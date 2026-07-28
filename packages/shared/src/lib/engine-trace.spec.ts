import { traceEventSchema, type TraceEvent } from './engine-trace.js';

describe('traceEventSchema', () => {
  it('parses a router event', () => {
    const event: TraceEvent = {
      type: 'router',
      route: 'both',
      reasoning: 'A kérdés tudásra és katalógusra is vonatkozik.',
    };
    expect(traceEventSchema.parse(event)).toEqual(event);
  });

  it('parses a guardrail event', () => {
    const event: TraceEvent = {
      type: 'guardrail',
      grounded: false,
      maxSimilarity: 0.21,
      threshold: 0.35,
    };
    expect(traceEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown route', () => {
    const bad = { type: 'router', route: 'nope', reasoning: 'x' };
    expect(traceEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const bad = { type: 'telepathy' };
    expect(traceEventSchema.safeParse(bad).success).toBe(false);
  });
});
