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
- Hladiny u cíle / SL: od deníku 4.8.5 jeden seznam nearLevels (viz Kontext v3 níže).
  entryLevels / ofConfirm mají „žádná" jako 'NONE'.
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
- Export nenese příznaky deníku (backtest / hidden). Od deníku 4.7.4 nese `taxonomy`
  (úprava slovníků: vlastní volby CUSTOM_…, přejmenování) – viz R2.7.

Kontext v2 – ověřeno proti exportu 11. 10. 2026 (deník 4.8.2, Phidias 1; zadání
docs/ZADANI_KONTEXT.md část B):
- Ruční pole na obchodu: trendHtf, grade (+ gradeSetAt, gradeEdited), absLocation, entryTestNo.
- Kontext dne: `dayNotes[date].dayContext` (openVsValue, dayTypeExpected, dayTypeActual,
  valueMigration, newsEvent). Lab ho připojí ke každému záznamu dne.
- Každý obchod nese `derived` (dopočty deníku) – od 4.8.5 ve tvaru v3 (níže).
- `taxonomy` nenese `isLevel` → targetOnLevel jde jen převzít z exportu.
- Lab zrcadlí DENÍK (repo_clone/app/context.js), ne text zadání: missingContextKeys má navíc
  trendHtf, grade a pravidlo „hypotetický obchod s výstupní cenou se posuzuje jako naplněný“.
- Tick: deník bere i uživatelské šablony (FDXS), Lab jen vestavěnou tabulku. Bez ticku Lab
  dopočet nedělá (unknown) a neporovnává („nejde ověřit“).

Kontext v3 – ověřeno proti exportu 14. 10. 2026 (deník 4.8.5, Phidias 1; zadání
docs/ZADANI_KONTEXT_V3.md část B, docs/ZADANI_LAB_SOUHRN.md §1):
- Jeden seznam `nearLevels` { level, price, testState?, legacySide?, ticksFromEntry? } + `nearLevelsNone`.
  Řádek s cenou nikdy nenese legacySide ani ticky; řádek ze starých dat bez ceny nese stranu TG / SL
  (a v reálných datech ticky null → poloha nejde). testState = klíč TESTED / UNTESTED.
- `derived`: targetTicks, slTicks, targetOnLevel, nearestAheadTicks, nearestAheadR, stopBehindTicks,
  levelsStopToEntry, levelsEntryToTarget, tradeNoInDay, prevResultInDay, dayPnlBefore, session,
  gradeRetro + derived.nearLevels[i] = { fromEntry, fromStop, toTarget, position } (i = index po převodu).
- STARÝ TVAR se pořád vyskytuje (Backtest_1: srTarget / srStopLoss a staré klíče v `derived`). Lab ho
  převede V PAMĚTI jediným pravidlem – zrcadlo repo_clone/app/taxonomy.js (sanitizeLevelRows s group
  null, sanitizeNearLevels, nearLevelsFromLegacy, nearLevelsOf, nearLevelsNoneOf) a geometrie
  repo_clone/app/context.js (levelGeometry, nearLevelMetrics) v app/normalize.js. Ověřeno 14. 10.
  kódem deníku nad všemi reálnými exporty: 0 rozdílů. Při změně v deníku změnit tady stejně.
- Export se starými dopočty (pathState …, bez derived.nearLevels) = „starý tvar dopočtů": kontrola 17
  porovná jen klíče, které se nezměnily, a řekne kolik. Známý rozdíl „řádek NONE" z v2 zmizel
  (NONE se zahodí v Labu i v deníku): Phidias 1 0 nesouladů z 183, 8 FDXS nejde ověřit.
- Pryč pro vždy (i z dat, která je ještě nesou): liquiditySwept, pathProfile, entryLevelTests,
  pathState, firstObstacleTicks, freePathR, slBufferTicks, slZoneCount, beyondStop / beyondTarget /
  behindEntry, koše freePathR / slBufferTicks, tolerance hladin. Nevracet.

## Struktura
- main.js – okno, IPC, fs.watch. Jediný zápis: writeViews() → %APPDATA%\backtest-lab\views.json
- app/views.js – co smí do views.json a jak se čistí (sanitizeViews, sdílí main.js i okno),
  rozbalené sekce openSections { obrazovka: [id] }, navDetailsClosed (sbalené Podrobnosti), levelBin
  (1 / 2 / 4), co se maže při změně deníku (JOURNAL_SCOPED)
- lib/paths.js – cesta ke zdroji (přepis → customDataDir deníku → výchozí), assertLabWritable
- app/labels.js – vlastní mapa klíč → popisek z VÝCHOZÍCH slovníků deníku + overlay `taxonomy`
  z exportu (custom, labels; applyJournalTaxonomy volá normalizeExport) (R2.7)
- app/normalize.js – JEDINÉ předzpracování záznamu; analýzy čtou jen jeho výstup.
  Původ MFE/MAE (mfe/mae = {ticks, tier}), *Measured, maxFavorable/AdverseMeasured,
  slSweepAdverse, stav hladin none/present/unknown, plannedTarget, missingContext, unknownKeys,
  hypotheticalGroup / isExecuted; inPerformance() = jediné pravidlo výkonového vzorku.
  Kontext: registr CONTEXT_V2_FIELDS → out.ctx[pole] = { state: value | none | unknown, value };
  v3: out.nearLevels[] { level, price, testState, legacySide, ticksFromEntry, index, fromEntry,
  fromStop, toTarget, position }, nearLevelsNone, nearLevelsState (present / none / unknown),
  out.derived (přepočet Labu), out.exported, exportedOldShape, out.derivedMismatch, out.dataCheck, gradeOrigin.
  normalizeRecords(trades, dayNotes) = normalizeRecord + co jde jen přes celý deník (pořadí
  v dni, kontext dne); samotný normalizeRecord má obojí nevyplněné.
- app/health.js – zdraví dat (A–D, kontroly 1–17, úplnost polí, pokrytí kontextu, neznámé
  klíče, blok „naživo bych nevzal"). 14 / 15 cíl a SL na špatné straně, 16 hladiny za SL / za cílem
  (stav `info`, ne chyba), 17 dopočty deníku × přepočet Labu
- app/sltp.js – fáze 2 „SL a TP": verdikt po obchodech, MAE vítězů, MFE stopnutých, SL sweep, mřížka
- app/context.js – „Kontext": registr dimenzí (DIMENSIONS, 13 v 5 skupinách) a koše (BUCKETS – jen
  pořadí v dni), rozpad N / win % / průměr R / expectancy R (+ avgWinR / avgLossR, pnl), stav dimenze,
  compared (skupiny v porovnání od největší), řádky pro „Co vyplnit" (fillRows)
- app/strength.js – „Hladiny" (v3 B2): dotčena / nedotčena z dráhy [−MAE, +MFE], přesah, rozložení
  po `bin` ticích (distribution), podle typu a netest / test, stopBehind (stopnuté × přeživší),
  nearestAhead (cíl dosažen × nedosažen), kontrolní skupina podle nearLevelsState
- app/sequence.js – fáze 3 krok 1 „Denní risk": runs test, permutace nejdelší série ztrát,
  podmíněný win rate, verdikt jednou větou. sequenceBase = množina a pořadí obchodů pro celou fázi 3
- app/daysim.js – fáze 3 krok 2: simulátor dne (pravidla, jednotka R, souhrn variant, po dnech)
- app/variants.js – fáze 3 krok 3: mřížka variant (rodiny po jednom pravidle), leave-one-day-out,
  časové rozdělení, stabilní oblast / osamělá / nespolehlivá, náhodné vynechání
- app/overview.js – analyses(ctx): JEDINÉ místo, kde se pro render spouští analýzy (memo na ctx) –
  Souhrn i obrazovky čtou tentýž objekt. Stavy analýz (✓ / ~ / –, *State), computeOverview → bloky
  „Co vyplnit" a „Kdy to bude". NIC NEPOČÍTÁ: bere výsledky analýz a jejich prahy.
- app/summary.js – Souhrn (ZADANI_LAB_SOUHRN §2): karty výsledek, SL, TP, Hladiny, Denní risk,
  kontext – největší rozdíly, data; NAV a START_SCREEN. Nic nepočítá, jen skládá z analyses.
- app/ui.js (kostra) + ui-common/ui-summary/ui-health/ui-sltp/ui-levels/ui-context/ui-risk.js + index.html.
  ui-summary.js kreslí karty (data-card … <!--/card-->) – obrazovky v Podrobnostech dávají nahoru tutéž.
  Obrazovka může vrátit screen.scope(ctx) → { n, note } pro hlavičku „Počítá se".
  Obrazovky skládají sekce přes LabUI.sections(screen, [{ id, title, state, headline, body, missing }], views).

## Pravidla analýz (fáze 2)
- Do výpočtů jen NAMĚŘENÉ MFE/MAE (tier nt8 / manual). Dopočtené se ukazují zvlášť.
- Maximum ve směru / proti je známé jen se známým průběhem BĚHEM obchodu (naměřené
  MFE/MAE, nebo fakt exekuce: target ve směru, stoploss proti) – samotný pohyb po
  výstupu by ho podhodnotil. Jinak null.
- SL sweep: u neztrátových rozhoduje MAE během obchodu, u stopnutých pohyb za stopkou;
  přežití stopnutého bez zapsaného pohybu po stopce = „nad pozorovaným rozsahem".
- Hladiny (v3 B2): nedotčená hladina (poloha mimo dráhu [−MAE, +MFE]) do reakce nevstupuje; poloha
  jen přesným přepočtem ceny přes velikost ticku (nebo ticky řádku ze starých dat se stranou).
  Žádná tolerance, koš ani role – rozložení po 1 ticku, sloučení je jen zobrazení.
- 'unknown' (nevyplněno) nikdy nespadne do kontrolní skupiny 'none'.

## Pravidla analýz (kontext v2 – docs/ZADANI_KONTEXT.md část B)
- Tři stavy, nikdy dva: hodnota / vědomě žádná (absLocation NONE, pathProfile UNKNOWN,
  dayType UNKNOWN, newsEvent NONE, žádná zóna u SL) / nevyplněno. Nevyplněno NIKDY nespadne
  do „žádná"; „vědomě žádná" je normální skupina (kontrolní), nevyplněno jen počet.
- Dopočty z cen a časů počítá Lab SÁM (i nad starším exportem). Hodnota z exportu slouží jen
  ke kontrole 17; při nesouladu Lab počítá se svým přepočtem (rozhodnutí uživatele 11. 10.)
  a nic nepřepisuje. targetOnLevel, gradeRetro a session se jen přebírají, nedomýšlí se.
- Stav dimenze = stávající prahy (10 / 30) nad DRUHOU největší skupinou – porovnání potřebuje
  dvě. Nevyplněno ani řádky „stranou" (známka změněná dodatečně / doplněná zpětně) do prahu
  ani do věty nevstupují.
- Koše jen v LabContext.BUCKETS: tradeNoInDay 1 / 2 / 3 / 4+ (koše hladin v3 zrušila).
- „Co vyplnit": pole kontextu se řadí ZA hrdla analýz fáze 2, fill rate zůstává poslední.

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

## Přehlednost (ZADANI_PREHLEDNOST.md, od 0.4 ZADANI_LAB_SOUHRN.md)
- Navigace: Souhrn · Podrobnosti ▸ (SL a TP, Hladiny, Kontext, Denní risk – sbalitelné, pamatuje se)
  · Data (Zdraví dat a co vyplnit). „Co teď vím" od 0.4 NENÍ – její věty jsou karty Souhrnu.
- Souhrn se otevírá po spuštění a musí se vejít na 1920 × 1080 bez scrollu: výsledek + equity v R,
  čtyři otázky (SL, TP, Hladiny, Denní risk), kontext – největší rozdíly, řádek dat. Žádné tabulky,
  žádné doporučení (test hlídá „doporuč", „nastav si", „optimální", „vyhýbej" na všech obrazovkách).
- Souhrn NIC NOVÉHO NEPOČÍTÁ: karty berou analyses(ctx); obrazovka v Podrobnostech má nahoře
  TUTÉŽ kartu (test porovnává HTML karty po značku <!--/card-->).
- Rozhodnutí uživatele 14. 10.: karta Hladiny = jen N dotčených (bod zlomu se nehledá – byl by to nový
  výpočet s rizikem šumu, doplní se, až ho uživatel definuje); kontext porovnává DVĚ NEJVĚTŠÍ skupiny
  dimenze (tytéž, na kterých stojí práh), ne extrémy. Verze 0.4.0 podle zadání.
- Tři stavy, nic mezi: ✓ ví se (projde prahem analýzy) · ~ zatím slabé (věta začíná „Předběžně")
  · – nejde (věta říká co chybí a kolik). Prahy = ty, které už ukazují obrazovky: pod SAMPLE_GREY 10
  nejde, pod SAMPLE_WARN 30 slabé (SL sweep a mřížka SL × TP 50); runs test platný = 10 zisků
  i 10 ztrát; mřížka variant 20 dnů; pravidlo ze simulátoru je ✓ jen nad 20 dny a když jeho
  varianta v mřížce projde bez jednoho dne, v čase a není osamělá. Prahy se kvůli plnějším
  obrazovkám NESNIŽUJÍ – prázdno je správná odpověď.
- „Co vyplnit" se odvozuje z řádků použitelnosti zdraví dat: jen pole, kterému někde chybí
  a jehož analýza není ✓ (bez vlastního stavu – R statistika, plánovaný cíl – pod cílem 50).
  Seskupené podle chybějícího pole, od nejmenšího N; fill rate na konci (do hrdla se nepočítá).
- „Kdy to bude" = prognóza zdraví dat (cíl 50, tempo použitelné ÷ obchodní dny), nepočítá se znovu.
- Na čtyřech obrazovkách je každá sekce sbalená, hlavička nese hlavní číslo / verdikt.
  Rozbalené se pamatují per obrazovka (views.json openSections) a přežijí změnu deníku.
  Analýza, která nemůže běžet, se nekreslí – jen „Zatím nejde — chybí …" a odkaz na „Co vyplnit" (Data).
  Pořadí: ✓, pak ~, pak –.

## Stav
- Fáze 1 (Zdraví dat) + opravy (kontrola 11, prognóza z hrdla, práh fill rate) a fáze 2
  (SL a TP, Síla hladin) hotové na větvi test (0.2.0), čekají na ověření uživatelem.
- Fáze 3 (PLAN_RISK_MANAGEMENT.md §9): krok 1 sekvenční analýza potvrzený a commitnutý;
  krok 2 simulátor dne, krok 3 mřížka variant a hypotetické obchody (deník 4.7.3, přepínače
  no fill / vynechané) na test, vydané 5. 10. jako pre-release v0.3.0 (test); čekají na
  ověření uživatelem, pak merge do main.
- Přehlednost (ZADANI_PREHLEDNOST.md, 6. 10.): úvodní obrazovka „Co teď vím" + sbalené sekce
  (0.3.1) a vlastní volby deníku z exportu `taxonomy` místo „Neznámých klíčů" (0.3.2, potřebuje
  deník 4.7.4) – na test, vydané 8. 10. jako pre-release v0.3.2 (test); čekají na ověření
  uživatelem, pak merge do main. Přehlednost měla přednost před krokem 4.
- Kontext v2 (docs/ZADANI_KONTEXT.md část B, 11. 10.): normalizace nových polí a dopočtů,
  kontroly 14–17 + pokrytí ve Zdraví dat, obrazovka „Kontext", zóny u SL v Síle hladin,
  řádky kontextu na „Co teď vím" (0.3.3, potřebuje deník 4.8.1+ kvůli `derived`; starší export
  projde jako nevyplněno). Vydáno až v rámci v0.4.0 (0.3.3 samostatně nevyšla).
  Stav dat 11. 10.: Phidias 1 má 5 z 18 dimenzí se vzorkem (vše „předběžně"), Backtest_1 2;
  ruční pole jsou skoro prázdná (trendHtf / grade 2 obchody). Kontrola 17: Phidias 1 4 z 171
  (řádek NONE, viz Schéma), 8 FDXS nejde ověřit.
- 0.4.0 (14. 10., docs/ZADANI_LAB_SOUHRN.md): kontext v3 dorovnaný na deník 4.8.5 + Souhrn
  a nové rozložení. Commitnuto na test spolu s 0.3.3 a vydáno 14. 10. jako pre-release v0.4.0 (test)
  s instalátorem – čeká na ověření uživatelem, pak merge do main. 209 testů. Stav dat 14. 10.: Phidias 1 – 44 dotčených hladin (✓),
  SL / TP předběžně, kontext 3 dimenze předběžně; úplnost kontextu 8 % (známka / trend 30m).
- Vydání na test: skill `.claude/skills/release_test` (gitignored, lokální).
- Další v řadě: fáze 3 krok 4 – dva deníky vedle sebe (§8.1, nikdy nesčítat). NEZAČÍNAT,
  čeká na rozhodnutí uživatele, až bude víc dnů.
  Výsledek kroku 1: Phidias 1 z = +0,47 (náhodné), Backtest_1 z = −0,83.
- Stav dat 6. 10. (Backtest_1, 52 obchodů / 6 dnů): hrdlo = plánovaný cíl s cenou (7 obchodů),
  SR řádky s místem 12/23 (proti TP) a 16/33 (proti SL). Phidias 1: 36 dnů, runs z = +0,57,
  mřížka variant bez stabilní oblasti, „2 SL za sebou" neprojde bez jednoho dne.
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
