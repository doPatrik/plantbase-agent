# Plantbase — CLAUDE.md

CLI AI-agent, ami természetes nyelvű kérdésből SQL-t generál a növény-katalógus (`products`) felett, read-only kapcsolaton lefuttatja, és magyar nyelvű választ ad.

## Monorepo

Nx + pnpm. Munkaterületek:

- `packages/core` — az agent logikája: `askAgent` (kézzel írt tool-use loop), `runSql` tool, system prompt (`schema-context`), config, JSONL logger.
- `packages/db` — Prisma lib: `products` séma, migrációk, seed (`prisma/`). Csak séma/migráció/seed.
- `apps/cli` — a CLI belépési pont (commander + `node:readline`): `ask` parancs + interaktív mód.

## Gyakori parancsok

```bash
pnpm install

# Lokális Postgres (docker-compose: RW 'plantbase' + RO 'plantbase_ro', host port 5433):
docker compose up -d          # csak ha nincs már futó Postgres a gépeden
cp .env.example .env          # majd töltsd ki az ANTHROPIC_API_KEY-t

# Adatbázis (a Prisma a packages/db-ben van, ezért a gyökér .env-et be kell tölteni):
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate dev --schema=prisma/schema.prisma
pnpm --filter @plantbase/db exec prisma db seed          # 30 növény

# CLI (fejlesztéshez tsx-szel; a .env-et find-up-pal megtalálja):
pnpm --filter @plantbase/cli exec tsx src/main.ts ask "Hány pozsgás van raktáron?"
pnpm --filter @plantbase/cli exec tsx src/main.ts               # interaktív, "exit"/Ctrl+D
#   --show-prompt: a teljes system prompt + üzenettömb kiírása

# CLI prod-módon a gyökérből (buildelt artefakt, nem tsx):
pnpm plantbase:build                        # nx build cli → apps/cli/dist/main.js (+ core dist)
pnpm plantbase ask "Milyen kategóriák vannak?"
pnpm plantbase                              # interaktív

# Tesztek / típusellenőrzés (mindig nx-en át):
pnpm nx test @plantbase/core
pnpm nx run-many -t test typecheck build
```

## Architekturális invariánsok (NE sértsd meg)

- Az agent **kézzel írt** tool-use loopot használ (`client.messages.create` + `stop_reason: 'tool_use'`), **nem** SDK-helpert (`toolRunner`) és nem agent-frameworköt.
- A `runSql` **`pg`-vel** fut a **read-only** kapcsolaton (`DATABASE_URL_READONLY`), **nem** Prisma-n át. Prisma csak séma/migráció/seed a RW `DATABASE_URL`-en.
- **Csak SELECT.** Kettős védelem: DB read-only role (elsődleges, NFR1) + kód-szintű `assertSelectOnly` guard.
- Minden interakció a gyökér `logs/<timestamp>.jsonl`-be kerül (FR4). `--show-prompt` az átláthatósághoz (FR5).
- Titkok kizárólag a gyökér `.env`-ben (gitignore). A kód `findUp`-pal találja meg a gyökeret/`.env`-et, így bárhonnan futtatható.
- A **tudásbázis** (`documents` / `document_chunks`) sémáját/migrációját/seedjét a **Prisma** kezeli, de a **futásidejű vektorkeresés `pg`-vel** megy (mint a `runSql`): keresés/statisztika a **read-only** kapcsolaton, az embedding-írás (rag-builder) az RW-n. A pgvector kiterjesztést a migráció és a `docker/initdb` is engedélyezi.
- Az **embedding** kizárólag OpenAI `text-embedding-3-small` (1536 dim), a Vercel AI SDK `embedMany`-n át (`packages/core/src/lib/embedding.ts`). Az embedding-kulcsot (`OPENAI_API_KEY`) csak az embedding-út igényli; a meglévő CLI e nélkül is fut.
- A pgvector HNSW index egy `Unsupported("vector(1536)")` típusú oszlopon él; `prisma migrate dev` lehetséges follow-up migráció után az index DROP-olódhat — ezt el kell **utasítani**, helyette `prisma migrate deploy` használandó a meglévő migrációkhoz.

## Konvenciók

- **Git commit és PR: angolul.** Beszélgetés és `/docs`: magyarul.
- Kis, önálló lépések: egy lépés = egy fókuszált commit (Conventional Commits). Feature branch (`feat/<leírás>`), a `main` marad zöld, PR-rel megy be.
- TypeScript strict, `kebab-case` fájlnevek, `interface` objektumokhoz / string-literál unió enum helyett, immutabilitás.
- Külső/nem megbízható input (env, LLM-kimenet, tool input) validálása **zod**-dal a határon; sose `any`.
- Product-kódban nincs `console.log` (a CLI stdout a termék felülete — az szándékos).
- Library-dokumentációt **Context7-tel** olvass be kódolás előtt (Nx, Prisma, Anthropic SDK, pg, commander).
- Tesztek: Vitest, dependency-injektált fake-ekkel hálózat/DB nélkül (lásd `ask-agent.spec.ts`).

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
