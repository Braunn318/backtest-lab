# Backtest Lab — fáze 2

> Zadání pro Claude Code · 3. 10. 2026 · navazuje na `BACKTEST_TOOL_SPEC.md`
> (čti v něm **sekci 0 / revizi R2** — má přednost před zbytkem specu).
>
> Fáze 2 má **dvě otázky**, nic jiného do ní nepatří:
> 1. **Zadávám správně SL a TP?** — z MAE, MFE a pohybu ceny po výstupu.
> 2. **Jak silné jsou hladiny proti TP a proti SL?**
>
> Platí beze změny: Lab je **read-only**, do `F:\Trading\Denik\DEV` ani do
> `%APPDATA%\futures-journal-pro` nezapisuje. Práce na branchi `test`.

---

## 0. Nejdřív doopravit fázi 1

### 0.1 Kontrola 11 — chybný jmenovatel (`app/health.js:257`)

```js
// je:
const base = perf.filter(r => r.result === 'target' && has(r.maxFavorableTicks));
// má být:
const base = perf.filter(r => r.result === 'target');
```

Kontrola se ptá „kolika obchodům chybí pozorování". Tím, že si do jmenovatele
vzala jen ty, které pozorování **mají**, se ptala sama sebe a vždy prošla.
Na dnešních datech: 26 targetů, chybějících je 6 → 23 %, ne 8 %.

### 0.2 Odhad „kdy budu mít vzorek" počítej z úzkého hrdla

Dnes se odhad dnů počítá z celkového počtu obchodů. Musí se počítat z toho
údaje, kterého je **nejmíň** a který analýzu blokuje. Dnes to není MFE
(40 obchodů), ale **plánovaná cílová hladina** (~10) a **vzdálenost SR hladin**
(18 řádků). Odhad ukaž pro každou analýzu zvlášť a pojmenuj, co jí chybí.

### 0.3 Fill rate — práh

`fillStatus` je `FILLED` u všech 54 obchodů, `NO_FILL` / `SKIPPED` jsou jen
na 2 záznamech SETUP_ONLY. Jmenovatel 2 nesmí vyprodukovat číslo, které
vypadá jako statistika. Pod `FILL_WARN_MIN_RECORDS` ukaž `n/a` a důvod.

### 0.4 Deník se vybírá ručně

Export nenese příznak „backtestový deník". **Neřeš to** a nežádej změnu deníku.
Lab nechá uživatele vybrat deník ze seznamu a nahoře vždy ukáže, který deník,
kolik záznamů a jaký rozsah dat se počítá. To stačí.

### 0.5 Popisky hladin a setupů

Export nenese taxonomii, takže klíče (`M2_EDGE`, `VPOC_1M`, …) nemají popisek.
Udělej v Labu **vlastní mapu klíč → popisek** (`app/labels.js`), převzatou
z výchozích slovníků v `repo_clone/app/taxonomy.js`. Neznámý klíč zobraz
tak, jak přišel — nikdy ho neskrývej.

Zvlášť zobraz **neznámé klíče** jako upozornění ve zdraví dat. V datech je dnes
`VWAP_DEV` u jednoho obchodu v `srStopLoss` — slovník, který už v deníku není.
Lab ho jen nahlásí; opravit obchod je na uživateli, Lab nezapisuje.

---

## 1. Normalizace — co doplnit do `app/normalize.js`

Analýzy čtou **jen** výstup `normalizeRecord`. Co chybí, doplň sem i s testem.

### 1.1 Původ hodnoty ven ze `SYSTEM_FIELDS`

```js
// dnes jsou v SYSTEM_FIELDS, tedy mimo analýzu – to je chyba:
mfeTicksSource, maeTicksSource, mfeTicksDerived, maeTicksDerived,
slDerived, targetLevel1PriceDerived
```

Deník od 4.6.6 část MFE/MAE **dopočítává z výstupní ceny**. U obchodu na targetu
je dopočítané `mfeTicks` z definice rovno `exitTicks`.

Normalizace ať vrací pro MFE i MAE trojici:

```js
out.mfe = { ticks, tier }   // tier: 'manual' | 'nt8' | 'derived' | null
out.mae = { ticks, tier }
out.mfeMeasured = tier === 'manual' || tier === 'nt8' ? ticks : null
out.maeMeasured = …
```

**Pravidlo pro celou fázi 2: do výpočtů vstupuje jen `*Measured`.**
Dopočítané hodnoty se nikdy nemíchají do průměrů, mřížky ani rozdělení —
zobrazí se zvlášť jako „dopočítáno, do výpočtu nevstupuje: N".

Dnešní stav: `nt8` 31×, `derived` 4×, chybí 19×.

### 1.2 „Žádná hladina v cestě" — jedna odpověď ze dvou zápisů

V datech jsou oba zároveň: `srTargetNone: true` (7 obchodů) i řádek
`{ level: 'NONE' }` (11 řádků). Totéž `entryLevels: ['NONE']`, `ofConfirm: ['NONE']`.

```js
// tři stavy, nikdy dva:
'none'      // vědomě žádná hladina  – noneFlag === true  ||  řádky jsou samé 'NONE'
'present'   // nějaká hladina je     – aspoň jeden řádek s level !== 'NONE'
'unknown'   // nevyplněno            – žádné řádky a žádný příznak
```

`'unknown'` **nikdy** nesmí spadnout do kontrolní skupiny `'none'`.
Bez toho nemá analýza hladin s čím porovnávat.

### 1.3 Plánovaný cíl vs. místo výstupu

```js
out.plannedTarget = (targetLevel1.type && targetLevel1.type !== 'MANUAL_EXIT'
                     && targetLevel1PriceDerived !== true)
                    ? { type, price } : null;
```

`MANUAL_EXIT` s cenou převzatou z výstupu není plánovaná hladina, je to zápis
toho, kde uživatel náhodou vystoupil. Dnes: 23 obchodů má `targetLevel1`,
z toho 13 je `MANUAL_EXIT` → reálně plánovaný cíl má **~10 z 54**.

Doplň i `plannedRMultiple` (12 obchodů) — plánované R.

---

## 2. Obrazovka „SL a TP" — zadávám je správně?

Dvě poloviny: **tabulka po obchodech** (verdikt ke každému) a pod ní **souhrny**.
Tabulka je důležitější — uživatel přemýšlí v jednotlivých obchodech.

### 2.1 Tabulka po obchodech

Sloupce (vše v ticích, prázdné pole zůstane prázdné, nikdy 0):

| sloupec | výpočet | smysl |
|---|---|---|
| rezerva SL | `slTicks − maeMeasured` | kolik místa do SL zbylo |
| SL těsný? | rezerva ≤ 2 t → **„těsně"**; ≤ 0 → **„nestačil"** | jeho hlavní otázka |
| o kolik dál by stačil | u stopnutých: `maxAdverseTicks − slTicks` | o kolik rozšířit SL |
| vrátilo se to? | `postExitFavorableTicks` u stopnutých | kam došla cena po stopce |
| nechané na stole | `postExitFavorableTicks` u targetů | kolik bylo za TP |
| dosažené max | `mfeMeasured` | nejdál, kam obchod došel |
| plán vs. skutečnost | `plannedRMultiple` vs. `rSigned` | drží se plánu? |

Verdikt ke každému obchodu jednou větou, ne skóre. Příklady:

- „SL 12 t, cena proti šla 3 t — **SL byl zbytečně široký**, 6 t by stačilo."
- „SL 8 t, zasažen; cena se pak vrátila 20 t ve směru — **SL o 4 t dál by obchod uhájil**."
- „TP 28 t, po výstupu pokračovalo dalších 22 t — **cíl byl blízko**."
- „MFE 6 t při SL 12 t — obchod se nikdy nerozjel, **chyba je ve vstupu, ne v SL**."

Poslední řádek je důležitý: ne každá ztráta je chyba SL.

### 2.2 Rozdělení MAE u vítězů → doporučená šířka SL

Z naměřených MAE obchodů, které **skončily ziskem**: p50, p75, p90, max.

> „SL na p90 přežije 90 % obchodů, které by vydělaly."

Tohle je nejrobustnější doporučení, které z dat jde dostat — nehledá maximum
v mřížce, jen se ptá, kolik tepla musí SL unést.

### 2.3 Rozdělení MFE u stopnutých → bylo TP dosažitelné?

Z naměřených MFE obchodů, které **skončily na SL**: jak daleko došly, než
se otočily. Pro každé kandidátní TP: kolik stopnutých obchodů by ho stihlo.

### 2.4 SL sweep

Pro každou šířku `S`: obchod přežije, pokud `maxAdverseTicks < S`.

⚠️ **Povinné varování, které musí být vidět u výsledku:** `maxAdverseTicks`
sahá za stopku jen tak daleko, jak daleko uživatel po výstupu **koukal**
(`postExitAdverseTicks`, dnes vyplněno u 36 obchodů, `observedMinutes`
jen u 23). Nad pozorovaným rozsahem je sweep **dolní odhad** — širší SL
vypadá lépe, než jaký ve skutečnosti byl. Čím širší `S`, tím míň to platí.
Vypiš u každého `S`, kolik obchodů je nad jejich pozorovaným rozsahem.

### 2.5 Mřížka SL × TP

Podle `BACKTEST_TOOL_SPEC.md` §5.4f, s těmito změnami:

- `maxAdverse` i `max` jen z **naměřených** hodnot (§1.1)
- platí stejné varování jako v 2.4
- vyznač **stabilní oblast**, ne jen maximum. Osamělý vrchol v mřížce nad
  54 obchody je šum, ne nastavení.
- nikdy nezobrazuj bez `N` a bez varování o vzorku (§5.5 specu)

---

## 3. Obrazovka „Síla hladin"

Zdroj: řádky `srTarget` (hladiny proti cíli) a `srStopLoss` (hladiny mezi
vstupem a SL), každý `{ level, price, ticksFromEntry }`.

### 3.1 Jádro — hladina se počítá jen tehdy, když ji cena otestovala

Pro řádek ve vzdálenosti `d` od vstupu a naměřenou excursion `e`
(`mfeMeasured` u `srTarget`, `maeMeasured` u `srStopLoss`):

```
e == null        → nelze vyhodnotit
e <  d − 2 t     → NETESTOVÁNA  (cena k ní vůbec nedošla)
|e − d| <= 2 t   → ZASTAVILA    (cena se o ni opřela)
e >  d + 2 t     → PROPADLA     (překonána, přesah = e − d)
```

**Netestované řádky musí z výpočtu síly vypadnout.** Bez toho vyjde vzdálená
hladina jako nejsilnější jen proto, že k ní cena nikdy nedošla — a to je přesně
ten závěr, který by uživatele stál peníze. Toleranci 2 t udělej nastavitelnou.

### 3.2 Tabulka po typech hladin

Pro každý typ zvlášť pro „proti targetu" a „proti SL":
`N testovaných`, `% zastavila`, `% propadla`, `medián přesahu`, `N netestovaných`.

Řazení podle `% zastavila`. Řádky s `N < 5` zešedlé, s `N < 3` jen vypsané
bez procent — procento ze dvou případů není údaj.

### 3.3 Kontrolní skupina

Obchody se stavem `'none'` (§1.2) proti obchodům se stavem `'present'`:
win rate, medián MFE, jak často byl cíl dosažen. Odpovídá na „stojí za to
mířit za VPOC dne, nebo se tam pohyb spolehlivě zastaví".

Obchody ve stavu `'unknown'` se ukážou jako třetí sloupec s počtem, **do
porovnání nevstupují**.

### 3.4 Řekni rovnou, že na tohle zatím nejsou data

Dnešní stav: `srTarget` má 40 řádků, z toho **18 se vzdáleností nebo cenou**;
`srStopLoss` 42 / 18. Rozdělené do ~10 typů hladin → 1–3 případy na typ.

Obrazovka se **postaví celá**, ale nahoře ukáže, co jí chybí, a napíše to
konkrétně: *„Síla hladin potřebuje u SR řádku vyplněnou cenu nebo vzdálenost
od vstupu. Má ji 18 ze 40 řádků. Bez ní nejde poznat, jestli k hladině cena
vůbec došla."* Nedopočítávej vzdálenost odhadem a nedělej závěry z N = 2.

---

## 4. Co nedělat

- **Nepřepisuj deník ani konektor.** Lab čte, nic víc.
- **Nedopočítávej chybějící údaje.** Prázdné zůstane prázdné; 0 je měření.
- **Nemíchej dopočítané hodnoty mezi naměřené** (§1.1) — to je ta samá chyba
  jako kontrola 11, jen v jiném místě.
- **Nenavrhuj „optimální" nastavení jednou větou.** Lab ukazuje rozdělení
  a nejistotu; vybírá uživatel.
- **Žádná obrazovka bez `N`** a bez varování o vzorku.

---

## 5. Testy (`node --test`, bez nových závislostí)

Každý test ať **spadne, když se příslušná logika odstraní** (mutation check):

1. dopočítané MFE/MAE nevstupují do rozdělení ani do mřížky
2. `'none'` / `'present'` / `'unknown'` se nikdy neslijí — `unknown` není `none`
3. netestovaná hladina (`e < d − tol`) nevstupuje do síly
4. `MANUAL_EXIT` s dopočítanou cenou není `plannedTarget`
5. kontrola 11 na 26 targetech / 6 chybějících vrátí 23 %, ne 8 %
6. SL sweep označí obchody nad pozorovaným rozsahem
7. read-only pojistka drží (zápis `fs` jen ve `writeViews` přes `assertLabWritable`)

Fixtury z reálných dat drž v `Claude files/`, ne v repozitáři.

---

## 6. Po dokončení

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt` v `BackTestLab DEV` (sdílený stav
napříč chaty). Merge do `main` až po ověření uživatelem.
