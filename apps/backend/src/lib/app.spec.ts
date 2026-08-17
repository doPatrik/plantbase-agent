import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  EscalationNotFoundError,
  EscalationAlreadyResolvedError,
  type ChatRun,
} from '@plantbase/core';
import type { RagAnswer, EscalationTicket } from '@plantbase/shared';
import { createApp, type BackendDeps } from './app.js';

function fakeChatRun(text: string, answer: RagAnswer): ChatRun {
  return {
    textStream: (async function* () {
      yield text;
    })(),
    result: Promise.resolve(answer),
  };
}

function makeDeps(over: Partial<BackendDeps> = {}): BackendDeps {
  return {
    chat: async (_messages, onTrace) => {
      onTrace({ type: 'router', route: 'knowledge', reasoning: 'teszt' });
      return fakeChatRun('Szia!', {
        text: 'Szia!',
        route: 'knowledge',
        sources: [
          {
            title: 'Cikk',
            sourceUrl: null,
            sourcePath: 'c.md',
            headingPath: null,
          },
        ],
      });
    },
    retrievalDebug: async () => {
      throw new Error('nem hívandó');
    },
    costEstimate: async () => {
      throw new Error('nem hívandó');
    },
    chunkStats: async () => {
      throw new Error('nem hívandó');
    },
    health: async () => ({
      status: 'ok',
      checks: { database: true, anthropicKey: true, openaiKey: true },
    }),
    listEscalations: async () => {
      throw new Error('nem hívandó');
    },
    resolveEscalation: async () => {
      throw new Error('nem hívandó');
    },
    debug: false,
    ...over,
  };
}

describe('POST /api/chat', () => {
  it('streameli a válasz-szöveget és a forrásokat', async () => {
    const app = createApp(makeDeps());
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Szia' }] });
    expect(res.status).toBe(200);
    expect(res.text).toContain('text-delta');
    expect(res.text).toContain('Szia!');
    expect(res.text).toContain('data-sources');
    expect(res.text).toContain('c.md');
  });

  it('DEBUG=false esetén NEM küld data-trace partot', async () => {
    const app = createApp(makeDeps({ debug: false }));
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Szia' }] });
    expect(res.text).not.toContain('data-trace');
  });

  it('DEBUG=true esetén küld data-trace partot', async () => {
    const app = createApp(makeDeps({ debug: true }));
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Szia' }] });
    expect(res.text).toContain('data-trace');
    expect(res.text).toContain('router');
  });

  it('400-at ad üres messages tömbre', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).post('/api/chat').send({ messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('400-at ad hibás role-ra', async () => {
    const app = createApp(makeDeps());
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'system', content: 'x' }] });
    expect(res.status).toBe(400);
  });
});

describe('debug + health endpoints', () => {
  const stats = {
    document_count: 202,
    chunk_count: 448,
    embedded_chunk_count: 448,
    avg_chunk_chars: 300,
    min_chunk_chars: 50,
    max_chunk_chars: 800,
  };

  it('GET /api/debug/chunks visszaadja a statisztikát', async () => {
    const app = createApp(makeDeps({ chunkStats: async () => stats }));
    const res = await request(app).get('/api/debug/chunks');
    expect(res.status).toBe(200);
    expect(res.body.chunk_count).toBe(448);
  });

  it('POST /api/debug/search visszaadja az összehasonlító mátrixot', async () => {
    const branch = {
      retrieval: [],
      rerank: { degraded: false, results: [] },
    };
    const app = createApp(
      makeDeps({
        retrievalDebug: async (query) => ({
          query,
          hydeDoc: 'h',
          raw: branch,
          hyde: branch,
        }),
      }),
    );
    const res = await request(app)
      .post('/api/debug/search')
      .send({ query: 'pozsgás' });
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('pozsgás');
    expect(res.body.raw).toBeTruthy();
    expect(res.body.hyde).toBeTruthy();
  });

  it('POST /api/debug/search 400 üres query-re', async () => {
    const app = createApp(makeDeps());
    const res = await request(app)
      .post('/api/debug/search')
      .send({ query: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/debug/search 503, ha hiányzik az OpenAI-kulcs', async () => {
    const app = createApp(
      makeDeps({
        retrievalDebug: async () => {
          throw new Error('OPENAI_API_KEY hiányzik vagy üres.');
        },
      }),
    );
    const res = await request(app)
      .post('/api/debug/search')
      .send({ query: 'x' });
    expect(res.status).toBe(503);
  });

  it('GET /api/health ok státuszt ad', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health 503, ha degraded', async () => {
    const app = createApp(
      makeDeps({
        health: async () => ({
          status: 'degraded',
          checks: { database: false, anthropicKey: true, openaiKey: true },
        }),
      }),
    );
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/debug/cost', () => {
  it('visszaadja a stage-enkénti usage-et és a default árakat', async () => {
    const app = createApp(
      makeDeps({
        costEstimate: async (query) => ({
          query,
          route: 'knowledge',
          stages: [
            {
              stage: 'router',
              model: 'claude-haiku-4-5',
              inputTokens: 10,
              outputTokens: 2,
            },
          ],
          defaultPrices: {
            'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
          },
        }),
      }),
    );
    const res = await request(app)
      .post('/api/debug/cost')
      .send({ query: 'Hogyan öntözzem a pozsgást?' });
    expect(res.status).toBe(200);
    expect(res.body.route).toBe('knowledge');
    expect(res.body.stages[0].stage).toBe('router');
    expect(res.body.defaultPrices['claude-haiku-4-5']).toEqual({
      inputPerM: 1,
      outputPerM: 5,
    });
  });

  it('400-at ad üres query-re', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).post('/api/debug/cost').send({ query: '' });
    expect(res.status).toBe(400);
  });

  it('503-at ad, ha hiányzik az OpenAI-kulcs', async () => {
    const app = createApp(
      makeDeps({
        costEstimate: async () => {
          throw new Error('OPENAI_API_KEY hiányzik vagy üres.');
        },
      }),
    );
    const res = await request(app).post('/api/debug/cost').send({ query: 'x' });
    expect(res.status).toBe(503);
  });
});

const pendingTicket: EscalationTicket = {
  id: 't1',
  createdAt: '2026-08-17T10:00:00.000Z',
  question: 'Milyen növény való a fürdőszobámba?',
  maxSimilarity: 0.21,
  reason: 'low_grounding',
  status: 'pending',
  reply: null,
  resolvedAt: null,
};

describe('GET /api/escalations', () => {
  it('visszaadja a jegyek listáját', async () => {
    const app = createApp(
      makeDeps({ listEscalations: async () => [pendingTicket] }),
    );
    const res = await request(app).get('/api/escalations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([pendingTicket]);
  });
});

describe('POST /api/escalations/:id/resolve', () => {
  it('lezárja a jegyet és visszaadja a resolved jegyet', async () => {
    const resolved: EscalationTicket = {
      ...pendingTicket,
      status: 'resolved',
      reply: 'Kollégánk hamarosan válaszol.',
      resolvedAt: '2026-08-17T10:05:00.000Z',
    };
    const app = createApp(
      makeDeps({
        resolveEscalation: async (id, reply) => {
          expect(id).toBe('t1');
          expect(reply).toBe('Kollégánk hamarosan válaszol.');
          return resolved;
        },
      }),
    );
    const res = await request(app)
      .post('/api/escalations/t1/resolve')
      .send({ reply: 'Kollégánk hamarosan válaszol.' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(resolved);
  });

  it('400-at ad üres reply esetén', async () => {
    const app = createApp(makeDeps());
    const res = await request(app)
      .post('/api/escalations/t1/resolve')
      .send({ reply: '' });
    expect(res.status).toBe(400);
  });

  it('404-et ad, ha a deps EscalationNotFoundError-t dob (ismeretlen id)', async () => {
    const app = createApp(
      makeDeps({
        resolveEscalation: async () => {
          throw new EscalationNotFoundError(
            'Nincs ilyen eszkalációs jegy: nincs-ilyen',
          );
        },
      }),
    );
    const res = await request(app)
      .post('/api/escalations/nincs-ilyen/resolve')
      .send({ reply: 'válasz' });
    expect(res.status).toBe(404);
  });

  it('409-et ad, ha a deps EscalationAlreadyResolvedError-t dob (már lezárt jegy)', async () => {
    const app = createApp(
      makeDeps({
        resolveEscalation: async () => {
          throw new EscalationAlreadyResolvedError(
            'A jegy már le van zárva: t1',
          );
        },
      }),
    );
    const res = await request(app)
      .post('/api/escalations/t1/resolve')
      .send({ reply: 'válasz' });
    expect(res.status).toBe(409);
  });

  it('500-at ad, ha a deps váratlan hibát dob', async () => {
    const app = createApp(
      makeDeps({
        resolveEscalation: async () => {
          throw new Error('Váratlan adatbázis-hiba');
        },
      }),
    );
    const res = await request(app)
      .post('/api/escalations/t1/resolve')
      .send({ reply: 'válasz' });
    expect(res.status).toBe(500);
  });
});
