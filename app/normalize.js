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
//  - srTarget / srStopLoss jsou řádky { level, price, ticksFromEntry }; starý
//    tvar (pole klíčů) se čte taky. „Žádná hladina v cestě" má dva zápisy:
//    příznak srTargetNone / srStopLossNone a řádek s level 'NONE'
//  - DOPOČÍTANÁ HODNOTA NENÍ MĚŘENÍ: mfeTicksDerived / maeTicksDerived jsou
//    dopočtené z výstupní ceny (u targetu je dopočtené MFE z definice rovno
//    exitTicks). Do výpočtů fáze 2 vstupuje jen *Measured
//  - od deníku 4.7.3 může TRADE (bez recordType) nést fillStatus NO_FILL /
//    MISSED / SKIPPED s výstupem a P/L = hypotetický výsledek, ne exekuce
//    (hypotheticalGroup, inPerformance)
//  - prázdná hodnota je null nebo "" – NULA JE PLATNÉ MĚŘENÍ („cena nešla ani
//    o tick", u postExitFavorableTicks „dál už nic nebylo")
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
    'externalAccount', 'mfeTicksSource', 'maeTicksSource'
  ];
  const LIST_FIELDS = ['entryLevels', 'ofConfirm'];
  const LEVEL_ROW_FIELDS = ['srTarget', 'srStopLoss'];
  const NONE_FLAG_OF = { srTarget: 'srTargetNone', srStopLoss: 'srStopLossNone' };
  const NONE_KEY = 'NONE';

  // Velikost ticku podle instrumentu. Jen pro převod ceny SR hladiny na ticky
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

  function tickSizeOf(instrument) {
    const key = textOrNull(instrument);
    return key && Object.prototype.hasOwnProperty.call(TICK_SIZES, key.toUpperCase()) ? TICK_SIZES[key.toUpperCase()] : null;
  }

  function roundTicks(v) {
    return Math.round(v * 1000) / 1000;
  }

  // Řádek SR hladiny. Starý tvar (holý klíč) → řádek bez ceny a vzdálenosti.
  // distanceTicks: zapsaná vzdálenost od vstupu, jinak přesný přepočet ceny
  // přes velikost ticku. Nic jiného se nedopočítává.
  function levelRowsOf(value, entryPrice = null, tickSize = null) {
    if (!Array.isArray(value)) return [];
    const rows = [];
    for (const item of value) {
      let row = null;
      if (typeof item === 'string') {
        const level = textOrNull(item);
        if (level) row = { level, price: null, ticksFromEntry: null };
      } else if (item && typeof item === 'object') {
        row = {
          level: textOrNull(item.level),
          price: numberOrNull(item.price),
          ticksFromEntry: numberOrNull(item.ticksFromEntry)
        };
        if (!row.level && row.price == null && row.ticksFromEntry == null) row = null;
      }
      if (!row) continue;
      row.isNone = row.level === NONE_KEY;
      let d = row.ticksFromEntry != null ? Math.abs(row.ticksFromEntry) : null;
      if (d == null && row.price != null && entryPrice != null && tickSize > 0) {
        d = roundTicks(Math.abs(row.price - entryPrice) / tickSize);
      }
      row.distanceTicks = row.isNone ? null : d;
      rows.push(row);
    }
    return rows;
  }

  function levelRowHasPlace(row) {
    return !!row && (row.price != null || row.ticksFromEntry != null);
  }

  // Tři stavy, nikdy dva (zadání fáze 2 §1.2):
  //   'present' – aspoň jeden řádek se skutečnou hladinou
  //   'none'    – vědomě žádná hladina: příznak, nebo řádky jsou samé 'NONE'
  //   'unknown' – nevyplněno: žádné řádky a žádný příznak
  // Skutečná hladina má přednost před příznakem (deník příznak k řádkům
  // neukládá; kdyby se to stalo, data o hladině jsou silnější informace).
  // 'unknown' NIKDY nespadne do 'none'.
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

  // Kontextová pole, která obchod nemá vyplněná – stejná definice jako
  // FJTaxonomy.missingContextKeys v deníku 4.7.1 (R2.6), aby „Neúplné · N"
  // v deníku a „chybí" v Labu seděly. Rozdíl: klíč se neověřuje proti
  // slovníku (Lab nezná uživatelské volby deníku) – neznámý klíč hlásí
  // zdraví dat zvlášť. Nastavení karet (FJ_tradeCards) se NEPŘEBÍRÁ.
  const CONTEXT_KEYS = [
    'setupCode', 'fillStatus', 'trend', 'entryLevels', 'srTarget', 'srStopLoss', 'ofConfirm',
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
    if (!out.srTarget.length && src.srTargetNone !== true) missing.push('srTarget');
    if (!out.srStopLoss.length && src.srStopLossNone !== true) missing.push('srStopLoss');
    if (!out.ofConfirm.length) missing.push('ofConfirm');
    if (!out.targetLevel1 || !out.targetLevel1.type || out.targetLevel1.price == null) missing.push('targetLevel1');
    if (!out.fillStatus || out.fillStatus === 'FILLED') {
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
    for (const field of ['setupCode', 'trend', 'fillStatus', 'wouldSkipReason', 'maxLevel']) check(field, out[field]);
    for (const field of LIST_FIELDS) for (const key of out[field]) check(field, key);
    for (const field of LEVEL_ROW_FIELDS) for (const row of out[field]) check(field, row.level);
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
    const entryForLevels = out.entryPrice != null ? out.entryPrice : out.plannedEntryPrice;
    for (const key of LEVEL_ROW_FIELDS) out[key] = levelRowsOf(src[key], entryForLevels, out.tickSize);

    // „Žádná hladina" – jedna odpověď ze dvou zápisů.
    out.srTargetState = levelStateOf(out.srTarget, src[NONE_FLAG_OF.srTarget]);
    out.srStopLossState = levelStateOf(out.srStopLoss, src[NONE_FLAG_OF.srStopLoss]);
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
    CONTEXT_KEYS,
    TICK_SIZES,
    numberOrNull,
    textOrNull,
    isEmpty,
    tickSizeOf,
    levelRowsOf,
    levelRowHasPlace,
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
