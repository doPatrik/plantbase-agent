# Plantbase 🌿

Természetes nyelvű, parancssori AI-agent egy növény-katalógus felett. A felhasználó
magyarul kérdez (pl. _„Hány pozsgás van raktáron?”_), az agent a kérdésből SQL-t
generál, **read-only** kapcsolaton lefuttatja a `products` táblán, majd magyar nyelvű,
adatokkal alátámasztott választ ad.

Az agent **kézzel írt tool-use loopot** használ az Anthropic SDK fölött (nincs
agent-framework), és minden interakciót JSONL-be naplóz az átláthatóságért.

---

## Tartalom

- [Hogyan működik](#hogyan-működik)
- [Architektúra](#architektúra)
- [Biztonság: csak SELECT](#biztonság-csak-select)
- [Adatmodell](#adatmodell)
- [Előfeltételek](#előfeltételek)
- [Beüzemelés lépésről lépésre](#beüzemelés-lépésről-lépésre)
- [A CLI használata](#a-cli-használata)
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
  askAgent  ──►  Anthropic API  ──►  stop_reason: "tool_use"?
        ▲                                   │ igen
        │                                   ▼
        │                         tool dispatch (név szerint)
        │                         ├─ runSql          → read-only SELECT a katalóguson
        │                         └─ listCategories  → distinct kategóriák
        │                                   │
        └──────────  tool_result  ◄─────────┘
        │
        ▼ (stop_reason: "end_turn")
   magyar nyelvű válasz  +  logs/<timestamp>.jsonl
```

1. A kérdés a teljes **system prompttal** (séma-kontextus + SQL-szabályok + tool-leírások)
   megy a modellhez.
2. Amíg a modell `tool_use`-t kér, a loop a megfelelő toolt lefuttatja (read-only),
   és a `tool_result`-ot visszaküldi.
3. Amikor a modell végleges szöveges választ ad (`end_turn`), azt kiírjuk a felhasználónak.
4. Egy felső lépéskorlát (`maxSteps`, alapból 8) véd a végtelen loop ellen.

## Architektúra

Nx + pnpm monorepo, három munkaterülettel:

| Csomag              | Felelősség                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`packages/core`** | Az agent logikája: `askAgent` (kézzel írt tool-use loop), `runSql` és `listCategories` toolok, tool-registry, system prompt (`schema-context`), config, JSONL logger. |
| **`packages/db`**   | Prisma lib: a `products` séma, migrációk, seed (30 növény). **Csak** séma/migráció/seed.                                                                              |
| **`apps/cli`**      | A CLI belépési pont (commander + `node:readline`): `ask` parancs + interaktív mód.                                                                                    |

**Architekturális invariánsok** (részletek: [`CLAUDE.md`](CLAUDE.md), [`docs/architektura.md`](docs/architektura.md)):

- Az agent **kézzel írt** tool-use loopot használ (`client.messages.create` + `stop_reason: 'tool_use'`),
  **nem** SDK-helpert és nem agent-frameworköt.
- A `runSql` **`pg`-vel** fut a **read-only** kapcsolaton (`DATABASE_URL_READONLY`), **nem** Prisma-n át.
  A Prisma csak séma/migráció/seed a read-write `DATABASE_URL`-en.
- Az eszközkészlet **tool-registry**, a loop név szerint dispatch-el; új tool = egy új sor a
  `buildAgentTools`-ban (lásd [ADR-0001](docs/adr/0001-tool-registry-dispatch.md)).

## Biztonság: csak SELECT

Az agent által futtatott lekérdezésekre **kettős védelem** vonatkozik:

1. **DB read-only role (elsődleges).** A `plantbase_ro` szerepkör kizárólag `SELECT`-et kap —
   se `INSERT/UPDATE/DELETE`, se DDL. Létrehozás: [`docker/initdb/01-readonly-role.sql`](docker/initdb/01-readonly-role.sql).
2. **Kód-szintű `assertSelectOnly` guard (defense-in-depth).** Csak egyetlen `SELECT`
   (vagy `WITH ... SELECT`) utasítás engedélyezett; a tiltott kulcsszavak (`insert`, `update`,
   `delete`, `drop`, `alter`, `create`, `truncate`, `grant`, …) és a több utasítás elutasításra kerül.

Titkok kizárólag a repo-gyökér `.env`-jében élnek (gitignore); a kód `find-up`-pal
találja meg a gyökeret és a `.env`-et, így a CLI bárhonnan futtatható a monorepón belül.

## Adatmodell

A katalógus egyetlen `products` táblaként van modellezve. A domain-szótár a
[`CONTEXT.md`](CONTEXT.md)-ben él. A séma (kivonat, [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)):

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

## Előfeltételek

- **Node.js** 20+ és **pnpm**
- **Docker** (lokális Postgres-hez) — vagy egy meglévő Postgres 17
- **Anthropic API kulcs**

## Beüzemelés lépésről lépésre

```bash
# 1. Függőségek
pnpm install

# 2. Lokális Postgres (RW 'plantbase' + RO 'plantbase_ro', host port 5433)
docker compose up -d          # csak ha nincs már futó Postgres a gépeden

# 3. Környezeti változók
cp .env.example .env          # töltsd ki az ANTHROPIC_API_KEY-t

# 4. Séma + seed (a Prisma a packages/db-ben van, ezért a gyökér .env-et be kell tölteni)
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate dev --schema=prisma/schema.prisma
pnpm --filter @plantbase/db exec prisma db seed          # 30 növény
```

> **Port:** a host `5433` → konténer `5432` (a `5432`-t egy másik projekt foglalhatja).
> A read-only role csak az **első** konténer-indításkor jön létre (üres adatkönyvtár mellett).

## A CLI használata

Buildelt artefaktból, a gyökérből:

```bash
pnpm plantbase:build                        # nx build cli → apps/cli/dist/main.js
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

Példák:

```bash
pnpm plantbase ask "Melyik növény a legolcsóbb, ami házikedvenc-barát?"
pnpm plantbase ask "Hány kaktusz van raktáron 3000 Ft alatt?"
pnpm plantbase ask "Sorold fel a légtisztító szobanövényeket értékelés szerint csökkenő sorrendben."
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
a felhasználói kérdés, az asszisztens válaszai, a tool-hívások és -eredmények, valamint a
token-használat. Ez teszi utólag auditálhatóvá, hogy az agent milyen SQL-t futtatott és miért.

## Környezeti változók

A `.env.example`-ből másold `.env`-be. Kötelező és opcionális változók:

| Változó                 | Kötelező         | Leírás                                                                                          |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | ✅               | Az Anthropic API kulcs.                                                                         |
| `ANTHROPIC_MODEL`       | —                | Modell azonosító (alapból `claude-sonnet-4-6`; költségérzékeny demóhoz pl. `claude-haiku-4-5`). |
| `DATABASE_URL`          | migráció/seedhez | Read-write kapcsolat — a Prisma ezzel viszi a sémát, migrációt, seedet.                         |
| `DATABASE_URL_READONLY` | ✅               | Read-only kapcsolat — az agent `runSql`-je ezen fut (csak SELECT).                              |

## Dokumentáció

- [`CLAUDE.md`](CLAUDE.md) — projekt-áttekintés és architekturális invariánsok
- [`CONTEXT.md`](CONTEXT.md) — a domain nyelve (ubiquitous language)
- [`docs/architektura.md`](docs/architektura.md) — architektúra
- [`docs/stack.md`](docs/stack.md) — technológiai stack
- [`docs/konvenciok.md`](docs/konvenciok.md) — konvenciók
- [`docs/dev-workflow.md`](docs/dev-workflow.md) — fejlesztői munkafolyamat
- [`docs/adr/`](docs/adr/) — architektúra-döntések (ADR-ek)

## Licenc

MIT
