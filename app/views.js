'use strict';
// Uživatelské pohledy (views.json): co se smí uložit a jak se to čistí.
// Sdílí ho hlavní proces (sanitizeViews před jediným zápisem) i okno
// (rozbalené sekce, co se vrací při změně deníku). Nic o obchodech.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabViews = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Číselná nastavení analýz a jejich povolený rozsah. risk* = pravidlo
  // simulátoru dne (prázdné = vypnuté), jednotka R, velikost pozice a účtu.
  const VIEW_NUMBERS = {
    sweepTargetR: [0.25, 10], levelBin: [1, 4],
    riskDailyLoss: [0.1, 100], riskConsecutiveSL: [1, 50], riskDailySL: [1, 50], riskMaxTrades: [1, 100],
    riskDailyTarget: [0.1, 100], riskGiveBack: [0.1, 100],
    riskUnitUSD: [0.01, 1e6], riskPosition: [1, 1000], riskAccount: [1, 1e9]
  };
  // Jen některé hodnoty: sloučení rozložení hladin po 1 / 2 / 4 t (jen zobrazení).
  const VIEW_CHOICES = { levelBin: [1, 2, 4] };
  // navAdvancedOpen = skupina „Pokročilé" v navigaci rozbalená (výchozí sbalená –
  // ukládá se jen rozbalení, false se v pohledech neukládá).
  // updateTestChannel = povolit testovací (pre-release) verze při ruční kontrole aktualizací.
  const BOOL_VIEWS = new Set(['includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex', 'navAdvancedOpen', 'updateTestChannel']);
  const OBJECT_VIEWS = ['openSections', 'whatif', 'diagWords'];
  const VIEW_KEYS = ['journalId', 'dateFrom', 'dateTo', 'instrument', 'setupCode', 'includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex', 'navAdvancedOpen', 'updateTestChannel', 'sourceDir', 'theme', 'screen', ...Object.keys(VIEW_NUMBERS), ...OBJECT_VIEWS];

  // Rozbalené sekce, zvlášť pro každou obrazovku: { sltp: ['mae', 'grid'], … }.
  // Výchozí stav je sbaleno – ukládá se jen to, co uživatel rozbalil.
  const SECTION_SCREENS = ['health', 'sltp', 'levels', 'context', 'risk', 'diagnosis', 'whatif'];
  const SECTION_ID = /^[a-z0-9-]{1,40}$/;
  const MAX_OPEN = 40;

  // Patří ke zvolenému deníku – u jiného deníku by byly nesmysl, proto se
  // při jeho změně vrátí na výchozí. Rozbalené sekce mezi ně nepatří.
  const JOURNAL_SCOPED = ['instrument', 'setupCode', 'riskUnitUSD', 'riskPosition'];

  // ------------------------------------------------------------- Co kdyby: varianta

  // Pravidla dne varianty: počty a částky v USD (LabWhatIf je převede na R).
  const WHATIF_RULES = {
    maxTrades: [1, 100], consecutiveSL: [1, 50], dailySL: [1, 50], afterTarget: [1, 50],
    dailyLossUSD: [0.01, 1e6], dailyTargetUSD: [0.01, 1e6], giveBackUSD: [0.01, 1e6]
  };
  // Filtry B – jen pole známá PŘED vstupem (klíče srovnání v LabDiagnosis).
  const WHATIF_FILTER_FIELDS = ['setup', 'orderFlow', 'grade', 'targetType', 'side', 'session', 'psychBefore'];
  const SL_MODES = ['actual', 'wider', 'narrower', 'fixed'];
  const TARGET_MODES = ['actual', 'r', 'planned', 'split'];
  const GROUP_KEY = /^[A-Za-z0-9_+.-]{1,64}$/;
  const MAX_SAVED = 2;

  function numberIn(v, min, max) {
    const n = Number(v);
    return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  // Jediný tvar varianty – stejný v okně i ve views.json. Co je mimo rozsah, zmizí;
  // volba SL bez platného čísla spadne na „jak jsem ho měl".
  function cleanWhatIfConfig(input) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const rules = {};
    const rs = src.rules && typeof src.rules === 'object' ? src.rules : {};
    for (const [key, [min, max]] of Object.entries(WHATIF_RULES)) {
      const n = numberIn(rs[key], min, max);
      if (n != null) rules[key] = n;
    }
    const exclude = {};
    const ex = src.exclude && typeof src.exclude === 'object' ? src.exclude : {};
    for (const field of WHATIF_FILTER_FIELDS) {
      if (!Array.isArray(ex[field])) continue;
      const keys = [...new Set(ex[field].filter(k => typeof k === 'string' && GROUP_KEY.test(k)))].slice(0, 100);
      if (keys.length) exclude[field] = keys;
    }
    const slIn = src.sl && typeof src.sl === 'object' ? src.sl : {};
    let sl = { mode: 'actual' };
    if (SL_MODES.includes(slIn.mode) && slIn.mode !== 'actual') {
      const ticks = numberIn(slIn.ticks, 0.25, 1000);
      if (ticks != null) sl = { mode: slIn.mode, ticks };
    }
    const tIn = src.target && typeof src.target === 'object' ? src.target : {};
    const k = (v, d) => { const n = numberIn(v, 0.1, 20); return n == null ? d : n; };
    let target = { mode: 'actual' };
    if (tIn.mode === 'r') target = { mode: 'r', k: k(tIn.k, 1) };
    else if (tIn.mode === 'planned') target = { mode: 'planned' };
    else if (tIn.mode === 'split') target = { mode: 'split', k1: k(tIn.k1, 1), k2: k(tIn.k2, 2) };
    const out = { rules, exclude, sl, target };
    // BE celé pozice: po +afterR R ve směru jde SL všech kontraktů na vstup.
    const beAfter = src.be && typeof src.be === 'object' ? numberIn(src.be.afterR, 0.1, 20) : null;
    if (beAfter != null) out.be = { afterR: beAfter };
    return out;
  }

  // { current: varianta, saved: [až 2 uložené varianty nebo null] }
  function sanitizeWhatIf(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const out = {};
    if (input.current) out.current = cleanWhatIfConfig(input.current);
    if (Array.isArray(input.saved)) {
      const saved = input.saved.slice(0, MAX_SAVED).map(c => (c && typeof c === 'object' ? cleanWhatIfConfig(c) : null));
      if (saved.some(Boolean)) out.saved = saved;
    }
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------- Diagnóza: slova v poznámce

  // Seznamy slov (Data → Nastavení diagnózy). Chybějící seznam = výchozí v LabDiagnosis.
  const WORD_LISTS = ['emotion', 'technical'];
  function sanitizeWords(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const out = {};
    for (const key of WORD_LISTS) {
      if (!Array.isArray(input[key])) continue;
      const words = [...new Set(input[key].map(w => String(w == null ? '' : w).trim().toLowerCase()).filter(w => w && w.length <= 40))].slice(0, 50);
      if (words.length) out[key] = words;
    }
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------- celek

  function sanitizeOpenSections(input) {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const screen of SECTION_SCREENS) {
      const list = input[screen];
      if (!Array.isArray(list)) continue;
      const ids = [...new Set(list.filter(id => typeof id === 'string' && SECTION_ID.test(id)))].slice(0, MAX_OPEN);
      if (ids.length) out[screen] = ids;
    }
    return out;
  }

  function sanitizeViews(input) {
    const out = {};
    const src = input && typeof input === 'object' ? input : {};
    for (const key of VIEW_KEYS) {
      const v = src[key];
      if (v === undefined || v === null || v === '') continue;
      if (key === 'openSections') {
        const open = sanitizeOpenSections(v);
        if (Object.keys(open).length) out[key] = open;
      } else if (key === 'whatif') {
        const w = sanitizeWhatIf(v);
        if (w) out[key] = w;
      } else if (key === 'diagWords') {
        const w = sanitizeWords(v);
        if (w) out[key] = w;
      } else if (BOOL_VIEWS.has(key)) out[key] = v === true;
      else if (VIEW_NUMBERS[key]) {
        const n = Number(v);
        const [min, max] = VIEW_NUMBERS[key];
        if (Number.isFinite(n) && n >= min && n <= max && (!VIEW_CHOICES[key] || VIEW_CHOICES[key].includes(n))) out[key] = n;
      } else if (typeof v !== 'object') out[key] = String(v).slice(0, 1000);
    }
    return out;
  }

  function isOpen(views, screen, id) {
    const list = views && views.openSections && views.openSections[screen];
    return Array.isArray(list) && list.includes(id);
  }

  // Nový objekt openSections s přepnutou sekcí (pohledy se nemutují).
  function withSection(views, screen, id, open) {
    const all = { ...((views && views.openSections) || {}) };
    const list = (all[screen] || []).filter(x => x !== id);
    if (open) list.push(id);
    if (list.length) all[screen] = list;
    else delete all[screen];
    return all;
  }

  function forJournalChange(views) {
    const out = { ...views };
    for (const key of JOURNAL_SCOPED) delete out[key];
    return out;
  }

  return {
    VIEW_NUMBERS, BOOL_VIEWS, VIEW_KEYS, SECTION_SCREENS, JOURNAL_SCOPED,
    WHATIF_RULES, WHATIF_FILTER_FIELDS, SL_MODES, TARGET_MODES, WORD_LISTS,
    cleanWhatIfConfig, sanitizeWhatIf, sanitizeWords,
    sanitizeOpenSections, sanitizeViews, isOpen, withSection, forJournalChange
  };
}));
