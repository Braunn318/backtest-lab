# Backtest Lab 0.4 — kontext v3 + Souhrn

> Zadání pro Claude Code · 14. 10. 2026 · repozitář `F:\Trading\Denik\BackTestLab DEV`, branch `test`.
> Dvě části v tomhle pořadí: **1) kontext v3** (`docs/ZADANI_KONTEXT_V3.md`, část B),
> **2) nové rozložení aplikace** (níže). Merge do `main` až po ověření uživatelem.

Platí dál beze změny: Lab jen čte, nic nedopočítává odhadem, žádné číslo bez `N`, žádné
doporučení, co obchodovat, prahy vzorku (10 / 30 / 50 / 20 dnů) se nesnižují.

---

## 1. Kontext v3 — dorovnat na deník 4.8.5

Udělej `docs/ZADANI_KONTEXT_V3.md` část B (B1–B4). Deník je hotový, tvar polí ověř na aktuálním
ai-exportu (`nearLevels`, `nearLevelsNone`, `derived` s geometrií), ne podle zadání. Konkrétně:

- Starší export (`srTarget` / `srStopLoss`) převeď **v paměti** stejným pravidlem jako deník
  (`repo_clone/app/taxonomy.js`). Lab zrcadlí deník, ne text zadání.
- Pryč z normalizace, kontrol, obrazovek, „Co teď vím" i testů: `liquiditySwept`, `pathProfile`,
  `entryLevelTests`, `pathState`, `firstObstacleTicks`, `freePathR`, `slBufferTicks`, `slZoneCount`,
  příznaky `beyondStop` / `beyondTarget` / `behindEntry` a jejich koše v `LabContext.BUCKETS`.
- Síla hladin podle B2: poloha `fromEntry`, dotčena / nedotčena z dráhy `[−MAE, +MFE]`, přesah,
  rozložení **po 1 ticku** (sloučení po 2 / 4 t jen jako volba zobrazení).
- Kontrola 17 porovnává novou geometrii. Známý rozdíl „řádek NONE" zmizí (deník NONE řádky zahodil) —
  ověř a z CLAUDE.md ho odstraň.

---

## 2. Nové rozložení — Souhrn a podrobnosti zvlášť

Dnes je šest obrazovek vedle sebe a každá je plná výhrad, takže se v tom uživatel nevyzná.
Nově: **jedna souhrnná obrazovka s čísly**, podrobnosti až o úroveň níž.

**Nic nového se nepočítá.** Souhrn jen bere výsledky, které už počítají obrazovky
(stejně jako dnes `overview.js`).

### 2.1 Navigace

```
Souhrn                       ← otevře se po spuštění
Podrobnosti ▸                ← sbalitelná skupina, pamatuje se (views.json)
   SL a TP
   Hladiny                   (dnes „Síla hladin")
   Kontext
   Denní risk
Data
   Zdraví dat a co vyplnit   (dnešní Zdraví dat + bloky „Co vyplnit" a „Kdy to bude")
```

Obrazovka **„Co teď vím" zaniká**. Její věty se stanou kartami Souhrnu (2.2), bloky „Co vyplnit"
a „Kdy to bude" se přesunou na začátek obrazovky Data.

### 2.2 Obrazovka Souhrn

Musí se vejít na jednu obrazovku **1920 × 1080 bez scrollování**. Žádné tabulky.
Nahoře jako dnes: deník, období, kolik obchodů se počítá, přepínače.

**Řádek 1 — Výsledek** (4 dlaždice, velké číslo + popisek):
`Obchodů` · `Win rate` · `Expectancy R` (pod tím průměrný zisk / ztráta v R) · `P/L USD`.
Pod nimi **jedna malá equity křivka v R** (bez os a legendy, jen tvar a koncová hodnota).

**Řádek 2 — Čtyři otázky** (karta = ikona stavu ✓ / ~ / –, jedno velké číslo, jedna věta,
odkaz „Podrobnosti →"):

| karta | velké číslo | věta (vzor) | zdroj |
|---|---|---|---|
| **SL** | p90 MAE vítězů v ticích | „90 % ziskových obchodů šlo proti nejvýš X t, tvůj nejčastější SL je Y t." | SL a TP |
| **TP** | medián pohybu po výstupu na targetu | „Po targetu cena v mediánu pokračovala ještě X t." | SL a TP |
| **Hladiny** | vzdálenost, od které se výsledek láme — jen pokud ji ukazuje rozložení B2; jinak N dotčených hladin | „Předběžně: hladiny ve směru do X t od vstupu …" | Hladiny |
| **Denní risk** | z runs testu | „Série ztrát jsou v mezích náhody." / „Ztráty se shlukují." | Denní risk |

**Řádek 3 — Kontext: největší rozdíly.** Tři dimenze z obrazovky Kontext, které projdou prahem
a mají **největší rozdíl expectancy R mezi dvěma skupinami**. Jeden řádek na dimenzi:

> `Trend 30m:  po trendu +0,42 R (n 22)  ·  proti −0,61 R (n 9)`   ~ předběžně

Žádné „doporučuji", „vyhýbej se" ani zvýraznění vítěze. Je to popis rozdílu, ne pokyn.
Když žádná dimenze neprojde: jeden řádek „Kontext zatím nemá vzorek — chybí …".

**Řádek 4 — Data** (jeden řádek):
`Úplnost kontextu X % · nejužší hrdlo: <pole> (N obchodů) → Data`

### 2.3 Karta, která nemůže běžet

Zůstane na svém místě (rozložení se nehýbe), zešedlá, místo čísla „–" a jedna věta
„Zatím nejde — chybí …" s odkazem na Data. **Žádná prázdná tabulka.**

### 2.4 Obrazovky v Podrobnostech

Beze změny výpočtů. Jen nahoru dej **stejnou kartu jako v Souhrnu** (stejná čísla a věta),
pod ní sekce sbalené jako dnes. Uživatel tak ví, co čte, ještě než otevře detail.

---

## 3. Testy (`node --test`, předem, musí selhat bez implementace)

1. Každé číslo v Souhrnu je **identické** s číslem na příslušné obrazovce v Podrobnostech (fixtura na všechny karty).
2. Karta pod prahem začíná „Předběžně", bez vstupu ukáže „–" a co chybí; nikdy prázdnou tabulku.
3. „Největší rozdíly" berou jen dimenze nad prahem a řadí podle rozdílu expectancy; unknown nevstupuje.
4. Žádný text v Souhrnu neobsahuje „doporuč", „nastav si", „optimální", „vyhýbej".
5. Rozbalení skupiny Podrobnosti se pamatuje a přežije změnu deníku.
6. Starý export (`srTarget` / `srStopLoss`) dá stejnou geometrii jako nový (B4.1).
7. Read-only pojistka drží.

---

## 4. Po dokončení

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt`. Uživateli na konci napiš **česky, krátce**:
co je v Souhrnu, kam se přesunulo „Co teď vím" a „Co vyplnit", a co zmizelo.
