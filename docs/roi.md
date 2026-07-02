# 💰 ROI — megtakarítás egy 5 fős irodára

> A plantbase-agent bevezetésének pénzbeli megtérülése.
> Minden feltevés kiírva, alul érzékenységi vizsgálattal (óvatos / reális / optimista).

---

## 📌 Kiinduló feltevések

A mozgatható paraméterek — ha ezek változnak, a végeredmény is.

| Feltevés                   | Érték              | Indoklás                                           |
| -------------------------- | ------------------ | -------------------------------------------------- |
| Létszám                    | **5 fő**           | adott                                              |
| Munkanap / év              | **220 nap**        | 250 munkanap − ~30 nap szabadság/betegség          |
| Bruttó bér / fő / hó       | **500 000 Ft**     | mid-level irodai / ügyfélszolgálati sáv (HU, 2026) |
| Munkáltatói teljes költség | **565 000 Ft/hó**  | +13% szociális hozzájárulási adó                   |
| Havi munkaóra              | **168 óra**        | 8 óra × 21 nap                                     |
| **➡️ Terhelt órabér**      | **≈ 3 360 Ft/óra** | 565 000 / 168                                      |

A megtakarítás alapja a **katalógus-lekérdezésre fordított idő**, amit az agent lerövidít.

| Lekérdezési feltevés             | Kézzel | Agenttel     |
| -------------------------------- | ------ | ------------ |
| Egy lekérdezés ideje             | 6 perc | 0,5 perc     |
| Lekérdezés / fő / nap            | 8 db   | 8 db         |
| **➡️ Megtakarítás / lekérdezés** | —      | **5,5 perc** |

> A _6 perc_ az az idő, amíg valaki megkeresi a megfelelő szűrőt/riportot, vagy megkér egy kollégát, hogy fusson le egy SQL-t. Az agent természetes nyelvű kérdésből **másodpercek alatt** válaszol.

---

## ⏱️ Idő- és pénzmegtakarítás (reális eset)

```
Megtakarított idő / fő / nap  = 8 × 5,5 perc        = 44 perc
Megtakarított idő / fő / év   = 44 perc × 220 nap   ≈ 161 óra
5 főre / év                   = 161 óra × 5         ≈ 806 óra
```

| Tétel                         | Számítás           | Összeg                  |
| ----------------------------- | ------------------ | ----------------------- |
| **Bruttó megtakarítás (idő)** | 806 óra × 3 360 Ft | **≈ 2 708 000 Ft / év** |

---

## 🧾 Költségoldal

Hogy **nettó** megtakarítást kapjunk, le kell vonni a rendszer költségeit.

| Tétel                          | Számítás                  | Összeg             |
| ------------------------------ | ------------------------- | ------------------ |
| API-költség (LLM)              | ~15 000 Ft/fő/hó × 5 × 12 | ~900 000 Ft/év     |
| Üzemeltetés (DB, hosting)      | átalány                   | ~120 000 Ft/év     |
| Egyszeri bevezetés / betanítás | 1. évre elosztva          | ~200 000 Ft        |
| **Összes költség (1. év)**     |                           | **≈ 1 220 000 Ft** |

---

## ✅ Eredmény (reális, 1. év)

```
Nettó megtakarítás = 2 708 000 − 1 220 000  ≈ 1 488 000 Ft / év
ROI                = 1 488 000 / 1 220 000  ≈ 122 %
Megtérülési idő    ≈ 5,5 hónap
```

> **2. évtől** kiesik az egyszeri bevezetési költség → nettó megtakarítás **~1 688 000 Ft/év** (ROI ~165%).

---

## 📊 Érzékenységi vizsgálat

Egyetlen szám sosem elég — a lényeg, hogy a **reális eset óvatos feltevések mellett is** pozitív legyen.

| Forgatókönyv     | Megtak. / lekérdezés | Lekérdezés / nap | Bruttó megtak. / év | Nettó (1. év)  | ROI   |
| ---------------- | -------------------- | ---------------- | ------------------- | -------------- | ----- |
| 🟡 **Óvatos**    | 3 perc               | 5 db             | ≈ 924 000 Ft        | ≈ −296 000 Ft  | −24%  |
| 🟢 **Reális**    | 5,5 perc             | 8 db             | ≈ 2 708 000 Ft      | ≈ 1 488 000 Ft | +122% |
| 🔵 **Optimista** | 8 perc               | 12 db            | ≈ 5 906 000 Ft      | ≈ 4 686 000 Ft | +384% |

**Olvasat:** a reális és optimista esetben a beruházás egyértelműen megtérül. Az óvatos esetben az 1. év még enyhén mínusz, de a **2. évtől** (bevezetési költség nélkül) ott is pozitívba fordul.

---

## 🔑 Összefoglaló

| Mutató                     | Reális eset         |
| -------------------------- | ------------------- |
| Megtakarított munkaidő     | **≈ 806 óra / év**  |
| Bruttó megtakarítás        | **≈ 2,7 M Ft / év** |
| Nettó megtakarítás (1. év) | **≈ 1,49 M Ft**     |
| ROI (1. év)                | **≈ 122%**          |
| Megtérülési idő            | **≈ 5,5 hónap**     |

> A számok a fenti feltevéseken alapulnak. A valós bér-sáv és lekérdezési volumen behelyettesítésével pontosítható.
