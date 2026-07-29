# SP4 — Frontend (React + shadcn/ui) — Design

> Al-projekt az RAG-átalakítás roadmapjéből (`docs/rag/roadmap.md`, SP4).
> Előfeltétel: SP3b kész (merged PR #25) — a `POST /api/chat` (v7 UI Message Stream) + debug endpointok állnak a frontend alatt.
> Kapcsolódó: SP3b spec `docs/superpowers/specs/2026-07-28-sp3b-backend-design.md`; a shared kontraktus (`TraceEvent`, `SourceRef`, `ChatMessage`) a `packages/shared`-ben.

## Cél

Egy ChatGPT-szerű **streaming chat felület**, ami a backend `POST /api/chat` végpontját fogyasztja a Vercel AI SDK v7 `useChat` hookján át. A válasz mindig streamelve érkezik (üres képernyő soha), a válasz alatt megjelennek a **forráshivatkozások**, és — ha a backend `DEBUG=true` módban fut — egy összehajtható **engine-trace panel** mutatja a pipeline lépéseit időrendben.

Lokális reference implementáció: nincs auth, routing/több oldal, session-perzisztencia vagy felhő-deploy.

## Scope

1. **Új Nx app `apps/frontend`:** React + Vite (`@nx/react`), Tailwind CSS + shadcn/ui, `@ai-sdk/react`.
2. **Multi-turn chat:** a teljes history megy minden kérésnél; Reset gomb új beszélgetéshez.
3. **Wire-format adapter:** a `useChat` `UIMessage[]`-jét a backend `{ messages: {role, content}[] }` kontraktusára lapítja (a backend érintetlen marad).
4. **Források:** a `data-sources` partból citáció-chipek a válasz alatt.
5. **Engine-trace panel:** a `data-trace` (transient) eseményekből összehajtható, ikonos/időrendi panel; egyúttal élő stage-státusz a streaming alatt.
6. **Két mód:** DEBUG=true → stage-címkézett státusz + trace-panel; DEBUG=false → általános spinner, panel nélkül.
7. **Tesztek:** Vitest + React Testing Library, hálózat nélkül.

Nem cél (YAGNI): külön debug-oldal a `GET /api/debug/chunks` / `POST /api/debug/search`-hoz, localStorage-persistence, auth, üzenet-szerkesztés/regenerate, health-státuszpötty (a hibabanner reaktívan kezeli a degradált esetet).

## Architektúra

### 1. App-váz és tooling

Nx React-app Vite-tal (`@nx/react` plugin). Dev: `pnpm nx serve frontend` (Vite dev server, ~4200 port), a `/api` proxy-zva a backendre (`http://localhost:3000`) a `vite.config.ts` `server.proxy`-jában — így a `useChat` relatív `/api/chat`-et hív, CORS nélkül. A backendet külön indítod (`pnpm nx serve backend`). Build: `nx build frontend` → statikus assetek.

Tailwind CSS + shadcn/ui: a shadcn kész, bemásolt komponenseit használjuk (`Button`, `Textarea`, `Collapsible`) — nem építünk nulláról. `components.json` + Tailwind-config + a `cn()` util a repo-konvenció szerint (`kebab-case` fájlnevek, TS strict).

### 2. Wire-format seam

A backend `POST /api/chat` body-ja a már mergelt, tesztelt kontraktus: `{ messages: { role: 'user'|'assistant', content: string }[] }` (lásd `chatRequestSchema`). A `@ai-sdk/react` `useChat` viszont alapból `UIMessage[]`-et küld (`parts`-alapú). A frontend a `DefaultChatTransport` `prepareSendMessagesRequest` opciójával **küldés előtt** átalakítja a `UIMessage[]`-et a backend alakjára:

- egy pure `toChatMessages(messages: UIMessage[]): ChatMessage[]` függvény: minden üzenet `role`-ját megtartja, a `content`-et a `text` part(ok) összefűzéséből képzi (a `data-*` és egyéb partokat elhagyja).
- ez a függvény önállóan unit-tesztelhető (nincs hálózat).

Így a backend kontraktusa érintetlen marad, a seam egy helyre (a transport-konfigba) van izolálva.

### 3. Komponensek

Minden komponens egy jól határolt felelősség; a `useChat` állapota a `ChatView`-ban él, propokon/derivált értékeken át adódik lefelé.

- **`ChatView`** — birtokolja a `useChat`-et (custom transport, `onData`, `onError`), az input-területet (shadcn `Textarea` + submit `Button`, Enter=küldés / Shift+Enter=új sor), és a `Reset` gombot (`setMessages([])` + trace-state ürítése).
- **`MessageList`** — végiggörgeti a `messages`-t, auto-scroll az aljára stream közben.
- **`MessageBubble`** — user vs. assistant megjelenés; az assistant-választ **Markdownként** rendereli (a RAG-válaszok listákat/címeket tartalmaznak); a `text` partokból építi a szöveget.
- **`Sources`** — az assistant-üzenet `data-sources` partjából (perzisztens, `message.parts`-ban) citáció-chipek: `title` + `headingPath`; ha van `sourceUrl`, link, különben a `sourcePath` tooltipben.
- **`TracePanel`** — shadcn `Collapsible`; egy üzenethez tartozó `TraceEvent[]`-et időrendben jeleníti meg, típusonként ikonnal/színnel (router → hyde → retrieval[topK, maxSimilarity] → rerank[in/out, degraded] → guardrail[grounded, threshold] → usage/error). Alapból összecsukva; csak akkor renderel, ha van trace-esemény (azaz DEBUG=true).
- **`StatusIndicator`** — élő loading-visszajelzés a streaming alatt (lásd 4. és 5. pont).

### 4. Data flow

1. **Submit** → `sendMessage({ text })`; a transport `prepareSendMessagesRequest`-je a teljes `messages`-t `toChatMessages`-szel `{ messages }`-re alakítja → `POST /api/chat`.
2. **Stream** (`useChat` parse-olja a UI Message Stream-et):
   - `text-delta` → az aktuális assistant-üzenet `text` partja (Markdown-render).
   - `data-trace` (**transient** — `message.parts`-ba NEM kerül; forrás: AI SDK v7 doksi) → a `useChat` **`onData`** callbackje kapja el → egy `useTrace` állapotba gyűjti az aktuális fordulóhoz (`TraceEvent[]`).
   - `data-sources` (nem-transient) → `message.parts` → `Sources` chipek.
3. **Finish** → a státusz eltűnik; a `TracePanel` az adott üzenethez összecsukva elérhető marad.

A `useTrace` állapot a fordulónkénti `TraceEvent[]`-et tartja (map: az éppen streamelő assistant-üzenet indexe/id-je → események). Mivel a trace transient, a frontend maga felelős a megőrzéséért; a stream végén a legutóbbi forduló trace-e az adott `MessageBubble` `TracePanel`-jéhez rendelődik.

### 5. Két mód (DEBUG on/off) és a StatusIndicator

A frontend nem tudja előre, hogy a backend DEBUG-módban van-e; reaktívan alkalmazkodik ahhoz, ami a streamen jön:

- **DEBUG=true** (érkeznek `data-trace` események): a `StatusIndicator` a **legutóbbi trace-esemény** típusából képez magyar stage-címkét — `router`→„Útvonalválasztás…", `hyde`→„Hipotetikus válasz…", `retrieval`→„Dokumentumok keresése…", `rerank`→„Reranking…", `guardrail`→„Ellenőrzés…", `answer-start`→„Válasz generálása…". A `TracePanel` renderel.
- **DEBUG=false** (nincs trace): általános „Gondolkodom…" spinner az első `text-delta`-ig; `TracePanel` nem jelenik meg.

A stage-címke mapping egy pure függvény (`statusLabel(trace: TraceEvent[]): string`), önállóan tesztelhető.

### 6. Error & loading

- A `useChat` `status`-a (`submitted` | `streaming` | `ready` | `error`) vezérli a spinner/StatusIndicator megjelenését; üres képernyő soha.
- `onError` → magyar hibabanner a chat fölött (a backend `onError`-ból jövő üzenettel; a v7 stream a hibát part-ként hozza). A degradált eset (pl. hiányzó `OPENAI_API_KEY` → tudás-út 503) így reaktívan, a felhasználó számára releváns pillanatban jelenik meg — nincs külön health-poll.
- Submit tiltva, amíg `status !== 'ready'` vagy üres az input.

## Tesztelés

Vitest + React Testing Library, hálózat/DB nélkül (repo-konvenció). A hálózati határ mockolva (fetch-mock vagy a transport injektált fake-je), a `useChat` valós stream-parse-olása nem cél a unit-szinten.

Lefedendő:

- `toChatMessages` — UIMessage→ChatMessage transform (üres, csak-text, több text part, nem-text partok elhagyása).
- `statusLabel` — trace→magyar címke mapping (üres, minden stage-típus, ismeretlen).
- `MessageBubble` — user/assistant render, Markdown.
- `Sources` — `data-sources` partból chipek (URL-es és URL nélküli forrás).
- `TracePanel` — injektált `TraceEvent[]`-ből az összes stage megjelenik; üres trace → nem renderel.
- `ChatView` (integráció, mockolt transporttal) — submit → user-üzenet megjelenik; hiba → banner.

## Al-projekt kimenete

Egy futtatható React frontend (`pnpm nx serve frontend`), ami a helyi backendhez kapcsolódva multi-turn streaming chatet ad, forrásokkal és — DEBUG=true mellett — engine-trace panellel. Ez zárja az RAG-átalakítás roadmapjének SP1–SP4 ívét: seed→pgvector→motor→backend→frontend.
