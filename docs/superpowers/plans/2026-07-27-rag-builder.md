# rag-builder (chunking + embedding + pgvector upload, SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/rag-builder`, a Node CLI that reads the `seed/knowledge` markdown corpus, chunks it heading-aware, embeds the chunks, and idempotently uploads them into the `document_chunks` pgvector table.

**Architecture:** A new Nx Node app mirrors `apps/cli` (commander entry + esbuild build + vitest). All real logic lives in pure, dependency-injected `src/lib/` modules (`frontmatter`, `token-estimate`, `chunker`, `pipeline`); `main.ts` is a thin commander wiring. The app reuses `@plantbase/core` (`embedTexts`, `upsertDocumentWithChunks`, `getChunkStats`, `assertEmbeddingDim`, `loadEmbeddingConfig`, `resolveProjectRoot`) and adds one small read helper to core (`getExistingDocumentHashes`) for the hash-based skip.

**Tech Stack:** Nx + pnpm monorepo, TypeScript (strict, ESM), `commander`, `node:crypto` (sha256), `@plantbase/core` (Vercel AI SDK embeddings + `pg` knowledge-store), zod (at the frontmatter boundary), Vitest.

## Global Constraints

- TypeScript strict; ESM — every relative import specifier ends in `.js`.
- File names `kebab-case`; `interface` for object shapes; string-literal unions instead of enums; immutability (`readonly`).
- Validate all external/untrusted input (frontmatter, env) with **zod** at the boundary; never `any`.
- No `console.log` in product/library code. The CLI stdout is the product surface — write it via `process.stdout.write` in `main.ts` only.
- Tests: Vitest, dependency-injected fakes — **no network, no live DB** (see `runsql.spec.ts`, `config.spec.ts`, `knowledge-store.spec.ts`).
- pgvector invariant: **Prisma = schema/migration/seed only; runtime vector access via `pg`** — RO for reads (`getExistingDocumentHashes`, `getChunkStats`), RW for writes (`upsertDocumentWithChunks`).
- Read library docs with **Context7** before using an unfamiliar API (`commander`, Nx `@nx/node`).
- Commits in **English**, Conventional Commits, small focused commits. Work on branch `feat/rag-builder` (already created). `main` stays green.
- Embedding dimension is fixed at **1536**.
- Chunk parameters (balanced preset): `target=512`, `overlap=64`, `minMerge=128`, `hardSplit=800` (approximate tokens, char/4).
- Run the app test suite once (non-watch) with: `pnpm nx test @plantbase/rag-builder -- --run`. Core: `pnpm nx test @plantbase/core -- --run`. Typecheck: `pnpm nx typecheck @plantbase/rag-builder`.
- `token_count` is approximate (`Math.ceil(chars / 4)`).

---

## File Structure

**`packages/core/src/lib`**

- Modify `knowledge-store.ts` — add `getExistingDocumentHashes(options?: ReadOptions): Promise<Map<string,string>>` (RO read). Auto-exported via the existing `export * from './lib/knowledge-store.js'`.
- Modify `knowledge-store.spec.ts` — test for the new helper (fake `Queryable`).

**`apps/rag-builder`** (new)

- Create `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`, `vitest.config.mts`, `src/assets/.gitkeep` — app scaffolding mirroring `apps/cli`.
- Create `src/main.ts` — commander entry: `build` (default) + `stats`, flags `--force` / `--dry-run` / `--path`.
- Create `src/lib/token-estimate.ts` (+ `.spec.ts`) — `estimateTokens`.
- Create `src/lib/frontmatter.ts` (+ `.spec.ts`) — `parseFrontmatter` (zod).
- Create `src/lib/chunker.ts` (+ `.spec.ts`) — `chunkMarkdown` heading-aware chunking.
- Create `src/lib/pipeline.ts` (+ `.spec.ts`) — `runBuild` orchestration (DI).

**Docs**

- Modify `CLAUDE.md` — add rag-builder to the common commands.
- Modify `docs/rag/roadmap.md` — SP2 status.

---

## Task 1: Scaffold `apps/rag-builder` + token estimator

**Files:**

- Create: `apps/rag-builder/package.json`, `apps/rag-builder/tsconfig.json`, `apps/rag-builder/tsconfig.app.json`, `apps/rag-builder/tsconfig.spec.json`, `apps/rag-builder/vitest.config.mts`, `apps/rag-builder/src/assets/.gitkeep`, `apps/rag-builder/src/main.ts`
- Create: `apps/rag-builder/src/lib/token-estimate.ts`
- Test: `apps/rag-builder/src/lib/token-estimate.spec.ts`

**Interfaces:**

- Consumes: `@plantbase/core` (workspace dep), `commander`.
- Produces: `estimateTokens(text: string): number` — approximate token count (`Math.ceil(chars / 4)`, `0` for empty). A recognized Nx project `@plantbase/rag-builder` with `build`/`test`/`typecheck` targets.

- [ ] **Step 1: Create the app config files**

`apps/rag-builder/package.json`:

```json
{
  "name": "@plantbase/rag-builder",
  "version": "1.0.0",
  "private": true,
  "nx": {
    "name": "rag-builder",
    "targets": {
      "build": {
        "executor": "@nx/esbuild:esbuild",
        "outputs": ["{options.outputPath}"],
        "defaultConfiguration": "production",
        "options": {
          "platform": "node",
          "outputPath": "apps/rag-builder/dist",
          "format": ["cjs"],
          "bundle": false,
          "main": "apps/rag-builder/src/main.ts",
          "tsConfig": "apps/rag-builder/tsconfig.app.json",
          "assets": ["apps/rag-builder/src/assets"],
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
      }
    }
  },
  "dependencies": {
    "@plantbase/core": "workspace:*",
    "commander": "^14.0.3"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "~4.1.9",
    "tsx": "^4.22.4",
    "vitest": "~4.1.9"
  }
}
```

`apps/rag-builder/tsconfig.json`:

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

`apps/rag-builder/tsconfig.app.json`:

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
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts"
  ],
  "references": [{ "path": "../../packages/core/tsconfig.lib.json" }]
}
```

`apps/rag-builder/tsconfig.spec.json`:

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
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

`apps/rag-builder/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/rag-builder',
  test: {
    name: '@plantbase/rag-builder',
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

Create an empty `apps/rag-builder/src/assets/.gitkeep` (empty file).

- [ ] **Step 2: Create a minimal commander entry so the app builds**

`apps/rag-builder/src/main.ts` (fleshed out in Task 6):

```ts
// Plantbase rag-builder — belépési pont (SP2).
// A build/stats parancsok a Task 6-ban kerülnek be.
import { Command } from 'commander';

const program = new Command();
program
  .name('rag-builder')
  .description(
    'Plantbase RAG builder: seed/knowledge → chunk → embedding → pgvector',
  )
  .version('1.0.0');

program.parseAsync();
```

- [ ] **Step 3: Install so the workspace links the new package**

Run: `pnpm install`
Expected: completes; `@plantbase/rag-builder` linked (it matches the `apps/*` workspace glob).

- [ ] **Step 4: Verify Nx sees the project**

Run: `pnpm nx show project @plantbase/rag-builder --json`
Expected: JSON that includes `build`, `test`, and `typecheck` in `targets`.

- [ ] **Step 5: Write the failing test**

`apps/rag-builder/src/lib/token-estimate.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estimateTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates ~1 token per 4 characters (ceil)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: FAIL — cannot resolve `./token-estimate.js` / `estimateTokens` is not defined.

- [ ] **Step 7: Write minimal implementation**

`apps/rag-builder/src/lib/token-estimate.ts`:

```ts
// Közelítő token-becslés (karakter/4). Pontos tokenizáló nem cél SP2-ben.

/** Egy szöveg közelítő token-száma (≈ karakterszám / 4, felfelé kerekítve). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/rag-builder pnpm-lock.yaml
git commit -m "feat(rag-builder): scaffold Nx app and token estimator"
```

---

## Task 2: Frontmatter parser

**Files:**

- Create: `apps/rag-builder/src/lib/frontmatter.ts`
- Test: `apps/rag-builder/src/lib/frontmatter.spec.ts`

**Interfaces:**

- Consumes: `zod`.
- Produces:

  ```ts
  interface ParsedDocument {
    readonly title: string;
    readonly category: string;
    readonly source_url: string | null;
    readonly body: string;
  }
  function parseFrontmatter(raw: string): ParsedDocument; // throws on missing/invalid frontmatter
  ```

- [ ] **Step 1: Write the failing test**

`apps/rag-builder/src/lib/frontmatter.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

const doc = (fm: string, body = 'Body text.') => `---\n${fm}\n---\n${body}`;

describe('parseFrontmatter', () => {
  it('parses title, category and source, and returns the body', () => {
    const raw = doc(
      'title: Snake Plant Care\ncategory: plants-101\nsource: https://x.test/a',
    );
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe('Snake Plant Care');
    expect(parsed.category).toBe('plants-101');
    expect(parsed.source_url).toBe('https://x.test/a');
    expect(parsed.body).toBe('Body text.');
  });

  it('keeps colons in the value (splits on the first colon only)', () => {
    const raw = doc(
      'title: Bug Off: All About Mealybugs\ncategory: plants-101',
    );
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe('Bug Off: All About Mealybugs');
    expect(parsed.source_url).toBeNull();
  });

  it('throws when a required field is missing', () => {
    const raw = doc('category: plants-101');
    expect(() => parseFrontmatter(raw)).toThrow(/title/i);
  });

  it('throws when there is no frontmatter block', () => {
    expect(() => parseFrontmatter('# No frontmatter here')).toThrow(
      /frontmatter/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: FAIL — `parseFrontmatter` not defined.

- [ ] **Step 3: Write minimal implementation**

`apps/rag-builder/src/lib/frontmatter.ts`:

```ts
// Markdown frontmatter szétválasztása és validálása (boundary → zod).
// A seed/knowledge cikkek egyszerű 3-mezős YAML-frontmattert használnak
// (title / category / source); az értékben lehet kettőspont (pl. "Bug Off: …"),
// ezért CSAK az első kettőspontnál vágunk.

import { z } from 'zod';

export interface ParsedDocument {
  readonly title: string;
  readonly category: string;
  readonly source_url: string | null;
  readonly body: string;
}

const frontmatterSchema = z.object({
  title: z.string().min(1, 'title hiányzik vagy üres.'),
  category: z.string().min(1, 'category hiányzik vagy üres.'),
  source: z.string().min(1).optional(),
});

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Kibontja a frontmatter mezőit és a body-t egy nyers markdown-fájlból.
 * @throws {Error} ha nincs frontmatter-blokk, vagy hiányzik kötelező mező.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error('Hiányzó vagy hibás frontmatter-blokk.');
  }
  const [, block, body] = match;

  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.length > 0) fields[key] = value;
  }

  const result = frontmatterSchema.safeParse(fields);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Hibás frontmatter: ${issues}`);
  }

  return {
    title: result.data.title,
    category: result.data.category,
    source_url: result.data.source ?? null,
    body: body.trim(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/rag-builder/src/lib/frontmatter.ts apps/rag-builder/src/lib/frontmatter.spec.ts
git commit -m "feat(rag-builder): add zod-validated frontmatter parser"
```

---

## Task 3: Heading-aware chunker

**Files:**

- Create: `apps/rag-builder/src/lib/chunker.ts`
- Test: `apps/rag-builder/src/lib/chunker.spec.ts`

**Interfaces:**

- Consumes: `estimateTokens` from `./token-estimate.js`.
- Produces:

  ```ts
  interface Chunk {
    readonly chunk_index: number;
    readonly content: string;
    readonly heading_path: string | null;
    readonly token_count: number;
  }
  interface ChunkOptions {
    readonly target?: number; // default 512
    readonly overlap?: number; // default 64
    readonly minMerge?: number; // default 128
    readonly hardSplit?: number; // default 800
  }
  function chunkMarkdown(body: string, options?: ChunkOptions): Chunk[];
  ```

- [ ] **Step 1: Write the failing tests**

`apps/rag-builder/src/lib/chunker.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from './chunker.js';

// Segéd: n szó, ~4 char/szó → ~n token.
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('chunkMarkdown', () => {
  it('returns [] for empty or whitespace-only body', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n  \n')).toEqual([]);
  });

  it('builds a breadcrumb heading_path from nested headings', () => {
    const body = '# Care\n\n## Water\n\nWater weekly.';
    const chunks = chunkMarkdown(body, { target: 10 });
    expect(chunks[0].heading_path).toBe('Care > Water');
  });

  it('assigns sequential chunk_index from 0', () => {
    const body = `## A\n\n${words(400)}\n\n## B\n\n${words(400)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      overlap: 0,
      minMerge: 0,
    });
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('merges small adjacent sections up toward the target', () => {
    const body = '## A\n\nshort a\n\n## B\n\nshort b\n\n## C\n\nshort c';
    const chunks = chunkMarkdown(body, { target: 512, overlap: 0 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading_path).toBe('A'); // first segment's path
  });

  it('hard-splits a single oversized section on paragraph boundaries', () => {
    const body = `## Big\n\n${words(500)}\n\n${words(500)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      hardSplit: 400,
      overlap: 0,
      minMerge: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.token_count).toBeLessThanOrEqual(700);
    }
  });

  it('adds overlap: the start of a later chunk repeats the tail of the previous one', () => {
    const body = `## A\n\n${words(400)}\n\n## B\n\nUNIQUEMARKER ${words(400)}`;
    const chunks = chunkMarkdown(body, {
      target: 300,
      overlap: 40,
      minMerge: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // A második chunk eleje tartalmaz szöveget az elsőből (overlap).
    const first = chunks[0].content;
    const secondHead = chunks[1].content.slice(0, 200);
    const lastWordOfFirst = first.trim().split(/\s+/).slice(-1)[0];
    expect(secondHead).toContain(lastWordOfFirst);
  });

  it('sets token_count from the final (post-overlap) content', () => {
    const body = '## A\n\nhello world';
    const [chunk] = chunkMarkdown(body);
    expect(chunk.token_count).toBe(Math.ceil(chunk.content.length / 4));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: FAIL — `chunkMarkdown` not defined.

- [ ] **Step 3: Write the implementation**

`apps/rag-builder/src/lib/chunker.ts`:

```ts
// Heading-tudatos markdown-chunkoló overlap-pel (SP2).
// 1) szegmentálás markdown-headingek mentén, heading_path breadcrumb-bel
// 2) túl nagy szegmens hard-splitje bekezdés-, majd szóhatáron
// 3) greedy pakolás target token-méretig (apró szekciók összevonása)
// 4) záró, minMerge alatti csonk visszaolvasztása
// 5) dokumentumon belüli overlap két egymást követő chunk közt

import { estimateTokens } from './token-estimate.js';

export interface Chunk {
  readonly chunk_index: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly token_count: number;
}

export interface ChunkOptions {
  readonly target?: number;
  readonly overlap?: number;
  readonly minMerge?: number;
  readonly hardSplit?: number;
}

const DEFAULTS = {
  target: 512,
  overlap: 64,
  minMerge: 128,
  hardSplit: 800,
} as const;

interface Segment {
  readonly heading_path: string | null;
  readonly text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Body → szekciók markdown-headingek mentén, heading_path breadcrumb-bel. */
function segment(body: string): Segment[] {
  const stack: string[] = [];
  const segments: Segment[] = [];
  let currentPath: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) segments.push({ heading_path: currentPath, text });
    buffer = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      stack.length = level - 1; // a mélyebb szintek eldobása
      stack[level - 1] = match[2].trim();
      const path = stack.filter((s) => Boolean(s)).join(' > ');
      currentPath = path.length > 0 ? path : null;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}

/** Szavankénti darabolás ~target token méretű darabokra (végső mentőháló). */
function splitByWords(text: string, target: number): string[] {
  const wordList = text.split(/\s+/).filter((w) => w.length > 0);
  const pieces: string[] = [];
  let current: string[] = [];
  for (const word of wordList) {
    current.push(word);
    if (estimateTokens(current.join(' ')) >= target) {
      pieces.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) pieces.push(current.join(' '));
  return pieces;
}

/** hardSplit fölötti szegmens tördelése bekezdés-, majd szóhatáron. */
function splitLarge(
  seg: Segment,
  hardSplit: number,
  target: number,
): Segment[] {
  if (estimateTokens(seg.text) <= hardSplit) return [seg];
  const out: Segment[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join('\n\n').trim();
    if (text.length > 0) out.push({ heading_path: seg.heading_path, text });
    current = [];
  };

  for (const para of seg.text.split(/\n{2,}/)) {
    if (estimateTokens(para) > hardSplit) {
      flush();
      for (const piece of splitByWords(para, target)) {
        out.push({ heading_path: seg.heading_path, text: piece });
      }
      continue;
    }
    current.push(para);
    if (estimateTokens(current.join('\n\n')) >= target) flush();
  }
  flush();
  return out;
}

interface PackedChunk {
  text: string;
  heading_path: string | null;
}

/** Greedy pakolás: szegmensek chunkokba target token-méretig. */
function pack(segments: readonly Segment[], target: number): PackedChunk[] {
  const chunks: PackedChunk[] = [];
  let current: string[] = [];
  let path: string | null = null;

  const flush = () => {
    const text = current.join('\n\n').trim();
    if (text.length > 0) chunks.push({ text, heading_path: path });
    current = [];
    path = null;
  };

  for (const seg of segments) {
    if (current.length === 0) path = seg.heading_path;
    current.push(seg.text);
    if (estimateTokens(current.join('\n\n')) >= target) flush();
  }
  flush();
  return chunks;
}

/** Záró, minMerge alatti csonk visszaolvasztása az előző chunkba. */
function mergeTrailingSmall(
  chunks: PackedChunk[],
  minMerge: number,
): PackedChunk[] {
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    if (estimateTokens(last.text) < minMerge) {
      const prev = chunks[chunks.length - 2];
      chunks[chunks.length - 2] = {
        text: `${prev.text}\n\n${last.text}`,
        heading_path: prev.heading_path,
      };
      chunks.pop();
    }
  }
  return chunks;
}

/** Dokumentumon belüli overlap: az előző chunk farkának ~overlap tokene a következő elejére. */
function withOverlapText(
  chunks: readonly PackedChunk[],
  overlap: number,
): string[] {
  if (overlap <= 0) return chunks.map((c) => c.text);
  const overlapChars = overlap * 4;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk.text;
    const prev = chunks[i - 1].text;
    let tail = prev.slice(Math.max(0, prev.length - overlapChars));
    const firstSpace = tail.indexOf(' '); // ne vágjunk szó közepén
    if (firstSpace > 0) tail = tail.slice(firstSpace + 1);
    tail = tail.trim();
    return tail.length > 0 ? `${tail}\n\n${chunk.text}` : chunk.text;
  });
}

/** Nyers body → chunkok (heading-tudatos + overlap). */
export function chunkMarkdown(
  body: string,
  options: ChunkOptions = {},
): Chunk[] {
  const { target, overlap, minMerge, hardSplit } = { ...DEFAULTS, ...options };
  const segments = segment(body).flatMap((s) =>
    splitLarge(s, hardSplit, target),
  );
  const packed = mergeTrailingSmall(pack(segments, target), minMerge);
  const contents = withOverlapText(packed, overlap);
  return contents.map((content, i) => ({
    chunk_index: i,
    content,
    heading_path: packed[i].heading_path,
    token_count: estimateTokens(content),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: PASS (all chunker tests + earlier tasks).

- [ ] **Step 5: Commit**

```bash
git add apps/rag-builder/src/lib/chunker.ts apps/rag-builder/src/lib/chunker.spec.ts
git commit -m "feat(rag-builder): add heading-aware markdown chunker with overlap"
```

---

## Task 4: `getExistingDocumentHashes` in core knowledge-store

**Files:**

- Modify: `packages/core/src/lib/knowledge-store.ts` (add helper near `getChunkStats`)
- Test: `packages/core/src/lib/knowledge-store.spec.ts` (add a describe block)

**Interfaces:**

- Consumes: existing `Queryable`, `ReadOptions`, `getPool`, `resolveReadConnectionString` in the same file.
- Produces: `getExistingDocumentHashes(options?: ReadOptions): Promise<Map<string, string>>` — RO; maps `source_path → content_hash`. Auto-exported by `packages/core/src/index.ts` (`export * from './lib/knowledge-store.js'`).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/lib/knowledge-store.spec.ts` (import `getExistingDocumentHashes` alongside the existing imports):

```ts
describe('getExistingDocumentHashes', () => {
  it('selects source_path + content_hash and builds a map', async () => {
    const calls: { text: string; params?: readonly unknown[] }[] = [];
    const client: Queryable = {
      query: async (text, params) => {
        calls.push({ text, params });
        return {
          rows: [
            { source_path: 'a.md', content_hash: 'h1' },
            { source_path: 'b.md', content_hash: 'h2' },
          ],
        };
      },
    };

    const map = await getExistingDocumentHashes({ client });

    expect(calls[0].text).toMatch(
      /select\s+source_path,\s*content_hash\s+from\s+documents/i,
    );
    expect(map.get('a.md')).toBe('h1');
    expect(map.get('b.md')).toBe('h2');
    expect(map.size).toBe(2);
  });
});
```

(If `Queryable` is not yet imported in the spec, add it to the import from `./knowledge-store.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- --run`
Expected: FAIL — `getExistingDocumentHashes` not exported.

- [ ] **Step 3: Write the implementation**

Add to `packages/core/src/lib/knowledge-store.ts` (after `getChunkStats`):

```ts
const EXISTING_HASHES_SQL = `SELECT source_path, content_hash FROM documents`;

/** Meglévő dokumentumok source_path → content_hash térképe (RO, idempotens rebuildhez). */
export async function getExistingDocumentHashes(
  options: ReadOptions = {},
): Promise<Map<string, string>> {
  const client =
    options.client ??
    getPool(resolveReadConnectionString(options.connectionString));
  const { rows } = await client.query(EXISTING_HASHES_SQL, []);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(String(row.source_path), String(row.content_hash));
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test @plantbase/core -- --run`
Expected: PASS (new test + existing core tests).

- [ ] **Step 5: Typecheck core**

Run: `pnpm nx typecheck @plantbase/core`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib/knowledge-store.ts packages/core/src/lib/knowledge-store.spec.ts
git commit -m "feat(core): add getExistingDocumentHashes for idempotent rebuild"
```

---

## Task 5: Build pipeline (orchestration, DI)

**Files:**

- Create: `apps/rag-builder/src/lib/pipeline.ts`
- Test: `apps/rag-builder/src/lib/pipeline.spec.ts`

**Interfaces:**

- Consumes: `parseFrontmatter` (`./frontmatter.js`), `chunkMarkdown` + `ChunkOptions` (`./chunker.js`), `assertEmbeddingDim` + `DocumentInput` + `ChunkInput` (`@plantbase/core`), `node:crypto`, `node:path`.
- Produces:

  ```ts
  interface BuildDeps {
    readonly listFiles: (dir: string) => string[]; // absolute .md paths (sorted)
    readonly readFile: (path: string) => string; // raw file contents
    readonly embedTexts: (values: readonly string[]) => Promise<number[][]>;
    readonly getExistingHashes: () => Promise<Map<string, string>>;
    readonly upsert: (
      doc: DocumentInput,
      chunks: readonly ChunkInput[],
    ) => Promise<{ documentId: number; chunkCount: number }>;
    readonly log: (line: string) => void;
  }
  interface BuildOptions {
    readonly dir: string;
    readonly force?: boolean;
    readonly dryRun?: boolean;
    readonly chunkOptions?: ChunkOptions;
    readonly dimension?: number; // default 1536
  }
  interface BuildSummary {
    readonly built: number;
    readonly skipped: number;
    readonly chunks: number;
    readonly errors: number;
  }
  function runBuild(
    deps: BuildDeps,
    options: BuildOptions,
  ): Promise<BuildSummary>;
  ```

- [ ] **Step 1: Write the failing test**

`apps/rag-builder/src/lib/pipeline.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { runBuild, type BuildDeps } from './pipeline.js';

const RAW_A = `---\ntitle: Doc A\ncategory: plants-101\n---\n## H\n\nBody A content here.`;
const RAW_B = `---\ntitle: Doc B\ncategory: plants-101\n---\n## H\n\nBody B content here.`;
const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
const vec = () => Array.from({ length: 1536 }, () => 0.1);

interface Recorder {
  deps: BuildDeps;
  upserts: string[];
  embedCalls: () => number;
}

function makeDeps(
  files: Record<string, string>,
  existing: Map<string, string> = new Map(),
): Recorder {
  const upserts: string[] = [];
  let embedCalls = 0;
  const deps: BuildDeps = {
    listFiles: () => Object.keys(files).sort(),
    readFile: (p) => files[p],
    embedTexts: async (values) => {
      embedCalls++;
      return values.map(() => vec());
    },
    getExistingHashes: async () => existing,
    upsert: async (doc, chunks) => {
      upserts.push(doc.source_path);
      return { documentId: upserts.length, chunkCount: chunks.length };
    },
    log: () => undefined,
  };
  return { deps, upserts, embedCalls: () => embedCalls };
}

describe('runBuild', () => {
  it('builds new documents: embeds and upserts each', async () => {
    const r = makeDeps({ 'a.md': RAW_A, 'b.md': RAW_B });
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.built).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
    expect(r.upserts).toEqual(['a.md', 'b.md']);
  });

  it('skips documents whose content_hash is unchanged (no embedding)', async () => {
    const existing = new Map([['a.md', hashOf(RAW_A)]]);
    const r = makeDeps({ 'a.md': RAW_A, 'b.md': RAW_B }, existing);
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.skipped).toBe(1);
    expect(summary.built).toBe(1);
    expect(r.upserts).toEqual(['b.md']);
    expect(r.embedCalls()).toBe(1); // csak b.md-t embeddeltük
  });

  it('--force rebuilds even unchanged documents', async () => {
    const existing = new Map([['a.md', hashOf(RAW_A)]]);
    const r = makeDeps({ 'a.md': RAW_A }, existing);
    const summary = await runBuild(r.deps, { dir: '/x', force: true });
    expect(summary.skipped).toBe(0);
    expect(summary.built).toBe(1);
  });

  it('--dry-run chunks but never embeds or upserts', async () => {
    const r = makeDeps({ 'a.md': RAW_A });
    const summary = await runBuild(r.deps, { dir: '/x', dryRun: true });
    expect(summary.chunks).toBeGreaterThan(0);
    expect(summary.built).toBe(0);
    expect(r.embedCalls()).toBe(0);
    expect(r.upserts).toEqual([]);
  });

  it('isolates a per-file error and keeps going', async () => {
    const r = makeDeps({ 'bad.md': 'no frontmatter here', 'a.md': RAW_A });
    const summary = await runBuild(r.deps, { dir: '/x' });
    expect(summary.errors).toBe(1);
    expect(summary.built).toBe(1);
    expect(r.upserts).toEqual(['a.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: FAIL — `runBuild` not defined.

- [ ] **Step 3: Write the implementation**

`apps/rag-builder/src/lib/pipeline.ts`:

```ts
// A rag-builder orchestrátora (SP2): fájllista → parse → hash → skip → chunk →
// embed → upsert. Minden I/O és a core-hívások injektáltak (BuildDeps), így
// hálózat/DB nélkül tesztelhető.

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  assertEmbeddingDim,
  type DocumentInput,
  type ChunkInput,
} from '@plantbase/core';
import { parseFrontmatter } from './frontmatter.js';
import { chunkMarkdown, type ChunkOptions } from './chunker.js';

export interface BuildDeps {
  readonly listFiles: (dir: string) => string[];
  readonly readFile: (path: string) => string;
  readonly embedTexts: (values: readonly string[]) => Promise<number[][]>;
  readonly getExistingHashes: () => Promise<Map<string, string>>;
  readonly upsert: (
    doc: DocumentInput,
    chunks: readonly ChunkInput[],
  ) => Promise<{ documentId: number; chunkCount: number }>;
  readonly log: (line: string) => void;
}

export interface BuildOptions {
  readonly dir: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly chunkOptions?: ChunkOptions;
  readonly dimension?: number;
}

export interface BuildSummary {
  readonly built: number;
  readonly skipped: number;
  readonly chunks: number;
  readonly errors: number;
}

const DEFAULT_DIMENSION = 1536;

export async function runBuild(
  deps: BuildDeps,
  options: BuildOptions,
): Promise<BuildSummary> {
  const files = deps.listFiles(options.dir);
  const existing =
    !options.force && !options.dryRun
      ? await deps.getExistingHashes()
      : new Map<string, string>();
  const dimension = options.dimension ?? DEFAULT_DIMENSION;

  let built = 0;
  let skipped = 0;
  let chunks = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const sourcePath = basename(file);
    const tag = `[${i + 1}/${files.length}] ${sourcePath}`;
    try {
      const raw = deps.readFile(file);
      const contentHash = createHash('sha256').update(raw).digest('hex');
      const charCount = raw.length;
      const parsed = parseFrontmatter(raw);

      if (!options.force && existing.get(sourcePath) === contentHash) {
        skipped++;
        deps.log(`${tag} … SKIP (unchanged)`);
        continue;
      }

      const docChunks = chunkMarkdown(parsed.body, options.chunkOptions);
      if (docChunks.length === 0) {
        deps.log(`${tag} … WARN: 0 chunk, kihagyva`);
        continue;
      }

      if (options.dryRun) {
        chunks += docChunks.length;
        deps.log(`${tag} … ${docChunks.length} chunk (DRY)`);
        continue;
      }

      const embeddings = await deps.embedTexts(docChunks.map((c) => c.content));
      const chunkInputs: ChunkInput[] = docChunks.map((c, idx) => {
        assertEmbeddingDim(embeddings[idx], dimension);
        return {
          chunk_index: c.chunk_index,
          content: c.content,
          heading_path: c.heading_path,
          token_count: c.token_count,
          embedding: embeddings[idx],
        };
      });

      const doc: DocumentInput = {
        source_path: sourcePath,
        title: parsed.title,
        source_url: parsed.source_url,
        category: parsed.category,
        content_hash: contentHash,
        char_count: charCount,
      };

      const res = await deps.upsert(doc, chunkInputs);
      built++;
      chunks += res.chunkCount;
      deps.log(`${tag} … ${res.chunkCount} chunk, embedded, upserted`);
    } catch (error) {
      errors++;
      deps.log(`${tag} … ERROR: ${(error as Error).message}`);
    }
  }

  deps.log(
    `DONE: ${built} built, ${skipped} skipped, ${chunks} chunks, ${errors} errors`,
  );
  return { built, skipped, chunks, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test @plantbase/rag-builder -- --run`
Expected: PASS (all pipeline tests + earlier).

- [ ] **Step 5: Commit**

```bash
git add apps/rag-builder/src/lib/pipeline.ts apps/rag-builder/src/lib/pipeline.spec.ts
git commit -m "feat(rag-builder): add DI build pipeline (skip/force/dry-run/error isolation)"
```

---

## Task 6: Wire the CLI (`build` + `stats`) and verify `--dry-run` on real seed

**Files:**

- Modify: `apps/rag-builder/src/main.ts`

**Interfaces:**

- Consumes: `runBuild` + `BuildDeps` (`./lib/pipeline.js`); from `@plantbase/core`: `resolveProjectRoot`, `loadEmbeddingConfig`, `embedTexts`, `getExistingDocumentHashes`, `upsertDocumentWithChunks`, `getChunkStats`, `closeKnowledgePool`; `node:fs`, `node:path`, `commander`.
- Produces: a runnable CLI — `rag-builder build [--force] [--dry-run] [--path <dir>]` and `rag-builder stats`.

- [ ] **Step 1: Replace `main.ts` with the full commander wiring**

`apps/rag-builder/src/main.ts`:

```ts
// Plantbase rag-builder — belépési pont (SP2).
// Használat:
//   rag-builder build [--force] [--dry-run] [--path <dir>]
//   rag-builder stats
// A seed/knowledge markdown-korpuszt chunkolja, embeddeli és a pgvector
// document_chunks táblába tölti (idempotens, content_hash alapján).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  resolveProjectRoot,
  loadEmbeddingConfig,
  embedTexts,
  getExistingDocumentHashes,
  upsertDocumentWithChunks,
  getChunkStats,
  closeKnowledgePool,
} from '@plantbase/core';
import { runBuild, type BuildDeps } from './lib/pipeline.js';

function defaultSeedDir(): string {
  return join(resolveProjectRoot(), 'seed', 'knowledge');
}

function listMarkdown(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(dir, f));
}

interface BuildCliOptions {
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly path?: string;
}

const program = new Command();
program
  .name('rag-builder')
  .description(
    'Plantbase RAG builder: seed/knowledge → chunk → embedding → pgvector',
  )
  .version('1.0.0');

program
  .command('build', { isDefault: true })
  .description('Chunkolás → embedding → pgvector feltöltés (idempotens)')
  .option('--force', 'minden dokumentum újraépítése (hash-skip nélkül)')
  .option('--dry-run', 'chunkolás + riport OpenAI-hívás és DB-írás nélkül')
  .option(
    '--path <dir>',
    'a knowledge könyvtár felülírása (default: seed/knowledge)',
  )
  .action(async (opts: BuildCliOptions) => {
    const dir = opts.path ?? defaultSeedDir();
    // dry-run módban nincs szükség OpenAI-kulcsra
    const config = opts.dryRun ? undefined : loadEmbeddingConfig();

    const deps: BuildDeps = {
      listFiles: listMarkdown,
      readFile: (p) => readFileSync(p, 'utf8'),
      embedTexts: (values) => embedTexts(values, { config }),
      getExistingHashes: () => getExistingDocumentHashes(),
      upsert: (doc, chunks) => upsertDocumentWithChunks(doc, chunks),
      log: (line) => process.stdout.write(`${line}\n`),
    };

    try {
      const summary = await runBuild(deps, {
        dir,
        force: opts.force,
        dryRun: opts.dryRun,
      });
      process.exitCode = summary.errors > 0 ? 1 : 0;
    } finally {
      await closeKnowledgePool();
    }
  });

program
  .command('stats')
  .description('A jelenlegi tudásbázis-állapot kiírása (RO)')
  .action(async () => {
    try {
      const s = await getChunkStats();
      process.stdout.write(
        `documents: ${s.document_count}  chunks: ${s.chunk_count}  embedded: ${s.embedded_chunk_count}\n`,
      );
      process.stdout.write(
        `chunk chars: min ${s.min_chunk_chars} / avg ${Math.round(s.avg_chunk_chars)} / max ${s.max_chunk_chars}\n`,
      );
    } finally {
      await closeKnowledgePool();
    }
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`Hiba: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck the app**

Run: `pnpm nx typecheck @plantbase/rag-builder`
Expected: no errors.

- [ ] **Step 3: Build the app**

Run: `pnpm nx build @plantbase/rag-builder`
Expected: build succeeds; emits `apps/rag-builder/dist/main.js`.

- [ ] **Step 4: Verify `--dry-run` end-to-end on the real seed (no OpenAI key needed)**

Run: `pnpm --filter @plantbase/rag-builder exec tsx src/main.ts build --dry-run`
Expected: a per-document line for each of the 202 files (`… N chunk (DRY)`), then a final
`DONE: 0 built, 0 skipped, <total> chunks, 0 errors` line. No OpenAI/DB calls, exit code 0.
Confirm there are **no ERROR lines** (every file parses + chunks). If any file errors, inspect its
frontmatter/body and fix the parser/chunker before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/rag-builder/src/main.ts
git commit -m "feat(rag-builder): wire build/stats CLI commands"
```

---

## Task 7: Documentation

**Files:**

- Modify: `CLAUDE.md` (common commands section)
- Modify: `docs/rag/roadmap.md` (SP2 status)

**Interfaces:**

- Consumes: nothing. Produces: nothing (docs only).

- [ ] **Step 1: Add rag-builder usage to `CLAUDE.md`**

In `CLAUDE.md`, under "Gyakori parancsok", add after the CLI block:

```markdown
# RAG builder (seed/knowledge → chunk → embedding → pgvector; OPENAI_API_KEY kell a valós futáshoz):

pnpm --filter @plantbase/rag-builder exec tsx src/main.ts build --dry-run # chunkolás kulcs nélkül
pnpm --filter @plantbase/rag-builder exec tsx src/main.ts build # valós embedding + feltöltés
pnpm --filter @plantbase/rag-builder exec tsx src/main.ts stats # tudásbázis-állapot (RO)
```

- [ ] **Step 2: Update SP2 status in `docs/rag/roadmap.md`**

Change the `### SP2 — rag-builder — ⏳ KÖVETKEZŐ` heading to `✅ KÉSZ` (or `🚧 FOLYAMATBAN` until merged, per preference) and append a short sentence noting the app landed on `feat/rag-builder` with chunking/embedding/upsert + `--dry-run`/`--force`/`stats`, and that the real embedding run awaits `OPENAI_API_KEY`.

- [ ] **Step 3: Full typecheck + test sweep**

Run: `pnpm nx run-many -t typecheck && pnpm nx run-many -t test -- --run`
Expected: all projects green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/rag/roadmap.md
git commit -m "docs(rag): document rag-builder commands and mark SP2 status"
```

---

## Definition of Done (SP2)

- `apps/rag-builder` exists as a recognized Nx app with `build`/`test`/`typecheck` targets.
- All Vitest suites green (`pnpm nx run-many -t test -- --run`), no network/DB in tests.
- `build --dry-run` runs over the real 202-file seed with **0 errors** and reports the total chunk count.
- The real embedding + pgvector upload is deferred until `OPENAI_API_KEY` is present in the root `.env` (out of scope for the PR gate, per the spec).

---

## Self-Review

**Spec coverage:**

- Architektúra + monorepo-illesztés → Task 1 (scaffold mirroring `apps/cli`). ✅
- Új core-helper `getExistingDocumentHashes` → Task 4. ✅
- `frontmatter.ts` (zod, first-colon split) → Task 2. ✅
- `token-estimate.ts` → Task 1. ✅
- `chunker.ts` (segment/heading_path, greedy pack, minMerge trailing-merge, hardSplit, overlap) → Task 3. ✅
- `pipeline.ts` (skip/force/dry-run/error-isolation/summary) → Task 5. ✅
- CLI `build`+`stats`, flags `--force`/`--dry-run`/`--path`, fail-fast on missing key (non-dry-run) → Task 6. ✅
- Error handling (per-file isolation, non-zero exit on errors, missing key fail-fast, 0-chunk warning) → Tasks 5–6. ✅
- Testing (frontmatter/chunker/token-estimate/pipeline + core helper) → Tasks 1–5. ✅
- Nx integration + dev run commands → Tasks 1, 6, 7. ✅
- Docs (CLAUDE.md, roadmap) → Task 7. ✅
- "Done" = code + green tests + `--dry-run` on real seed → Task 6 Step 4 + Definition of Done. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step contains real content. The `main.ts` in Task 1 is an intentional minimal-but-functional entry, explicitly replaced in Task 6.

**Type consistency:** `Chunk`/`ChunkOptions` (Task 3) are consumed by `pipeline.ts` (Task 5) with matching names. `BuildDeps`/`BuildOptions`/`BuildSummary`/`runBuild` (Task 5) match Task 6's imports. `ParsedDocument`/`parseFrontmatter` (Task 2) match pipeline usage. `getExistingDocumentHashes(options?: ReadOptions): Promise<Map<string,string>>` (Task 4) matches the `getExistingHashes` dep shape and `main.ts` wiring. `DocumentInput`/`ChunkInput`/`assertEmbeddingDim` are the actual `@plantbase/core` exports (verified against `knowledge-store.ts`).
