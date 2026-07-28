# SP3a — RAG-pipeline a `core`-ban (motor), CLI-vel meghajtva — Design

> Ez az SP3 első vertikális szelete. A hiteles felső szintű terv: `docs/rag/roadmap.md`.
> Az SP3 kettébontva: **SP3a** (ez a doksi) = a teljes multi-agent RAG-pipeline a `core`-ban,
> a CLI-vel mint meghajtó/kliens, **HTTP nélkül**; **SP3b** = Express backend, ami ezt a motort
> `POST /api/chat` streaminggel + debug endpointokkal kiteszi.

## Cél

A mai kézzel írt Anthropic tool-loopot (`ask-agent.ts`) leváltó, **Vercel AI SDK-alapú, hibrid
multi-agent RAG-pipeline** a `core`-ban, amely a `seed/knowledge` tudásbázis (RAG) **és** a
`products` katalógus (SQL) felett válaszol, streaming módon, strukturált engine-trace-szel.
A pipeline végponttól végpontig a **CLI-n keresztül** próbálható és tesztelhető, mielőtt az
SP3b HTTP-réteg ráépülne.

## Kulcsdöntések (brainstorming, 2026-07-28)

1. **SP3 kettébontva** vertikális szeletekre: SP3a = motor (core) + CLI-driver; SP3b = Express HTTP.
   Így SP3a után a teljes RAG-válasz a CLI-n végigpróbálható, egyetlen sornyi Express nélkül.
2. **Hibrid architektúra**: felül egy **LLM-router** dönti el az útvonalat (`knowledge` / `catalog`
   / `both`), a **knowledge-út viszont determinisztikus kód-pipeline** (HyDE → embed → search →
   rerank → answer → guardrail). Így a PRD kemény garanciái — „a rerank mindig lefut", „nincs
   találat → ne hallucinálj" — betarthatók és triviálisan tesztelhetők/trace-elhetők. Egy tiszta
   LLM-orchestrator ezeket nem tudná garantálni.
3. **A katalógus-út** a meglévő `runSql`/`listCategories` toolokra épül, AI SDK `tool()`-ra migrálva,
   `generateText`/`streamText` + `stopWhen: stepCountIs(maxIterations)` loopban. A `schema-context.ts`
   (products séma system prompt) **megmarad**.
4. **Modellkiosztás** (roadmap): **Haiku** = router, HyDE, rerank (olcsó); **Sonnet** = answer és a
   katalógus-agent. Anthropic a Vercel AI SDK-n át → **új dependency `@ai-sdk/anthropic`**. Embedding
   marad OpenAI `text-embedding-3-small` a meglévő `@ai-sdk/openai`-on.
5. **`packages/shared` bevezetése már most (SP3a):** a trace-esemény kontraktus + chat DTO-k tiszta,
   cross-cutting típus-package-ként. A `core` emittál, a CLI fogyaszt; SP3b/SP4 ugyanezt importálja —
   nincs későbbi core→shared költöztetés, és a függőségi irány eleve helyes (frontend → shared, nem → core).
6. **A CLI motorja lecserélődik** a streaming RAG-pipeline-ra: `ask` + interaktív mód, magyar
   hibaüzenetek, `--show-prompt` **megmarad**; a régi `ask-agent.ts` + `agent-tools.ts` (Anthropic-SDK
   tool-loop) **törlődik**. DEBUG=true → engine-trace a terminálon.
7. **A CLAUDE.md invariáns frissül**: „kézzel írt tool-use loop, nem SDK-helper" → „AI SDK-alapú
   pipeline". A `runSql` read-only + `assertSelectOnly` **kettős védelem invariáns változatlan marad**.

## Architektúra

### Új package: `packages/shared` (tiszta típus/kontraktus, zod; nincs runtime-függőség)

- `engine-trace.ts` — a trace-esemény string-literál union + payloadok + zod sémák:
  `router`, `hyde`, `retrieval`, `rerank`, `answer-start`, `answer-delta`, `guardrail`, `usage`, `error`.
- `chat.ts` — chat DTO-k az SP3b HTTP-határra előre: `ChatMessage`, `ChatRequest`,
  `RagAnswer` (a válasz + forráshivatkozások listája).

### `packages/core` bővül: `src/lib/rag/` (egy modul = egy felelősség, DI)

- `models.ts` — provider/model-registry: `@ai-sdk/anthropic` (Haiku/Sonnet) + `@ai-sdk/openai`
  (embedding). Modellnevek a configból, injektálhatóak teszthez.
- `router.ts` — LLM-router (Haiku): kérdés → `{ route: 'knowledge' | 'catalog' | 'both', reasoning }`
  (zod structured output, `generateObject`).
- `hyde.ts` — Haiku hipotetikus válasz a kérdésre (a vektorkeresés query-oldala).
- `retrieval.ts` — **kód** (nincs LLM): `embedQuery(hydeDoc)` → `searchChunks(topK)`.
- `rerank.ts` — Haiku: a top-K chunkot relevancia szerint újrarendezi/szűri → top-N.
- `answer.ts` — Sonnet, `streamText`: grounded válasz forráshivatkozással; a prompt tiltja a hallucinációt.
- `guardrail.ts` — **kód** küszöb-guard: 0 találat vagy `max(similarity) < GROUNDING_THRESHOLD`
  → magyar „a tudásbázis alapján nem tudok válaszolni" (answer-hívás nélkül).
- `catalog-agent.ts` — a katalógus-út: `streamText` a `catalogSql`+`listCategories` toolokkal,
  `stopWhen: stepCountIs(maxIterations)`. System prompt a `schema-context.ts`-ből.
- `tools.ts` — `catalogSql` (a mai `runSql` guard mögött) + `listCategories` AI SDK `tool()`-ként.
- `pipeline.ts` — az orchestrátor (`runChat`): router → route-onként a lépések; `onTrace`-re emittál;
  streamel. **Ez az SP3a fő belépője, ez váltja le az `askAgent`-et.**

### `apps/cli`

A `runChat`-et hívja, streamel a terminálba; DEBUG=true → formázott engine-trace; `--show-prompt`
megmarad; `ask` + interaktív mód marad. A régi `ask-agent.ts` + `agent-tools.ts` törlődik.

## Adatfolyam

```
question
 └ router (Haiku) ──▶ route
    knowledge / both:
      HyDE (Haiku) ─────────────▶ hydeDoc
      retrieval (kód): embedQuery(hydeDoc) → searchChunks(topK=12)
      rerank (Haiku): topK → top-N (N=5), relevancia-szűrés
      guardrail (kód): 0 találat VAGY max(similarity) < GROUNDING_THRESHOLD
                       → „tudásbázis alapján nem tudok válaszolni" (nincs answer-hívás)
      answer (Sonnet, streamText): grounded válasz + forráshivatkozások (cím / URL / fájlnév)
    catalog / both:
      catalog-agent (Sonnet + catalogSql/listCategories, stopWhen: stepCountIs)
    both: mindkét kontextus → egyetlen answer
```

- **Csak az answer-stage streamel tokent**; a korábbi stage-ek státusz-eventet emittálnak
  („Dokumentumok keresése…", „Reranking…", „Válasz generálása…").

## Kontraktusok

- **Forráshivatkozás**: a `searchChunks` SELECT-jét kiegészítjük `d.source_path`-tal (ma nincs benne)
  → `SearchResult.source_path`. Az answer cím + URL alapján hivatkozik; ha nincs URL, a fájlnév.
- **Trace**: a pipeline egy injektált `onTrace(event)` callbackre emittál (a meglévő `logger` DI-minta
  kiterjesztése). A CLI DEBUG-ban formázva kiírja. A JSONL-interakciólog megmarad (FR4).
- **Streaming**: az answer-stage `streamText` `textStream`-jét a CLI tokenenként írja; a pipeline a
  stage-váltásokat `onTrace`-en jelzi.

## Config (`loadRagConfig` bővítése; mind env-felülírható)

- `RAG_ROUTER_MODEL` / `RAG_HYDE_MODEL` / `RAG_RERANK_MODEL` — default Haiku.
- `RAG_ANSWER_MODEL` — default Sonnet.
- `RAG_TOP_K=12`, `RAG_RERANK_TOP_N=5`.
- `RAG_GROUNDING_THRESHOLD=0.35` — a 2026-07-28-i retrieval-kalibrációból (releváns találatok
  cosine-similarityje ~0.53–0.69; a küszöb reálisan ~0.35–0.40 alá).
- `MAX_AGENT_ITERATIONS` — a katalógus-agent és a pipeline felső korlátja (megvan, default 6).

Az `.env.example` a fenti kulcsokkal bővül (dokumentált default-értékekkel).

## Hibakezelés

- Boundary-validáció **zod**-dal: router/rerank structured output, tool-input, config.
- LLM/DB-hiba → `error` trace-event + magyar felhasználói üzenet; a pipeline nem omlik össze,
  ahol értelmes, ott degradál (pl. rerank hiba → a nyers retrieval-sorrend megy tovább).
- Embedding/DB hiány → tiszta magyar hiba (mint ma).
- A katalógus-út `assertSelectOnly` + read-only kapcsolat védelme **változatlan**.

## Teszt (Vitest, DI-fake-ek, hálózat/DB nélkül — mint `ask-agent.spec.ts`)

- `router` / `hyde` / `rerank` / `answer` fake modellel (determinisztikus kimenet).
- `retrieval` fake `searchChunks`-kal; `guardrail`-küszöb egységteszt (határérték alatt/felett/0 találat).
- `pipeline`-integráció fake-ekkel: `knowledge`, `catalog`, `both`, és a „nincs találat" ág.
- Trace-esemény **sorrend** assert (a stage-ek helyes sorozatban emittálnak).
- `shared` zod-sémák round-trip tesztje.

## Dokumentáció

- `CLAUDE.md`: a tool-use loop invariáns → „AI SDK-alapú pipeline"; a `runSql` read-only kettős
  védelem invariáns változatlan; új env-kulcsok és `rag/` modulstruktúra említése.
- `docs/rag/roadmap.md`: SP3 státusz frissítése (SP3a folyamatban/kész, SP3b következő).

## Ki van zárva az SP3a-ból (SP3b/SP4)

- Express szerver, `POST /api/chat`, debug HTTP-endpointok, engine-trace data-stream (SP3b).
- React frontend, `useChat`, trace-panel (SP4).
- Contextual chunk header re-embed (retrieval-minőség méréssel, később; jelenleg body-only embedding).
