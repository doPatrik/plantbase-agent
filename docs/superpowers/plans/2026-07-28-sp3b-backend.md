# SP3b — Backend (Express HTTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kész `runChat` RAG-motort egy Express HTTP-réteg teszi ki (`POST /api/chat` streaming + debug endpointok), és a motor history-tudatossá válik (multi-turn).

**Architecture:** A `packages/core` `runChat`-je `ChatMessage[]`-t fogad (nem string); a router/hyde/answer/catalog stage-ek megkapják a beszélgetés-history-t. Új `packages/core` helper `runRetrievalDebug` (HyDE ki/be × rerank előtt/után összehasonlítás). Új `apps/backend` Nx Node-app (Express + Vercel AI SDK v7 UI Message Stream), DI-factory `createApp(deps)`-szel, `supertest`-tel tesztelve.

**Tech Stack:** TypeScript strict, Express 5, Vercel AI SDK v7 (`ai@7`), zod v4, Vitest, supertest, Nx + esbuild + pnpm.

## Global Constraints

- Commit és PR **angolul**; kód-kommentek/`/docs` magyarul (CLAUDE.md).
- Csak SELECT a DB-n; futásidejű vektorkeresés `pg`-vel RO kapcsolaton (nem Prisma).
- Külső/nem megbízható input (HTTP body, env) validálása **zod**-dal a határon; sose `any`.
- Nincs `console.log` product-kódban (a CLI stdout kivétel; a backend `console.error`-t használhat indulási/leállási logokra).
- TypeScript strict, `kebab-case` fájlnevek, `interface` objektumokhoz, immutabilitás (`readonly`).
- Tesztek: Vitest, dependency-injektált fake-ekkel, hálózat/DB nélkül.
- Minden task végén: `pnpm nx run-many -t typecheck test --projects=<érintett>` zöld, majd commit (Conventional Commits).
- Node ESM: relatív importoknál `.js` kiterjesztés (a repo NodeNext-módban van).

---

## File Structure

**`packages/core` (motor-változtatás + debug-helper):**

- Create `packages/core/src/lib/rag/history.ts` — `ChatMessage[]` → question/history/ModelMessage segédfüggvények.
- Create `packages/core/src/lib/rag/history.spec.ts`.
- Modify `packages/core/src/lib/rag/router.ts` — `Router` history-paraméter.
- Modify `packages/core/src/lib/rag/hyde.ts` — `Hyde` history-paraméter.
- Modify `packages/core/src/lib/rag/answer.ts` — `AnswerInput.history`.
- Modify `packages/core/src/lib/rag/catalog-agent.ts` — `CatalogAgent` history-paraméter.
- Modify `packages/core/src/lib/rag/pipeline.ts` — `runChat(messages)`.
- Create `packages/core/src/lib/rag/retrieval-debug.ts` — `runRetrievalDebug` + default deps.
- Create `packages/core/src/lib/rag/retrieval-debug.spec.ts`.
- Modify `packages/core/src/index.ts` — új export.

**`packages/shared` (DTO):**

- Create `packages/shared/src/lib/retrieval-debug.ts` — debug-search DTO + zod.
- Create `packages/shared/src/lib/retrieval-debug.spec.ts`.
- Modify `packages/shared/src/index.ts` — új export.

**`apps/backend` (új app):**

- Create `apps/backend/package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`, `vitest.config.mts`, `src/assets/.gitkeep`.
- Create `apps/backend/src/lib/app.ts` — `createApp(deps)` + route-ok.
- Create `apps/backend/src/lib/app.spec.ts` — supertest-tesztek.
- Create `apps/backend/src/lib/deps.ts` — prod-wiring (`createBackendDeps`).
- Create `apps/backend/src/main.ts` — belépő + listen + graceful shutdown.

**CLI + docs:**

- Modify `apps/cli/src/main.ts` — `runChat` új szignatúrája.
- Modify `.env.example` — `PORT`.
- Modify `docs/rag/roadmap.md` — SP3b státusz.

---

## Task 1: Core — history segédfüggvények

**Files:**

- Create: `packages/core/src/lib/rag/history.ts`
- Test: `packages/core/src/lib/rag/history.spec.ts`

**Interfaces:**

- Consumes: `ChatMessage` a `@plantbase/shared`-ből; `ModelMessage` az `ai`-ból.
- Produces:
  - `deriveQuestion(messages: readonly ChatMessage[]): string`
  - `formatHistoryForPrompt(history: readonly ChatMessage[]): string`
  - `toModelMessages(history: readonly ChatMessage[], question: string): ModelMessage[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lib/rag/history.spec.ts
import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@plantbase/shared';
import {
  deriveQuestion,
  formatHistoryForPrompt,
  toModelMessages,
} from './history.js';

describe('deriveQuestion', () => {
  it('az utolsó user üzenet tartalmát adja vissza', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Első?' },
      { role: 'assistant', content: 'Válasz.' },
      { role: 'user', content: 'És a kaktuszok?' },
    ];
    expect(deriveQuestion(messages)).toBe('És a kaktuszok?');
  });

  it('hibát dob, ha az utolsó üzenet nem user', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Kérdés' },
      { role: 'assistant', content: 'Válasz' },
    ];
    expect(() => deriveQuestion(messages)).toThrow();
  });

  it('hibát dob üres user tartalomra', () => {
    expect(() => deriveQuestion([{ role: 'user', content: '   ' }])).toThrow();
  });
});

describe('formatHistoryForPrompt', () => {
  it('üres history-ra üres stringet ad', () => {
    expect(formatHistoryForPrompt([])).toBe('');
  });

  it('a beszélgetést magyar szereplő-címkékkel rendereli', () => {
    const out = formatHistoryForPrompt([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Üdv' },
    ]);
    expect(out).toContain('Felhasználó: Szia');
    expect(out).toContain('Asszisztens: Üdv');
  });
});

describe('toModelMessages', () => {
  it('a history után a friss kérdést user-üzenetként fűzi', () => {
    const out = toModelMessages(
      [{ role: 'assistant', content: 'Korábbi' }],
      'Új kérdés',
    );
    expect(out).toEqual([
      { role: 'assistant', content: 'Korábbi' },
      { role: 'user', content: 'Új kérdés' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- history`
Expected: FAIL — `Cannot find module './history.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/lib/rag/history.ts
// A chat-history (ChatMessage[]) átalakító segédfüggvényei (SP3b). A HTTP-határon a
// kérés messages-tömb; innen deriváljuk a friss kérdést, a prompt-formázott
// history-t (router/hyde/answer), és a katalógus-agent natív ModelMessage-listáját.

import type { ModelMessage } from 'ai';
import type { ChatMessage } from '@plantbase/shared';

/** A legutolsó (kötelezően user, nem üres) üzenet tartalma. @throws {Error} ha nincs. */
export function deriveQuestion(messages: readonly ChatMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.content.trim().length === 0) {
    throw new Error('A messages utolsó eleme nem üres user üzenet.');
  }
  return last.content;
}

/** A history prompt-blokká renderelve (üres history → üres string). */
export function formatHistoryForPrompt(
  history: readonly ChatMessage[],
): string {
  if (history.length === 0) return '';
  const lines = history.map(
    (m) => `${m.role === 'user' ? 'Felhasználó' : 'Asszisztens'}: ${m.content}`,
  );
  return `Eddigi beszélgetés:\n${lines.join('\n')}\n\n`;
}

/** History + friss kérdés → AI SDK ModelMessage-lista (a katalógus-agentnek). */
export function toModelMessages(
  history: readonly ChatMessage[],
  question: string,
): ModelMessage[] {
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: question },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- history`
Expected: PASS (7 assertion).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/history.ts packages/core/src/lib/rag/history.spec.ts
git commit -m "feat(core): chat-history helpers for message-based runChat"
```

---

## Task 2: Core — router history-tudatossá

**Files:**

- Modify: `packages/core/src/lib/rag/router.ts`
- Test: `packages/core/src/lib/rag/router.spec.ts`

**Interfaces:**

- Consumes: `formatHistoryForPrompt` (Task 1), `ChatMessage` (`@plantbase/shared`).
- Produces: `Router = (question: string, history?: readonly ChatMessage[]) => Promise<RouterResult>`.

- [ ] **Step 1: Write the failing test** — add to `router.spec.ts`:

```ts
it('a history-t beleszövi a promptba', async () => {
  let captured = '';
  const router = createRouter({
    model: {} as never,
    generateObject: async ({ prompt }) => {
      captured = prompt;
      return { object: { route: 'knowledge', reasoning: 'ok' } };
    },
  });
  await router('És a kaktuszok?', [
    { role: 'user', content: 'Mesélj a pozsgásokról' },
    { role: 'assistant', content: 'A pozsgások...' },
  ]);
  expect(captured).toContain('Mesélj a pozsgásokról');
  expect(captured).toContain('És a kaktuszok?');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- router`
Expected: FAIL — a `router('...', [...])` második argumentum típushiba / a prompt nem tartalmazza a history-t.

- [ ] **Step 3: Write minimal implementation** — `router.ts`:

Add import a fájl tetejére:

```ts
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
```

Cseréld a `Router` típust és a `createRouter` visszatérését:

```ts
export type Router = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<RouterResult>;

export function createRouter(deps: RouterDeps): Router {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question, history = []) => {
    const { object } = await run({
      model: deps.model,
      schema: routerSchema,
      system: ROUTER_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return object;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- router`
Expected: PASS (a meglévő router-tesztek is zöldek — a history opcionális).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/router.ts packages/core/src/lib/rag/router.spec.ts
git commit -m "feat(core): make router history-aware"
```

---

## Task 3: Core — HyDE history-tudatossá

**Files:**

- Modify: `packages/core/src/lib/rag/hyde.ts`
- Test: `packages/core/src/lib/rag/hyde.spec.ts`

**Interfaces:**

- Consumes: `formatHistoryForPrompt` (Task 1), `ChatMessage`.
- Produces: `Hyde = (question: string, history?: readonly ChatMessage[]) => Promise<string>`.

- [ ] **Step 1: Write the failing test** — add to `hyde.spec.ts`:

```ts
it('a history-t figyelembe veszi a promptban', async () => {
  let captured = '';
  const hyde = createHyde({
    model: {} as never,
    generateText: async ({ prompt }) => {
      captured = prompt;
      return { text: 'hipotetikus' };
    },
  });
  await hyde('És télen?', [
    { role: 'user', content: 'Hogyan öntözzem a monsterát?' },
  ]);
  expect(captured).toContain('Hogyan öntözzem a monsterát?');
  expect(captured).toContain('És télen?');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- hyde`
Expected: FAIL — típushiba a második argumentumon / hiányzó history a promptban.

- [ ] **Step 3: Write minimal implementation** — `hyde.ts`:

Add import:

```ts
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
```

Cseréld:

```ts
export type Hyde = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<string>;

export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question, history = []) => {
    const { text } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return text.trim();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- hyde`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/hyde.ts packages/core/src/lib/rag/hyde.spec.ts
git commit -m "feat(core): make HyDE history-aware"
```

---

## Task 4: Core — answer history-tudatossá

**Files:**

- Modify: `packages/core/src/lib/rag/answer.ts`
- Test: `packages/core/src/lib/rag/answer.spec.ts`

**Interfaces:**

- Consumes: `formatHistoryForPrompt` (Task 1), `ChatMessage`.
- Produces: `AnswerInput` bővül `history?: readonly ChatMessage[]` mezővel; az `Answer` típus és `AnswerResult` változatlan.

- [ ] **Step 1: Write the failing test** — add to `answer.spec.ts`:

```ts
it('a history bekerül a prompt-ba', () => {
  let captured = '';
  const answer = createAnswer({
    model: {} as never,
    streamAnswer: ({ prompt }) => {
      captured = prompt;
      return {
        textStream: (async function* () {
          yield 'ok';
        })(),
      };
    },
  });
  answer({
    question: 'És a fényigénye?',
    chunks: [],
    history: [{ role: 'user', content: 'Mesélj a szanszevériáról' }],
  });
  expect(captured).toContain('Mesélj a szanszevériáról');
  expect(captured).toContain('És a fényigénye?');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- answer`
Expected: FAIL — `history` nincs az `AnswerInput`-on / nem kerül a promptba.

- [ ] **Step 3: Write minimal implementation** — `answer.ts`:

Add import:

```ts
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
```

Bővítsd az `AnswerInput`-ot:

```ts
export interface AnswerInput {
  readonly question: string;
  readonly chunks: readonly SearchResult[];
  /** Katalógus-kontextus a "both" útvonalon (a catalog-agent szöveges eredménye). */
  readonly catalogContext?: string;
  /** Az eddigi beszélgetés (koherens többfordulós válaszhoz). */
  readonly history?: readonly ChatMessage[];
}
```

A `createAnswer` prompt-építését cseréld:

```ts
const historyBlock = formatHistoryForPrompt(input.history ?? []);
const { textStream } = run({
  model: deps.model,
  system: ANSWER_SYSTEM,
  prompt: `${historyBlock}Kérdés: ${input.question}\n\nForrásrészletek:\n${context}${catalog}`,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- answer`
Expected: PASS (meglévő answer-tesztek is zöldek).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/answer.ts packages/core/src/lib/rag/answer.spec.ts
git commit -m "feat(core): make answer stage history-aware"
```

---

## Task 5: Core — katalógus-agent history-tudatossá

**Files:**

- Modify: `packages/core/src/lib/rag/catalog-agent.ts`
- Test: `packages/core/src/lib/rag/catalog-agent.spec.ts`

**Interfaces:**

- Consumes: `toModelMessages` (Task 1), `ChatMessage`.
- Produces: `CatalogAgent = (question: string, history?: readonly ChatMessage[]) => { textStream: AsyncIterable<string> }`.

- [ ] **Step 1: Write the failing test** — add to `catalog-agent.spec.ts`:

```ts
it('a history-t ModelMessage-listaként adja tovább, a friss kérdés az utolsó user', () => {
  let captured: unknown[] = [];
  const agent = createCatalogAgent({
    model: {} as never,
    runSql: async () => [],
    listCategories: async () => [],
    maxIterations: 3,
    streamCatalog: ({ messages }) => {
      captured = messages;
      return {
        textStream: (async function* () {
          yield 'x';
        })(),
      };
    },
  });
  agent('Mennyibe kerül?', [
    { role: 'user', content: 'Milyen pozsgás van?' },
    { role: 'assistant', content: 'Van echeveria.' },
  ]);
  expect(captured).toEqual([
    { role: 'user', content: 'Milyen pozsgás van?' },
    { role: 'assistant', content: 'Van echeveria.' },
    { role: 'user', content: 'Mennyibe kerül?' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- catalog-agent`
Expected: FAIL — a második argumentum típushiba / a messages nem tartalmazza a history-t.

- [ ] **Step 3: Write minimal implementation** — `catalog-agent.ts`:

Add import:

```ts
import { toModelMessages } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
```

Cseréld a `CatalogAgent` típust és a `createCatalogAgent` visszatérését:

```ts
export type CatalogAgent = (
  question: string,
  history?: readonly ChatMessage[],
) => {
  textStream: AsyncIterable<string>;
};

export function createCatalogAgent(deps: CatalogAgentDeps): CatalogAgent {
  const run = deps.streamCatalog ?? defaultStreamCatalog;
  const tools = createCatalogTools({
    runSql: deps.runSql,
    listCategories: deps.listCategories,
  });
  const system = buildSystemPrompt({ databaseAvailable: true });
  return (question, history = []) => {
    const messages = toModelMessages(history, question);
    return run({
      model: deps.model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(deps.maxIterations),
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- catalog-agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/catalog-agent.ts packages/core/src/lib/rag/catalog-agent.spec.ts
git commit -m "feat(core): make catalog agent history-aware"
```

---

## Task 6: Core — `runChat(messages)` a pipeline-ban

**Files:**

- Modify: `packages/core/src/lib/rag/pipeline.ts`
- Test: `packages/core/src/lib/rag/pipeline.spec.ts`

**Interfaces:**

- Consumes: `deriveQuestion` (Task 1); a Task 2–5 history-aware stage-ek; `ChatMessage` (`@plantbase/shared`).
- Produces: `runChat(messages: readonly ChatMessage[], deps: ChatDeps): Promise<ChatRun>`. A `ChatDeps`, `ChatRun`, `createDefaultChatDeps` alakja változatlan (a stage-típusok maguk bővültek).

- [ ] **Step 1: Write the failing test** — a `pipeline.spec.ts` meglévő tesztjei ma `runChat('kérdés', deps)`-et hívnak. Alakítsd át a hívásokat `runChat([{ role: 'user', content: 'kérdés' }], deps)`-re, és adj egy új tesztet, ami ellenőrzi a history-átadást:

```ts
it('a friss kérdést és a history-t átadja a stage-eknek', async () => {
  const seen: { routerQ?: string; routerHist?: number; answerHist?: number } =
    {};
  const deps = makeFakeDeps({
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
```

> Megjegyzés: a `makeFakeDeps` a spec-ben már létező fake-builder — igazítsd a `router`/`hyde`/`answer`/`catalogAgent` fake-eket a bővült szignatúrához (opcionális második paraméter / `history` az input-on), ahol szükséges. A többi meglévő teszt hívását is állítsd át a `ChatMessage[]` alakra.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- pipeline`
Expected: FAIL — `runChat` ma stringet vár; a `messages`-tömb típushibát ad.

- [ ] **Step 3: Write minimal implementation** — `pipeline.ts`:

Add import:

```ts
import type { ChatMessage } from '@plantbase/shared';
import { deriveQuestion } from './history.js';
```

Cseréld a `runChat` fejét és a stage-hívásokat (a friss kérdést és a prior history-t átadva):

```ts
export async function runChat(
  messages: readonly ChatMessage[],
  deps: ChatDeps,
): Promise<ChatRun> {
  const onTrace = deps.onTrace ?? noopTrace;
  const question = deriveQuestion(messages);
  const history = messages.slice(0, -1);

  const { route, reasoning } = await deps.router(question, history);
  onTrace({ type: 'router', route, reasoning });
  // ... (a resolveResult / result Promise változatlan) ...
```

A továbbiakban a stage-hívásokat egészítsd ki:

- `const catalogRun = deps.catalogAgent(question, history);` (both-ág)
- `const hydeDoc = await deps.hyde(question, history);`
- `deps.rerank(question, retrieved)` és a retrieval **változatlan** (nem kap history-t).
- Az answer-hívás: `deps.answer({ question, chunks: ..., catalogContext, history });`
- A tiszta katalógus-ág: `answerStream = deps.catalogAgent(question, history).textStream;`

A `NO_GROUNDING_MESSAGE` ágak, a `tee`, és a `createDefaultChatDeps` **változatlanok**.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- pipeline`
Expected: PASS (az összes átírt pipeline-teszt + az új history-teszt).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/pipeline.ts packages/core/src/lib/rag/pipeline.spec.ts
git commit -m "feat(core): runChat accepts ChatMessage[] and threads history"
```

---

## Task 7: Shared — retrieval-debug DTO

**Files:**

- Create: `packages/shared/src/lib/retrieval-debug.ts`
- Test: `packages/shared/src/lib/retrieval-debug.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces (types + zod):
  - `DebugHit { rank, documentId, title, headingPath, sourcePath, similarity, contentPreview }`
  - `RerankedDebugHit extends DebugHit { prevRank }`
  - `RetrievalDebugBranch { retrieval: DebugHit[]; rerank: { degraded: boolean; results: RerankedDebugHit[] } }`
  - `RetrievalDebugResult { query, hydeDoc, raw: RetrievalDebugBranch, hyde: RetrievalDebugBranch }`
  - `RetrievalDebugRequest { query: string; topK?: number; rerankTopN?: number }` + `retrievalDebugRequestSchema`
  - `retrievalDebugResultSchema`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/lib/retrieval-debug.spec.ts
import { describe, it, expect } from 'vitest';
import {
  retrievalDebugRequestSchema,
  retrievalDebugResultSchema,
} from './retrieval-debug.js';

describe('retrievalDebugRequestSchema', () => {
  it('elfogad egy csak-query kérést', () => {
    const r = retrievalDebugRequestSchema.safeParse({ query: 'pozsgás' });
    expect(r.success).toBe(true);
  });
  it('elutasítja az üres query-t', () => {
    expect(retrievalDebugRequestSchema.safeParse({ query: '' }).success).toBe(
      false,
    );
  });
  it('elutasítja a nem-pozitív topK-t', () => {
    expect(
      retrievalDebugRequestSchema.safeParse({ query: 'x', topK: 0 }).success,
    ).toBe(false);
  });
});

describe('retrievalDebugResultSchema', () => {
  it('validál egy teljes eredmény-objektumot', () => {
    const branch = {
      retrieval: [
        {
          rank: 0,
          documentId: 1,
          title: 'T',
          headingPath: null,
          sourcePath: 'a.md',
          similarity: 0.5,
          contentPreview: '...',
        },
      ],
      rerank: {
        degraded: false,
        results: [
          {
            rank: 0,
            documentId: 1,
            title: 'T',
            headingPath: null,
            sourcePath: 'a.md',
            similarity: 0.5,
            contentPreview: '...',
            prevRank: 0,
          },
        ],
      },
    };
    const r = retrievalDebugResultSchema.safeParse({
      query: 'q',
      hydeDoc: 'h',
      raw: branch,
      hyde: branch,
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/shared -- retrieval-debug`
Expected: FAIL — `Cannot find module './retrieval-debug.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/lib/retrieval-debug.ts
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
```

Add `packages/shared/src/index.ts`-hez:

```ts
export * from './lib/retrieval-debug.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/shared -- retrieval-debug`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lib/retrieval-debug.ts packages/shared/src/lib/retrieval-debug.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): retrieval-debug DTOs and zod schemas"
```

---

## Task 8: Core — `runRetrievalDebug` helper

**Files:**

- Create: `packages/core/src/lib/rag/retrieval-debug.ts`
- Test: `packages/core/src/lib/rag/retrieval-debug.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `Hyde` (Task 3), `Rerank`, `EmbedQueryFn`/`SearchChunksFn` (retrieval.ts), `SearchResult` (knowledge-store), `RetrievalDebugResult` (Task 7), `createRagModels`, `loadConfig`/`loadRagConfig`.
- Produces:
  - `RetrievalDebugDeps { hyde: Hyde; embedQuery: EmbedQueryFn; searchChunks: SearchChunksFn; rerank: Rerank; topK: number; rerankTopN: number }`
  - `runRetrievalDebug(query: string, deps: RetrievalDebugDeps): Promise<RetrievalDebugResult>`
  - `createDefaultRetrievalDebugDeps(overrides?: Partial<RetrievalDebugDeps>): RetrievalDebugDeps`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lib/rag/retrieval-debug.spec.ts
import { describe, it, expect } from 'vitest';
import type { SearchResult } from '../knowledge-store.js';
import {
  runRetrievalDebug,
  type RetrievalDebugDeps,
} from './retrieval-debug.js';

function chunk(id: number, sim: number): SearchResult {
  return {
    chunk_id: id,
    document_id: id,
    content: `tartalom-${id} és még hosszú szöveg`,
    heading_path: null,
    title: `cím-${id}`,
    source_url: null,
    source_path: `${id}.md`,
    similarity: sim,
  };
}

function makeDeps(over: Partial<RetrievalDebugDeps> = {}): RetrievalDebugDeps {
  const retrieved = [chunk(1, 0.6), chunk(2, 0.5), chunk(3, 0.4)];
  return {
    hyde: async () => 'hipotetikus dokumentum',
    embedQuery: async () => Array(1536).fill(0),
    searchChunks: async () => retrieved,
    // rerank megfordítja a sorrendet, topN=2
    rerank: async (_q, chunks) => ({
      chunks: [chunks[2], chunks[0]],
      degraded: false,
    }),
    topK: 3,
    rerankTopN: 2,
    ...over,
  };
}

describe('runRetrievalDebug', () => {
  it('mindkét ágon visszaadja a retrieval- és rerank-sorrendet', async () => {
    const out = await runRetrievalDebug('kérdés', makeDeps());
    expect(out.query).toBe('kérdés');
    expect(out.hydeDoc).toBe('hipotetikus dokumentum');
    expect(out.raw.retrieval).toHaveLength(3);
    expect(out.raw.rerank.results).toHaveLength(2);
    // a raw retrieval rank sorrendben 0,1,2
    expect(out.raw.retrieval.map((h) => h.rank)).toEqual([0, 1, 2]);
    // rerank: az első reranked találat a nyers 3. elem (prevRank=2)
    expect(out.raw.rerank.results[0].prevRank).toBe(2);
    expect(out.raw.rerank.results[1].prevRank).toBe(0);
    expect(out.hyde.retrieval).toHaveLength(3);
  });

  it('a HyDE-ágban a HyDE-dokumentumot embeddeli, a raw-ban a nyers query-t', async () => {
    const embedded: string[] = [];
    const out = await runRetrievalDebug(
      'öntözés',
      makeDeps({
        embedQuery: async (text) => {
          embedded.push(text);
          return Array(1536).fill(0);
        },
      }),
    );
    expect(embedded).toContain('öntözés');
    expect(embedded).toContain(out.hydeDoc);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- retrieval-debug`
Expected: FAIL — `Cannot find module './retrieval-debug.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/lib/rag/retrieval-debug.ts
// Debug-összehasonlítás (SP3b): ugyanarra a query-re HyDE ki/be × rerank előtt/után.
// Így közvetlenül látszik, mennyit rendez át a rerank, és mennyit segít a HyDE.
// Minden primitív injektálható (teszt); a createDefaultRetrievalDebugDeps a valós wiring.

import type {
  DebugHit,
  RerankedDebugHit,
  RetrievalDebugBranch,
  RetrievalDebugResult,
} from '@plantbase/shared';
import { loadConfig, loadRagConfig } from '../config.js';
import type { SearchResult } from '../knowledge-store.js';
import { createRagModels } from './models.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRerank, type Rerank } from './rerank.js';
import { type EmbedQueryFn, type SearchChunksFn } from './retrieval.js';
import { embedQuery as defaultEmbedQuery } from '../embedding.js';
import { searchChunks as defaultSearchChunks } from '../knowledge-store.js';

const PREVIEW_CHARS = 240;

export interface RetrievalDebugDeps {
  readonly hyde: Hyde;
  readonly embedQuery: EmbedQueryFn;
  readonly searchChunks: SearchChunksFn;
  readonly rerank: Rerank;
  readonly topK: number;
  readonly rerankTopN: number;
}

function toHit(c: SearchResult, rank: number): DebugHit {
  return {
    rank,
    documentId: c.document_id,
    title: c.title,
    headingPath: c.heading_path,
    sourcePath: c.source_path,
    similarity: c.similarity,
    contentPreview: c.content.slice(0, PREVIEW_CHARS),
  };
}

/** Egy ág: a queryText embeddingjével keres, majd a kérdésre rerankol. */
async function runBranch(
  queryText: string,
  rerankQuestion: string,
  deps: RetrievalDebugDeps,
): Promise<RetrievalDebugBranch> {
  const embedding = await deps.embedQuery(queryText);
  const retrieved = await deps.searchChunks(embedding, deps.topK);
  const outcome = await deps.rerank(rerankQuestion, retrieved);
  const rankById = new Map(retrieved.map((c, i) => [c.chunk_id, i]));
  const results: RerankedDebugHit[] = outcome.chunks.map((c, i) => ({
    ...toHit(c, i),
    prevRank: rankById.get(c.chunk_id) ?? -1,
  }));
  return {
    retrieval: retrieved.map((c, i) => toHit(c, i)),
    rerank: { degraded: outcome.degraded, results },
  };
}

/** HyDE ki/be × rerank előtt/után összehasonlítás egyetlen query-re. */
export async function runRetrievalDebug(
  query: string,
  deps: RetrievalDebugDeps,
): Promise<RetrievalDebugResult> {
  const hydeDoc = await deps.hyde(query);
  const raw = await runBranch(query, query, deps);
  const hyde = await runBranch(hydeDoc, query, deps);
  return { query, hydeDoc, raw, hyde };
}

/** A valós wiring: modelleket és primitíveket a configból építi. */
export function createDefaultRetrievalDebugDeps(
  overrides: Partial<RetrievalDebugDeps> = {},
): RetrievalDebugDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    hyde: createHyde({ model: models.hyde }),
    embedQuery: (text) => defaultEmbedQuery(text),
    searchChunks: (embedding, k) => defaultSearchChunks(embedding, k),
    rerank: createRerank({ model: models.rerank, topN: ragConfig.rerankTopN }),
    topK: ragConfig.topK,
    rerankTopN: ragConfig.rerankTopN,
    ...overrides,
  };
}
```

Add `packages/core/src/index.ts`-hez:

```ts
export * from './lib/rag/retrieval-debug.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/core -- retrieval-debug`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/retrieval-debug.ts packages/core/src/lib/rag/retrieval-debug.spec.ts packages/core/src/index.ts
git commit -m "feat(core): runRetrievalDebug (HyDE on/off x rerank before/after)"
```

---

## Task 9: Backend — Nx app scaffolding

**Files:**

- Create: `apps/backend/package.json`, `apps/backend/tsconfig.json`, `apps/backend/tsconfig.app.json`, `apps/backend/tsconfig.spec.json`, `apps/backend/vitest.config.mts`, `apps/backend/src/assets/.gitkeep`
- Create: `apps/backend/src/main.ts` (átmeneti minimál belépő, hogy a build/typecheck átmenjen)

**Interfaces:**

- Produces: futtatható Nx `backend` projekt `build`/`test`/`typecheck` targetekkel (a `rag-builder` mintájára).

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add express @plantbase/core@workspace:* @plantbase/shared@workspace:* --filter @plantbase/backend
```

> Ha a filter még nem létezik (nincs package.json), előbb hozd létre a package.json-t (Step 2), majd `pnpm install`.

- [ ] **Step 2: Create `apps/backend/package.json`**

```json
{
  "name": "@plantbase/backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "nx": {
    "name": "backend",
    "targets": {
      "build": {
        "executor": "@nx/esbuild:esbuild",
        "outputs": ["{options.outputPath}"],
        "defaultConfiguration": "production",
        "options": {
          "platform": "node",
          "outputPath": "apps/backend/dist",
          "format": ["cjs"],
          "bundle": false,
          "main": "apps/backend/src/main.ts",
          "tsConfig": "apps/backend/tsconfig.app.json",
          "declaration": false,
          "skipTypeCheck": true,
          "assets": ["apps/backend/src/assets"],
          "esbuildOptions": {
            "sourcemap": true,
            "outExtension": { ".js": ".js" }
          }
        },
        "configurations": {
          "development": {},
          "production": {
            "esbuildOptions": {
              "sourcemap": false,
              "outExtension": { ".js": ".js" }
            }
          }
        }
      },
      "serve": {
        "executor": "nx:run-commands",
        "dependsOn": ["build"],
        "options": {
          "command": "node apps/backend/dist/main.js",
          "cwd": "{workspaceRoot}"
        }
      }
    }
  },
  "dependencies": {
    "@plantbase/core": "workspace:*",
    "@plantbase/shared": "workspace:*",
    "ai": "^7.0.37",
    "express": "^5.1.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/supertest": "^6.0.2",
    "@vitest/coverage-v8": "~4.1.9",
    "supertest": "^7.0.0",
    "tsx": "^4.22.4",
    "vitest": "~4.1.9"
  }
}
```

> A `skipTypeCheck: true` + `declaration: false` az esbuild-build alatt szándékos (lásd PR #24 tanulsága): a típusellenőrzést az nx `typecheck` target (tsc) végzi, nem az esbuild.

- [ ] **Step 3: Create tsconfig-okat** (a `rag-builder` mintájára, de a `references`-ben core ÉS shared):

`apps/backend/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

`apps/backend/tsconfig.app.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["node"],
    "rootDir": "src",
    "tsBuildInfoFile": "dist/tsconfig.app.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": [
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts"
  ],
  "references": [
    { "path": "../../packages/core/tsconfig.lib.json" },
    { "path": "../../packages/shared/tsconfig.lib.json" }
  ]
}
```

`apps/backend/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./out-tsc/vitest",
    "types": [
      "vitest/globals",
      "vitest/importMeta",
      "vite/client",
      "node",
      "vitest"
    ],
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

- [ ] **Step 4: Create `apps/backend/vitest.config.mts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/backend',
  test: {
    name: '@plantbase/backend',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
```

- [ ] **Step 5: Create `apps/backend/src/assets/.gitkeep`** (üres fájl) és egy átmeneti `apps/backend/src/main.ts`:

```ts
// Plantbase backend — belépési pont (SP3b). A tényleges app a Task 12-ben.
export {};
```

- [ ] **Step 6: Install + verify project wiring**

Run:

```bash
pnpm install
pnpm nx show project backend
pnpm nx typecheck backend
```

Expected: a `backend` projekt látszik `build`/`serve`/`test`/`typecheck` targetekkel; a typecheck zöld (üres app).

- [ ] **Step 7: Commit**

```bash
git add apps/backend pnpm-lock.yaml package.json
git commit -m "chore(backend): scaffold Express Nx app"
```

---

## Task 10: Backend — `createApp` + `POST /api/chat`

**Files:**

- Create: `apps/backend/src/lib/app.ts`
- Test: `apps/backend/src/lib/app.spec.ts`

**Interfaces:**

- Consumes: `ChatRun` (`@plantbase/core`), `ChatMessage`/`OnTrace`/`RagAnswer`/`TraceEvent`/`chatRequestSchema`/`ChunkStats`/`RetrievalDebugResult`/`retrievalDebugRequestSchema` (`@plantbase/shared` + core), `createUIMessageStream`/`pipeUIMessageStreamToResponse` (`ai`), `express`.
- Produces:
  - `interface HealthReport { status: 'ok' | 'degraded'; checks: { database: boolean; anthropicKey: boolean; openaiKey: boolean } }`
  - `interface BackendDeps { chat; retrievalDebug; chunkStats; health; debug }` (pontos szignatúrák lent)
  - `createApp(deps: BackendDeps): express.Express`

Ebben a taskban csak a `/api/chat` route készül el (a debug/health a Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/lib/app.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/backend -- app`
Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/backend/src/lib/app.ts
// A backend Express-app factory (SP3b). DI-minta: minden külső hatás injektált
// (chat/retrievalDebug/chunkStats/health), így supertest-tel, hálózat/DB nélkül
// tesztelhető. A /api/chat a Vercel AI SDK v7 UI Message Stream-jét streameli:
// text-delta a válasznak, data-trace a trace-nek (csak DEBUG), data-sources a végén.

import express, { type Express, type Request, type Response } from 'express';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import {
  chatRequestSchema,
  retrievalDebugRequestSchema,
  type ChatMessage,
  type OnTrace,
  type RetrievalDebugResult,
} from '@plantbase/shared';
import type { ChatRun } from '@plantbase/core';
import type { ChunkStats } from '@plantbase/core';

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
```

> Megjegyzés: a `ChunkStats` a `@plantbase/core`-ból exportált (knowledge-store). Ha a build szerint nem elérhető a `@plantbase/core` gyökeréről, importáld így: `import type { ChunkStats } from '@plantbase/core';` — a core `index.ts` re-exportálja a knowledge-store-t.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/backend -- app`
Expected: PASS (mind az 5 chat-teszt).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/app.ts apps/backend/src/lib/app.spec.ts
git commit -m "feat(backend): createApp + streaming POST /api/chat"
```

---

## Task 11: Backend — debug + health endpointok

**Files:**

- Modify: `apps/backend/src/lib/app.ts`
- Test: `apps/backend/src/lib/app.spec.ts`

**Interfaces:**

- Consumes: a Task 10 `BackendDeps` (`retrievalDebug`, `chunkStats`, `health`), `retrievalDebugRequestSchema` (Task 7).
- Produces: `GET /api/debug/chunks`, `POST /api/debug/search`, `GET /api/health` route-ok ugyanazon `createApp`-ban.

- [ ] **Step 1: Write the failing test** — add to `app.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/backend -- app`
Expected: FAIL — az új endpointok 404-et adnak.

- [ ] **Step 3: Write minimal implementation** — `app.ts`, add új register-függvények és hívd őket a `createApp`-ban:

```ts
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

function registerHealth(app: Express, deps: BackendDeps): void {
  app.get('/api/health', async (_req: Request, res: Response) => {
    const report = await deps.health();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });
}
```

A `createApp`-ban a `registerChat(app, deps);` után:

```ts
registerDebug(app, deps);
registerHealth(app, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/backend -- app`
Expected: PASS (chat + debug + health, összesen ~11 teszt).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/app.ts apps/backend/src/lib/app.spec.ts
git commit -m "feat(backend): debug/chunks, debug/search, health endpoints"
```

---

## Task 12: Backend — prod-wiring + belépő (`deps.ts` + `main.ts`)

**Files:**

- Create: `apps/backend/src/lib/deps.ts`
- Modify: `apps/backend/src/main.ts`

**Interfaces:**

- Consumes: `createApp`/`BackendDeps`/`HealthReport` (Task 10), `runChat`/`createDefaultChatDeps`/`runRetrievalDebug`/`createDefaultRetrievalDebugDeps`/`getChunkStats`/`loadRagConfig`/`closePool`/`closeKnowledgePool` (`@plantbase/core`).
- Produces: `createBackendDeps(): BackendDeps` (valós wiring); futtatható `main.ts` (listen + graceful shutdown).

> Ez a task DB/hálózat-integráció — nincs rá izolált unit-teszt (a `createApp` már fedve van fake-ekkel). A verifikáció manuális, futtatással (lásd Task 14 verify).

- [ ] **Step 1: Create `apps/backend/src/lib/deps.ts`**

```ts
// A backend valós függőség-wiringje (SP3b): a core motort és a knowledge-store-t
// köti a createApp DI-felületéhez. A trace-t a /api/chat route adja onTrace-ként.

import {
  runChat,
  createDefaultChatDeps,
  runRetrievalDebug,
  createDefaultRetrievalDebugDeps,
  getChunkStats,
  loadRagConfig,
} from '@plantbase/core';
import type { BackendDeps, HealthReport } from './app.js';

async function computeHealth(): Promise<HealthReport> {
  const anthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const openaiKey = Boolean(process.env.OPENAI_API_KEY);
  let database = false;
  try {
    await getChunkStats();
    database = true;
  } catch {
    database = false;
  }
  const status = database && anthropicKey ? 'ok' : 'degraded';
  return { status, checks: { database, anthropicKey, openaiKey } };
}

/** A valós backend-függőségek (motor + knowledge-store + health). */
export function createBackendDeps(): BackendDeps {
  const ragConfig = loadRagConfig();
  return {
    chat: (messages, onTrace) =>
      runChat(messages, createDefaultChatDeps({ onTrace })),
    retrievalDebug: (query, opts) =>
      runRetrievalDebug(
        query,
        createDefaultRetrievalDebugDeps({
          topK: opts.topK,
          rerankTopN: opts.rerankTopN,
        }),
      ),
    chunkStats: () => getChunkStats(),
    health: computeHealth,
    debug: ragConfig.debug,
  };
}
```

> Figyelem: a `createDefaultRetrievalDebugDeps` overrides-ában a `topK`/`rerankTopN` `undefined` is lehet; a spread így felülírná a default számot `undefined`-ra. Ezt kezeld a `deps.ts`-ben azzal, hogy csak a megadott mezőket teszed bele:

```ts
    retrievalDebug: (query, opts) => {
      const overrides: { topK?: number; rerankTopN?: number } = {};
      if (opts.topK !== undefined) overrides.topK = opts.topK;
      if (opts.rerankTopN !== undefined) overrides.rerankTopN = opts.rerankTopN;
      return runRetrievalDebug(query, createDefaultRetrievalDebugDeps(overrides));
    },
```

- [ ] **Step 2: Write `apps/backend/src/main.ts`**

```ts
// Plantbase backend — belépési pont (SP3b). Felépíti a valós függőségeket,
// példányosítja a createApp-ot, a PORT-on figyel, és jelre rendezetten leáll
// (pg-poolok zárása). A .env-et a core findUp-pal találja meg.

import { closePool, closeKnowledgePool } from '@plantbase/core';
import { z } from 'zod';
import { createApp } from './lib/app.js';
import { createBackendDeps } from './lib/deps.js';

const portSchema = z.coerce.number().int().positive().default(3000);

function resolvePort(): number {
  const parsed = portSchema.safeParse(process.env.PORT);
  return parsed.success ? parsed.data : 3000;
}

function main(): void {
  const app = createApp(createBackendDeps());
  const port = resolvePort();
  const server = app.listen(port, () => {
    console.error(`Plantbase backend fut: http://localhost:${port}`);
  });

  const shutdown = (signal: string): void => {
    console.error(`\n${signal} — leállás...`);
    server.close(() => {
      void Promise.allSettled([closePool(), closeKnowledgePool()]).then(() => {
        process.exit(0);
      });
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
```

- [ ] **Step 3: Typecheck + build**

Run:

```bash
pnpm nx typecheck backend
pnpm nx build backend
```

Expected: mindkettő zöld; `apps/backend/dist/main.js` létrejön.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/lib/deps.ts apps/backend/src/main.ts
git commit -m "feat(backend): production dependency wiring, entrypoint, graceful shutdown"
```

---

## Task 13: CLI — átállás a `runChat(messages)` szignatúrára

**Files:**

- Modify: `apps/cli/src/main.ts`
- Test: (a CLI-nak nincs runChat-integrációs tesztje; a `echo`/`trace-format` tesztek érintetlenek)

**Interfaces:**

- Consumes: `runChat(messages, deps)` (Task 6).
- Produces: változatlan CLI-viselkedés (egyszeri, single-turn kérdés — a `question`-t egyelemű `messages`-tömbbe csomagolva).

- [ ] **Step 1: Modify `handleQuestion`** — `apps/cli/src/main.ts`:

A `runChat(question, deps)` hívást cseréld:

```ts
const run = await runChat([{ role: 'user', content: question }], deps);
```

Ha a `ChatMessage` típus kell explicit importként, add hozzá:

```ts
import type {
  ChatMessage,
  OnTrace,
  RagAnswer,
  TraceEvent,
} from '@plantbase/shared';
```

(az objektum-literál `role: 'user'` amúgy is illeszkedik a `ChatMessage`-re).

> A CLI single-turn marad (a multi-turn kliens az SP4 frontend a backenden át) — ez összhangban van a spec „Nem cél" szakaszával.

- [ ] **Step 2: Typecheck + test CLI**

Run:

```bash
pnpm nx typecheck @plantbase/cli
pnpm nx test @plantbase/cli
```

Expected: zöld.

- [ ] **Step 3: Manual smoke (opcionális, valós kulccsal)**

Run:

```bash
pnpm --filter @plantbase/cli exec tsx src/main.ts ask "Hogyan gondozzam a pozsgásokat?"
```

Expected: streamelt magyar válasz, mint korábban.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/main.ts
git commit -m "refactor(cli): adapt to message-based runChat signature"
```

---

## Task 14: env + docs + teljes verifikáció

**Files:**

- Modify: `.env.example`
- Modify: `docs/rag/roadmap.md`
- Modify: `CLAUDE.md` (backend-parancsok a „Gyakori parancsok" szekcióba)

**Interfaces:** —

- [ ] **Step 1: `.env.example`** — add hozzá (ha még nincs) a backend-portot, a meglévő stílusban:

```
# Backend (SP3b) — a POST /api/chat + debug endpointok portja
PORT=3000
```

- [ ] **Step 2: `docs/rag/roadmap.md`** — az „SP3b" szakasz státuszát `⏳ KÖVETKEZŐ`-ről `✅ KÉSZ`-re állítsd, egy mondat összefoglalóval (endpointok, UI Message Stream, history-tudatos runChat, runRetrievalDebug, spec/plan hivatkozás). Az „SP4" marad a következő.

- [ ] **Step 3: `CLAUDE.md`** — a „Gyakori parancsok" alá egy backend-blokk:

```bash
# Backend (SP3b: Express + AI SDK v7 UI Message Stream):
pnpm nx serve backend                 # build + node dist/main.js (PORT, default 3000)
pnpm --filter @plantbase/backend exec tsx src/main.ts   # dev-loop tsx-szel
# Endpointok: POST /api/chat (streaming), GET /api/debug/chunks,
#             POST /api/debug/search (HyDE ki/be × rerank), GET /api/health
```

Az „Architekturális invariánsok" közé egy sor: a backend a `createApp(deps)` DI-factoryn át áll össze; a HTTP-streaming a Vercel AI SDK v7 UI Message Stream (`createUIMessageStream` + `pipeUIMessageStreamToResponse`), a trace `data-trace` partként csak `DEBUG=true` mellett megy.

- [ ] **Step 4: Full workspace verification**

Run:

```bash
pnpm nx run-many -t typecheck test build
```

Expected: minden projekt (core, shared, cli, rag-builder, backend) zöld.

- [ ] **Step 5: Live end-to-end (valós kulcsokkal, futó Postgres + feltöltött tudásbázis)**

Run egyik terminálban:

```bash
set -a; . ./.env; set +a
pnpm nx serve backend
```

Másik terminálban:

```bash
# health
curl -s localhost:3000/api/health | jq
# chunk-stats
curl -s localhost:3000/api/debug/chunks | jq
# retrieval-összehasonlítás (rerank tényleg átrendez-e)
curl -s -X POST localhost:3000/api/debug/search \
  -H 'content-type: application/json' \
  -d '{"query":"Hogyan gondozzam a pozsgásokat?"}' | jq '.raw.rerank.results[].prevRank, .hyde.rerank.results[].prevRank'
# chat streaming (SSE)
curl -N -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hogyan gondozzam a pozsgásokat?"}]}'
```

Expected: `health` → `ok`; `chunks` → 202/448; `search` → a `prevRank`-ok mutatják az átrendezést (a rerank működik); `chat` → streamelt `text-delta` partok + a végén `data-sources`.

- [ ] **Step 6: Commit**

```bash
git add .env.example docs/rag/roadmap.md CLAUDE.md
git commit -m "docs(sp3b): backend commands, env, roadmap status"
```

---

## Self-Review

**Spec coverage:**

- history-tudatos `runChat` → Task 1–6. ✅
- `apps/backend` Express app, 4 endpoint → Task 9–12. ✅
- `POST /api/chat` UI Message Stream (text + data-trace[DEBUG] + data-sources) → Task 10. ✅
- `GET /api/debug/chunks` → Task 11. ✅
- `POST /api/debug/search` HyDE×rerank mátrix (`prevRank`) → Task 7 (DTO) + Task 8 (core helper) + Task 11 (route). ✅
- `GET /api/health` → Task 11. ✅
- `createApp(deps)` DI + supertest → Task 10–11. ✅
- Boundary zod-validáció, hibakezelés (400/503/500), graceful shutdown → Task 10–12. ✅
- CLI igazítás → Task 13. ✅
- env (`PORT`), docs → Task 14. ✅
- Shared debug DTO → Task 7. ✅

**Placeholder scan:** nincs TBD/TODO; minden lépés valós kódot vagy pontos parancsot tartalmaz.

**Type consistency:** `runChat(messages: readonly ChatMessage[], deps)` (Task 6) egyezik a CLI (Task 13) és a backend `chat` wiring (Task 12) hívásával; `BackendDeps` szignatúrái (Task 10) egyeznek a fake-ekkel (Task 10–11) és a prod-wiringgel (Task 12); `RetrievalDebugResult` (Task 7) egyezik a core helper (Task 8) visszatérésével és a route JSON-jével (Task 11); a stage-típusok history-paramétere (Task 2–5) egyezik a pipeline hívásaival (Task 6).

**Kockázatok / megjegyzések:**

- Az AI SDK v7 UI Message Stream part-alakja (`text-start`/`text-delta{delta}`/`text-end`, `data-*{data,transient}`, `pipeUIMessageStreamToResponse`) a Context7 dokumentációból ellenőrizve; ha a telepített `ai@7.0.37` API kis eltérést mutat, a Task 10 implementációját ahhoz kell igazítani (a tesztek `text-delta`/`data-sources`/`data-trace` sztringekre asszertálnak, ami a protokoll stabil eleme).
- Az Express 5 verzió (`^5.1.0`) + `@types/express@^5` feltételezett; ha a workspace más major-t húz, a Task 9 package.json-t ahhoz igazítsd (a route-kód Express 4/5 kompatibilis).
