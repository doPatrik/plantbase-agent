// A /api/debug/search kontraktusa (SP3b): a HyDE ki/be × rerank előtt/után
// összehasonlító mátrix, hogy a HyDE és a rerank hatása külön-külön mérhető legyen.
// A backend a határon validál vele, az SP4 frontend típusosan fogyasztja.

import { z } from 'zod';

export const debugHitSchema = z.object({
  rank: z.number().int().nonnegative(),
  documentId: z.number().int(),
  title: z.string(),
  headingPath: z.string().nullable(),
  sourcePath: z.string(),
  similarity: z.number(),
  contentPreview: z.string(),
});
export type DebugHit = z.infer<typeof debugHitSchema>;

export const rerankedDebugHitSchema = debugHitSchema.extend({
  /** A találat helye a nyers (rerank előtti) retrieval-listában. */
  prevRank: z.number().int(),
});
export type RerankedDebugHit = z.infer<typeof rerankedDebugHitSchema>;

export const retrievalDebugBranchSchema = z.object({
  retrieval: z.array(debugHitSchema),
  rerank: z.object({
    degraded: z.boolean(),
    results: z.array(rerankedDebugHitSchema),
  }),
});
export type RetrievalDebugBranch = z.infer<typeof retrievalDebugBranchSchema>;

export const retrievalDebugResultSchema = z.object({
  query: z.string(),
  hydeDoc: z.string(),
  /** A query nyers embeddingjével futtatott ág. */
  raw: retrievalDebugBranchSchema,
  /** A HyDE-dokumentum embeddingjével futtatott ág. */
  hyde: retrievalDebugBranchSchema,
});
export type RetrievalDebugResult = z.infer<typeof retrievalDebugResultSchema>;

export const retrievalDebugRequestSchema = z.object({
  query: z.string().min(1, 'A query nem lehet üres.'),
  topK: z.number().int().positive().optional(),
  rerankTopN: z.number().int().positive().optional(),
});
export type RetrievalDebugRequest = z.infer<typeof retrievalDebugRequestSchema>;
