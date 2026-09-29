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

## Konvence
- Kód na branchi test, merge do main až po ověření.
- Testy: vestavěný node:test, bez nových závislostí.
- Tento soubor a CHANGELOG.txt jsou sdílený stav napříč chaty —
  po každé dávce změn je aktualizuj.