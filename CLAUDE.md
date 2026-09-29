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
měnilo. Tvar polí vždy ověř přímo v datech, ne podle specu.

Ověřeno proti datům 29. 9. 2026 (podrobně v app/normalize.js):
- TRADE nemá recordType; SETUP_ONLY má. Ceny jsou u nových záznamů stringy.
- rMultiple je BEZ znaménka – znaménko nese exitTicks (R se znaménkem dělá normalize).
- targetObstacles neexistuje; překážky = srTarget. Deník 4.7.0 převádí srTarget /
  srStopLoss z pole klíčů na řádky { level, price, ticksFromEntry }.
- 0 je platné měření (postExitFavorableTicks = 0 = „dál už nic nebylo"), prázdné = null / "".
- wouldSkipLive / wouldSkipReason do deníku přibývají; chybějící = bral bych naživo.

## Struktura
- main.js – okno, IPC, fs.watch. Jediný zápis: writeViews() → %APPDATA%\backtest-lab\views.json
- lib/paths.js – cesta ke zdroji (přepis → customDataDir deníku → výchozí), assertLabWritable
- app/normalize.js – JEDINÉ předzpracování záznamu; analýzy čtou jen jeho výstup
- app/health.js – zdraví dat (sekce A–D, kontroly 1–13), čisté funkce
- app/ui.js + app/index.html – obrazovka (motiv převzatý z deníku)

## Stav
- Fáze 1 (Zdraví dat) hotová na větvi test, čeká na ověření uživatelem.
- Fáze 2 (analýzy §5 – SL sweep, mřížka SL × TP, …) se NEDĚLÁ, dokud ji uživatel nezadá.
  Až přijde, staví na app/normalize.js beze změny výpočtu.

## Konvence
- Kód na branchi test, merge do main až po ověření.
- Testy: vestavěný node:test, bez nových závislostí (`npm test`). Spuštění: `npm start`.
- Tento soubor a CHANGELOG.txt jsou sdílený stav napříč chaty —
  po každé dávce změn je aktualizuj.
