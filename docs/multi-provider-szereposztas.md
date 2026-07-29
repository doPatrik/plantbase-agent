# Modell- és provider-szerepkiosztás a RAG-pipeline-ban

Ez a dokumentum azt írja le, hogy a multi-agent RAG-pipeline (`packages/core/src/lib/rag/`,
lásd `docs/rag/roadmap.md` SP3a) mely lépésén **melyik modell** fut, **melyik providertől**,
és miért pont az — a cél a **legalább két különböző provider** modelljeinek tudatos,
feladathoz illő kiosztása, nem csak formális megfelelés.

## Rövid válasz: két provider, feladat szerint szétválasztva

| Provider      | Csomag              | Szerep a pipeline-ban                                            |
| ------------- | ------------------- | ---------------------------------------------------------------- |
| **Anthropic** | `@ai-sdk/anthropic` | Minden LLM-szerep: router, HyDE, rerank, answer, katalógus (SQL) |
| **OpenAI**    | `@ai-sdk/openai`    | Kizárólag embedding (`text-embedding-3-small`)                   |

A választás nem véletlen kettéosztás — **más feladat, más modellcsalád**: az Anthropic
Claude-modellek jó általános nyelvi/következtetési képességet adnak a pipeline minden
generatív/döntési lépéséhez, míg az OpenAI embedding-modell a vektorkereséshez szükséges,
kifejezetten erre optimalizált, olcsó és jól dokumentált beágyazási teret ad. A két provider
nem helyettesíthető egymással azonos költség/minőség mellett ugyanarra a feladatra — ez indokolja
a tényleges szétválasztást, nem csak a "kétprovider-követelmény" formális kielégítését.

## Szerepenkénti bontás

### 1. Router — `claude-haiku-4-5` (Anthropic)

**Mit csinál:** a beérkező user-kérdésből `generateObject`-tel eldönti, hogy katalógus- (SQL)
vagy tudás-út (RAG) illik rá — ez egy egyszerű, alacsony tokenszámú klasszifikációs feladat.

**Miért ez a modell:** a döntés triviális bináris/kevés-osztályú klasszifikáció, nincs szükség
mély következtetésre vagy hosszú kontextusra. Egy drágább modell (Sonnet) itt csak
latenciát és költséget adna hozzá érdemi minőségjavulás nélkül — minden user-kérdés áthalad
ezen a lépésen, így a router költsége szorzódik a teljes forgalommal.

### 2. HyDE — `claude-haiku-4-5` (Anthropic)

**Mit csinál:** a kérdésből egy rövid, hipotetikus válasz-dokumentumot generál, amelynek
embeddingjét használjuk a vektorkereséshez (a nyers kérdés-embedding helyett) — lásd
`docs/rag/retrieval-eval.md` a konkrét hatásról.

**Miért ez a modell:** a HyDE-dokumentum csak a keresés minőségét javító **közbenső**
artefaktum, nem kerül közvetlenül a felhasználó elé — a kimenet stílusa/mélysége nem
kritikus, csak a domain-terminológia lefedettsége. Ez pontosan az "olcsó modell elég"
eset, ahogy a roadmap PRD-je is előírja (HyDE = "olcsó LLM").

### 3. Rerank — `claude-haiku-4-5` (Anthropic)

**Mit csinál:** a retrieval által visszaadott top-K chunk-ot az eredeti kérdés ellenében
relevancia-pontszám szerint újrarendezi, mielőtt az Answer Agent megkapná őket.

**Miért ez a modell:** a rerank egy viszonylag egyszerű, strukturált pontozási feladat
(kérdés + chunk → relevancia-szám), K-szoros hívással (top-K chunkonként vagy egy batch
hívásban) — a mennyiség miatt is fontos, hogy olcsó maradjon. A rerank minősége itt
elsősorban a retrieval jóságán (HyDE) és a chunkoláson múlik, nem a modell mélyebb
következtetési képességén.

### 4. Answer — `claude-sonnet-4-6` (Anthropic)

**Mit csinál:** a rerankelt, guardrail-lel átengedett chunk-okból streamelt, magyar nyelvű,
felhasználó-facing választ generál a tudás-úton.

**Miért ez a modell:** ez az egyetlen lépés, amelynek kimenetét a felhasználó közvetlenül
látja — itt számít a válasz koherenciája, a magyar nyelvi minőség, az árnyalt
következtetés (pl. több chunk-ból származó, néha ellentmondó információ összefésülése) és a
guardrail-utasítások (ne találjon ki választ) pontos betartása. Ez indokolja a nagyobb,
drágább modellt egyetlen, alacsony hívásszámú lépésen — a pipeline-ban ez fut a legkevesebbszer
(egyszer/kérdés), így a magasabb egységköltség itt a legkevésbé fáj.

### 5. Katalógus-ág (SQL) — `claude-sonnet-4-6` (Anthropic)

**Mit csinál:** a `streamText` + `stopWhen: stepCountIs` alapú katalógus-ágon a
`runSql`/`catalogSql` toolt hívva SQL-t generál és futtat a `products` táblán, majd
streamelt választ ad.

**Miért ez a modell:** SQL-generálás természetes nyelvből hibalehetőség szempontjából
érzékeny feladat (helyes join/where/aggregáció, csak SELECT), és ez is felhasználó-facing
válasszal zárul — ugyanaz az indoklás áll, mint az Answer Agentnél: itt a pontosság és a
válaszminőség többet nyom a latencián/költségen, mint egy olcsóbb modellnél elérhető
megtakarítás.

### 6. Embedding — `text-embedding-3-small` (OpenAI)

**Mit csinál:** a `document_chunks` tudásbázis (rag-builder, offline) **és** minden
futásidejű kérdés/HyDE-dokumentum vektorrá alakítása a pgvector-alapú kereséshez
(`packages/core/src/lib/embedding.ts`).

**Miért ez a modell/provider:** Anthropic nem kínál nyilvános embedding API-t — ez a szerep
**kényszerűen** más providert igényel, ha egyáltalán vektorkeresést akarunk. Az OpenAI
`text-embedding-3-small` jó ár/minőség arányú (1536 dim, olcsó, jól dokumentált, széles körben
bevált pgvector-kompatibilis modell), és a Vercel AI SDK `embedMany`-jén át ugyanabba az
egységes SDK-absztrakcióba illeszkedik, mint az Anthropic-hívások — így a providerváltás nem
jár extra kód-komplexitással a pipeline hívási felületén.

## Miért nem egyetlen provider?

Két, egymástól független ok tartja fenn a szétválasztást:

1. **Kényszerű okból:** az embedding-lépés technikailag nem helyettesíthető
   Anthropic-modellel (nincs Anthropic embedding-endpoint) — ez már önmagában legalább
   két providert eredményez a pipeline-ban.
2. **Tudatos okból, a generatív lépéseken belül:** minden generatív (nem embedding) lépés
   ugyanazt a providert (Anthropic) használja, de **két modellméretet** — Haiku az olcsó,
   nagy hívásszámú/alacsony-kockázatú szerepekhez (router, HyDE, rerank), Sonnet a
   felhasználó-facing, magasabb minőségi elvárású szerepekhez (answer, katalógus). Ez a
   feladat-alapú szétosztás konzisztens elv mindkét dimenzióban: providerek között
   (mire van szükség egyáltalán) és modellméretek között (mennyi "gondolkodás" ér meg
   a szerepnek a hívásgyakoriságához és a kimenet láthatóságához mérten).

## Konfigurálhatóság

A modellnevek env-változókkal felülírhatók (`RAG_ROUTER_MODEL`, `RAG_HYDE_MODEL`,
`RAG_RERANK_MODEL`, `RAG_ANSWER_MODEL`, `OPENAI_EMBEDDING_MODEL` — lásd
`packages/core/src/lib/config.ts`), így a szereposztás elve (olcsó vs. drága, LLM vs.
embedding) a konkrét modellnevek cseréje nélkül is érvényben marad; alapértelmezésben
`claude-haiku-4-5` / `claude-sonnet-4-6` / `text-embedding-3-small`.
