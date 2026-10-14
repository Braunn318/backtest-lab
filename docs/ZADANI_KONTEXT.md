# Kontext obchodu v2 — deník + Backtest Lab

> ⚠️ **12. 10. 2026: část zrušena revizí `ZADANI_KONTEXT_V3.md`, která má přednost.**
> Zrušeno: `liquiditySwept`, `pathProfile`, test/netest u vstupní hladiny, `pathState`,
> dvojice seznamů SR proti TG / SL (nahrazena jedním seznamem „Hladiny v blízkosti"),
> všechny dopočty s pevnou tolerancí v ticích.

> Zadání pro Claude Code · 9. 10. 2026 · navazuje na `BACKTEST_MODE_SPEC.md` (§4, §6.2)
> a `BACKTEST_TOOL_SPEC.md` (sekce 0 / R2), `ZADANI_FAZE_2.md`, `ZADANI_PREHLEDNOST.md`.
>
> Dvě části, dvě sezení:
> **A) Futures Journal PRO** (`F:\Trading\Denik\DEV`) — sběr a validace kontextu.
> **B) Backtest Lab** (`F:\Trading\Denik\BackTestLab DEV`) — normalizace a vyhodnocení.
> B začíná až po A a až po dokončení dávky `ZADANI_PREHLEDNOST.md`.
>
> Práce na branchi `test`. Merge do `main` až po ověření uživatelem.

---

## 0. Proč (data z exportu 9. 10. 2026, 152 MES obchodů)

Tyhle tři nálezy zadání řídí. Čísla jsou z malého vzorku, berou se jako hypotézy k ověření, ne jako fakta:

| nález | data |
|---|---|
| Typ cíle rozhoduje | cíl `CUSTOM_FIX_RRR` 9 obchodů, 1 target, −172 $ · cíl na skutečné hladině 12 obchodů, 7 targetů, +97 $ |
| Hladina mezi vstupem a cílem | 13 obchodů s překážkou před cílem → 3 targety, 9 SL |
| OF potvrzení | s ABS 25 obchodů +13 $ · bez ABS / nevyplněno 50 obchodů −476 $ |

Současný zápis to umí jen naznačit: strana TG je prázdná u ~poloviny obchodů (nejde odlišit
„nic tam nebylo" od „nevyplnil jsem") a v datech jsou překlepy, které nic nezachytí (viz A1).

**Princip beze změny (`BACKTEST_MODE_SPEC.md` §4.1):** málo polí, která se vyplňují vždy.
Co jde spočítat z ceny a času, se **počítá**, nezadává. Ručně jen to, co vidí jen Adam.
Cíl: celý kontext obchodu do **8 kliknutí / 15 s** v rychlém formuláři.

---

# A) Futures Journal PRO

## A0. Discovery — udělej první, nic nepiš

Najdi a vypiš do odpovědi:

1. Kde se ukládají a validují `srTarget`, `srStopLoss`, `srTargetNone`, `srStopLossNone`,
   `targetLevel1`, `slPrice`, `entryLevels`, `trend`, `ofConfirm`.
2. Výchozí slovníky v `app/taxonomy.js` — které klíče hladin a cílů existují, jak se přidávají
   uživatelské (`CUSTOM_*`), a `FJTaxonomy.missingContextKeys`.
3. Je implementované pole `session` (§4.4 BACKTEST_MODE_SPEC)? V CSV exportu není.
4. Je implementované `STRUCTURE` a `PROFILE_DAY` na obchodu? V CSV exportu nejsou.
5. Tvar `dayNotes` (export ho nese) — dá se do něj přidat strukturovaný kontext dne bez nové
   top-level entity?
6. Kde je rychlý formulář (§6.2) a karty formuláře (`FJ_tradeCards`).
7. Co přesně dnes znamená pole `trend` (LONG / SHORT / RANGE) — z kódu i popisků.

Pak navrhni mapování názvů z tohoto zadání na repozitář a **ZASTAV SE**.

### Hlavní pravidlo: nic se neruší, nemaže ani nepřemapovává

Rozhodnutí Adama 9. 10. 2026. Platí pro celé zadání a má přednost před čímkoli níže:

- **Slovníky hladin, zón, cílů a setupů jsou uživatelské.** Uživatel si položky přidává, upravuje
  a maže. Zadání **nepřejmenovává, neslučuje a nemaže** žádnou existující položku (ani `CUSTOM_*`,
  ani pozůstatky typu `VWAP_DEV`).
- **Nové výchozí položky** (A2.1) se do slovníku přidají **jen jednou** (příznak „naseedováno"
  v nastavení). Když je uživatel smaže, další spuštění je **nevrací**.
- **Existující pole a karty formuláře zůstávají** (`trend`, `PROFILE_DAY`, `STRUCTURE`, `ofConfirm`
  …). Nová pole se přidávají vedle, nic nenahrazují.
- **Uložené obchody se neupravují** — žádná migrace hodnot, žádné přemapování klíčů, žádné
  doplňování odhadem. Viz A9.

### Guardrails (beze změny, platí bezpodmínečně)

- Nová pole **nevstupují do klíče duplicit**.
- `combineTradeObjects` je bílá listina → test, že merged obchod nese **všechna** nová pole.
- `readJournal()` whitelistuje top-level klíče → kontext dne ukládej do `dayNotes`, ne jako novou
  entitu. Kdyby to nešlo, doplň whitelist **a** test.
- Migrace: záloha → zápis → úklid. Idempotentní. Historické obchody se **neopravují automaticky**.
- Nesahej na P/L, commission ani points matematiku.
- Žádné nativní `alert` / `confirm` / `prompt`.
- Všechna nová pole jsou nullable a **neblokují uložení** obchodu. Validace níže blokuje jen
  konkrétní chybnou hodnotu (zůstane v poli a označí se), ne celý obchod.

---

## A1. Validace SR zón a cílů — oprava (priorita 1)

### A1.1 Stranu volí Adam, vzdálenost se dopočítá z ceny

**Strana je význam, ne poloha vůči vstupu** (rozhodnutí Adama 9. 10. 2026):

- `srStopLoss` = zóna, která **chrání SL**. Rozhoduje, že leží **mezi SL a cenou trhu**, ne mezi SL
  a vstupem. Hladina 2 ticky nad vstupem do longu je pořád zóna chránící SL — cena kolem ní
  osciluje a limitka se plní právě při jejím testu.
- `srTarget` = hladina, která stojí **v cestě k cíli**.

Proto se strana **nedopočítává** z ceny. Adam ji vybere jako dnes. Deník jen:

- spočítá `ticksFromEntry` **se znaménkem**: kladné = směrem k cíli, záporné = směrem k SL,
- spočítá `ticksFromStop = abs(price − slPrice) / tickSize` (jen u `srStopLoss`).
- Ruční přepis ticků při zadané ceně není povolen (dnes všechny sedí, ať to tak zůstane).
- Bez ceny (starší způsob) zůstává ruční zadání ticků — nic se nerozbije.

### A1.2 Chybné zápisy — zachytit při ukládání

**Blokuje uložení hodnoty** (in-app dialog, ne nativní — hodnota se neuloží, dokud ji Adam
neopraví nebo vědomě nepotvrdí):

| pravidlo | příklad z dat |
|---|---|
| `targetLevel1.price` musí ležet na **ziskové** straně vstupu | 2. 10. 15:44 short, cíl `779475` (překlep) · 5. 10. 18:18 long ze 7811, cíl 7783.0 · 9. 10. 17:01 cíl = cena SL |
| `slPrice` musí ležet na **ztrátové** straně vstupu | — |

**Neblokuje, jen příznak** (do výpočtů A3 nevstupuje):

| příznak | kdy |
|---|---|
| `beyondStop` | `srStopLoss` řádek leží za SL — SL ho nechrání, je až za ním |
| `beyondTarget` | `srTarget` řádek leží za cílem |
| `behindEntry` | `srTarget` řádek leží na ztrátové straně vstupu — do cesty k cíli nepatří; jemné upozornění, ne chyba |

**Výslovně platné, nehlásit:** zóna chránící SL na ceně vstupu (0 t) nebo nad vstupem do longu /
pod vstupem do shortu. Např. 9. 10. 17:15 short ze 7847.25 s `CUSTOM_GAMMA` 7847.0 zařazenou k SL je v pořádku.

### A1.3 „Žádná hladina" musí být vědomá volba

Prázdná strana TG nebo SL = **neúplný kontext** (`missingContextKeys`). Úplné je jen „aspoň
jedna hladina" nebo explicitní `NONE` (`srTargetNone` / `srStopLossNone`). V rychlém formuláři
je `NONE` první dlaždice skupiny.

### A1.4 Historická data se neopravují

Přidej do deníku seznam **„Kontrola dat"** (filtr v seznamu obchodů): obchody, které porušují
blokující pravidla A1.2. Adam je opraví ručně. Žádná automatická oprava, žádná migrace hodnot.
Jako regresní fixtury použij tři obchody s cílem na špatné straně z tabulky A1.2.

---

## A2. Hladiny — rozšíření slovníku a dvě vlastnosti

### A2.1 Slovník hladin (jeden pro `entryLevels`, `srTarget`, `srStopLoss`, `targetLevel1`)

Existující klíče **nepřejmenovávej a nemaž**. Jako výchozí nabídni klíče, které ve slovníku
ještě nejsou (seed jednou, viz hlavní pravidlo):

```
VPOC_DAY, VPOC_PREV_DAY, VPOC_30M, VPOC_1M, VPOC_IB,
VAH, VAL, VAH_PREV, VAL_PREV,
VWAP, VWAP_DEV1, VWAP_DEV2,
HVN, LVN,
LIQUIDITY, HOD_LOD, PDH_PDL, ONH_ONL,
M2_EDGE, IB_EDGE, GAP_EDGE, LTA_LEVEL
```

- `VWAP_DEV`, `CUSTOM_LVN_DAY` a další existující klíče zůstávají, jak jsou. Žádné mapování v deníku.
- **Cíl, který není hladina:** položky slovníku cílů dostanou editovatelnou vlastnost
  **„je to hladina"** (`isLevel`, výchozí `true`). Výchozí `false` jen u nově seedovaných
  `MANUAL_EXIT` a `FIX_RRR`. U existujících položek (např. `CUSTOM_FIX_RRR`) ji **nenastavuj
  sám** — zobraz ji v nastavení slovníku a nech ji přepnout uživatele.

### A2.2 Vlastnost řádku: test / netest

Každý SR řádek a každá položka `entryLevels` dostane volitelné `testState: 'UNTESTED' | 'TESTED'`.
**Popisky v UI: „netest" / „test"** (Adamova terminologie — ne „čerstvá").
Netest = cena se hladiny v seanci ještě nedotkla. Netestovaný VPOC je magnet, první test
hladiny drží líp než opakovaný — dnes to v datech chybí úplně.

Samostatný klíč „netestovaný VPOC 30M" se proto nezavádí: je to `VPOC_30M` + netest.

V UI jako přepínač přímo na řádku (výchozí prázdné).

---

## A3. Dopočtená pole (počítat, neukládat ručně)

Čisté funkce v doménové vrstvě, používá je UI, export i statistiky. Nic z toho se needituje.
Všechny vrací `null`, když chybí vstup — **nikdy 0 místo null**.

| pole | výpočet |
|---|---|
| `targetTicks` | `abs(targetLevel1.price − entry) / tickSize` |
| `targetOnLevel` | `true`, když položka slovníku `targetLevel1.type` má `isLevel = true` a cena není `targetLevel1PriceDerived`. Klíč, který ve slovníku už není → `null` |
| `firstObstacleTicks` | min `ticksFromEntry` z `srTarget` s cenou, bez `beyondTarget` a `behindEntry`, a zároveň `< targetTicks − 1`. Když je strana TG `NONE` → `null` a `pathState = 'FREE'` |
| `pathState` | `'FREE'` (NONE) · `'BLOCKED'` (existuje `firstObstacleTicks`) · `'TARGET_IS_LEVEL'` (jediná hladina leží do 1 t od cíle) · `'UNKNOWN'` (nevyplněno) |
| `freePathR` | `(firstObstacleTicks ?? targetTicks) / slTicks` |
| `slBufferTicks` | min `ticksFromStop` přes `srStopLoss` řádky s cenou, bez `beyondStop`. Kolik ticků leží SL za zónou, která je k němu nejblíž — tedy za kterou je „schovaný". Zóna nad vstupem do longu se počítá stejně jako pod ním |
| `slZoneCount` | počet `srStopLoss` řádků s cenou, bez `beyondStop` (vrstvy ochrany mezi SL a trhem) |
| `tradeNoInDay` | pořadí obchodu (`TRADE`, `FILLED`) v rámci deníku a dne podle času vstupu |
| `prevResultInDay` | `'FIRST'` / výsledek předchozího obchodu téhož dne |
| `dayPnlBefore` | součet P/L předchozích obchodů téhož dne v témže deníku |
| `session` | §4.4 BACKTEST_MODE_SPEC — pokud ještě není, doplň |

`tradeNoInDay`, `prevResultInDay`, `dayPnlBefore` se **počítají při čtení**, ne při uložení —
po smazání nebo doimportu obchodu se musí přepočítat samy. Test na smazání prostředního obchodu.

---

## A4. Nová ruční pole na obchodu

Všechna jako chip grid v rychlém formuláři (§6.2), single-select, klávesové zkratky.

| pole | hodnoty | poznámka |
|---|---|---|
| `trendHtf` | `UP` / `DOWN` / `RANGE` | trend na 30min. Existující `trend` zůstává beze změny; případnou změnu jeho popisku na „trend 1min" navrhni po A0 bod 7 a nech schválit |
| `absLocation` | `EXTREME` / `MIDDLE` / `NONE` | kde byla absorpce: na extrému svíčky/pohybu, nebo uprostřed |
| `entryTestNo` | `1` / `2` / `3+` | kolikátý test vstupní hladiny v seanci |
| `liquiditySwept` | `YES` / `NO` | byla před vstupem vybraná likvidita (Past na retail) |
| `pathProfile` | `LVN` / `HVN` / `MIXED` / `UNKNOWN` | co leží ve volume profilu mezi vstupem a cílem — LVN = volná cesta, HVN = brzda |
| `grade` | `A` / `B` / `C` | **známka zadaná před vstupem** |

### `grade` — ochrana proti dodatečnému hodnocení

Deník neumí ověřit, že známka vznikla před vstupem. Proto:

- uloží `gradeSetAt` (čas prvního zadání),
- `gradeRetro: true`, když je `gradeSetAt` **po** čase výstupu obchodu (známka doplněná zpětně —
  typicky u starých obchodů nebo u live obchodu zapsaného až po importu),
- každá další změna nastaví `gradeEdited: true` a v UI se zobrazí „změněno dodatečně",
- `gradeRetro` i `gradeEdited` se exportují. Analýza (B) je umí oddělit.

### Úplnost

Do `missingContextKeys` přidej: `trendHtf`, `grade`, strana TG (viz A1.3).
Ostatní nová pole úplnost **neblokují** — ať „Neúplné" nezčervená celý deník najednou.

---

## A5. Kontext dne (jednou za den a deník)

Ulož do `dayNotes[date]` jako `dayContext`:

| pole | hodnoty | kdy |
|---|---|---|
| `openVsValue` | `IN_VA` / `ABOVE_VAH` / `BELOW_VAL` / `GAP_UP` / `GAP_DOWN` | ráno — open vůči **včerejší** value area; gap = open mimo včerejší range |
| `dayTypeExpected` | `TREND_UP` / `TREND_DOWN` / `BALANCE_D` / `P` / `b` / `DOUBLE_DIST` / `UNKNOWN` | ráno |
| `dayTypeActual` | stejné hodnoty | večer / po replayi |
| `valueMigration` | `HIGHER` / `LOWER` / `OVERLAP` | večer — VPOC/VA dnes vůči včerejšku |
| `newsEvent` | `NONE` / `CPI` / `FOMC` / `NFP` / `OTHER` | ráno |

- `PROFILE_DAY` a `STRUCTURE` z §4.2 BACKTEST_MODE_SPEC, pokud na obchodu existují, **zůstávají**
  i s kartou ve formuláři. `dayContext` je nový zápis vedle nich, nic z nich nepřebírá ani neruší.
  Jestli kartu na obchodu později skrýt, rozhodne uživatel v nastavení karet.
- UI: při kontextování prvního obchodu dne, kterému chybí `dayContext`, se nad chip gridem
  ukáže pruh se 3 ranními poli (`openVsValue`, `dayTypeExpected`, `newsEvent`). Večerní pole jsou v kalendáři u dne.
- Export: pole dne se **připojí ke každému obchodu** toho dne (sloupce `Den: …`).

---

## A6. Export

CSV report i AI export nesou všechna nová ruční pole (A4, A5), dopočtená pole (A3),
u SR řádků `testState`, znaménkové `ticksFromEntry`, `ticksFromStop` a příznaky
`beyondTarget` / `beyondStop` / `behindEntry`, dále `gradeSetAt`, `gradeEdited`.
V CSV jsou české názvy sloupců jako dnes. Dopočtená pole označ v hlavičce `(dopočet)`.

---

## A7. Testy (`node --test`, bez nových závislostí)

Každý test musí **spadnout**, když se příslušná logika odstraní:

1. `ticksFromEntry` má správné znaménko u longu i shortu; `ticksFromStop` sedí na cenu SL
2. cíl na ztrátové straně se neuloží — fixtury 2. 10. 15:44, 5. 10. 18:18, 9. 10. 17:01
3. zóna chránící SL na ceně vstupu (0 t) i nad vstupem do longu se **uloží bez varování**
   — fixtura 9. 10. 17:15 (`CUSTOM_GAMMA` 7847.0 u shortu z 7847.25 zůstane u SL)
4. `srTarget` řádek na ztrátové straně dostane `behindEntry`, uloží se
5. `firstObstacleTicks` ignoruje řádky za cílem, `behindEntry` a řádek do 1 t od cíle
6. `pathState` rozliší `FREE` / `BLOCKED` / `TARGET_IS_LEVEL` / `UNKNOWN` — `UNKNOWN` nikdy není `FREE`
7. `slBufferTicks` počítá od nejbližší zóny k SL, včetně zóny nad vstupem; ignoruje `beyondStop`
8. `tradeNoInDay` a `dayPnlBefore` se přepočítají po smazání prostředního obchodu
9. `gradeEdited` se nastaví při druhé změně, ne při první
10. merged obchod nese všechna nová pole (`combineTradeObjects`)
11. `dayContext` přežije `readJournal()` a uložení
12. duplicate detection — regresní test na stávajícím vzorku beze změny
13. smazaná výchozí položka slovníku se po restartu **nevrátí**; existující uživatelské položky
    zůstanou beze změny (počet, klíče, popisky)
14. export stávajících obchodů před a po: všechny původní buňky identické, liší se jen nové sloupce
15. `gradeRetro` se nastaví u známky zadané po čase výstupu

---

## A9. Stávající obchody — co se s nimi stane

**Nic se na nich nemění.** Žádná konverze, žádná migrace hodnot. Konkrétně:

| co | stávající obchody |
|---|---|
| nová ruční pole (A4, A5, `testState`) | prázdná = „nevyplněno". **Nikdy nedoplňuj odhadem** ani výchozí hodnotou |
| dopočty (A3) | počítají se **při čtení** z toho, co v obchodu už je (ceny zón, SL, cíl, časy). Kde chybí vstup → `null`. Do uloženého obchodu se nic nezapisuje |
| strana SR řádků | zůstává, jak ji Adam zadal |
| ticky u řádků bez ceny | zůstávají, jak byly zadané; znaménko se nedopočítává (bez ceny nejde) |
| tři obchody s cílem na špatné straně | jen v seznamu „Kontrola dat", opraví je Adam ručně |
| `isLevel` u `CUSTOM_FIX_RRR` | nastaví Adam v nastavení slovníku; do té doby `targetOnLevel` počítá s výchozím `true` |

**Zpětné doplnění je ruční a volitelné**: přes hromadné vyplnění (§6.3 BACKTEST_MODE_SPEC) může Adam
doplnit třeba `dayContext` celému dni nebo `testState` řádkům, které si pamatuje. Známka A/B/C
doplněná zpětně dostane automaticky `gradeRetro` (A4).

**Test:** export všech stávajících obchodů před a po implementaci se liší **jen přidanými sloupci**.
Každá původní buňka je identická.

---

## A8. Pořadí

| krok | obsah |
|---|---|
| 1 | A0 discovery + mapování → stop |
| 2 | A1 validace + „Kontrola dat" + testy 1–4 |
| 3 | A3 dopočty + testy 5–8 |
| 4 | A2 slovník + `testState`, A4 pole, rychlý formulář |
| 5 | A5 kontext dne |
| 6 | A6 export → předat Labu |

Po kroku 2 Adam opraví tři vadné záznamy (cíl na špatné straně). Po kroku 4 se může sbírat.

---

# B) Backtest Lab

Platí beze změny: Lab je **read-only**, nic nedopočítává odhadem, žádná obrazovka bez `N`,
žádná doporučení, prahy se nesnižují. Začni až po dokončení `ZADANI_PREHLEDNOST.md`.

## B1. Normalizace (`app/normalize.js`)

- Všechna nová pole z A2–A5. Každé ve třech stavech: **hodnota / vědomě žádná / nevyplněno**.
  `unknown` nikdy nespadne do `none` (stejné pravidlo jako R2.2).
- Dopočty, které jdou spočítat z cen (`firstObstacleTicks`, `pathState`, `freePathR`,
  `slBufferTicks`, `tradeNoInDay` …), **Lab přepočítá sám** z hrubých dat. Nesoulad s hodnotou
  z exportu nahlas ve Zdraví dat jako konzistenční chybu (vzor fáze 1), nepřepisuj.
- `targetOnLevel` **převezmi z exportu** — závisí na uživatelském nastavení slovníku (`isLevel`),
  které export nenese (R2.7). Lab si ho nedomýšlí. Chybí-li (starší export) → `unknown`.
- `dayContext` se připojí k obchodům podle data a deníku.
- `labels.js`: doplň popisky všech nových klíčů.
- Export ze starší verze deníku (bez nových polí) musí projít — pole jsou pak `unknown`.

## B2. Zdraví dat

- Kontroly A1.2 nad historickými obchody: blokující pravidla (cíl / SL na špatné straně) jako
  chyby, příznaky (`beyondStop`, `beyondTarget`, `behindEntry`) jako informace. Jen hlásit,
  s datem a časem obchodu. Zóna chránící SL na vstupu nebo nad vstupem do longu **není** chyba.
- Pokrytí nových polí → automaticky do bloku „Co vyplnit při nejbližším replayi" (§1.1 přehlednosti).
  Nic nepiš natvrdo, seznam se odvozuje z dat.

## B3. Obrazovka „Kontext" — rozpad podle dimenze

Použij existující mechaniku rozpadu (N, win %, avg R, expectancy R) a existující prahy vzorku.
Dimenze:

| skupina | dimenze |
|---|---|
| cíl a cesta | `targetOnLevel` · `pathState` · `freePathR` v koších `<0,5` / `0,5–1` / `≥1` · `pathProfile` |
| SL | `slBufferTicks` v koších `≤1` / `2–4` / `>4` |
| vstup | `entryTestNo` · `testState` vstupní hladiny · `absLocation` · `liquiditySwept` |
| směr | soulad směru s `trendHtf` a s `trend`: `WITH` / `AGAINST` / `RANGE` |
| proces | `grade` (zvlášť `gradeEdited`) · `tradeNoInDay` · `prevResultInDay` |
| den | `openVsValue` · `dayTypeActual` · přesnost `dayTypeExpected == dayTypeActual` · `newsEvent` |

- Stav `unknown` se ukáže jako vlastní řádek s počtem, **do porovnání nevstupuje**.
- Koše jsou konstanty v jednom místě, ne rozeseté po kódu.
- **Síla hladin** (fáze 2, §3): přidej rozpad podle `testState` (netest / test) a podle typu
  `HVN` / `LVN`. Hladiny, ke kterým cena nedošla, dál z výpočtu vypadávají.
- **Zóny chránící SL — mění `ZADANI_FAZE_2.md` §3.1 pro `srStopLoss`.** Klasifikace
  „zastavila / propadla" na ně nesedí: cena kolem zóny osciluje a krátký průnik je normální.
  Otázka zní „jak daleko za zónu cena zajede a ustál to SL". Pro každý řádek:
  ```
  d          = vzdálenost zóny od vstupu směrem k SL (záporná, když zóna leží nad vstupem do longu)
  overshoot  = maeMeasured − d        // kolik ticků cena zajela za zónu
  held       = SL nebyl zasažen
  ```
  Zóna s `d ≤ 0` je vždy „otestovaná" (limitka se plnila přes ni).
  Výstup po typech zón: `N`, medián a p90 `overshoot`, `% held`. A vedle toho rozdělení
  `slBufferTicks` u stopnutých vs. přeživších — odpovídá na „o kolik ticků za zónu dávat SL".
- Na úvodní obrazovce „Co teď vím": jedna věta za každou dimenzi, která projde prahem.
  Pod prahem „předběžně", bez vstupu „– nejde, chybí …". Žádné „doporučuji".

## B4. Testy

1. `unknown` ≠ `none` pro každé nové pole
2. Lab přepočte `firstObstacleTicks` / `slBufferTicks` a nesoulad s exportem nahlásí
3. `targetOnLevel` se bere z exportu; chybějící → `unknown`, Lab ho nedopočítává
4. starší export bez nových polí projde normalizací
5. řádek `unknown` nevstupuje do porovnání v rozpadu
6. `gradeEdited` obchody jdou oddělit
7. zóna chránící SL nad vstupem do longu (`d < 0`) se počítá jako otestovaná a `overshoot`
   vyjde `mae − d` (kladné i při MAE 0)
8. read-only pojistka drží

## B5. Po dokončení

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt` v obou repozitářích.

---

# Prompty

### Deník — 1
```
V docs/ZADANI_KONTEXT.md je zadání, část A. Přečti celé, včetně sekce 0.
Udělej A0 discovery, vypiš výsledek a navrhni mapování názvů.
ZASTAV SE. Nepiš kód, dokud mapování neodsouhlasím. Pracuj na branchi test.
```

### Deník — 2
```
Implementuj krok 2 z A8 (A1 validace + Kontrola dat).
Nejdřív napiš testy 1–4 z A7, ukaž mi, že na současném kódu selžou, pak oprav.
Historická data neopravuj. Nesahej na P/L ani duplicate detection.
```

### Deník — 3 a dál
```
Implementuj krok N z A8. Testy z A7 napiš předem a ukaž, že selžou.
Po každém kroku vyexportuj CSV před a po a ukaž diff — mění se jen nové sloupce.
```

### Lab
```
V docs/ZADANI_KONTEXT.md je zadání, část B. Deník už exportuje pole z části A
(ověř na aktuálním ai-exportu, ne podle specu). Lab zůstává read-only.
Nejdřív B1 + testy z B4, ukaž mi výsledek normalizace na reálném exportu
(pokrytí každého nového pole: hodnota / none / unknown). Pak B2 a B3.
```
