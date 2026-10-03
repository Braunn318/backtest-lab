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
  slSweepAdverse, stav hladin none/present/unknown, plannedTarget, missingContext, unknownKeys
- app/health.js – zdraví dat (A–D, kontroly 1–13, úplnost polí, neznámé klíče, blok „naživo bych nevzal")
- app/sltp.js – fáze 2 „SL a TP": verdikt po obchodech, MAE vítězů, MFE stopnutých, SL sweep, mřížka
- app/strength.js – fáze 2 „Síla hladin": klasifikace hladin, tabulka po typech, kontrolní skupina
- app/ui.js (kostra) + ui-common/ui-health/ui-sltp/ui-levels.js + index.html

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

## Stav
- Fáze 1 (Zdraví dat) + opravy (kontrola 11, prognóza z hrdla, práh fill rate) a fáze 2
  (SL a TP, Síla hladin) hotové na větvi test (0.2.0), čekají na ověření uživatelem.
- Stav dat 3. 10.: hrdlo = plánovaný cíl s cenou (4 obchody ve výkonovém vzorku),
  SR řádky s místem 10/21 (proti TP) a 13/30 (proti SL).
- Fixtury z reálných dat (kdyby byly potřeba) patří do „Claude files/" (gitignore), ne do repa.

## Konvence
- Kód na branchi test, merge do main až po ověření.
- Testy: vestavěný node:test, bez nových závislostí (`npm test`). Spuštění: `npm start`.
- Tento soubor a CHANGELOG.txt jsou sdílený stav napříč chaty —
  po každé dávce změn je aktualizuj.
