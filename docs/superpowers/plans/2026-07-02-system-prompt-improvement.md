# System Prompt Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Plantbase agent system prompt (DB-available branch) for lower cost and better answer quality, without touching the tool-use loop, config, or tools.

**Architecture:** Only the string constants in `packages/core/src/lib/schema-context.ts` change (`RULES_WITH_DB`, `BEHAVIOR_WITH_DB`). New Vitest assertions in `schema-context.spec.ts` lock in the new instructions (TDD). `docs/system-prompt.md` is updated to mirror the live prompt.

**Tech Stack:** TypeScript (strict), Vitest, Nx, pnpm.

## Global Constraints

- Git commits and PRs in English; chat and `/docs` in Hungarian (project convention).
- Do NOT break existing `schema-context.spec.ts` invariants: `<role>`, `Plantbase`, `<schema>`, `products`, `runSql`, `CSAK SELECT`, `listCategories`, `emlékeztető|hint`; the no-DB branch must NOT contain `runSql`, `<schema>`, or `listCategories`.
- Scope is prompt text only: do NOT modify `ask-agent.ts`, `config.ts`, or `agent-tools.ts`. No prompt caching.
- Prompt stays XML-tagged (`<role>`/`<task>`/`<schema>`/`<rules>`/`<behavior>`/`<tools>`).
- Test/verify via nx: `pnpm nx test @plantbase/core`, `pnpm nx run-many -t test typecheck build`.
- Work on branch `feat/improve-system-prompt` (already created).

---

### Task 1: Rewrite the DB-branch rules and behavior in the system prompt

**Files:**

- Modify: `packages/core/src/lib/schema-context.ts` (constants `RULES_WITH_DB` ~lines 37-46, `BEHAVIOR_WITH_DB` ~lines 48-54)
- Test: `packages/core/src/lib/schema-context.spec.ts` (add cases to the `when the database is available (B3)` block, ~lines 28-49)

**Interfaces:**

- Consumes: `buildSystemPrompt({ databaseAvailable: true }): string` (unchanged signature).
- Produces: no API change; only the returned string content changes. Later tasks (docs) rely on the exact new rule/behavior wording shown below.

- [ ] **Step 1: Write the failing tests**

Add these `it` blocks inside the existing `describe('when the database is available (B3)', ...)` block in `packages/core/src/lib/schema-context.spec.ts` (the `prompt` const already exists in that scope):

```typescript
it('should forbid SELECT * to keep tool results compact', () => {
  expect(prompt).toContain('Ne használj SELECT *');
});

it('should fetch description only on explicit request', () => {
  expect(prompt).toMatch(/description[^\n]*csak akkor kérd le/i);
});

it('should default to a tight LIMIT', () => {
  expect(prompt).toMatch(/alapból 10/);
});

it('should handle the empty-result case', () => {
  expect(prompt).toMatch(/egyetlen sort sem/i);
});

it('should format prices in HUF', () => {
  expect(prompt).toMatch(/forintban|Ft\b/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test @plantbase/core`
Expected: FAIL — the 5 new assertions fail (strings not yet present); existing tests still pass.

- [ ] **Step 3: Replace `RULES_WITH_DB`**

In `packages/core/src/lib/schema-context.ts`, replace the whole `RULES_WITH_DB` constant with:

```typescript
const RULES_WITH_DB = `<rules>
- CSAK SELECT. Soha ne módosíts adatot (INSERT/UPDATE/DELETE/DDL tilos).
- Ne használj SELECT *. Csak a válaszhoz szükséges oszlopokat kérd le: alap a name, és ha relevánsak a price, sale_price, stock, plusz a ténylegesen szűrt vagy rangsorolt attribútumok (pl. light, pet_safe, current_height_cm). A felesleges oszlopok minden további körben újra bekerülnek a kontextusba, ezért kerüld őket.
- A description hosszú: csak akkor kérd le, ha a felhasználó kifejezetten a leírásra vagy részletekre kérdez.
- Törekedj egyetlen lekérdezésre: ha egy jól megírt SELECT megválaszolja a kérdést, ne bontsd több körre.
- Mindig tegyél LIMIT-et: alapból 10 (max 50), hacsak a felhasználó többet nem kér.
- Szöveges keresés: ILIKE (kis/nagybetű-független), pl. name ILIKE '%pozsgás%'.
- Ár: a tényleges ár COALESCE(sale_price, price) (ha van akció, az számít). Büdzsénél ezzel számolj.
- Raktár: ha "raktáron" a kérés, szűrj stock > 0-ra.
- Méret: current_height_cm az aktuális, max_height_cm a kifejlett magasság, current_pot_cm a cserépméret.
- Gondozás: light (fény), watering (öntözés), difficulty (nehézség), pet_safe (háziállat-barát).
- Kategóriák: ha kategóriára szűrsz vagy a kategóriákról kérdeznek, előbb a listCategories toollal kérd le a valódi értékeket — a séma kategória-felsorolása csak emlékeztető, elavulhat.
</rules>`;
```

- [ ] **Step 4: Replace `BEHAVIOR_WITH_DB`**

In the same file, replace the whole `BEHAVIOR_WITH_DB` constant with:

```typescript
const BEHAVIOR_WITH_DB = `<behavior>
- Ha a kérdés kétértelmű (hiányzik a büdzsé, a szoba adottsága vagy a darabszám), KÉRDEZZ vissza, mielőtt találgatnál. Egyszerű, egyértelmű kérdésnél viszont ne kérdezz vissza feleslegesen — haladj értelmes alapértelmezéssel.
- Csomag-összeállításnál vedd figyelembe a büdzsét (összár) és a szoba adottságait (fény, méret).
- A válaszban emeld ki a döntéshez fontos attribútumokat: ár (és akció), raktárkészlet, méret-illeszkedés, fény/öntözés/gondozás.
- Az árat forintban (Ft) add meg; ha van akciós ár, jelezd az akciót (eredeti és akciós ár).
- Ha a lekérdezés egyetlen sort sem ad vissza, közöld, hogy nincs a katalógusban illeszkedő növény, és ajánlj lazább szűrést vagy alternatívát. Soha ne találj ki terméket.
- Légy tömör: a végén természetes nyelvű összegzés, ne nyers tábla-dump.
- Ne találj ki nem létező oszlopot vagy táblát.
</behavior>`;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx test @plantbase/core`
Expected: PASS — all tests, including the 5 new ones and every pre-existing invariant.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib/schema-context.ts packages/core/src/lib/schema-context.spec.ts
git commit -m "feat(core): tighten system prompt for cost and answer quality"
```

---

### Task 2: Sync the prompt documentation

**Files:**

- Modify: `docs/system-prompt.md` (the `<rules>`, `<behavior>`, `<tools>` sections and the `<schema>` category comment)

**Interfaces:**

- Consumes: the exact `RULES_WITH_DB` / `BEHAVIOR_WITH_DB` / `TOOLS_WITH_DB` text produced in Task 1 and already present in `schema-context.ts`.
- Produces: documentation only; nothing depends on it.

- [ ] **Step 1: Update the `<schema>` category comment**

In `docs/system-prompt.md`, change the `category` comment line so it matches the live schema hint (add the "reminder" note):

```
  category,                              -- pl. szobanövény / kerti / pozsgás / kaktusz / fűszer / fa-cserje / lógó / virágzó (csak emlékeztető; a hiteles listát a listCategories adja)
```

- [ ] **Step 2: Replace the `<rules>` block**

Replace the `<rules>` block in the doc's fenced XML with the exact content of `RULES_WITH_DB` from Task 1 Step 3 (the text between and including `<rules>` … `</rules>`).

- [ ] **Step 3: Replace the `<behavior>` block**

Replace the `<behavior>` block in the doc with the exact content of `BEHAVIOR_WITH_DB` from Task 1 Step 4 (`<behavior>` … `</behavior>`).

- [ ] **Step 4: Replace the `<tools>` block**

Replace the `<tools>` block in the doc so it includes both tools, matching `TOOLS_WITH_DB` in `schema-context.ts`:

```
<tools>
- runSql(query): read-only SQL futtatás a katalóguson. A generált SQL-t mindig ezzel futtasd, ne csak kiírd.
- listCategories(): a katalógusban ténylegesen előforduló kategóriák hiteles, ábécé-rendezett listája. Kategóriára szűrésnél / kategória-kérdésnél ezt használd, ne a séma-komment felsorolását.
</tools>
```

- [ ] **Step 5: Verify docs mention the new rules**

Run: `grep -n "SELECT \*\|alapból 10\|egyetlen sort sem\|listCategories" docs/system-prompt.md`
Expected: matches for each — confirming the doc mirrors the live prompt.

- [ ] **Step 6: Commit**

```bash
git add docs/system-prompt.md
git commit -m "docs: sync system-prompt.md with the improved prompt"
```

---

### Task 3: Full workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full check**

Run: `pnpm nx run-many -t test typecheck build`
Expected: all projects PASS (test, typecheck, build) — confirms no regression from the prompt/doc changes.

- [ ] **Step 2: (Optional) manual smoke check**

If a DB + `ANTHROPIC_API_KEY` are available:
Run: `pnpm --filter @plantbase/cli exec tsx src/main.ts ask "Milyen pozsgások vannak raktáron 5000 Ft alatt?"`
Expected: a concise Hungarian answer; the logged SQL selects specific columns (no `SELECT *`) with `LIMIT`.

## Self-Review

**1. Spec coverage:**

- No `SELECT *` → Task 1 rules. ✓
- `description` only on request → Task 1 rules. ✓
- Single-query preference → Task 1 rules. ✓
- Tighter LIMIT (10/50) → Task 1 rules. ✓
- Empty-result handling → Task 1 behavior. ✓
- Price in Ft + sale marking → Task 1 behavior. ✓
- Avoid needless clarifying questions → Task 1 behavior. ✓
- Preserve existing rules/behavior/invariants → kept verbatim in Task 1 constants; invariants in Global Constraints. ✓
- No-DB branch untouched → not modified by any task. ✓
- docs/system-prompt.md sync (listCategories, category reminder, new rules) → Task 2. ✓
- Verification → Task 3. ✓

**2. Placeholder scan:** No TBD/TODO; all code blocks are complete verbatim constants.

**3. Type consistency:** No signatures change; `buildSystemPrompt` and constant names (`RULES_WITH_DB`, `BEHAVIOR_WITH_DB`, `TOOLS_WITH_DB`) match `schema-context.ts`.
