// A backend Express-app factory (SP3b). DI-minta: minden külső hatás injektált
// (chat/retrievalDebug/chunkStats/health), így supertest-tel, hálózat/DB nélkül
// tesztelhető. A /api/chat a Vercel AI SDK v7 UI Message Stream-jét streameli:
// text-delta a válasznak, data-trace a trace-nek (csak DEBUG), data-sources a végén.

import express, { type Express, type Request, type Response } from 'express';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import {
  chatRequestSchema,
  type ChatMessage,
  type OnTrace,
  type RetrievalDebugResult,
} from '@plantbase/shared';
import type { ChatRun, ChunkStats } from '@plantbase/core';

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly checks: {
    readonly database: boolean;
    readonly anthropicKey: boolean;
    readonly openaiKey: boolean;
  };
}

export interface BackendDeps {
  readonly chat: (
    messages: readonly ChatMessage[],
    onTrace: OnTrace,
  ) => Promise<ChatRun>;
  readonly retrievalDebug: (
    query: string,
    opts: { topK?: number; rerankTopN?: number },
  ) => Promise<RetrievalDebugResult>;
  readonly chunkStats: () => Promise<ChunkStats>;
  readonly health: () => Promise<HealthReport>;
  readonly debug: boolean;
}

const TEXT_PART_ID = 'answer';

function registerChat(app: Express, deps: BackendDeps): void {
  app.post('/api/chat', (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Hibás kérés.' });
      return;
    }
    const messages = parsed.data.messages;

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' });
        const onTrace: OnTrace = (event) => {
          if (deps.debug) {
            writer.write({ type: 'data-trace', data: event, transient: true });
          }
        };
        const run = await deps.chat(messages, onTrace);
        writer.write({ type: 'text-start', id: TEXT_PART_ID });
        for await (const delta of run.textStream) {
          writer.write({ type: 'text-delta', id: TEXT_PART_ID, delta });
        }
        writer.write({ type: 'text-end', id: TEXT_PART_ID });
        const answer = await run.result;
        writer.write({
          type: 'data-sources',
          data: { route: answer.route, sources: answer.sources },
        });
      },
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    });

    pipeUIMessageStreamToResponse({ stream, response: res });
  });
}

/** Létrehozza a backend Express-appot az injektált függőségekkel. */
export function createApp(deps: BackendDeps): Express {
  const app = express();
  app.use(express.json());
  registerChat(app, deps);
  return app;
}
