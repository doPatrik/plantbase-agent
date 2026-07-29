# Költséglevezetés

A fejlesztés részeként elkészült egy **streaming chat felület**, amely támogatja a DEBUG módot, a feldolgozási szakaszok (stage-ek) valós idejű megjelenítését, egy kinyitható **engine trace** panelt, valamint a válaszokhoz kapcsolódó **forrás-chipeket**. Emellett létrejött egy külön **Költség-becslő** nézet is, amely a `/api/debug/cost` végpont eredményét táblázatos formában jeleníti meg, és lehetővé teszi az egyes modellek árainak élő módosítását a költségszámításokhoz.

## 1. Tudásbázis feldolgozása (Ingest)

A teljes tudásbázis (202 Markdown dokumentum, összesen 448 chunk) vektorizálása egy valós `rag-builder` futtatás során **256 677 embedding tokent** használt fel.

- **Modell:** `text-embedding-3-small`
- **Ár:** $0.02 / 1 millió token
- **Felhasznált tokenek:** 256 677
- **Egyszeri ingest költség:** ≈ **$0.005**

Ez egy egyszeri költség, amely csak a tudásbázis első feldolgozásakor, illetve tartalomváltozás esetén jelentkezik. A `rag-builder` minden futás során naplózza a tényleges tokenfelhasználást és költséget a `logs/rag-builder/` könyvtárba.

## 2. Egy lekérdezés futási költsége

A teljes RAG pipeline (Router → HyDE → Embedding → Rerank → Answer) egy átlagos kérdés esetén **megközelítőleg $0.02–0.03** költséget jelent.

A `/api/debug/cost` végponton mért valós példa ("Hogyan gondozzam a pozsgásokat?") alapján:

- **Teljes költség:** **$0.0239**

### Költségmegoszlás

| Pipeline lépés            |     Költség |
| ------------------------- | ----------: |
| Router + HyDE + Embedding |    ≈ $0.002 |
| Rerank (Claude Haiku)     |    ≈ $0.008 |
| Answer (Claude Sonnet)    |    ≈ $0.014 |
| **Összesen**              | **$0.0239** |

A költség döntő részét a **rerank** és az **Answer** lépések adják, míg a router, a HyDE és az embedding együttesen is csak a teljes költség kis részét teszik ki.

# Összegzés

A rendszer üzemeltetési költsége alacsony. A tudásbázis feldolgozásának egyszeri költsége mindössze **≈ $0.005**, amely csak új vagy módosított tartalom feldolgozásakor ismétlődik meg. Egy teljes RAG lekérdezés átlagos költsége **$0.02–0.03**, a mért példában **$0.0239**, amelynek legnagyobb részét a rerank és a végső válaszgenerálás teszi ki.

Az elkészült debug felület és a költségbecslő nézet lehetővé teszi a pipeline minden lépésének valós idejű nyomon követését, valamint a modellköltségek transzparens elemzését és finomhangolását.
