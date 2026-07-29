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
