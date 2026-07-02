# listCategories tool — az agent lekérdezi a katalógus kategóriáit

**Triage:** `needs-triage`
**Típus:** AFK
**Vertikális szelet (tracer bullet):** adat → tool-loop → system prompt → tesztek

## What to build

Új agent-tool, a `listCategories`, a meglévő `runSql` mellé. Visszaadja a **Katalógus**ban ténylegesen előforduló **Kategória-szókészletet** (a `products.category` distinct értékei), ábécé-rendezve. Ez lesz a kategóriák **hiteles forrása** — a system prompt séma-kommentjében szereplő felsorolás csak nem-hiteles emlékeztető (hint), amely elavulhat (lásd `CONTEXT.md`).

Végponttól végpontig: a felhasználó rákérdez a kategóriákra (vagy kategóriára szűrne) → az agent meghívja a `listCategories`-t → a valódi listából válaszol, nem a statikus prompt-kommentből.

## Érintett rétegek

- **Adat — `packages/core/src/lib/runsql.ts`:**
  - Új exportált `listCategories(options?: RunSqlOptions): Promise<string[]>`.
  - Belül **újrahasználja a `runSql`-t** a fix `SELECT DISTINCT category FROM products ORDER BY category` lekérdezéssel, majd a sorokból kiszedi a `category` értékeket `string[]`-gé.
  - Így megőrzi a read-only kapcsolatot (`DATABASE_URL_READONLY`) **és** az `assertSelectOnly` guardot (defense-in-depth) — nincs kerülő út, nincs pool-duplikáció.
- **Tool-loop — `packages/core/src/lib/ask-agent.ts`:**
  - `LIST_CATEGORIES_TOOL` definíció **üres input schema-val** (nincs paraméter), és beteszi a `tools` tömbbe a `runSql` mellé.
  - A blokk-feldolgozó **tool-név szerint ágazik**: `runSql` → zod-validált `query` + `runSql`; `listCategories` → nincs input, `listCategories()` hívás, eredmény `JSON.stringify`-al a tool_result-ba. Ismeretlen tool → `is_error` tool_result.
  - `AskAgentOptions`-be új injektálható opció: `listCategories?: () => Promise<string[]>` (teszthez, a `runSql`-hez hasonlóan).
  - A napló-eventekbe (`tool_use` / `tool_result`) új `tool` mező (`'runSql' | 'listCategories'`), a `sql` opcionálissá válik — a JSONL napló (FR4) egyértelmű marad.
- **System prompt — `packages/core/src/lib/schema-context.ts`:**
  - `<tools>` blokk: új sor — `listCategories(): a katalógusban ténylegesen előforduló kategóriák hiteles, ábécé-rendezett listája.`
  - Szűk viselkedési szabály: ha kategóriára szűrsz vagy a kategóriákról kérdeznek, előbb kérd le a `listCategories`-szel a valódi értékeket — ne a séma-kommentre hagyatkozz. (Szándékosan nem „MINDIG hívd meg", hogy ne legyen felesleges tool-hívás.)
  - A `<schema>` kategória-kommentje maradjon felsorolásnak, de fél mondattal jelezze, hogy ez csak emlékeztető (a hiteles lista a `listCategories`) — így a prompt és a `CONTEXT.md` nem mond ellent.

## Acceptance criteria

- [ ] `listCategories()` a `runsql.ts`-ben él, a `runSql`-t újrahasználva futtatja a fix `SELECT DISTINCT category FROM products ORDER BY category`-t, és `string[]`-et ad vissza (ábécé-rendezve).
- [ ] A `listCategories()` a read-only kapcsolaton fut és áthalad az `assertSelectOnly` guardon (nincs közvetlen `pool.query` kerülő út).
- [ ] Az `askAgent` `tools` tömbje tartalmazza a `runSql`-t **és** a `listCategories`-t; a loop mindkét toolt helyesen dispatch-eli tool-név szerint, ismeretlen toolra `is_error` tool_result megy.
- [ ] A `listCategories` injektálható az `AskAgentOptions`-ön keresztül (fake a teszthez).
- [ ] A JSONL napló `tool_use`/`tool_result` eseménye jelzi, melyik tool futott (`tool` mező).
- [ ] A system prompt `<tools>` blokkja említi a `listCategories`-t, van rá szűk viselkedési szabály, és a séma-komment „hint"-ként van jelölve.
- [ ] Vitest lefedettség: `runsql.spec.ts` (fix rendezett query → `string[]`) és `ask-agent.spec.ts` (tool_use → `listCategories` → tool_result → végleges válasz, injektált fake-kel, hálózat/DB nélkül).
- [ ] `pnpm nx run-many -t test typecheck build` zöld; `main` zöld marad; feature branch + PR (angol commit/PR).

## Blocked by

None - can start immediately.

## Megvalósítási megjegyzés

A loop tool-dispatch-e nem az eredetileg tervezett explicit `if/else if` ágakkal, hanem **tool-registryvel** készült (minden tool = definíció + `run` handler egy `Map`-ben) — lásd [ADR-0001](../adr/0001-tool-registry-dispatch.md). Így a loop mérete tool-számtól független.

## Future extension (nem most, YAGNI)

- Kategóriánkénti darabszám (`SELECT category, COUNT(*) … GROUP BY category`) — külön jegyben, ha kell.
