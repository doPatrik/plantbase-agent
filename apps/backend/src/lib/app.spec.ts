import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { ChatRun } from '@plantbase/core';
import type { RagAnswer } from '@plantbase/shared';
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
    chunkStats: async () => {
      throw new Error('nem hívandó');
    },
    health: async () => ({
      status: 'ok',
      checks: { database: true, anthropicKey: true, openaiKey: true },
    }),
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
