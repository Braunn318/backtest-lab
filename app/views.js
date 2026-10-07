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
    levelTolerance: [0, 20], sweepTargetR: [0.25, 10],
    riskDailyLoss: [0.1, 100], riskConsecutiveSL: [1, 50], riskDailySL: [1, 50], riskMaxTrades: [1, 100],
    riskDailyTarget: [0.1, 100], riskGiveBack: [0.1, 100],
    riskUnitUSD: [0.01, 1e6], riskPosition: [1, 1000], riskAccount: [1, 1e9]
  };
  const BOOL_VIEWS = new Set(['includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex']);
  const VIEW_KEYS = ['journalId', 'dateFrom', 'dateTo', 'instrument', 'setupCode', 'includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex', 'sourceDir', 'theme', 'screen', ...Object.keys(VIEW_NUMBERS), 'openSections'];

  // Rozbalené sekce, zvlášť pro každou obrazovku: { sltp: ['mae', 'grid'], … }.
  // Výchozí stav je sbaleno – ukládá se jen to, co uživatel rozbalil.
  const SECTION_SCREENS = ['health', 'sltp', 'levels', 'risk'];
  const SECTION_ID = /^[a-z0-9-]{1,40}$/;
  const MAX_OPEN = 40;

  // Patří ke zvolenému deníku – u jiného deníku by byly nesmysl, proto se
  // při jeho změně vrátí na výchozí. Rozbalené sekce mezi ně nepatří.
  const JOURNAL_SCOPED = ['instrument', 'setupCode', 'riskUnitUSD', 'riskPosition'];

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
      } else if (BOOL_VIEWS.has(key)) out[key] = v === true;
      else if (VIEW_NUMBERS[key]) {
        const n = Number(v);
        const [min, max] = VIEW_NUMBERS[key];
        if (Number.isFinite(n) && n >= min && n <= max) out[key] = n;
      } else out[key] = String(v).slice(0, 1000);
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

  return { VIEW_NUMBERS, BOOL_VIEWS, VIEW_KEYS, SECTION_SCREENS, JOURNAL_SCOPED, sanitizeOpenSections, sanitizeViews, isOpen, withSection, forJournalChange };
}));
