# Mérési terv (teljes tábla)

| Mit mérünk | Honnan lesz adat | Hogyan riportáljuk | Kinek |
|---|---|---|---|
| Kezelési idő / megkeresés (a #2 fájdalomhoz — megoldott-fájdalom metrika) | agent-napló (`logs/<timestamp>.jsonl`), kérés és válasz közti idő | heti automatikus összesítő | folyamatgazda (ügyfélszolgálat vezetője) |
| Eszkalációs arány (hiba-metrika — ez azt méri, mikor NEM tudott segíteni a rendszer) | `logs/escalations.jsonl`, nyitott jegyek / összes megkeresés | havi egy dia a vezetői riportban | szponzor (e-commerce igazgató) |
| Átlagos eszkaláció-lezárási idő | `logs/escalations.jsonl`, `resolvedAt - createdAt` | heti automatikus összesítő | folyamatgazda |
| Megoldatlan (`pending`) jegyek száma élesben | `GET /api/escalations` állapot | napi ellenőrzés (Support fül) | folyamatgazda |
| Válaszminőség (forrással alátámasztott válaszok aránya) | `route: 'knowledge'` válaszok közül hánynak van `sources` mezője | heti automatikus összesítő | folyamatgazda |
| RAG-lekérdezés költsége (USD/kérdés) | `/api/debug/cost` mért mintája (`docs/koltsegbecsles.md`) | havi egy dia a vezetői riportban | szponzor |

**Megjegyzés a forrásokról:** minden sorhoz létező, a PoC-ban ma is elérhető
adatforrás tartozik — nincs olyan sor, amihez új naplózást kellene először
beépíteni. Az "esetszám/hónap" és "volumen/év" jellegű sorokat a
`one-pager.md` explicit BECSÜLT-ként jelöli, mert nincs éles forgalmi adat;
ezek a pilot alatt válnak MÉRT-té.
