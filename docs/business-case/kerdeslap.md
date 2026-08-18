# Kérdéslap — felkészülés a kötekedőkre

## A hat kapott kérdés

**1. Milyen személyes adat kerül a rendszerbe, és melyik pontján tűnik el
vagy anonimizálódik?**

A jelenlegi Ügyfélchat use case szándékosan nem gyűjt és nem kezel
személyes adatot: a chat-üzenetek csak a kérdés szövegét tartalmazzák, nincs
bejelentkezés, nincs vásárlói profil, nincs rendelésszám a folyamatban. Ami
naplózásra kerül (`logs/<timestamp>.jsonl`), az a kérdés szövege, a válasz és
a token-használat — ha valaki a kérdésbe beírja a nevét vagy címét, az
szövegként bekerül a naplóba, ezért a rollout előtt egy PII-szűrő
(kulcsszó/regex-alapú redaction a naplózás előtt) hiányzó, de olcsón
pótolható feltétel a teljes bevezetéshez.

**2. Hol fut a modell, hova utazik az adat, és mi az, ami sosem hagyja el a
saját környezetünket?**

Két külső szolgáltató van a folyamatban: az Anthropic API (Claude Haiku a
routolásra/HyDE-re/rerankre, Claude Sonnet a válaszra) és az OpenAI API
(`text-embedding-3-small` a tudásbázis-kereséshez). Mindkettőhöz csak a
kérdés szövege és a nyilvános katalógus/tudásbázis releváns részletei mennek
ki — soha nem megy ki vásárlói név, email, cím vagy rendelési adat, mert
ilyet a rendszer nem is tárol. A Postgres-adatbázis (katalógus + tudásbázis)
a saját infrastruktúránkon fut, ahhoz a backend csak read-only kapcsolattal
fér hozzá.

**3. Melyik lépésnél hagy jóvá ember, mit lát a döntés előtt, és mit tud
visszavonni utána?**

Amikor a guardrail bizonytalan (nincs elég megbízható forrás a
tudásbázisban a `RAG_GROUNDING_THRESHOLD` küszöb felett), a rendszer nem
hallucinál: eszkalációs jegyet nyit, és az ügyfélnek jelzi, hogy kollégához
irányítja. A Support fülön egy ember látja a kérdést és a hasonlósági
értéket, megírja a választ, és a "Jóváhagyás és válasz" gombbal explicit
jóváhagyja, mielőtt az (a jelenlegi PoC-ban naplózott) válasz lezárásra
kerül. Ember nélkül a rendszer ezekben az esetekben egyáltalán nem ad
tartalmi választ.

**4. Mi kerül naplóba, ki fér hozzá, és mennyi ideig marad meg?**

Minden interakció JSONL-fájlba kerül (`logs/<timestamp>.jsonl`): kérdés,
válasz, forrás, útvonal (tudás/katalógus), token-használat. Az eszkalációk
külön, session-független fájlba (`logs/escalations.jsonl`): kérdés, időbélyeg,
hasonlósági érték, állapot, végül a jóváhagyott válasz. A `logs/` mappa
gitignore-olt, csak a szervert üzemeltető csapat fér hozzá; megőrzési idő
jelenleg nincs explicit szabályozva — ez az egyik nyitott, teljes bevezetés
előtt tisztázandó pont (javaslat: 90 nap után anonimizált/aggregált
megtartás).

**5. Mi történik, ha az agent téved, és mennyi idő alatt állítható vissza az
előző állapot?**

Két hibamódot érdemes külön kezelni. (a) A guardrail helyesen ismeri fel a
bizonytalanságot → nincs hibás válasz, csak eszkaláció, ez a tervezett
működés. (b) A guardrail téved (magabiztosan, de rosszul válaszol) → ez a
maradék kockázat, amit a forrásmegjelölés csökkent (a vásárló látja, melyik
cikkből jött a válasz, és ellenőrizheti). Visszaállítás szempontjából a
teljes use case egyetlen frontend-fül (Ügyfélchat) — ha probléma merül fel,
percek alatt eltávolítható a navigációból anélkül, hogy a belső Chat fület
vagy a katalógus/tudásbázis-adatot érintené.

**6. Ki lesz a rendszer gazdája a bevezetés után, és miből fogja látni, hogy
jól működik?**

A gazda az ügyfélszolgálat vezetője. A napi működést a Support fülön (függőben lévő jegyek száma)
és a heti automatikus összesítőn (kezelési idő, eszkalációs arány, átlagos
lezárási idő — ld. `meresi-terv.md`) látja; a szponzor (e-commerce igazgató)
havonta egy diányi riportot kap ugyanezekből a számokból.

## A két saját kérdés

**7. Mi történik, ha a "Support" fülön senki nem néz rá időben a függőben
lévő jegyekre — mennyi ideig vár válasz nélkül egy valós vásárló?**

Ez a jelenlegi PoC legnagyobb gyenge pontja: nincs SLA-riasztás vagy
értesítés a függőben lévő jegyekre, csak egy manuálisan megnézhető lista.
Éles bevezetés előtt ez a hiányzó feltétel, amit pótolni kell (pl. e-mail
vagy Slack-riasztás X percnél régebbi függőben lévő jegyre) — enélkül az
eszkaláció "jobb, mint a hallucináció", de rosszabb, mint egy valódi
ügyfélszolgálati SLA.

**8. Mi van, ha ugyanaz a bizonytalan kérdés sokszor felmerül — a support
minden alkalommal újraírja ugyanazt a választ?**

Igen, ma ez a helyzet: minden eszkalált jegy egyedi, nincs "hasonló, korábban
megválaszolt kérdés" javaslat a support-munkatársnak. Ez egyben a legjobb
jelöltje a rendszer saját tanulási hurkának: ha egy adott kérdés-minta
gyakran eszkalálódik, az arra utal, hogy a tudásbázisból hiányzik egy cikk —
ezt a `logs/escalations.jsonl` gyakoriság szerinti elemzésével lehetne
tudásbázis-bővítési javaslattá alakítani, ez viszont már a második use case
jelöltje, nem ennek a PoC-nak a scope-ja.
