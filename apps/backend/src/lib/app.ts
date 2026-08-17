// A backend Express-app factory (SP3b). DI-minta: minden külső hatás injektált
// (chat/retrievalDebug/chunkStats/health), így supertest-tel, hálózat/DB nélkül
// tesztelhető. A /api/chat a Vercel AI SDK v7 UI Message Stream-jét streameli:
// text-delta a válasznak, data-trace a trace-nek (csak DEBUG), data-sources a végén.

import express, { type Express, type Request, type Response } from 'express';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import {
  chatRequestSchema,
  retrievalDebugRequestSchema,
  costEstimateRequestSchema,
  escalationResolveRequestSchema,
  type ChatMessage,
  type OnTrace,
  type RetrievalDebugResult,
  type CostEstimate,
  type EscalationTicket,
} from '@plantbase/shared';
import {
  EscalationNotFoundError,
  EscalationAlreadyResolvedError,
  type ChatRun,
  type ChunkStats,
} from '@plantbase/core';

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
  readonly costEstimate: (query: string) => Promise<CostEstimate>;
  readonly chunkStats: () => Promise<ChunkStats>;
  readonly health: () => Promise<HealthReport>;
  readonly listEscalations: () => Promise<readonly EscalationTicket[]>;
  readonly resolveEscalation: (
    id: string,
    reply: string,
  ) => Promise<EscalationTicket>;
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

/** Igaz, ha a hiba az OpenAI embedding-kulcs hiányára utal. */
function isMissingKeyError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('OPENAI_API_KEY') || msg.includes('embedding-konfiguráció')
  );
}

function registerDebug(app: Express, deps: BackendDeps): void {
  app.get('/api/debug/chunks', async (_req: Request, res: Response) => {
    try {
      res.json(await deps.chunkStats());
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/debug/search', async (req: Request, res: Response) => {
    const parsed = retrievalDebugRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Hibás kérés.' });
      return;
    }
    const { query, topK, rerankTopN } = parsed.data;
    try {
      res.json(await deps.retrievalDebug(query, { topK, rerankTopN }));
    } catch (error) {
      const status = isMissingKeyError(error) ? 503 : 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function registerCost(app: Express, deps: BackendDeps): void {
  app.post('/api/debug/cost', async (req: Request, res: Response) => {
    const parsed = costEstimateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Hibás kérés.' });
      return;
    }
    try {
      res.json(await deps.costEstimate(parsed.data.query));
    } catch (error) {
      const status = isMissingKeyError(error) ? 503 : 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function registerEscalations(app: Express, deps: BackendDeps): void {
  app.get('/api/escalations', async (_req: Request, res: Response) => {
    res.json(await deps.listEscalations());
  });

  app.post(
    '/api/escalations/:id/resolve',
    async (req: Request, res: Response) => {
      const parsed = escalationResolveRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message ?? 'Hibás kérés.' });
        return;
      }
      try {
        const ticket = await deps.resolveEscalation(
          String(req.params.id),
          parsed.data.reply,
        );
        res.json(ticket);
      } catch (error) {
        if (error instanceof EscalationNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        if (error instanceof EscalationAlreadyResolvedError) {
          res.status(409).json({ error: error.message });
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}

function registerHealth(app: Express, deps: BackendDeps): void {
  app.get('/api/health', async (_req: Request, res: Response) => {
    const report = await deps.health();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });
}

/** Létrehozza a backend Express-appot az injektált függőségekkel. */
export function createApp(deps: BackendDeps): Express {
  const app = express();
  app.use(express.json());
  registerChat(app, deps);
  registerDebug(app, deps);
  registerCost(app, deps);
  registerEscalations(app, deps);
  registerHealth(app, deps);
  return app;
}
