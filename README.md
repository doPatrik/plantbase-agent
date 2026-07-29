# Plantbase 🌿

Természetes nyelvű, streamelő AI-chat egy növény-gondozási **tudásbázis** (202 markdown cikk) és egy
növény-**katalógus** (`products` tábla) felett. A felhasználó magyarul kérdez — gondozási témában
(pl. _„Hogyan gondozzam a pozsgásokat?”_) vagy katalógus-témában (pl. _„Mennyibe kerül a legolcsóbb
pozsgás?”_) —, a rendszer eldönti, melyik útra tartozik a kérdés, majd streamelt, magyar nyelvű,
forrásokkal alátámasztott választ ad.

Az agent egy **Vercel AI SDK-alapú, hibrid multi-agent RAG-pipeline**: felül egy LLM-router dönt
tudás- vagy katalógus-út között; a tudás-út egy determinisztikus kód-pipeline (HyDE → vector
retrieval → rerank → guardrail → answer), a katalógus-út egy `streamText`-alapú SQL-tool-loop.
Minden interakció JSONL-be naplózódik; `DEBUG=true` mellett a teljes **engine-trace** (melyik
agent/stage futott, milyen inputtal/outputtal, token-használat) is elérhető — CLI-n stderr-re,
a frontenden egy kinyitható panelen.

---

## Tartalom

- [Hogyan működik](#hogyan-működik)
- [Architektúra](#architektúra)
- [Biztonság: csak SELECT](#biztonság-csak-select)
- [Adatmodell](#adatmodell)
- [Előfeltételek](#előfeltételek)
- [Beüzemelés lépésről lépésre](#beüzemelés-lépésről-lépésre)
- [Használat](#használat)
- [Fejlesztés](#fejlesztés)
- [Naplózás és átláthatóság](#naplózás-és-átláthatóság)
- [Környezeti változók](#környezeti-változók)
- [Dokumentáció](#dokumentáció)

---

## Hogyan működik

```
felhasználó kérdése (magyar)
        │
        ▼
    Router (Haiku, generateObject)
        │
        ├── "knowledge" ─────────────────────────────────────────────┐
        │                                                            ▼
        │                                            HyDE (Haiku: hipotetikus válasz)
        │                                                            │
        │                                                            ▼
        │                                     Retrieval (embedding + pgvector cosine search)
        │                                                            │
        │                                                            ▼
        │                                              Rerank (Haiku: relevancia szerint)
        │                                                            │
        │                                                            ▼
        │                                   Guardrail (grounding-küszöb — nincs találat → elutasít)
        │                                                            │
        │                                                            ▼
        │                                             Answer (Sonnet, streamelt válasz + források)
        │
        └── "catalog" ──► streamText + catalogSql tool-loop (Sonnet, stopWhen: stepCountIs)
                                                                      │
                                                                      ▼
                                              streamelt válasz  +  logs/<timestamp>.jsonl
                                          (DEBUG=true: engine-trace minden stage-hez, usage-gal)
```

1. A router eldönti, hogy a kérdés a tudásbázisra (gondozási témák) vagy a katalógusra
   (ár, készlet, kategória) vonatkozik-e.
2. **Tudás-út:** determinisztikus kód-pipeline — HyDE hipotetikus választ generál, azt embeddeljük
   (OpenAI `text-embedding-3-small`), pgvectorral top-K chunköt keresünk, rerankeljük, guardrail
   ellenőrzi a grounding-küszöböt (nincs elég releváns találat → a válasz jelzi, hogy nem tud
   válaszolni), majd az Answer agent streameli a választ a releváns chunkok alapján.
3. **Katalógus-út:** egy `streamText` hívás, ami a `catalogSql` toolt hívhatja (read-only SELECT
   a `products` táblán) egy felső lépéskorláttal (`stopWhen: stepCountIs`).
4. Minden lépés `DEBUG=true` mellett engine-trace eseményként (stage, input/output, token-usage)
   is kimegy — CLI-n stderr, backend/frontend esetén `data-trace` UI Message Stream-part.

## Architektúra

Nx + pnpm monorepo, négy alkalmazással és három megosztott csomaggal:

| Alkalmazás/csomag      | Felelősség                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`apps/cli`**         | Streaming CLI (commander + `node:readline`): `ask` parancs + interaktív mód, `--show-prompt`, `DEBUG=true` esetén stderr engine-trace.                                   |
| **`apps/backend`**     | Express + Vercel AI SDK v7. `POST /api/chat` (UI Message Stream), `GET /api/debug/chunks`, `POST /api/debug/search`, `POST /api/debug/cost`, `GET /api/health`.          |
| **`apps/frontend`**    | React + Vite + shadcn/ui streaming chat (`useChat`); engine-trace panel + forrás-chipek DEBUG módban; Költség-becslő fül.                                                |
| **`apps/rag-builder`** | `seed/knowledge` (202 markdown) → chunkolás → OpenAI embedding → idempotens pgvector upsert (`build --dry-run`/`--force`, `stats`).                                      |
| **`packages/core`**    | A multi-agent RAG-pipeline: router, HyDE, retrieval, rerank, guardrail, answer, catalog-agent, toolok (`catalogSql`, `knowledgeSearch`), `runSql`, config, JSONL logger. |
| **`packages/db`**      | Prisma lib: `products` + `documents`/`document_chunks` séma, migrációk, seed. **Csak** séma/migráció/seed.                                                               |
| **`packages/shared`**  | Megosztott típusok/kontraktusok: engine-trace esemény-típusok, chat DTO-k, ár-modul (`loadModelPrices`, `computeStageCost`).                                             |

**Architekturális invariánsok** (részletek: [`CLAUDE.md`](CLAUDE.md), [`docs/architektura.md`](docs/architektura.md)):

- Az agent a Vercel AI SDK-alapú, hibrid multi-agent RAG-pipeline-t használja — **nem**
  agent-framework és **nem** a régi kézzel írt Anthropic tool-loop (törölve az SP3a-ban).
  A modellek `@ai-sdk/anthropic`-on át (Haiku router/HyDE/rerank, Sonnet answer/katalógus).
- A `runSql`/`catalogSql` **`pg`-vel** fut a **read-only** kapcsolaton (`DATABASE_URL_READONLY`),
  **nem** Prisma-n át. Prisma csak séma/migráció/seed a RW `DATABASE_URL`-en.
- A tudásbázis (`documents`/`document_chunks`) sémáját a Prisma kezeli, de a futásidejű
  vektorkeresés `pg`-vel megy: keresés/statisztika a read-only, embedding-írás (rag-builder) az
  RW kapcsolaton.
- Az embedding kizárólag OpenAI `text-embedding-3-small` (1536 dim), a Vercel AI SDK
  `embedMany`-n át; a tiszta katalógus-út e nélkül is fut.
- A backend a `createApp(deps)` DI-factoryn át áll össze; a `data-trace` part kizárólag
  `DEBUG=true` mellett megy ki.

## Biztonság: csak SELECT

Az agent által futtatott lekérdezésekre **kettős védelem** vonatkozik:

1. **DB read-only role (elsődleges).** A `plantbase_ro` szerepkör kizárólag `SELECT`-et kap —
   se `INSERT/UPDATE/DELETE`, se DDL. Létrehozás: [`docker/initdb/01-readonly-role.sql`](docker/initdb/01-readonly-role.sql).
2. **Kód-szintű `assertSelectOnly` guard (defense-in-depth).** Csak egyetlen `SELECT`
   (vagy `WITH ... SELECT`) utasítás engedélyezett; a tiltott kulcsszavak (`insert`, `update`,
   `delete`, `drop`, `alter`, `create`, `truncate`, `grant`, …) és a több utasítás elutasításra kerül.

Titkok kizárólag a repo-gyökér `.env`-jében élnek (gitignore); a kód `find-up`-pal
találja meg a gyökeret és a `.env`-et, így bármelyik alkalmazás bárhonnan futtatható a monorepón belül.

## Adatmodell

Két, egymástól független adatterület él ugyanabban a Postgres-adatbázisban:

- **`products`** — a katalógus. Domain-szótár: [`CONTEXT.md`](CONTEXT.md). Séma (kivonat,
  [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)):

  | Mező                                                   | Típus         | Jelentés                                                               |
  | ------------------------------------------------------ | ------------- | ---------------------------------------------------------------------- |
  | `id`                                                   | Int           | Elsődleges kulcs                                                       |
  | `name`, `latin_name`                                   | String        | Magyar és latin név                                                    |
  | `category`                                             | String        | Kategória (zárt szókészlet, pl. szobanövény, pozsgás, kaktusz, fűszer) |
  | `price`, `sale_price`                                  | Decimal       | Ár és akciós ár                                                        |
  | `stock`                                                | Int           | Készlet                                                                |
  | `light`, `watering`, `difficulty`                      | String        | Gondozási igények                                                      |
  | `current_height_cm`, `max_height_cm`, `current_pot_cm` | Int           | Méretek                                                                |
  | `pet_safe`, `kid_safe`, `air_purifying`                | Boolean       | Biztonság / tulajdonságok                                              |
  | `rating`, `reviews_count`                              | Decimal / Int | Értékelés                                                              |
  | `description`                                          | String        | Leírás                                                                 |

- **`documents` / `document_chunks`** — a tudásbázis. A `seed/knowledge` alatti 202 markdown
  növénygondozási cikkből a `rag-builder` chunkokat generál (markdown-heading-tudatos, overlappal),
  minden chunkhoz OpenAI-embeddinget tárol (`vector(1536)`, HNSW cosine index a vektorkereséshez).

## Előfeltételek

- **Node.js** 20+ és **pnpm**
- **Docker** (lokális Postgres + pgvector) — vagy egy meglévő Postgres 17 + pgvector kiterjesztés
- **Anthropic API kulcs** (router/HyDE/rerank/answer/katalógus-agent)
- **OpenAI API kulcs** (embedding — a tudás-úthoz és a rag-builderhez kell; tiszta katalógus-kérdésekhez nem)

## Beüzemelés lépésről lépésre

```bash
# 1. Függőségek
pnpm install

# 2. Lokális Postgres + pgvector (RW 'plantbase' + RO 'plantbase_ro', host port 5433)
docker compose up -d          # csak ha nincs már futó Postgres a gépeden

# 3. Környezeti változók
cp .env.example .env          # töltsd ki az ANTHROPIC_API_KEY-t és az OPENAI_API_KEY-t

# 4. Séma + seed (a Prisma a packages/db-ben van, ezért a gyökér .env-et be kell tölteni)
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate dev --schema=prisma/schema.prisma
pnpm --filter @plantbase/db exec prisma db seed          # 30 növény

# 5. Tudásbázis feltöltése (chunkolás + embedding + pgvector upsert)
pnpm nx run rag-builder:run -- build --dry-run   # gyors ellenőrzés kulcs/hívás nélkül
pnpm nx run rag-builder:run -- build             # valós OpenAI embedding-hívásokkal, pénzbe kerül
```

> **Port:** a host `5433` → konténer `5432` (a `5432`-t egy másik projekt foglalhatja).
> A read-only role csak az **első** konténer-indításkor jön létre (üres adatkönyvtár mellett).
> `prisma migrate dev`-vel követő migráció a pgvector `vector(1536)` oszlopon élő HNSW indexet
> DROP-olhatja — ezt utasítsd el, helyette `prisma migrate deploy` a meglévő migrációkhoz.

## Használat

### CLI

Buildelt artefaktból, a gyökérből:

```bash
pnpm plantbase:build                        # nx build cli → apps/cli/dist/main.js (+ core dist)
pnpm plantbase ask "Milyen kategóriák vannak?"
pnpm plantbase                              # interaktív mód (kilépés: "exit" vagy Ctrl+D)
```

Fejlesztéshez, `tsx`-szel (build nélkül; a `.env`-et `find-up`-pal megtalálja):

```bash
pnpm --filter @plantbase/cli exec tsx src/main.ts ask "Hány pozsgás van raktáron?"
pnpm --filter @plantbase/cli exec tsx src/main.ts               # interaktív
```

**Kapcsolók:**

- `--show-prompt` — a teljes system prompt és üzenettömb kiírása (átláthatóság).
- `DEBUG=true` — a stderr-re engine-trace kerül stage-enként (router, HyDE, retrieval, rerank, guardrail, answer / katalógus-tool-hívások).

Példák:

```bash
DEBUG=true pnpm plantbase ask "Hogyan gondozzam a pozsgásokat?"           # tudás-út (RAG)
pnpm plantbase ask "Mennyibe kerül a legolcsóbb pozsgás?"                 # katalógus-út (SQL)
pnpm plantbase ask "Sorold fel a légtisztító szobanövényeket értékelés szerint csökkenő sorrendben."
```

### Backend (Express + streaming API)

```bash
pnpm nx serve backend                 # build + node dist/main.js (PORT, alapból 3000)
pnpm --filter @plantbase/backend exec tsx src/main.ts   # dev-loop tsx-szel
```

Endpointok:

- `POST /api/chat` — streamelt válasz (Vercel AI SDK v7 UI Message Stream); `DEBUG=true` mellett `data-trace` part is megy.
- `GET /api/debug/chunks` — tudásbázis chunk-statisztika.
- `POST /api/debug/search` — vektorkeresés debug (HyDE ki/be × rerank mátrix).
- `POST /api/debug/cost` — `{ query }` → stage-enkénti USD-becslés (router/hyde/embedding/rerank/answer).
- `GET /api/health` — health check.

### Frontend (React + shadcn/ui chat)

```bash
pnpm nx serve frontend            # Vite dev server (4200), /api proxy → backend (3000)
#   Fusson a backend is: (DEBUG=true) pnpm nx serve backend
```

Streaming chat UI, DEBUG módban stage-címkés státusszal és kinyitható engine-trace panellel,
válaszok alatt forrás-chipekkel; külön "Költség-becslő" fülön a `/api/debug/cost` eredménye
táblázatban, élő ár-szerkesztéssel.

**Mennyibe kerül mindez?** A teljes tudásbázis (202 markdown cikk → 448 chunk) vektorizálása
egy valós `rag-builder build` futtatással 256 677 embedding-tokent használt fel, ez
`text-embedding-3-small` áron (**$0.02 / 1M token**) összesen **~$0.005** (fél cent) — ezt az
egyszeri (majd tartalomváltozáskor ismétlődő) ingest-költséget a builder minden futáskor naplózza
a `logs/rag-builder/`-be. Egy kérdés a **teljes tudás-út pipeline-on** (router → HyDE → embedding
→ rerank → answer) **összesen hozzávetőlegesen $0.02–0.03** — egy valós, `/api/debug/cost`-on mért
példakérdésnél (_„Hogyan gondozzam a pozsgásokat?”_) pontosan **$0.0239**. Ebből a két domináns
tétel a rerank (a visszakeresett chunkok miatt ~8000 input token Haiku-n, ~$0.008) és az
Answer-lépés (Sonnet, ~$0.014); a router, a HyDE és az embedding-lépés együtt is csak ~$0.002
körül van.

### RAG builder

```bash
pnpm nx run rag-builder:run -- build --dry-run   # chunkolás kulcs nélkül
pnpm nx run rag-builder:run -- build             # valós embedding + feltöltés (OPENAI_API_KEY kell)
pnpm nx run rag-builder:run -- stats             # tudásbázis-állapot (RO)
# gyors dev-loop tsx-szel (build nélkül):
pnpm --filter @plantbase/rag-builder exec tsx src/main.ts build --dry-run
```

## Fejlesztés

Minden feladatot **nx**-en keresztül futtass:

```bash
pnpm nx test @plantbase/core                 # egy csomag tesztjei
pnpm nx run-many -t test typecheck build     # minden: teszt + típusellenőrzés + build
```

**Konvenciók** (részletek: [`docs/konvenciok.md`](docs/konvenciok.md)):

- Git commit és PR **angolul**; beszélgetés és `/docs` **magyarul**.
- Kis, önálló lépések — egy lépés = egy fókuszált commit (Conventional Commits). Feature branch,
  a `main` marad zöld, PR-rel megy be.
- TypeScript strict, `kebab-case` fájlnevek, `interface` objektumokhoz, immutabilitás.
- Külső/nem megbízható input (env, LLM-kimenet, tool input) validálása **zod**-dal a határon; sose `any`.
- Product-kódban nincs `console.log` (a CLI stdout a termék felülete — az szándékos).
- Tesztek: **Vitest**, dependency-injektált fake-ekkel, hálózat/DB nélkül.

## Naplózás és átláthatóság

Minden interakció a gyökér **`logs/<timestamp>.jsonl`** fájlba kerül: a system prompt,
a felhasználói kérdés, a router/pipeline döntései, a tool-hívások és -eredmények, valamint a
token-használat. `DEBUG=true` mellett ugyanez az információ engine-trace formában, valós időben
is elérhető (CLI: stderr; backend/frontend: `data-trace` UI Message Stream-part). Ez teszi
utólag auditálhatóvá, hogy az agent milyen SQL-t/retrieval-t futtatott és miért.

## Környezeti változók

A `.env.example`-ből másold `.env`-be. Fő változók (a teljes lista a fájlban):

| Változó                                                                | Kötelező           | Leírás                                                                                 |
| ---------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                                    | ✅                 | Az Anthropic API kulcs (router/HyDE/rerank/answer/katalógus-agent).                    |
| `OPENAI_API_KEY`                                                       | tudás-úthoz/RO-hoz | Az OpenAI API kulcs (embedding, `text-embedding-3-small`).                             |
| `DATABASE_URL`                                                         | migráció/seedhez   | Read-write kapcsolat — a Prisma ezzel viszi a sémát, migrációt, seedet.                |
| `DATABASE_URL_READONLY`                                                | ✅                 | Read-only kapcsolat — a `runSql`/`catalogSql` és a vektorkeresés ezen fut.             |
| `RAG_ROUTER_MODEL` / `_HYDE_MODEL` / `_RERANK_MODEL` / `_ANSWER_MODEL` | —                  | Modellkiosztás stage-enként (alapból Haiku a router/HyDE/rerank, Sonnet az answerhez). |
| `RAG_TOP_K` / `RAG_RERANK_TOP_N`                                       | —                  | Hány chunköt ad vissza a vektorkeresés, és a rerank hányat tart meg.                   |
| `RAG_GROUNDING_THRESHOLD`                                              | —                  | Cosine-similarity küszöb; alatta a guardrail "nincs találat"-ot jelez.                 |
| `MAX_AGENT_ITERATIONS`                                                 | —                  | A katalógus-agent tool-loopjának felső lépéskorlátja.                                  |
| `DEBUG`                                                                | —                  | `true` esetén engine-trace (CLI: stderr; backend/frontend: `data-trace`).              |
| `PORT`                                                                 | —                  | A backend portja (alapból 3000).                                                       |

## Dokumentáció

- [`CLAUDE.md`](CLAUDE.md) — projekt-áttekintés és architekturális invariánsok
- [`CONTEXT.md`](CONTEXT.md) — a domain nyelve (ubiquitous language)
- [`docs/rag/roadmap.md`](docs/rag/roadmap.md) — a multi-agent RAG átalakítás hiteles terve és al-projekt-státuszai
- [`docs/architektura.md`](docs/architektura.md) — architektúra
- [`docs/stack.md`](docs/stack.md) — technológiai stack
- [`docs/konvenciok.md`](docs/konvenciok.md) — konvenciók
- [`docs/dev-workflow.md`](docs/dev-workflow.md) — fejlesztői munkafolyamat
- [`docs/adr/`](docs/adr/) — architektúra-döntések (ADR-ek)

## Licenc

MIT
