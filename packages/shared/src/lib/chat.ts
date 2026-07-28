// Chat DTO-k (SP3a): a RAG-válasz és forráshivatkozásai, valamint a chat-kérés
// alakja. Már most bevezetjük az SP3b HTTP-határra: a core produkálja, a CLI és
// később az Express/React fogyasztja. A `source_path` a citációhoz kell (fájlnév,
// ha nincs URL). A dependency-irány helyes: frontend → shared, nem → core.

import { z } from 'zod';
import { chatRouteSchema, type ChatRoute } from './engine-trace.js';

/** Egy forráshivatkozás a válaszhoz (grounding). */
export interface SourceRef {
  readonly title: string;
  readonly sourceUrl: string | null;
  readonly sourcePath: string;
  readonly headingPath: string | null;
}

export const sourceRefSchema = z.object({
  title: z.string(),
  sourceUrl: z.string().nullable(),
  sourcePath: z.string(),
  headingPath: z.string().nullable(),
});

/** Egy chat-üzenet (SP3b multi-turn előkészítése). */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

/** Chat-kérés (SP3b `POST /api/chat` body-ja). */
export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
}

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

/** A RAG-pipeline végleges (nem streamelt) válasza + forráshivatkozásai. */
export interface RagAnswer {
  readonly text: string;
  readonly route: ChatRoute;
  readonly sources: readonly SourceRef[];
}

export const ragAnswerSchema = z.object({
  text: z.string(),
  route: chatRouteSchema,
  sources: z.array(sourceRefSchema),
});
