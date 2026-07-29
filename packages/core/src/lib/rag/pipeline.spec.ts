import { runChat, type ChatDeps } from './pipeline.js';
import type { ChatMessage, TraceEvent } from '@plantbase/shared';
import type { SearchResult } from '../knowledge-store.js';

/** Egyetlen user-üzenetből álló messages-tömb (a legtöbb tesztnek elég). */
function userMsg(content: string): ChatMessage[] {
  return [{ role: 'user', content }];
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}
async function* gen(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}
const chunk = (sim: number): SearchResult => ({
  chunk_id: 1,
  document_id: 1,
  content: 'c',
  heading_path: null,
  title: 'Pozsgás',
  source_url: null,
  source_path: 'p.md',
  similarity: sim,
});

function baseDeps(overrides: Partial<ChatDeps>): ChatDeps {
  const events: TraceEvent[] = [];
  return {
    router: async (_q, _hist) => ({ route: 'knowledge', reasoning: 'r' }),
    hyde: async (_q, _hist) => ({ text: 'hyde doc' }),
    retrieve: async () => [chunk(0.6)],
    rerank: async (_q, chunks) => ({ chunks: [...chunks], degraded: false }),
    answer: (_input) => ({
      textStream: gen('Válasz'),
      sources: [
        {
          title: 'Pozsgás',
          sourceUrl: null,
          sourcePath: 'p.md',
          headingPath: null,
        },
      ],
    }),
    catalogAgent: (_q, _hist) => ({ textStream: gen('Katalógus') }),
    groundingThreshold: 0.35,
    topK: 12,
    onTrace: (e) => events.push(e),
    // a teszt az events-re a záró expecteknél hivatkozik overrides-on át
    ...overrides,
  } as ChatDeps;
}

describe('runChat', () => {
  it('knowledge route (grounded): streams the answer and resolves sources', async () => {
    const events: TraceEvent[] = [];
    const run = await runChat(
      userMsg('Hogyan öntözzem a pozsgást?'),
      baseDeps({ onTrace: (e) => events.push(e) }),
    );
    expect(await collect(run.textStream)).toBe('Válasz');
    const answer = await run.result;
    expect(answer.route).toBe('knowledge');
    expect(answer.text).toBe('Válasz');
    expect(answer.sources[0].title).toBe('Pozsgás');
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'router',
      'hyde',
      'retrieval',
      'rerank',
      'guardrail',
      'answer-start',
      'answer-delta',
    ]);
  });

  it('knowledge route (not grounded): returns the canned message, no answer call', async () => {
    let answerCalled = false;
    const run = await runChat(
      userMsg('kérdés'),
      baseDeps({
        retrieve: async () => [chunk(0.1)],
        answer: () => {
          answerCalled = true;
          return { textStream: gen('x'), sources: [] };
        },
      }),
    );
    const text = await collect(run.textStream);
    expect(text).toMatch(/tudásbázis/i);
    expect(answerCalled).toBe(false);
    expect((await run.result).sources).toEqual([]);
  });

  it('catalog route: streams the catalog agent, empty sources, no hyde/retrieval', async () => {
    let hydeCalled = false;
    const run = await runChat(
      userMsg('Mennyi a Kentia?'),
      baseDeps({
        router: async () => ({ route: 'catalog', reasoning: 'r' }),
        hyde: async () => {
          hydeCalled = true;
          return { text: 'x' };
        },
      }),
    );
    expect(await collect(run.textStream)).toBe('Katalógus');
    expect(hydeCalled).toBe(false);
    const answer = await run.result;
    expect(answer.route).toBe('catalog');
    expect(answer.sources).toEqual([]);
  });

  it('both route: combines catalog context into the grounded answer', async () => {
    let answerInputCatalog: string | undefined;
    const run = await runChat(
      userMsg('Milyen pozsgást vegyek és hogyan gondozzam?'),
      baseDeps({
        router: async () => ({ route: 'both', reasoning: 'r' }),
        catalogAgent: () => ({ textStream: gen('Kentia: 18900 Ft') }),
        answer: (input) => {
          answerInputCatalog = input.catalogContext;
          return { textStream: gen('Kombinált válasz'), sources: [] };
        },
      }),
    );
    expect(await collect(run.textStream)).toBe('Kombinált válasz');
    expect(answerInputCatalog).toContain('Kentia: 18900 Ft');
    expect((await run.result).route).toBe('both');
  });

  it('both route (not grounded): still calls answer with catalogContext + empty chunks, no canned message', async () => {
    let answerCalled = false;
    let answerInputChunks: unknown;
    let answerInputCatalog: string | undefined;
    const run = await runChat(
      userMsg('Milyen pozsgást vegyek és hogyan gondozzam?'),
      baseDeps({
        router: async () => ({ route: 'both', reasoning: 'r' }),
        retrieve: async () => [chunk(0.1)], // alacsony similarity → not grounded
        catalogAgent: () => ({ textStream: gen('Kentia: 18900 Ft') }),
        answer: (input) => {
          answerCalled = true;
          answerInputChunks = input.chunks;
          answerInputCatalog = input.catalogContext;
          return { textStream: gen('Katalógus-alapú válasz'), sources: [] };
        },
      }),
    );
    const text = await collect(run.textStream);
    expect(answerCalled).toBe(true);
    expect(answerInputChunks).toEqual([]);
    expect(answerInputCatalog).toContain('Kentia: 18900 Ft');
    expect(text).toBe('Katalógus-alapú válasz');
    expect(text).not.toMatch(/tudásbázis/i);
    const answer = await run.result;
    expect(answer.route).toBe('both');
    expect(answer.sources).toEqual([]);
  });

  it('a friss kérdést és a history-t átadja a stage-eknek', async () => {
    const seen: { routerQ?: string; routerHist?: number; answerHist?: number } =
      {};
    const deps = baseDeps({
      router: async (q, hist) => {
        seen.routerQ = q;
        seen.routerHist = hist?.length ?? 0;
        return { route: 'knowledge', reasoning: 'r' };
      },
      answer: (input) => {
        seen.answerHist = input.history?.length ?? 0;
        return {
          textStream: (async function* () {
            yield 'ok';
          })(),
          sources: [],
        };
      },
    });
    const run = await runChat(
      [
        { role: 'user', content: 'Első kérdés' },
        { role: 'assistant', content: 'Első válasz' },
        { role: 'user', content: 'Follow-up' },
      ],
      deps,
    );
    for await (const _ of run.textStream) {
      /* drain */
    }
    expect(seen.routerQ).toBe('Follow-up');
    expect(seen.routerHist).toBe(2);
    expect(seen.answerHist).toBe(2);
  });
});

describe('runChat — usage trace-emisszió (SP5)', () => {
  it('router/hyde/rerank/answer usage-ét usage trace-eseményként emittálja', async () => {
    const events: TraceEvent[] = [];
    const run = await runChat(
      userMsg('Hogyan öntözzem a pozsgást?'),
      baseDeps({
        onTrace: (e) => events.push(e),
        router: async () => ({
          route: 'knowledge',
          reasoning: 'r',
          usage: { model: 'router-model', inputTokens: 10, outputTokens: 2 },
        }),
        hyde: async () => ({
          text: 'hyde doc',
          usage: { model: 'hyde-model', inputTokens: 20, outputTokens: 5 },
        }),
        rerank: async (_q, chunks) => ({
          chunks: [...chunks],
          degraded: false,
          usage: { model: 'rerank-model', inputTokens: 30, outputTokens: 8 },
        }),
        answer: () => ({
          textStream: (async function* () {
            yield 'Válasz';
          })(),
          sources: [],
          usage: Promise.resolve({
            model: 'answer-model',
            inputTokens: 40,
            outputTokens: 15,
          }),
        }),
      }),
    );
    for await (const _ of run.textStream) {
      /* drain, hogy az answer usage promise-a resolve-oljon */
    }
    // Az answer usage fire-and-forget (a stream drain-je után resolve-ol) —
    // egy microtask-tick-et adunk neki, mielőtt az events-et vizsgáljuk.
    await Promise.resolve();
    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents.map((e) => (e as { stage: string }).stage)).toEqual([
      'router',
      'hyde',
      'rerank',
      'answer',
    ]);
    expect(usageEvents[0]).toMatchObject({
      model: 'router-model',
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(usageEvents[3]).toMatchObject({
      model: 'answer-model',
      inputTokens: 40,
      outputTokens: 15,
    });
  });

  it('usage nélküli fake stage-ek esetén nincs usage trace-esemény', async () => {
    const events: TraceEvent[] = [];
    const run = await runChat(
      userMsg('kérdés'),
      baseDeps({ onTrace: (e) => events.push(e) }),
    );
    for await (const _ of run.textStream) {
      /* drain */
    }
    await Promise.resolve();
    expect(events.some((e) => e.type === 'usage')).toBe(false);
  });
});
