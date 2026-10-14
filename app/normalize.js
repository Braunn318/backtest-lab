'use strict';
// Předzpracování záznamu z ai-exportu deníku – JEDINÉ místo v Labu.
//
// PROČ JEDNO MÍSTO: v deníku se už jednou rozešly dvě verze téhož výpočtu
// (body na kontrakt vs. body celkem). Každá analýza (zdraví dat, SL a TP,
// síla hladin) proto čte jen výstup normalizeRecord a nikdy si znovu
// nepočítá nic ze surového záznamu. Chybí-li odvozená veličina, přidá se sem
// i s testem, ne do analýzy.
//
// Tvar dat je ověřený proti exportu 3. 10. 2026 (deník 4.7.2, revize R2 specu):
//  - TRADE nemá pole recordType (TRADE = jeho absence), setup má 'SETUP_ONLY'
//  - entryPrice / exitPrice jsou u nových záznamů STRINGY, u starých čísla
//  - rMultiple je BEZ ZNAMÉNKA (pointsPerContract / slPoints), stoploss = +1;
//    znaménko nese exitTicks
//  - hladiny u cíle a u SL viz kontext v3 níže (dřív srTarget / srStopLoss)
//  - DOPOČÍTANÁ HODNOTA NENÍ MĚŘENÍ: mfeTicksDerived / maeTicksDerived jsou
//    dopočtené z výstupní ceny (u targetu je dopočtené MFE z definice rovno
//    exitTicks). Do výpočtů fáze 2 vstupuje jen *Measured
//  - od deníku 4.7.3 může TRADE (bez recordType) nést fillStatus NO_FILL /
//    MISSED / SKIPPED s výstupem a P/L = hypotetický výsledek, ne exekuce
//    (hypotheticalGroup, inPerformance)
//  - prázdná hodnota je null nebo "" – NULA JE PLATNÉ MĚŘENÍ („cena nešla ani
//    o tick", u postExitFavorableTicks „dál už nic nebylo")
//
// Kontext v2 (docs/ZADANI_KONTEXT.md část B), tvar ověřený proti exportu
// 11. 10. 2026 (deník 4.8.2):
//  - ruční pole trendHtf / grade / absLocation / entryTestNo, kontext dne
//    v dayNotes[date].dayContext → out.ctx[pole] = { state, value },
//    stav 'value' | 'none' (vědomě žádná / nevím) | 'unknown' (nevyplněno)
//  - dopočty z cen (geometrie hladin, pořadí v dni) LAB POČÍTÁ SÁM stejným
//    pravidlem jako FJContext v deníku → out.derived. Hodnota z exportu
//    (raw.derived → out.exported) slouží jen ke kontrole: rozdíl jde do
//    out.derivedMismatch a hlásí ho zdraví dat, nic se nepřepisuje
//  - targetOnLevel, gradeRetro a session se jen PŘEBÍRAJÍ – stojí na nastavení
//    deníku (isLevel, režim), které export nenese
//  - starší export nová pole nemá → všechna 'unknown', nic se nedomýšlí
//
// Kontext v3 (docs/ZADANI_KONTEXT_V3.md B1), tvar ověřený proti exportu
// 14. 10. 2026 (deník 4.8.5):
//  - jeden seznam hladin nearLevels { level, price, testState?, legacySide?,
//    ticksFromEntry? } + nearLevelsNone. Starší export (srTarget / srStopLoss
//    + …None) se převede V PAMĚTI stejným pravidlem jako deník – nic se nezapisuje
//  - deník MĚŘÍ, nehodnotí: geometrie řádku (fromEntry / fromStop / toTarget /
//    position) bez tolerance a bez rolí; co hladina v obchodu dělá, je statistika
//  - liquiditySwept, pathProfile, entryLevelTests a posuzující dopočty (pathState,
//    freePathR, slBufferTicks …) jsou pryč – Lab je nečte ani z exportu
//
// Modul se načítá přes <script src> v okně i přes require() v Node testech.

(function (root, factory) {
  const labels = (typeof module !== 'undefined' && module.exports)
    ? require('./labels.js')
    : root.LabLabels;
  const api = factory(labels);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabNormalize = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {

  // Veličiny, se kterými se počítá. Vše v ticích, bodech, minutách nebo měně;
  // "" / null / nečíslo → null, 0 zůstává 0.
  const NUMBER_FIELDS = [
    'exitTicks', 'slTicks', 'slPoints', 'mfeTicks', 'maeTicks',
    'maxFavorableTicks', 'maxAdverseTicks', 'maxTicks',
    'postExitFavorableTicks', 'postExitAdverseTicks', 'observedMinutes',
    'rMultiple', 'plannedRMultiple', 'points', 'pointsPerContract', 'pointsTotal',
    'pnl', 'pnlRaw', 'grossPnl', 'commission', 'contracts',
    'missedByTicks', 'confluenceCount'
  ];
  const PRICE_FIELDS = ['entryPrice', 'exitPrice', 'slPrice', 'plannedEntryPrice', 'lastLegExitPrice'];
  const BOOL_FIELDS = ['touchedEntry', 'touchedSl', 'postExitAdverseFirst', 'slDerived'];
  const TEXT_FIELDS = [
    'id', 'date', 'entryTime', 'exitTime', 'instrument', 'side', 'result',
    'setupCode', 'fillStatus', 'trend', 'maxLevel', 'reason', 'wouldSkipReason',
    'externalAccount', 'mfeTicksSource', 'maeTicksSource',
    'trendHtf', 'grade', 'gradeSetAt', 'absLocation', 'entryTestNo'
  ];
  const LIST_FIELDS = ['entryLevels', 'ofConfirm'];
  const NONE_KEY = 'NONE';

  // Pole kontextu (od v2, bez polí, která v3 smazala). source: 'trade' = pole obchodu, 'day' = kontext dne
  // (dayNotes[date].dayContext), 'export' = dopočet deníku, který Lab jen
  // přebírá. none = hodnoty, které znamenají „vědomě žádná / nevím" – jsou
  // vyplněné, ale nejsou to hodnota. Z registru se odvozuje normalizace,
  // pokrytí ve zdraví dat i testy; nové pole stačí přidat sem.
  const CONTEXT_V2_FIELDS = [
    { key: 'trendHtf', source: 'trade', vocabulary: 'TREND_HTF' },
    { key: 'grade', source: 'trade', vocabulary: 'GRADE' },
    { key: 'entryTestNo', source: 'trade', vocabulary: 'ENTRY_TEST_NO' },
    { key: 'absLocation', source: 'trade', vocabulary: 'ABS_LOCATION', none: ['NONE'] },
    { key: 'targetOnLevel', source: 'export' },
    { key: 'session', source: 'export', vocabulary: 'SESSION' },
    { key: 'openVsValue', source: 'day', vocabulary: 'OPEN_VS_VALUE' },
    { key: 'dayTypeExpected', source: 'day', vocabulary: 'DAY_TYPE', none: ['UNKNOWN'] },
    { key: 'dayTypeActual', source: 'day', vocabulary: 'DAY_TYPE', none: ['UNKNOWN'] },
    { key: 'valueMigration', source: 'day', vocabulary: 'VALUE_MIGRATION' },
    { key: 'newsEvent', source: 'day', vocabulary: 'NEWS_EVENT', none: ['NONE'] }
  ];
  const TEST_STATES = ['UNTESTED', 'TESTED'];

  // Velikost ticku podle instrumentu. Jen pro převod ceny hladiny na ticky
  // – to je přesný přepočet, ne odhad. Neznámý instrument → null, vzdálenost
  // se pak nespočítá.
  const TICK_SIZES = {
    ES: 0.25, MES: 0.25, NQ: 0.25, MNQ: 0.25,
    YM: 1, MYM: 1, RTY: 0.1, M2K: 0.1,
    CL: 0.01, MCL: 0.01, GC: 0.1, MGC: 0.1
  };

  // Úrovně původu MFE/MAE. Do výpočtů vstupuje jen 'nt8' a 'manual'.
  const MEASURED_TIERS = new Set(['nt8', 'manual']);

  function numberOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const s = value.trim().replace(',', '.');
      if (s === '') return null;
      value = s;
    }
    if (typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function textOrNull(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
  }

  function boolOrNull(value) {
    return value === true ? true : value === false ? false : null;
  }

  // Prázdné = null, undefined, "" (i jen mezery), [] a objekt, jehož všechny
  // hodnoty jsou prázdné (targetLevel1 {type:null, price:null}). 0 a false
  // prázdné NEJSOU – jsou to vyplněné hodnoty.
  function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.values(value).every(isEmpty);
    return false;
  }

  function listOf(value) {
    return Array.isArray(value) ? value.map(textOrNull).filter(v => v != null) : [];
  }

  // Kód bez kontraktního měsíce ("MES 09-26" = "MES"), jako v deníku.
  function tickSizeOf(instrument) {
    const text = textOrNull(instrument);
    const key = text ? text.toUpperCase().split(' ')[0] : null;
    return key && Object.prototype.hasOwnProperty.call(TICK_SIZES, key) ? TICK_SIZES[key] : null;
  }

  function roundTicks(v) {
    return Math.round(v * 1000) / 1000;
  }

  // Rozdíl cen v ticích jako FJPoints.ticksOf v deníku (4 desetinná místa) –
  // jen tak jde dopočet Labu porovnat s dopočtem deníku. Bez ticku null.
  function ticksOf(priceDiff, tickSize) {
    if (!(tickSize > 0) || priceDiff == null || !Number.isFinite(priceDiff)) return null;
    return Math.round(priceDiff / tickSize * 10000) / 10000 + 0;
  }

  function round2(v) {
    return v == null ? null : Math.round(v * 100) / 100;
  }

  function directionOf(side) {
    return side === 'long' ? 1 : side === 'short' ? -1 : null;
  }

  // Tři stavy pole kontextu v2. Prázdné je VŽDY 'unknown' – do 'none' spadne
  // jen hodnota, kterou tak pole výslovně označuje.
  function ctxOf(value, noneKeys) {
    const v = typeof value === 'boolean' ? value : textOrNull(value);
    if (v == null) return { state: 'unknown', value: null };
    return { state: (noneKeys || []).includes(v) ? 'none' : 'value', value: v };
  }

  // Tři stavy, nikdy dva (zadání fáze 2 §1.2) – vstupní hladiny a order flow:
  //   'present' – aspoň jeden skutečný klíč
  //   'none'    – vědomě žádná: příznak, nebo samé 'NONE'
  //   'unknown' – nevyplněno. 'unknown' NIKDY nespadne do 'none'.
  function levelStateOf(rows, noneFlag) {
    const keys = rows.map(r => (typeof r === 'string' ? r : r && r.level)).filter(Boolean);
    if (keys.some(k => k !== NONE_KEY)) return 'present';
    if (noneFlag === true || keys.length > 0) return 'none';
    return 'unknown';
  }

  function targetLevelOf(value) {
    if (!value || typeof value !== 'object') return null;
    const type = textOrNull(value.type);
    const price = numberOrNull(value.price);
    if (type == null && price == null) return null;
    return { type, price };
  }

  // Plánovaný cíl: typ hladiny, který není „ruční výstup", a cena, která
  // nebyla převzatá z výstupní ceny. MANUAL_EXIT je zápis toho, kde uživatel
  // vystoupil, ne hladina, na kterou mířil (R2.4).
  function plannedTargetOf(targetLevel, priceDerived) {
    if (!targetLevel || !targetLevel.type || targetLevel.type === 'MANUAL_EXIT') return null;
    if (priceDerived === true) return null;
    return { type: targetLevel.type, price: targetLevel.price };
  }

  // Původ MFE/MAE: 'derived' (dopočteno z výstupu), 'nt8' (import), 'manual'
  // (zapsáno bez zdroje), null (chybí).
  function excursionOf(ticks, source, derived) {
    const t = numberOrNull(ticks);
    if (t == null) return { ticks: null, tier: null };
    if (derived === true) return { ticks: t, tier: 'derived' };
    if (textOrNull(source) === 'nt8') return { ticks: t, tier: 'nt8' };
    return { ticks: t, tier: 'manual' };
  }

  function measured(excursion) {
    return excursion && MEASURED_TIERS.has(excursion.tier) ? Math.abs(excursion.ticks) : null;
  }

  // "15:30" nebo "15:30:12" → minuty od půlnoci (se zlomkem za sekundy).
  function minutesOf(time) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(time || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  }

  // R se znaménkem. rMultiple v deníku je velikost (bez znaménka), směr nese
  // exitTicks. Math.abs pro případ, že by deník jednou začal ukládat znaménko.
  function signedR(rMultiple, exitTicks) {
    const r = numberOrNull(rMultiple);
    const x = numberOrNull(exitTicks);
    if (r == null || x == null) return null;
    if (x === 0) return 0;
    return Math.sign(x) * Math.abs(r);
  }

  // Skupina hypotetického obchodu – stejná definice jako hypotheticalGroup()
  // v deníku 4.7.3: NO_FILL a MISSED („nestihl jsem" není vědomé rozhodnutí)
  // → 'noFill', SKIPPED → 'skipped', prázdný stav nebo FILLED → null (naplněno).
  // SETUP_ONLY skupinu nemá – do výkonu nevstupuje nikdy.
  //
  // Záměrně NEMĚNÍ isLiveEligible: „naživo bych nevzal" je jiná skupina
  // s vlastním přepínačem (v deníku i tady) a zapnutí jedné nesmí potichu
  // vrátit do výkonu druhou.
  function hypotheticalGroupOf(out) {
    if (out.isSetupOnly) return null;
    if (out.fillStatus === 'NO_FILL' || out.fillStatus === 'MISSED') return 'noFill';
    if (out.fillStatus === 'SKIPPED') return 'skipped';
    return null;
  }

  // Patří obchod do výkonu? Jediné místo pro výkonové vzorky všech analýz
  // (zdraví dat, SL a TP, síla hladin, sekvence, simulátor, mřížka) –
  // zrcadlí performanceRecords() v deníku. Každá skupina mimo výkon se
  // zapíná zvlášť: options { includeSkipLive, includeNoFill, includeSkipped },
  // výchozí stav = všechny mimo. Legacy tu NEROZHODUJE – fáze 1/2 je
  // vyřazuje, fáze 3 je bere (CLAUDE.md).
  function inPerformance(record, options = {}) {
    if (!record || !record.isTrade) return false;
    if (!record.isLiveEligible && !options.includeSkipLive) return false;
    if (record.hypotheticalGroup === 'noFill' && !options.includeNoFill) return false;
    if (record.hypotheticalGroup === 'skipped' && !options.includeSkipped) return false;
    return true;
  }

  // ------------------------------------------------------------- kontext v3: hladiny v blízkosti
  //
  // ZRCADLÍ DENÍK 1 : 1 – jediné pravidlo, nic vlastního:
  //   repo_clone/app/taxonomy.js  sanitizeLevelRows (s group null), sanitizeNearLevels,
  //                               nearLevelsFromLegacy, nearLevelsOf, nearLevelsNoneOf
  //   repo_clone/app/context.js   levelGeometry, nearLevelMetrics, targetTicks, slTicks
  // Řádky musí vyjít ve STEJNÉM POŘADÍ jako v deníku – podle indexu se k nim páruje
  // derived.nearLevels[i] z exportu (kontrola 17). Lab převádí jen v paměti.

  const LEGACY_SIDES = ['TG', 'SL'];
  const LEGACY_NEAR_KEYS = ['srTarget', 'srStopLoss', 'srTargetNone', 'srStopLossNone'];

  // numOrNull deníku (bez desetinné čárky – ceny řádků zapisuje deník sám).
  function journalNum(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const testStateOf = v => (TEST_STATES.includes(v) ? v : '');

  // Jedna strana starého tvaru (srTarget / srStopLoss), typ se neověřuje.
  function legacyRowsOf(value) {
    const list = Array.isArray(value) ? value : [];
    const rows = [];
    const seen = new Set();
    for (const item of list) {
      const raw = (item && typeof item === 'object') ? item : { level: item };
      const level = typeof raw.level === 'string' && raw.level !== '' ? raw.level : '';
      if (!level) continue;
      const price = journalNum(raw.price);
      const ticks = journalNum(raw.ticksFromEntry);
      const row = { level, price, ticksFromEntry: ticks == null ? null : Math.abs(ticks) };
      const testState = testStateOf(raw.testState);
      if (testState) row.testState = testState;
      const sig = row.level + '|' + row.price + '|' + row.ticksFromEntry + '|' + (row.testState || '');
      if (seen.has(sig)) continue;
      seen.add(sig);
      rows.push(row);
    }
    const detailed = new Set(rows.filter(r => r.price != null || r.ticksFromEntry != null).map(r => r.level));
    return rows.filter(r => r.price != null || r.ticksFromEntry != null || !detailed.has(r.level));
  }

  // Seznam hladin v blízkosti: NONE pryč, řádek s cenou nenese ticky ani stranu,
  // duplicita (typ + cena + strana + ticky) jednou – test/netest z ní doplní první.
  function nearRowsOf(value) {
    const list = Array.isArray(value) ? value : [];
    const rows = [];
    const bySignature = new Map();
    for (const item of list) {
      const raw = (item && typeof item === 'object') ? item : { level: item };
      const level = typeof raw.level === 'string' ? raw.level : '';
      if (!level || level === NONE_KEY) continue;
      const price = journalNum(raw.price);
      const row = { level, price };
      if (price == null && LEGACY_SIDES.includes(raw.legacySide)) {
        const ticks = journalNum(raw.ticksFromEntry);
        row.ticksFromEntry = ticks == null ? null : Math.abs(ticks);
        row.legacySide = raw.legacySide;
      }
      const testState = testStateOf(raw.testState);
      const signature = level + '|' + price + '|' + (row.legacySide || '') + '|' + (row.ticksFromEntry ?? '');
      const same = bySignature.get(signature);
      if (same) {
        if (testState && !same.testState) same.testState = testState;
        continue;
      }
      if (testState) row.testState = testState;
      bySignature.set(signature, row);
      rows.push(row);
    }
    const priced = new Set(rows.filter(r => r.price != null).map(r => r.level));
    return rows.filter(r => r.price != null || r.legacySide || !priced.has(r.level));
  }

  const hasLegacyNearLevels = src => LEGACY_NEAR_KEYS.some(k => src[k] !== undefined);
  const hasNearLevels = src => Array.isArray(src.nearLevels) || src.nearLevelsNone !== undefined;

  // Převod starého tvaru: obě strany v jednom seznamu (cílová první), řádek bez
  // ceny si nese stranu; „žádná" jen když byly „žádná" OBĚ strany.
  function nearLevelsFromLegacy(src) {
    const sides = { TG: legacyRowsOf(src.srTarget), SL: legacyRowsOf(src.srStopLoss) };
    const merged = [];
    for (const side of LEGACY_SIDES) {
      for (const row of sides[side]) merged.push(row.price != null ? row : { ...row, legacySide: side });
    }
    const nearLevels = nearRowsOf(merged);
    const sideNone = (flag, rows) => src[flag] === true || (rows.length > 0 && rows.every(r => r.level === NONE_KEY));
    return {
      nearLevels,
      nearLevelsNone: !nearLevels.length && sideNone('srTargetNone', sides.TG) && sideNone('srStopLossNone', sides.SL)
    };
  }

  function nearLevelsOf(src) {
    if (Array.isArray(src.nearLevels)) return nearRowsOf(src.nearLevels);
    return !hasNearLevels(src) && hasLegacyNearLevels(src) ? nearLevelsFromLegacy(src).nearLevels : [];
  }

  function nearLevelsNoneOf(src) {
    if (hasNearLevels(src)) return src.nearLevelsNone === true && !nearLevelsOf(src).length;
    return hasLegacyNearLevels(src) ? nearLevelsFromLegacy(src).nearLevelsNone : false;
  }

  function ratio(a, b) {
    return a != null && b != null && b > 0 ? round2(a / b) : null;
  }

  const round4 = n => Math.round(n * 10000) / 10000 + 0;

  // Znaménková vzdálenost ceny od vstupu v ticích, + ve směru obchodu. Jen
  // skutečný vstup (ne plánovaný) – jako v deníku.
  function offsetFromEntry(price, out) {
    if (price == null || out.entryPrice == null || out.direction == null) return null;
    const ticks = ticksOf((price - out.entryPrice) * out.direction, out.tickSize);
    return ticks == null ? null : ticks + 0;
  }

  const POSITIONS = ['BEYOND_STOP', 'STOP_TO_ENTRY', 'AT_ENTRY', 'ENTRY_TO_TARGET', 'BEYOND_TARGET'];

  // Geometrie řádku – čistě podle ceny, žádná tolerance ani konstanta v ticích.
  //   fromEntry  + ve směru obchodu; řádek bez ceny ±ticksFromEntry podle strany
  //   fromStop   + na straně vstupu, − za SL
  //   toTarget   + před cílem, − za ním
  //   position   AT_ENTRY jen přesně 0; hladina přímo na SL / na cíli patří do úseku
  function levelGeometry(row, out, targetPrice) {
    const g = { fromEntry: null, fromStop: null, toTarget: null, position: null };
    let fromEntry = null;
    if (row.price != null) fromEntry = offsetFromEntry(row.price, out);
    else if (row.ticksFromEntry != null && row.legacySide === 'TG') fromEntry = Math.abs(row.ticksFromEntry);
    else if (row.ticksFromEntry != null && row.legacySide === 'SL') fromEntry = -Math.abs(row.ticksFromEntry) + 0;
    if (fromEntry == null) return g;
    const stop = offsetFromEntry(out.slPrice, out);
    const target = offsetFromEntry(targetPrice, out);
    g.fromEntry = fromEntry;
    if (stop != null) g.fromStop = round4(fromEntry - stop);
    if (target != null) g.toTarget = round4(target - fromEntry);
    if (fromEntry === 0) g.position = 'AT_ENTRY';
    else if (fromEntry > 0) g.position = g.toTarget == null ? null : (g.toTarget < 0 ? 'BEYOND_TARGET' : 'ENTRY_TO_TARGET');
    else g.position = g.fromStop == null ? null : (g.fromStop < 0 ? 'BEYOND_STOP' : 'STOP_TO_ENTRY');
    return g;
  }

  const BETWEEN_STOP_AND_TARGET = ['STOP_TO_ENTRY', 'AT_ENTRY', 'ENTRY_TO_TARGET'];

  // Dopočty obchodu z geometrie řádků. Bez řádků: „vědomě žádná" = 0 v obou
  // úsecích, nevyplněno = null. Řádek bez polohy = počty v úsecích nejdou.
  function nearLevelMetrics(rows, none, slTicks) {
    const m = { nearestAheadTicks: null, nearestAheadR: null, stopBehindTicks: null, levelsStopToEntry: null, levelsEntryToTarget: null };
    if (!rows.length) {
      if (none) m.levelsStopToEntry = m.levelsEntryToTarget = 0;
      return m;
    }
    const min = list => (list.length ? Math.min(...list) : null);
    m.nearestAheadTicks = min(rows.filter(g => g.position === 'ENTRY_TO_TARGET').map(g => g.fromEntry));
    m.nearestAheadR = ratio(m.nearestAheadTicks, slTicks);
    m.stopBehindTicks = min(rows.filter(g => BETWEEN_STOP_AND_TARGET.includes(g.position) && g.fromStop > 0).map(g => g.fromStop));
    if (rows.every(g => g.position != null)) {
      m.levelsStopToEntry = rows.filter(g => g.position === 'STOP_TO_ENTRY').length;
      m.levelsEntryToTarget = rows.filter(g => g.position === 'ENTRY_TO_TARGET').length;
    }
    return m;
  }

  // Dopočty jednoho obchodu. Pořadí v dni (tradeNoInDay …) doplní až
  // attachJournalContext – potřebuje celý deník.
  function derivedOf(out, targetPrice) {
    const tick = out.tickSize, entry = out.entryPrice;
    const slTicks = entry != null && out.slPrice != null ? ticksOf(Math.abs(entry - out.slPrice), tick) : null;
    return {
      targetTicks: entry != null && targetPrice != null ? ticksOf(Math.abs(targetPrice - entry), tick) : null,
      slTicks,
      ...nearLevelMetrics(out.nearLevels, out.nearLevelsNone, slTicks),
      tradeNoInDay: null, prevResultInDay: null, dayPnlBefore: null
    };
  }

  // Cíl musí ležet na ziskové straně vstupu, SL na ztrátové (obojí striktně).
  // Jen hodnota zadaná ručně – dopočet z výstupu není vstup (SL z trailu do
  // BE+ leží v zisku oprávněně). Bez směru nebo vstupu se nekontroluje nic.
  function dataCheckOf(out, targetPrice) {
    const entry = out.entryPrice != null ? out.entryPrice : out.plannedEntryPrice;
    const dir = out.direction;
    if (entry == null || dir == null) return [];
    const sideWord = dir > 0 ? 'long' : 'short';
    const issues = [];
    if (targetPrice != null && !out.targetLevel1PriceDerived && (targetPrice - entry) * dir <= 0) {
      issues.push({ code: 'TARGET_WRONG_SIDE', message: `Cena targetu ${targetPrice} neleží na ziskové straně vstupu (${sideWord} z ${entry}).` });
    }
    if (out.slPrice != null && out.slDerived !== true && (out.slPrice - entry) * dir >= 0) {
      issues.push({ code: 'SL_WRONG_SIDE', message: `Cena Stop Lossu ${out.slPrice} neleží na ztrátové straně vstupu (${sideWord} z ${entry}).` });
    }
    return issues;
  }

  // Shoda dopočtu Labu s dopočtem deníku. Čísla s tolerancí na zaokrouhlení,
  // „nejde určit" (null) na obou stranách je shoda.
  function sameValue(a, b) {
    const na = a === undefined ? null : a, nb = b === undefined ? null : b;
    if (na === null || nb === null) return na === nb;
    if (typeof na === 'number' && typeof nb === 'number') return Math.abs(na - nb) < 1e-6;
    return na === nb;
  }

  const EXPORT_PRICE_FIELDS = ['targetTicks', 'slTicks', 'nearestAheadTicks', 'nearestAheadR', 'stopBehindTicks', 'levelsStopToEntry', 'levelsEntryToTarget']
    .map(k => [k, k]);
  const EXPORT_DAY_FIELDS = ['tradeNoInDay', 'prevResultInDay', 'dayPnlBefore'];
  const ROW_METRIC_FIELDS = ['fromEntry', 'fromStop', 'toTarget', 'position'];
  // Klíče dopočtů v2 – export z deníku před 4.8.5. Geometrii hladin nenese.
  const OLD_EXPORT_KEYS = ['pathState', 'firstObstacleTicks', 'freePathR', 'slBufferTicks', 'slZoneCount', 'srTarget', 'srStopLoss'];

  function compareExported(out, pairs, list) {
    const ex = out.exported;
    for (const [labKey, exportKey] of pairs) {
      if (!Object.prototype.hasOwnProperty.call(ex, exportKey)) continue;
      if (!sameValue(out.derived[labKey], ex[exportKey])) list.push({ field: exportKey, lab: out.derived[labKey], exported: ex[exportKey] });
    }
  }

  // Jen kde to Lab umí ověřit: bez dopočtů v exportu (starší deník) není co
  // porovnat, bez známého ticku (v deníku ho dává šablona instrumentu) Lab
  // nepočítá – to není nesoulad, jen „nejde ověřit" (derivedUnverified).
  function derivedMismatchOf(out) {
    const list = [];
    if (!out.exported || out.tickSize == null) return list;
    compareExported(out, EXPORT_PRICE_FIELDS, list);
    // Řádky: derived.nearLevels[i] patří k i-tému řádku po převodu deníku.
    const exportedRows = Array.isArray(out.exported.nearLevels) ? out.exported.nearLevels : null;
    if (!exportedRows) return list;
    if (exportedRows.length !== out.nearLevels.length) {
      list.push({ field: 'nearLevels (počet řádků)', lab: out.nearLevels.length, exported: exportedRows.length });
    }
    for (const row of out.nearLevels) {
      const ex = exportedRows[row.index];
      if (!ex || typeof ex !== 'object') continue;
      for (const key of ROW_METRIC_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(ex, key) && !sameValue(row[key], ex[key])) {
          list.push({ field: `nearLevels[${row.index}].${key}`, lab: row[key], exported: ex[key] });
        }
      }
    }
    return list;
  }

  // Do pořadí v dni patří jen skutečně naplněné obchody (ne setup bez vstupu,
  // ne hypotetický NO_FILL / MISSED / SKIPPED); „naživo bych nevzal" ano.
  function countsInDay(r) {
    return !!r.date && !r.isSetupOnly && (!r.fillStatus || r.fillStatus === 'FILLED');
  }

  // pnlRaw má přednost; bez něj znaménko podle výsledku (pnl je v exportu
  // absolutní hodnota).
  function signedPnlOf(r) {
    if (r.pnlRaw != null) return r.pnlRaw;
    if (r.result === 'breakeven') return 0;
    return r.result === 'target' ? (r.pnl || 0) : -(r.pnl || 0);
  }

  // Co jde spočítat jen přes celý deník: pořadí obchodu v dni, výsledek
  // předchozího a P/L dne před ním (počítá se při čtení – po smazání obchodu
  // se přepočítá samo) a kontext dne, který se připojí ke každému záznamu
  // dne. Bere VŠECHNY záznamy deníku, ne výběr po filtrech pohledu.
  function attachJournalContext(records, dayNotes) {
    const notes = dayNotes && typeof dayNotes === 'object' ? dayNotes : {};
    const byDay = new Map();
    for (const r of records) {
      if (!countsInDay(r)) continue;
      if (!byDay.has(r.date)) byDay.set(r.date, []);
      byDay.get(r.date).push(r);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => String(a.entryTime || '').localeCompare(String(b.entryTime || '')) || String(a.id || '').localeCompare(String(b.id || '')));
      let before = 0;
      list.forEach((r, i) => {
        r.derived.tradeNoInDay = i + 1;
        r.derived.prevResultInDay = i ? (list[i - 1].result || null) : 'FIRST';
        r.derived.dayPnlBefore = round2(before);
        before += signedPnlOf(r);
      });
    }
    for (const r of records) {
      if (r.exported) compareExported(r, EXPORT_DAY_FIELDS.map(k => [k, k]), r.derivedMismatch);
      const note = r.date && Object.prototype.hasOwnProperty.call(notes, r.date) ? notes[r.date] : null;
      const day = note && typeof note === 'object' && note.dayContext && typeof note.dayContext === 'object' ? note.dayContext : null;
      r.hasDayContext = !!day;
      for (const field of CONTEXT_V2_FIELDS) {
        if (field.source === 'day') r.ctx[field.key] = ctxOf(day ? day[field.key] : null, field.none);
      }
    }
    return records;
  }

  // Kontextová pole, která obchod nemá vyplněná – stejná definice jako
  // FJTaxonomy.missingContextKeys v deníku 4.8.2 (R2.6), aby „Neúplné · N"
  // v deníku a „chybí" v Labu seděly. Rozdíl: klíč se neověřuje proti
  // slovníku (Lab nezná uživatelské volby deníku) – neznámý klíč hlásí
  // zdraví dat zvlášť. Nastavení karet (FJ_tradeCards) se NEPŘEBÍRÁ.
  // Z kontextu v2 úplnost blokují jen trend 30m a známka – ostatní nová pole
  // ne, ať „Neúplné" nezčervená celý deník najednou. Hladiny v blízkosti jako
  // v deníku 4.8.5: aspoň jeden řádek, nebo „žádná hladina v blízkosti".
  const CONTEXT_KEYS = [
    'setupCode', 'fillStatus', 'trend', 'entryLevels', 'nearLevels', 'ofConfirm', 'trendHtf', 'grade',
    'targetLevel1', 'slPrice', 'mfeTicks', 'maeTicks', 'postExitFavorableTicks', 'postExitAdverseTicks'
  ];
  const COURSE_KEYS = ['slPrice', 'mfeTicks', 'maeTicks', 'postExitFavorableTicks', 'postExitAdverseTicks'];

  function missingContextKeysOf(out, src) {
    if (out.isSetupOnly) return [];
    const missing = [];
    if (!out.setupCode) missing.push('setupCode');
    if (!out.fillStatus) missing.push('fillStatus');
    if (!out.trend) missing.push('trend');
    if (!out.entryLevels.length) missing.push('entryLevels');
    if (!out.nearLevels.length && !out.nearLevelsNone) missing.push('nearLevels');
    if (!out.ofConfirm.length) missing.push('ofConfirm');
    if (!out.trendHtf) missing.push('trendHtf');
    if (!out.grade) missing.push('grade');
    if (!out.targetLevel1 || !out.targetLevel1.type || out.targetLevel1.price == null) missing.push('targetLevel1');
    // Nenaplněný / vynechaný setup vyplněný jako celý hypotetický obchod (má
    // výstupní cenu) se posuzuje jako naplněný.
    if (!out.fillStatus || out.fillStatus === 'FILLED' || out.exitPrice != null) {
      for (const key of COURSE_KEYS) if (numberOrNull(src[key]) == null) missing.push(key);
    }
    return missing;
  }

  // Klíče, které výchozí slovníky deníku neznají (R2.7). Zobrazí se tak, jak
  // přišly; tady se jen sbírají.
  function unknownKeysOf(out) {
    const found = [];
    const check = (field, key) => {
      const vocab = L.FIELD_VOCABULARY[field];
      if (key && vocab && !L.isKnown(vocab, key)) found.push({ field, key });
    };
    for (const field of ['setupCode', 'trend', 'fillStatus', 'wouldSkipReason', 'maxLevel',
      'trendHtf', 'grade', 'absLocation', 'entryTestNo']) check(field, out[field]);
    for (const field of LIST_FIELDS) for (const key of out[field]) check(field, key);
    for (const row of out.nearLevels) check('nearLevels', row.level);
    for (const field of ['targetLevel1', 'targetLevel2']) if (out[field]) check(field, out[field].type);
    return found;
  }

  // Systémová pole: identifikátory, časová razítka a technické údaje importu.
  // Příznaky PŮVODU hodnoty (…Source, …Derived) sem NEPATŘÍ – analýza je
  // potřebuje (R2.1).
  const SYSTEM_FIELDS = new Set([
    'id', 'journalId', 'recordType', 'createdAt', 'updatedAt',
    'sourceEventId', 'sourceEventIds', 'positionId', 'externalAccount',
    'imageCount', 'legs', 'lastLegExitPrice', 'legacyPointsConvention'
  ]);

  function normalizeRecord(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { raw: src };

    for (const key of TEXT_FIELDS) out[key] = textOrNull(src[key]);
    for (const key of NUMBER_FIELDS) out[key] = numberOrNull(src[key]);
    for (const key of PRICE_FIELDS) out[key] = numberOrNull(src[key]);
    for (const key of BOOL_FIELDS) out[key] = boolOrNull(src[key]);
    for (const key of LIST_FIELDS) out[key] = listOf(src[key]);

    out.tickSize = tickSizeOf(out.instrument);
    out.entryLevelsState = levelStateOf(out.entryLevels, false);
    out.ofConfirmState = levelStateOf(out.ofConfirm, false);

    out.targetLevel1 = targetLevelOf(src.targetLevel1);
    out.targetLevel2 = targetLevelOf(src.targetLevel2);
    out.targetLevel1PriceDerived = src.targetLevel1PriceDerived === true;
    out.plannedTarget = plannedTargetOf(out.targetLevel1, src.targetLevel1PriceDerived);
    // Vzdálenost plánovaného cíle od vstupu v ticích (přesný přepočet ceny).
    out.plannedTargetTicks = out.plannedTarget && out.plannedTarget.price != null && out.entryPrice != null && out.tickSize > 0
      ? roundTicks(Math.abs(out.plannedTarget.price - out.entryPrice) / out.tickSize)
      : null;

    // ---- kontext v3: hladiny v blízkosti a jejich geometrie, dopočty obchodu,
    // kontrola dat, tři stavy polí
    out.direction = directionOf(out.side);
    const targetPrice = out.targetLevel1 ? out.targetLevel1.price : null;
    out.nearLevels = nearLevelsOf(src).map((row, index) => ({
      level: row.level,
      price: row.price,
      testState: row.testState || null,
      legacySide: row.legacySide || null,
      ticksFromEntry: row.ticksFromEntry != null ? row.ticksFromEntry : null,
      index,
      ...levelGeometry(row, out, targetPrice)
    }));
    out.nearLevelsNone = nearLevelsNoneOf(src);
    // Tři stavy, nikdy dva: nevyplněno NIKDY nespadne do „vědomě žádná".
    out.nearLevelsState = out.nearLevels.length ? 'present' : out.nearLevelsNone ? 'none' : 'unknown';
    out.derived = derivedOf(out, targetPrice);
    out.exported = src.derived && typeof src.derived === 'object' && !Array.isArray(src.derived) ? src.derived : null;
    out.exportedOldShape = !!out.exported && !Array.isArray(out.exported.nearLevels) && OLD_EXPORT_KEYS.some(k => k in out.exported);
    out.derivedMismatch = derivedMismatchOf(out);
    out.derivedUnverified = !!out.exported && out.tickSize == null;
    out.dataCheck = dataCheckOf(out, targetPrice);

    out.ctx = {};
    for (const field of CONTEXT_V2_FIELDS) {
      let value = null;
      if (field.source === 'trade') value = out[field.key];
      else if (field.source === 'export') value = out.exported ? out.exported[field.key] : null;
      // 'day' doplní attachJournalContext – bez deníku je kontext dne nevyplněný.
      out.ctx[field.key] = ctxOf(value, field.none);
    }
    out.hasDayContext = false;
    // Známka: deník neumí ověřit, že vznikla před vstupem. „Změněno dodatečně"
    // (gradeEdited) a „doplněno zpětně" (gradeRetro, dopočet deníku – v backtestu
    // null = nejde ověřit) jdou v analýze stranou.
    out.gradeEdited = src.gradeEdited === true;
    out.gradeRetro = out.exported ? boolOrNull(out.exported.gradeRetro) : null;
    out.gradeOrigin = !out.grade ? null : out.gradeEdited ? 'edited' : out.gradeRetro === true ? 'retro' : 'clean';

    out.isSetupOnly = src.recordType === 'SETUP_ONLY';
    out.isTrade = !out.isSetupOnly;
    out.isLegacy = src.legacyPointsConvention === true;
    out.isStopped = out.result === 'stoploss';
    // Chybějící pole = obchod bych vzal i naživo.
    out.wouldSkipLive = src.wouldSkipLive === true;
    out.hasWouldSkipLiveField = Object.prototype.hasOwnProperty.call(src, 'wouldSkipLive');
    out.isLiveEligible = !out.wouldSkipLive;
    // Hypotetický výsledek: obchod s cenami a P/L, který se ale nenaplnil
    // nebo byl vědomě vynechaný – „co by to udělalo". Není to exekuce.
    out.hypotheticalGroup = hypotheticalGroupOf(out);
    out.isHypothetical = out.hypotheticalGroup != null;
    out.isExecuted = out.isTrade && !out.isHypothetical;

    out.rSigned = signedR(out.rMultiple, out.exitTicks);
    // „Ziskový" podle ticků, ne podle pnlRaw: u BE obchodu bývá exitTicks > 0
    // a pnlRaw < 0 jen kvůli komisi.
    out.isProfitable = out.exitTicks == null ? null : out.exitTicks > 0;
    out.entryMinutes = minutesOf(out.entryTime);

    // ---- MFE / MAE: původ a naměřená hodnota (R2.3, zadání fáze 2 §1.1)
    out.mfe = excursionOf(src.mfeTicks, src.mfeTicksSource, src.mfeTicksDerived);
    out.mae = excursionOf(src.maeTicks, src.maeTicksSource, src.maeTicksDerived);
    out.mfeMeasured = measured(out.mfe);
    out.maeMeasured = measured(out.mae);

    // Nejdál ve směru / proti směru OD VSTUPU, jen z naměřených složek:
    // MFE/MAE během obchodu + pohyb po výstupu (zapsaný ručně = měření,
    // výstupní cena = fakt exekuce). Dopočtené MFE/MAE se nepoužije.
    //
    // Maximum je známé, jen když je známý i průběh BĚHEM obchodu – samotný
    // pohyb po výstupu by ho podhodnotil (u targetu by vyšlo „nechané na
    // stole 0", u vítěze bez MAE „cena nešla proti ani o tick"):
    //  - ve směru: naměřené MFE, nebo target (výstup na cíli = nejdál, kam
    //    obchod během držení došel – fakt exekuce) s ZAPSANÝM pokračováním
    //  - proti: naměřené MAE, nebo stopnutý obchod (výstup na SL = fakt)
    const exitT = out.exitTicks;
    const fav = out.postExitFavorableTicks != null ? Math.abs(out.postExitFavorableTicks) : null;
    const adv = out.postExitAdverseTicks != null ? Math.abs(out.postExitAdverseTicks) : null;
    const isTarget = out.result === 'target';
    const favParts = [];
    if (out.mfeMeasured != null) favParts.push(out.mfeMeasured);
    if (fav != null && exitT != null && (out.mfeMeasured != null || isTarget)) favParts.push(roundTicks(exitT + fav));
    out.maxFavorableMeasured = favParts.length ? Math.max(0, ...favParts) : null;

    const advParts = [];
    const inTradeAdverseKnown = out.maeMeasured != null || (out.isStopped && exitT != null && exitT < 0);
    if (out.maeMeasured != null) advParts.push(out.maeMeasured);
    // Stopnutý obchod došel proti pozici nejméně na výstupní cenu – fakt exekuce.
    if (out.isStopped && exitT != null && exitT < 0) advParts.push(Math.abs(exitT));
    if (inTradeAdverseKnown && adv != null && exitT != null) advParts.push(roundTicks(adv - exitT));
    out.maxAdverseMeasured = advParts.length ? Math.max(0, ...advParts) : null;
    out.adverseObservedAfterExit = adv != null;

    // Protipohyb rozhodující pro SL sweep: u obchodu, který neskončil na SL,
    // rozhoduje MAE během obchodu (po výstupu pozice neexistovala). U
    // stopnutého obchodu jde o to, kam cena došla za stopkou → maxAdverse.
    out.slSweepAdverse = out.isStopped ? out.maxAdverseMeasured : out.maeMeasured;

    out.missingContext = missingContextKeysOf(out, src);
    out.unknownKeys = unknownKeysOf(out);

    // Vyplněnost každého surového pole (P/L pole u SETUP_ONLY, kontrola 10).
    out.filled = {};
    for (const key of Object.keys(src)) {
      if (!SYSTEM_FIELDS.has(key)) out.filled[key] = !isEmpty(src[key]);
    }
    return out;
  }

  // Celý soubor ai-exportu: { journalId, updatedAt, taxonomy, trades:[…], dayNotes:{…} }.
  // taxonomy (deník 4.7.4+) = úprava slovníků deníku; nastaví se dřív než
  // záznamy, ať unknownKeys znají vlastní volby. Bez ní = jen výchozí slovníky.
  // Všechny záznamy jednoho deníku: normalizeRecord + to, co jde jen přes celý
  // deník (pořadí v dni, kontext dne).
  function normalizeRecords(rawTrades, dayNotes) {
    return attachJournalContext((Array.isArray(rawTrades) ? rawTrades : []).map(normalizeRecord), dayNotes);
  }

  function normalizeExport(json) {
    const data = json && typeof json === 'object' ? json : {};
    const dayNotes = data.dayNotes && typeof data.dayNotes === 'object' ? data.dayNotes : {};
    L.applyJournalTaxonomy(data.taxonomy);
    return {
      journalId: textOrNull(data.journalId),
      updatedAt: textOrNull(data.updatedAt),
      records: normalizeRecords(data.trades, dayNotes),
      dayNotes
    };
  }

  return {
    NUMBER_FIELDS,
    PRICE_FIELDS,
    SYSTEM_FIELDS,
    CONTEXT_KEYS,
    CONTEXT_V2_FIELDS,
    TEST_STATES,
    TICK_SIZES,
    ticksOf,
    normalizeRecords,
    numberOrNull,
    textOrNull,
    isEmpty,
    tickSizeOf,
    POSITIONS,
    nearLevelsOf,
    nearLevelsNoneOf,
    levelStateOf,
    targetLevelOf,
    plannedTargetOf,
    excursionOf,
    minutesOf,
    signedR,
    inPerformance,
    normalizeRecord,
    normalizeExport
  };
}));
