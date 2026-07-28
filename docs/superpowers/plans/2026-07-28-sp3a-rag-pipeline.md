# SP3a — RAG-pipeline a `core`-ban (motor), CLI-vel meghajtva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kézzel írt Anthropic tool-loopot (`ask-agent.ts`) leváltó, Vercel AI SDK-alapú, hibrid multi-agent RAG-pipeline a `core`-ban, amely a `seed/knowledge` tudásbázis (RAG) és a `products` katalógus (SQL) felett válaszol streaming módon, és a CLI-n végponttól végpontig kipróbálható — Express nélkül.

**Architecture:** Felül egy LLM-router (Haiku) dönti el az útvonalat (`knowledge` / `catalog` / `both`). A knowledge-út **determinisztikus kód-pipeline** (HyDE → embed → search → rerank → guardrail → answer), így a PRD kemény garanciái betarthatók és triviálisan tesztelhetők. A katalógus-út a meglévő read-only `runSql`/`listCategories` toolokra épül, AI SDK `tool()`-ra migrálva, `streamText` + `stopWhen: stepCountIs(maxIterations)` loopban. A stage-ek egy injektált `onTrace(event)` callbackre emittálnak; csak az answer-stage streamel tokent.

**Tech Stack:** TypeScript (strict, ESM, `nodenext`), Nx + pnpm monorepo, Vercel AI SDK (`ai@7.0.37`), `@ai-sdk/anthropic@^4.0.23` (Haiku/Sonnet), `@ai-sdk/openai@4.0.20` (embedding, meglévő), `zod@4`, `pg` (read-only vektorkeresés), Vitest (DI-fake-ekkel, hálózat/DB nélkül), commander + `node:readline`.

## Global Constraints

Minden task implicit követelménye:

- **TypeScript strict; sose `any`.** Külső/nem megbízható input (env, LLM-kimenet, tool input) validálása **zod**-dal a határon.
- **`kebab-case` fájlnevek; `interface` objektumokhoz; string-literál unió enum helyett; immutabilitás** (`readonly`).
- **Product-kódban nincs `console.log`** (a CLI stdout a termék felülete — ott szándékos).
- **Git commit + PR angolul** (Conventional Commits); a `main` zöld marad; feature branch: `feat/sp3a-rag-pipeline` (már ezen vagyunk).
- **Kis, önálló commitok:** egy task = egy fókuszált commit.
- **Read-only SQL invariáns változatlan:** a katalógus-út `runSql`-je a `DATABASE_URL_READONLY` kapcsolaton fut, `pg`-vel (nem Prisma), és az `assertSelectOnly` kód-guard megmarad (kettős védelem, NFR1).
- **Embedding kizárólag OpenAI `text-embedding-3-small` (1536 dim)** a meglévő `embedding.ts`-en át; az `OPENAI_API_KEY` csak az embedding-utat igényli.
- **Tesztek:** Vitest, DI-fake-ekkel, hálózat/DB nélkül (minta: `packages/core/src/lib/ask-agent.spec.ts`). Globals (`describe`/`it`/`expect`) be vannak kapcsolva.
- **Parancsok mindig nx-en át:** `pnpm nx test @plantbase/<proj>`, `pnpm nx run-many -t test typecheck build`.
- **DI-minta:** a hálózati/DB-primitíveket függvényként injektáljuk (mint `embedding.ts` az `embedMany`-t, `ask-agent.ts` a `client`/`runSql`-t). A default a valós implementáció, teszthez fake megy be.

**Modell-ID-k (repo-konvenció, env-felülírható):** Haiku = `claude-haiku-4-5` (router/HyDE/rerank), Sonnet = `claude-sonnet-4-6` (answer + katalógus-agent).

**Cross-task típus-forrás:** a trace-esemény és chat DTO típusok a `@plantbase/shared`-ben élnek (Task 1). A `core` emittál/produkál, a CLI fogyaszt.

---

## Fájlstruktúra (mit hoz létre / módosít a terv)

**Új package — `packages/shared`** (tiszta típus/kontraktus, csak zod runtime-függőség):

- `packages/shared/package.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `vitest.config.mts`
- `packages/shared/src/index.ts` — barrel export
- `packages/shared/src/lib/engine-trace.ts` — `TraceEvent` union + payloadok + zod sémák + `ChatRoute`
- `packages/shared/src/lib/chat.ts` — `ChatMessage`, `ChatRequest`, `SourceRef`, `RagAnswer` + zod sémák
- `packages/shared/src/lib/engine-trace.spec.ts`, `packages/shared/src/lib/chat.spec.ts`

**`packages/core` bővül — `src/lib/rag/`** (egy modul = egy felelősség, DI):

- `models.ts` — Anthropic model-registry (`createRagModels`)
- `router.ts` — LLM-router (Haiku, `generateObject`)
- `hyde.ts` — HyDE hipotetikus válasz (Haiku, `generateText`)
- `retrieval.ts` — kód: `embedQuery` → `searchChunks`
- `rerank.ts` — Haiku újrarendezés/szűrés (`generateObject`), hibára degradál
- `guardrail.ts` — kód küszöb-guard
- `answer.ts` — Sonnet grounded válasz (`streamText`), forráshivatkozásokkal
- `tools.ts` — `catalogSql` + `listCategories` AI SDK `tool()`-ként
- `catalog-agent.ts` — katalógus-út (`streamText` + tools + `stopWhen`)
- `pipeline.ts` — orchestrátor (`runChat`), az SP3a fő belépője; default-wiring (`createDefaultChatDeps`)
- `+.spec.ts` minden modulhoz
- `src/lib/knowledge-store.ts` — `SEARCH_SQL` + `SearchResult` bővül `source_path`-tal (Task 3)
- `src/lib/config.ts` — `RagConfig` bővül (modell-nevek, topK, rerankTopN, groundingThreshold)
- `src/index.ts` — új `rag/*` és `@plantbase/shared` re-export; `ask-agent`/`agent-tools` export törlése
- **Törlődik:** `src/lib/ask-agent.ts`, `src/lib/ask-agent.spec.ts`, `src/lib/agent-tools.ts`, `src/lib/agent-tools.spec.ts` (Task 12)
- `package.json` — `@ai-sdk/anthropic` + `@plantbase/shared` dependency (Task 2)

**`apps/cli` bővül:**

- `src/main.ts` — `runChat`-re migrálva (streaming, DEBUG trace, `--show-prompt`)
- `package.json` — `@plantbase/shared` dependency
- `src/lib/trace-format.ts` (+ spec) — DEBUG engine-trace formázás a terminálra

**Dokumentáció (Task 13):** `.env.example`, `CLAUDE.md`, `docs/rag/roadmap.md`.

---

### Task 1: `packages/shared` package — trace + chat kontraktusok

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`, `packages/shared/tsconfig.lib.json`, `packages/shared/tsconfig.spec.json`
- Create: `packages/shared/vitest.config.mts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/lib/engine-trace.ts`
- Create: `packages/shared/src/lib/chat.ts`
- Test: `packages/shared/src/lib/engine-trace.spec.ts`, `packages/shared/src/lib/chat.spec.ts`

**Interfaces:**

- Produces (a többi task ezekre épül):
  - `ChatRoute = 'knowledge' | 'catalog' | 'both'`
  - `TraceEvent` union (lásd lentebb) + `traceEventSchema` (zod) + `OnTrace = (event: TraceEvent) => void`
  - `SourceRef { title: string; sourceUrl: string | null; sourcePath: string; headingPath: string | null }` + `sourceRefSchema`
  - `ChatMessage`, `ChatRequest`, `RagAnswer { text: string; route: ChatRoute; sources: SourceRef[] }` + zod sémák

- [ ] **Step 1: Package + tsconfig scaffold (a `core` mintájára)**

`packages/shared/package.json`:

```json
{
  "name": "@plantbase/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@plantbase/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "tslib": "^2.3.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "~4.1.9",
    "vitest": "~4.1.9"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

`packages/shared/tsconfig.lib.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "emitDeclarationOnly": false,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "references": [],
  "exclude": [
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts"
  ]
}
```

`packages/shared/tsconfig.spec.json`:

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
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ],
  "references": [{ "path": "./tsconfig.lib.json" }]
}
```

`packages/shared/vitest.config.mts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/shared',
  test: {
    name: '@plantbase/shared',
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

- [ ] **Step 2: `pnpm install` (workspace bekötés) és Nx felismerés**

Run: `pnpm install`
Expected: sikeres install; `@plantbase/shared` felkerül a workspace-re.

Run: `pnpm nx show projects`
Expected: a listában megjelenik `@plantbase/shared`.

- [ ] **Step 3: Failing test — `engine-trace.ts` zod round-trip**

`packages/shared/src/lib/engine-trace.spec.ts`:

```typescript
import { traceEventSchema, type TraceEvent } from './engine-trace.js';

describe('traceEventSchema', () => {
  it('parses a router event', () => {
    const event: TraceEvent = {
      type: 'router',
      route: 'both',
      reasoning: 'A kérdés tudásra és katalógusra is vonatkozik.',
    };
    expect(traceEventSchema.parse(event)).toEqual(event);
  });

  it('parses a guardrail event', () => {
    const event: TraceEvent = {
      type: 'guardrail',
      grounded: false,
      maxSimilarity: 0.21,
      threshold: 0.35,
    };
    expect(traceEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown route', () => {
    const bad = { type: 'router', route: 'nope', reasoning: 'x' };
    expect(traceEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const bad = { type: 'telepathy' };
    expect(traceEventSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run test — verify it fails**

Run: `pnpm nx test @plantbase/shared`
Expected: FAIL — `Cannot find module './engine-trace.js'`.

- [ ] **Step 5: Implement `engine-trace.ts`**

`packages/shared/src/lib/engine-trace.ts`:

```typescript
// Az engine-trace kontraktus (SP3a): a RAG-pipeline stage-ei erre a diszkriminált
// unióra emittálnak egy injektált onTrace(event) callbacken át. A core emittál,
// a CLI (DEBUG=true) formázva kiírja; SP3b ugyanezt data-streamként küldi a frontendnek.
// A boundary-validációhoz zod séma is tartozik (nem megbízható forrásból érkező
// trace ellenőrzéséhez, pl. SP3b HTTP-határon).

import { z } from 'zod';

/** A router által választható útvonalak. */
export type ChatRoute = 'knowledge' | 'catalog' | 'both';

export const chatRouteSchema = z.enum(['knowledge', 'catalog', 'both']);

export const traceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('router'),
    route: chatRouteSchema,
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal('hyde'),
    hydeDoc: z.string(),
  }),
  z.object({
    type: z.literal('retrieval'),
    topK: z.number().int().nonnegative(),
    resultCount: z.number().int().nonnegative(),
    maxSimilarity: z.number(),
  }),
  z.object({
    type: z.literal('rerank'),
    inputCount: z.number().int().nonnegative(),
    outputCount: z.number().int().nonnegative(),
    degraded: z.boolean(),
  }),
  z.object({
    type: z.literal('guardrail'),
    grounded: z.boolean(),
    maxSimilarity: z.number(),
    threshold: z.number(),
  }),
  z.object({
    type: z.literal('answer-start'),
  }),
  z.object({
    type: z.literal('answer-delta'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('usage'),
    stage: z.string(),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    stage: z.string(),
    message: z.string(),
  }),
]);

/** A trace-esemény diszkriminált unió (a zod sémából levezetve). */
export type TraceEvent = z.infer<typeof traceEventSchema>;

/** A pipeline stage-ek trace-callbackje (injektálható; alapból no-op). */
export type OnTrace = (event: TraceEvent) => void;

/** No-op trace (ha nincs megfigyelő). */
export const noopTrace: OnTrace = () => {
  /* no-op */
};
```

- [ ] **Step 6: Run test — verify it passes**

Run: `pnpm nx test @plantbase/shared`
Expected: PASS (engine-trace tesztek).

- [ ] **Step 7: Failing test — `chat.ts` zod round-trip**

`packages/shared/src/lib/chat.spec.ts`:

```typescript
import {
  ragAnswerSchema,
  sourceRefSchema,
  type RagAnswer,
  type SourceRef,
} from './chat.js';

describe('chat DTOs', () => {
  it('parses a SourceRef with a null url', () => {
    const source: SourceRef = {
      title: 'Pozsgások gondozása',
      sourceUrl: null,
      sourcePath: 'seed/knowledge/pozsgas.md',
      headingPath: 'Öntözés',
    };
    expect(sourceRefSchema.parse(source)).toEqual(source);
  });

  it('parses a RagAnswer with sources', () => {
    const answer: RagAnswer = {
      text: 'A pozsgásokat ritkán kell öntözni.',
      route: 'knowledge',
      sources: [
        {
          title: 'Pozsgások gondozása',
          sourceUrl: 'https://example.hu/pozsgas',
          sourcePath: 'seed/knowledge/pozsgas.md',
          headingPath: null,
        },
      ],
    };
    expect(ragAnswerSchema.parse(answer)).toEqual(answer);
  });

  it('rejects a RagAnswer with an invalid route', () => {
    const bad = { text: 'x', route: 'weather', sources: [] };
    expect(ragAnswerSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 8: Run test — verify it fails**

Run: `pnpm nx test @plantbase/shared`
Expected: FAIL — `Cannot find module './chat.js'`.

- [ ] **Step 9: Implement `chat.ts`**

`packages/shared/src/lib/chat.ts`:

```typescript
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
```

- [ ] **Step 10: Implement `src/index.ts` (barrel export)**

`packages/shared/src/index.ts`:

```typescript
export * from './lib/engine-trace.js';
export * from './lib/chat.js';
```

- [ ] **Step 11: Run tests + typecheck — verify all pass**

Run: `pnpm nx run-many -t test typecheck build --projects=@plantbase/shared`
Expected: PASS (mindkét spec, typecheck, build).

- [ ] **Step 12: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): engine-trace + chat DTO contracts package"
```

---

### Task 2: `core` — dependenciák + `RagConfig` bővítés + model-registry

**Files:**

- Modify: `packages/core/package.json` (deps: `@ai-sdk/anthropic`, `@plantbase/shared`)
- Modify: `packages/core/src/lib/config.ts` (`RagConfig` bővítés)
- Modify: `packages/core/src/lib/config.spec.ts` (új env-mezők tesztje)
- Create: `packages/core/src/lib/rag/models.ts`
- Test: `packages/core/src/lib/rag/models.spec.ts`

**Interfaces:**

- Consumes: `RagConfig` (config.ts), `AgentConfig.apiKey` (config.ts).
- Produces:
  - `RagConfig` bővül: `routerModel`, `hydeModel`, `rerankModel`, `answerModel: string`; `topK`, `rerankTopN: number`; `groundingThreshold: number`.
  - `RagModels { router; hyde; rerank; answer; catalog: LanguageModel }` (a `LanguageModel` az `ai`-ból).
  - `createRagModels(config: RagConfig, apiKey: string): RagModels`.

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm --filter @plantbase/core add @ai-sdk/anthropic@^4.0.23
pnpm --filter @plantbase/core add @plantbase/shared@workspace:*
```

Expected: `packages/core/package.json` `dependencies`-ébe bekerül `@ai-sdk/anthropic` és `@plantbase/shared: workspace:*`.

- [ ] **Step 2: Failing test — `RagConfig` új mezők**

`packages/core/src/lib/config.spec.ts`-hez add hozzá (a fájl végére, a meglévő importok mellé `loadRagConfig` importtal):

```typescript
describe('loadRagConfig (SP3a extensions)', () => {
  const KEYS = [
    'RAG_ROUTER_MODEL',
    'RAG_HYDE_MODEL',
    'RAG_RERANK_MODEL',
    'RAG_ANSWER_MODEL',
    'RAG_TOP_K',
    'RAG_RERANK_TOP_N',
    'RAG_GROUNDING_THRESHOLD',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('applies documented defaults when unset', () => {
    const cfg = loadRagConfig('/nonexistent-dir-for-test');
    expect(cfg.routerModel).toBe('claude-haiku-4-5');
    expect(cfg.hydeModel).toBe('claude-haiku-4-5');
    expect(cfg.rerankModel).toBe('claude-haiku-4-5');
    expect(cfg.answerModel).toBe('claude-sonnet-4-6');
    expect(cfg.topK).toBe(12);
    expect(cfg.rerankTopN).toBe(5);
    expect(cfg.groundingThreshold).toBeCloseTo(0.35);
  });

  it('reads overrides from env', () => {
    process.env.RAG_TOP_K = '20';
    process.env.RAG_GROUNDING_THRESHOLD = '0.4';
    process.env.RAG_ANSWER_MODEL = 'claude-sonnet-5';
    const cfg = loadRagConfig('/nonexistent-dir-for-test');
    expect(cfg.topK).toBe(20);
    expect(cfg.groundingThreshold).toBeCloseTo(0.4);
    expect(cfg.answerModel).toBe('claude-sonnet-5');
  });

  it('rejects a negative grounding threshold', () => {
    process.env.RAG_GROUNDING_THRESHOLD = '-0.1';
    expect(() => loadRagConfig('/nonexistent-dir-for-test')).toThrow(
      /RAG-konfiguráció/,
    );
  });
});
```

> Megjegyzés: a `loadRagConfig` első argumentuma a `cwd` a find-up .env-hez; nem létező könyvtárral a .env betöltés no-op, így csak a `process.env`-ből olvas — determinisztikus teszt.

- [ ] **Step 3: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- config`
Expected: FAIL — `cfg.routerModel` stb. `undefined`.

- [ ] **Step 4: Extend `RagConfig` in `config.ts`**

A `config.ts`-ben cseréld le a `RagConfig` interfészt, a `ragEnvSchema`-t és a `loadRagConfig` return-jét:

```typescript
/** A RAG-pipeline futásidejű konfigurációja (SP3a). */
export interface RagConfig {
  readonly maxAgentIterations: number;
  readonly debug: boolean;
  /** Router / HyDE / rerank modell (olcsó, alapból Haiku). */
  readonly routerModel: string;
  readonly hydeModel: string;
  readonly rerankModel: string;
  /** Answer + katalógus-agent modell (alapból Sonnet). */
  readonly answerModel: string;
  /** A vektorkeresés által visszaadott chunkok száma. */
  readonly topK: number;
  /** A rerank után megtartott chunkok száma. */
  readonly rerankTopN: number;
  /** Grounding-küszöb: e cosine-similarity alatt "nincs találat". */
  readonly groundingThreshold: number;
}

const DEFAULT_MAX_AGENT_ITERATIONS = 6;
const DEFAULT_CHEAP_MODEL = 'claude-haiku-4-5';
const DEFAULT_ANSWER_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TOP_K = 12;
const DEFAULT_RERANK_TOP_N = 5;
const DEFAULT_GROUNDING_THRESHOLD = 0.35;

const ragEnvSchema = z.object({
  MAX_AGENT_ITERATIONS: z.coerce
    .number()
    .int()
    .positive('MAX_AGENT_ITERATIONS pozitív egész kell legyen.')
    .optional(),
  DEBUG: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  RAG_ROUTER_MODEL: z.string().min(1).optional(),
  RAG_HYDE_MODEL: z.string().min(1).optional(),
  RAG_RERANK_MODEL: z.string().min(1).optional(),
  RAG_ANSWER_MODEL: z.string().min(1).optional(),
  RAG_TOP_K: z.coerce
    .number()
    .int()
    .positive('RAG_TOP_K pozitív egész kell legyen.')
    .optional(),
  RAG_RERANK_TOP_N: z.coerce
    .number()
    .int()
    .positive('RAG_RERANK_TOP_N pozitív egész kell legyen.')
    .optional(),
  RAG_GROUNDING_THRESHOLD: z.coerce
    .number()
    .min(0, 'RAG_GROUNDING_THRESHOLD nem lehet negatív.')
    .max(1, 'RAG_GROUNDING_THRESHOLD legfeljebb 1 lehet.')
    .optional(),
});
```

És a `loadRagConfig` return-je (a `result.success` ág után):

```typescript
return {
  maxAgentIterations:
    result.data.MAX_AGENT_ITERATIONS ?? DEFAULT_MAX_AGENT_ITERATIONS,
  debug: result.data.DEBUG ?? false,
  routerModel: result.data.RAG_ROUTER_MODEL ?? DEFAULT_CHEAP_MODEL,
  hydeModel: result.data.RAG_HYDE_MODEL ?? DEFAULT_CHEAP_MODEL,
  rerankModel: result.data.RAG_RERANK_MODEL ?? DEFAULT_CHEAP_MODEL,
  answerModel: result.data.RAG_ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL,
  topK: result.data.RAG_TOP_K ?? DEFAULT_TOP_K,
  rerankTopN: result.data.RAG_RERANK_TOP_N ?? DEFAULT_RERANK_TOP_N,
  groundingThreshold:
    result.data.RAG_GROUNDING_THRESHOLD ?? DEFAULT_GROUNDING_THRESHOLD,
};
```

- [ ] **Step 5: Run test — verify config passes**

Run: `pnpm nx test @plantbase/core -- config`
Expected: PASS.

- [ ] **Step 6: Failing test — `createRagModels`**

`packages/core/src/lib/rag/models.spec.ts`:

```typescript
import { createRagModels } from './models.js';
import type { RagConfig } from '../config.js';

const config: RagConfig = {
  maxAgentIterations: 6,
  debug: false,
  routerModel: 'claude-haiku-4-5',
  hydeModel: 'claude-haiku-4-5',
  rerankModel: 'claude-haiku-4-5',
  answerModel: 'claude-sonnet-4-6',
  topK: 12,
  rerankTopN: 5,
  groundingThreshold: 0.35,
};

describe('createRagModels', () => {
  it('builds a language model per role with the configured model ids', () => {
    const models = createRagModels(config, 'sk-ant-test');
    expect(models.router.modelId).toBe('claude-haiku-4-5');
    expect(models.hyde.modelId).toBe('claude-haiku-4-5');
    expect(models.rerank.modelId).toBe('claude-haiku-4-5');
    expect(models.answer.modelId).toBe('claude-sonnet-4-6');
    // A katalógus-agent a Sonnet answer-modellt használja (design 4. pont).
    expect(models.catalog.modelId).toBe('claude-sonnet-4-6');
  });
});
```

> `LanguageModel` (a `provider(modelId)` visszatérése) rendelkezik `.modelId` mezővel — így kulcs nélkül, hálózat nélkül ellenőrizhető a helyes bekötés.

- [ ] **Step 7: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- models`
Expected: FAIL — `Cannot find module './models.js'`.

- [ ] **Step 8: Implement `rag/models.ts`**

`packages/core/src/lib/rag/models.ts`:

```typescript
// Model-registry a RAG-pipeline-hoz (SP3a). Az Anthropic modelleket a Vercel AI
// SDK `@ai-sdk/anthropic` providerén át hozzuk létre, szerepenként (router/hyde/
// rerank = olcsó Haiku; answer + katalógus = Sonnet). A modellneveket a config
// adja (env-felülírható), az apiKey az ANTHROPIC_API_KEY (AgentConfig).
// Az embedding NEM itt van: azt a meglévő embedding.ts (OpenAI) kezeli.

import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { RagConfig } from '../config.js';

/** A pipeline szerepenkénti nyelvi modelljei. */
export interface RagModels {
  readonly router: LanguageModel;
  readonly hyde: LanguageModel;
  readonly rerank: LanguageModel;
  readonly answer: LanguageModel;
  readonly catalog: LanguageModel;
}

/** Létrehozza a szerep-modelleket a configból és az Anthropic apiKey-ből. */
export function createRagModels(config: RagConfig, apiKey: string): RagModels {
  const anthropic = createAnthropic({ apiKey });
  return {
    router: anthropic(config.routerModel),
    hyde: anthropic(config.hydeModel),
    rerank: anthropic(config.rerankModel),
    answer: anthropic(config.answerModel),
    catalog: anthropic(config.answerModel),
  };
}
```

- [ ] **Step 9: Run test + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- models` majd `pnpm nx typecheck @plantbase/core`
Expected: PASS mindkettő.

- [ ] **Step 10: Commit**

```bash
git add packages/core/package.json packages/core/src/lib/config.ts packages/core/src/lib/config.spec.ts packages/core/src/lib/rag/ pnpm-lock.yaml
git commit -m "feat(core): RAG config + Anthropic model registry"
```

---

### Task 3: `searchChunks` — `source_path` a citációhoz

**Files:**

- Modify: `packages/core/src/lib/knowledge-store.ts` (`SearchResult`, `SEARCH_SQL`, `searchChunks` mapping)
- Modify: `packages/core/src/lib/knowledge-store.spec.ts` (fake Queryable teszt)

**Interfaces:**

- Produces: `SearchResult` bővül `source_path: string`-tal; a `SEARCH_SQL` SELECT-je `d.source_path`-ot is visszaad.

- [ ] **Step 1: Failing test — `searchChunks` visszaadja a `source_path`-ot**

`packages/core/src/lib/knowledge-store.spec.ts`-hez adj hozzá egy tesztet (a meglévő `searchChunks` describe-ba, vagy újba). Fake `Queryable`, ami rögzíti a SQL-t és sort ad vissza:

```typescript
import { searchChunks, type Queryable } from './knowledge-store.js';

describe('searchChunks (source_path for citations)', () => {
  it('selects and maps source_path', async () => {
    let capturedSql = '';
    const client: Queryable = {
      query: async (text) => {
        capturedSql = text;
        return {
          rows: [
            {
              chunk_id: 1,
              document_id: 2,
              content: 'szöveg',
              heading_path: 'Öntözés',
              title: 'Pozsgások',
              source_url: null,
              source_path: 'seed/knowledge/pozsgas.md',
              similarity: 0.62,
            },
          ],
        };
      },
    };
    const embedding = new Array(1536).fill(0.01);
    const [result] = await searchChunks(embedding, 5, { client });
    expect(capturedSql).toContain('d.source_path');
    expect(result.source_path).toBe('seed/knowledge/pozsgas.md');
    expect(result.similarity).toBeCloseTo(0.62);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- knowledge-store`
Expected: FAIL — `capturedSql` nem tartalmazza `d.source_path`-ot / `result.source_path` `undefined`.

- [ ] **Step 3: Add `source_path` to `SearchResult`, SQL, and mapping**

`knowledge-store.ts` — `SearchResult` interfész bővítése:

```typescript
export interface SearchResult {
  readonly chunk_id: number;
  readonly document_id: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly title: string;
  readonly source_url: string | null;
  readonly source_path: string;
  readonly similarity: number;
}
```

`SEARCH_SQL` — vedd fel a `d.source_path`-ot a SELECT-be:

```typescript
const SEARCH_SQL = `SELECT
  dc.id AS chunk_id,
  dc.document_id,
  dc.content,
  dc.heading_path,
  d.title,
  d.source_url,
  d.source_path,
  1 - (dc.embedding <=> $1::vector) AS similarity
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
ORDER BY dc.embedding <=> $1::vector
LIMIT $2`;
```

A `searchChunks` `rows.map(...)`-jába:

```typescript
return rows.map((row) => ({
  chunk_id: Number(row.chunk_id),
  document_id: Number(row.document_id),
  content: String(row.content),
  heading_path: row.heading_path === null ? null : String(row.heading_path),
  title: String(row.title),
  source_url: row.source_url === null ? null : String(row.source_url),
  source_path: String(row.source_path),
  similarity: Number(row.similarity),
}));
```

- [ ] **Step 4: Run test — verify it passes**

Run: `pnpm nx test @plantbase/core -- knowledge-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/knowledge-store.ts packages/core/src/lib/knowledge-store.spec.ts
git commit -m "feat(core): include source_path in searchChunks for citations"
```

---

### Task 4: `rag/router.ts` — útvonalválasztó (Haiku, `generateObject`)

**Files:**

- Create: `packages/core/src/lib/rag/router.ts`
- Test: `packages/core/src/lib/rag/router.spec.ts`

**Interfaces:**

- Consumes: `LanguageModel` (`ai`), `ChatRoute` (`@plantbase/shared`).
- Produces:
  - `RouterResult { route: ChatRoute; reasoning: string }`
  - `GenerateObjectFn` — szűk, injektálható `generateObject`-szerű típus (a DI-mintához, mint `embedding.ts` az `embedMany`-t).
  - `Router = (question: string) => Promise<RouterResult>`
  - `createRouter(deps: { model: LanguageModel; generateObject?: GenerateObjectFn }): Router`

- [ ] **Step 1: Failing test — router fake `generateObject`-tel**

`packages/core/src/lib/rag/router.spec.ts`:

```typescript
import { createRouter, type GenerateObjectFn } from './router.js';
import type { LanguageModel } from 'ai';

const model = { modelId: 'fake' } as unknown as LanguageModel;

describe('createRouter', () => {
  it('returns the classified route and passes the question in the prompt', async () => {
    let capturedPrompt = '';
    const generateObject: GenerateObjectFn = async ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        object: { route: 'catalog', reasoning: 'Konkrét termékadat kell.' },
      };
    };
    const router = createRouter({ model, generateObject });
    const result = await router('Mennyibe kerül a Kentia pálma?');
    expect(result.route).toBe('catalog');
    expect(result.reasoning).toContain('termékadat');
    expect(capturedPrompt).toContain('Mennyibe kerül a Kentia pálma?');
  });

  it('propagates the schema so an invalid route would be rejected upstream', async () => {
    const generateObject: GenerateObjectFn = async ({ schema }) => {
      // A séma zod-objektum: a route mezőnek enumnak kell lennie.
      expect(schema.safeParse({ route: 'both', reasoning: 'x' }).success).toBe(
        true,
      );
      expect(schema.safeParse({ route: 'nope', reasoning: 'x' }).success).toBe(
        false,
      );
      return { object: { route: 'both', reasoning: 'x' } };
    };
    const router = createRouter({ model, generateObject });
    expect((await router('q')).route).toBe('both');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- router`
Expected: FAIL — `Cannot find module './router.js'`.

- [ ] **Step 3: Implement `rag/router.ts`**

`packages/core/src/lib/rag/router.ts`:

```typescript
// LLM-router (SP3a): eldönti, hogy a kérdés a tudásbázisra (knowledge), a
// katalógusra (catalog), vagy mindkettőre (both) vonatkozik. Olcsó Haiku modell,
// zod-strukturált kimenet (generateObject). A generateObject injektálható a
// teszthez (DI-minta, vö. embedding.ts embedMany).

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { chatRouteSchema, type ChatRoute } from '@plantbase/shared';

/** A router strukturált kimenete. */
export interface RouterResult {
  readonly route: ChatRoute;
  readonly reasoning: string;
}

const routerSchema = z.object({
  route: chatRouteSchema,
  reasoning: z.string(),
});

/** Szűk, injektálható generateObject (csak amit a router használ). */
export type GenerateObjectFn = <T>(args: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
}) => Promise<{ object: T }>;

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object } = await generateObject({ model, schema, system, prompt });
  return { object };
};

const ROUTER_SYSTEM = `Te a Plantbase asszisztens útvonalválasztója vagy. Döntsd el, honnan jöhet a válasz:
- "knowledge": általános növénygondozási / ismeretkérdés (a tudásbázis cikkeiből).
- "catalog": konkrét termékadat a webshop katalógusából (ár, készlet, méret, szűrés, kategória).
- "both": mindkettő kell (pl. "milyen pozsgást vegyek és hogyan gondozzam").
Adj rövid magyar indoklást (reasoning).`;

export interface RouterDeps {
  readonly model: LanguageModel;
  readonly generateObject?: GenerateObjectFn;
}

export type Router = (question: string) => Promise<RouterResult>;

/** Létrehozza a router-függvényt (a modell és a generateObject bekötve). */
export function createRouter(deps: RouterDeps): Router {
  const run = deps.generateObject ?? defaultGenerateObject;
  return async (question) => {
    const { object } = await run({
      model: deps.model,
      schema: routerSchema,
      system: ROUTER_SYSTEM,
      prompt: `Kérdés: ${question}`,
    });
    return object;
  };
}
```

- [ ] **Step 4: Run test + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- router` majd `pnpm nx typecheck @plantbase/core`
Expected: PASS mindkettő.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/router.ts packages/core/src/lib/rag/router.spec.ts
git commit -m "feat(core): LLM router stage for RAG pipeline"
```

---

### Task 5: `rag/hyde.ts` — HyDE hipotetikus válasz (Haiku, `generateText`)

**Files:**

- Create: `packages/core/src/lib/rag/hyde.ts`
- Test: `packages/core/src/lib/rag/hyde.spec.ts`

**Interfaces:**

- Consumes: `LanguageModel` (`ai`).
- Produces:
  - `GenerateTextFn = (args: { model: LanguageModel; system?: string; prompt: string }) => Promise<{ text: string }>`
  - `Hyde = (question: string) => Promise<string>`
  - `createHyde(deps: { model: LanguageModel; generateText?: GenerateTextFn }): Hyde`

- [ ] **Step 1: Failing test — hyde fake `generateText`-tel**

`packages/core/src/lib/rag/hyde.spec.ts`:

```typescript
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
    expect(doc).toContain('öntözni');
    expect(capturedPrompt).toContain('Hogyan öntözzem a pozsgást?');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- hyde`
Expected: FAIL — `Cannot find module './hyde.js'`.

- [ ] **Step 3: Implement `rag/hyde.ts`**

`packages/core/src/lib/rag/hyde.ts`:

```typescript
// HyDE (Hypothetical Document Embeddings) stage (SP3a): a kérdésre generálunk egy
// rövid, hipotetikus választ, és AZT ágyazzuk be a vektorkereséshez (a query-oldal
// minősége nő, mert a hipotetikus válasz szókincse közelebb áll a tárolt cikkekhez).
// Olcsó Haiku; a generateText injektálható a teszthez.

import { generateText, type LanguageModel } from 'ai';

/** Szűk, injektálható generateText (csak amit a HyDE használ). */
export type GenerateTextFn = (args: {
  model: LanguageModel;
  system?: string;
  prompt: string;
}) => Promise<{ text: string }>;

const defaultGenerateText: GenerateTextFn = async ({
  model,
  system,
  prompt,
}) => {
  const { text } = await generateText({ model, system, prompt });
  return { text };
};

const HYDE_SYSTEM = `Írj egy rövid (2-4 mondatos), tárgyszerű magyar bekezdést, amely úgy válaszol a kérdésre, mintha egy növénygondozási cikk részlete lenne. Ne kérdezz vissza, ne mentegetőzz — csak a hipotetikus válasz szövegét add.`;

export interface HydeDeps {
  readonly model: LanguageModel;
  readonly generateText?: GenerateTextFn;
}

export type Hyde = (question: string) => Promise<string>;

/** Létrehozza a HyDE-függvényt. */
export function createHyde(deps: HydeDeps): Hyde {
  const run = deps.generateText ?? defaultGenerateText;
  return async (question) => {
    const { text } = await run({
      model: deps.model,
      system: HYDE_SYSTEM,
      prompt: `Kérdés: ${question}`,
    });
    return text.trim();
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `pnpm nx test @plantbase/core -- hyde`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/hyde.ts packages/core/src/lib/rag/hyde.spec.ts
git commit -m "feat(core): HyDE stage for RAG query expansion"
```

---

### Task 6: `rag/retrieval.ts` — vektorkeresés (kód: `embedQuery` → `searchChunks`)

**Files:**

- Create: `packages/core/src/lib/rag/retrieval.ts`
- Test: `packages/core/src/lib/rag/retrieval.spec.ts`

**Interfaces:**

- Consumes: `embedQuery` (embedding.ts), `searchChunks` + `SearchResult` (knowledge-store.ts).
- Produces:
  - `EmbedQueryFn = (text: string) => Promise<number[]>`
  - `SearchChunksFn = (embedding: readonly number[], k: number) => Promise<SearchResult[]>`
  - `Retrieve = (queryText: string) => Promise<SearchResult[]>`
  - `createRetrieve(deps: { topK: number; embedQuery?: EmbedQueryFn; searchChunks?: SearchChunksFn }): Retrieve`

- [ ] **Step 1: Failing test — retrieval fake embed + search**

`packages/core/src/lib/rag/retrieval.spec.ts`:

```typescript
import { createRetrieve } from './retrieval.js';
import type { SearchResult } from '../knowledge-store.js';

const chunk = (id: number, sim: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: sim,
});

describe('createRetrieve', () => {
  it('embeds the query text and searches with topK', async () => {
    let embeddedText = '';
    let usedK = 0;
    const retrieve = createRetrieve({
      topK: 12,
      embedQuery: async (text) => {
        embeddedText = text;
        return new Array(1536).fill(0.02);
      },
      searchChunks: async (_embedding, k) => {
        usedK = k;
        return [chunk(1, 0.6), chunk(2, 0.5)];
      },
    });
    const results = await retrieve('hipotetikus válasz szövege');
    expect(embeddedText).toBe('hipotetikus válasz szövege');
    expect(usedK).toBe(12);
    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBeCloseTo(0.6);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- retrieval`
Expected: FAIL — `Cannot find module './retrieval.js'`.

- [ ] **Step 3: Implement `rag/retrieval.ts`**

`packages/core/src/lib/rag/retrieval.ts`:

```typescript
// Retrieval stage (SP3a): TISZTA KÓD, nincs LLM. A (HyDE) query-szöveget beágyazza
// (OpenAI text-embedding-3-small, embedding.ts), majd a pgvector vektorkeresést
// futtatja a read-only kapcsolaton (searchChunks). Mindkét primitív injektálható
// (teszthez fake), a default a valós implementáció.

import { embedQuery as defaultEmbedQuery } from '../embedding.js';
import {
  searchChunks as defaultSearchChunks,
  type SearchResult,
} from '../knowledge-store.js';

export type EmbedQueryFn = (text: string) => Promise<number[]>;
export type SearchChunksFn = (
  embedding: readonly number[],
  k: number,
) => Promise<SearchResult[]>;

export interface RetrieveDeps {
  readonly topK: number;
  readonly embedQuery?: EmbedQueryFn;
  readonly searchChunks?: SearchChunksFn;
}

export type Retrieve = (queryText: string) => Promise<SearchResult[]>;

/** Létrehozza a retrieval-függvényt (embed → search, topK-val). */
export function createRetrieve(deps: RetrieveDeps): Retrieve {
  const embed = deps.embedQuery ?? ((text) => defaultEmbedQuery(text));
  const search =
    deps.searchChunks ?? ((embedding, k) => defaultSearchChunks(embedding, k));
  return async (queryText) => {
    const embedding = await embed(queryText);
    return search(embedding, deps.topK);
  };
}
```

- [ ] **Step 4: Run test + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- retrieval` majd `pnpm nx typecheck @plantbase/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/retrieval.ts packages/core/src/lib/rag/retrieval.spec.ts
git commit -m "feat(core): retrieval stage (embed query + vector search)"
```

---

### Task 7: `rag/rerank.ts` — relevancia-újrarendezés (Haiku), hibára degradál

**Files:**

- Create: `packages/core/src/lib/rag/rerank.ts`
- Test: `packages/core/src/lib/rag/rerank.spec.ts`

**Interfaces:**

- Consumes: `LanguageModel` (`ai`), `SearchResult` (knowledge-store.ts), `GenerateObjectFn` (router.ts-ből újrahasznosítva).
- Produces:
  - `RerankOutcome { chunks: SearchResult[]; degraded: boolean }`
  - `Rerank = (question: string, chunks: readonly SearchResult[]) => Promise<RerankOutcome>`
  - `createRerank(deps: { model: LanguageModel; topN: number; generateObject?: GenerateObjectFn }): Rerank`

**Viselkedés:** a modell a chunk-indexek listáját adja vissza relevancia-sorrendben; ezekből az első `topN`-et tartjuk meg (az eredeti `SearchResult`-okra visszaképezve). Ha a modell hibázik, vagy érvénytelen indexet ad, a NYERS retrieval-sorrend első `topN` eleme megy tovább (`degraded: true`). Üres bemenetre üres, `degraded: false`.

- [ ] **Step 1: Failing test — rerank újrarendez + hibára degradál**

`packages/core/src/lib/rag/rerank.spec.ts`:

```typescript
import { createRerank } from './rerank.js';
import type { GenerateObjectFn } from './router.js';
import type { LanguageModel } from 'ai';
import type { SearchResult } from '../knowledge-store.js';

const model = { modelId: 'fake' } as unknown as LanguageModel;
const chunk = (id: number): SearchResult => ({
  chunk_id: id,
  document_id: id,
  content: `c${id}`,
  heading_path: null,
  title: `t${id}`,
  source_url: null,
  source_path: `p${id}.md`,
  similarity: 0.5,
});
const input = [chunk(0), chunk(1), chunk(2), chunk(3)];

describe('createRerank', () => {
  it('reorders by the model ranking and keeps topN', async () => {
    const generateObject: GenerateObjectFn = async () =>
      ({ object: { ranking: [2, 0] } }) as never;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(false);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([2, 0]);
  });

  it('degrades to the raw order (sliced to topN) when the model throws', async () => {
    const generateObject: GenerateObjectFn = async () => {
      throw new Error('rerank model down');
    };
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(true);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([0, 1]);
  });

  it('degrades on out-of-range indices', async () => {
    const generateObject: GenerateObjectFn = async () =>
      ({ object: { ranking: [99] } }) as never;
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', input);
    expect(outcome.degraded).toBe(true);
    expect(outcome.chunks.map((c) => c.chunk_id)).toEqual([0, 1]);
  });

  it('returns empty for empty input without calling the model', async () => {
    let called = false;
    const generateObject: GenerateObjectFn = async () => {
      called = true;
      return { object: { ranking: [] } } as never;
    };
    const rerank = createRerank({ model, topN: 2, generateObject });
    const outcome = await rerank('kérdés', []);
    expect(outcome.chunks).toEqual([]);
    expect(outcome.degraded).toBe(false);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- rerank`
Expected: FAIL — `Cannot find module './rerank.js'`.

- [ ] **Step 3: Implement `rag/rerank.ts`**

`packages/core/src/lib/rag/rerank.ts`:

```typescript
// Rerank stage (SP3a): a top-K chunkot relevancia szerint újrarendezi (Haiku), és
// az első topN-et tartja meg. A modell a chunkok INDEXEIT adja vissza sorrendben
// (0-alapú), így a tartalmat nem kell visszaküldenie. Hibára / érvénytelen indexre
// DEGRADÁL: a nyers retrieval-sorrend első topN eleme megy tovább (degraded: true).
// Így a "rerank mindig lefut és nem dönti be a pipeline-t" garancia teljesül.

import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { SearchResult } from '../knowledge-store.js';
import type { GenerateObjectFn } from './router.js';
import { generateObject } from 'ai';

const rerankSchema = z.object({
  ranking: z.array(z.number().int().nonnegative()),
});

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  system,
  prompt,
}) => {
  const { object } = await generateObject({ model, schema, system, prompt });
  return { object };
};

const RERANK_SYSTEM = `Rangsorold a számozott dokumentum-részleteket a kérdés szempontjából relevancia szerint (legrelevánsabb elöl). A "ranking" mezőben a részletek 0-alapú indexeit add vissza, csökkenő relevancia sorrendben. Csak a valóban releváns részletek indexeit sorold fel.`;

/** A rerank kimenete: a megtartott chunkok + jelzés, hogy degradált-e. */
export interface RerankOutcome {
  readonly chunks: SearchResult[];
  readonly degraded: boolean;
}

export interface RerankDeps {
  readonly model: LanguageModel;
  readonly topN: number;
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

/** Létrehozza a rerank-függvényt. */
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
      const { object } = await run({
        model: deps.model,
        schema: rerankSchema,
        system: RERANK_SYSTEM,
        prompt: `Kérdés: ${question}\n\nRészletek:\n${numbered}`,
      });
      const seen = new Set<number>();
      const picked: SearchResult[] = [];
      for (const index of object.ranking) {
        if (index < 0 || index >= chunks.length || seen.has(index)) {
          return { chunks: rawTopN(chunks, deps.topN), degraded: true };
        }
        seen.add(index);
        picked.push(chunks[index]);
        if (picked.length >= deps.topN) break;
      }
      if (picked.length === 0) {
        return { chunks: rawTopN(chunks, deps.topN), degraded: true };
      }
      return { chunks: picked, degraded: false };
    } catch {
      return { chunks: rawTopN(chunks, deps.topN), degraded: true };
    }
  };
}
```

- [ ] **Step 4: Run test + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- rerank` majd `pnpm nx typecheck @plantbase/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/rerank.ts packages/core/src/lib/rag/rerank.spec.ts
git commit -m "feat(core): rerank stage with graceful degradation"
```

---

### Task 8: `rag/guardrail.ts` — grounding-küszöb (tiszta kód)

**Files:**

- Create: `packages/core/src/lib/rag/guardrail.ts`
- Test: `packages/core/src/lib/rag/guardrail.spec.ts`

**Interfaces:**

- Consumes: `SearchResult` (knowledge-store.ts).
- Produces:
  - `GroundingCheck { grounded: boolean; maxSimilarity: number }`
  - `checkGrounding(chunks: readonly SearchResult[], threshold: number): GroundingCheck`
  - `NO_GROUNDING_MESSAGE: string` — a magyar "nem tudok válaszolni" szöveg.

- [ ] **Step 1: Failing test — küszöb határeset (alatt/felett/0 találat)**

`packages/core/src/lib/rag/guardrail.spec.ts`:

```typescript
import { checkGrounding, NO_GROUNDING_MESSAGE } from './guardrail.js';
import type { SearchResult } from '../knowledge-store.js';

const withSim = (sim: number): SearchResult => ({
  chunk_id: 1,
  document_id: 1,
  content: 'c',
  heading_path: null,
  title: 't',
  source_url: null,
  source_path: 'p.md',
  similarity: sim,
});

describe('checkGrounding', () => {
  it('is not grounded on zero results', () => {
    const result = checkGrounding([], 0.35);
    expect(result.grounded).toBe(false);
    expect(result.maxSimilarity).toBe(0);
  });

  it('is not grounded when max similarity is below the threshold', () => {
    const result = checkGrounding([withSim(0.2), withSim(0.34)], 0.35);
    expect(result.grounded).toBe(false);
    expect(result.maxSimilarity).toBeCloseTo(0.34);
  });

  it('is grounded when max similarity meets the threshold', () => {
    const result = checkGrounding([withSim(0.35), withSim(0.1)], 0.35);
    expect(result.grounded).toBe(true);
    expect(result.maxSimilarity).toBeCloseTo(0.35);
  });

  it('exposes a Hungarian no-grounding message', () => {
    expect(NO_GROUNDING_MESSAGE).toMatch(/tudásbázis/i);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- guardrail`
Expected: FAIL — `Cannot find module './guardrail.js'`.

- [ ] **Step 3: Implement `rag/guardrail.ts`**

`packages/core/src/lib/rag/guardrail.ts`:

```typescript
// Guardrail stage (SP3a): TISZTA KÓD küszöb-ellenőrzés. Ha 0 találat van, vagy a
// legnagyobb cosine-similarity a grounding-küszöb ALATT van, akkor NINCS elég
// megbízható forrás — a pipeline az answer-hívás NÉLKÜL a magyar "nem tudok
// válaszolni" üzenetet adja, hogy ne hallucináljon (PRD kemény garancia).
// A küszöb a 2026-07-28-i retrieval-kalibrációból: releváns találatok ~0.53–0.69,
// a reális küszöb ~0.35 (config.groundingThreshold, env-felülírható).

import type { SearchResult } from '../knowledge-store.js';

/** A grounding-ellenőrzés eredménye. */
export interface GroundingCheck {
  readonly grounded: boolean;
  readonly maxSimilarity: number;
}

/** A magyar üzenet, ha nincs elég megbízható forrás a tudásbázisban. */
export const NO_GROUNDING_MESSAGE =
  'A tudásbázis alapján erre a kérdésre nem tudok megbízhatóan válaszolni. Pontosítanád a kérdést, vagy kérdezz növénygondozási témában.';

/** Grounded, ha van találat és a legnagyobb similarity eléri a küszöböt. */
export function checkGrounding(
  chunks: readonly SearchResult[],
  threshold: number,
): GroundingCheck {
  if (chunks.length === 0) {
    return { grounded: false, maxSimilarity: 0 };
  }
  const maxSimilarity = Math.max(...chunks.map((c) => c.similarity));
  return { grounded: maxSimilarity >= threshold, maxSimilarity };
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `pnpm nx test @plantbase/core -- guardrail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/guardrail.ts packages/core/src/lib/rag/guardrail.spec.ts
git commit -m "feat(core): grounding guardrail (similarity threshold)"
```

---

### Task 9: `rag/answer.ts` — grounded válasz streamelve (Sonnet), forrásokkal

**Files:**

- Create: `packages/core/src/lib/rag/answer.ts`
- Test: `packages/core/src/lib/rag/answer.spec.ts`

**Interfaces:**

- Consumes: `LanguageModel` (`ai`), `SearchResult` (knowledge-store.ts), `SourceRef` (`@plantbase/shared`).
- Produces:
  - `AnswerStreamFn = (args: { model: LanguageModel; system: string; prompt: string }) => { textStream: AsyncIterable<string> }`
  - `AnswerInput { question: string; chunks: readonly SearchResult[]; catalogContext?: string }`
  - `AnswerResult { textStream: AsyncIterable<string>; sources: SourceRef[] }`
  - `Answer = (input: AnswerInput) => AnswerResult`
  - `createAnswer(deps: { model: LanguageModel; streamAnswer?: AnswerStreamFn }): Answer`
  - `toSourceRefs(chunks: readonly SearchResult[]): SourceRef[]` (dokumentumonként egyszer, sorrendtartó dedup `document_id` szerint)

- [ ] **Step 1: Failing test — answer streamel + forrásokat képez**

`packages/core/src/lib/rag/answer.spec.ts`:

```typescript
import { createAnswer, toSourceRefs, type AnswerStreamFn } from './answer.js';
import type { LanguageModel } from 'ai';
import type { SearchResult } from '../knowledge-store.js';

const model = { modelId: 'fake' } as unknown as LanguageModel;

const chunk = (docId: number, title: string): SearchResult => ({
  chunk_id: docId * 10,
  document_id: docId,
  content: `tartalom ${title}`,
  heading_path: 'Öntözés',
  title,
  source_url: docId === 1 ? 'https://example.hu/a' : null,
  source_path: `seed/knowledge/${title}.md`,
  similarity: 0.6,
});

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

describe('toSourceRefs', () => {
  it('dedupes by document_id, keeping first occurrence order', () => {
    const refs = toSourceRefs([chunk(1, 'a'), chunk(1, 'a'), chunk(2, 'b')]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      title: 'a',
      sourceUrl: 'https://example.hu/a',
      sourcePath: 'seed/knowledge/a.md',
      headingPath: 'Öntözés',
    });
    expect(refs[1].title).toBe('b');
  });
});

describe('createAnswer', () => {
  it('streams the answer and includes the chunk content in the prompt', async () => {
    let capturedPrompt = '';
    const streamAnswer: AnswerStreamFn = ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        textStream: (async function* () {
          yield 'A ';
          yield 'pozsgás';
        })(),
      };
    };
    const answer = createAnswer({ model, streamAnswer });
    const result = answer({
      question: 'Hogyan öntözzem?',
      chunks: [chunk(1, 'a')],
    });
    expect(await collect(result.textStream)).toBe('A pozsgás');
    expect(capturedPrompt).toContain('tartalom a');
    expect(result.sources.map((s) => s.title)).toEqual(['a']);
  });

  it('passes catalogContext into the prompt when present (both route)', async () => {
    let capturedPrompt = '';
    const streamAnswer: AnswerStreamFn = ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        textStream: (async function* () {
          yield 'ok';
        })(),
      };
    };
    const answer = createAnswer({ model, streamAnswer });
    answer({
      question: 'q',
      chunks: [chunk(1, 'a')],
      catalogContext: 'Kentia pálma: 18900 Ft',
    }).textStream;
    expect(capturedPrompt).toContain('Kentia pálma: 18900 Ft');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- answer`
Expected: FAIL — `Cannot find module './answer.js'`.

- [ ] **Step 3: Implement `rag/answer.ts`**

`packages/core/src/lib/rag/answer.ts`:

```typescript
// Answer stage (SP3a): a grounded, magyar nyelvű válasz Sonnet modellel, STREAMELVE
// (streamText textStream). A prompt tiltja a hallucinációt: csak a megadott
// forrásrészletekből (és opcionálisan a katalógus-kontextusból) válaszolhat, és
// hivatkozzon a forrásokra (cím / URL / fájlnév). A forráshivatkozásokat (SourceRef)
// a chunkokból KÓDDAL képezzük (dokumentumonként egyszer), nem a modellre bízzuk.

import { streamText, type LanguageModel } from 'ai';
import type { SourceRef } from '@plantbase/shared';
import type { SearchResult } from '../knowledge-store.js';

/** Szűk, injektálható streamText (csak amit az answer használ). */
export type AnswerStreamFn = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) => { textStream: AsyncIterable<string> };

const defaultStreamAnswer: AnswerStreamFn = ({ model, system, prompt }) => {
  const { textStream } = streamText({ model, system, prompt });
  return { textStream };
};

const ANSWER_SYSTEM = `Te a Plantbase növény-asszisztens vagy. Válaszolj magyarul, tömören, KIZÁRÓLAG a megadott forrásrészletek (és ha van, a katalógus-adatok) alapján. Ha a részletek nem fedik le a kérdést, mondd ki őszintén — SOHA ne találj ki tényt, növényt, árat vagy adatot. A válasz végén sorold fel a felhasznált forrásokat (cím, és ha van, URL vagy fájlnév).`;

/** SearchResult-okból forráshivatkozások, dokumentumonként egyszer (sorrendtartó). */
export function toSourceRefs(chunks: readonly SearchResult[]): SourceRef[] {
  const seen = new Set<number>();
  const refs: SourceRef[] = [];
  for (const c of chunks) {
    if (seen.has(c.document_id)) continue;
    seen.add(c.document_id);
    refs.push({
      title: c.title,
      sourceUrl: c.source_url,
      sourcePath: c.source_path,
      headingPath: c.heading_path,
    });
  }
  return refs;
}

function buildContext(chunks: readonly SearchResult[]): string {
  return chunks
    .map(
      (c, i) =>
        `[Forrás ${i + 1}] ${c.title}${c.heading_path ? ` — ${c.heading_path}` : ''}` +
        `${c.source_url ? ` (${c.source_url})` : ` (${c.source_path})`}\n${c.content}`,
    )
    .join('\n\n');
}

export interface AnswerInput {
  readonly question: string;
  readonly chunks: readonly SearchResult[];
  /** Katalógus-kontextus a "both" útvonalon (a catalog-agent szöveges eredménye). */
  readonly catalogContext?: string;
}

export interface AnswerResult {
  readonly textStream: AsyncIterable<string>;
  readonly sources: SourceRef[];
}

export interface AnswerDeps {
  readonly model: LanguageModel;
  readonly streamAnswer?: AnswerStreamFn;
}

export type Answer = (input: AnswerInput) => AnswerResult;

/** Létrehozza az answer-függvényt (grounded, streamelő). */
export function createAnswer(deps: AnswerDeps): Answer {
  const run = deps.streamAnswer ?? defaultStreamAnswer;
  return (input) => {
    const sources = toSourceRefs(input.chunks);
    const context = buildContext(input.chunks);
    const catalog = input.catalogContext
      ? `\n\nKatalógus-adatok:\n${input.catalogContext}`
      : '';
    const { textStream } = run({
      model: deps.model,
      system: ANSWER_SYSTEM,
      prompt: `Kérdés: ${input.question}\n\nForrásrészletek:\n${context}${catalog}`,
    });
    return { textStream, sources };
  };
}
```

- [ ] **Step 4: Run test + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- answer` majd `pnpm nx typecheck @plantbase/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/rag/answer.ts packages/core/src/lib/rag/answer.spec.ts
git commit -m "feat(core): grounded streaming answer stage with sources"
```

---

### Task 10: `rag/tools.ts` + `rag/catalog-agent.ts` — katalógus-út (AI SDK tools)

**Files:**

- Create: `packages/core/src/lib/rag/tools.ts`
- Create: `packages/core/src/lib/rag/catalog-agent.ts`
- Test: `packages/core/src/lib/rag/tools.spec.ts`, `packages/core/src/lib/rag/catalog-agent.spec.ts`

**Interfaces:**

- Consumes: `RunSqlFn`, `ListCategoriesFn` (agent-tools.ts — ezek megmaradnak, míg a Task 12 nem törli az `agent-tools.ts`-t; a típusok viszont egyszerűek, ezért itt ÚJRADEKLARÁLJUK a `rag/tools.ts`-ben, hogy a katalógus-út ne függjön a törlendő fájltól), `LanguageModel`, `tool`, `stepCountIs`, `streamText` (`ai`), `schema-context.ts` `buildSystemPrompt`.
- Produces:
  - `rag/tools.ts`: `RunSqlFn`, `ListCategoriesFn`, `createCatalogTools(deps: { runSql: RunSqlFn; listCategories: ListCategoriesFn }): ToolSet`
  - `rag/catalog-agent.ts`:
    - `CatalogStreamFn` — szűk, injektálható `streamText`-szerű (tools + stopWhen) → `{ textStream }`
    - `CatalogAgent = (question: string) => { textStream: AsyncIterable<string> }`
    - `createCatalogAgent(deps: { model: LanguageModel; runSql: RunSqlFn; listCategories: ListCategoriesFn; maxIterations: number; streamCatalog?: CatalogStreamFn }): CatalogAgent`

- [ ] **Step 1: Failing test — `createCatalogTools` végrehajtja a toolokat**

`packages/core/src/lib/rag/tools.spec.ts`:

```typescript
import { createCatalogTools } from './tools.js';

describe('createCatalogTools', () => {
  it('exposes catalogSql and listCategories with executable handlers', async () => {
    const tools = createCatalogTools({
      runSql: async (q) => [{ q }],
      listCategories: async () => ['kaktusz', 'pozsgás'],
    });
    expect(Object.keys(tools)).toContain('catalogSql');
    expect(Object.keys(tools)).toContain('listCategories');

    const sqlResult = await tools.catalogSql.execute!(
      { query: 'SELECT name FROM products LIMIT 1' },
      { toolCallId: 't1', messages: [] },
    );
    expect(sqlResult).toContain('SELECT name FROM products LIMIT 1');

    const catResult = await tools.listCategories.execute!(
      {},
      { toolCallId: 't2', messages: [] },
    );
    expect(catResult).toContain('kaktusz');
  });
});
```

> Az AI SDK `tool()` `execute(input, options)` alakú; a teszt a `toolCallId`/`messages` opciót minimálisan adja meg.

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- tools`
Expected: FAIL — `Cannot find module './tools.js'`.

- [ ] **Step 3: Implement `rag/tools.ts`**

`packages/core/src/lib/rag/tools.ts`:

```typescript
// Katalógus-toolok AI SDK `tool()` formában (SP3a). A régi agent-tools.ts Anthropic-
// SDK definícióit váltja le. A catalogSql a read-only runSql guard mögött fut
// (assertSelectOnly + DATABASE_URL_READONLY — kettős védelem invariáns), a
// listCategories a hiteles kategória-listát adja. A futtatók injektálhatók (teszt).

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SqlRow } from '../runsql.js';

/** A runSql tool futtatója (injektálható teszthez). */
export type RunSqlFn = (query: string) => Promise<SqlRow[]>;
/** A listCategories tool futtatója (injektálható teszthez). */
export type ListCategoriesFn = () => Promise<string[]>;

export interface CatalogToolDeps {
  readonly runSql: RunSqlFn;
  readonly listCategories: ListCategoriesFn;
}

/** Összeállítja a katalógus-út AI SDK toolkészletét. */
export function createCatalogTools(deps: CatalogToolDeps): ToolSet {
  return {
    catalogSql: tool({
      description:
        'Read-only SQL futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, ne csak írd ki. Csak SELECT engedélyezett; az eredmény JSON sorok tömbje.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('A futtatandó PostgreSQL SELECT lekérdezés.'),
      }),
      execute: async ({ query }) => {
        const rows = await deps.runSql(query);
        return JSON.stringify(rows);
      },
    }),
    listCategories: tool({
      description:
        'A katalógusban ténylegesen előforduló növénykategóriák hiteles, ábécé-rendezett listája (a products.category distinct értékei). Kategóriára szűrésnél / kategória-kérdésnél ezt használd. Nincs bemeneti paramétere.',
      inputSchema: z.object({}),
      execute: async () => {
        const categories = await deps.listCategories();
        return JSON.stringify(categories);
      },
    }),
  };
}
```

- [ ] **Step 4: Run test — verify tools pass**

Run: `pnpm nx test @plantbase/core -- tools`
Expected: PASS.

- [ ] **Step 5: Failing test — `createCatalogAgent` streamel + tools/stopWhen bekötve**

`packages/core/src/lib/rag/catalog-agent.spec.ts`:

```typescript
import { createCatalogAgent, type CatalogStreamFn } from './catalog-agent.js';
import type { LanguageModel } from 'ai';

const model = { modelId: 'fake' } as unknown as LanguageModel;

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

describe('createCatalogAgent', () => {
  it('streams the catalog answer, wiring tools, system prompt and the question', async () => {
    let captured: Parameters<CatalogStreamFn>[0] | undefined;
    const streamCatalog: CatalogStreamFn = (args) => {
      captured = args;
      return {
        textStream: (async function* () {
          yield 'A ';
          yield 'Kentia';
        })(),
      };
    };
    const agent = createCatalogAgent({
      model,
      runSql: async () => [],
      listCategories: async () => [],
      maxIterations: 6,
      streamCatalog,
    });
    const { textStream } = agent('Mennyi a Kentia pálma?');
    expect(await collect(textStream)).toBe('A Kentia');
    expect(captured?.system).toContain('<schema>');
    expect(Object.keys(captured?.tools ?? {})).toContain('catalogSql');
    // A kérdés user-üzenetként megy be.
    expect(JSON.stringify(captured?.messages)).toContain(
      'Mennyi a Kentia pálma?',
    );
  });
});
```

- [ ] **Step 6: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- catalog-agent`
Expected: FAIL — `Cannot find module './catalog-agent.js'`.

- [ ] **Step 7: Implement `rag/catalog-agent.ts`**

`packages/core/src/lib/rag/catalog-agent.ts`:

```typescript
// Katalógus-agent (SP3a): a products-út. streamText a catalogSql + listCategories
// toolokkal, stopWhen: stepCountIs(maxIterations) — a modell addig hívhat toolt,
// míg meg nem válaszol, de a felső korlát véd a végtelen loop ellen. A system
// prompt a meglévő schema-context.ts-ből jön (products séma + SQL-szabályok).
// A streamText injektálható (teszt); a default a valós AI SDK-hívás.

import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { buildSystemPrompt } from '../schema-context.js';
import {
  createCatalogTools,
  type ListCategoriesFn,
  type RunSqlFn,
} from './tools.js';

/** Szűk, injektálható streamText a katalógus-úthoz (tools + stopWhen). */
export type CatalogStreamFn = (args: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  stopWhen: ReturnType<typeof stepCountIs>;
}) => { textStream: AsyncIterable<string> };

const defaultStreamCatalog: CatalogStreamFn = ({
  model,
  system,
  messages,
  tools,
  stopWhen,
}) => {
  const { textStream } = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen,
  });
  return { textStream };
};

export interface CatalogAgentDeps {
  readonly model: LanguageModel;
  readonly runSql: RunSqlFn;
  readonly listCategories: ListCategoriesFn;
  readonly maxIterations: number;
  readonly streamCatalog?: CatalogStreamFn;
}

export type CatalogAgent = (question: string) => {
  textStream: AsyncIterable<string>;
};

/** Létrehozza a katalógus-agentet (streamelő, tool-loop stopWhen-nel). */
export function createCatalogAgent(deps: CatalogAgentDeps): CatalogAgent {
  const run = deps.streamCatalog ?? defaultStreamCatalog;
  const tools = createCatalogTools({
    runSql: deps.runSql,
    listCategories: deps.listCategories,
  });
  const system = buildSystemPrompt({ databaseAvailable: true });
  return (question) => {
    const messages: ModelMessage[] = [{ role: 'user', content: question }];
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

- [ ] **Step 8: Run tests + typecheck — verify pass**

Run: `pnpm nx test @plantbase/core -- catalog-agent` és `pnpm nx typecheck @plantbase/core`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/lib/rag/tools.ts packages/core/src/lib/rag/tools.spec.ts packages/core/src/lib/rag/catalog-agent.ts packages/core/src/lib/rag/catalog-agent.spec.ts
git commit -m "feat(core): catalog tools + catalog agent (AI SDK streamText)"
```

---

### Task 11: `rag/pipeline.ts` — orchestrátor (`runChat`) + core export

**Files:**

- Create: `packages/core/src/lib/rag/pipeline.ts`
- Test: `packages/core/src/lib/rag/pipeline.spec.ts`
- Modify: `packages/core/src/index.ts` (rag re-export; a régi `ask-agent`/`agent-tools` export EGYELŐRE marad — Task 12 törli)

**Interfaces:**

- Consumes: `Router`, `Hyde`, `Retrieve`, `Rerank`, `Answer`, `CatalogAgent`, `checkGrounding`, `NO_GROUNDING_MESSAGE`, `OnTrace`/`TraceEvent`/`RagAnswer`/`SourceRef`/`ChatRoute`.
- Produces:
  - `ChatDeps` — az injektálható stage-függvények + config-értékek + `onTrace`.
  - `ChatRun { textStream: AsyncIterable<string>; result: Promise<RagAnswer> }`
  - `runChat(question: string, deps: ChatDeps): Promise<ChatRun>`
  - `createDefaultChatDeps(overrides?): ChatDeps` — a valós wiring (models + stage-ek a configból).

**Adatfolyam (a design "Adatfolyam" szakasza szerint):**

1. `router(question)` → `route`; emit `{type:'router', ...}`.
2. Ha `route` ∈ {knowledge, both}: `hyde` → emit `hyde`; `retrieve` → emit `retrieval`; `rerank` → emit `rerank`; `checkGrounding` → emit `guardrail`.
   - Ha NEM grounded: a `textStream` a `NO_GROUNDING_MESSAGE`-et adja (egyetlen chunk), `result` = `{ text: NO_GROUNDING_MESSAGE, route, sources: [] }`. **Nincs answer-hívás.**
3. Ha `route === 'catalog'`: `catalogAgent(question)` streamje megy tovább, `sources: []`.
4. Ha `route === 'both'`: a katalógus-agent szöveges eredményét összegyűjtjük (`catalogContext`), majd az `answer`-t a knowledge-chunkokkal + catalogContext-tel streameljük.
5. `route === 'knowledge'` (grounded): `answer` a chunkokkal, `sources` a chunkokból.
6. Streamelés közben `answer-start` majd `answer-delta` trace-ek; a végén a `result` Promise a teljes szöveggel + forrásokkal resolve-ol.

> A `runChat` egy **tee-t** valósít meg: a visszaadott `textStream` a fogyasztó (CLI) felé megy, és közben a pipeline gyűjti a teljes szöveget a `result` Promise-hoz, és emittálja az `answer-delta` trace-eket. Ezt egy belső async generátor végzi, ami a forrás-streamet fogyasztja, minden darabra emit-el és akkumulál, végül a `result`-ot beállítja.

- [ ] **Step 1: Failing test — pipeline négy ága fake stage-ekkel**

`packages/core/src/lib/rag/pipeline.spec.ts`:

```typescript
import { runChat, type ChatDeps } from './pipeline.js';
import type { TraceEvent } from '@plantbase/shared';
import type { SearchResult } from '../knowledge-store.js';

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
    router: async () => ({ route: 'knowledge', reasoning: 'r' }),
    hyde: async () => 'hyde doc',
    retrieve: async () => [chunk(0.6)],
    rerank: async (_q, chunks) => ({ chunks: [...chunks], degraded: false }),
    answer: () => ({
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
    catalogAgent: () => ({ textStream: gen('Katalógus') }),
    groundingThreshold: 0.35,
    onTrace: (e) => events.push(e),
    // a teszt az events-re a záró expecteknél hivatkozik overrides-on át
    ...overrides,
  } as ChatDeps;
}

describe('runChat', () => {
  it('knowledge route (grounded): streams the answer and resolves sources', async () => {
    const events: TraceEvent[] = [];
    const run = await runChat(
      'Hogyan öntözzem a pozsgást?',
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
      'kérdés',
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
      'Mennyi a Kentia?',
      baseDeps({
        router: async () => ({ route: 'catalog', reasoning: 'r' }),
        hyde: async () => {
          hydeCalled = true;
          return 'x';
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
      'Milyen pozsgást vegyek és hogyan gondozzam?',
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
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm nx test @plantbase/core -- pipeline`
Expected: FAIL — `Cannot find module './pipeline.js'`.

- [ ] **Step 3: Implement `rag/pipeline.ts`**

`packages/core/src/lib/rag/pipeline.ts`:

```typescript
// A RAG-pipeline orchestrátora (SP3a fő belépő; ez váltja le az askAgent-et).
// Router dönt az útvonalról, majd az útvonalnak megfelelő stage-eket futtatja.
// A knowledge-út determinisztikus kód-pipeline (HyDE → retrieval → rerank →
// guardrail → answer); a katalógus-út a catalog-agent. A stage-ek egy injektált
// onTrace(event) callbackre emittálnak; csak az answer-stage streamel tokent.
// Minden stage injektálható (teszt), a createDefaultChatDeps a valós wiring.

import {
  noopTrace,
  type ChatRoute,
  type OnTrace,
  type RagAnswer,
  type SourceRef,
} from '@plantbase/shared';
import { loadConfig } from '../config.js';
import { loadRagConfig } from '../config.js';
import {
  runSql as defaultRunSql,
  listCategories as defaultListCategories,
} from '../runsql.js';
import { createRagModels } from './models.js';
import { createRouter, type Router } from './router.js';
import { createHyde, type Hyde } from './hyde.js';
import { createRetrieve, type Retrieve } from './retrieval.js';
import { createRerank, type Rerank } from './rerank.js';
import { checkGrounding, NO_GROUNDING_MESSAGE } from './guardrail.js';
import { createAnswer, type Answer } from './answer.js';
import { createCatalogAgent, type CatalogAgent } from './catalog-agent.js';

/** A pipeline injektálható függőségei (teszthez fake, prod-hoz a default wiring). */
export interface ChatDeps {
  readonly router: Router;
  readonly hyde: Hyde;
  readonly retrieve: Retrieve;
  readonly rerank: Rerank;
  readonly answer: Answer;
  readonly catalogAgent: CatalogAgent;
  readonly groundingThreshold: number;
  readonly onTrace?: OnTrace;
}

/** A futó chat: a token-stream a fogyasztónak + a végleges válasz Promise-ként. */
export interface ChatRun {
  readonly textStream: AsyncIterable<string>;
  readonly result: Promise<RagAnswer>;
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}

/** Egy szöveges streamet teljesen elfogyaszt és összefűz. */
async function drain(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

/**
 * Lefuttatja a RAG-pipeline-t a kérdésre. A visszaadott textStream a válasz
 * tokenjeit adja; a result Promise a teljes szöveggel + forrásokkal resolve-ol.
 */
export async function runChat(
  question: string,
  deps: ChatDeps,
): Promise<ChatRun> {
  const onTrace = deps.onTrace ?? noopTrace;

  const { route, reasoning } = await deps.router(question);
  onTrace({ type: 'router', route, reasoning });

  let resolveResult!: (answer: RagAnswer) => void;
  const result = new Promise<RagAnswer>((resolve) => {
    resolveResult = resolve;
  });

  // A knowledge-oldali kontextus (chunkok) előkészítése, ha kell.
  const needsKnowledge = route === 'knowledge' || route === 'both';
  const needsCatalog = route === 'catalog' || route === 'both';

  // --- Katalógus-kontextus (both esetén szövegként összegyűjtve) ---
  let catalogContext: string | undefined;
  if (route === 'both') {
    const catalogRun = deps.catalogAgent(question);
    catalogContext = await drain(catalogRun.textStream);
  }

  // --- Knowledge-oldal (HyDE → retrieval → rerank → guardrail) ---
  let sources: SourceRef[] = [];
  let answerStream: AsyncIterable<string> | undefined;

  if (needsKnowledge) {
    const hydeDoc = await deps.hyde(question);
    onTrace({ type: 'hyde', hydeDoc });

    const retrieved = await deps.retrieve(hydeDoc);
    const maxRetrieved = retrieved.reduce(
      (m, c) => Math.max(m, c.similarity),
      0,
    );
    onTrace({
      type: 'retrieval',
      topK: retrieved.length,
      resultCount: retrieved.length,
      maxSimilarity: maxRetrieved,
    });

    const reranked = await deps.rerank(question, retrieved);
    onTrace({
      type: 'rerank',
      inputCount: retrieved.length,
      outputCount: reranked.chunks.length,
      degraded: reranked.degraded,
    });

    const grounding = checkGrounding(reranked.chunks, deps.groundingThreshold);
    onTrace({
      type: 'guardrail',
      grounded: grounding.grounded,
      maxSimilarity: grounding.maxSimilarity,
      threshold: deps.groundingThreshold,
    });

    if (!grounding.grounded) {
      // Nincs elég megbízható forrás → canned üzenet, NINCS answer-hívás.
      const stream = tee(single(NO_GROUNDING_MESSAGE), onTrace, (full) =>
        resolveResult({ text: full, route, sources: [] }),
      );
      return { textStream: stream, result };
    }

    const answered = deps.answer({
      question,
      chunks: reranked.chunks,
      catalogContext,
    });
    sources = answered.sources;
    answerStream = answered.textStream;
  } else if (needsCatalog) {
    // Tiszta katalógus-út: a catalog-agent streamje megy tovább, nincs forrás.
    answerStream = deps.catalogAgent(question).textStream;
  }

  if (!answerStream) {
    // Elvi ág: minden route lefedve; védőháló.
    const stream = tee(single(NO_GROUNDING_MESSAGE), onTrace, (full) =>
      resolveResult({ text: full, route, sources: [] }),
    );
    return { textStream: stream, result };
  }

  const finalSources = sources;
  const stream = tee(answerStream, onTrace, (full) =>
    resolveResult({ text: full, route, sources: finalSources }),
  );
  return { textStream: stream, result };
}

/**
 * A válasz-streamet "tee"-zi: minden darabra answer-delta trace-t emit-el és
 * akkumulál; a stream elején answer-start; a végén a done() callbackkel a teljes
 * szöveget átadja (a result Promise beállításához).
 */
async function* tee(
  source: AsyncIterable<string>,
  onTrace: OnTrace,
  done: (full: string) => void,
): AsyncIterable<string> {
  onTrace({ type: 'answer-start' });
  let full = '';
  for await (const part of source) {
    full += part;
    onTrace({ type: 'answer-delta', text: part });
    yield part;
  }
  done(full);
}

/** A valós wiring: modelleket és stage-eket a configból építi. */
export function createDefaultChatDeps(
  overrides: Partial<ChatDeps> = {},
): ChatDeps {
  const agentConfig = loadConfig();
  const ragConfig = loadRagConfig();
  const models = createRagModels(ragConfig, agentConfig.apiKey);
  return {
    router: createRouter({ model: models.router }),
    hyde: createHyde({ model: models.hyde }),
    retrieve: createRetrieve({ topK: ragConfig.topK }),
    rerank: createRerank({ model: models.rerank, topN: ragConfig.rerankTopN }),
    answer: createAnswer({ model: models.answer }),
    catalogAgent: createCatalogAgent({
      model: models.catalog,
      runSql: (q) => defaultRunSql(q),
      listCategories: () => defaultListCategories(),
      maxIterations: ragConfig.maxAgentIterations,
    }),
    groundingThreshold: ragConfig.groundingThreshold,
    ...overrides,
  };
}
```

> **Route lefedettség jegyzet:** a `both` ág a knowledge-blokkon megy át (mert `needsKnowledge` igaz), és a `catalogContext` már ki van számítva előtte — az answer megkapja. Ha a `both` retrieval nem grounded, a canned üzenet megy (a katalógus-kontextus ekkor elveszik; ez elfogadott SP3a-egyszerűsítés, mert a "both" alapvetően tudás-igényű).

- [ ] **Step 4: Run test — verify pipeline passes**

Run: `pnpm nx test @plantbase/core -- pipeline`
Expected: PASS (mind a 4 ág + trace-sorrend).

- [ ] **Step 5: Add rag exports to `core/src/index.ts`**

A `packages/core/src/index.ts`-be add hozzá (a meglévő sorok mellé; az `ask-agent`/`agent-tools` export EGYELŐRE marad):

```typescript
export * from './lib/rag/models.js';
export * from './lib/rag/router.js';
export * from './lib/rag/hyde.js';
export * from './lib/rag/retrieval.js';
export * from './lib/rag/rerank.js';
export * from './lib/rag/guardrail.js';
export * from './lib/rag/answer.js';
export * from './lib/rag/tools.js';
export * from './lib/rag/catalog-agent.js';
export * from './lib/rag/pipeline.js';
```

> **Névütközés-figyelmeztetés:** a `rag/tools.ts` és az `agent-tools.ts` egyaránt exportál `RunSqlFn` és `ListCategoriesFn` típust. A `export *` így ütközne. Ezért ebben a lépésben a `core/src/index.ts`-ben az `agent-tools.js` és `ask-agent.js` re-exportját **kommenteld ki** (a fájlok maradnak, csak nem re-exportáljuk), hogy a build ne törjön:

```typescript
// SP3a: az AI SDK-pipeline váltja le a kézzel írt tool-loopot; a régi export
// kikapcsolva, a fájlok Task 12-ben törlődnek.
// export * from './lib/agent-tools.js';
// export * from './lib/ask-agent.js';
```

- [ ] **Step 6: Typecheck + build + full core test — verify green**

Run: `pnpm nx run-many -t typecheck build test --projects=@plantbase/core`
Expected: PASS. (Az `ask-agent.spec.ts`/`agent-tools.spec.ts` még léteznek és futnak — zöldnek kell lenniük, mert a forrásfájlok még megvannak.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/rag/pipeline.ts packages/core/src/lib/rag/pipeline.spec.ts packages/core/src/index.ts
git commit -m "feat(core): RAG pipeline orchestrator (runChat) + exports"
```

---

### Task 12: CLI migráció `runChat`-re + a régi tool-loop törlése

**Files:**

- Modify: `apps/cli/package.json` (`@plantbase/shared` dependency)
- Create: `apps/cli/src/lib/trace-format.ts`
- Test: `apps/cli/src/lib/trace-format.spec.ts`
- Modify: `apps/cli/src/main.ts`
- Delete: `packages/core/src/lib/ask-agent.ts`, `ask-agent.spec.ts`, `agent-tools.ts`, `agent-tools.spec.ts`
- Modify: `packages/core/src/index.ts` (a kikommentelt sorok végleges törlése)

**Interfaces:**

- Consumes: `runChat`, `createDefaultChatDeps` (core), `TraceEvent` (`@plantbase/shared`).
- Produces: `formatTraceEvent(event: TraceEvent): string | null` — DEBUG engine-trace egy sora (vagy `null`, ha az adott eseményt nem írjuk ki, pl. `answer-delta`).

- [ ] **Step 1: Add `@plantbase/shared` to CLI**

Run: `pnpm --filter @plantbase/cli add @plantbase/shared@workspace:*`
Expected: `apps/cli/package.json` deps-ébe bekerül.

- [ ] **Step 2: Failing test — `formatTraceEvent`**

`apps/cli/src/lib/trace-format.spec.ts`:

```typescript
import { formatTraceEvent } from './trace-format.js';
import type { TraceEvent } from '@plantbase/shared';

describe('formatTraceEvent', () => {
  it('formats a router event', () => {
    const line = formatTraceEvent({
      type: 'router',
      route: 'knowledge',
      reasoning: 'r',
    });
    expect(line).toContain('router');
    expect(line).toContain('knowledge');
  });

  it('formats a guardrail event with similarity and threshold', () => {
    const line = formatTraceEvent({
      type: 'guardrail',
      grounded: false,
      maxSimilarity: 0.21,
      threshold: 0.35,
    });
    expect(line).toContain('guardrail');
    expect(line).toContain('0.21');
    expect(line).toContain('0.35');
  });

  it('suppresses answer-delta events (returns null)', () => {
    expect(formatTraceEvent({ type: 'answer-delta', text: 'x' })).toBeNull();
  });

  it('formats an answer-start event', () => {
    expect(formatTraceEvent({ type: 'answer-start' })).toContain('answer');
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

Run: `pnpm nx test @plantbase/cli -- trace-format`
Expected: FAIL — `Cannot find module './trace-format.js'`.

- [ ] **Step 4: Implement `apps/cli/src/lib/trace-format.ts`**

```typescript
// DEBUG engine-trace formázás a terminálra (SP3a). Egy TraceEvent → egy ember-
// olvasható sor (stderr-re megy, hogy ne keveredjen a válasz stdout-streamjével).
// Az answer-delta eseményeket NEM írjuk ki (a token maga a stdout-streamben jön).

import type { TraceEvent } from '@plantbase/shared';

function fixed(n: number): string {
  return n.toFixed(2);
}

/** Egy trace-esemény ember-olvasható sora, vagy null (ha nem írjuk ki). */
export function formatTraceEvent(event: TraceEvent): string | null {
  switch (event.type) {
    case 'router':
      return `[trace] router → ${event.route} (${event.reasoning})`;
    case 'hyde':
      return `[trace] hyde → ${event.hydeDoc.slice(0, 80)}…`;
    case 'retrieval':
      return `[trace] retrieval → ${event.resultCount} találat (max sim ${fixed(event.maxSimilarity)})`;
    case 'rerank':
      return `[trace] rerank → ${event.inputCount}→${event.outputCount}${event.degraded ? ' (degradált)' : ''}`;
    case 'guardrail':
      return `[trace] guardrail → grounded=${event.grounded} (max sim ${fixed(event.maxSimilarity)}, küszöb ${fixed(event.threshold)})`;
    case 'answer-start':
      return '[trace] answer → generálás…';
    case 'usage':
      return `[trace] usage(${event.stage}) → be ${event.inputTokens} / ki ${event.outputTokens} tok (${event.model})`;
    case 'error':
      return `[trace] error(${event.stage}) → ${event.message}`;
    case 'answer-delta':
      return null;
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

Run: `pnpm nx test @plantbase/cli -- trace-format`
Expected: PASS.

- [ ] **Step 6: Rewrite `apps/cli/src/main.ts` to use `runChat`**

`apps/cli/src/main.ts` (teljes csere):

```typescript
// Plantbase CLI — belépési pont (SP3a: AI SDK-alapú RAG-pipeline, streaming).
// Használat:
//   plantbase ask "<kérdés>"        → egyszeri kérdés, a válasz streamelve
//   plantbase                       → interaktív mód, "exit"/Ctrl+D-ig
//   --show-prompt                   → a router-döntés és a felhasznált forrásokat is kiírja
//   DEBUG=true                      → engine-trace a stderr-en (stage-enként)
// A pipeline a kérdésből eldönti az útvonalat (tudásbázis / katalógus / mindkettő),
// grounded választ ad forráshivatkozással, és NEM hallucinál (guardrail). Minden
// interakció a logs/<timestamp>.jsonl fájlba kerül (FR4).

import {
  closePool,
  closeKnowledgePool,
  createDefaultChatDeps,
  createJsonlLogger,
  loadRagConfig,
  resolveProjectRoot,
  runChat,
  type ChatDeps,
  type InteractionLogger,
} from '@plantbase/core';
import type { OnTrace, RagAnswer, TraceEvent } from '@plantbase/shared';
import { Command } from 'commander';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { isExitCommand } from './lib/echo.js';
import { formatTraceEvent } from './lib/trace-format.js';

/** Naplózó a monorepo gyökér logs/ mappájába. */
function createSessionLogger(): InteractionLogger {
  const logger = createJsonlLogger({ dir: join(resolveProjectRoot(), 'logs') });
  console.error(`Napló: ${logger.filePath}`);
  return logger;
}

/** onTrace, ami naplóz (FR4) és DEBUG esetén a stderr-re formázottan kiír. */
function createTrace(logger: InteractionLogger, debug: boolean): OnTrace {
  return (event: TraceEvent) => {
    logger.event({ type: 'trace', event });
    if (!debug) return;
    const line = formatTraceEvent(event);
    if (line) console.error(line);
  };
}

/** A --show-prompt kimenete: a végleges válasz metaadatai (route + források). */
function printAnswerMeta(answer: RagAnswer): void {
  console.error('----- útvonal -----');
  console.error(answer.route);
  console.error('----- források -----');
  for (const s of answer.sources) {
    console.error(
      `- ${s.title}${s.sourceUrl ? ` (${s.sourceUrl})` : ` (${s.sourcePath})`}`,
    );
  }
  console.error('-------------------');
}

/** Egy kérdés kezelése: streameli a választ a stdout-ra, majd új sor. */
async function handleQuestion(
  question: string,
  showPrompt: boolean,
  deps: ChatDeps,
): Promise<void> {
  const run = await runChat(question, deps);
  for await (const part of run.textStream) {
    process.stdout.write(part);
  }
  process.stdout.write('\n');
  const answer = await run.result;
  if (showPrompt) {
    printAnswerMeta(answer);
  }
}

/** Interaktív mód: soronként kérdez, amíg "exit"-et vagy EOF-et nem kap. */
async function runInteractive(
  showPrompt: boolean,
  deps: ChatDeps,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log(
    'Plantbase — interaktív mód. Kérdezz; kilépés: "exit" vagy Ctrl+D.',
  );
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('> ');
      } catch {
        break;
      }
      if (isExitCommand(line)) break;
      if (line.trim().length === 0) continue;
      await handleQuestion(line, showPrompt, deps);
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('plantbase')
    .description(
      'Plantbase CLI — növény-asszisztens (SP3a: RAG + katalógus, streaming)',
    )
    .version('0.0.1');

  program
    .command('ask [question]', { isDefault: true })
    .description(
      'Kérdés feltevése; kérdés nélkül interaktív mód (kilépés: "exit")',
    )
    .option(
      '--show-prompt',
      'a router-döntés és a felhasznált források kiírása',
    )
    .action(
      async (
        question: string | undefined,
        options: { showPrompt?: boolean },
      ) => {
        const showPrompt = options.showPrompt === true;
        const logger = createSessionLogger();
        const ragConfig = loadRagConfig();
        const deps: ChatDeps = createDefaultChatDeps({
          onTrace: createTrace(logger, ragConfig.debug),
        });
        if (question && question.trim().length > 0) {
          await handleQuestion(question, showPrompt, deps);
          return;
        }
        await runInteractive(showPrompt, deps);
      },
    );

  try {
    await program.parseAsync();
  } finally {
    // A pg poolok nyitva tartanák az event loopot; kilépéshez lezárjuk.
    await closePool();
    await closeKnowledgePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Hiba: ${message}`);
  process.exitCode = 1;
});
```

> **Ellenőrizd az importokat:** `closeKnowledgePool` és `loadRagConfig` már exportáltak a `core`-ból (knowledge-store.ts ill. config.ts). `createDefaultChatDeps`, `runChat`, `ChatDeps` a Task 11 exportjai. `OnTrace`/`RagAnswer`/`TraceEvent` a `@plantbase/shared`-ből.

- [ ] **Step 7: Delete the old tool-loop files + their exports**

Run:

```bash
git rm packages/core/src/lib/ask-agent.ts packages/core/src/lib/ask-agent.spec.ts \
       packages/core/src/lib/agent-tools.ts packages/core/src/lib/agent-tools.spec.ts
```

A `packages/core/src/index.ts`-ből töröld a Task 11-ben kikommentelt két sort (ne kommentként maradjon):

```typescript
// (töröld ezeket a sorokat teljesen)
// export * from './lib/agent-tools.js';
// export * from './lib/ask-agent.js';
```

- [ ] **Step 8: Typecheck + build + test — verify the whole workspace is green**

Run: `pnpm nx run-many -t typecheck build test`
Expected: PASS mindenhol. Ha bármelyik teszt/típus még az `askAgent`/`agent-tools`-ra hivatkozik, az a Task hibája — javítsd (nem szabad több hivatkozásnak lennie a törlés után).

- [ ] **Step 9: Verify end-to-end a CLI-n (valós kulccsal, dry a stream-re)**

> Ez a `verify` skill hatóköre: a változás valódi meghajtása. Feltételezi a kitöltött `.env`-et (ANTHROPIC + OPENAI kulcs) és a feltöltött tudásbázist (SP2 kész: documents 202 / chunks 448).

Run (tudás-kérdés):

```bash
pnpm plantbase:build && DEBUG=true pnpm plantbase ask "Hogyan gondozzam a pozsgásokat?"
```

Expected: a stderr-en `[trace] router → knowledge …`, majd `retrieval`/`rerank`/`guardrail`/`answer` sorok; a stdout-on streamelt magyar válasz forráshivatkozással.

Run (katalógus-kérdés):

```bash
DEBUG=true pnpm plantbase ask "Mennyibe kerül a legolcsóbb pozsgás a katalógusban?"
```

Expected: `[trace] router → catalog …`; a válasz a katalógusból (SQL-en át).

Run (nincs grounding):

```bash
pnpm plantbase ask "Mi Magyarország fővárosa?"
```

Expected: vagy `catalog`/`knowledge` úttól függően a guardrail canned üzenete ("A tudásbázis alapján… nem tudok megbízhatóan válaszolni"), NEM hallucináció.

- [ ] **Step 10: Commit**

```bash
git add apps/cli packages/core/src/index.ts pnpm-lock.yaml
git commit -m "feat(cli): migrate to streaming RAG pipeline; remove manual tool-loop"
```

---

### Task 13: Dokumentáció — `.env.example`, `CLAUDE.md`, roadmap

**Files:**

- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `docs/rag/roadmap.md`

**Interfaces:** nincs kód; dokumentáció-frissítés a design "Dokumentáció" szakasza szerint.

- [ ] **Step 1: `.env.example` — új RAG-kulcsok dokumentált defaultokkal**

A `.env.example` `# --- RAG pipeline ---` szakaszát cseréld/bővítsd:

```bash
# --- RAG pipeline ---
# Az agent-loop (katalógus-agent) felső korlátja (végtelen ciklus ellen).
MAX_AGENT_ITERATIONS="6"
# DEBUG=true esetén a CLI a stderr-re engine-trace-t ír (stage-enként); SP3b/SP4-ben a frontend is ezt kapja.
DEBUG="false"
# Modellkiosztás: olcsó Haiku a router/HyDE/rerank stage-ekhez, Sonnet az answerhez.
RAG_ROUTER_MODEL="claude-haiku-4-5"
RAG_HYDE_MODEL="claude-haiku-4-5"
RAG_RERANK_MODEL="claude-haiku-4-5"
RAG_ANSWER_MODEL="claude-sonnet-4-6"
# Retrieval: hány chunkot ad vissza a vektorkeresés (topK), és a rerank hányat tart meg (topN).
RAG_TOP_K="12"
RAG_RERANK_TOP_N="5"
# Grounding-küszöb: e cosine-similarity ALATT "nincs találat → nem válaszolok" (2026-07-28-i kalibráció: releváns ~0.53–0.69).
RAG_GROUNDING_THRESHOLD="0.35"
```

- [ ] **Step 2: `CLAUDE.md` — invariáns frissítés + rag/ modul + env-kulcsok**

A `CLAUDE.md` "Architekturális invariánsok" első pontját cseréld:

```markdown
- Az agent a **Vercel AI SDK-alapú, hibrid multi-agent RAG-pipeline**-t használ (`packages/core/src/lib/rag/`): felül LLM-router (`generateObject`), a knowledge-út determinisztikus kód-pipeline (HyDE → retrieval → rerank → guardrail → answer), a katalógus-út `streamText` + `stopWhen: stepCountIs`. **Nem** agent-framework és **nem** a régi kézzel írt Anthropic tool-loop (az `ask-agent.ts`/`agent-tools.ts` az SP3a-ban törölve). A modellek `@ai-sdk/anthropic`-on át (Haiku router/HyDE/rerank, Sonnet answer/katalógus).
```

A "Gyakori parancsok" szakaszhoz vedd fel a RAG-releváns env-kulcsokat (a `.env.example`-re hivatkozva) és jelezd, hogy a CLI most streamel + `DEBUG=true` engine-trace-t ad a stderr-re. A "runSql read-only + assertSelectOnly kettős védelem" invariáns **változatlan** — hagyd meg.

> Konkrét szövegjavaslat a parancs-szakasz végére:

```markdown
# CLI (SP3a: RAG-pipeline, streaming). DEBUG=true → engine-trace a stderr-en:

DEBUG=true pnpm plantbase ask "Hogyan gondozzam a pozsgásokat?" # tudás-út (RAG)
pnpm plantbase ask "Mennyibe kerül a legolcsóbb pozsgás?" # katalógus-út (SQL)

# RAG env-kulcsok (modellek, topK, küszöb): lásd .env.example
```

- [ ] **Step 3: `docs/rag/roadmap.md` — SP3 státusz**

A roadmap SP3 szakaszát frissítsd: SP3 kettébontva SP3a (motor+CLI) / SP3b (Express HTTP); SP3a **✅ KÉSZ** (dátum: a merge napja), a hiteles design/plan hivatkozással (`docs/superpowers/specs/2026-07-28-sp3a-rag-pipeline-design.md`, `docs/superpowers/plans/2026-07-28-sp3a-rag-pipeline.md`); SP3b **⏳ KÖVETKEZŐ**. Említsd a bevezetett `packages/shared`-et és hogy a grounding-küszöb `RAG_GROUNDING_THRESHOLD=0.35`.

- [ ] **Step 4: Verify docs build (nincs törött link, a formázás rendben)**

Run: `pnpm nx run-many -t typecheck build test`
Expected: PASS (a doksi nem tör el semmit; ez a lépés a repo zöldjének végső ellenőrzése a PR előtt).

- [ ] **Step 5: Commit**

```bash
git add .env.example CLAUDE.md docs/rag/roadmap.md
git commit -m "docs(rag): SP3a env keys, invariants, and roadmap status"
```

---

## Memory / roadmap frissítés (a PR után)

A `plantbase-rag-roadmap` memória SP3 sorát frissíteni kell: SP3a kész (motor + CLI, streaming, `packages/shared` bevezetve, guardrail-küszöb 0.35), SP3b (Express) a következő. Ez nem kód-lépés, a `main`-be merge után.

---

## Self-Review (a terv ellenőrzése a spec ellen)

**1. Spec-lefedettség:**

- `packages/shared` (engine-trace + chat DTO) → **Task 1** ✅
- `rag/models.ts` (Anthropic + config-modellek) → **Task 2** ✅ (embedding az `embedding.ts`-ben marad — dokumentált, DRY-eltérés a spec szó szerinti "openai embedding is models.ts-ben" megfogalmazásától; indoklás a `models.ts` fejléckommentben)
- `rag/router.ts` → **Task 4** ✅; `rag/hyde.ts` → **Task 5** ✅; `rag/retrieval.ts` → **Task 6** ✅; `rag/rerank.ts` → **Task 7** ✅; `rag/answer.ts` → **Task 9** ✅; `rag/guardrail.ts` → **Task 8** ✅; `rag/catalog-agent.ts` + `rag/tools.ts` → **Task 10** ✅; `rag/pipeline.ts` → **Task 11** ✅
- `searchChunks` + `source_path` → **Task 3** ✅
- Trace onTrace + JSONL log megmarad → **Task 12** (CLI `createTrace` naplóz + DEBUG formáz) ✅
- Streaming (csak answer streamel; stage-ek státusz-trace) → **Task 11** (`tee`, `answer-start`/`answer-delta`) ✅
- Config bővítés + `.env.example` → **Task 2** + **Task 13** ✅
- Hibakezelés (zod boundary; rerank degradál; magyar hibák) → router/rerank zod (Task 4/7), rerank degradál (Task 7), guardrail canned üzenet (Task 8), CLI catch (Task 12) ✅
- Read-only + assertSelectOnly invariáns változatlan → `rag/tools.ts` a meglévő `runSql`-t hívja (Task 10), CLAUDE.md megőrzi (Task 13) ✅
- Tesztek (stage-enként fake, pipeline-integráció 4 ág + trace-sorrend, shared round-trip) → minden task TDD-vel; pipeline Task 11 ✅
- CLI migráció + régi fájlok törlése + CLAUDE.md invariáns update → **Task 12 + 13** ✅
- SP3b/SP4 kizárva (Express, React, contextual re-embed) → egyik task sem érinti ✅

**2. Placeholder-scan:** nincs "TBD"/"add error handling" — minden lépés valós kódot vagy konkrét parancsot tartalmaz. ✅

**3. Típus-konzisztencia:**

- `GenerateObjectFn` egyszer definiálva (router.ts), a rerank onnan importálja ✅
- `SearchResult` a Task 3-ban bővül `source_path`-tal; a `toSourceRefs` (answer.ts) és a retrieval/rerank tesztek mind a bővített alakot használják ✅
- `ChatRoute`/`SourceRef`/`RagAnswer`/`OnTrace`/`TraceEvent` egy helyen (`@plantbase/shared`), core + CLI onnan importál ✅
- `RunSqlFn`/`ListCategoriesFn` az SP3a-ban a `rag/tools.ts`-ben él (az `agent-tools.ts` törlődik); a `core/src/index.ts` névütközését a Task 11 Step 5 kezeli (régi export kikapcsolva), a Task 12 véglegesen törli ✅
- `stepCountIs` az `ai@7.0.37`-ben létező export (az `isStepCount` aliasa) — igazolva ✅
- `ChatDeps` mezőnevei (`router`/`hyde`/`retrieve`/`rerank`/`answer`/`catalogAgent`/`groundingThreshold`/`onTrace`) a pipeline.spec és a `createDefaultChatDeps` közt egyeznek ✅
