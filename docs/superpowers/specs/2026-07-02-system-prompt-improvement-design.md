# System prompt javítása — minőségi + költség-orientált optimalizálás

> Dátum: 2026-07-02 · Scope: `packages/core/src/lib/schema-context.ts` prompt-tartalma
> (elsősorban a DB-elérhető ág), szinkronban `docs/system-prompt.md`.

## Cél

A `buildSystemPrompt` által előállított agent-system-prompt javítása úgy, hogy
(1) csökkentse a futási költséget, (2) jobb minőségű válaszokat adjon, és
(3) értelmes, karbantartható maradjon. A prompt caching **nincs** a scope-ban —
a jelenlegi statikus prefix (~700 token) a Sonnet 1024-tokenes cache-küszöbe
alatt van, így önmagában nem aktiválódna; ha később a prefix megnő, külön
feladatként visszatérhet.

## Nem cél / scope-on kívül

- `ask-agent.ts` tool-use loop változtatása (caching, lépésszám) — érintetlen.
- `config.ts` (modell, `maxTokens`) — érintetlen; marad `claude-sonnet-4-6`.
- A tool-definíciók (`agent-tools.ts`) — érintetlenek.
- A két prompt-ág szerkezete (DB elérhető / nincs DB) — megmarad.

## Költség-modell (miért ez a lever)

A tool-use loop minden körében a teljes üzenet-history újra inputként megy be.
A legnagyobb, prompton keresztül befolyásolható költség a `runSql`
tool-eredmények mérete: a JSON sorok a következő loop-körben inputként
visszaáramlanak. Ezért a fő költség-lever a **kompakt SQL** (kevés oszlop,
`description` kerülése, alacsonyabb LIMIT) és a **kevesebb tool-kör**
(egy lekérdezésre törekvés → kevesebb `messages.create` hívás).

## Változtatások — DB-elérhető ág (`RULES_WITH_DB` / `BEHAVIOR_WITH_DB`)

### Költség-orientált SQL-szabályok (új / módosított)

- **Ne `SELECT *`.** Csak a válaszhoz ténylegesen szükséges oszlopokat kérje le:
  alap `name`, és amennyiben relevánsak `price`, `sale_price`, `stock`, plusz a
  ténylegesen szűrt/rangsorolt attribútumok (pl. `light`, `pet_safe`,
  `current_height_cm`). Indoklás: a felesleges oszlopok minden következő
  loop-körben újra input-tokenként áramlanak vissza.
- **`description` csak kérésre.** A hosszú `description` mezőt csak akkor kérje
  le, ha a felhasználó kifejezetten a leírásra / részletekre kérdez.
- **Egy lekérdezésre törekvés.** Ha egy jól megírt SELECT megválaszolja a
  kérdést, ne bontsa több tool-körre (kevesebb API-hívás).
- **Szigorúbb LIMIT.** Alapból `LIMIT 10` (max 50), hacsak a felhasználó többet
  nem kér. (Korábban „alapból 20–50".)

A meglévő szabályok megmaradnak: `CSAK SELECT`, `ILIKE`,
`COALESCE(sale_price, price)`, `stock > 0`, méret-oszlopok, gondozás-oszlopok,
`listCategories` a kategóriákhoz.

### Minőségi javítások (viselkedés)

- **Üres eredmény kezelése (új).** Ha a lekérdezés nem ad sort, mondja ki, hogy
  nincs a katalógusban illeszkedő növény, és ajánljon lazább szűrést vagy
  alternatívát — soha ne találjon ki terméket.
- **Ár-formázás (új).** Az árat forintban (Ft) adja meg; ha van `sale_price`,
  jelezze az akciót (eredeti + akciós ár).
- **Ne kérdezzen vissza feleslegesen (finomítás).** A meglévő „kétértelműségnél
  kérdezz vissza" szabály mellé: egyszerű, egyértelmű lekérdezésnél ne kérdezzen
  vissza, hanem értelmes alapértelmezéssel haladjon.

A meglévő viselkedési szabályok megmaradnak: kétértelműségnél visszakérdezés,
csomag-összeállításnál büdzsé + szoba adottságai, döntéshez fontos attribútumok
kiemelése, tömör természetes nyelvű összegzés (nem tábla-dump), nincs kitalált
oszlop/tábla.

## Nincs-DB ág

Érintetlen (nincs SQL, nincs tool) — a `SITUATION_NO_DB` / `BEHAVIOR_NO_DB`
marad.

## Dokumentáció-szinkron

A `docs/system-prompt.md` frissítése, hogy tükrözze az élő promptot:

- a jelenleg hiányzó `listCategories` tool és a `<tools>` blokk,
- a kategória-komment „emlékeztető" jelölése,
- az itt bevezetett új SQL- és viselkedési szabályok.

## Invariánsok (a tesztek ezekre épülnek — NE sérüljenek)

A `schema-context.spec.ts` az alábbi szövegdarabokat követeli meg, ezek maradnak:

- `<role>` mindkét ágban; a DB-ág tartalmazza a `Plantbase` szót.
- Nincs-DB ág: `nem férsz hozzá az adatbázishoz`, és NEM tartalmaz `runSql`,
  `<schema>`, `listCategories` szöveget.
- DB-ág: `<schema>`, `products`, `runSql`, `CSAK SELECT`, `listCategories`,
  valamint `emlékeztető|hint`.

## Verifikáció

- `pnpm nx test @plantbase/core` — zöld (a fenti invariáns-tesztek).
- `pnpm nx run-many -t test typecheck build` — zöld.
- Szükség esetén új asszertáció a spec-ben az új szabályokra (pl. „nincs
  `SELECT *`" instrukció jelenléte), TDD szerint.

## Kockázatok

- Túl agresszív oszlop-szűkítés → hiányzó indoklás a válaszban. Enyhítés: a
  szabály a „szűrt/rangsorolt attribútumokat" is bekéri, nem csak a nevet.
- A prompt bővülése növeli a per-call input tokent; ezt ellensúlyozza a kisebb
  tool-eredmény és a kevesebb loop-kör. Nettó várhatóan csökkenés.
