# Multi-Agent RAG — Roadmap & Requirements

> Ez a dokumentum a "production-szintű Multi-Agent RAG Chat" átalakítás **hiteles, verziózott terve**:
> az eredeti követelmények (PRD), a kulcsdöntések, a cél-architektúra és a 4 al-projekt státusza.
> Új session / új közreműködő innen tudja meg, mi a cél és hol tartunk.
>
> Kapcsolódó: `docs/superpowers/specs/2026-07-27-rag-foundations-design.md` (SP1 spec + cél-arch),
> `docs/superpowers/plans/2026-07-27-rag-foundations.md` (SP1 terv).

## Cél

A jelenlegi CLI SQL-agentet egy **production-ready, skálázható, multi-agent RAG chat-rendszerré** fejlesztjük,
amely a `seed/knowledge` (202 markdown növénygondozási cikk) tudásbázis **és** a meglévő `products`
katalógus felett válaszol, streaming módon.

## Kulcsdöntések (brainstorming, 2026-07-27)

1. **Teljes migráció a Vercel AI SDK-ra** — a meglévő kézzel írt tool-use loopot (`ask-agent.ts`) is átírjuk; egységes stack. (Ténylegesen az SP3-ban történik.)
2. **RAG + SQL egy rendszerben** — a knowledge-base RAG a fő, de a `products` SQL tool megmarad az orchestrator egyik eszközeként; a chat gondozási ÉS katalógus-kérdésre is válaszol.
3. **OpenAI `text-embedding-3-small` (1536 dim) embedding + Claude Haiku rerank/HyDE**; Answer/Orchestrator Claude Sonnet. Új kulcs: `OPENAI_API_KEY`.
4. **Lokális reference implementáció** — production-grade kód/architektúra, egy-felhasználós, lokálisan futtatható; nincs auth és felhő-deploy.
5. **A CLI (`apps/cli`) megmarad** vasékony kliensként a megosztott, migrált `core` felett.

## Cél-architektúra (monorepo)

**Alkalmazások (`apps/`)**

- `frontend` — React + Vite + Vercel AI SDK UI (`useChat`) + shadcn/ui; ChatGPT-szerű streaming chat + DEBUG engine-trace panel.
- `backend` — Express + Vercel AI SDK; `POST /api/chat` (streaming) + debug endpointok; az orchestrator HTTP belépője.
- `rag-builder` — Node CLI; `seed/knowledge` → chunkolás → embedding → pgvector upsert (idempotens).
- `cli` _(marad)_ — a megosztott `core`-t használja, streaming a terminálba.

**Könyvtárak (`packages/`)**

- `core` — multi-agent rendszer Vercel AI SDK-ra: Orchestrator + agentek (HyDE, Retrieval, Rerank, Answer, Guardrail) + toolok (`catalogSql`, `knowledgeSearch`); modell-/provider-registry.
- `db` — Prisma: `products` + `documents`/`document_chunks` séma + migráció + seed.
- `shared` _(új, SP3/SP4)_ — megosztott típusok/kontraktusok: engine-trace esemény-típusok, API DTO-k, zod-sémák a határon.

**Invariáns:** Prisma = séma/migráció/seed; a **futásidejű vektorkeresés `pg`-vel** megy (RO a keresés, RW az embedding-írás). Lásd `CLAUDE.md`.

## Eredeti követelmények (PRD — a részletes forrás SP2–SP4-hez)

**Lekérdezési pipeline:** Felhasználó → Orchestrator → HyDE (olcsó LLM hipotetikus választ generál) → embedding → vector search → Retrieval Agent → Reranking → Answer Agent → Guardrails → **streaming** válasz.

**Multi-agent elvek:**

- Központi **Orchestrator** fogadja a kérést, kiválasztja/delegálja az agenteket, koordinálja a workflow-t.
- Minden agent **egy jól definiált feladatért** felel (Retrieval, HyDE, Reranking, Answer, Guardrail).
- Az agentek **kizárólag toolokon keresztül** kommunikálnak; az orchestrator hívja őket, közvetlenül nem beszélnek egymással.
- **Agent loop** felső korláttal: `MAX_AGENT_ITERATIONS` (több lépéses gondolkodás, de nincs végtelen ciklus).

**HyDE:** a user kérdéséből egy **olcsó** modell (Claude Haiku) hipotetikus választ generál, azt embeddeljük, azzal keresünk.

**Reranking:** a retrieval után **kötelező**; csak a rerankelt dokumentumok mennek az Answer Agenthez (relevancia ↑, zaj ↓).

**Guardrails minden agenten:** hibás működés / irreleváns válasz / hallucináció / jogosulatlan tool-hívás kiszűrése. Ha a tudásbázis nem tartalmaz megfelelő infót, az LLM **ne találjon ki** választ — jelezze egyértelműen, hogy a tudásbázis alapján nem tud válaszolni.

**Debug endpointok (backend):**

- _Chunk debug:_ hány chunk készült, chunk-méretek, chunk-tartalom, embedding-állapot.
- _Vector search debug:_ tetszőleges query embeddinggel keresés → top találatok, similarity score, chunk-tartalom, document id.

**DEBUG mód (`DEBUG=true`, `.env`-ből):** a frontend chatben részletes, valós idejű **"engine trace"** jelenjen meg — időrendben, színekkel, ikonokkal, összehajtható blokkokban: melyik agent futott, milyen tool hívódott (input/output), vector search eredmények + similarity, reranking eredménye, LLM promptok (ha biztonságos), SQL + PostgreSQL válaszok, futási idő, token-felhasználás, modellnevek, embedding-modell, chunk-kiválasztás, guardrail-döntések.

**Streaming & loading:** a válasz mindig streamelve érkezik; a felhasználó soha ne lásson üres képernyőt — folyamatos állapot-visszajelzés (pl. "Dokumentumok keresése…", "Reranking…", "Válasz generálása…").

**Chunkolás:** a dokumentumtípushoz legjobban illő stratégia — magas retrieval-pontosság, minimális információvesztés, megfelelő méret + overlap.

**Általános:** tiszta architektúra, SOLID, szétválasztott felelősségek, moduláris, tesztelhető, erős típusosság, hibakezelés, részletes logolás, konfigurálhatóság, karbantarthatóság.

## Al-projektek és státusz

Minden al-projekt saját ciklust kap: **brainstorming → spec (`docs/superpowers/specs/`) → terv (`docs/superpowers/plans/`) → subagent-implementáció → PR**.

### SP1 — Alapok (pgvector + knowledge séma + provider-config) — ✅ KÉSZ

Merged: PR #17 (`main`, 2026-07-27). Tartalom: pgvector infra, `documents`/`document_chunks` séma + HNSW cosine index, kompozálható config (`loadEmbeddingConfig`/`loadRagConfig`), `embedding.ts` (Vercel AI SDK + OpenAI), `knowledge-store.ts` (`pg` upsert/search/stats).

### SP2 — rag-builder — ⏳ KÖVETKEZŐ

Külön `apps/rag-builder` Nx app: `seed/knowledge` beolvasás → **chunkolás** (markdown-heading-tudatos, overlappal — stratégia a spec-ben rögzítendő) → embedding (OpenAI, a `core` `embedTexts`-cel) → `document_chunks` feltöltés (idempotens, `content_hash` alapján, a `core` `upsertDocumentWithChunks`-cal). **Előfeltétel:** valódi `OPENAI_API_KEY` a gyökér `.env`-ben (jelenleg csak `.env.example`-ben placeholder).

### SP3 — backend (Express + Vercel AI SDK multi-agent) — ⏳ TERVEZETT

Orchestrator agent-loop (`stopWhen: stepCountIs(MAX_AGENT_ITERATIONS)`) + agentek toolként (HyDE, Retrieval, Rerank, Answer, Guardrail) + `catalogSql` (a meglévő `runSql` migrálva) + `knowledgeSearch`. `POST /api/chat` streaming, debug endpointok, DEBUG engine-trace a data-stream mellékcsatornáján. A meglévő `ask-agent.ts` Vercel AI SDK-ra migrálása itt történik. `shared` package bevezetése.

### SP4 — frontend (React + shadcn/ui) — ⏳ TERVEZETT

ChatGPT-szerű streaming UI (`useChat`), loading-state visszajelzés, DEBUG engine-trace panel (collapsible, ikonok, időrend).

## Környezeti kulcsok

- `ANTHROPIC_API_KEY` — megvan (agent + HyDE/rerank/answer).
- `OPENAI_API_KEY` — **SP2-től kell** (embedding). Most csak `.env.example`-ben van.
- `MAX_AGENT_ITERATIONS` (default 6), `DEBUG` (default false) — `.env`-ből.
