# RAG Foundations (pgvector + knowledge schema + provider config) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data + configuration foundation of the multi-agent RAG system: pgvector infrastructure, the `documents` / `document_chunks` schema, and the composable provider/config + embedding + knowledge-store layer in `packages/core`.

**Architecture:** Prisma owns schema/migration/seed for two new tables; the `embedding` column, `vector` extension, and HNSW cosine index are managed via the Prisma migration (extension) plus a hand-appended index SQL. Runtime vector access is done through `pg` (not Prisma), following the existing `runsql.ts` pattern — writes on the RW connection (rag-builder), searches on the RO connection. Config is split into composable loaders so the existing CLI keeps running without an OpenAI key. Embedding runs on the Vercel AI SDK (`embedMany`) with OpenAI `text-embedding-3-small`.

**Tech Stack:** Nx + pnpm monorepo, TypeScript (strict, ESM), Prisma 6 + PostgreSQL 17 + pgvector, `pg`, Vercel AI SDK (`ai`) + `@ai-sdk/openai`, zod, Vitest.

## Global Constraints

- TypeScript strict; ESM — every relative import specifier ends in `.js`.
- File names `kebab-case`; `interface` for object shapes; string-literal unions instead of enums; immutability (`readonly`).
- Validate all external/untrusted input (env, tool input, LLM output) with **zod** at the boundary; never `any`.
- No `console.log` in product/library code (the CLI stdout is intentional and out of scope here).
- Tests: Vitest, dependency-injected fakes — **no network, no live DB** (see `runsql.spec.ts`, `config.spec.ts`).
- pgvector invariant: **Prisma = schema/migration/seed only; runtime vector search via `pg`** on the read-only connection; writes on the RW connection.
- Read library docs with **Context7** before using an unfamiliar API (Prisma pgvector, `ai` embeddings, `pg`).
- Commits in **English**, Conventional Commits, small focused commits. Work on branch `feat/rag-foundations` (already created). `main` stays green.
- Embedding dimension is fixed at **1536** (`text-embedding-3-small`).
- Run the core test suite once (non-watch) with: `pnpm nx test-ci @plantbase/core`.

---

## File Structure

**`packages/db`**

- Modify `prisma/schema.prisma` — enable `postgresqlExtensions` + `vector` extension; add `Document` and `DocumentChunk` models.
- Create `prisma/migrations/<ts>_add_knowledge_base/migration.sql` — via `--create-only`, then hand-append the HNSW index.

**`packages/core/src/lib`**

- Modify `config.ts` — add `loadEmbeddingConfig()` and `loadRagConfig()` (keep `loadConfig()` unchanged).
- Modify `config.spec.ts` — tests for the two new loaders.
- Create `embedding.ts` — `embedTexts()` / `embedQuery()` over `embedMany`, with an injectable embed function.
- Create `embedding.spec.ts` — injected fake, no network.
- Create `knowledge-store.ts` — `pg`-based `upsertDocument`, `replaceChunks`, `upsertDocumentWithChunks`, `searchChunks`, `getChunkStats`, `toVectorLiteral`, `assertEmbeddingDim`.
- Create `knowledge-store.spec.ts` — injected fake `Queryable`, no DB.
- Modify `index.ts` — export the two new modules.

**Root / infra**

- Modify `docker-compose.yml` — image → `pgvector/pgvector:pg17`.
- Create `docker/initdb/02-vector-extension.sql`.
- Modify `.env.example`, `CONTEXT.md`, `CLAUDE.md`.

---

## Task 1: pgvector infrastructure (docker image + init extension)

**Files:**

- Modify: `docker-compose.yml` (the `image:` line)
- Create: `docker/initdb/02-vector-extension.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: a Postgres 17 container with the `vector` extension available; a fresh volume auto-creates the extension.

- [ ] **Step 1: Switch the Postgres image to the pgvector build**

In `docker-compose.yml`, change the image line under `services.postgres`:

```yaml
image: pgvector/pgvector:pg17
```

(Everything else — env, ports `5433:5432`, volume `plantbase-pgdata`, initdb mount, healthcheck — stays as-is. `pgvector/pgvector:pg17` is the official Postgres 17 image with the extension preinstalled, so the existing data volume remains compatible.)

- [ ] **Step 2: Add the fresh-volume extension init script**

Create `docker/initdb/02-vector-extension.sql`:

```sql
-- Plantbase — pgvector kiterjesztés engedélyezése (RAG alapok, SP1).
-- Ez a szkript az /docker-entrypoint-initdb.d/-ből fut, a POSTGRES_USER (plantbase,
-- owner/superuser) jogával, CSAK az első (üres volume-os) konténer-indításkor.
-- Meglévő volume esetén a knowledge-migráció (Prisma) hozza létre ugyanezt (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 3: Recreate the container and verify the extension is installable**

Run:

```bash
docker compose down && docker compose up -d
# wait for healthy, then:
docker exec plantbase-postgres psql -U plantbase -d plantbase -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

Expected: a version string (e.g. `0.8.0`) is printed — the extension exists.

> Note: if you have an existing `plantbase-pgdata` volume you want to keep, you may skip `down`; the extension still gets created by the migration in Task 2. This step just proves the image is correct.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker/initdb/02-vector-extension.sql
git commit -m "feat(infra): use pgvector image and enable vector extension"
```

---

## Task 2: knowledge base schema + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_knowledge_base/migration.sql` (generated, then hand-edited)

**Interfaces:**

- Consumes: the running pgvector DB from Task 1; `DATABASE_URL` from the root `.env`.
- Produces: tables `documents` and `document_chunks` (with `embedding vector(1536)` + HNSW cosine index), readable by `plantbase_ro`.

- [ ] **Step 1: Extend the Prisma schema**

In `packages/db/prisma/schema.prisma`, add the two models. The `embedding` field is `Unsupported("vector(1536)")?` — Prisma never reads it (we use `pg`), and keeping it optional avoids migration drift.

> **Do NOT let Prisma manage the `vector` extension.** Leave the `generator` and `datasource` blocks unchanged (no `postgresqlExtensions` preview feature, no `extensions = [vector]`). The extension already exists in the DB (created out-of-band by Task 1's initdb / manual `CREATE EXTENSION`), and declaring `extensions = [vector]` makes `prisma migrate dev` report **drift** whose only offered remedy is the destructive `migrate reset`. Instead, the `CREATE EXTENSION` statement is added by hand to the migration in Step 3. `Unsupported("vector(1536)")` does not require the extension to be declared in the schema.

Add below the existing `Product` model:

```prisma
model Document {
  id           Int             @id @default(autoincrement())
  source_path  String          @unique
  title        String
  source_url   String?
  category     String
  content_hash String
  char_count   Int
  created_at   DateTime        @default(now()) @db.Timestamptz(6)
  updated_at   DateTime        @default(now()) @db.Timestamptz(6)
  chunks       DocumentChunk[]

  @@map("documents")
}

model DocumentChunk {
  id           Int                          @id @default(autoincrement())
  document_id  Int
  chunk_index  Int
  content      String
  heading_path String?
  token_count  Int?
  embedding    Unsupported("vector(1536)")?
  created_at   DateTime                     @default(now()) @db.Timestamptz(6)
  document     Document                     @relation(fields: [document_id], references: [id], onDelete: Cascade)

  @@unique([document_id, chunk_index])
  @@map("document_chunks")
}
```

- [ ] **Step 2: Generate the migration (create-only) so it can be hand-edited**

Run (from repo root, with the root `.env` loaded — the `db` package reads `DATABASE_URL`):

```bash
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate dev --create-only --name add_knowledge_base --schema=prisma/schema.prisma
```

Expected: a new folder `prisma/migrations/<timestamp>_add_knowledge_base/migration.sql` is created. It contains `CREATE TABLE "documents"`, `CREATE TABLE "document_chunks"` (including `"embedding" vector(1536)`), the unique index, and the FK. It will **not** contain a `CREATE EXTENSION` line (the extension is not Prisma-managed) — that is added by hand in Step 3.

- [ ] **Step 3: Hand-edit the migration — prepend the extension, append the HNSW index**

Edit the generated `migration.sql`. Add this as the very FIRST statement (before the `CREATE TABLE`s), so the `vector(1536)` column type resolves on a fresh database / shadow DB:

```sql
-- pgvector kiterjesztés (idempotens; a shadow DB-n és friss DB-n is szükséges a vector típushoz).
CREATE EXTENSION IF NOT EXISTS "vector";
```

And add this at the END of the file:

```sql
-- pgvector HNSW index koszinusz-távolságra (a keresés `<=>`-t használ).
CREATE INDEX "document_chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
```

- [ ] **Step 4: Apply the migration**

Run:

```bash
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate dev --schema=prisma/schema.prisma
```

Expected: the migration applies with no errors; Prisma Client regenerates.

- [ ] **Step 5: Verify tables, index, and read-only access**

Run:

```bash
docker exec plantbase-postgres psql -U plantbase -d plantbase -c "\d document_chunks"
docker exec plantbase-postgres psql -U plantbase -d plantbase -c "SELECT indexname FROM pg_indexes WHERE tablename='document_chunks';"
docker exec plantbase-postgres psql -U plantbase_ro -d plantbase -c "SELECT count(*) FROM document_chunks;"
```

Expected: `document_chunks` shows an `embedding` column of type `vector(1536)`; the HNSW index `document_chunks_embedding_hnsw_idx` is listed; the `plantbase_ro` SELECT returns `0` (readable — default privileges grant worked).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add documents and document_chunks schema with pgvector HNSW index"
```

---

## Task 3: composable config loaders

**Files:**

- Modify: `packages/core/src/lib/config.ts`
- Test: `packages/core/src/lib/config.spec.ts`

**Interfaces:**

- Consumes: `loadDotenvFromNearest` (already private in `config.ts`), zod.
- Produces:
  - `interface EmbeddingConfig { readonly apiKey: string; readonly model: string; readonly dimension: 1536 }`
  - `interface RagConfig { readonly maxAgentIterations: number; readonly debug: boolean }`
  - `function loadEmbeddingConfig(cwd?: string): EmbeddingConfig`
  - `function loadRagConfig(cwd?: string): RagConfig`
  - `loadConfig` remains unchanged (Anthropic-only).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/lib/config.spec.ts` (keep the existing `loadConfig` block and the `afterEach` env-restore pattern; add these two describe blocks):

```typescript
import { loadEmbeddingConfig, loadRagConfig } from './config.js';

describe('loadEmbeddingConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('should return the OpenAI key, default model, and fixed dimension', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    delete process.env.OPENAI_EMBEDDING_MODEL;
    const config = loadEmbeddingConfig('/');
    expect(config.apiKey).toBe('sk-openai-123');
    expect(config.model).toBe('text-embedding-3-small');
    expect(config.dimension).toBe(1536);
  });

  it('should honor a custom OPENAI_EMBEDDING_MODEL', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
    expect(loadEmbeddingConfig('/').model).toBe('text-embedding-3-large');
  });

  it('should throw when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadEmbeddingConfig('/')).toThrow(/OPENAI_API_KEY/);
  });
});

describe('loadRagConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('should default maxAgentIterations to 6 and debug to false', () => {
    delete process.env.MAX_AGENT_ITERATIONS;
    delete process.env.DEBUG;
    const config = loadRagConfig('/');
    expect(config.maxAgentIterations).toBe(6);
    expect(config.debug).toBe(false);
  });

  it('should parse MAX_AGENT_ITERATIONS as a number and DEBUG=true as boolean', () => {
    process.env.MAX_AGENT_ITERATIONS = '10';
    process.env.DEBUG = 'true';
    const config = loadRagConfig('/');
    expect(config.maxAgentIterations).toBe(10);
    expect(config.debug).toBe(true);
  });

  it('should reject a non-positive MAX_AGENT_ITERATIONS', () => {
    process.env.MAX_AGENT_ITERATIONS = '0';
    expect(() => loadRagConfig('/')).toThrow(/MAX_AGENT_ITERATIONS/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test-ci @plantbase/core`
Expected: FAIL — `loadEmbeddingConfig` / `loadRagConfig` are not exported.

- [ ] **Step 3: Implement the two loaders**

In `packages/core/src/lib/config.ts`, add after the existing `loadConfig`. Reuse the existing private `loadDotenvFromNearest`:

```typescript
/** Embedding-provider konfiguráció (OpenAI). Csak ott töltjük be, ahol embedding kell,
 *  így a CLI OpenAI-kulcs nélkül is fut. */
export interface EmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dimension: 1536;
}

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536 as const;

const embeddingEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY hiányzik vagy üres.'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).optional(),
});

/**
 * Betölti (find-up .env) és validálja az embedding-konfigurációt.
 * @throws {Error} ha az OPENAI_API_KEY hiányzik.
 */
export function loadEmbeddingConfig(
  cwd: string = process.cwd(),
): EmbeddingConfig {
  loadDotenvFromNearest(cwd);
  const result = embeddingEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás embedding-konfiguráció: ${issues}`);
  }
  return {
    apiKey: result.data.OPENAI_API_KEY,
    model: result.data.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
  };
}

/** A RAG-pipeline futásidejű konfigurációja (agent-loop korlát, debug). */
export interface RagConfig {
  readonly maxAgentIterations: number;
  readonly debug: boolean;
}

const DEFAULT_MAX_AGENT_ITERATIONS = 6;

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
});

/**
 * Betölti (find-up .env) és validálja a RAG futásidejű konfigurációt.
 * @throws {Error} ha valamelyik érték érvénytelen.
 */
export function loadRagConfig(cwd: string = process.cwd()): RagConfig {
  loadDotenvFromNearest(cwd);
  const result = ragEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás RAG-konfiguráció: ${issues}`);
  }
  return {
    maxAgentIterations:
      result.data.MAX_AGENT_ITERATIONS ?? DEFAULT_MAX_AGENT_ITERATIONS,
    debug: result.data.DEBUG ?? false,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test-ci @plantbase/core`
Expected: PASS (all config tests, including the original `loadConfig` ones).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/config.ts packages/core/src/lib/config.spec.ts
git commit -m "feat(core): add composable embedding and rag config loaders"
```

---

## Task 4: embedding module

**Files:**

- Create: `packages/core/src/lib/embedding.ts`
- Test: `packages/core/src/lib/embedding.spec.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (add deps)

**Interfaces:**

- Consumes: `loadEmbeddingConfig`, `EmbeddingConfig` (Task 3); `embedMany` from `ai`; `openai` from `@ai-sdk/openai`.
- Produces:
  - `type EmbedManyFn = (values: readonly string[]) => Promise<number[][]>`
  - `interface EmbedOptions { readonly config?: EmbeddingConfig; readonly embedMany?: EmbedManyFn }`
  - `function embedTexts(values: readonly string[], options?: EmbedOptions): Promise<number[][]>`
  - `function embedQuery(text: string, options?: EmbedOptions): Promise<number[]>`

- [ ] **Step 1: Add the dependencies**

Run:

```bash
pnpm --filter @plantbase/core add ai @ai-sdk/openai
```

Then verify the embedding entry points exist in the installed versions (Context7 / node): `embedMany` is exported from `ai`, and the OpenAI provider exposes a text-embedding model factory. If the installed `@ai-sdk/openai` uses `openai.textEmbeddingModel(id)` instead of `openai.embedding(id)`, use whichever the installed version documents in Step 3's `defaultEmbedMany`.

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/lib/embedding.spec.ts` (injected fake — no network):

```typescript
import { embedTexts, embedQuery } from './embedding.js';

describe('embedTexts', () => {
  it('should return an empty array without calling the model for empty input', async () => {
    let called = false;
    const result = await embedTexts([], {
      embedMany: async (values) => {
        called = true;
        return values.map(() => [0]);
      },
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('should pass values through to the injected embedder and return its vectors', async () => {
    const received: string[][] = [];
    const result = await embedTexts(['a', 'b'], {
      embedMany: async (values) => {
        received.push([...values]);
        return values.map((_, i) => [i, i + 1]);
      },
    });
    expect(received).toEqual([['a', 'b']]);
    expect(result).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

describe('embedQuery', () => {
  it('should embed a single string and return the first vector', async () => {
    const result = await embedQuery('hello', {
      embedMany: async (values) => values.map(() => [9, 8, 7]),
    });
    expect(result).toEqual([9, 8, 7]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx test-ci @plantbase/core`
Expected: FAIL — `./embedding.js` does not exist.

- [ ] **Step 4: Implement the module**

Create `packages/core/src/lib/embedding.ts`:

```typescript
// Embedding-réteg (RAG alapok, SP1). A Vercel AI SDK `embedMany` fölött, OpenAI
// text-embedding-3-small modellel. Az alacsony szintű embedMany injektálható
// (teszthez determinisztikus fake), a meglévő DI-minta szerint (vö. runsql.ts).

import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { loadEmbeddingConfig, type EmbeddingConfig } from './config.js';

/** Alacsony szintű embedder: sztringek → vektorok, azonos sorrendben. */
export type EmbedManyFn = (values: readonly string[]) => Promise<number[][]>;

export interface EmbedOptions {
  /** Embedding-konfiguráció; ha hiányzik, a process.env-ből töltjük. */
  readonly config?: EmbeddingConfig;
  /** Injektálható embedder; alapból a valódi OpenAI embedMany. */
  readonly embedMany?: EmbedManyFn;
}

/** A valódi (OpenAI) embedder előállítása a konfigurációból. */
function defaultEmbedMany(config?: EmbeddingConfig): EmbedManyFn {
  return async (values) => {
    const cfg = config ?? loadEmbeddingConfig();
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(cfg.model),
      values: [...values],
    });
    return embeddings;
  };
}

/**
 * Beágyazza a megadott szövegeket. Üres bemenetre üres tömböt ad, a modell hívása nélkül.
 * @throws {Error} ha nincs embedding-konfiguráció, vagy a provider hibázik.
 */
export async function embedTexts(
  values: readonly string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (values.length === 0) {
    return [];
  }
  const run = options.embedMany ?? defaultEmbedMany(options.config);
  return run(values);
}

/**
 * Egyetlen lekérdezés-szöveg beágyazása (a HyDE/vektorkeresés query-oldala).
 * @throws {Error} ha nincs embedding-konfiguráció, vagy a provider hibázik.
 */
export async function embedQuery(
  text: string,
  options: EmbedOptions = {},
): Promise<number[]> {
  const [embedding] = await embedTexts([text], options);
  return embedding;
}
```

- [ ] **Step 5: Export from the package index**

In `packages/core/src/index.ts`, add:

```typescript
export * from './lib/embedding.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm nx test-ci @plantbase/core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/embedding.ts packages/core/src/lib/embedding.spec.ts packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add embedding module over Vercel AI SDK (OpenAI)"
```

---

## Task 5: knowledge-store (pg data access)

**Files:**

- Create: `packages/core/src/lib/knowledge-store.ts`
- Test: `packages/core/src/lib/knowledge-store.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `pg` (already a core dependency); `EMBEDDING_DIMENSION` concept (1536).
- Produces:
  - `interface Queryable { query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }`
  - `interface DocumentInput { readonly source_path: string; readonly title: string; readonly source_url: string | null; readonly category: string; readonly content_hash: string; readonly char_count: number }`
  - `interface ChunkInput { readonly chunk_index: number; readonly content: string; readonly heading_path: string | null; readonly token_count: number | null; readonly embedding: readonly number[] }`
  - `interface SearchResult { readonly chunk_id: number; readonly document_id: number; readonly content: string; readonly heading_path: string | null; readonly title: string; readonly source_url: string | null; readonly similarity: number }`
  - `interface ChunkStats { readonly document_count: number; readonly chunk_count: number; readonly embedded_chunk_count: number; readonly avg_chunk_chars: number; readonly min_chunk_chars: number; readonly max_chunk_chars: number }`
  - `function toVectorLiteral(embedding: readonly number[]): string`
  - `function assertEmbeddingDim(embedding: readonly number[], dimension?: number): void`
  - `function upsertDocument(client: Queryable, doc: DocumentInput): Promise<number>`
  - `function replaceChunks(client: Queryable, documentId: number, chunks: readonly ChunkInput[]): Promise<number>`
  - `function upsertDocumentWithChunks(doc: DocumentInput, chunks: readonly ChunkInput[], options?: { readonly connectionString?: string; readonly client?: Queryable }): Promise<{ documentId: number; chunkCount: number }>`
  - `function searchChunks(queryEmbedding: readonly number[], k: number, options?: { readonly connectionString?: string; readonly client?: Queryable }): Promise<SearchResult[]>`
  - `function getChunkStats(options?: { readonly connectionString?: string; readonly client?: Queryable }): Promise<ChunkStats>`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/lib/knowledge-store.spec.ts`. A fake `Queryable` records calls and returns canned rows (no DB):

```typescript
import {
  toVectorLiteral,
  assertEmbeddingDim,
  upsertDocument,
  replaceChunks,
  searchChunks,
  getChunkStats,
  type Queryable,
} from './knowledge-store.js';

interface Call {
  text: string;
  params: readonly unknown[];
}

/** Fake pg kliens: rögzíti a hívásokat, a RETURNING-re kanonikus sort ad vissza. */
function fakeClient(
  responder: (text: string) => Record<string, unknown>[] = () => [],
): { client: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const client: Queryable = {
    async query(text, params = []) {
      calls.push({ text, params });
      return { rows: responder(text) };
    },
  };
  return { client, calls };
}

describe('toVectorLiteral', () => {
  it('should format numbers as a pgvector bracket literal', () => {
    expect(toVectorLiteral([0.1, 0.2, -3])).toBe('[0.1,0.2,-3]');
  });
});

describe('assertEmbeddingDim', () => {
  it('should throw on a dimension mismatch', () => {
    expect(() => assertEmbeddingDim([1, 2, 3], 1536)).toThrow(/1536/);
  });
  it('should accept a matching dimension', () => {
    expect(() => assertEmbeddingDim(new Array(4).fill(0), 4)).not.toThrow();
  });
});

describe('upsertDocument', () => {
  it('should upsert on source_path and return the document id', async () => {
    const { client, calls } = fakeClient((text) =>
      text.includes('INSERT INTO documents') ? [{ id: 42 }] : [],
    );
    const id = await upsertDocument(client, {
      source_path: 'plants-101__snake.md',
      title: 'Snake',
      source_url: 'https://x/y',
      category: 'plants-101',
      content_hash: 'abc',
      char_count: 100,
    });
    expect(id).toBe(42);
    expect(calls[0].text).toMatch(/INSERT INTO documents/);
    expect(calls[0].text).toMatch(/ON CONFLICT \("?source_path"?\)/);
    expect(calls[0].params).toEqual([
      'plants-101__snake.md',
      'Snake',
      'https://x/y',
      'plants-101',
      'abc',
      100,
    ]);
  });
});

describe('replaceChunks', () => {
  it('should delete old chunks then insert each new chunk with a vector param', async () => {
    const { client, calls } = fakeClient();
    const count = await replaceChunks(client, 42, [
      {
        chunk_index: 0,
        content: 'hello',
        heading_path: 'H1',
        token_count: 2,
        embedding: [0.1, 0.2],
      },
    ]);
    expect(count).toBe(1);
    expect(calls[0].text).toMatch(/DELETE FROM document_chunks/);
    expect(calls[0].params).toEqual([42]);
    expect(calls[1].text).toMatch(/INSERT INTO document_chunks/);
    expect(calls[1].params).toEqual([42, 0, 'hello', 'H1', 2, '[0.1,0.2]']);
  });
});

describe('searchChunks', () => {
  it('should order by cosine distance, select similarity, and pass [vector, k]', async () => {
    const { client, calls } = fakeClient(() => [
      {
        chunk_id: 1,
        document_id: 7,
        content: 'c',
        heading_path: null,
        title: 't',
        source_url: null,
        similarity: 0.83,
      },
    ]);
    const results = await searchChunks([0.1, 0.2], 5, { client });
    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBe(0.83);
    expect(calls[0].text).toMatch(/1 - \(.*embedding.*<=>.*\)/);
    expect(calls[0].text).toMatch(/ORDER BY.*embedding.*<=>/);
    expect(calls[0].params).toEqual(['[0.1,0.2]', 5]);
  });
});

describe('getChunkStats', () => {
  it('should return the stats row coerced to numbers', async () => {
    const { client } = fakeClient(() => [
      {
        document_count: '2',
        chunk_count: '10',
        embedded_chunk_count: '10',
        avg_chunk_chars: '512.5',
        min_chunk_chars: '100',
        max_chunk_chars: '900',
      },
    ]);
    const stats = await getChunkStats({ client });
    expect(stats.document_count).toBe(2);
    expect(stats.chunk_count).toBe(10);
    expect(stats.avg_chunk_chars).toBeCloseTo(512.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test-ci @plantbase/core`
Expected: FAIL — `./knowledge-store.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/lib/knowledge-store.ts`:

```typescript
// Knowledge-store (RAG alapok, SP1): pg-alapú adat-hozzáférés a documents /
// document_chunks táblákhoz. A runsql.ts pool-mintáját követi: paraméteres
// connectionString, megosztott pool, injektálható kliens teszthez.
// Írás (upsert) az RW kapcsolaton (rag-builder); keresés/statisztika az RO-n.
// A vektorkeresés SZÁNDÉKOSAN pg-n megy, nem Prisma-n (architektúra-invariáns).

import pg from 'pg';

const { Pool } = pg;
const EMBEDDING_DIMENSION = 1536;

/** A pg-kliens minimális felülete (Pool és PoolClient is teljesíti); teszthez fake-elhető. */
export interface Queryable {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface DocumentInput {
  readonly source_path: string;
  readonly title: string;
  readonly source_url: string | null;
  readonly category: string;
  readonly content_hash: string;
  readonly char_count: number;
}

export interface ChunkInput {
  readonly chunk_index: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly token_count: number | null;
  readonly embedding: readonly number[];
}

export interface SearchResult {
  readonly chunk_id: number;
  readonly document_id: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly title: string;
  readonly source_url: string | null;
  readonly similarity: number;
}

export interface ChunkStats {
  readonly document_count: number;
  readonly chunk_count: number;
  readonly embedded_chunk_count: number;
  readonly avg_chunk_chars: number;
  readonly min_chunk_chars: number;
  readonly max_chunk_chars: number;
}

/** number[] → pgvector literál (`[0.1,0.2,...]`). */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/** Ellenőrzi az embedding dimenzióját. @throws {Error} eltérés esetén. */
export function assertEmbeddingDim(
  embedding: readonly number[],
  dimension: number = EMBEDDING_DIMENSION,
): void {
  if (embedding.length !== dimension) {
    throw new Error(
      `Embedding dimenzió-hiba: ${embedding.length} (elvárt: ${dimension}).`,
    );
  }
}

const UPSERT_DOCUMENT_SQL = `INSERT INTO documents
  (source_path, title, source_url, category, content_hash, char_count, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (source_path) DO UPDATE SET
  title = EXCLUDED.title,
  source_url = EXCLUDED.source_url,
  category = EXCLUDED.category,
  content_hash = EXCLUDED.content_hash,
  char_count = EXCLUDED.char_count,
  updated_at = now()
RETURNING id`;

/** Upsert egy dokumentumra (source_path kulcs), a document id-t adja vissza. */
export async function upsertDocument(
  client: Queryable,
  doc: DocumentInput,
): Promise<number> {
  const { rows } = await client.query(UPSERT_DOCUMENT_SQL, [
    doc.source_path,
    doc.title,
    doc.source_url,
    doc.category,
    doc.content_hash,
    doc.char_count,
  ]);
  return Number(rows[0].id);
}

const DELETE_CHUNKS_SQL = `DELETE FROM document_chunks WHERE document_id = $1`;
const INSERT_CHUNK_SQL = `INSERT INTO document_chunks
  (document_id, chunk_index, content, heading_path, token_count, embedding)
VALUES ($1, $2, $3, $4, $5, $6::vector)`;

/** A dokumentum összes chunkját lecseréli az újakra (idempotens rebuild). */
export async function replaceChunks(
  client: Queryable,
  documentId: number,
  chunks: readonly ChunkInput[],
): Promise<number> {
  await client.query(DELETE_CHUNKS_SQL, [documentId]);
  for (const chunk of chunks) {
    assertEmbeddingDim(chunk.embedding);
    await client.query(INSERT_CHUNK_SQL, [
      documentId,
      chunk.chunk_index,
      chunk.content,
      chunk.heading_path,
      chunk.token_count,
      toVectorLiteral(chunk.embedding),
    ]);
  }
  return chunks.length;
}

let sharedPool: pg.Pool | undefined;

function getPool(connectionString: string): pg.Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString });
  }
  return sharedPool;
}

/** A megosztott pool lezárása (teszt/CLI leállításkor). */
export async function closeKnowledgePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}

function resolveConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL nincs beállítva (knowledge-store írás).');
  }
  return connectionString;
}

function resolveReadConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL_READONLY;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_READONLY nincs beállítva (knowledge-store keresés).',
    );
  }
  return connectionString;
}

export interface WriteOptions {
  /** RW kapcsolat; alapból DATABASE_URL. */
  readonly connectionString?: string;
  /** Injektálható kliens teszthez; ilyenkor NEM nyitunk tranzakciót. */
  readonly client?: Queryable;
}

/** Egy dokumentum + chunkjai atomikus upsertje (tranzakcióban). */
export async function upsertDocumentWithChunks(
  doc: DocumentInput,
  chunks: readonly ChunkInput[],
  options: WriteOptions = {},
): Promise<{ documentId: number; chunkCount: number }> {
  if (options.client) {
    const documentId = await upsertDocument(options.client, doc);
    const chunkCount = await replaceChunks(options.client, documentId, chunks);
    return { documentId, chunkCount };
  }
  const pool = getPool(resolveConnectionString(options.connectionString));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const documentId = await upsertDocument(client, doc);
    const chunkCount = await replaceChunks(client, documentId, chunks);
    await client.query('COMMIT');
    return { documentId, chunkCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SEARCH_SQL = `SELECT
  dc.id AS chunk_id,
  dc.document_id,
  dc.content,
  dc.heading_path,
  d.title,
  d.source_url,
  1 - (dc.embedding <=> $1::vector) AS similarity
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
ORDER BY dc.embedding <=> $1::vector
LIMIT $2`;

export interface ReadOptions {
  /** RO kapcsolat; alapból DATABASE_URL_READONLY. */
  readonly connectionString?: string;
  /** Injektálható kliens teszthez. */
  readonly client?: Queryable;
}

/** Koszinusz-hasonlóság szerinti top-k chunk (RO). */
export async function searchChunks(
  queryEmbedding: readonly number[],
  k: number,
  options: ReadOptions = {},
): Promise<SearchResult[]> {
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(SEARCH_SQL, [
    toVectorLiteral(queryEmbedding),
    k,
  ]);
  return rows.map((row) => ({
    chunk_id: Number(row.chunk_id),
    document_id: Number(row.document_id),
    content: String(row.content),
    heading_path: row.heading_path === null ? null : String(row.heading_path),
    title: String(row.title),
    source_url: row.source_url === null ? null : String(row.source_url),
    similarity: Number(row.similarity),
  }));
}

const STATS_SQL = `SELECT
  (SELECT count(*) FROM documents) AS document_count,
  (SELECT count(*) FROM document_chunks) AS chunk_count,
  (SELECT count(*) FROM document_chunks WHERE embedding IS NOT NULL) AS embedded_chunk_count,
  (SELECT coalesce(avg(char_length(content)), 0) FROM document_chunks) AS avg_chunk_chars,
  (SELECT coalesce(min(char_length(content)), 0) FROM document_chunks) AS min_chunk_chars,
  (SELECT coalesce(max(char_length(content)), 0) FROM document_chunks) AS max_chunk_chars`;

/** Chunk-statisztika a debug-endpointhoz (RO). */
export async function getChunkStats(
  options: ReadOptions = {},
): Promise<ChunkStats> {
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(STATS_SQL, []);
  const row = rows[0];
  return {
    document_count: Number(row.document_count),
    chunk_count: Number(row.chunk_count),
    embedded_chunk_count: Number(row.embedded_chunk_count),
    avg_chunk_chars: Number(row.avg_chunk_chars),
    min_chunk_chars: Number(row.min_chunk_chars),
    max_chunk_chars: Number(row.max_chunk_chars),
  };
}
```

- [ ] **Step 4: Export from the package index**

In `packages/core/src/index.ts`, add:

```typescript
export * from './lib/knowledge-store.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx test-ci @plantbase/core`
Expected: PASS.

- [ ] **Step 6: Typecheck the core package**

Run: `pnpm nx typecheck @plantbase/core`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/knowledge-store.ts packages/core/src/lib/knowledge-store.spec.ts packages/core/src/index.ts
git commit -m "feat(core): add pgvector knowledge-store (upsert, search, stats)"
```

---

## Task 6: env + documentation

**Files:**

- Modify: `.env.example`
- Modify: `CONTEXT.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: nothing.
- Produces: documented env vars and domain language for the knowledge base.

- [ ] **Step 1: Extend `.env.example`**

Add to `.env.example` (after the Anthropic block):

```bash
# --- OpenAI (kizárólag embedding — text-embedding-3-small, 1536 dim) ---
OPENAI_API_KEY="sk-..."
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"

# --- RAG pipeline ---
# Az agent-loop felső korlátja (végtelen ciklus ellen).
MAX_AGENT_ITERATIONS="6"
# DEBUG=true esetén a frontend engine-trace-t kap (később, SP3/SP4).
DEBUG="false"
```

- [ ] **Step 2: Add knowledge-domain language to `CONTEXT.md`**

Append a new subsection under the `## Language` section of `CONTEXT.md`:

```markdown
**Tudásbázis (Knowledge base)**:
A `seed/knowledge` növénygondozási cikkeinek beágyazott, kereshető változata. Két táblában él: `documents` (forrás-cikkenként egy sor) és `document_chunks` (chunkonként egy sor, embeddinggel).
_Avoid_: katalógus (az a `products`), dokumentum-adatbázis

**Dokumentum (Document)**:
Egy forrás-markdown cikk a tudásbázisban (`documents` egy sora): cím, forrás-URL, kategória, tartalom-hash.
_Avoid_: cikk, fájl (a domain-entitás neve Dokumentum)

**Chunk**:
Egy Dokumentum retrieval-egységre bontott darabja (`document_chunks` egy sora): szöveg + heading-útvonal + embedding vektor.
_Avoid_: szelet, blokk, részlet

**Embedding**:
Egy Chunk (vagy lekérdezés) 1536 dimenziós vektor-reprezentációja (OpenAI `text-embedding-3-small`), amin a koszinusz-hasonlóságú keresés fut.
```

- [ ] **Step 3: Update `CLAUDE.md` (monorepo + invariants)**

In `CLAUDE.md`, under `## Monorepo`, note the planned apps/libs and add a pgvector invariant. Add to the "Architekturális invariánsok" list:

```markdown
- A **tudásbázis** (`documents` / `document_chunks`) sémáját/migrációját/seedjét a **Prisma** kezeli, de a **futásidejű vektorkeresés `pg`-vel** megy (mint a `runSql`): keresés/statisztika a **read-only** kapcsolaton, az embedding-írás (rag-builder) az RW-n. A pgvector kiterjesztést a migráció és a `docker/initdb` is engedélyezi.
- Az **embedding** kizárólag OpenAI `text-embedding-3-small` (1536 dim), a Vercel AI SDK `embedMany`-n át (`packages/core/embedding.ts`). Az embedding-kulcsot (`OPENAI_API_KEY`) csak az embedding-út igényli; a meglévő CLI e nélkül is fut.
```

- [ ] **Step 4: Verify the full monorepo still builds and tests pass**

Run: `pnpm nx run-many -t test-ci typecheck`
Expected: all projects PASS (the CLI/core still work; no OpenAI key needed for the existing paths).

- [ ] **Step 5: Commit**

```bash
git add .env.example CONTEXT.md CLAUDE.md
git commit -m "docs: document RAG env vars, knowledge-base domain language, and pgvector invariant"
```

---

## Self-Review notes

- **Spec coverage:** B1 → Task 1; B2 → Task 2; B3 config → Task 3; B3 embedding → Task 4; B3 knowledge-store → Task 5; B4 env/docs → Task 6. B5 error handling is folded into Tasks 3–5 (config throws, empty-input guard, dimension check, missing-connection guard, tx rollback). B6 testing is folded into Tasks 3–5 (DI fakes, no network/DB).
- **Out of scope (per spec B7):** chunking (SP2), agent/Vercel-AI-SDK migration of `ask-agent.ts` (SP3), `shared` package + engine-trace (SP3/SP4).
- **Known verification point:** the exact OpenAI embedding factory method (`openai.textEmbeddingModel` vs `openai.embedding`) depends on the installed `@ai-sdk/openai` version — confirmed at install time in Task 4 Step 1. Unit tests inject a fake and do not depend on it.
- **Type consistency:** `Queryable`, `DocumentInput`, `ChunkInput`, `SearchResult`, `ChunkStats`, `EmbedManyFn`, `EmbeddingConfig`, `RagConfig` are used with identical signatures across the tasks that reference them.
