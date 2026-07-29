# Chunkolási stratégia indoklása

## A tudásbázis jellemzői

A chunkolási stratégia kialakításánál elsőként a feldolgozandó tudásbázis szerkezetét vettem figyelembe.

A tudásbázis jelenleg 202 Markdown dokumentumból áll, amelyek növénygondozással kapcsolatos cikkeket tartalmaznak. A dokumentumok jellemzően hasonló felépítésűek:

* YAML frontmatter található az elején, amely metaadatokat tartalmaz (például cím, forrás, kategória).
* A dokumentum egy fő címmel (`H1`) és rövid bevezetővel kezdődik.
* Ezt követően sok kisebb, kérdés-válasz jellegű szekció következik, például:
  * "How much sunlight does it need?"
  * "How often should you water it?"
  * "Is it safe for cats and dogs?"
* Ezek a szekciók általában rövid, önálló válaszokat tartalmaznak.
* A dokumentumok végén gyakran található olyan tartalom, amely nem része a tényleges tudásanyagnak (például termékajánlók vagy sablonos lábléc).

Ez alapján a tudásbázis nem hosszú, folyamatos szövegekből áll, hanem sok kisebb, egymáshoz kapcsolódó információs egységből. Emiatt egy egyszerű bekezdés-alapú darabolás nem lenne optimális.

## Alkalmazott chunkolási stratégia

A chunkolás több lépésből áll.

### 1. Heading alapú szegmentálás és hierarchia megőrzése

Első lépésként a dokumentumot a Markdown címsorok mentén bontom fel. A rendszer figyeli a címsorok hierarchiáját, és minden részhez eltárolja az adott szakasz teljes útvonalát (`heading_path`).

Például:

```
How to Care for a Peperomia Ginny
    > How often should you water a Peperomia Ginny need?
```

Ez azért fontos, mert a rövid válaszok gyakran önmagukban nem tartalmazzák a teljes kontextust.

Például egy ilyen mondat:

> Water every 1-2 weeks.

önmagában nem derül ki, hogy melyik növényről van szó. A heading útvonal segítségével viszont megmarad a kapcsolat:

```
Peperomia Ginny > Öntözési igény
```

Így a keresés és a későbbi válaszgenerálás pontosabb kontextust kap.

---

### 2. Nagy szakaszok biztonságos feldarabolása

Ha egy szakasz túl nagy méretű lenne, akkor további darabolás történik.

A darabolás sorrendje:

1. először bekezdések mentén történik,
2. ha ez nem elegendő, akkor szóhatáron történik vágás.

A cél az, hogy a rendszer soha ne vágjon félbe egy mondatot vagy egy összetartozó információs egységet.

---

### 3. Kis szekciók összevonása célméret alapján

Mivel a dokumentumok sok rövid kérdés-válasz szekcióból állnak, az egy headingből készített külön chunk nem lenne hatékony.

Ehelyett a kisebb szakaszokat addig vonom össze, amíg el nem érnek egy optimális méretet.

Ennek előnye:

* egy chunk elegendő mennyiségű információt tartalmaz az embedding számára,
* nem jön létre sok nagyon rövid, kevés jelentést hordozó vektor,
* az egy növényhez tartozó információk együtt maradnak.

Például ahelyett, hogy külön chunk lenne:

```
Peperomia Ginny - fényigény
```

és külön:

```
Peperomia Ginny - öntözés
```

egy közös chunk tartalmazhatja a növény alapvető gondozási információit.

---

### 4. Kis maradék chunkok összevonása

Előfordulhat, hogy a dokumentum végén egy nagyon rövid rész maradna önálló chunkként.

Ezeket a túl kicsi részeket az előző chunkhoz kapcsolom, hogy ne keletkezzenek olyan embeddingek, amelyek túl kevés információ alapján készülnek.

---

### 5. Overlap alkalmazása

A chunkok között kisebb átfedést alkalmazok.

Ez azt jelenti, hogy az előző chunk utolsó néhány tokenje bekerül a következő chunk elejére is.

Ennek célja, hogy a chunkhatáron lévő információk ne vesszenek el a keresés során.

---

# Miért ez a stratégia illik ehhez a tudásbázishoz?

A legfontosabb döntés az volt, hogy nem minden headingből készül külön chunk.

Ebben a tudásbázisban a headingek gyakran csak egyetlen rövid kérdés-válasz párost tartalmaznak. Egy ilyen kis szöveg önmagában gyenge embeddinget eredményezhet, és a keresés során könnyebben keverhető más növények hasonló kérdéseivel.

A kisebb szekciók összevonásával viszont több kapcsolódó információ kerül egy kontextusba, például egy adott növény fényigénye, öntözése és általános gondozása.

A `heading_path` megtartása biztosítja, hogy az összevont szövegek esetén se vesszen el az eredeti dokumentumstruktúra.

---

# További előnyök

## Pontosabb retrieval

A kereső nem csak a szövegtartalom alapján dolgozik, hanem rendelkezésre áll a dokumentum helye és témája is.

## Kevesebb zaj

A túl kicsi chunkok számának csökkentésével kevesebb jelentéktelen embedding jön létre.

## Alacsonyabb költség

Kevesebb chunk esetén:

* kevesebb embeddinget kell generálni,
* kevesebb vektort kell tárolni,
* hatékonyabb a vektoros keresés.

## Determinisztikus

A tesztek közvetve bizonyítják a determinizmust: fix bemenetre fix ellenőrzött kimenet.
