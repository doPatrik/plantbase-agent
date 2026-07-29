# SP5 — Költség-becslő (per-lekérdezés költség-bontás) — Design

> Al-projekt az RAG-rendszer bővítéseként (a felhasználó kérésére, az SP1–SP4 ív lezárása után).
> Előfeltétel: SP4 kész (PR #26, `feat/sp4-frontend`) — a frontend + `useChat` + backend adott. Az SP5 a `feat/sp4-frontend`-re épül (mert a frontendet és a pipeline-t bővíti).
> Kapcsolódó: SP3a pipeline (`packages/core/src/lib/rag/`), SP3b backend (`apps/backend`), SP4 frontend (`apps/frontend`).

## Cél

Egy **külön „Költség-becslő" fül** a frontendben: beírsz egy kérdést, lefut a **tudás-út (RAG) teljes pipeline-ja**, és egy táblázatot kapsz — **stage-enként** (router / HyDE / embedding / rerank / válasz) a **modell**, az **input/output token**, és az abból számolt **USD** — plusz a **végösszeg**. A cél: reprezentatív kérdéseken mérve **részletes költségvetési terv** készíthető.

Lokális reference-eszköz: valódi LLM/embedding-hívásokat futtat (minden becslés pénzbe kerül — ez elkerülhetetlen a pontos token-számhoz). Csak a tudás-út (a katalógus-út SQL-költsége nem cél).

## Scope

1. **Core — usage-átadás:** a stage-ek injektálható függvényei a token-`usage`-et is visszaadják (ma eldobják). Érintett: `router`, `hyde`, `embedding`, `rerank`, `answer`. (`guardrail`/`retrieve` nem generál LLM/embedding-költséget.)
2. **Core — `usage` trace-emisszió:** a pipeline stage-enként emittálja a `usage` trace-eseményt (az SP3b-ben elhalasztott elem). Mellékhaszon: a chat DEBUG trace-panelben is megjelennek a 🔢 usage-sorok (a `describeTrace` már kezeli).
3. **Core — `runCostEstimate(query, deps)`:** lefuttatja a tudás-utat (router + kényszerített knowledge-ág: HyDE → embed → retrieve → rerank → answer), a válasz-streamet végigolvassa, és visszaadja a stage-enkénti usage-t (stage, modell, in/out token).
4. **Core — ár-modul:** modellenkénti default listaár a configban, env-felülírással; a token→USD számítás pure util.
5. **Shared — DTO-k:** `CostEstimate` (zod-validált) a `POST /api/debug/cost` válaszához + `computeStageCost` pure util (a frontend használja).
6. **Backend — `POST /api/debug/cost`:** nem-streamelő endpoint; body `{ query }`, válasz a stage-enkénti usage + a config default árak.
7. **Frontend — „Költség-becslő" fül:** tab-shell (Chat | Költség-becslő); a fül lefuttatja a becslést, táblázatban rendereli az usage-t, és a **default árakból seedelt, szerkeszthető ár-mezőkkel** élőben számolja a költséget + végösszeget.

Nem cél (YAGNI): katalógus-út költsége; vetítés (havi/éves projekció); költség-perzisztencia/history; a `/api/debug/cost` streamelése.

## Architektúra

### 1. Core: usage-átadás a stage-ekben

A jelenlegi wrapperek eldobják a usage-t (pl. a HyDE `GenerateTextFn` csak `{ text }`-et, az `EmbedManyFn` csak `number[][]`-t ad). Kiszélesítjük őket, hogy a usage is átjöjjön. A precedens: a rag-builder `embedTextsWithUsage`-e már ad `usage.tokens`-t.

Egységes usage-alak (belső, core): `interface StageUsage { readonly stage: string; readonly model: string; readonly inputTokens: number; readonly outputTokens: number; }`. Az embeddingnél `outputTokens = 0` (nincs kimenet), az `inputTokens` az embeddelt szöveg tokenszáma.

A Vercel AI SDK-ból a usage:

- `generateObject` / `generateText` / `streamText` → `result.usage` (`{ inputTokens, outputTokens, totalTokens }` az AI SDK v5+/v7-ben; a pontos mezőneveket a terv-fázisban a telepített `ai@7.0.37` ellen ellenőrizzük).
- `embedMany` → `usage.tokens` (csak input).
- A `streamText` usage-e a stream **teljes elfogyasztása után** áll rendelkezésre (`await result.usage`), ezért a becslő végigolvassa a válasz-streamet.

A DI-fake minta megmarad: a fake stage-fn-ek usage-t is visszaadnak (tesztelhetőség hálózat nélkül). A meglévő `ChatRun`/`RagAnswer` alak és a `runChat` viselkedése **nem változik** — a usage a stage-fn visszatérésén és az `onTrace`-en jön, a chat-válasz felületén nem.

### 2. Core: `usage` trace-emisszió

A pipeline stage-enként `onTrace({ type: 'usage', stage, model, inputTokens, outputTokens })`-t emittál (a shared `traceEventSchema` már tartalmazza ezt a variánst). Ez teszi mérhetővé a chat DEBUG-panelben is a költséget, és ezt gyűjti a `runCostEstimate`.

### 3. Core: `runCostEstimate`

```
runCostEstimate(query: string, deps): Promise<readonly StageUsage[]>
```

Lefuttatja: router (usage) → HyDE (usage) → embed(hydeDoc) (usage) → retrieve (nincs költség) → rerank (usage) → answer (streamText; a stream végigolvasása után usage). A knowledge-ág **kényszerített** (a router usage-e számít — mert minden kérdésnél lefut —, de a becslő mindig a tudás-utat méri, a scope szerint). A stage-enkénti `StageUsage[]`-et adja vissza, a stage-ekhez tartozó modellnevekkel (a config-ból).

Megjegyzés: a becslő újrahasznosítja a meglévő stage-eket (nem másolja a pipeline-logikát); a knowledge-ág lépéseit hívja sorban a usage-gyűjtő wrapperrel.

### 4. Core: ár-modul (config)

Default listaárak (a claude-api skill 2026-os árai alapján), USD / 1M token:

| Modell                                  | input $/1M | output $/1M |
| --------------------------------------- | ---------- | ----------- |
| `claude-haiku-4-5` (router/hyde/rerank) | 1.00       | 5.00        |
| `claude-sonnet-4-6` (válasz)            | 3.00       | 15.00       |
| `text-embedding-3-small` (embedding)    | 0.02       | —           |

Env-felülírás (a meglévő `OPENAI_EMBEDDING_PRICE_PER_M` mintájára), pl. `RAG_PRICE_HAIKU_INPUT_PER_M`, `RAG_PRICE_HAIKU_OUTPUT_PER_M`, `RAG_PRICE_SONNET_INPUT_PER_M`, `RAG_PRICE_SONNET_OUTPUT_PER_M`, és a meglévő `OPENAI_EMBEDDING_PRICE_PER_M` az embeddinghez. A config a modell-ID → `{ inputPerM, outputPerM }` map-et adja; a nem-ismert modell hiánya a becslőben null-árként jelenik meg (a UI jelzi).

### 5. Shared: DTO-k + `computeStageCost`

```ts
interface StageUsageDto {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}
interface CostEstimate {
  query: string;
  route: 'knowledge'; // a becslő mindig a tudás-utat méri
  stages: readonly StageUsageDto[];
  defaultPrices: Readonly<Record<string, ModelPrice>>; // modell-ID → ár
}
// pure util (a frontend számol vele, hogy az élő ár-szerkesztés újraszámoljon):
function computeStageCost(
  usage: StageUsageDto,
  price: ModelPrice | undefined,
): { inputCostUsd: number; outputCostUsd: number; totalUsd: number };
```

Mind zod-sémával a határon. A `computeStageCost` a `shared`-ben él (a frontend és bárki más használhatja); képlet: `inputTokens / 1e6 * inputPerM` (+ output analóg). Ár nélkül (ismeretlen modell) a költség `null`/0 + a UI jelzi.

### 6. Backend: `POST /api/debug/cost`

Nem-streamelő. Body `{ query }` (zod: nem-üres string). Válasz `CostEstimate`: lefuttatja a `runCostEstimate`-et, a stage-usage-t DTO-ra mappeli, és hozzáadja a config `defaultPrices`-t (hogy a frontend seedelni tudja a szerkeszthető ár-mezőket). Hiba (pl. hiányzó `OPENAI_API_KEY`) → 503/500 a meglévő `isMissingKeyError` mintára. A DI-factory (`createApp(deps)`) kap egy új `costEstimate(query)` depet; supertesttel, fake deps-szel tesztelhető.

### 7. Frontend: „Költség-becslő" fül

- **Tab-shell:** a `main.tsx`/egy vékony `App` egy egyszerű nézet-váltót kap (Chat | Költség-becslő) — nincs router, csak `useState` a nézetre.
- **`CostEstimatorView`:** input + „Becslés" gomb → `POST /api/debug/cost`; a válasz `stages` usage-ét táblázatban rendereli; a `defaultPrices`-ból **seedelt, szerkeszthető** ár-mezők (modell → input/output $/1M); a költség + végösszeg a `computeStageCost`-tal **élőben** (ár-szerkesztésre azonnal újraszámol, LLM-hívás nélkül).
- Loading/hibaállapot (a `useChat`-hez hasonlóan, de sima `fetch`-csel). UI-szöveg magyarul.

## Tesztelés

- **Core:** usage-átadó stage-tesztek (DI-fake, ami usage-t is ad); `runCostEstimate` fake stage-ekkel (a knowledge-ág usage-gyűjtése, hálózat nélkül); ár-modul (env-parszolás + defaultok); `computeStageCost` (pure: nulla token, ismeretlen modell → null-ár, kerekítés).
- **Backend:** `POST /api/debug/cost` supertesttel, fake `costEstimate` deppel (siker + hiányzó-kulcs 503).
- **Frontend:** `CostEstimatorView` RTL-lel (mockolt fetch → stages+defaultPrices): a tábla renderelése, és az **élő ár-szerkesztés → újraszámolt összeg** (a fő UX). A tab-váltás.
- Minden Vitest + (frontend) RTL, hálózat/DB nélkül (repo-konvenció).

## Al-projekt kimenete

Egy „Költség-becslő" fül a frontendben, ami egy kérdésre stage-enkénti (router/HyDE/embedding/rerank/válasz) token- és USD-bontást ad + végösszeget, szerkeszthető árakkal a what-if számoláshoz — így reprezentatív kérdéseken mérve részletes költségvetési terv készíthető. Mellékhaszon: a chat DEBUG trace-panel mostantól a valós per-stage token-usage-et is mutatja (a `usage` emisszió bekötésével).
