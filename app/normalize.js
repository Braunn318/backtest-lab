'use strict';
// Předzpracování záznamu z ai-exportu deníku – JEDINÉ místo v Labu.
//
// PROČ JEDNO MÍSTO: v deníku se už jednou rozešly dvě verze téhož výpočtu
// (body na kontrakt vs. body celkem). Každá analýza (zdraví dat teď, SL sweep
// a mřížka ve fázi 2) proto čte jen výstup normalizeRecord a nikdy si znovu
// nepočítá nic ze surového záznamu. Chybí-li odvozená veličina, přidá se sem
// i s testem, ne do analýzy.
//
// Tvar dat je ověřený proti exportu k 29. 9. 2026, ne podle specu z 13. 9.:
//  - TRADE nemá pole recordType (TRADE = jeho absence), setup má 'SETUP_ONLY'
//  - entryPrice / exitPrice jsou u nových záznamů STRINGY, u starých čísla
//  - rMultiple je BEZ ZNAMÉNKA (pointsPerContract / slPoints), stoploss = +1;
//    znaménko nese exitTicks
//  - srTarget / srStopLoss: dřív pole klíčů, deník 4.7.0 je převádí na řádky
//    { level, price, ticksFromEntry } – čtou se oba tvary
//  - prázdná hodnota je null nebo "" – NULA JE PLATNÉ MĚŘENÍ („cena nešla ani
//    o tick", u postExitFavorableTicks „dál už nic nebylo") a nesmí splynout
//    s chybějícím údajem
//
// Modul se načítá přes <script src> v okně i přes require() v Node testech.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabNormalize = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Veličiny, se kterými se počítá. Vše v ticích, bodech, minutách nebo měně;
  // "" / null / nečíslo → null, 0 zůstává 0.
  const NUMBER_FIELDS = [
    'exitTicks', 'slTicks', 'slPoints', 'mfeTicks', 'maeTicks',
    'maxFavorableTicks', 'maxAdverseTicks', 'maxTicks',
    'postExitFavorableTicks', 'postExitAdverseTicks', 'observedMinutes',
    'rMultiple', 'points', 'pointsPerContract', 'pointsTotal',
    'pnl', 'pnlRaw', 'grossPnl', 'commission', 'contracts',
    'missedByTicks', 'confluenceCount'
  ];
  const PRICE_FIELDS = ['entryPrice', 'exitPrice', 'slPrice', 'plannedEntryPrice', 'lastLegExitPrice'];
  const BOOL_FIELDS = ['touchedEntry', 'touchedSl', 'postExitAdverseFirst', 'slDerived'];
  const TEXT_FIELDS = [
    'id', 'date', 'entryTime', 'exitTime', 'instrument', 'side', 'result',
    'setupCode', 'fillStatus', 'trend', 'maxLevel', 'reason', 'wouldSkipReason'
  ];
  const LIST_FIELDS = ['entryLevels', 'ofConfirm'];
  const LEVEL_ROW_FIELDS = ['srTarget', 'srStopLoss'];

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

  // Řádek SR hladiny. Starý tvar (holý klíč) → řádek bez ceny a vzdálenosti;
  // nic se nedopočítává.
  function levelRowsOf(value) {
    if (!Array.isArray(value)) return [];
    const rows = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const level = textOrNull(item);
        if (level) rows.push({ level, price: null, ticksFromEntry: null });
      } else if (item && typeof item === 'object') {
        const row = {
          level: textOrNull(item.level),
          price: numberOrNull(item.price),
          ticksFromEntry: numberOrNull(item.ticksFromEntry)
        };
        if (row.level || row.price != null || row.ticksFromEntry != null) rows.push(row);
      }
    }
    return rows;
  }

  function levelRowHasPlace(row) {
    return !!row && (row.price != null || row.ticksFromEntry != null);
  }

  function targetLevelOf(value) {
    if (!value || typeof value !== 'object') return null;
    const type = textOrNull(value.type);
    const price = numberOrNull(value.price);
    if (type == null && price == null) return null;
    return { type, price };
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

  // Systémová pole: identifikátory, časová razítka a technické příznaky
  // importu. Do úplnosti polí nepatří – nic o obchodu neříkají.
  const SYSTEM_FIELDS = new Set([
    'id', 'journalId', 'recordType', 'createdAt', 'updatedAt',
    'sourceEventId', 'sourceEventIds', 'positionId', 'externalAccount',
    'imageCount', 'legs', 'lastLegExitPrice', 'legacyPointsConvention',
    'mfeTicksSource', 'maeTicksSource', 'mfeTicksDerived', 'maeTicksDerived', 'slDerived'
  ]);

  function normalizeRecord(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { raw: src };

    for (const key of TEXT_FIELDS) out[key] = textOrNull(src[key]);
    for (const key of NUMBER_FIELDS) out[key] = numberOrNull(src[key]);
    for (const key of PRICE_FIELDS) out[key] = numberOrNull(src[key]);
    for (const key of BOOL_FIELDS) out[key] = boolOrNull(src[key]);
    for (const key of LIST_FIELDS) out[key] = listOf(src[key]);
    for (const key of LEVEL_ROW_FIELDS) out[key] = levelRowsOf(src[key]);
    out.targetLevel1 = targetLevelOf(src.targetLevel1);
    out.targetLevel2 = targetLevelOf(src.targetLevel2);

    out.isSetupOnly = src.recordType === 'SETUP_ONLY';
    out.isTrade = !out.isSetupOnly;
    out.isLegacy = src.legacyPointsConvention === true;
    // Chybějící pole = obchod bych vzal i naživo (pole do deníku teprve přibývá).
    out.wouldSkipLive = src.wouldSkipLive === true;
    out.hasWouldSkipLiveField = Object.prototype.hasOwnProperty.call(src, 'wouldSkipLive');
    out.isLiveEligible = !out.wouldSkipLive;

    out.rSigned = signedR(out.rMultiple, out.exitTicks);
    // „Ziskový" podle ticků, ne podle pnlRaw: u BE obchodu bývá exitTicks > 0
    // a pnlRaw < 0 jen kvůli komisi.
    out.isProfitable = out.exitTicks == null ? null : out.exitTicks > 0;
    out.entryMinutes = minutesOf(out.entryTime);

    // Vyplněnost každého surového pole (pro úplnost polí).
    out.filled = {};
    for (const key of Object.keys(src)) {
      if (!SYSTEM_FIELDS.has(key)) out.filled[key] = !isEmpty(src[key]);
    }
    return out;
  }

  // Celý soubor ai-exportu: { journalId, updatedAt, trades:[…], dayNotes:{…} }.
  function normalizeExport(json) {
    const data = json && typeof json === 'object' ? json : {};
    const trades = Array.isArray(data.trades) ? data.trades : [];
    return {
      journalId: textOrNull(data.journalId),
      updatedAt: textOrNull(data.updatedAt),
      records: trades.map(normalizeRecord),
      dayNotes: data.dayNotes && typeof data.dayNotes === 'object' ? data.dayNotes : {}
    };
  }

  return {
    NUMBER_FIELDS,
    PRICE_FIELDS,
    SYSTEM_FIELDS,
    numberOrNull,
    textOrNull,
    isEmpty,
    levelRowsOf,
    levelRowHasPlace,
    targetLevelOf,
    minutesOf,
    signedR,
    normalizeRecord,
    normalizeExport
  };
}));
