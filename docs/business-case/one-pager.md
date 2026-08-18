# Business case / egy oldal

**Növényválasztó és gondozási asszisztens a Plantbase webshopban**

Szponzor: e-commerce igazgató · Folyamatgazda: ügyfélszolgálat vezetője ·
Készítette: fejlesztés · Dátum: 2026.08.17

## 1. Egy mondat, amit a szponzor felmond

A vásárló a webshopban azonnal választ kap arra, melyik növény való a
lakásába és hogyan kell gondozni, így az ügyfélszolgálat terhelése csökken,
és a személyre szabott tanácsadás minden vásárlónak jár, nem csak a nagy
rendelőknek.

## 2. As-is és to-be

| Mit mérünk                           | As-is (baseline)                                                  | To-be (agenttel)                                                                     | Honnan tudjuk                                     |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Gondozási/választási kérdés kezelése | Ügyintéző kézzel keresi ki a katalógusból/tudásbázisból a választ | Az agent azonnal válaszol, forrásmegjelöléssel                                       | —                                                 |
| Kezelési idő / megkeresés            | ~9 perc (iparági átalány, ld. megjegyzés)                         | ~1 perc (mért: `docs/koltsegbecsles.md`, egy RAG-lekérdezés végpontig végpontig fut) | **ÁTALÁNY** (as-is), **MÉRT** (to-be)             |
| Bizonytalan eset kezelése            | Az ügyintéző mindig válaszol (esetenként rosszul)                 | A rendszer NEM hallucinál, embert von be (eszkalációs jegy)                          | **MÉRT** — a PoC pipeline-ja ma is így viselkedik |

**Megjegyzés a baseline-ról:** a Plantbase egy oktatási referencia-implementáció,
nincs éles ügyfélforgalma. Az as-is kezelési idő ipari átalány (hasonló
gondozási/kiszolgálási megkeresésekre), NEM mért Plantbase-adat — ez a
one-pager egyetlen olyan sora, ami becslésre épül, és itt explicit jelölve is
van.

## 3. A szám

**A megtakarítás forrása:** a bizonytalan-eset-kezelés ma is MÉRT, kód által
garantált viselkedés (guardrail + eszkaláció) — ez nem pénzben mérhető
megtakarítás, hanem **kockázatcsökkentés**: nincs hallucinált gondozási tanács,
ami elpusztítja a vásárló növényét és reklamációhoz vezet.

A pénzben kifejezhető tétel — az ügyfélszolgálati kapacitás-megtakarítás —
becsült, mert nincs éles forgalmi adat:

> 150 megkeresés/hó (ÁTALÁNY, kis webshop méretre óvatosan becsülve) × 70%
> agenttel lezárva × 8 megspórolt perc × 3 360 Ft/óra (a `docs/roi.md`
> terhelt órabér-módszertana) ≈ 470 e Ft/hó ≈ **5,6 M Ft/év** (BECSÜLT)

Ez a szám csak akkor válik MÉRT-té, ha a pilot alatt tényleges megkeresés-
számot és eszkalációs arányt (`logs/escalations.jsonl`) mérünk — ez az egyik
mérési terv sor (ld. `meresi-terv.md`).

## 4. Költség és idő (felső becslés)

| Tétel                                 | Egyszeri            | Éves                                                                        | Megjegyzés                                                      |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Fejlesztés                            | — (megvan)          | —                                                                           | a use case a meglévő RAG-pipeline-ra épül, nincs újrafejlesztés |
| Integráció (Ügyfélchat/Support fül)   | ~1 fejlesztői nap   | —                                                                           | PoC-ban elkészült                                               |
| Üzemeltetés (LLM + embedding hívások) | —                   | ~$0,024/lekérdezés (MÉRT, `docs/koltsegbecsles.md`) × becsült havi forgalom | adopcióval együtt nő                                            |
| Betanítás (support-munkatársak)       | ~fél nap            | —                                                                           | a support-nézet kezelése kolléga-kapacitásból                   |
| **Összesen**                          | ~1,5 fejlesztői nap | usage-alapú                                                                 | megtérülés: a pilot mérési adataitól függ                       |

## 5. Kockázat és mi történik, ha rosszul megy

- **Legnagyobb kockázat:** téves gondozási tanács, aminek a végén elpusztul a
  növény. **Ellenintézkedés:** guardrail-küszöb (`RAG_GROUNDING_THRESHOLD`,
  alapból 0.35) — ha nincs elég megbízható forrás, a rendszer NEM válaszol,
  hanem eszkalál.
- **Emberi kapu:** minden guardrail-bizonytalan eset emberhez megy (Support
  fül) — ez a PoC-ban ténylegesen működik, nem csak terv.
- **Visszavehetőség:** az "Ügyfélchat" fül percek alatt eltávolítható a
  frontendről; a belső "Chat" fül és a katalógus/tudásbázis érintetlen marad.
- **Adat:** csak a nyilvános katalógus és a gondozási tudásbázis megy a
  modellhez; ügyféladat (név, cím, rendelés) nem — mert a jelenlegi PoC nem
  kezel session-höz kötött ügyféladatot.
- **Naplózás:** minden kérdés/válasz JSONL-be kerül (`logs/`), az
  eszkalációk pedig külön, státusszal (`logs/escalations.jsonl`).

## 6. Mit kérünk

Kérünk döntést arról, hogy a jelen PoC (Ügyfélchat + Support fül) 2 hetes
mért pilotra mehet-e egy szűk, valós felhasználói körrel, döntési ponttal a
pilot végén.

| Mérföldkő                          | Mikorra               | Mi a döntés a végén                                        |
| ---------------------------------- | --------------------- | ---------------------------------------------------------- |
| Pilot indul, szűk felhasználói kör | döntés dátuma + 1 hét | a válaszminőség és az eszkalációs arány eléri-e a küszöböt |
| Döntési pont                       | döntés dátuma + 2 hét | teljes webshopra nyitunk-e                                 |
| Teljes webshop, gazda kijelölve    | döntés dátuma + 4 hét | megy-e a következő use case                                |
