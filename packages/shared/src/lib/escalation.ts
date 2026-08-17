// Eszkalációs jegy DTO-k (HF5 — ügyfélirányú use case): amikor a RAG-pipeline
// guardrail-je bizonytalan, egy eszkalációs jegy nyílik. A jegyet a support-nézet
// listázza, és egy ember zárja le jóváhagyott válasszal, mielőtt az kimenne az
// ügyfélnek. Az append-only JSONL-tárolás a core escalation-store.ts-ben él;
// ez a fájl csak a HTTP-határ szerződése (kérés/válasz alak).

import { z } from 'zod';

export type EscalationStatus = 'pending' | 'resolved';

/** Egy eszkalációs jegy: nyitáskor pending, jóváhagyáskor resolved + reply. */
export interface EscalationTicket {
  readonly id: string;
  readonly createdAt: string;
  readonly question: string;
  readonly maxSimilarity: number;
  readonly reason: 'low_grounding';
  readonly status: EscalationStatus;
  readonly reply: string | null;
  readonly resolvedAt: string | null;
}

export const escalationTicketSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  question: z.string(),
  maxSimilarity: z.number(),
  reason: z.literal('low_grounding'),
  status: z.enum(['pending', 'resolved']),
  reply: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});

export const escalationListSchema = z.array(escalationTicketSchema);

/** A support-nézet jóváhagyó kérése (POST /api/escalations/:id/resolve body-ja). */
export interface EscalationResolveRequest {
  readonly reply: string;
}

export const escalationResolveRequestSchema = z.object({
  reply: z.string().min(1, 'A válasz nem lehet üres.'),
});
