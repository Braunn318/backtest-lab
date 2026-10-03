'use strict';
// Popisky klíčů. Export deníku nenese taxonomii (revize R2.7), takže Lab má
// vlastní mapu klíč → popisek, převzatou z VÝCHOZÍCH slovníků deníku
// (repo_clone/app/taxonomy.js, stav 3. 10. 2026). Uživatelské přejmenování
// ani vlastní volby deníku sem nedoléhají.
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

  // Hladiny – sdílí je hladina vstupu, SR proti targetu i SR proti S/L.
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
    NONE: 'Žádná hladina'
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
    MANUAL_EXIT: 'Ruční výstup bez hladiny'
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

  const VOCABULARIES = { SETUP, ENTRY_LEVEL, OF_CONFIRM, TREND, FILL_STATUS, TARGET_LEVEL, SKIP_REASON };

  // Pole záznamu → slovník, ze kterého bere klíče.
  const FIELD_VOCABULARY = {
    setupCode: 'SETUP',
    trend: 'TREND',
    fillStatus: 'FILL_STATUS',
    entryLevels: 'ENTRY_LEVEL',
    srTarget: 'ENTRY_LEVEL',
    srStopLoss: 'ENTRY_LEVEL',
    ofConfirm: 'OF_CONFIRM',
    targetLevel1: 'TARGET_LEVEL',
    targetLevel2: 'TARGET_LEVEL',
    maxLevel: 'TARGET_LEVEL',
    wouldSkipReason: 'SKIP_REASON'
  };

  // Popisky kontextových polí (missingContextKeys v deníku).
  const FIELD_LABEL = {
    setupCode: 'Setup',
    fillStatus: 'Stav naplnění',
    trend: 'Trend',
    entryLevels: 'Hladina vstupu',
    srTarget: 'SR proti targetu',
    srStopLoss: 'SR proti S/L',
    ofConfirm: 'Order flow potvrzení',
    targetLevel1: 'Cílová hladina 1 (typ i cena)',
    slPrice: 'Cena Stop Lossu',
    mfeTicks: 'MFE za dobu obchodu',
    maeTicks: 'MAE za dobu obchodu',
    postExitFavorableTicks: 'Pokračování po výstupu',
    postExitAdverseTicks: 'Protipohyb po výstupu',
    wouldSkipReason: 'Důvod „naživo bych nevzal“',
    targetLevel2: 'Cílová hladina 2',
    maxLevel: 'Hladina maxima'
  };

  function isKnown(vocabulary, key) {
    const v = VOCABULARIES[vocabulary];
    return !!v && Object.prototype.hasOwnProperty.call(v, key);
  }

  // Neznámý klíč se vrátí tak, jak přišel.
  function labelOf(vocabulary, key) {
    if (key == null || key === '') return '';
    return isKnown(vocabulary, key) ? VOCABULARIES[vocabulary][key] : String(key);
  }

  function labelOfField(field, key) {
    return labelOf(FIELD_VOCABULARY[field], key);
  }

  function fieldLabel(field) {
    return FIELD_LABEL[field] || field;
  }

  return { VOCABULARIES, FIELD_VOCABULARY, isKnown, labelOf, labelOfField, fieldLabel };
}));
