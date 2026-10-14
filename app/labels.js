'use strict';
// Popisky klíčů. Lab má vlastní mapu klíč → popisek, převzatou z VÝCHOZÍCH
// slovníků deníku (repo_clone/app/taxonomy.js, stav 11. 10. 2026 – deník 4.8.2
// včetně klíčů a polí kontextu v2). Od deníku
// 4.7.4 nese export i úpravu slovníků deníku (`taxonomy`, revize R2.7):
// vlastní volby (CUSTOM_…) a přejmenování se přes ni přidají nahoru
// (applyJournalTaxonomy, volá ji normalizeExport). Starší export ji nemá –
// pak platí jen výchozí slovníky.
//
// Neznámý klíč se zobrazí tak, jak přišel – nikdy se neskrývá – a zdraví dat
// ho nahlásí. Lab ho neopravuje, nezapisuje.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabLabels = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const SETUP = {
    M2_OF: 'M2 + Order Flow',
    M2_PA: 'M2 – čistá price action',
    M2_TREND: 'M2 v trendu',
    M2_DELTA: 'M2 + změna delty',
    M2_STRUCTURE: 'M2 – změna struktury od high/low dne',
    REVERSAL_CANDLE: 'Obrat setup – dlouhá svíce',
    DELTA_CHANGE: 'Změna delty',
    BREAK_IB_PA: 'Break IB – price action',
    BREAK_IB_OF: 'Break IB – s order flow',
    BREAK_IB_FX: 'Break IB na FX (4h swing)',
    AVE: 'AVE Pattern',
    IB_VPOC_GAP: 'IB+VPOC – hrana 123 gapu',
    IB_VPOC_VWAP_TEST: 'IB+VPOC – 1. test VWAP',
    IB_VPOC_VWAP_RETEST: 'IB+VPOC – retest proraženého VWAP',
    IB_VPOC_LQ2: 'IB+VPOC – výkop 2 likvidit',
    IB_VPOC_LQ_RANGE: 'IB+VPOC – výkop LQ range',
    IB_VPOC_TREND: 'IB+VPOC – v trendu do levelu',
    IB_VPOC_AVE_LONG: 'IB+VPOC – AVE dlouhá do levelu',
    M2HL: 'Metoda 2HL',
    SCALP_OF: 'Scalping – OF setup',
    OTHER: 'Jiný / mimo strategii'
  };

  // Hladiny – sdílí je hladina vstupu i hladiny v blízkosti (NEAR_LEVEL v deníku).
  const ENTRY_LEVEL = {
    LIQUIDITY: 'Likvidita',
    VPOC_DAY: 'VPOC dne',
    VPOC_30M: 'VPOC 30M',
    VPOC_1M: 'VPOC 1M',
    VPOC_IB: 'VPOC IB',
    VPOC_CANDLE: 'VPOC svíce',
    VAH: 'VAH',
    VAL: 'VAL',
    VWAP: 'VWAP',
    VWAP_DEV: 'VWAP odchylka',
    M2_EDGE: 'Hrana M2',
    IB_EDGE: 'Hrana IB',
    GAP_EDGE: 'Hrana gapu',
    LTA_LEVEL: 'LTA hladina',
    PDH_PDL: 'PDH / PDL',
    ONH_ONL: 'ONH / ONL',
    NONE: 'Žádná hladina',
    // Kontext v2 (deník 4.8.1) – přidané výchozí klíče.
    VPOC_PREV_DAY: 'VPOC předchozího dne',
    VAH_PREV: 'VAH předchozího dne',
    VAL_PREV: 'VAL předchozího dne',
    VWAP_DEV1: 'VWAP odchylka 1',
    VWAP_DEV2: 'VWAP odchylka 2',
    HVN: 'HVN',
    LVN: 'LVN',
    HOD_LOD: 'HOD / LOD'
  };

  const OF_CONFIRM = {
    ABS_BID: 'Absorpce na bidu',
    ABS_ASK: 'Absorpce na asku',
    IMBALANCE: 'Imbalance',
    DELTA_CHANGE: 'Změna delty',
    MEGA_BID: 'Mega bid',
    MEGA_ASK: 'Mega ask',
    PATTERN_0x1: 'Pattern 0x1',
    PATTERN_1x0: 'Pattern 1x0',
    HIGH_VOLUME: 'Vysoký objem',
    CLOSE_VS_VPOC_OK: 'Uzavření vůči VPOC v pořádku',
    NONE: 'Bez potvrzení'
  };

  const TREND = { LONG: 'Long', SHORT: 'Short', RANGE: 'Range' };

  const FILL_STATUS = {
    FILLED: 'naplněno',
    NO_FILL: 'limitka se nenaplnila',
    MISSED: 'setup byl, nestihl jsem',
    SKIPPED: 'setup byl, vědomě vynechán'
  };

  const TARGET_LEVEL = {
    LIQUIDITY: 'Likvidita',
    VPOC_DAY: 'VPOC dne',
    VPOC_30M: 'Netestovaný VPOC 30min svíce',
    VPOC_1M: 'VPOC 1M svíce',
    VAH: 'VAH',
    VAL: 'VAL',
    VWAP: 'VWAP',
    LVN: 'LVN',
    GAP_EDGE: 'Hrana gapu',
    LTA_LEVEL: 'LTA hladina',
    TRAIL_M2: 'Trail podle 1min M2',
    MANUAL_EXIT: 'Ruční výstup bez hladiny',
    // Kontext v2 (deník 4.8.1) – přidané výchozí klíče.
    VPOC_PREV_DAY: 'VPOC předchozího dne',
    VPOC_IB: 'VPOC IB',
    VAH_PREV: 'VAH předchozího dne',
    VAL_PREV: 'VAL předchozího dne',
    VWAP_DEV1: 'VWAP odchylka 1',
    VWAP_DEV2: 'VWAP odchylka 2',
    HVN: 'HVN',
    HOD_LOD: 'HOD / LOD',
    M2_EDGE: 'Hrana M2',
    IB_EDGE: 'Hrana IB',
    PDH_PDL: 'PDH / PDL',
    ONH_ONL: 'ONH / ONL'
  };

  const SKIP_REASON = {
    LIQUIDITY_SWEPT: 'Velký výběr likvidity proti směru',
    SR_IN_WAY: 'SR zóna / hladina v cestě',
    CONTEXT: 'Kontext neseděl',
    TOO_LATE: 'Pozdě, cena už odjela',
    LOW_CONVICTION: 'Slabý signál, nedůvěra',
    RISK_RULE: 'Riziko / denní limit',
    OTHER: 'Jiný důvod'
  };

  // ---- kontext v2 (deník 4.8.1+). Názvy skupin jako v deníku, ať přejmenování
  // z `taxonomy` v exportu platí i tady.
  const TREND_HTF = { UP: 'Nahoru', DOWN: 'Dolů', RANGE: 'Range' };
  const ABS_LOCATION = { EXTREME: 'Na extrému', MIDDLE: 'Uprostřed', NONE: 'Bez absorpce' };
  const ENTRY_TEST_NO = { '1': '1. test', '2': '2. test', '3+': '3. a další' };
  const GRADE = { A: 'A', B: 'B', C: 'C' };
  // Netest = cena se hladiny v seanci ještě nedotkla (řádek hladiny v blízkosti).
  const TEST_STATE = { UNTESTED: 'netest', TESTED: 'test' };
  // Kontext dne (dayNotes[date].dayContext) – v deníku pevné, bez úprav popisků.
  const OPEN_VS_VALUE = { IN_VA: 'Open ve value', ABOVE_VAH: 'Open nad VAH', BELOW_VAL: 'Open pod VAL', GAP_UP: 'Gap nahoru', GAP_DOWN: 'Gap dolů' };
  const DAY_TYPE = {
    TREND_UP: 'Trend nahoru', TREND_DOWN: 'Trend dolů', BALANCE_D: 'Balance (D)', P: 'P profil', b: 'b profil',
    DOUBLE_DIST: 'Dvojitá distribuce', UNKNOWN: 'Nevím'
  };
  const VALUE_MIGRATION = { HIGHER: 'Výš', LOWER: 'Níž', OVERLAP: 'Překryv' };
  const NEWS_EVENT = { NONE: 'Bez zpráv', CPI: 'CPI', FOMC: 'FOMC', NFP: 'NFP', OTHER: 'Jiné zprávy' };
  // Dopočty deníku.
  const SESSION = { EU_MORNING: 'EU dopoledne', US_OPEN: 'US open', US_MID: 'US poledne', US_CLOSE: 'US závěr', EVENING_OTHER: 'mimo hlavní seance' };
  // Poloha hladiny v blízkosti (geometrie v3) – měření, ne role ani hodnocení.
  const POSITION_LABEL = {
    BEYOND_STOP: 'za SL', STOP_TO_ENTRY: 'mezi SL a vstupem', AT_ENTRY: 'na vstupu',
    ENTRY_TO_TARGET: 'mezi vstupem a cílem', BEYOND_TARGET: 'za cílem'
  };

  const VOCABULARIES = {
    SETUP, ENTRY_LEVEL, OF_CONFIRM, TREND, FILL_STATUS, TARGET_LEVEL, SKIP_REASON,
    TREND_HTF, ABS_LOCATION, ENTRY_TEST_NO, GRADE, TEST_STATE,
    OPEN_VS_VALUE, DAY_TYPE, VALUE_MIGRATION, NEWS_EVENT, SESSION
  };

  // Pole záznamu → slovník, ze kterého bere klíče.
  const FIELD_VOCABULARY = {
    setupCode: 'SETUP',
    trend: 'TREND',
    fillStatus: 'FILL_STATUS',
    entryLevels: 'ENTRY_LEVEL',
    // NEAR_LEVEL v deníku bere volby z ENTRY_LEVEL (optionsFrom).
    nearLevels: 'ENTRY_LEVEL',
    ofConfirm: 'OF_CONFIRM',
    targetLevel1: 'TARGET_LEVEL',
    targetLevel2: 'TARGET_LEVEL',
    maxLevel: 'TARGET_LEVEL',
    wouldSkipReason: 'SKIP_REASON',
    trendHtf: 'TREND_HTF',
    grade: 'GRADE',
    absLocation: 'ABS_LOCATION',
    entryTestNo: 'ENTRY_TEST_NO',
    openVsValue: 'OPEN_VS_VALUE',
    dayTypeExpected: 'DAY_TYPE',
    dayTypeActual: 'DAY_TYPE',
    valueMigration: 'VALUE_MIGRATION',
    newsEvent: 'NEWS_EVENT',
    session: 'SESSION'
  };

  // Popisky kontextových polí (missingContextKeys v deníku).
  const FIELD_LABEL = {
    setupCode: 'Setup',
    fillStatus: 'Stav naplnění',
    trend: 'Trend',
    entryLevels: 'Hladina vstupu',
    nearLevels: 'Hladiny v blízkosti',
    ofConfirm: 'Order flow potvrzení',
    targetLevel1: 'Cílová hladina 1 (typ i cena)',
    slPrice: 'Cena Stop Lossu',
    mfeTicks: 'MFE za dobu obchodu',
    maeTicks: 'MAE za dobu obchodu',
    postExitFavorableTicks: 'Pokračování po výstupu',
    postExitAdverseTicks: 'Protipohyb po výstupu',
    wouldSkipReason: 'Důvod „naživo bych nevzal“',
    targetLevel2: 'Cílová hladina 2',
    maxLevel: 'Hladina maxima',
    trendHtf: 'Trend 30m',
    grade: 'Známka',
    absLocation: 'Absorpce – kde',
    entryTestNo: 'Kolikátý test vstupu',
    targetOnLevel: 'Cíl na hladině (z exportu deníku)',
    session: 'Seance (z exportu deníku)',
    openVsValue: 'Open vůči value',
    dayTypeExpected: 'Typ dne – očekávaný',
    dayTypeActual: 'Typ dne – skutečný',
    valueMigration: 'Migrace value',
    newsEvent: 'Zprávy',
    nearLevelsTest: 'Hladiny v blízkosti – netest/test'
  };

  const has = (map, key) => !!map && Object.prototype.hasOwnProperty.call(map, key);

  // Úprava slovníků z exportu deníku: { SKUPINA: { custom:{KLÍČ:popisek},
  // labels:{KLÍČ:popisek}, … } }. Bere se jen custom a labels u skupin, které
  // Lab zná. NEAR_LEVEL vlastní volby nemá – sdílí je s ENTRY_LEVEL.
  // Lab drží vždy jeden deník, každé načtení overlay celý přepíše.
  const KEY_RE = /^[A-Z0-9_]{1,64}$/;
  let journal = {};

  function cleanMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, label] of Object.entries(raw)) {
      if (KEY_RE.test(key) && typeof label === 'string' && label.trim()) out[key] = label.trim();
    }
    return out;
  }

  function applyJournalTaxonomy(config) {
    journal = {};
    const src = config && typeof config === 'object' ? config : {};
    for (const vocabulary of Object.keys(VOCABULARIES)) {
      const g = src[vocabulary];
      if (!g || typeof g !== 'object') continue;
      const custom = cleanMap(g.custom), labels = cleanMap(g.labels);
      if (Object.keys(custom).length || Object.keys(labels).length) journal[vocabulary] = { custom, labels };
    }
    return journal;
  }

  function isKnown(vocabulary, key) {
    const v = VOCABULARIES[vocabulary];
    return !!v && (has(v, key) || has(journal[vocabulary] && journal[vocabulary].custom, key));
  }

  // Pořadí jako FJTaxonomy.labelOf v deníku: přejmenování → vlastní volba →
  // výchozí. Neznámý klíč se vrátí tak, jak přišel – i když má přejmenování.
  function labelOf(vocabulary, key) {
    if (key == null || key === '') return '';
    if (!isKnown(vocabulary, key)) return String(key);
    const j = journal[vocabulary] || {};
    if (has(j.labels, key)) return j.labels[key];
    if (has(j.custom, key)) return j.custom[key];
    return VOCABULARIES[vocabulary][key];
  }

  function labelOfField(field, key) {
    return labelOf(FIELD_VOCABULARY[field], key);
  }

  function fieldLabel(field) {
    return FIELD_LABEL[field] || field;
  }

  return { VOCABULARIES, FIELD_VOCABULARY, POSITION_LABEL, applyJournalTaxonomy, isKnown, labelOf, labelOfField, fieldLabel };
}));
