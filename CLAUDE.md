# Backtest Lab — working notes

## Co to je
Samostatná Electron aplikace, která vyhodnocuje backtestová data
z Futures Journal PRO. Zadání: BACKTEST_TOOL_SPEC.md (čti revize
na začátku — mají přednost před zbytkem).

## Zdroj dat — READ ONLY
%APPDATA%\futures-journal-pro\ai-export\*.json
Deník ten soubor přepisuje při každém uložení, je vždy aktuální.

Lab do deníku ani do jeho datové složky NIKDY nezapisuje.
Nesahej na F:\Trading\Denik\DEV. Vlastní úložiště má Lab jen
na uživatelské pohledy (zvolený deník, filtry), nic o obchodech.

## Schéma se mění
Spec je psaný k 13. 9. 2026, schéma deníku se od té doby několikrát
měnilo. **Čti sekci 0 (Revize) v BACKTEST_TOOL_SPEC.md — má přednost
před zbytkem specu.** Tvar polí vždy ověř přímo v datech, ne podle specu.

Ověřeno proti exportu 3. 10. 2026, deník Backtest_1, 54 obchodů
(deník 4.7.2). Podrobně v revizi R2 specu, nejdůležitější:
- TRADE nemá recordType; SETUP_ONLY má. Ceny jsou u nových záznamů stringy.
- rMultiple je BEZ znaménka – znaménko nese exitTicks (R se znaménkem dělá normalize).
- srTarget / srStopLoss jsou řádky { level, price, ticksFromEntry }. „Žádná
  hladina v cestě" má DVA zápisy: srTargetNone / srStopLossNone = true
  a řádek s level: 'NONE'. Totéž entryLevels / ofConfirm s 'NONE'.
  Nerozlišené od nevyplněného = §5.4d nemá kontrolní skupinu.
- Dopočítaná hodnota NENÍ měření: mfeTicksDerived / maeTicksDerived /
  slDerived / targetLevel1PriceDerived. Dopočítané MFE u targetu se rovná
  exitTicks, takže „kolik bylo nechané na stole" vyjde 0. Do §5.4 b, c, e, f
  jen naměřené (*Derived !== true). Tyhle příznaky patří VEN ze SYSTEM_FIELDS.
- targetLevel1 'MANUAL_EXIT' s dopočítanou cenou není plánovaná hladina.
  Reálně plánovaný cíl má ~10 z 54 obchodů – dnešní úzké hrdlo §5.4a/c.
- wouldSkipLive / wouldSkipReason deník už zapisuje (6 obchodů). Výchozí stav
  i přepínač zrcadli podle performanceRecords() v deníku: mimo výkon,
  ve fill rate zůstávají.
- Deník 4.7.3: TRADE (bez recordType) s fillStatus NO_FILL / MISSED / SKIPPED
  a s výstupem i P/L = hypotetický výsledek („co by to udělalo"), ne exekuce.
  normalize: hypotheticalGroup 'noFill' (NO_FILL, MISSED) / 'skipped' / null.
  Do výkonu rozhoduje JEN LabNormalize.inPerformance (health partition
  i sequenceBase) – výchozí stav mimo, includeNoFill / includeSkipped zvlášť,
  nezávisle na includeSkipLive. isLiveEligible zůstává jen !wouldSkipLive.
  V UI dva přepínače (views includeNoFill / includeSkipped); options pro
  obrazovky staví jen LabHealth.includeOf(views) → ctx.options.
- Úplnost polí ber podle FJTaxonomy.missingContextKeys v deníku.
  NEPŘEBÍREJ nastavení karet (FJ_tradeCards) – vypnutá karta je volba
  formuláře, pro analýzu chybí dál to, co chybí.
- 0 je platné měření (postExitFavorableTicks = 0 = „dál už nic nebylo"),
  prázdné = null / "".
- Export nenese taxonomii ani příznaky deníku (backtest / hidden) – viz R2.7.

## Struktura
- main.js – okno, IPC, fs.watch. Jediný zápis: writeViews() → %APPDATA%\backtest-lab\views.json
- lib/paths.js – cesta ke zdroji (přepis → customDataDir deníku → výchozí), assertLabWritable
- app/labels.js – vlastní mapa klíč → popisek z VÝCHOZÍCH slovníků deníku (R2.7)
- app/normalize.js – JEDINÉ předzpracování záznamu; analýzy čtou jen jeho výstup.
  Původ MFE/MAE (mfe/mae = {ticks, tier}), *Measured, maxFavorable/AdverseMeasured,
  slSweepAdverse, stav hladin none/present/unknown, plannedTarget, missingContext, unknownKeys,
  hypotheticalGroup / isExecuted; inPerformance() = jediné pravidlo výkonového vzorku
- app/health.js – zdraví dat (A–D, kontroly 1–13, úplnost polí, neznámé klíče, blok „naživo bych nevzal")
- app/sltp.js – fáze 2 „SL a TP": verdikt po obchodech, MAE vítězů, MFE stopnutých, SL sweep, mřížka
- app/strength.js – fáze 2 „Síla hladin": klasifikace hladin, tabulka po typech, kontrolní skupina
- app/sequence.js – fáze 3 krok 1 „Denní risk": runs test, permutace nejdelší série ztrát,
  podmíněný win rate, verdikt jednou větou. sequenceBase = množina a pořadí obchodů pro celou fázi 3
- app/daysim.js – fáze 3 krok 2: simulátor dne (pravidla, jednotka R, souhrn variant, po dnech)
- app/variants.js – fáze 3 krok 3: mřížka variant (rodiny po jednom pravidle), leave-one-day-out,
  časové rozdělení, stabilní oblast / osamělá / nespolehlivá, náhodné vynechání
- app/ui.js (kostra) + ui-common/ui-health/ui-sltp/ui-levels/ui-risk.js + index.html.
  Obrazovka může vrátit screen.scope(ctx) → { n, note } pro hlavičku „Počítá se".

## Pravidla analýz (fáze 2)
- Do výpočtů jen NAMĚŘENÉ MFE/MAE (tier nt8 / manual). Dopočtené se ukazují zvlášť.
- Maximum ve směru / proti je známé jen se známým průběhem BĚHEM obchodu (naměřené
  MFE/MAE, nebo fakt exekuce: target ve směru, stoploss proti) – samotný pohyb po
  výstupu by ho podhodnotil. Jinak null.
- SL sweep: u neztrátových rozhoduje MAE během obchodu, u stopnutých pohyb za stopkou;
  přežití stopnutého bez zapsaného pohybu po stopce = „nad pozorovaným rozsahem".
- Síla hladin: netestovaná hladina (e < d − tolerance) do síly nevstupuje; vzdálenost
  jen ze zapsaných ticků nebo přesným přepočtem ceny přes velikost ticku.
- 'unknown' (nevyplněno) nikdy nespadne do kontrolní skupiny 'none'.

## Pravidla analýz (fáze 3 – PLAN_RISK_MANAGEMENT.md)
- **Legacy obchody do sérií a USD VSTUPUJÍ** (rozhodnutí uživatele 3. 10.): výsledek
  a pnlRaw u nich platí, nejistá je jen konvence bodů → do ničeho v R/bodech ne.
  Bez nich má Phidias 1 jen 9 dnů místo 35. Počet legacy vždy vidět na obrazovce.
- W = target, L = stoploss; breakeven / jiné ze sekvence vypadnou a jen se spočítají.
- Runs test a permutace přes celou chronologickou sekvenci (tak sedí čísla v plánu §7);
  podmíněný win rate uvnitř dne (série se na začátku dne nuluje).
- „Naživo bych nevzal" zrcadlí deník (výchozí mimo). Backtest_1 −1,64 z plánu je S nimi.
- `pnl` v exportu je ABSOLUTNÍ hodnota (vždy > 0) – znaménko nese jen `pnlRaw`.
- Simulátor: R obchodu = pnlRaw / (1 R v USD); 1 R = medián ztráty na SL (vč. komise),
  přepsatelný. rMultiple nejde – legacy ho nemají. Varianta bez pravidla = přesně P/L deníku.
- Phidias 1 míchá instrumenty (MES 134, FDXS 8, ES 1) – UI to hlásí, nic nefiltruje samo.
- Mřížka: Lab NEVYBÍRÁ vítěze (§8.2) – žádné doporučení, řazení podle metriky ani zvýrazněné
  maximum. Jen stabilní oblast (≥ 3 sousední hodnoty, projdou LOO, stejné znaménko), osamělá
  kladná = šum, neprojde LOO = nespolehlivá. Pod 20 dny nic z toho, jen popis.
- Při záporné expectancy každé ubírající pravidlo vyjde kladně → sloupec „Náhodné vynechání“.

## Stav
- Fáze 1 (Zdraví dat) + opravy (kontrola 11, prognóza z hrdla, práh fill rate) a fáze 2
  (SL a TP, Síla hladin) hotové na větvi test (0.2.0), čekají na ověření uživatelem.
- Fáze 3 (PLAN_RISK_MANAGEMENT.md §9): krok 1 sekvenční analýza potvrzený a commitnutý;
  krok 2 simulátor dne, krok 3 mřížka variant a hypotetické obchody (deník 4.7.3, přepínače
  no fill / vynechané) na test, vydané 5. 10. jako pre-release v0.3.0 (test); čekají na
  ověření uživatelem, pak merge do main. Další: 4 dva deníky vedle sebe (§8.1, nikdy nesčítat).
  Výsledek kroku 1: Phidias 1 z = +0,47 (náhodné), Backtest_1 z = −0,83.
- Stav dat 3. 10.: hrdlo = plánovaný cíl s cenou (4 obchody ve výkonovém vzorku),
  SR řádky s místem 10/21 (proti TP) a 13/30 (proti SL).
- Fixtury z reálných dat (kdyby byly potřeba) patří do „Claude files/" (gitignore), ne do repa.

## Konvence
- Repozitář: github.com/Braunn318/backtest-lab (veřejný, jako deník). `main` = ověřený
  stav, `test` = rozpracované; merge do main až po ověření uživatelem.
- Kód na branchi test, merge do main až po ověření.
- Testy: vestavěný node:test, bez nových závislostí (`npm test`). Spuštění: `npm start`.
- Instalátor: `npm run dist` → dist\Backtest-Lab-Setup-<verze>.exe (electron-builder jen jako
  sestavovací devDependency). Ke každému vydání přiložit k GitHub release vedle zipu se zdrojáky.
- Tento soubor a CHANGELOG.txt jsou sdílený stav napříč chaty —
  po každé dávce změn je aktualizuj.
