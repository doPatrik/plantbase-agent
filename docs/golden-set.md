# Retrieval-kiértékelés: nyers vektorkeresés vs. teljes pipeline (HyDE + rerank)

Ez a dokumentum egy 10 kérdésből álló golden setet vet össze két módon, a meglévő
`POST /api/debug/search` endponton (`runRetrievalDebug`, `packages/core/src/lib/rag/retrieval-debug.ts`) át:

1. **Nyers vektorkeresés** — a kérdés nyers szövegének embeddingje, majd `pgvector` koszinusz-távolság
   szerinti rangsor, rerank **nélkül**. Az endpoint válaszában ez a `raw.retrieval` tömb.
2. **Teljes pipeline** — HyDE-dokumentum generálása a kérdésből, annak embeddingje szolgál kereséshez,
   majd a top-K találatot az eredeti kérdés ellenében a rerank-lépés (Haiku, relevancia-pontszám) rendezi
   át. Az endpoint válaszában ez a `hyde.rerank.results` tömb, minden elemen `prevRank` jelzi, hányadik
   helyen állt a rerank előtti (HyDE-alapú) listában.

A futtatás környezete: helyi Postgres (pgvector), 202 dokumentum / 448 embedelt chunk
(`GET /api/debug/chunks`), valós Anthropic (Haiku router/HyDE/rerank) és OpenAI
(`text-embedding-3-small`) hívásokkal.

## A golden set

| #   | Kérdés                                                           | Várt eredmény                       |
| --- | ---------------------------------------------------------------- | ----------------------------------- |
| 1   | Hogyan öntözzem a kaktuszaimat?                                  | tudás-út, kaktusz-öntözés           |
| 2   | Milyen gyakran permetezzem be a monsterámat a levéltetvek ellen? | tudás-út, kártevő-irtás             |
| 3   | Mit jelent az, hogy egy növény "aroid"?                          | tudás-út, terminológia              |
| 4   | Hogyan javítsam meg a barnuló levélszéleket a szobanövényeimen?  | tudás-út, diagnosztika              |
| 5   | Mikor és hogyan ültessem át az orchideámat?                      | tudás-út, átültetés                 |
| 6   | Milyen fényviszonyok kellenek egy ZZ növénynek?                  | tudás-út, fényigény                 |
| 7   | Hogyan neveljek fügefát dugványról?                              | tudás-út, szaporítás                |
| 8   | Mi a különbség az egynyári és évelő kerti növények között?       | tudás-út, kerti terminológia        |
| 9   | Melyik kriptovaluta a legjobb befektetés 2026-ban?               | **negatív teszt** — domainen kívüli |
| 10  | Hogyan állítsam be a routerem Wi-Fi jelszavát?                   | **negatív teszt** — domainen kívüli |

## Összefoglaló táblázat (top-1 találat, nyers vs. teljes pipeline)

| #   | Kérdés                 | Nyers vektorkeresés top-1                                                           | Teljes pipeline top-1                                                    | Átrendezett-e?                               |
| --- | ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | Kaktusz öntözés        | _How to Harvest a Cacao Tree at Home_ (sim 0.31) — **irreleváns**                   | _How to Care for a Cactus_ › Sunlight (sim 0.39)                         | **Igen**                                     |
| 2   | Monstera levéltetű     | _The Hole Truth: Monsteras_ (sim 0.21) — **irreleváns** (fenesztráció, nem kártevő) | _How to Identify and Treat Pests in Your Plants_ (sim 0.30)              | **Igen**                                     |
| 3   | Aroid fogalom          | _A is for Aroids_ (sim 0.44)                                                        | _A is for Aroids_ (sim 0.55)                                             | Nem (helyes már elsőre)                      |
| 4   | Barnuló levélszél      | _How to Clean Houseplant Leaves_ (sim 0.30) — részben releváns                      | _5 Causes For Your Plant's Browning Leaves_ (sim 0.36)                   | **Igen**                                     |
| 5   | Orchidea átültetés     | _How To Repot an Orchid_ (sim 0.43)                                                 | _How To Repot an Orchid_ › 3. Remove orchid (sim 0.50)                   | Kis belső csere (ugyanaz a dokumentum)       |
| 6   | ZZ fényigény           | _From A to ZZ Plant_ (sim 0.42)                                                     | _How To Care for a ZZ Plant..._ (sim 0.51)                               | Kis csere, mindkettő releváns                |
| 7   | Fügefa dugvány         | _Fiddle Me This_ (sim 0.24)                                                         | _Fiddle Me This_ (sim 0.41)                                              | Nem (helyes már elsőre, csak a bizalom nőtt) |
| 8   | Egynyári/évelő         | _Key Plant Terms Glossary_ › Herbaceous (sim 0.32) — részleges                      | _Gardening 101: Annuals, Perennials, and Biennials Explained_ (sim 0.50) | **Igen**                                     |
| 9   | Kriptovaluta (negatív) | max sim 0.18 — semmi releváns                                                       | max sim 0.18 — semmi releváns                                            | Nem értelmezhető (lásd negatív teszt)        |
| 10  | Wi-Fi jelszó (negatív) | max sim 0.10 — semmi releváns                                                       | max sim 0.11 — semmi releváns                                            | Nem értelmezhető (lásd negatív teszt)        |

## Kiemelt eset: a rerank konkrétan átrendezett (2. kérdés)

**Kérdés:** „Milyen gyakran permetezzem be a monsterámat a levéltetvek ellen?”

**Nyers vektorkeresés (embedding + koszinusz-távolság, top-3):**

| Rank | Cím                                  | Heading                  | sim    |
| ---- | ------------------------------------ | ------------------------ | ------ |
| 0    | The Hole Truth: Monsteras            | —                        | 0.2148 |
| 1    | The Hole Truth: Monsteras            | Make Your Monstera Holey | 0.2115 |
| 2    | How To Care for a Monstera Deliciosa | Watering                 | 0.2041 |

**Teljes pipeline (HyDE + rerank, top-3):**

| Rank | Cím                                            | Heading               | sim    | prevRank (HyDE-listán) |
| ---- | ---------------------------------------------- | --------------------- | ------ | ---------------------- |
| 0    | How to Identify and Treat Pests in Your Plants | What You Need To Know | 0.3035 | 1                      |
| 1    | Bug Off: All About Mealybugs                   | —                     | 0.2902 | 3                      |
| 2    | How to Identify and Treat Pests in Your Plants | —                     | 0.2633 | 8                      |

**Miért jobb az új sorrend?**

A nyers vektorkeresés a kérdés szó szerinti embeddingjét ("monstera" + "permetezzem" + "levéltetvek")
a Monstera-specifikus gondozási cikkekhez húzza legközelebb — azok tele vannak a "monstera" szóval, de
egyik sem foglalkozik kártevő-irtással; a _"Hole Truth"_ cikk a levéllyukakról (fenesztráció) szól, a
_"How To Care for a Monstera Deliciosa"_ pedig az öntözésről. A kérdés lényegi információigénye (hogyan
kell kártevő ellen permetezni) egyikben sincs meg — ez egy klasszikus lexikai/embedding-csapda: a
domináns entitásszó ("monstera") felülírja a tényleges cselekvést ("kártevőirtás").

A HyDE-lépés egy hipotetikus válaszdokumentumot generál előbb ("permetezd le a leveleket
inszekticid szappannal, hetente..."), és **ennek** az embeddingjével keres — ez már a kártevőirtási
terminológia felé tolja a találatokat, nem a "monstera" szó felé. A rerank ezután az eredeti kérdés
ellenében pontoz, és a valóban kártevőirtásról szóló _"How to Identify and Treat Pests"_ és _"Bug Off:
Mealybugs"_ cikkeket hozza fel — ezek adnak ténylegesen használható választ a permetezés gyakoriságára
és módjára, miközben egyik sem szerepelt a nyers lista top-3-ában (a Mealybugs-cikk a HyDE-listán is csak 4. volt, a rerank hozta fel 2. helyre).

Ez pontosan az az eset, amikor a nyers vektorkeresés a _"miről szól a cikk"_ hasonlóságot ragadja meg
(entitás-egyezés: "monstera"), a HyDE+rerank pedig a _"mi a válasz a kérdésre"_ relevanciát (kártevőirtás
folyamata) — ez utóbbi a hasznosabb egy válaszgeneráló pipeline számára.

## Ahol a rerank nem, vagy csak minimálisan rendezett át (3., 7. kérdés)

A 3. („aroid” fogalom) és 7. (fügefa dugvány) kérdésnél a nyers vektorkeresés **már elsőre** a helyes,
egyértelműen releváns dokumentumot hozta top-1-nek (_A is for Aroids_, illetve _Fiddle Me This: Caring
for a Fiddle Leaf Fig_), és a teljes pipeline is ugyanazt hozta — a rerank csak a bizalmi pontszámot
(similarity) növelte, sorrendet nem változtatott.

**Ennek a magyarázata:** ezek a kérdések egyetlen, jól elnevezett és a tudásbázisban egyedi entitást
neveznek meg ("aroid", "fiddle leaf fig" / füge), amelyre pontosan egy dedikált cikk létezik, és a
kérdés szóhasználata (a kérdés maga is majdnem cím-szerű) már a nyers embeddingben is erősen highlighting
azt a dokumentumot ("aroid" sim 0.44, jóval a második helyezett 0.41 fölött). Ilyenkor a HyDE-lépés
lényegében csak egy hosszabb, bőbeszédűbb változatát generálja ugyanannak a témának, ami tovább erősíti
(nem megváltoztatja) a top-1 találatot. A rerank tehát nem "hibát javít", hanem megerősíti a már helyes
sorrendet — ez is releváns eredmény: **azt mutatja, hogy a HyDE+rerank hozzáadott értéke az egyértelmű,
egy-dokumentumos, cím-szerű kérdéseknél kicsi; az értéke ott jelentkezik, ahol a kérdés cselekvés-
orientált és a domináns entitásszó félrevezetné a nyers embeddinget** (lásd 2., 4., 8. kérdés).

## Negatív teszt: domainen kívüli kérdések

A golden set 9. és 10. kérdése szándékosan a tudásbázisból hiányzó témát céloz meg (kriptovaluta-
befektetés, router Wi-Fi beállítás). Mindkét esetben a legjobb találat similarity-je jóval a
guardrail-küszöb (0.35) alatt maradt (0.18, illetve 0.11), és mindkét esetben a HyDE+rerank sem tudott
ezen javítani — nincs mit "jobban rendezni", mert nincs releváns dokumentum a korpuszban.

A tényleges agent-futás (`pnpm plantbase ask`, teljes pipeline) mindkét kérdésnél helyesen ismerte fel
ezt, és a `guardrail` lépés `grounded=false`-t jelzett, mielőtt válasz generálódott volna:

```
# 9. kérdés — "Melyik kriptovaluta a legjobb befektetés 2026-ban?"
[trace] retrieval → 12 találat (max sim 0.17)
[trace] rerank → 12→5 (degradált)
[trace] guardrail → grounded=false (max sim 0.17, küszöb 0.35)
→ "A tudásbázis alapján erre a kérdésre nem tudok megbízhatóan válaszolni.
   Pontosítanád a kérdést, vagy kérdezz növénygondozási témában."

# 10. kérdés — "Hogyan állítsam be a routerem Wi-Fi jelszavát?"
[trace] retrieval → 12 találat (max sim 0.14)
[trace] rerank → 12→5 (degradált)
[trace] guardrail → grounded=false (max sim 0.14, küszöb 0.35)
→ "A tudásbázis alapján erre a kérdésre nem tudok megbízhatóan válaszolni.
   Pontosítanád a kérdést, vagy kérdezz növénygondozási témában."
```

Az agent tehát **nem talált ki forrást**, hanem explicit kimondta, hogy a tudásbázisban nincs
válasz — ez a grounding-próba: a similarity-alapú guardrail (`max sim < küszöb ⇒ grounded=false`) ténylegesen
megakadályozza a válaszgenerálást hiányzó forrás esetén, nem csak a prompt szintjén van deklarálva.

## Következtetés

- A HyDE+rerank pipeline **8 kérdésből 4 esetben** (2., 4., 8., és részben 1.) érdemben, a válasz
  minőségét befolyásoló módon rendezte át a top találatokat — jellemzően ott, ahol a kérdés
  cselekvés/probléma-orientált volt, és a nyers embedding egy domináns entitásszó (a növény neve) alapján
  tévesen egy másik, azonos növényről szóló, de más témájú cikket preferált.
- 2 kérdésnél (3., 7.) a nyers keresés is helyes volt, a rerank csak megerősítette — ez azt mutatja, hogy
  egyértelmű, cím-szerű, egy-entitásos kérdéseknél a HyDE+rerank hozzáadott értéke kicsi, de nem árt.
- A 2 negatív teszt (9., 10.) igazolta, hogy a rendszer alacsony similarity esetén nem generál
  kitalált választ, hanem a guardrail explicit elutasítást vált ki — ez a grounding tényleges,
  kód-szintű kikényszerítése, nem csupán prompt-szintű ígéret.

## Reprodukálás

```bash
# Backend elindítása (RAG debug endpointokhoz):
pnpm nx serve backend

# Nyers vs. teljes pipeline összevetés egy kérdésre:
curl -s -X POST localhost:3000/api/debug/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Milyen gyakran permetezzem be a monsterámat a levéltetvek ellen?"}' | jq .

# Teljes agent-futás (grounding-próba, engine-trace-szel):
pnpm plantbase ask "Melyik kriptovaluta a legjobb befektetés 2026-ban?"
```
