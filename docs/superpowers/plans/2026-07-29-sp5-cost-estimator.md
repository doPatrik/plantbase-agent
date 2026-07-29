# SP5 Cost Estimator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Egy „Költség-becslő" fül a frontendben: beírt kérdésre lefuttatja a tudás-út (RAG) teljes pipeline-ját, és stage-enként (router/HyDE/embedding/rerank/válasz) modell + input/output token + USD-bontást ad, szerkeszthető árakkal (what-if számoláshoz).

**Architecture:** A meglévő RAG-stage-ek (`router`/`hyde`/`rerank`/`answer`) a token-`usage`-et mostantól a visszatérési értékükben is hordozzák (opcionális mező, backward-compatible a meglévő DI-fake tesztekkel). A `pipeline.ts` `runChat`-je ezt továbbítja `onTrace({type:'usage',...})`-ként (mellékhaszon: a chat DEBUG trace-panel is mutatja). Egy új `runCostEstimate` (core) ugyanezeket a stage-eket futtatja végig egyetlen kérdésre, gyűjti a stage-enkénti usage-t, és egy új `POST /api/debug/cost` (backend) adja vissza `CostEstimate` DTO-ként (usage + default árak). A frontend egy tab-shell mögé teszi a meglévő `ChatView`-t és egy új `CostEstimatorView`-t, ami a `computeStageCost` pure utillel élőben (LLM-hívás nélkül) számol a szerkeszthető árakkal.

**Tech Stack:** TypeScript strict, zod (boundary-validáció), Vitest (core+backend+frontend), React + Tailwind (meglévő SP4 shadcn-primitívek), Express (backend), `ai`/`@ai-sdk/anthropic`/`@ai-sdk/openai` (már telepítve).

## Global Constraints

- **TypeScript strict**; `kebab-case` fájlnevek; `interface` objektumokhoz, string-literál unió enum helyett; immutabilitás.
- **A meglévő stage-visszatérési típusok bővítése kizárólag opcionális `usage?`/`usage?: Promise<...>` mezőkkel történik** (kivéve a HyDE-nál, ahol a `Hyde` visszatérése `Promise<string>`-ről `Promise<{ text: string; usage?: StageUsage }>`-re vált — ez elkerülhetetlen, mert egy primitív stringhez nem lehet opcionális mezőt csatolni). Minden más meglévő teszt/fake-hívás ÉRINTETLEN marad.
- **Csak a tudás-utat mérjük** a becslőben (a katalógus-út SQL-költsége nem cél, lásd spec).
- **A `/api/debug/cost` NEM streamel** (sima JSON válasz).
- **A backend kontraktusát (`/api/chat`) NEM módosítjuk.**
- **A frontend csak `@plantbase/shared`-től függ**, a `@plantbase/core`-tól SOHA.
- **UI-szöveg magyarul.** Commit/PR **angolul** (Conventional Commits).
- **Product-kódban nincs `console.log`.** Tesztek: Vitest (+RTL a frontendhez), hálózat/DB nélkül (DI-fake).
- Minden commit végén: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch: `feat/sp5-cost-estimator` (már létrehozva, a spec commitja rajta van). Minden task egy külön commit.
- Design spec: `docs/superpowers/specs/2026-07-29-sp5-cost-estimator-design.md`.

---

### Task 1: `StageUsage` közös típus (core)

**Files:**

- Create: `packages/core/src/lib/rag/usage.ts`

**Interfaces:**

- Produces: `interface StageUsage { readonly model: string; readonly inputTokens: number; readonly outputTokens: number; }`

- [ ] **Step 1: Hozd létre a fájlt**

```ts
// Stage-usage kontraktus (SP5): minden LLM/embedding-hívó stage opcionálisan
// visszaadja, mennyi tokent használt (modell + input/output). A pipeline ezt
// trace-eseményként emittálja (mellékhaszon), a költség-becslő pedig
// stage-enként gyűjti (elsődleges cél).

export interface StageUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}
```

- [ ] **Step 2: Típusellenőrzés**

Run: `pnpm nx typecheck core`
Expected: PASS (a fájl önmagában nem hivatkozik semmire, ami hiányozna).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/lib/rag/usage.ts
git commit -m "feat(core): StageUsage type for per-stage token usage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Router — usage-átadás

**Files:**

- Modify: `packages/core/src/lib/rag/router.ts`
- Modify: `packages/core/src/lib/rag/router.spec.ts`

**Interfaces:**

- Consumes: `StageUsage` (Task 1).
- Produces: `GenerateObjectFn` (usage most opcionális mezőként visszaadja); `RouterDeps.modelId?: string`; `RouterResult.usage?: StageUsage`.

- [ ] **Step 1: Írj egy új, bukó tesztet a usage-átadásra (`router.spec.ts` végére)**

```ts
it('a generateObject usage-ét a modelId-vel StageUsage-ként adja vissza', async () => {
  const generateObject = (async () => ({
    object: { route: 'catalog', reasoning: 'r' },
    usage: { inputTokens: 120, outputTokens: 8 },
  })) as GenerateObjectFn;
  const router = createRouter({
    model,
    modelId: 'claude-haiku-4-5',
    generateObject,
  });
  const result = await router('kérdés');
  expect(result.usage).toEqual({
    model: 'claude-haiku-4-5',
    inputTokens: 120,
    outputTokens: 8,
  });
});

it('usage nélküli generateObject esetén a usage undefined', async () => {
  const generateObject = (async () => ({
    object: { route: 'catalog', reasoning: 'r' },
  })) as GenerateObjectFn;
  const router = createRouter({ model, generateObject });
  const result = await router('kérdés');
  expect(result.usage).toBeUndefined();
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- router.spec`
Expected: FAIL (`RouterResult` nem tartalmaz `usage`-et / `RouterDeps` nem ismeri a `modelId`-t — típushiba vagy `undefined !== ...`).

- [ ] **Step 3: Implementáld (`router.ts` teljes új tartalma)**

```ts
// LLM-router (SP3a): eldönti, hogy a kérdés a tudásbázisra (knowledge), a
// katalógusra (catalog), vagy mindkettőre (both) vonatkozik. Olcsó Haiku modell,
// zod-strukturált kimenet (generateObject). A generateObject injektálható a
// teszthez (DI-minta, vö. embedding.ts embedMany). A generateObject usage-e
// (SP5) opcionálisan átjön, hogy a costEstimate/trace mérni tudja a költséget.

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import {
  chatRouteSchema,
  type ChatRoute,
  type ChatMessage,
} from '@plantbase/shared';
import { formatHistoryForPrompt } from './history.js';
import type { StageUsage } from './usage.js';

/** A router strukturált kimenete. */
export interface RouterResult {
  readonly route: ChatRoute;
  readonly reasoning: string;
  /** A router-hívás token-usage-e (SP5); hiányzik, ha a generateObject nem adott usage-t. */
  readonly usage?: StageUsage;
}

const routerSchema = z.object({
  route: chatRouteSchema,
  reasoning: z.string(),
});

/** Szűk, injektálható generateObject (csak amit a router/rerank használ). */
export type GenerateObjectFn = <T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
}) => Promise<{
  object: T;
  usage?: { inputTokens: number; outputTokens: number };
}>;

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object, usage } = await generateObject({
    model,
    schema,
    system,
    prompt,
  });
  return {
    object,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
};

const ROUTER_SYSTEM = `Te a Plantbase asszisztens útvonalválasztója vagy. Döntsd el, honnan jöhet a válasz:
- "knowledge": általános növénygondozási / ismeretkérdés (a tudásbázis cikkeiből).
- "catalog": konkrét termékadat a webshop katalógusából (ár, készlet, méret, szűrés, kategória).
- "both": mindkettő kell (pl. "milyen pozsgást vegyek és hogyan gondozzam").
Adj rövid magyar indoklást (reasoning).`;

export interface RouterDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5); alapból "unknown". */
  readonly modelId?: string;
  readonly generateObject?: GenerateObjectFn;
}

export type Router = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<RouterResult>;

/** Létrehozza a router-függvényt (a modell és a generateObject bekötve). */
export function createRouter(deps: RouterDeps): Router {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question, history = []) => {
    const { object, usage } = await run({
      model: deps.model,
      schema: routerSchema,
      system: ROUTER_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return {
      ...object,
      usage: usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined,
    };
  };
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test core -- router.spec`
Expected: PASS (mind az 5 teszt: a 3 régi + a 2 új).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/router.ts packages/core/src/lib/rag/router.spec.ts
git commit -m "feat(core): router carries optional StageUsage for cost tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rerank — usage-átadás

**Files:**

- Modify: `packages/core/src/lib/rag/rerank.ts`
- Modify: `packages/core/src/lib/rag/rerank.spec.ts`

**Interfaces:**

- Consumes: `GenerateObjectFn` (Task 2, már usage-et ad), `StageUsage` (Task 1).
- Produces: `RerankDeps.modelId?: string`; `RerankOutcome.usage?: StageUsage`.

- [ ] **Step 1: Írj egy új, bukó tesztet (`rerank.spec.ts` végére)**

```ts
it('sikeres rerank esetén a usage-et StageUsage-ként adja vissza', async () => {
  const generateObject = (async () => ({
    object: { ranking: [2, 0] },
    usage: { inputTokens: 300, outputTokens: 12 },
  })) as GenerateObjectFn;
  const rerank = createRerank({
    model,
    topN: 2,
    modelId: 'claude-haiku-4-5',
    generateObject,
  });
  const outcome = await rerank('kérdés', input);
  expect(outcome.usage).toEqual({
    model: 'claude-haiku-4-5',
    inputTokens: 300,
    outputTokens: 12,
  });
});

it('degradált (hibás) rerank esetén a usage undefined', async () => {
  const generateObject = (async () => {
    throw new Error('rerank model down');
  }) as GenerateObjectFn;
  const rerank = createRerank({ model, topN: 2, generateObject });
  const outcome = await rerank('kérdés', input);
  expect(outcome.usage).toBeUndefined();
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- rerank.spec`
Expected: FAIL (`RerankOutcome` nem ismeri a `usage` mezőt).

- [ ] **Step 3: Implementáld (`rerank.ts` teljes új tartalma)**

```ts
// Rerank stage (SP3a): a top-K chunkot relevancia szerint újrarendezi (Haiku), és
// az első topN-et tartja meg. A modell a chunkok INDEXEIT adja vissza sorrendben
// (0-alapú), így a tartalmat nem kell visszaküldenie. Hibára / érvénytelen indexre
// DEGRADÁL: a nyers retrieval-sorrend első topN eleme megy tovább (degraded: true).
// Így a "rerank mindig lefut és nem dönti be a pipeline-t" garancia teljesül.
// A usage (SP5) csak sikeres hívásnál elérhető; degradált ágon undefined.

import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { SearchResult } from '../knowledge-store.js';
import type { GenerateObjectFn } from './router.js';
import { generateObject } from 'ai';
import type { StageUsage } from './usage.js';

const rerankSchema = z.object({
  ranking: z.array(z.number().int().nonnegative()),
});

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object, usage } = await generateObject({
    model,
    schema,
    system,
    prompt,
  });
  return {
    object,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
};

const RERANK_SYSTEM = `Rangsorold a számozott dokumentum-részleteket a kérdés szempontjából relevancia szerint (legrelevánsabb elöl). A "ranking" mezőben a részletek 0-alapú indexeit add vissza, csökkenő relevancia sorrendben. Csak a valóban releváns részletek indexeit sorold fel.`;

export interface RerankOutcome {
  readonly chunks: SearchResult[];
  readonly degraded: boolean;
  /** A rerank-hívás token-usage-e (SP5); hiányzik degradált (hiba/érvénytelen) ágon. */
  readonly usage?: StageUsage;
}

export interface RerankDeps {
  readonly model: LanguageModel;
  readonly topN: number;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
  readonly generateObject?: GenerateObjectFn;
}

export type Rerank = (
  question: string,
  chunks: readonly SearchResult[],
) => Promise<RerankOutcome>;

function rawTopN(
  chunks: readonly SearchResult[],
  topN: number,
): SearchResult[] {
  return chunks.slice(0, topN);
}

export function createRerank(deps: RerankDeps): Rerank {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question, chunks) => {
    if (chunks.length === 0) {
      return { chunks: [], degraded: false };
    }
    const numbered = chunks
      .map(
        (c, i) =>
          `[${i}] ${c.title}${c.heading_path ? ` — ${c.heading_path}` : ''}\n${c.content}`,
      )
      .join('\n\n');
    try {
      const { object, usage } = await run({
        model: deps.model,
        schema: rerankSchema,
        system: RERANK_SYSTEM,
        prompt: `Kérdés: ${question}\n\nRészletek:\n${numbered}`,
      });
      const stageUsage: StageUsage | undefined = usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined;
      const seen = new Set<number>();
      const picked: SearchResult[] = [];
      for (const index of object.ranking) {
        if (index < 0 || index >= chunks.length || seen.has(index)) {
          return {
            chunks: rawTopN(chunks, deps.topN),
            degraded: true,
            usage: stageUsage,
          };
        }
        seen.add(index);
        picked.push(chunks[index]);
        if (picked.length >= deps.topN) break;
      }
      if (picked.length === 0) {
        return {
          chunks: rawTopN(chunks, deps.topN),
          degraded: true,
          usage: stageUsage,
        };
      }
      return { chunks: picked, degraded: false, usage: stageUsage };
    } catch {
      return { chunks: rawTopN(chunks, deps.topN), degraded: true };
    }
  };
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test core -- rerank.spec`
Expected: PASS (mind a 6 teszt).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/rerank.ts packages/core/src/lib/rag/rerank.spec.ts
git commit -m "feat(core): rerank carries optional StageUsage for cost tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Answer — usage-átadás (streamText, async usage)

**Files:**

- Modify: `packages/core/src/lib/rag/answer.ts`
- Modify: `packages/core/src/lib/rag/answer.spec.ts`

**Interfaces:**

- Consumes: `StageUsage` (Task 1).
- Produces: `AnswerStreamFn` (usage most opcionális `Promise`-ként visszaadja); `AnswerDeps.modelId?: string`; `AnswerResult.usage?: Promise<StageUsage>`.

- [ ] **Step 1: Írj egy új, bukó tesztet (`answer.spec.ts` végére, a `describe('createAnswer', ...)` blokkba)**

```ts
it('a streamAnswer usage-ét a modelId-vel StageUsage-ként adja vissza (drain után)', async () => {
  const streamAnswer: AnswerStreamFn = () => ({
    textStream: (async function* () {
      yield 'ok';
    })(),
    usage: Promise.resolve({ inputTokens: 500, outputTokens: 40 }),
  });
  const answer = createAnswer({
    model,
    modelId: 'claude-sonnet-4-6',
    streamAnswer,
  });
  const result = answer({ question: 'q', chunks: [] });
  expect(await collect(result.textStream)).toBe('ok');
  expect(await result.usage).toEqual({
    model: 'claude-sonnet-4-6',
    inputTokens: 500,
    outputTokens: 40,
  });
});

it('usage nélküli streamAnswer esetén a usage undefined', async () => {
  const streamAnswer: AnswerStreamFn = () => ({
    textStream: (async function* () {
      yield 'ok';
    })(),
  });
  const answer = createAnswer({ model, streamAnswer });
  const result = answer({ question: 'q', chunks: [] });
  expect(result.usage).toBeUndefined();
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- answer.spec`
Expected: FAIL (`AnswerStreamFn`/`AnswerResult` nem ismeri a `usage`-et).

- [ ] **Step 3: Implementáld — csak a releváns részek módosulnak (`answer.ts`)**

A fájl tetején, az importok közé:

```ts
import type { StageUsage } from './usage.js';
```

Az `AnswerStreamFn` és `defaultStreamAnswer` cseréje:

```ts
/** Szűk, injektálható streamText (csak amit az answer használ). A usage (SP5)
 *  Promise, mert a streamText usage-e csak a stream teljes elfogyasztása után áll
 *  rendelkezésre. */
export type AnswerStreamFn = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) => {
  textStream: AsyncIterable<string>;
  usage?: Promise<{ inputTokens: number; outputTokens: number }>;
};

const defaultStreamAnswer: AnswerStreamFn = ({ model, system, prompt }) => {
  const { textStream, usage } = streamText({ model, system, prompt });
  return {
    textStream,
    usage: usage.then((u) => ({
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    })),
  };
};
```

`AnswerResult` és `AnswerDeps`:

```ts
export interface AnswerResult {
  readonly textStream: AsyncIterable<string>;
  readonly sources: readonly SourceRef[];
  /** A válasz-hívás token-usage-e (SP5); a stream teljes elfogyasztása után resolve-ol. */
  readonly usage?: Promise<StageUsage>;
}

export interface AnswerDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
  readonly streamAnswer?: AnswerStreamFn;
}
```

`createAnswer` visszatérési objektuma:

```ts
export function createAnswer(deps: AnswerDeps): Answer {
  const run = deps.streamAnswer ?? defaultStreamAnswer;
  return (input) => {
    const sources = toSourceRefs(input.chunks);
    const context = buildContext(input.chunks);
    const catalog = input.catalogContext
      ? `\n\nKatalógus-adatok:\n${input.catalogContext}`
      : '';
    const historyBlock = formatHistoryForPrompt(input.history ?? []);
    const { textStream, usage } = run({
      model: deps.model,
      system: ANSWER_SYSTEM,
      prompt: `${historyBlock}Kérdés: ${input.question}\n\nForrásrészletek:\n${context}${catalog}`,
    });
    return {
      textStream,
      sources,
      usage: usage?.then((u) => ({
        model: deps.modelId ?? 'unknown',
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      })),
    };
  };
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test core -- answer.spec`
Expected: PASS (mind az 5 teszt).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/answer.ts packages/core/src/lib/rag/answer.spec.ts
git commit -m "feat(core): answer carries optional async StageUsage for cost tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: HyDE — usage-átadás (visszatérési típus `string` → `{text, usage?}`)

**Files:**

- Modify: `packages/core/src/lib/rag/hyde.ts`
- Modify: `packages/core/src/lib/rag/hyde.spec.ts`
- Modify: `packages/core/src/lib/rag/retrieval-debug.ts`
- Modify: `packages/core/src/lib/rag/retrieval-debug.spec.ts`
- Modify: `packages/core/src/lib/rag/pipeline.ts` (csak a `hyde`-hívás pontja; a többi Task 6-ban)
- Modify: `packages/core/src/lib/rag/pipeline.spec.ts` (a `hyde` fake-ek)

**Interfaces:**

- Consumes: `StageUsage` (Task 1).
- Produces: `Hyde = (question, history?) => Promise<{ text: string; usage?: StageUsage }>` (eddig `Promise<string>` volt — EZ AZ EGYETLEN, indokolt visszatérés-alak-törés a tervben, mert egy primitív stringhez nem lehet opcionális mezőt csatolni).

Ez a legszélesebb hatókörű task a tervben — minden hívási pontot frissít, amit a HyDE visszatérési típusa érint.

- [ ] **Step 1: Írj bukó teszteket (`hyde.spec.ts` teljes új tartalma)**

```ts
import { createHyde, type GenerateTextFn } from './hyde.js';
import type { LanguageModel } from 'ai';

const model = { modelId: 'fake' } as unknown as LanguageModel;

describe('createHyde', () => {
  it('returns a hypothetical answer document for the question', async () => {
    let capturedPrompt = '';
    const generateText: GenerateTextFn = async ({ prompt }) => {
      capturedPrompt = prompt;
      return { text: 'A pozsgásokat ritkán, alaposan kell öntözni.' };
    };
    const hyde = createHyde({ model, generateText });
    const doc = await hyde('Hogyan öntözzem a pozsgást?');
    expect(doc.text).toContain('öntözni');
    expect(capturedPrompt).toContain('Hogyan öntözzem a pozsgást?');
  });

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

  it('a generateText usage-ét a modelId-vel StageUsage-ként adja vissza', async () => {
    const hyde = createHyde({
      model,
      modelId: 'claude-haiku-4-5',
      generateText: async () => ({
        text: 'hipotetikus',
        usage: { inputTokens: 40, outputTokens: 30 },
      }),
    });
    const result = await hyde('kérdés');
    expect(result.usage).toEqual({
      model: 'claude-haiku-4-5',
      inputTokens: 40,
      outputTokens: 30,
    });
  });

  it('usage nélküli generateText esetén a usage undefined', async () => {
    const hyde = createHyde({
      model,
      generateText: async () => ({ text: 'hipotetikus' }),
    });
    const result = await hyde('kérdés');
    expect(result.usage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- hyde.spec`
Expected: FAIL (`doc.text` — a jelenlegi `hyde()` stringet ad vissza, nincs `.text`).

- [ ] **Step 3: Implementáld (`hyde.ts` teljes új tartalma)**

```ts
// HyDE (Hypothetical Document Embeddings) stage (SP3a): a kérdésre generálunk egy
// rövid, hipotetikus választ, és AZT ágyazzuk be a vektorkereséshez (a query-oldal
// minősége nő, mert a hipotetikus válasz szókincse közelebb áll a tárolt cikkekhez).
// Olcsó Haiku; a generateText injektálható a teszthez. A usage (SP5) a text
// mellett opcionálisan érkezik, ezért a Hyde visszatérése objektum (nem bare string).

import { generateText, type LanguageModel } from 'ai';
import { formatHistoryForPrompt } from './history.js';
import type { ChatMessage } from '@plantbase/shared';
import type { StageUsage } from './usage.js';

/** Szűk, injektálható generateText (csak amit a HyDE használ). */
export type GenerateTextFn = (args: {
  model: LanguageModel;
  system?: string;
  prompt: string;
}) => Promise<{
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}>;

const defaultGenerateText: GenerateTextFn = async ({
  model,
  system,
  prompt,
}) => {
  const { text, usage } = await generateText({ model, system, prompt });
  return {
    text,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
};

const HYDE_SYSTEM = `Írj egy rövid (2-4 mondatos), tárgyszerű magyar bekezdést, amely úgy válaszol a kérdésre, mintha egy növénygondozási cikk részlete lenne. Ne kérdezz vissza, ne mentegetőzz — csak a hipotetikus válasz szövegét add.`;

export interface HydeResult {
  readonly text: string;
  /** A HyDE-hívás token-usage-e (SP5); hiányzik, ha a generateText nem adott usage-t. */
  readonly usage?: StageUsage;
}

export interface HydeDeps {
  readonly model: LanguageModel;
  /** A trace-ben/becslőben megjelenő modell-azonosító (SP5). */
  readonly modelId?: string;
  readonly generateText?: GenerateTextFn;
}

export type Hyde = (
  question: string,
  history?: readonly ChatMessage[],
) => Promise<HydeResult>;

/** Létrehozza a HyDE-függvényt. */
export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question, history = []) => {
    const { text, usage } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `${formatHistoryForPrompt(history)}Kérdés: ${question}`,
    });
    return {
      text: text.trim(),
      usage: usage
        ? {
            model: deps.modelId ?? 'unknown',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined,
    };
  };
}
```

- [ ] **Step 4: Futtasd a hyde tesztet — passzoljon**

Run: `pnpm nx test core -- hyde.spec`
Expected: PASS (mind a 4 teszt).

- [ ] **Step 5: Frissítsd a `retrieval-debug.ts`-t (csak a hyde-hívás pontja)**

Cseréld ki ezt a sort:

```ts
const hydeDoc = await deps.hyde(query);
```

erre:

```ts
const hydeDoc = (await deps.hyde(query)).text;
```

(A többi kód változatlan — a `hydeDoc` innentől ugyanúgy stringként viselkedik.)

- [ ] **Step 6: Frissítsd a `retrieval-debug.spec.ts`-t (a `hyde` fake)**

A `makeDeps` függvényben cseréld:

```ts
    hyde: async () => 'hipotetikus dokumentum',
```

erre:

```ts
    hyde: async () => ({ text: 'hipotetikus dokumentum' }),
```

- [ ] **Step 7: Futtasd a retrieval-debug tesztet — passzoljon**

Run: `pnpm nx test core -- retrieval-debug.spec`
Expected: PASS (mind a 3 teszt, változatlan assertek — a `out.hydeDoc` továbbra is string).

- [ ] **Step 8: Frissítsd a `pipeline.ts` hyde-hívási pontját**

Cseréld ki:

```ts
const hydeDoc = await deps.hyde(question, history);
onTrace({ type: 'hyde', hydeDoc });

const retrieved = await deps.retrieve(hydeDoc);
```

erre:

```ts
const hydeResult = await deps.hyde(question, history);
onTrace({ type: 'hyde', hydeDoc: hydeResult.text });

const retrieved = await deps.retrieve(hydeResult.text);
```

- [ ] **Step 9: Frissítsd a `pipeline.spec.ts` hyde fake-jeit**

Két helyen szerepel bare-string visszatérésű `hyde` fake: a `baseDeps`-ben és a „catalog route" tesztben. Cseréld:

```ts
    hyde: async (_q, _hist) => 'hyde doc',
```

erre:

```ts
    hyde: async (_q, _hist) => ({ text: 'hyde doc' }),
```

és:

```ts
        hyde: async () => {
          hydeCalled = true;
          return 'x';
        },
```

erre:

```ts
        hyde: async () => {
          hydeCalled = true;
          return { text: 'x' };
        },
```

- [ ] **Step 10: Futtasd a teljes pipeline tesztet — passzoljon**

Run: `pnpm nx test core -- pipeline.spec`
Expected: PASS (mind a 6 teszt, változatlan viselkedés).

- [ ] **Step 11: Teljes core-teszt + typecheck**

Run: `pnpm nx run-many -t test typecheck -p core`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/lib/rag/hyde.ts packages/core/src/lib/rag/hyde.spec.ts \
        packages/core/src/lib/rag/retrieval-debug.ts packages/core/src/lib/rag/retrieval-debug.spec.ts \
        packages/core/src/lib/rag/pipeline.ts packages/core/src/lib/rag/pipeline.spec.ts
git commit -m "feat(core): hyde returns {text, usage?} instead of bare string

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Pipeline — usage trace-emisszió + modelId-wiring

**Files:**

- Modify: `packages/core/src/lib/rag/pipeline.ts`
- Modify: `packages/core/src/lib/rag/pipeline.spec.ts`

**Interfaces:**

- Consumes: `RouterResult.usage`, `RerankOutcome.usage`, `AnswerResult.usage` (Tasks 2-4).
- Produces: `runChat` mostantól `onTrace({type:'usage', stage, model, inputTokens, outputTokens})`-t is emittál router/hyde/rerank/answer stage-enként (ha van usage); `createDefaultChatDeps` a `ragConfig`-ból wire-eli a `modelId`-ket.

- [ ] **Step 1: Írj egy bukó tesztet (`pipeline.spec.ts` végére, új `describe` blokk)**

```ts
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
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- pipeline.spec`
Expected: FAIL (a `runChat` jelenleg nem emittál `usage` trace-t).

- [ ] **Step 3: Implementáld — `runChat` frissítése (`pipeline.ts`)**

Cseréld ki a router-hívás blokkját:

```ts
const { route, reasoning } = await deps.router(question, history);
onTrace({ type: 'router', route, reasoning });
```

erre:

```ts
const routerResult = await deps.router(question, history);
const { route, reasoning } = routerResult;
onTrace({ type: 'router', route, reasoning });
if (routerResult.usage) {
  onTrace({ type: 'usage', stage: 'router', ...routerResult.usage });
}
```

A hyde-hívás blokkját (a Task 5 Step 8-ban már módosított formára építve):

```ts
const hydeResult = await deps.hyde(question, history);
onTrace({ type: 'hyde', hydeDoc: hydeResult.text });
if (hydeResult.usage) {
  onTrace({ type: 'usage', stage: 'hyde', ...hydeResult.usage });
}

const retrieved = await deps.retrieve(hydeResult.text);
```

A rerank-hívás blokkját:

```ts
const reranked = await deps.rerank(question, retrieved);
onTrace({
  type: 'rerank',
  inputCount: retrieved.length,
  outputCount: reranked.chunks.length,
  degraded: reranked.degraded,
});
if (reranked.usage) {
  onTrace({ type: 'usage', stage: 'rerank', ...reranked.usage });
}
```

Az answer-hívás blokkját (a grounded ágon):

```ts
const answered = deps.answer({
  question,
  chunks: grounding.grounded ? reranked.chunks : [],
  catalogContext,
  history,
});
sources = answered.sources;
answerStream = answered.textStream;
answered.usage?.then((usage) =>
  onTrace({ type: 'usage', stage: 'answer', ...usage }),
);
```

> Megjegyzés: az answer usage-e Promise (a streamText usage-e csak a stream teljes elfogyasztása után áll rendelkezésre), ezért `.then()`-nel, fire-and-forget módon emittáljuk — ez a DEBUG trace-panel „mellékhaszna", nem kritikus időzítésű útvonal (a költség-becslő elsődleges útja, Task 8, determinisztikusan `await`-eli ugyanezt a usage Promise-t).

- [ ] **Step 4: Implementáld — `createDefaultChatDeps` modelId-wiring**

Cseréld ki a függvény törzsét:

```ts
export function createDefaultChatDeps(
  overrides: Partial<ChatDeps> = {},
): ChatDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    router: createRouter({
      model: models.router,
      modelId: ragConfig.routerModel,
    }),
    hyde: createHyde({ model: models.hyde, modelId: ragConfig.hydeModel }),
    retrieve: createRetrieve({ topK: ragConfig.topK }),
    rerank: createRerank({
      model: models.rerank,
      topN: ragConfig.rerankTopN,
      modelId: ragConfig.rerankModel,
    }),
    answer: createAnswer({
      model: models.answer,
      modelId: ragConfig.answerModel,
    }),
    catalogAgent: createCatalogAgent({
      model: models.catalog,
      runSql: (q) => defaultRunSql(q),
      listCategories: () => defaultListCategories(),
      maxIterations: ragConfig.maxAgentIterations,
    }),
    groundingThreshold: ragConfig.groundingThreshold,
    topK: ragConfig.topK,
    ...overrides,
  };
}
```

(Az embedding-usage nem kerül be a chat-trace-be — ez tudatos scope-vágás: az embedding-költség a dedikált költség-becslőben (Task 8-9) jelenik meg, a chat DEBUG-panelben nem, mert a `Retrieve` visszatérési típusát (nyers `SearchResult[]` tömb) nem bővítjük — lásd a terv önreview-ját.)

- [ ] **Step 5: Futtasd — passzoljon**

Run: `pnpm nx test core -- pipeline.spec`
Expected: PASS (mind a 8 teszt: a 6 régi + a 2 új).

- [ ] **Step 6: Teljes core-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/rag/pipeline.ts packages/core/src/lib/rag/pipeline.spec.ts
git commit -m "feat(core): runChat emits usage trace events per stage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Ár-modul (`loadModelPrices`)

**Files:**

- Modify: `packages/core/src/lib/config.ts`
- Modify: `packages/core/src/lib/config.spec.ts`

**Interfaces:**

- Produces: `interface ModelPrice { readonly inputPerM: number; readonly outputPerM: number; }`; `loadModelPrices(cwd?: string): Record<string, ModelPrice>`.

- [ ] **Step 1: Írj bukó teszteket (`config.spec.ts` végére)**

```ts
describe('loadModelPrices', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('a default Haiku/Sonnet/embedding árakat adja, ha nincs env-felülírás', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_EMBEDDING_PRICE_PER_M;
    delete process.env.RAG_PRICE_HAIKU_INPUT_PER_M;
    delete process.env.RAG_PRICE_HAIKU_OUTPUT_PER_M;
    delete process.env.RAG_PRICE_SONNET_INPUT_PER_M;
    delete process.env.RAG_PRICE_SONNET_OUTPUT_PER_M;
    const prices = loadModelPrices('/');
    expect(prices['claude-haiku-4-5']).toEqual({
      inputPerM: 1.0,
      outputPerM: 5.0,
    });
    expect(prices['claude-sonnet-4-6']).toEqual({
      inputPerM: 3.0,
      outputPerM: 15.0,
    });
    expect(prices['text-embedding-3-small']).toEqual({
      inputPerM: 0.02,
      outputPerM: 0,
    });
  });

  it('honorálja a RAG_PRICE_* env-felülírásokat', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    process.env.RAG_PRICE_HAIKU_INPUT_PER_M = '2';
    process.env.RAG_PRICE_HAIKU_OUTPUT_PER_M = '10';
    process.env.RAG_PRICE_SONNET_INPUT_PER_M = '6';
    process.env.RAG_PRICE_SONNET_OUTPUT_PER_M = '30';
    const prices = loadModelPrices('/');
    expect(prices['claude-haiku-4-5']).toEqual({
      inputPerM: 2,
      outputPerM: 10,
    });
    expect(prices['claude-sonnet-4-6']).toEqual({
      inputPerM: 6,
      outputPerM: 30,
    });
  });

  it('throw-ol, ha az OPENAI_API_KEY hiányzik (az embedding-ár is kell)', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadModelPrices('/')).toThrow(/OPENAI_API_KEY/);
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- config.spec`
Expected: FAIL (`loadModelPrices` nem létezik).

- [ ] **Step 3: Implementáld (`config.ts` végére fűzd hozzá)**

```ts
/** Modellenkénti listaár (USD / 1M token) — a költség-becslőhöz. */
export interface ModelPrice {
  readonly inputPerM: number;
  readonly outputPerM: number;
}

const HAIKU_MODEL_ID = 'claude-haiku-4-5';
const SONNET_MODEL_ID = 'claude-sonnet-4-6';
const DEFAULT_HAIKU_INPUT_PRICE = 1.0;
const DEFAULT_HAIKU_OUTPUT_PRICE = 5.0;
const DEFAULT_SONNET_INPUT_PRICE = 3.0;
const DEFAULT_SONNET_OUTPUT_PRICE = 15.0;

const priceEnvSchema = z.object({
  RAG_PRICE_HAIKU_INPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_HAIKU_INPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_HAIKU_OUTPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_HAIKU_OUTPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_SONNET_INPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_SONNET_INPUT_PER_M nem lehet negatív.')
    .optional(),
  RAG_PRICE_SONNET_OUTPUT_PER_M: z.coerce
    .number()
    .nonnegative('RAG_PRICE_SONNET_OUTPUT_PER_M nem lehet negatív.')
    .optional(),
});

/**
 * Betölti a modellenkénti default listaárakat (Haiku/Sonnet/embedding), env-ből
 * felülírhatóan. A kulcsok a DEFAULT modell-azonosítók (claude-haiku-4-5,
 * claude-sonnet-4-6, text-embedding-3-small) — ha valaki egyedi RAG_*_MODEL-t
 * állít be, arra nem lesz ár-bejegyzés (a becslő ismeretlen-ár-ként kezeli).
 * @throws {Error} ha az OPENAI_API_KEY hiányzik (az embedding-ár ebből épül).
 */
export function loadModelPrices(
  cwd: string = process.cwd(),
): Record<string, ModelPrice> {
  loadDotenvFromNearest(cwd);
  const result = priceEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás ár-konfiguráció: ${issues}`);
  }
  const embedding = loadEmbeddingConfig(cwd);
  return {
    [HAIKU_MODEL_ID]: {
      inputPerM:
        result.data.RAG_PRICE_HAIKU_INPUT_PER_M ?? DEFAULT_HAIKU_INPUT_PRICE,
      outputPerM:
        result.data.RAG_PRICE_HAIKU_OUTPUT_PER_M ?? DEFAULT_HAIKU_OUTPUT_PRICE,
    },
    [SONNET_MODEL_ID]: {
      inputPerM:
        result.data.RAG_PRICE_SONNET_INPUT_PER_M ?? DEFAULT_SONNET_INPUT_PRICE,
      outputPerM:
        result.data.RAG_PRICE_SONNET_OUTPUT_PER_M ??
        DEFAULT_SONNET_OUTPUT_PRICE,
    },
    [embedding.model]: {
      inputPerM: embedding.pricePerMillionTokens,
      outputPerM: 0,
    },
  };
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test core -- config.spec`
Expected: PASS (mind a 3 új teszt + a régiek).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/config.ts packages/core/src/lib/config.spec.ts
git commit -m "feat(core): loadModelPrices (Haiku/Sonnet/embedding default prices, env-overridable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Shared DTO-k + `computeStageCost`

**Files:**

- Create: `packages/shared/src/lib/cost.ts`
- Create: `packages/shared/src/lib/cost.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces: `StageUsageDto`, `stageUsageDtoSchema`; `ModelPrice`, `modelPriceSchema`; `CostEstimate`, `costEstimateSchema`; `CostEstimateRequest`, `costEstimateRequestSchema`; `computeStageCost(usage, price?): { inputCostUsd; outputCostUsd; totalUsd }`.

- [ ] **Step 1: Írj bukó teszteket (`packages/shared/src/lib/cost.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import {
  computeStageCost,
  costEstimateSchema,
  type StageUsageDto,
} from './cost.js';

const usage: StageUsageDto = {
  stage: 'answer',
  model: 'claude-sonnet-4-6',
  inputTokens: 2_000_000,
  outputTokens: 1_000_000,
};

describe('computeStageCost', () => {
  it('kiszámolja az input/output/összesített USD-t az árból', () => {
    const cost = computeStageCost(usage, { inputPerM: 3, outputPerM: 15 });
    expect(cost.inputCostUsd).toBeCloseTo(6);
    expect(cost.outputCostUsd).toBeCloseTo(15);
    expect(cost.totalUsd).toBeCloseTo(21);
  });

  it('nulla token esetén nulla költséget ad', () => {
    const cost = computeStageCost(
      { ...usage, inputTokens: 0, outputTokens: 0 },
      { inputPerM: 3, outputPerM: 15 },
    );
    expect(cost.totalUsd).toBe(0);
  });

  it('ismeretlen (hiányzó) ár esetén nulla költséget ad', () => {
    const cost = computeStageCost(usage, undefined);
    expect(cost).toEqual({ inputCostUsd: 0, outputCostUsd: 0, totalUsd: 0 });
  });
});

describe('costEstimateSchema', () => {
  it('elfogadja az érvényes alakot', () => {
    const parsed = costEstimateSchema.safeParse({
      query: 'kérdés',
      route: 'knowledge',
      stages: [usage],
      defaultPrices: { 'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 } },
    });
    expect(parsed.success).toBe(true);
  });

  it('elutasítja a route: "catalog"-ot (a becslő mindig knowledge)', () => {
    const parsed = costEstimateSchema.safeParse({
      query: 'kérdés',
      route: 'catalog',
      stages: [],
      defaultPrices: {},
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test shared -- cost.spec`
Expected: FAIL (a `./cost.js` modul nem létezik).

- [ ] **Step 3: Implementáld (`packages/shared/src/lib/cost.ts`)**

```ts
// A /api/debug/cost kontraktusa (SP5): a tudás-út teljes futtatásának
// stage-enkénti (router/hyde/embedding/rerank/answer) token-usage-e + a
// modellenkénti default listaárak. A computeStageCost pure util — a frontend
// ezzel számolja élőben (LLM-hívás nélkül) a szerkeszthető árakból az USD-t.

import { z } from 'zod';

export interface StageUsageDto {
  readonly stage: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const stageUsageDtoSchema = z.object({
  stage: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export interface ModelPrice {
  readonly inputPerM: number;
  readonly outputPerM: number;
}

export const modelPriceSchema = z.object({
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
});

export interface CostEstimate {
  readonly query: string;
  /** A becslő a scope szerint mindig a tudás-utat méri. */
  readonly route: 'knowledge';
  readonly stages: readonly StageUsageDto[];
  readonly defaultPrices: Readonly<Record<string, ModelPrice>>;
}

export const costEstimateSchema = z.object({
  query: z.string(),
  route: z.literal('knowledge'),
  stages: z.array(stageUsageDtoSchema),
  defaultPrices: z.record(z.string(), modelPriceSchema),
});

export const costEstimateRequestSchema = z.object({
  query: z.string().min(1, 'A query nem lehet üres.'),
});
export type CostEstimateRequest = z.infer<typeof costEstimateRequestSchema>;

export interface StageCost {
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly totalUsd: number;
}

/** Pure util: egy stage usage-éből az USD-költség. Ismeretlen (hiányzó) árra nulla. */
export function computeStageCost(
  usage: StageUsageDto,
  price: ModelPrice | undefined,
): StageCost {
  if (!price) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalUsd: 0 };
  }
  const inputCostUsd = (usage.inputTokens / 1_000_000) * price.inputPerM;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * price.outputPerM;
  return {
    inputCostUsd,
    outputCostUsd,
    totalUsd: inputCostUsd + outputCostUsd,
  };
}
```

- [ ] **Step 4: Exportáld az `index.ts`-ből**

```ts
export * from './lib/engine-trace.js';
export * from './lib/chat.js';
export * from './lib/retrieval-debug.js';
export * from './lib/cost.js';
```

- [ ] **Step 5: Futtasd — passzoljon**

Run: `pnpm nx test shared -- cost.spec`
Expected: PASS (mind az 5 teszt).

- [ ] **Step 6: Teljes shared-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p shared`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/lib/cost.ts packages/shared/src/lib/cost.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): CostEstimate DTOs + computeStageCost pure util

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `runCostEstimate` + `createDefaultCostEstimateDeps` (core)

**Files:**

- Create: `packages/core/src/lib/rag/cost-estimate.ts`
- Create: `packages/core/src/lib/rag/cost-estimate.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `Router`/`Hyde`/`Rerank`/`Answer` (meglévő stage-típusok, most usage-et is adnak), `SearchChunksFn` (retrieval.ts), `StageUsageDto` (`@plantbase/shared`), `loadModelPrices`-hoz hasonló mintájú configok.
- Produces: `runCostEstimate(query, deps): Promise<readonly StageUsageDto[]>`; `createDefaultCostEstimateDeps(): CostEstimateDeps`.

- [ ] **Step 1: Írj bukó teszteket (`packages/core/src/lib/rag/cost-estimate.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { runCostEstimate, type CostEstimateDeps } from './cost-estimate.js';
import type { SearchResult } from '../knowledge-store.js';

const chunk = (id: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: 0.6,
});

function baseDeps(overrides: Partial<CostEstimateDeps> = {}): CostEstimateDeps {
  return {
    router: async () => ({
      route: 'knowledge',
      reasoning: 'r',
      usage: { model: 'router-model', inputTokens: 10, outputTokens: 2 },
    }),
    hyde: async () => ({
      text: 'hyde doc',
      usage: { model: 'hyde-model', inputTokens: 20, outputTokens: 5 },
    }),
    embedQueryWithUsage: async () => ({
      embedding: [0.1, 0.2],
      totalTokens: 8,
      model: 'text-embedding-3-small',
    }),
    searchChunks: async () => [chunk(1), chunk(2)],
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
    topK: 12,
    ...overrides,
  };
}

describe('runCostEstimate', () => {
  it('stage-enként gyűjti a usage-et router → hyde → embedding → rerank → answer sorrendben', async () => {
    const stages = await runCostEstimate('kérdés', baseDeps());
    expect(stages.map((s) => s.stage)).toEqual([
      'router',
      'hyde',
      'embedding',
      'rerank',
      'answer',
    ]);
    expect(stages[0]).toEqual({
      stage: 'router',
      model: 'router-model',
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(stages[2]).toEqual({
      stage: 'embedding',
      model: 'text-embedding-3-small',
      inputTokens: 8,
      outputTokens: 0,
    });
    expect(stages[4]).toEqual({
      stage: 'answer',
      model: 'answer-model',
      inputTokens: 40,
      outputTokens: 15,
    });
  });

  it('a hyde dokumentumot embeddeli (nem a nyers kérdést)', async () => {
    let embedded = '';
    await runCostEstimate(
      'kérdés',
      baseDeps({
        hyde: async () => ({ text: 'hipotetikus válasz' }),
        embedQueryWithUsage: async (text) => {
          embedded = text;
          return { embedding: [], totalTokens: 1, model: 'm' };
        },
      }),
    );
    expect(embedded).toBe('hipotetikus válasz');
  });

  it('usage nélküli stage-ekre 0/"unknown" alapértéket ad', async () => {
    const stages = await runCostEstimate(
      'kérdés',
      baseDeps({
        router: async () => ({ route: 'knowledge', reasoning: 'r' }),
        hyde: async () => ({ text: 'x' }),
        rerank: async (_q, chunks) => ({
          chunks: [...chunks],
          degraded: false,
        }),
      }),
    );
    expect(stages[0]).toEqual({
      stage: 'router',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(stages[1]).toEqual({
      stage: 'hyde',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(stages[3]).toEqual({
      stage: 'rerank',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test core -- cost-estimate.spec`
Expected: FAIL (a `./cost-estimate.js` modul nem létezik).

- [ ] **Step 3: Implementáld (`packages/core/src/lib/rag/cost-estimate.ts`)**

```ts
// Költség-becslő (SP5): a tudás-út (router → HyDE → embed → retrieve → rerank →
// answer) teljes futtatása egyetlen kérdésre, stage-enkénti token-usage gyűjtve.
// Újrahasznosítja a meglévő stage-eket (createRouter/createHyde/createRerank/
// createAnswer) — nem másolja a pipeline-logikát. A route mindig "knowledge": a
// becslő a scope szerint mindig a tudás-utat méri, függetlenül attól, hogy a
// kérdés valós forgalomban milyen route-ra menne.

import type { StageUsageDto } from '@plantbase/shared';
import { loadConfig, loadRagConfig, loadEmbeddingConfig } from '../config.js';
import { embedTextsWithUsage } from '../embedding.js';
import { searchChunks as defaultSearchChunks } from '../knowledge-store.js';
import type { SearchChunksFn } from './retrieval.js';
import { createRagModels } from './models.js';
import { createRouter, type Router } from './router.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRerank, type Rerank } from './rerank.js';
import { createAnswer, type Answer } from './answer.js';
import type { StageUsage } from './usage.js';

/** Alacsony szintű, usage-t és modell-azonosítót is visszaadó embedder. */
export type EmbedQueryWithUsageFn = (
  text: string,
) => Promise<{ embedding: number[]; totalTokens: number; model: string }>;

export interface CostEstimateDeps {
  readonly router: Router;
  readonly hyde: Hyde;
  readonly embedQueryWithUsage: EmbedQueryWithUsageFn;
  readonly searchChunks: SearchChunksFn;
  readonly rerank: Rerank;
  readonly answer: Answer;
  readonly topK: number;
}

const UNKNOWN_MODEL = 'unknown';

function zero(model: string = UNKNOWN_MODEL): StageUsage {
  return { model, inputTokens: 0, outputTokens: 0 };
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const _ of stream) {
    /* csak a usage Promise beteljesítéséhez fogyasztjuk a streamet */
  }
}

/** A tudás-út teljes futtatása egyetlen kérdésre, stage-enkénti usage-gyel. */
export async function runCostEstimate(
  query: string,
  deps: CostEstimateDeps,
): Promise<readonly StageUsageDto[]> {
  const stages: StageUsageDto[] = [];

  const routerResult = await deps.router(query);
  stages.push({ stage: 'router', ...(routerResult.usage ?? zero()) });

  const hydeResult = await deps.hyde(query);
  stages.push({ stage: 'hyde', ...(hydeResult.usage ?? zero()) });

  const {
    embedding,
    totalTokens,
    model: embeddingModel,
  } = await deps.embedQueryWithUsage(hydeResult.text);
  stages.push({
    stage: 'embedding',
    model: embeddingModel,
    inputTokens: totalTokens,
    outputTokens: 0,
  });

  const retrieved = await deps.searchChunks(embedding, deps.topK);
  const reranked = await deps.rerank(query, retrieved);
  stages.push({ stage: 'rerank', ...(reranked.usage ?? zero()) });

  const answered = deps.answer({ question: query, chunks: reranked.chunks });
  await drain(answered.textStream);
  const answerUsage = (await answered.usage) ?? zero();
  stages.push({ stage: 'answer', ...answerUsage });

  return stages;
}

/** A valós wiring: modelleket és primitíveket a configból építi (a chat-pipeline mintájára). */
export function createDefaultCostEstimateDeps(): CostEstimateDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    router: createRouter({
      model: models.router,
      modelId: ragConfig.routerModel,
    }),
    hyde: createHyde({ model: models.hyde, modelId: ragConfig.hydeModel }),
    embedQueryWithUsage: async (text) => {
      const embeddingConfig = loadEmbeddingConfig();
      const { embeddings, totalTokens } = await embedTextsWithUsage([text], {
        config: embeddingConfig,
      });
      return {
        embedding: embeddings[0],
        totalTokens,
        model: embeddingConfig.model,
      };
    },
    searchChunks: (embedding, k) => defaultSearchChunks(embedding, k),
    rerank: createRerank({
      model: models.rerank,
      topN: ragConfig.rerankTopN,
      modelId: ragConfig.rerankModel,
    }),
    answer: createAnswer({
      model: models.answer,
      modelId: ragConfig.answerModel,
    }),
    topK: ragConfig.topK,
  };
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test core -- cost-estimate.spec`
Expected: PASS (mind a 3 teszt).

- [ ] **Step 5: Exportáld a core index-ből**

`packages/core/src/index.ts` végére:

```ts
export * from './lib/rag/cost-estimate.js';
```

- [ ] **Step 6: Teljes core-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/rag/cost-estimate.ts packages/core/src/lib/rag/cost-estimate.spec.ts packages/core/src/index.ts
git commit -m "feat(core): runCostEstimate — full knowledge-path run with per-stage usage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Backend `POST /api/debug/cost`

**Files:**

- Modify: `apps/backend/src/lib/app.ts`
- Modify: `apps/backend/src/lib/app.spec.ts`
- Modify: `apps/backend/src/lib/deps.ts`

**Interfaces:**

- Consumes: `runCostEstimate`, `createDefaultCostEstimateDeps`, `loadModelPrices` (`@plantbase/core`), `costEstimateRequestSchema`, `type CostEstimate` (`@plantbase/shared`).
- Produces: `BackendDeps.costEstimate: (query: string) => Promise<CostEstimate>`; `POST /api/debug/cost` route.

- [ ] **Step 1: Írj bukó teszteket (`app.spec.ts` végére, új `describe` blokk)**

```ts
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
```

Ehhez a `makeDeps` alapértelmezett objektumába (a fájl elején) vedd fel a `costEstimate` mezőt is (különben a többi teszt típushibázik, mert a `BackendDeps` kötelezővé teszi):

```ts
    costEstimate: async () => {
      throw new Error('nem hívandó');
    },
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test backend -- app.spec`
Expected: FAIL (a `BackendDeps` nem ismeri a `costEstimate`-et / a route nem létezik).

- [ ] **Step 3: Implementáld (`app.ts`)**

Az importok közé:

```ts
import {
  chatRequestSchema,
  retrievalDebugRequestSchema,
  costEstimateRequestSchema,
  type ChatMessage,
  type OnTrace,
  type RetrievalDebugResult,
  type CostEstimate,
} from '@plantbase/shared';
```

`BackendDeps` bővítése:

```ts
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
  readonly debug: boolean;
}
```

Új route-regisztráló függvény (a `registerDebug` mellé, vagy annak végére):

```ts
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
```

A `createApp`-ban:

```ts
export function createApp(deps: BackendDeps): Express {
  const app = express();
  app.use(express.json());
  registerChat(app, deps);
  registerDebug(app, deps);
  registerCost(app, deps);
  registerHealth(app, deps);
  return app;
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test backend -- app.spec`
Expected: PASS (a régi + a 3 új teszt).

- [ ] **Step 5: Wire-eld a valós deps-et (`deps.ts`)**

```ts
import {
  runChat,
  createDefaultChatDeps,
  runRetrievalDebug,
  createDefaultRetrievalDebugDeps,
  runCostEstimate,
  createDefaultCostEstimateDeps,
  loadModelPrices,
  getChunkStats,
  loadRagConfig,
} from '@plantbase/core';
import type { BackendDeps, HealthReport } from './app.js';
```

A `createBackendDeps`-ben:

```ts
export function createBackendDeps(): BackendDeps {
  const ragConfig = loadRagConfig();
  return {
    chat: (messages, onTrace) =>
      runChat(messages, createDefaultChatDeps({ onTrace })),
    retrievalDebug: (query, opts) => {
      const overrides: { topK?: number; rerankTopN?: number } = {};
      if (opts.topK !== undefined) overrides.topK = opts.topK;
      if (opts.rerankTopN !== undefined) overrides.rerankTopN = opts.rerankTopN;
      return runRetrievalDebug(
        query,
        createDefaultRetrievalDebugDeps(overrides),
      );
    },
    costEstimate: async (query) => {
      const stages = await runCostEstimate(
        query,
        createDefaultCostEstimateDeps(),
      );
      return {
        query,
        route: 'knowledge',
        stages,
        defaultPrices: loadModelPrices(),
      };
    },
    chunkStats: () => getChunkStats(),
    health: computeHealth,
    debug: ragConfig.debug,
  };
}
```

- [ ] **Step 6: Teljes backend-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p backend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lib/app.ts apps/backend/src/lib/app.spec.ts apps/backend/src/lib/deps.ts
git commit -m "feat(backend): POST /api/debug/cost — non-streaming cost estimate endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Frontend — tab-shell (Chat | Költség-becslő)

**Files:**

- Create: `apps/frontend/src/app.tsx`
- Create: `apps/frontend/src/app.spec.tsx`
- Modify: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/components/cost-estimator-view.tsx` (üres/placeholder — a teljes implementáció Task 12-ben)

**Interfaces:**

- Consumes: `ChatView`, `Button` (SP4).
- Produces: `App` (nincs prop) — nézet-váltó Chat/Költség-becslő között, `useState`-tel (nincs router).

- [ ] **Step 1: Hozz létre egy minimális placeholder `CostEstimatorView`-t, hogy az `App` tesztje fusson**

```tsx
// apps/frontend/src/components/cost-estimator-view.tsx
/** Ideiglenes placeholder — a teljes implementáció Task 12-ben készül el. */
export function CostEstimatorView() {
  return <div>Költség-becslő</div>;
}
```

- [ ] **Step 2: Írj egy bukó tesztet (`apps/frontend/src/app.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('alapból a Chat nézetet mutatja', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/Kérdezz/i)).toBeInTheDocument();
  });

  it('a Költség-becslő gombra kattintva átvált a költség-becslő nézetre', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Költség-becslő/i }));
    expect(screen.getByText('Költség-becslő')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Kérdezz/i)).not.toBeInTheDocument();
  });

  it('vissza lehet váltani Chat nézetre', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Költség-becslő/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Chat$/i }));
    expect(screen.getByPlaceholderText(/Kérdezz/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Futtasd — bukjon**

Run: `pnpm nx test frontend -- app.spec`
Expected: FAIL (`./app` modul nem található).

- [ ] **Step 4: Implementáld (`apps/frontend/src/app.tsx`)**

```tsx
import { useState } from 'react';
import { ChatView } from './components/chat-view';
import { CostEstimatorView } from './components/cost-estimator-view';
import { Button } from './components/ui/button';

type Tab = 'chat' | 'cost';

/** Tab-shell: Chat | Költség-becslő — nincs router, csak nézet-váltó state. */
export function App() {
  const [tab, setTab] = useState<Tab>('chat');
  return (
    <div className="flex h-screen flex-col">
      <nav className="flex gap-2 border-b border-border p-2">
        <Button
          variant={tab === 'chat' ? 'default' : 'ghost'}
          onClick={() => setTab('chat')}
        >
          Chat
        </Button>
        <Button
          variant={tab === 'cost' ? 'default' : 'ghost'}
          onClick={() => setTab('cost')}
        >
          Költség-becslő
        </Button>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' ? <ChatView /> : <CostEstimatorView />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Kösd be a `main.tsx`-be**

```tsx
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import './styles.css';
import { App } from './app';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- app.spec`
Expected: PASS (mind a 3 teszt).

- [ ] **Step 7: Teljes frontend-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p frontend`
Expected: PASS (a `ChatView` tesztjei is zöldek maradnak — a `ChatView` maga nem változott).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/app.tsx apps/frontend/src/app.spec.tsx apps/frontend/src/main.tsx apps/frontend/src/components/cost-estimator-view.tsx
git commit -m "feat(frontend): tab-shell (Chat | Cost estimator placeholder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `CostEstimatorView` — teljes implementáció

**Files:**

- Modify: `apps/frontend/src/components/cost-estimator-view.tsx`
- Create: `apps/frontend/src/components/cost-estimator-view.spec.tsx`

**Interfaces:**

- Consumes: `computeStageCost`, `type CostEstimate`, `type ModelPrice`, `type StageUsageDto` (`@plantbase/shared`), `Button`/`Textarea` (SP4).
- Produces: `CostEstimatorView` (nincs prop) — input + „Becslés" gomb, táblázat, élő ár-szerkesztés.

- [ ] **Step 1: Írj bukó teszteket (`cost-estimator-view.spec.tsx`)**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CostEstimatorView } from './cost-estimator-view';
import type { CostEstimate } from '@plantbase/shared';

const estimate: CostEstimate = {
  query: 'Hogyan öntözzem a pozsgást?',
  route: 'knowledge',
  stages: [
    {
      stage: 'router',
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 0,
    },
    {
      stage: 'answer',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 1_000_000,
    },
  ],
  defaultPrices: {
    'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
    'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  },
};

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => estimate,
  })) as unknown as typeof fetch;
});

describe('CostEstimatorView', () => {
  it('Becslés gombra a /api/debug/cost-ot hívja és táblázatot renderel', async () => {
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'Hogyan öntözzem a pozsgást?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));

    await waitFor(() => expect(screen.getByText('router')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      '/api/debug/cost',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('answer')).toBeInTheDocument();
    // router: 1M input * $1/1M = $1.00
    expect(screen.getByText('1.000000 USD')).toBeInTheDocument();
  });

  it('az ár-mező szerkesztésére élőben újraszámol', async () => {
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'kérdés' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));
    await waitFor(() => expect(screen.getByText('router')).toBeInTheDocument());

    const inputPriceFields = screen.getAllByLabelText(/input \$\/1M/i);
    fireEvent.change(inputPriceFields[0], { target: { value: '2' } });

    // router: 1M input * $2/1M = $2.00 (a végösszeg is frissül: 2 + 15 = 17)
    await waitFor(() =>
      expect(screen.getByText('17.000000 USD')).toBeInTheDocument(),
    );
  });

  it('hibaüzenetet mutat, ha a hívás elbukik', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'OPENAI_API_KEY hiányzik vagy üres.' }),
    })) as unknown as typeof fetch;
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'kérdés' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/OPENAI_API_KEY/),
    );
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- cost-estimator-view`
Expected: FAIL (a placeholder-komponens nincs bekötve a fenti markupra).

- [ ] **Step 3: Implementáld (`cost-estimator-view.tsx` teljes tartalma)**

```tsx
import { useMemo, useState } from 'react';
import {
  computeStageCost,
  type CostEstimate,
  type ModelPrice,
  type StageUsageDto,
} from '@plantbase/shared';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

function formatUsd(value: number): string {
  return `${value.toFixed(6)} USD`;
}

interface PriceFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number) => void;
}

function PriceField({ label, value, onChange }: PriceFieldProps) {
  return (
    <label className="flex flex-col text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        step="0.01"
        aria-label={label}
        className="w-20 rounded border border-input bg-background px-1 py-0.5 text-foreground"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** A „Költség-becslő" fül: kérdésre lefuttatja a tudás-utat, stage-enkénti
 *  token/USD-bontást ad, szerkeszthető árakkal (élő, LLM-hívás nélküli what-if). */
export function CostEstimatorView() {
  const [query, setQuery] = useState('');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [prices, setPrices] = useState<Record<string, ModelPrice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEstimate() {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/debug/cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Hiba történt a becslés közben.');
      }
      const result = body as CostEstimate;
      setEstimate(result);
      setPrices(result.defaultPrices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  }

  function updatePrice(
    model: string,
    field: keyof ModelPrice,
    value: number,
  ): void {
    setPrices((prev) => ({
      ...prev,
      [model]: {
        inputPerM: prev[model]?.inputPerM ?? 0,
        outputPerM: prev[model]?.outputPerM ?? 0,
        [field]: value,
      },
    }));
  }

  const total = useMemo(() => {
    if (!estimate) return 0;
    return estimate.stages.reduce(
      (sum, s) => sum + computeStageCost(s, prices[s.model]).totalUsd,
      0,
    );
  }, [estimate, prices]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold">Költség-becslő</h1>
      <p className="text-sm text-muted-foreground">
        A kérdésre lefuttatja a tudás-út teljes pipeline-ját (valódi
        LLM/embedding-hívásokkal), és stage-enkénti token- és USD-bontást ad.
      </p>

      <div className="flex gap-2">
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kérdezz a növényekről…"
          disabled={loading}
          rows={2}
        />
        <Button
          onClick={handleEstimate}
          disabled={loading || query.trim() === ''}
        >
          {loading ? 'Becslés…' : 'Becslés'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {estimate && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1 pr-2">Stage</th>
                <th className="py-1 pr-2">Modell</th>
                <th className="py-1 pr-2">Input token</th>
                <th className="py-1 pr-2">Output token</th>
                <th className="py-1 pr-2">Ár</th>
                <th className="py-1">Költség</th>
              </tr>
            </thead>
            <tbody>
              {estimate.stages.map((s: StageUsageDto) => {
                const price = prices[s.model];
                const cost = computeStageCost(s, price);
                return (
                  <tr
                    key={s.stage}
                    className="border-b border-border align-top"
                  >
                    <td className="py-1 pr-2">{s.stage}</td>
                    <td className="py-1 pr-2">{s.model}</td>
                    <td className="py-1 pr-2">{s.inputTokens}</td>
                    <td className="py-1 pr-2">{s.outputTokens}</td>
                    <td className="py-1 pr-2">
                      <div className="flex gap-1">
                        <PriceField
                          label="input $/1M"
                          value={price?.inputPerM}
                          onChange={(v) => updatePrice(s.model, 'inputPerM', v)}
                        />
                        <PriceField
                          label="output $/1M"
                          value={price?.outputPerM}
                          onChange={(v) =>
                            updatePrice(s.model, 'outputPerM', v)
                          }
                        />
                      </div>
                    </td>
                    <td className="py-1">
                      {price ? formatUsd(cost.totalUsd) : 'nincs ár'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-2 text-right font-medium">
                  Végösszeg:
                </td>
                <td className="pt-2 font-medium">{formatUsd(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- cost-estimator-view`
Expected: PASS (mind a 3 teszt).

- [ ] **Step 5: Futtasd az `app.spec.tsx`-t is (a placeholder-szöveg már nem "Költség-becslő" bare div, hanem a valós markup — ellenőrizd, hogy a Task 11 asserciói még mindig igazak)**

Run: `pnpm nx test frontend -- app.spec`
Expected: PASS. (Az `App`-teszt a `getByText('Költség-becslő')`-t a `<h1>`-re illeszti — mivel a fejléc szövege is „Költség-becslő", ez továbbra is megtalálja; ha véletlenül több egyező szöveg lenne, cseréld `getByRole('heading', {name: /Költség-becslő/})`-ra.)

- [ ] **Step 6: Teljes frontend-verifikáció**

Run: `pnpm nx run-many -t test typecheck build -p frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/cost-estimator-view.tsx apps/frontend/src/components/cost-estimator-view.spec.tsx
git commit -m "feat(frontend): CostEstimatorView — stage table with live editable pricing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Live e2e verifikáció + dokumentáció

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/rag/roadmap.md`

**Interfaces:**

- Consumes: a teljes SP5 stack.
- Produces: dokumentált parancsok + zöld teljes workspace.

- [ ] **Step 1: Teljes workspace-verifikáció**

Run: `pnpm nx run-many -t test typecheck build`
Expected: minden projekt PASS (core, shared, backend, frontend, cli, db, rag-builder).

- [ ] **Step 2: Live e2e — a becslő valódi LLM/embedding-hívásokkal**

Indítsd a stacket:

```bash
DEBUG=true pnpm nx serve backend
pnpm nx serve frontend
```

Nyisd meg `http://localhost:4200`-t, kattints a „Költség-becslő" fülre, és futtass egy reprezentatív kérdést (pl. „Hogyan gondozzam a pozsgásokat?"). Ellenőrizd (a superpowers:verification-before-completion szellemében — evidence, ne feltételezés):

- A táblázat 5 sort mutat: `router`, `hyde`, `embedding`, `rerank`, `answer` — mindegyiknél nem-nulla input és/vagy output token.
- A `defaultPrices`-ból seedelt ár-mezők nem üresek (`claude-haiku-4-5`, `claude-sonnet-4-6`, `text-embedding-3-small`).
- Egy ár-mező módosítására a végösszeg **azonnal** (hálózati hívás nélkül) újraszámol.
- A Chat fül továbbra is működik (streamel, forrásokat mutat, a DEBUG trace-panelben most `usage`-sorok is megjelennek router/hyde/rerank/answer stage-eknél).

Jegyezd fel a tényleges megfigyelést. Ha bármi hiányzik: állj meg és debuggolj (systematic-debugging), ne jelentsd késznek.

- [ ] **Step 3: Frissítsd a `CLAUDE.md`-t**

A „Gyakori parancsok" szekció végére (a frontend blokk után):

```bash
# Költség-becslő (SP5: stage-enkénti USD-bontás a tudás-útra; a frontend "Költség-becslő"
# fülén, vagy közvetlenül): valódi LLM/embedding-hívásokat futtat, pénzbe kerül.
# POST /api/debug/cost { "query": "..." } → { stages: [...], defaultPrices: {...} }
```

- [ ] **Step 4: Frissítsd a `docs/rag/roadmap.md`-t**

Az SP5-szekciót (vagy ha nincs még, vedd fel) állítsd `✅ KÉSZ`-re, rövid összefoglalóval: usage-átadás router/hyde/rerank/answer stage-eknél, `runCostEstimate` + `/api/debug/cost`, frontend tab-shell + `CostEstimatorView` élő ár-szerkesztéssel, live e2e zöld.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/rag/roadmap.md
git commit -m "docs(sp5): cost estimator commands + roadmap status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Teljes workspace-verifikáció (a main zöld marad)**

Run: `pnpm nx run-many -t test typecheck build`
Expected: minden projekt PASS.

---

## Self-Review (a terv írója végezte)

**Spec-lefedettség:**

1. Core — usage-átadás (router/hyde/embedding/rerank/answer) → Task 2-5. ✅ (Az embedding usage nem a chat-pipeline `Retrieve`-jén megy át — lásd alább, tudatos scope-vágás.)
2. Core — usage trace-emisszió → Task 6 (`runChat` stage-enként emittál, ha van usage). ✅ Mellékhaszon: DEBUG trace-panel usage-sorai (a `describeTrace` már kezeli a `usage` variánst, SP4-ből). ✅
3. Core — `runCostEstimate(query, deps)` → Task 9. ✅
4. Core — ár-modul → Task 7 (`loadModelPrices`, env-felülírással, `OPENAI_EMBEDDING_PRICE_PER_M`-mintára). ✅
5. Shared — DTO-k + `computeStageCost` → Task 8. ✅
6. Backend — `POST /api/debug/cost` → Task 10. ✅
7. Frontend — „Költség-becslő" fül (tab-shell + táblázat + élő ár-szerkesztés) → Task 11-12. ✅

**Tudatos scope-vágás (dokumentálva, nem hiányzó lefedettség):** a spec „mellékhaszonként" említi, hogy a chat DEBUG trace-panel is mutassa az összes stage usage-ét, beleértve az embeddinget is. A tervben az embedding-usage kizárólag a dedikált költség-becslőben (Task 9, `runCostEstimate` saját `embedQueryWithUsage` hívásán át) jelenik meg — a chat-pipeline `Retrieve`-jének visszatérési típusát (nyers `SearchResult[]` tömb) szándékosan NEM bővítjük usage-gyel, mert ehhez a típust objektummá kellene alakítani (`{chunks, usage?}`), ami a `pipeline.ts` és `retrieval.spec.ts` minden hívási pontját érintené egy olyan mellékhaszonért, ami nem a fő cél (a fő cél, a dedikált becslő, teljes egészében lefedett). Ez YAGNI-releváns, indokolt vágás.

**Placeholder-scan:** nincs TBD/TODO; minden lépés valós, futtatható kódot/parancsot tartalmaz. A Task 11 Step 1 tudatosan placeholder-komponenst hoz létre (`CostEstimatorView` ideiglenes törzse), de ezt a terv explicit megnevezi, és a Task 12 azonnal lecseréli — nem elfelejtett/hiányos lépés.

**Típus-konzisztencia:**

- `StageUsage` (Task 1: `{model, inputTokens, outputTokens}`) végig egységesen `usage?: StageUsage`-ként jelenik meg `RouterResult`/`RerankOutcome`-on, és `usage?: Promise<StageUsage>`-ként `AnswerResult`-on (Task 2-4).
- `Hyde`'s visszatérése (`HydeResult = {text, usage?}`, Task 5) minden hívási ponton (`pipeline.ts`, `retrieval-debug.ts`, mindkét spec) konzisztensen `.text`-tel van dereferálva.
- `StageUsageDto` (shared, Task 8: `{stage, model, inputTokens, outputTokens}`) — a `stage`-et a `runCostEstimate` (Task 9) és a `pipeline.ts` usage trace-emissziója (Task 6) egyaránt string-literálként adja hozzá (`'router'`/`'hyde'`/`'embedding'`/`'rerank'`/`'answer'`), egyezik a `describeTrace` (SP4, meglévő) által várt `usage.stage` mezővel.
- `ModelPrice` (Task 7 core + Task 8 shared) mindkét helyen `{inputPerM, outputPerM}` — a core `loadModelPrices` visszatérése közvetlenül a shared `Record<string, ModelPrice>`-nak felel meg (a backend `deps.ts` egyszerűen áthelyezi).
- `CostEstimateDeps` (Task 9) mezői (`router`/`hyde`/`rerank`/`answer`) pontosan a Task 2-5-ben módosított `Router`/`Hyde`/`Rerank`/`Answer` típusokat használják — nincs duplikált stage-logika.
- A frontend `CostEstimatorView` (Task 12) kizárólag `@plantbase/shared`-ből importál (`computeStageCost`, `CostEstimate`, `ModelPrice`, `StageUsageDto`) — nincs `@plantbase/core` függés, megfelel a Global Constraints-nek.
