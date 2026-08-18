# Ügyfélirányú use case: Növényválasztó és gondozási asszisztens

> A meglévő Plantbase agent kifelé, az ügyfél ügyfelei felé fordítása.

## Mit csinál

A meglévő `/api/chat` végpont és RAG-pipeline (router → tudás-út / katalógus-út,
guardrail, forrásmegjelölés) változatlan. Két új belépési pont került a frontendbe:

- **"Ügyfélchat" fül** — a webshop látogatója (nem belső kolléga) kérdezhet
  növényválasztásról és gondozásról; ugyanaz a motor válaszol, mint a belső
  "Chat" fülön, csak ügyfél-copy-val (nincs DEBUG trace-panel, mert az amúgy is
  csak szerver-oldali `DEBUG=true` mellett menne ki).
- **"Support" fül** — amikor a guardrail bizonytalan (nincs elég megbízható forrás
  a tudásbázisban), a rendszer NEM hallucinál: egy eszkalációs jegyet nyit
  (`logs/escalations.jsonl`), és az ügyfélnek jelzi, hogy egy kollégához
  irányítjuk. A Support fülön egy ember látja a függőben lévő jegyeket, megírja
  és jóváhagyja a választ — ez az egyetlen emberi jóváhagyási pont a folyamatban.

## Hogyan indul

```bash
pnpm install
docker compose up -d
cp .env.example .env   # ANTHROPIC_API_KEY + OPENAI_API_KEY kitöltve
set -a; . ./.env; set +a
pnpm --filter @plantbase/db exec prisma migrate deploy --schema=prisma/schema.prisma
pnpm --filter @plantbase/db exec prisma db seed

pnpm nx serve backend      # egyik terminálban
pnpm nx serve frontend     # másik terminálban — http://localhost:4200
```

A böngészőben az "Ügyfélchat" fülön lehet kérdezni; a "Support" fülön nyomon
követhető és lezárható minden eszkalált jegy.

## Mi kell hozzá

- `ANTHROPIC_API_KEY` — router/HyDE/rerank (Haiku) + válasz (Sonnet).
- `OPENAI_API_KEY` — embedding (`text-embedding-3-small`) a knowledge retrieval-hez.
- Futó Postgres a `docker-compose`-ból (RO kapcsolat a katalógushoz és a
  tudásbázishoz).

## Az eszkalációs demó lépései

1. Nyisd meg az "Ügyfélchat" fület, és tegyél fel egy olyan kérdést, amire a
   tudásbázis nem ad megbízható forrást (pl. valami teljesen a témán kívüli,
   vagy egy nagyon specifikus, a 202 cikkben nem szereplő eset).
2. A chat visszajelzi, hogy nem tud megbízhatóan válaszolni, és egy kollégához
   irányítja a kérdést.
3. Váltás a "Support" fülre: a kérdés megjelenik "Függőben" jegyként, a
   hasonlósági értékkel együtt.
4. Írj egy választ a szövegdobozba, és kattints a "Jóváhagyás és válasz"
   gombra — a jegy átkerül "Megválaszolva" alá.

## Kapcsolódó dokumentumok

- [`one-pager.md`](one-pager.md) — business case one-pager
- [`prezentacio.html`](prezentacio.html) — a vezetői körnek szánt, lapozható prezentáció (nyisd meg böngészőben)
- [`meresi-terv.md`](meresi-terv.md) — a teljes mérési terv tábla
- [`kerdeslap.md`](kerdeslap.md) — felkészülés a kötekedőkre
