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

### SP2 — rag-builder — ✅ KÉSZ

App implementálva a `feat/rag-builder` ágon: markdown-heading-tudatos chunkolás + OpenAI embedding + idempotens pgvector upsert, `--dry-run`/`--force`/`stats` parancsokkal. A `--dry-run` futása a valós 202-fájlos seed-en 448 chunk generálása és 0 hiba mutatott. A valódi embedding + pgvector feltöltés az `OPENAI_API_KEY` jelenlétét igényli a gyökér `.env`-ben.

Külön `apps/rag-builder` Nx app: `seed/knowledge` beolvasás → **chunkolás** (markdown-heading-tudatos, overlappal — stratégia a spec-ben rögzítendő) → embedding (OpenAI, a `core` `embedTexts`-cel) → `document_chunks` feltöltés (idempotens, `content_hash` alapján, a `core` `upsertDocumentWithChunks`-cal). **Előfeltétel:** valódi `OPENAI_API_KEY` a gyökér `.env`-ben (jelenleg csak `.env.example`-ben placeholder).

### SP3 — Multi-agent RAG pipeline (Vercel AI SDK)

#### SP3a — motor + CLI — ✅ KÉSZ (2026-07-28)

Merged: PR #23. Tartalom: Vercel AI SDK-alapú hibrid multi-agent rendszer (`packages/core/src/lib/rag/` modul: models, router, hyde, retrieval, rerank, guardrail, answer, tools, catalog-agent, pipeline), streaming CLI + debug trace (`DEBUG=true` a stderr-re), `packages/shared` (engine-trace + chat DTO-k), guardrail küszöb `RAG_GROUNDING_THRESHOLD=0.35`. A régi kézzel írt tool-use loop (`ask-agent.ts`/`agent-tools.ts`) SP3a-ban törölve. Hiteles spec: `docs/superpowers/specs/2026-07-28-sp3a-rag-pipeline-design.md`, terv: `docs/superpowers/plans/2026-07-28-sp3a-rag-pipeline.md`.

#### SP3b — backend (Express HTTP) — ✅ KÉSZ

Az `apps/backend` Express alkalmazás (`createApp(deps)` DI-factory) a history-tudatos `runChat`-et és a `runRetrievalDebug` helpert szolgálja ki négy endpointon: `POST /api/chat` streaming válasz Vercel AI SDK v7 UI Message Stream-en (text-delta + DEBUG esetén `data-trace` + záró `data-sources`), `GET /api/debug/chunks` (tudásbázis chunk-statisztika), `POST /api/debug/search` (HyDE be/ki × rerank mátrix, `prevRank`-okkal), `GET /api/health`. Hiteles spec: `docs/superpowers/specs/2026-07-28-sp3b-backend-design.md`, terv: `docs/superpowers/plans/2026-07-28-sp3b-backend.md`.

### SP4 — frontend (React + shadcn/ui) — ✅ KÉSZ

Az `apps/frontend` React + Vite + Tailwind v4 + shadcn/ui primitívekre épülő streaming chat UI. `useChat` (AI SDK v7) egyedi transporttal, ami a history-t a backend kontraktusára lapítja (`toChatMessages`); a tranziens `data-trace` részeket `onData`/`onFinish` akkumulálja üzenetenkénti engine-trace-szé. Két mód: DEBUG=true esetén stage-címkés `StatusIndicator` + kinyitható engine-trace panel (router→hyde→retrieval→rerank→guardrail→answer, usage/hibák), DEBUG=false esetén egyszerű „Gondolkodom…” spinner és nincs trace-panel. Válaszok alatt forrás-chipek (`data-sources`). Tesztek Vitest + React Testing Library, hálózat nélkül (mockolt `useChat`). `ChatView` a belépő (`main.tsx`), a scaffold `app/` eltávolítva.

### SP5 — Költség-becslő — ✅ KÉSZ

Stage-enkénti USD-bontás a tudás-útra. Core: usage-átadás a router/hyde/rerank/answer stage-eken (`StageUsage`), a `runChat` ezekből `usage` típusú trace-eseményeket emittál stage-enként (mellékhaszon: a DEBUG engine-trace panel usage-sorai a chat fülön is), plusz egy dedikált `runCostEstimate(query, deps)`, ami a fenti négy stage mellé egy önálló `embedQueryWithUsage` hívással az embedding-usage-t is begyűjti (a chat-pipeline `Retrieve`-je tudatosan nem lett usage-gyel bővítve, YAGNI-vágás). Ár-modul (`loadModelPrices`, env-felülírással) + megosztott `computeStageCost`/DTO-k (`packages/shared`). Backend: `POST /api/debug/cost { query }` → `{ route, stages, defaultPrices }`, üres query-re 400. Frontend: tab-shell (Chat / Költség-becslő) + `CostEstimatorView` táblázattal és élő, hálózati hívás nélküli ár-szerkesztéssel. Live e2e (valódi Anthropic/OpenAI hívásokkal, valódi Postgres-szel) zöld: `POST /api/debug/cost` 5 stage-et ad vissza (router/hyde/embedding/rerank/answer) valós, nem-nulla token-számokkal és nem-üres `defaultPrices`-szel; `POST /api/chat` DEBUG=true mellett `data-trace` `usage` eseményeket streamel router/hyde/rerank/answer stage-ekhez; üres query 400-at ad.

## Környezeti kulcsok

- `ANTHROPIC_API_KEY` — megvan (agent + HyDE/rerank/answer).
- `OPENAI_API_KEY` — **SP2-től kell** (embedding). Most csak `.env.example`-ben van.
- `MAX_AGENT_ITERATIONS` (default 6), `DEBUG` (default false) — `.env`-ből.
