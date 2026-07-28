// Az engine-trace kontraktus (SP3a): a RAG-pipeline stage-ei erre a diszkriminált
// unióra emittálnak egy injektált onTrace(event) callbacken át. A core emittál,
// a CLI (DEBUG=true) formázva kiírja; SP3b ugyanezt data-streamként küldi a frontendnek.
// A boundary-validációhoz zod séma is tartozik (nem megbízható forrásból érkező
// trace ellenőrzéséhez, pl. SP3b HTTP-határon).

import { z } from 'zod';

/** A router által választható útvonalak. */
export type ChatRoute = 'knowledge' | 'catalog' | 'both';

export const chatRouteSchema = z.enum(['knowledge', 'catalog', 'both']);

export const traceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('router'),
    route: chatRouteSchema,
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal('hyde'),
    hydeDoc: z.string(),
  }),
  z.object({
    type: z.literal('retrieval'),
    topK: z.number().int().nonnegative(),
    resultCount: z.number().int().nonnegative(),
    maxSimilarity: z.number(),
  }),
  z.object({
    type: z.literal('rerank'),
    inputCount: z.number().int().nonnegative(),
    outputCount: z.number().int().nonnegative(),
    degraded: z.boolean(),
  }),
  z.object({
    type: z.literal('guardrail'),
    grounded: z.boolean(),
    maxSimilarity: z.number(),
    threshold: z.number(),
  }),
  z.object({
    type: z.literal('answer-start'),
  }),
  z.object({
    type: z.literal('answer-delta'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('usage'),
    stage: z.string(),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    stage: z.string(),
    message: z.string(),
  }),
]);

/** A trace-esemény diszkriminált unió (a zod sémából levezetve). */
export type TraceEvent = z.infer<typeof traceEventSchema>;

/** A pipeline stage-ek trace-callbackje (injektálható; alapból no-op). */
export type OnTrace = (event: TraceEvent) => void;

/** No-op trace (ha nincs megfigyelő). */
export const noopTrace: OnTrace = () => {
  /* no-op */
};
