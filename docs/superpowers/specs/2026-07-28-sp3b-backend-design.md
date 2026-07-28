# SP3b — Backend (Express HTTP) — Design

> Al-projekt az RAG-átalakítás roadmapjéből (`docs/rag/roadmap.md`, SP3b).
> Előfeltétel: SP3a kész (merged PR #23) — a `runChat` motor + `@plantbase/shared` trace/DTO kontraktus áll a HTTP-réteg alatt.
> Kapcsolódó: SP3a spec `docs/superpowers/specs/2026-07-28-sp3a-rag-pipeline-design.md`.

## Cél

A kész RAG-motort (`runChat`) egy **Express HTTP-réteg** teszi ki: `POST /api/chat` streaming válasz (Vercel AI SDK v7 UI Message Stream) + debug endpointok. A backend a későbbi SP4 React frontend (`useChat`) HTTP belépője. Egyúttal a motor **history-tudatossá** válik (multi-turn), mert a chat-kérés természetesen üzenet-lista.

Lokális reference implementáció: nincs auth, rate-limit, felhő-deploy vagy perzisztens session-tár.

## Scope

1. **Core-változtatás:** history-tudatos `runChat` — a bemenet üzenet-lista (`ChatMessage[]`), nem egyetlen string.
2. **Új Nx app `apps/backend`:** Express + AI SDK v7; `POST /api/chat`, `GET /api/debug/chunks`, `POST /api/debug/search`, `GET /api/health`.
3. **Core debug-helper:** `runRetrievalDebug(query, deps)` — HyDE ki/be × rerank előtt/után összehasonlító mátrix.
4. **CLI igazítás:** a bővült `runChat` szignatúrához (a `main` marad zöld).

A `@plantbase/shared` DTO-k (`ChatRequest`/`RagAnswer`/`TraceEvent` + zod-sémák) már készen állnak; kiegészülnek a debug-search válasz DTO-jával.

## Architektúra

### 2.1 Core: history-tudatos `runChat`

A jelenlegi `runChat(question: string, deps)` átáll `runChat(messages: readonly ChatMessage[], deps)`-re. A motor a `messages`-ből deriválja a latest `question`-t (utolsó `user` üzenet content-je); üres/nem-user zárás → boundary-hiba a hívó felé.

A history **csak** azoknak a stage-eknek megy tovább, amelyeknek érdemi haszna van; a többi a latest question/hydeDoc-on marad:

| Stage          | Kap history-t? | Miért                                      |
| -------------- | -------------- | ------------------------------------------ |
| `router`       | ✅             | Follow-up routing (pl. „és a kaktuszok?")  |
| `hyde`         | ✅             | Kontextus-tudatos hipotetikus dokumentum   |
| `retrieve`     | ❌             | A hydeDoc-on/embeddingen dolgozik          |
| `rerank`       | ❌             | A latest question relevanciájára rangsorol |
| `guardrail`    | ❌             | Küszöb-döntés a similarity-n               |
| `answer`       | ✅             | Koherens többfordulós válasz               |
| `catalogAgent` | ✅             | Natív `messages`-ként a `streamText`-nek   |

A stage-interfészek minimálisan bővülnek: az érintett stage-ek egy opcionális `history` (vagy teljes `messages`) paramétert kapnak a promptépítéshez. A DI-fake minta és a stage-tesztek ennek megfelelően frissülnek. A `retrieve`/`rerank`/`guardrail` változatlan.

A `ChatRun` visszatérés (`{ textStream, result }`) és a `RagAnswer` alak nem változik.

### 2.2 Backend: `apps/backend` (Express + AI SDK v7)

Nx Node-app, esbuild-build (a `rag-builder` mintájára). Belépő `src/main.ts`: betölti a `.env`-et (findUp), felépíti a valós függőségeket (`createDefaultChatDeps`, knowledge-store), `createApp(deps)`-szel példányosítja az Express appot, és a `PORT` (default 3000) porton figyel. Graceful shutdown: `SIGINT`/`SIGTERM` → pool-zárás (`closePool`, `closeKnowledgePool`).

**`createApp(deps): express.Express`** — DI-factory. `deps`: `{ runChat, runRetrievalDebug, getChunkStats, debug }` (+ közös middleware). A HTTP-tesztek fake `deps`-szel + `supertest`-tel futnak, hálózat/DB nélkül.

Közös middleware: `express.json()` body-parser, központi error-handler (JSON `{ error }` + megfelelő státusz), zod-validáció a határon minden body-ra.

### 2.3 Endpointok

**`POST /api/chat`**

- Body: `chatRequestSchema` (zod) → `{ messages: ChatMessage[] }`. Hibás → 400 `{ error }`.
- `runChat(messages, deps)` → AI SDK v7 **UI Message Stream**:
  - `createUIMessageStream({ execute })` + `createUIMessageStreamResponse(...)` (a pontos v7 API-t implementáció előtt Context7-tel ellenőrizzük).
  - `writer.write` **text** partokkal a `run.textStream` tokenjeire.
  - `onTrace` → **`data-trace`** típusú custom data-partok, **csak ha `DEBUG=true`**.
  - A `run.result` beteljesülésekor egy **`data-sources`** custom data-part: `{ route, sources }`.
- Response header: `Content-Type: text/event-stream` (a helper állítja be).

**`GET /api/debug/chunks`**

- `getChunkStats(RO)` → dokumentum-/chunk-szám, embedding-lefedettség, chunk-méret-statisztika. OpenAI-kulcs **nem** kell.

**`POST /api/debug/search`**

- Body: `{ query: string, topK?: number, rerankTopN?: number }` (zod). Hibás → 400.
- `runRetrievalDebug(query, deps)` → **HyDE ki/be × rerank előtt/után** összehasonlító mátrix:
  ```jsonc
  {
    "query": "...",
    "hydeDoc": "...",                 // a HyDE-bővítés, amit a hyde ág használt
    "raw":  { "retrieval": [Hit...], "rerank": { "degraded": false, "results": [RerankedHit...] } },
    "hyde": { "retrieval": [Hit...], "rerank": { "degraded": false, "results": [RerankedHit...] } }
  }
  ```
  - `Hit`: `{ rank, documentId, title, headingPath, sourcePath, similarity, contentPreview }`.
  - `RerankedHit`: `Hit` + `prevRank` (a nyers retrieval-beli helye) → közvetlenül látszik az átrendezés.
  - `raw` = a query nyers embeddingje; `hyde` = a HyDE-dok embeddingje. Mindkét ágon ugyanaz a `searchChunks` + `rerank` stage fut, így a HyDE és a rerank hatása külön-külön összevethető.
- OpenAI-kulcs **kell** (embedding); hiánya → 503 értelmes üzenettel.

**`GET /api/health`**

- Liveness/readiness: DB-pool ping (RO), env-kulcsok jelenléte (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). `{ status: 'ok' | 'degraded', checks: {...} }`.

### 2.4 Core debug-helper

`runRetrievalDebug(query, deps)` a `packages/core`-ban (a `rag/` modulban). Injektálható deps: `{ embedQuery, searchChunks, hyde, rerank, topK, rerankTopN }` — a `createDefaultChatDeps`-hez hasonló default wiringgel. Visszaadja a 2.3-beli mátrix-objektumot. Tiszta függvény DI-fake-ekkel tesztelhető.

### 2.5 Shared DTO-k

A `@plantbase/shared`-be új: `retrievalDebugRequestSchema` + `RetrievalDebugResult` (a fenti mátrix) zod-sémával, hogy a backend a határon validálhasson és az SP4 frontend is típusosan fogyaszthassa. A `data-trace`/`data-sources` custom-part payloadok a meglévő `traceEventSchema` / `ragAnswerSchema`-ra épülnek.

## Adatáramlás (chat)

```
HTTP POST body
  → express.json()
  → chatRequestSchema (zod)               [400 ha hibás]
  → messages
  → runChat(messages, deps)               → { textStream, result }
  → createUIMessageStream:
       textStream tokenjei     → text partok
       onTrace(event)          → data-trace partok        [csak DEBUG]
       result (route+sources)  → data-sources part        [a stream végén]
  → createUIMessageStreamResponse          (text/event-stream)
```

SP4-ben ugyanezt a `useChat` közvetlenül fogyasztja.

## Hibakezelés

- **Boundary-validáció:** minden body zod-dal; hibás → 400 `{ error: <zod-üzenet> }`.
- **Stream közbeni hiba:** a pipeline-hiba egy `data-trace` `error`-eseményként (a shared union már tartalmazza) megy ki, majd a stream rendezetten lezárul. A már elküldött tokenek megmaradnak.
- **Endpoint-hibák:** központi error-handler → JSON `{ error }` + megfelelő státusz (400 validáció, 503 hiányzó OpenAI-kulcs, 500 egyéb).
- **Graceful shutdown:** signal → pool-zárás, majd exit.

## Tesztelés

Vitest + `supertest` (új dev-dep), a meglévő DI-fake minta szerint, hálózat/DB nélkül:

- **`POST /api/chat` happy path:** fake `runChat` ismert tokeneket streamel + `result` → az SSE-válaszban a text-partok, `data-sources` part helyes; `DEBUG=true`/`false` → `data-trace` partok jelenléte/hiánya.
- **`POST /api/chat` validáció:** üres `messages`, rossz `role` → 400.
- **`GET /api/debug/chunks`:** fake `getChunkStats` → JSON helyes.
- **`POST /api/debug/search`:** fake `runRetrievalDebug` → a mátrix-alak helyes; rossz body → 400; „nincs OpenAI-kulcs" ág → 503.
- **`GET /api/health`:** ok / degraded ágak fake-ekkel.
- **Core `runRetrievalDebug`** és a bővült stage-ek (router/hyde/answer/catalog history-ág) egység-tesztjei DI-fake-ekkel.

## Nem cél (YAGNI)

- Nincs auth, rate-limit, finomhangolt CORS (lokális reference).
- Nincs perzisztens session-/history-tár (a history a kérés `messages`-éből jön).
- Nincs SP4 frontend (külön al-projekt).
- Per-stage `usage` trace-esemény emittálása továbbra is elhalasztva (a union definiálja, a pipeline még nem küldi).
- Contextual chunk-header re-embed továbbra is elhalasztva.

## Környezeti kulcsok

- `PORT` — a backend portja (default 3000). Új, `.env.example`-be.
- `DEBUG` — ha `true`, a `/api/chat` stream `data-trace` partokat is küld.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL_READONLY`, `RAG_*` — mint eddig.
