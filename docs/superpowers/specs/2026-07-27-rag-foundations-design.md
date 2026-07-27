# Multi-Agent RAG — 1. al-projekt: Alapok (pgvector + knowledge séma + provider-config)

- **Dátum:** 2026-07-27
- **Státusz:** jóváhagyásra vár
- **Scope:** a 4 al-projektes RAG-átalakítás **1. al-projektje**. A teljes cél-architektúra
  vázlatosan itt is szerepel (kontextusként), de a részletes terv és az implementáció
  csak az 1. al-projektre vonatkozik.

## Kontextus és kiindulás

A jelenlegi rendszer egy CLI AI-agent (`packages/core` kézzel írt tool-use loop a nyers
`@anthropic-ai/sdk`-val, `runSql`/`listCategories` tool a `products` katalógus felett,
read-only `pg` kapcsolaton). A cél egy production-szintű, multi-agent RAG chat-rendszer a
`seed/knowledge` (202 markdown cikk) feletti tudásbázissal, a meglévő `products` katalógus
megtartásával.

### Jóváhagyott alap-döntések (brainstorming)

1. **Teljes migráció a Vercel AI SDK-ra** — a meglévő SQL agentet is átírjuk; egységes stack.
   (A migráció ténylegesen a 3. al-projektben történik; SP1 nem nyúl az `ask-agent.ts`-hez,
   a CLI zöld marad.)
2. **RAG + SQL egy rendszerben** — a knowledge-base RAG a fő, de a `products` SQL tool
   megmarad az orchestrator egyik eszközeként; a chat gondozási ÉS katalógus-kérdésre is válaszol.
3. **OpenAI `text-embedding-3-small` (1536 dim) embedding + Claude Haiku rerank/HyDE** —
   új kulcs: `OPENAI_API_KEY`.
4. **Lokális reference implementáció** — production-grade kód/architektúra, egy-felhasználós,
   lokálisan futtatható; nincs auth és felhő-deploy.
5. **A CLI (`apps/cli`) megmarad** vasékony kliensként a megosztott, migrált `core` felett.
6. **Ütemezés:** arch-vázlat + részletes SP1 spec most; a többi al-projekt később, egyesével
   (spec → terv → implementáció).

## A) Cél-architektúra és monorepo-layout (vázlat)

### Alkalmazások (`apps/`)

| App             | Stack                                                   | Felelősség                                                                        |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `frontend`      | React + Vite + Vercel AI SDK UI (`useChat`) + shadcn/ui | ChatGPT-szerű streaming chat + DEBUG engine-trace panel                           |
| `backend`       | Express + Vercel AI SDK                                 | `POST /api/chat` (streaming) + debug endpointok; az orchestrator HTTP belépője    |
| `rag-builder`   | Node CLI                                                | `seed/knowledge` beolvasás → chunkolás → embedding → pgvector upsert (idempotens) |
| `cli` _(marad)_ | commander + Vercel AI SDK                               | vasékony kliens a megosztott `core` felett, streaming a terminálba                |

### Könyvtárak (`packages/`)

- **`core`** _(migrált)_ — a multi-agent rendszer Vercel AI SDK-ra: Orchestrator + agentek
  (HyDE, Retrieval, Rerank, Answer, Guardrail) + toolok (`catalogSql`, `knowledgeSearch`).
  Modell-/provider-registry. Használja `backend` + `cli`.
- **`db`** — Prisma: `products` + új knowledge-chunk séma + migrációk + seed. Runtime
  vektorkeresés NEM ezen megy.
- **`shared`** _(új, SP3/SP4)_ — megosztott típusok/kontraktusok: engine-trace esemény-típusok,
  API DTO-k, zod-sémák a határon. Használja `backend` + `frontend` + `core`.

### Provider-/modell-absztrakció (`core`)

- `@ai-sdk/anthropic`: Answer + Orchestrator → Sonnet; HyDE + Rerank + Guardrail → Haiku (olcsó).
- `@ai-sdk/openai`: kizárólag embedding → `text-embedding-3-small` (1536 dim).
- Config bővül: `OPENAI_API_KEY`, `MAX_AGENT_ITERATIONS`, `DEBUG`, modellnevek env-ből (zod-validált).

### Agent-modell (magas szinten; részletek SP3-ban)

- Az Orchestrator egy Vercel AI SDK `streamText` agent-loop (`stopWhen: stepCountIs(MAX_AGENT_ITERATIONS)`),
  toolokkal.
- Minden agent toolként van kitéve; az orchestrator hívja őket — egymással közvetlenül nem
  beszélnek (PRD-invariáns).
- Guardrail három ponton: input (belépéskor), tool-szintű, output (a végső válaszon,
  hallucináció-ellenőrzés a retrievelt chunkokhoz képest).

### Adatfolyam

`frontend (useChat)` → `backend /api/chat` → `orchestrator loop` →
_(HyDE → embed → vector search → rerank)_ **vagy** `catalogSql` → `Answer` stream →
output-guardrail → streaming vissza. DEBUG módban az engine-trace események a data-stream
mellékcsatornáján mennek a frontend trace-paneljére.

## B) 1. al-projekt — részletes terv

**Cél:** a RAG adat- és konfigurációs alapja, amire a rag-builder (SP2) és a backend (SP3) épül.

### B1. Infrastruktúra (pgvector)

- `docker-compose.yml`: image `postgres:17` → **`pgvector/pgvector:pg17`** (drop-in,
  adat-kompatibilis, ugyanaz a PG 17 major).
- `docker/initdb/02-vector-extension.sql` _(új)_ → `CREATE EXTENSION IF NOT EXISTS vector;`
  (friss volume-ra, első indításkor fut).
- Meglévő dev-volume-hoz a kiterjesztést a knowledge-**migráció** is létrehozza
  (`CREATE EXTENSION IF NOT EXISTS vector;` — a `plantbase` owner lokálisan superuser,
  így a nem-trusted `vector` extension engedélyezése is működik).

### B2. Adatmodell (Prisma séma + kézi migráció) — `packages/db`

Két tábla — az idempotens rebuild (dokumentumonként content_hash) és a dokumentum-szintű
debug-statisztika miatt.

**`documents`** — egy sor / forrás-markdown:

| oszlop         | típus                     | megjegyzés                                                 |
| -------------- | ------------------------- | ---------------------------------------------------------- |
| `id`           | serial PK                 |                                                            |
| `source_path`  | text UNIQUE NOT NULL      | a fájlnév (`plants-101__how-to-care-for-a-snake-plant.md`) |
| `title`        | text NOT NULL             | frontmatter `title`                                        |
| `source_url`   | text                      | frontmatter `source`                                       |
| `category`     | text NOT NULL             | frontmatter `category` (témacsoport)                       |
| `content_hash` | text NOT NULL             | a nyers fájl sha256-ja — idempotens rebuild                |
| `char_count`   | int NOT NULL              |                                                            |
| `created_at`   | timestamptz DEFAULT now() |                                                            |
| `updated_at`   | timestamptz DEFAULT now() |                                                            |

**`document_chunks`** — egy sor / chunk:

| oszlop         | típus                                             | megjegyzés                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | serial PK                                         |                                                                                                                                                                                                                             |
| `document_id`  | int NOT NULL FK → documents(id) ON DELETE CASCADE |                                                                                                                                                                                                                             |
| `chunk_index`  | int NOT NULL                                      |                                                                                                                                                                                                                             |
| `content`      | text NOT NULL                                     |                                                                                                                                                                                                                             |
| `heading_path` | text                                              | heading-breadcrumb (pl. `How To Care… > How To Repot`)                                                                                                                                                                      |
| `token_count`  | int                                               | közelítő                                                                                                                                                                                                                    |
| `embedding`    | **vector(1536) NOT NULL**                         | implementálva NULLABLE (`Unsupported("vector(1536)")?`), hogy elkerüljük a Prisma migrációs drift-et; a dimenziót az app-szintű `assertEmbeddingDim` guard + az oszloptípus kényszeríti ki, az író út mindig ad embeddinget |
| `created_at`   | timestamptz DEFAULT now()                         |                                                                                                                                                                                                                             |
|                | UNIQUE(`document_id`, `chunk_index`)              |                                                                                                                                                                                                                             |
|                | HNSW index (`embedding` `vector_cosine_ops`)      |                                                                                                                                                                                                                             |

**Prisma modellezés:**

- A nem-vektor oszlopok normál Prisma-mezők (`Document`, `DocumentChunk` model, reláció).
- `embedding` mint `Unsupported("vector(1536)")?` — a Prisma Client nem kérdezi le; a
  vektorkeresés `pg`-n megy.
- `generator client { previewFeatures = ["postgresqlExtensions"] }`, `datasource db { extensions = [vector] }`.
- **Index + extension:** `prisma migrate dev --create-only`, majd a generált migráció SQL
  kézi kiegészítése:
  - `CREATE EXTENSION IF NOT EXISTS vector;` (a migráció elején),
  - `CREATE INDEX ... ON document_chunks USING hnsw (embedding vector_cosine_ops);`
- **RO grant:** automatikus — a meglévő `ALTER DEFAULT PRIVILEGES FOR ROLE plantbase … GRANT
SELECT ON TABLES TO plantbase_ro` (docker/initdb/01) minden új, `plantbase` által létrehozott
  táblára ad SELECT-et. Nincs szükség külön grantre.

### B3. Provider-/adat-réteg — `packages/core`

**Config (kompozálható — hogy a CLI ne igényeljen OpenAI-kulcsot):**

- `loadCoreConfig()` — Anthropic (a meglévő `loadConfig` viselkedése, változatlan).
- `loadEmbeddingConfig()` — `OPENAI_API_KEY` (kötelező), `OPENAI_EMBEDDING_MODEL`
  (default `text-embedding-3-small`), `EMBEDDING_DIM = 1536` (konstans).
- `loadRagConfig()` — `MAX_AGENT_ITERATIONS` (default 6), `DEBUG` (default false),
  modellnevek (Sonnet/Haiku default-ok).
- Mind zod-validált, magyar hibaüzenettel; a find-up `.env` betöltés a meglévő mintát követi.

**`embedding.ts`** — `embedTexts(values: string[]): Promise<number[][]>` és
`embedQuery(text: string): Promise<number[]>` a Vercel AI SDK `embedMany` / `embed` +
`@ai-sdk/openai` fölött. Az embedding-model injektálható (teszthez determinisztikus fake).

**`knowledge-store.ts`** — `pg`-alapú adat-hozzáférés (a `runsql.ts` pool-mintáját követve,
paraméteres `connectionString` opcióval):

- `upsertDocumentWithChunks(doc, chunks)` — RW (rag-builder használja). Egy tranzakcióban:
  `documents` upsert (`source_path` kulcs), a régi chunkok törlése (kaszkád / explicit),
  az új chunkok beszúrása embeddinggel.
- `searchChunks(queryEmbedding, k)` — RO. `1 - (embedding <=> $1)` similarity,
  `ORDER BY embedding <=> $1 ASC LIMIT $2`; visszaadja a chunk-tartalmat + dokumentum-metaadatot
  (title, source_url) + similarity score-t.
- `getChunkStats()` — RO. Dokumentum- és chunk-számok, chunk-méret eloszlás, embedding-lefedettség
  (a chunk-debug endpointhoz).
- Az embedding vektor pgvector-literálként (`[0.1,0.2,...]`); minden query paraméteres (nincs injection).

### B4. Env + dokumentáció

- `.env.example` bővítés: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `MAX_AGENT_ITERATIONS`, `DEBUG`.
- `CONTEXT.md` bővítés a knowledge-domain nyelvvel: **Dokumentum**, **Chunk**, **Embedding**,
  **Tudásbázis (knowledge base)** — a meglévő domain-szótár stílusában.
- `CLAUDE.md` rövid frissítés: az új alkalmazások/könyvtárak és a pgvector-invariáns
  (Prisma = séma/migráció/seed; runtime vektorkeresés `pg`-n, RO kapcsolaton).

### B5. Hibakezelés

- Config: zod a határon, egyértelmű hibaüzenet; `OPENAI_API_KEY` csak ott kötelező, ahol
  embedding kell (a CLI változatlanul fut nélküle).
- Embedding: üres input kezelése (üres tömb → üres eredmény), `embedMany` retry (default),
  provider-hibák becsomagolása értelmes üzenetbe.
- knowledge-store: hiányzó connection string → dob; embedding dimenzió-ellenőrzés (1536);
  rebuildnél a régi chunkok törlése (kaszkád) az árva sorok ellen.
- Migráció: minden `IF NOT EXISTS` — idempotens újrafuttatás.

### B6. Tesztelés (Vitest, DI-fake-ekkel, hálózat/DB nélkül — a meglévő minta)

- **config** specek: hiányzó/hibás env; a három loader külön-külön; a CLI-út (OpenAI-kulcs nélkül) nem törik.
- **embedding** spec: injektált fake embedding-modell (determinisztikus vektor); üres input; batch.
- **knowledge-store** spec: injektált fake `pg` kliens; a generált SQL + paraméterek ellenőrzése
  (upsert / search / stats), a similarity-formula és a `LIMIT`, a pgvector-literál formázása.

### B7. Amit SP1 NEM tartalmaz

- Chunkolási logika → SP2 (rag-builder).
- Agentek / Vercel AI SDK-migráció (`ask-agent.ts` átírása) → SP3.
- `shared` package + engine-trace típusok → SP3/SP4.
- Backend/frontend/debug-endpointok → SP3/SP4.

## Nyitott pontok / feltételezések

- HNSW paraméterek (`m`, `ef_construction`) a default-okon maradnak ezen a méreten (~pár ezer chunk);
  finomhangolás később, ha a retrieval-minőség indokolja.
- A `token_count` közelítő (karakter-alapú becslés vagy egyszerű tokenizáló); pontos tokenizálás
  nem cél SP1-ben.
- Az `updated_at` frissítését a `documents` upsert állítja (nincs DB-trigger; egyszerűbb, tesztelhető).
