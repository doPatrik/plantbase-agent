# Plantbase – Implementációs terv (proposal)

## Cél és háttér

A **Plantbase** egy CLI AI-agent lakberendezőknek (és otthoni felhasználóknak): természetes nyelvű kérdésből SQL-t generál a `products` növénykatalógus felett, lefuttatja, és rövid, érthető, **magyar nyelvű** választ ad. A cél a szobánkénti növényválasztás idejét 10–15 percről 5 perc alá vinni (BRS).

A repo jelenleg **stage 0**: csak a dokumentáció (`/docs`) és a kész seed (`/seed/plants.ts`, `/seed/seed.ts`) létezik, kód-scaffold nincs. Ez a terv úgy fázisol, hogy **minden lépés kicsi, önállóan tesztelhető increment, a végén egy commit**, és minden implementációs lépés után a felhasználó tesztel.

## Fix döntések

- A proposal magyarul, ebben a fájlban (`docs/proposal.md`).
- A Postgres **már fut** (5433, `plantbase` RW + `plantbase_ro` RO role az `.env`-ből) — nem hozunk létre docker-compose-t, csak csatlakozunk.
- **Vitest + manuális**: kulcsponti automata tesztek (pl. `runSql` SELECT-only guard) + manuális teszt-checkpoint fázisonként.
- Nx scaffold `create-nx-workspace`-szel (pnpm, TS preset).

## Kulcs architekturális megkötések (a `/docs`-ból, betartandók)

- A `runSql` **kézzel írt** tool-use loopban fut (`client.messages.create` + `stop_reason: 'tool_use'` kezelés), **nem** a SDK `toolRunner` helperjével — az „first principles" átláthatóság miatt (architektura.md).
- Az agent **nem** Prisma-n keresztül kérdez. A `runSql` a **`pg`** (node-postgres) drivert használja a **read-only** (`DATABASE_URL_READONLY`) kapcsolaton. A Prisma csak séma/migráció/seed.
- Csak `SELECT`. Kód-szintű guard + a DB read-only role a védelem (NFR1).
- Minden coding-fázis **Context7 doksi-olvasással kezdődik** az érintett libre, mielőtt kódolunk.

## Munkamenet / konvenciók (minden lépésre)

- **Branch:** fázisonként feature branch (`feat/<rövid-leírás>`), a végén conventional commit; a `main` marad zöld (dev-workflow.md).
- **Commit:** `feat:` / `chore:` / `test:` … egy lépés = egy fókuszált commit.
- **TS strict**, `kebab-case` fájlnevek, Zod a boundary-validációhoz, nincs `console.log` product-kódban (strukturált logger), titok csak `.env`-ben (konvenciok.md).
- **Teszt-checkpoint:** minden lépés végén megállunk, a felhasználó teszteli, majd commit.

---

## A) A KÖRNYEZET LÉTREHOZÁSA — mérföldkő: fut és tesztelhető

> Context7 az induláshoz: **Nx** és **Prisma**.

### A0 — Nx + pnpm workspace scaffold
- `create-nx-workspace` a repo tetején (TS preset, pnpm, integrated monorepo, Nx Cloud kihagyva).
- `pnpm-workspace.yaml`: `packages/*`, `apps/*`.
- Gyökér `tsconfig.base.json` (strict), ESLint + Prettier + Vitest alap.
- Meglévő fájlok (`docs/`, `seed/`, `.env`, `.mcp.json`, `.gitignore`, `.claude/`) megmaradnak; a scaffoldot köréjük illesztjük.
- **Teszt:** `pnpm nx --version`, `pnpm install` sikeres.
- **Commit:** `chore: scaffold nx pnpm monorepo`

### A1 — `packages/db` Prisma lib + `products` séma + migráció
- `nx g @nx/js:lib packages/db` (bundler=tsc).
- `packages/db/prisma/schema.prisma`: `datasource db` (postgresql, `env("DATABASE_URL")`), `generator client` (`output = "../generated"`), `model Product` a `products` táblához mappelve (`@@map("products")`, `snake_case` oszlopok `@map`-pel, `id @id @default(autoincrement())`, `sale_price` nullable stb.).
- `prisma migrate dev --name init` → `packages/db/prisma/migrations/`, majd `prisma generate`.
- **Teszt:** migráció lefut, `products` tábla létrejön (postgres MCP / `prisma migrate status`), generált kliens megvan.
- **Commit:** `feat: add prisma db lib with products schema and initial migration`

### A2 — Seed integráció + betöltés
- A meglévő `seed/plants.ts` + `seed/seed.ts` **átmozgatása** `packages/db/prisma/`-ba (a seed/README.md szerint) — az adatot **nem** generáljuk újra.
- `packages/db/package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`.
- A `seed.ts` importjait a generált kliensre igazítjuk.
- **Teszt:** `prisma db seed` → ~30 sor betöltve; `SELECT count(*) FROM products` (postgres MCP) = 30.
- **Commit:** `feat: integrate plant catalog seed into db lib`

### A3 — `packages/core` skeleton
- `nx g @nx/js:lib packages/core`.
- Placeholder export + egy trivi Vitest teszt, hogy a lib buildel/tesztel.
- **Teszt:** `pnpm nx test core` zöld, `pnpm nx build core` OK.
- **Commit:** `chore: add core package skeleton`

### A4 — `apps/cli` skeleton (üres CLI elindul)
- `nx g @nx/node:app apps/cli`, `tsx` futtatás.
- `commander` program `plantbase` névvel; egyelőre csak placeholder (pl. `--version` / üres `ask`), ami elindul és kilép.
- **Teszt:** a CLI elindul, hibamentesen kilép.
- **Commit:** `chore: add empty cli app skeleton`

> **MÉRFÖLDKŐ: a környezet kész** — monorepo áll, DB migrált + seedelt, üres CLI indul.

---

## B) AZ IMPLEMENTÁCIÓ 3 FÁZISA

### 1. fázis — CLI visszhang (echo), LLM nélkül
> Context7: **commander** + `node:readline`.
- `apps/cli`: `ask "<kérdés>"` egyszeri parancs → kiírja a beírt szöveget (echo).
- Interaktív readline mód: promptol, minden sort visszaír, `exit`-ig.
- Még **nincs** LLM, **nincs** DB.
- **Vitest:** az echo/parse függvény egységteszt (input → ugyanaz az output).
- **Teszt-checkpoint:** `plantbase ask "szia"` → `szia`; interaktív mód visszhangzik, `exit` kilép. **→ felhasználó tesztel.**
- **Commit:** `feat: cli echo mode (ask + interactive readline)`

### 2. fázis — LLM, adatbázis nélkül
> Context7: **Anthropic SDK TS** — `messages.create`, `stop_reason`. **NEM** `toolRunner`.
- `packages/core`: `askAgent(question)` — Anthropic kliens (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` az `.env`-ből), XML-tagelt system prompt a `docs/system-prompt.md` alapján (`core/schema-context`).
- **Tool nélkül**: a modell egyszerű választ ad. A system prompt jelzi, hogy jelenleg nincs DB-hozzáférés, ezért adat-kérdésnél az agent **őszintén** közli, hogy nem fér hozzá az adatbázishoz és nem tud válaszolni.
- CLI bekötve: `ask` és interaktív mód is `askAgent`-et hív; `--show-prompt` flag kiírja a teljes message-tömböt (FR5).
- **Vitest:** system prompt builder egységteszt (tartalmazza a séma/szabály blokkokat); LLM-hívás mockolva.
- **Teszt-checkpoint:** általános kérdésre válaszol; „mutasd a raktáron lévő pozsgásokat" → őszintén jelzi, hogy nincs DB-hozzáférése. **→ felhasználó tesztel.**
- **Commit:** `feat: wire cli to anthropic llm (no db access yet)`

### 3. fázis — SQL-es interakció (`runSql` tool)
> Context7: **`pg`** (node-postgres); Anthropic **tool_use / tool_result** blokkok.
- `packages/core`: `runSql(query)` tool — `pg` kliens a **`DATABASE_URL_READONLY`** kapcsolaton. Kód-szintű **SELECT-only guard** (elutasít mindent, ami nem SELECT: INSERT/UPDATE/DELETE/DDL), ellenőrzött `LIMIT`.
- `askAgent` kiegészítése **kézzel írt tool-use loppal**: `messages.create` `tools: [runSql]`-lel → ha `stop_reason === 'tool_use'`, lefuttatjuk a `runSql`-t, `tool_result`-ot visszaküldjük, loop amíg végleges szöveges válasz nem születik.
- JSONL logolás `logs/<timestamp>.jsonl` (system prompt, üzenetek, generált SQL, eredmény, válasz, token-használat) (FR4).
- **Vitest:** `runSql` guard (nem-SELECT → hiba); egy integrációs teszt valós SELECT-tel a katalóguson.
- **Teszt-checkpoint:** „mutasd a 20.000 Ft alatti, raktáron lévő szobanövényeket" → az agent SQL-t ír, lefuttatja, valós magyar választ ad; `--show-prompt` és a JSONL log ellenőrizhető. **→ felhasználó tesztel.**
- **Commit:** `feat: add read-only runSql tool and agent tool-use loop`

---

## Verifikáció (end-to-end)

- **Környezet:** `pnpm install` OK; `prisma migrate status` naprakész; `SELECT count(*) FROM products` = 30 (postgres MCP).
- **Fázisonként:** a fenti teszt-checkpointok + `pnpm nx test <projekt>` (ahol van Vitest).
- **Read-only bizonyíték:** a `runSql` guard elutasít egy `UPDATE`-et; a RO kapcsolat nem tud írni.
- **Átláthatóság:** `--show-prompt` a teljes promptot mutatja; `logs/<timestamp>.jsonl` minden interakciót rögzít.
- **Legvégső smoke:** egy csomag-összeállító kérdés (büdzsé + fény) → értelmes, akciós árat (`COALESCE(sale_price, price)`) figyelembe vevő magyar válasz.
