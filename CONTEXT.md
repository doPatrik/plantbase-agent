# Plantbase

A növény-katalógus feletti természetes nyelvű asszisztens domain-nyelve. Az agent a `products` katalógusból válaszol read-only SQL-lel; ez a fájl a domain-szakértő és a fejlesztő közös szótára (nem implementációs részlet).

## Language

**Katalógus (Catalog)**:
A webshop növénykínálata, egyetlen `products` táblaként modellezve.
_Avoid_: termékadatbázis, készlet (a "készlet" a `stock` mező)

**Termék (Product)**:
A katalógus egy sora — egy megvásárolható növény, a tulajdonságaival (ár, méret, gondozás, biztonság).
_Avoid_: növény (informálisan igen, de a domain-entitás neve Termék), tétel, cikk

**Kategória (Category)**:
A növény besorolása egy zárt szókészletből (pl. szobanövény, pozsgás, kaktusz, fűszer). A `products.category` mezőben él.
_Avoid_: típus, csoport, fajta

**Kategória-szókészlet (Category vocabulary)**:
A katalógusban ténylegesen előforduló kategóriák halmaza. Hiteles forrása a **`listCategories`** tool (a tényleges adatból); a system prompt kategória-felsorolása csak nem-hiteles emlékeztető (hint), amely elavulhat.

## Relationships

- A **Katalógus** egy vagy több **Terméket** tartalmaz
- Minden **Termék** pontosan egy **Kategóriába** tartozik
- A **Kategória-szókészlet** a **Katalógusban** előforduló **Kategóriák** distinct halmaza

## Example dialogue

> **Fejlesztő:** "A system prompt már felsorolja a kategóriákat — miért kell a `listCategories`?"
> **Domain-szakértő:** "Mert az a felsorolás emlékeztető, nem hiteles. Ha a seed új **Kategóriával** bővül, a prompt elavul; a **Kategória-szókészletet** mindig a tényleges adatból kell venni, hogy az agent ne hallucináljon és ne hagyjon ki kategóriát."

## Flagged ambiguities

- "kategóriák felsorolása" kétértelmű volt: a system prompt statikus _hint_-je vs. a `listCategories` _hiteles_ listája — feloldva: a tool a hiteles forrás, a prompt csak emlékeztető.
