# Kontext obchodu v3 — oprava designu

> Zadání pro Claude Code · 12. 10. 2026 · **má přednost před `ZADANI_KONTEXT.md`** všude, kde se liší.
> Platí pro oba repozitáře: **A) deník** (`F:\Trading\Denik\DEV`), **B) Backtest Lab** (`F:\Trading\Denik\BackTestLab DEV`).
> Práce na branchi `test`, merge do `main` až po ověření uživatelem.

Uživatel otestoval 4.8.2 a tři věci nedávají v jeho metodice smysl. Navíc deník nemá
o hladinách nic **posuzovat** — jen měřit. Co hladina v obchodu dělá (chrání SL, brzdí cenu,
kolik ticků nad vstupem ještě „patří ke vstupu"), má vyjít **statisticky** v Labu, ne z pravidla v kódu.

---

## A) Deník

### A1. Smazat — natvrdo, včetně dat

| pole | proč |
|---|---|
| `liquiditySwept` („Vybraná likvidita / past na retail") | nedává smysl, uživatel výslovně chce smazat i data |
| `pathProfile` („Profil cesty k cíli") | LVN v jeho metodice není volná cesta, ale S/R zóna; to, jestli v cestě něco je, se pozná z hladin |
| `entryLevelTests` (test/netest u vstupní hladiny) | zdvojuje `entryTestNo` (1 = netest); zůstává jen `entryTestNo` (1 / 2 / 3+) |
| dopočet `pathState` (FREE / BLOCKED / TARGET_IS_LEVEL / UNKNOWN) | je to posouzení s pevnou tolerancí; nahrazuje ho čistá geometrie (A3) |

Postup: **záloha** do `safety-backups` (`pred-odebranim-poli-v3`) → odstranit klíče ze všech
obchodů → odstranit z UI, rychlého formuláře, exportů, `missingContextKeys` a testů.
Migrace idempotentní, jednou za deník, se značkou verze (a značka musí přežít `readJournal()`).

### A2. Hladiny: jeden seznam místo dvou

`srTarget` + `srStopLoss` se nahradí jedním seznamem **„Hladiny v blízkosti"** (`nearLevels`).
Řádek: `{ level, price, testState, ticksFromEntry?, legacySide? }`. Uživatel zadává jen
**typ, cenu, test/netest**. Žádná volba strany, žádná role.

`srTargetNone` + `srStopLossNone` se nahradí jedním příznakem **„žádná hladina v blízkosti"**
(`nearLevelsNone`), zaškrtnutelný jen při prázdném seznamu.

**Převod stávajících dat** (záloha `pred-sloucenim-sr-hladin` → převod → úklid, idempotentní, čtení
musí dál přijmout starý tvar, dokud deník nebyl otevřen):

- řádky z obou seznamů se spojí; shodné řádky (stejný typ a cena) jen jednou,
- řádek bez ceny si nese `legacySide: 'TG' | 'SL'` a původní kladné `ticksFromEntry` —
  jen díky tomu se mu dá spočítat poloha (A3); řádky s cenou `legacySide` nepotřebují,
- `nearLevelsNone = true` jen když byly **oba** původní příznaky „žádná" (nebo obě strany jen `NONE`);
  jinak prázdný seznam = nevyplněno,
- `combineTradeObjects` spojuje `nearLevels` všech nohou (stejné pravidlo jako dnes u SR řádků).

### A3. Dopočty — jen geometrie, žádné prahy

Počítá se při čtení, nic se neukládá, `null` když chybí vstup. **Žádná tolerance, žádné pásmo,
žádná konstanta v ticích.** Kladný směr = směr obchodu (k cíli).

Na řádku hladiny:

| pole | výpočet |
|---|---|
| `fromEntry` | znaménková vzdálenost od vstupu v ticích (+ ve směru obchodu). Řádek bez ceny: `±ticksFromEntry` podle `legacySide` |
| `fromStop` | vzdálenost od SL v ticích, + když leží na straně vstupu, − když je za SL |
| `toTarget` | vzdálenost do cíle v ticích, + když leží před cílem, − když za ním |
| `position` | `BEYOND_STOP` / `STOP_TO_ENTRY` / `AT_ENTRY` (přesně 0) / `ENTRY_TO_TARGET` / `BEYOND_TARGET` — čistě podle ceny |

Na obchodu:

| pole | výpočet |
|---|---|
| `nearestAheadTicks` | nejmenší kladné `fromEntry` z řádků před cílem (nejbližší hladina ve směru obchodu) |
| `nearestAheadR` | `nearestAheadTicks / slTicks` |
| `stopBehindTicks` | nejmenší kladné `fromStop` (o kolik ticků je SL za nejbližší hladinou mezi SL a cílem — zahrnuje i hladiny nad vstupem do longu) |
| `levelsStopToEntry`, `levelsEntryToTarget` | počty řádků v daném úseku |
| `targetOnLevel`, `targetTicks`, `tradeNoInDay`, `prevResultInDay`, `dayPnlBefore`, `session` | beze změny z v2 |

Odstraň `firstObstacleTicks`, `freePathR`, `slBufferTicks`, `slZoneCount`, `pathState`
a příznaky `beyondStop` / `beyondTarget` / `behindEntry` — nahrazuje je `position`.

V kartě Hladiny pod seznamem **jeden řádek** s dopočty, např.
*„Nejbližší hladina ve směru: +5 t (0,5 R) · SL 3 t za VAL · mezi SL a vstupem 2, před cílem 1"*.
U řádku jen vzdálenosti (`+5 t od vstupu · 3 t od SL`), **žádný štítek role**.

### A4. Přizpůsobení — skrýt jednotlivá pole

V Nastavení → Přizpůsobení vedle „Karty obchodu" nová část **„Pole kontextu"**: u každého
z polí *Trend 30m, Známka A/B/C, Kolikátý test vstupu, Absorpce – kde, Test/netest u hladin,
Kontext dne, Řádek dopočtů* přepínače **Zobrazit** a **Upozorňovat na nevyplněné**
(stejný vzor jako karty). Skryté pole: zmizí z formuláře, rychlého formuláře, karty obchodu
i dne; nepočítá se do „Neúplné"; **data zůstávají** a jdou do exportů. Výchozí: vše zobrazeno.

### A5. Výsledné karty formuláře

- **Setup:** setup, stav naplnění, trend 1m, trend 30m, známka A/B/C, kolikátý test vstupu
- **Hladiny:** hladina vstupu, hladiny v blízkosti (+ „žádná hladina v blízkosti"), order flow,
  absorpce – kde, typ a cena cíle, řádek dopočtů

### A6. Export

- CSV: bloky `SR→TG n …` a `SR→SL n …` se nahradí blokem `Hladina n: typ / cena / test /
  od vstupu / od SL / do cíle / poloha`. Smazané sloupce (likvidita, profil cesty, test vstupní
  hladiny, pathState …) zmizí. **Ostatní sloupce stávajících obchodů beze změny** — ověř diffem.
- AI export: `nearLevels`, `nearLevelsNone` a v `derived` nová geometrie.

### A7. Testy (`node --test`, předem, musí selhat bez implementace)

1. převod: řádky z obou seznamů v jednom, duplicita jednou, `legacySide` jen u řádků bez ceny
2. převod je idempotentní; značka verze přežije `readJournal()`
3. `nearLevelsNone` jen při obou původních příznacích
4. `position` / `fromEntry` / `fromStop` / `toTarget` u longu i shortu, včetně hladiny 2 t nad vstupem do longu (`ENTRY_TO_TARGET`, `fromStop` kladné)
5. `stopBehindTicks` bere i hladinu nad vstupem
6. v kódu dopočtů není žádný práh v ticích (test na fixturu s hladinou 1 t od cíle → `ENTRY_TO_TARGET`, ne „cíl na hladině")
7. smazaná pole zmizí ze všech obchodů i exportů, záloha existuje
8. skryté pole se nepočítá do „Neúplné" a jeho data přežijí uložení obchodu
9. merged obchod nese `nearLevels`
10. CSV diff stávajících obchodů: mimo nahrazené / smazané sloupce identický

---

## B) Backtest Lab

Platí dál: read-only, nic nedopočítávat odhadem, žádná obrazovka bez `N`, žádná doporučení.

### B1. Normalizace

- Čti `nearLevels` / `nearLevelsNone`. Starší export (`srTarget`, `srStopLoss`) převeď **v paměti**
  stejným pravidlem jako A2 — nic nezapisuj.
- Geometrii (A3) přepočítej sám; nesoulad s `derived` z exportu nahlas ve Zdraví dat.
- Odstraň všechno kolem `liquiditySwept`, `pathProfile`, `entryLevelTests`, `pathState`, `freePathR`, `slBufferTicks`.

### B2. Hladiny — statistika místo pravidel

Žádné předem dané koše ani role. Pro každý řádek hladiny máš polohu `p = fromEntry` a dráhu
ceny v obchodu `[−maeMeasured, +mfeMeasured]`:

- **dotčena** = `p` leží v dráze; jinak **nedotčena** (z výpočtů reakce vypadává)
- **přesah** = jak daleko cena zajela za hladinu: pro `p > 0` `mfe − p`, pro `p ≤ 0` `mae + p`

Obrazovka ukáže **rozložení podle vzdálenosti** (osa = `fromEntry` v ticích, po 1 ticku,
volitelně sloučení po 2 / 4 t — volba uživatele, ne kód): výsledek obchodu, medián přesahu, `N`.
Zvlášť podle typu hladiny a podle test / netest. Totéž pro `stopBehindTicks` (stopnuté vs. přeživší)
a `nearestAheadTicks` / `nearestAheadR` (dosažení cíle).

Tohle je odpověď na „kolik ticků nad vstupem ještě chrání SL" — z dat, ne z nastavení.

### B3. Obrazovka „Kontext" — upravené dimenze

Odstraň `pathState`, `pathProfile`, `liquiditySwept`, koše `freePathR` / `slBufferTicks`.
Zůstávají: `targetOnLevel`, `entryTestNo`, `absLocation`, soulad s trendem 1m / 30m, `grade`
(zvlášť `gradeEdited` / `gradeRetro`), `tradeNoInDay`, `prevResultInDay`, kontext dne.

### B4. Testy

1. starý export s `srTarget` / `srStopLoss` se převede v paměti a dá stejnou geometrii jako nový
2. nedotčená hladina nevstupuje do přesahu
3. přesah pro `p > 0` i `p ≤ 0` (hladina nad vstupem do longu, MAE 0)
4. sloučení po 2 / 4 t mění jen zobrazení, ne data
5. read-only pojistka drží

---

## Po dokončení
Aktualizuj `CLAUDE.md` a `CHANGELOG.txt` v obou repozitářích. Na konci napiš uživateli
**česky a stručně**, kde v aplikaci co najde a co zmizelo.
