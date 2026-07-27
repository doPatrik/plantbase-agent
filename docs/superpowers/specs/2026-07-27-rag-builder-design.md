# Multi-Agent RAG — 2. al-projekt: rag-builder (chunkolás → embedding → pgvector feltöltés)

- **Dátum:** 2026-07-27
- **Státusz:** jóváhagyva (brainstorming lezárva)
- **Scope:** a 4 al-projektes RAG-átalakítás **2. al-projektje**. Épít az SP1-re
  (`documents`/`document_chunks` séma, `embedding.ts`, `knowledge-store.ts`, config-loaderek).
  Előfeltétel a valós embedding-futtatáshoz: `OPENAI_API_KEY` a gyökér `.env`-ben (jelenleg placeholder).

## Kontextus és kiindulás

Az SP1 (merged PR #17) letette a RAG adat- és konfigurációs alapját:

- `packages/db`: `documents` + `document_chunks` séma, pgvector HNSW cosine index.
- `packages/core/src/lib/embedding.ts`: `embedTexts(values, opts)` / `embedQuery` a Vercel AI SDK
  (`embedMany`/`embed`) + `@ai-sdk/openai` fölött; az embedding-modell injektálható (teszthez fake).
- `packages/core/src/lib/knowledge-store.ts`: `pg`-alapú adathozzáférés — `upsertDocumentWithChunks`
  (RW, idempotens, `source_path` kulcs, `content_hash` mezővel), `searchChunks` (RO), `getChunkStats` (RO),
  `assertEmbeddingDim`, `toVectorLiteral`. Kulcs interfészek: `DocumentInput`
  (`source_path`, `title`, `source_url`, `category`, `content_hash`, `char_count`),
  `ChunkInput` (`chunk_index`, `content`, `heading_path`, `token_count`, `embedding`).

Az SP2 célja: egy külön Nx app (`apps/rag-builder`), ami a `seed/knowledge` (202 markdown cikk) tudásbázist
beolvassa, **heading-tudatosan chunkolja**, embeddeli és a `document_chunks`-ba tölti — **idempotensen**,
`content_hash` alapján kihagyva a változatlan dokumentumokat.

### Jóváhagyott döntések (brainstorming, 2026-07-27)

1. **Chunkolás:** heading-tudatos + overlap. Markdown-headingek mentén szekcionálás, `heading_path`
   breadcrumb, apró szekciók merge-e, túl nagy szekció hard-splitje, dokumentumon belüli overlap.
2. **Chunk-méret preset (kiegyensúlyozott):** `target=512`, `overlap=64`, `min_merge=128`,
   `hard_split=800` token (token = közelítő, karakter/4 becslés). Medián cikk (~1400 tok) → ~3 chunk,
   202 cikk → ~600 chunk nagyságrend.
3. **Idempotencia:** hash-alapú skip **az embedding előtt**. Futás elején beolvassuk a meglévő
   (`source_path` → `content_hash`) párokat; a változatlan dokumentumokat teljesen kihagyjuk
   (nincs chunkolás/embedding/írás). → változatlan repo újrafuttatása: 0 embedding hívás.
4. **CLI-felület:** `build` (alap) dokumentumonkénti haladás-loggal + záró összegzővel; `--dry-run`
   (chunkolás + riport OpenAI/DB nélkül); `--force` (hash-skip figyelmen kívül hagyása); `stats` parancs
   (`getChunkStats` kiírása, RO).
5. **„Kész" definíció:** kód + zöld Vitest tesztek + `--dry-run` valós seeden lefut (kulcs nélkül).
   A valós embedding+pgvector-feltöltés az `OPENAI_API_KEY` beszerzése után fut; az SP2 PR nem blokkolódik a kulcson.

## A) Architektúra és monorepo-illesztés

Új Nx Node app: `apps/rag-builder` (`@plantbase/rag-builder`), az `apps/cli` mintájára
(`commander` belépő + esbuild build target + vitest test/typecheck). Vékony `main.ts`, a valódi logika
tesztelhető, dependency-injektált `src/lib/` modulokban. Használja a `@plantbase/core`-t; azon egyetlen
kis kiegészítést végez.

### Új core-helper (`packages/core/src/lib/knowledge-store.ts`)

```ts
getExistingDocumentHashes(opts?: ReadOptions): Promise<Map<string, string>>
```

RO kapcsolaton `SELECT source_path, content_hash FROM documents`, `source_path → content_hash` map.
A hash-alapú skiphez. Tartja az invariánst (pg-adathozzáférés a knowledge-store-ban, olvasás RO-n).
A `ReadOptions` a meglévő `getChunkStats`/`searchChunks` mintáját követi (opcionális `connectionString`).

### Új függőség nincs

`sha256` a `node:crypto`-ból; `commander` már a repóban; frontmatter-parse és chunker kézzel írt.

## B) Komponensek (`apps/rag-builder/src/`)

| Modul                   | Felelősség                                                                                          | Tiszta    |
| ----------------------- | --------------------------------------------------------------------------------------------------- | --------- |
| `main.ts`               | commander belépő: `build` (alap) + `stats` parancs; `--force` / `--dry-run` / `--path <dir>` flagek | nem (I/O) |
| `lib/frontmatter.ts`    | markdown frontmatter + body szétválasztása; `title`/`source`/`category` **zod-validálva**           | igen      |
| `lib/token-estimate.ts` | közelítő token-szám (karakter/4 heurisztika)                                                        | igen      |
| `lib/chunker.ts`        | `chunkMarkdown(body, opts) → Chunk[]` heading-tudatos + merge + hard-split + overlap                | igen      |
| `lib/pipeline.ts`       | orchestráció: fájllista → parse → hash → skip → chunk → embed → upsert; injektált deps              | igen (DI) |

**`frontmatter.ts` részletek:** a `---\n…\n---\n` blokkot választjuk le a body elejéről; a blokk sorain
**első kettőspont** (`: `) mentén `key: value` bontás — így a `title: Bug Off: All About Mealybugs`
(kettőspont az értékben) helyesen kezelt. Az eredmény zod-sémán megy át: `title` (nem üres string),
`category` (nem üres string), `source` (opcionális; a DB `source_url`-ja, hiány → `null`). Ismeretlen
mezők figyelmen kívül. Frontmatter hiánya vagy kötelező mező hiánya → zod-hiba (a pipeline fájlszintű
hibaként kezeli).

**`Chunk` típus** (a chunker kimenete, a `ChunkInput` embedding nélküli előfoka):

```ts
interface Chunk {
  readonly chunk_index: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly token_count: number; // közelítő
}
```

## C) Chunker-algoritmus

Paraméterek (`ChunkOptions`, defaultok a kiegyensúlyozott preset): `target=512`, `overlap=64`,
`minMerge=128`, `hardSplit=800` (token, közelítő).

1. **Szegmentálás.** A body sorait végigolvasva a `^#{1,6}\s` heading-sorok mentén szekciókra bontunk.
   Heading-stacket vezetünk szintenként (H1..H6): egy `Hn` heading felülírja a saját szintjét és törli a
   mélyebb szinteket. A szekció **`heading_path`-ja** a stack aktuális, nem-üres headingjeinek
   breadcrumbje `>` elválasztóval (pl. `How To Care For a Snake Plant > How To Repot`). A legelső,
   heading előtti szöveg (ha van) `heading_path = null`.
2. **Greedy pack.** A szegmenseket sorban chunkokba pakoljuk, amíg a becsült token-szám el nem éri a
   `target`-et. Egy chunk `heading_path`-ja a benne lévő **első** szegmensé. Így a `minMerge` alatti apró
   szekciók természetesen összevonódnak a szomszédjukkal (a pakolás következménye). A **`minMerge` konkrét
   szerepe** a záró darab kezelése: ha az utolsó lezárt chunk becsült token-száma `minMerge` alatt van
   (és van előtte chunk ugyanabban a dokumentumban), visszaolvasztjuk az előzőbe — így nem keletkezik
   csonka mini-chunk a dokumentum végén.
3. **Hard-split.** Ha egyetlen szegmens önmagában > `hardSplit`, bekezdés- (`\n\n`), majd ha egy bekezdés
   is túl nagy, whitespace-határon tovább vágjuk `target` körüli darabokra.
4. **Overlap.** Dokumentumon belül két egymást követő chunk közé ~`overlap` token átfedést viszünk:
   az előző chunk végéből ~`overlap` tokennyi szöveg a következő chunk elejére másolódik. (Karakter-alapú
   közelítéssel, whitespace-határra igazítva, hogy ne vágjunk szó közepén.)
5. **`chunk_index`** 0-tól, dokumentumonként, a végső (overlap utáni) sorrendben.

Üres/whitespace-only body → üres chunk-lista (a pipeline warning-gal kihagyja).

## D) Adatfolyam

### `build` parancs

1. `--dry-run` nélkül: `loadEmbeddingConfig()` — fail-fast, ha nincs `OPENAI_API_KEY` (magyar üzenet).
   `--dry-run` esetén az embedding-config betöltését kihagyjuk → a parancs kulcs nélkül fut.
2. `seed/knowledge/*.md` listázása. A gyökeret/seed-könyvtárat findUp-pal találjuk meg (a `core` `paths`
   mintája); `--path <dir>` felülírja a default `seed/knowledge`-et.
3. Ha nem `--force` és nem `--dry-run`: `getExistingDocumentHashes()` (map beolvasása).
4. Fájlonként, sorban (determinisztikus log):
   - nyers tartalom beolvasása → `content_hash = sha256(raw)`, `char_count`
   - `parseFrontmatter(raw)` → `title`, `source_url` (=`source`|null), `category`, `body`
   - **ha nem `--force` és `hash === existing.get(source_path)` → SKIP** (log), tovább
   - `chunkMarkdown(body)` → chunks; ha 0 chunk → warning, tovább
   - **`--dry-run`: chunk-riport kiírása (chunk-szám, méretek, heading_path-ok), tovább** (nincs embed/írás)
   - `embedTexts(chunks.map(c => c.content))` → minden vektorra `assertEmbeddingDim`
   - `DocumentInput` + `ChunkInput[]` összeállítása → `upsertDocumentWithChunks(doc, chunks)` (RW, tranzakció)
   - processed-log
5. Záró összegző: `built / skipped / chunks / errors`. Ha `errors > 0`, a folyamat nem-nulla exit-kóddal áll le.

`source_path` = a fájl neve a `seed/knowledge`-en belül (pl. `ask-the-sill__best-office-plant.md`),
összhangban az SP1 sémával.

### `stats` parancs

`getChunkStats()` → a jelenlegi DB-állapot kiírása (dokumentum-/chunk-szám, chunk-méret min/avg/max,
embedding-lefedettség). RO, gyors, nem igényel OpenAI-kulcsot.

## E) Hibakezelés

- **Fájlszintű izoláció:** egy hibás fájl (rossz/hiányzó frontmatter, embedding-dim eltérés, üres body)
  nem állítja le a futást — logolódik, a hibaszámlálóba kerül, a többi fájl folytatódik. A záró összegző
  jelzi a hibaszámot, és nem-nulla exit-kóddal zár, ha volt hiba.
- Hiányzó `OPENAI_API_KEY` nem-dry-run módban → **azonnali** leállás egyértelmű magyar üzenettel (config-loader).
- Üres body / 0 chunk → warning, a dokumentum kihagyása (nem hiba).
- Minden nem megbízható input zod-dal a határon (frontmatter, config). DB/embedding felé a paraméterezés a
  `core`-ban már megoldott (paraméteres query, dim-guard).
- Embedding-hiba (provider) → a `core` `embedTexts` becsomagolja; a pipeline fájlszintű hibaként kezeli.

## F) Tesztelés (Vitest, DI-fake-ekkel, hálózat/DB nélkül)

- **`frontmatter.spec`** — valid 3-mezős; kettőspontos title (`Bug Off: All About Mealybugs`);
  hiányzó kötelező mező → zod-hiba; nincs frontmatter → hiba; hiányzó opcionális `source` → `source_url=null`.
- **`chunker.spec`** — `heading_path` breadcrumb (beágyazott headingek); apró szomszédos szekciók
  összevonása `target`-ig; `hardSplit` fölötti szekció bekezdés-határon vágódik; overlap megléte két
  egymást követő chunk közt; `chunk_index` folytonos 0-tól; üres/whitespace body → `[]`.
- **`token-estimate.spec`** — alap becslés, üres string.
- **`pipeline.spec`** — fake fs (fájllista + reader), **determinisztikus fake `embedTexts`**, fake store
  (`getExistingDocumentHashes` + `upsertDocumentWithChunks` hívások rögzítése): skip változatlan hashre;
  `--force` újraépít (nincs skip); `--dry-run` nem hív embeddinget/upsertet; egy fájl hibája nem állítja
  le a többit; helyes záró összegző számok.
- **`knowledge-store.spec` bővítés** — az új `getExistingDocumentHashes`: fake `pg` klienssel a generált
  SQL + a `source_path → content_hash` map felépítésének ellenőrzése.

## G) Nx-integráció

- Az app generálása a `nx-generate` skillen keresztül (`@nx/node` app), az `apps/cli`-vel konzisztens
  target-készlet (build esbuild-del, test/typecheck vitesttel).
- Fejlesztői futtatás: `pnpm --filter @plantbase/rag-builder exec tsx src/main.ts build [--dry-run|--force]`
  és `... stats`. (A `.env`-et findUp-pal találja meg, a `core` mintája szerint.)
- Opcionális gyökér-scriptek (`rag:build`) elhagyhatók YAGNI alapon; a plan dönt róla.

## H) Amit SP2 NEM tartalmaz

- Agentek / Vercel AI SDK agent-loop / `ask-agent.ts` migráció → SP3.
- Backend (Express, `/api/chat`, debug-endpointok, engine-trace) → SP3.
- Frontend → SP4.
- `shared` package + engine-trace típusok → SP3/SP4.
- A retrieval-oldali kód (`searchChunks` már az SP1-ben kész; a rerank/HyDE SP3).

## Nyitott pontok / feltételezések

- A `token_count` közelítő (karakter/4). Pontos tokenizáló (pl. tiktoken) nem cél SP2-ben; ha a retrieval
  minősége indokolja, később cserélhető a `token-estimate.ts` mögött.
- A feldolgozás sorban megy (nincs párhuzamos embedding). ~600 chunk mellett ez elég gyors és
  determinisztikus logot ad; párhuzamosítás későbbi optimalizáció, ha szükséges.
- A hash a **nyers fájltartalom** sha256-ja (frontmatterrel együtt) — bármely szerkesztés (metaadat is)
  újraépítést vált ki. Ez a kívánt viselkedés.
- Az `--path` override elsősorban tesztet/kísérletezést szolgál; a default a repo `seed/knowledge`-e.
