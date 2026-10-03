'use strict';
// Fáze 2, otázka 2: jak silné jsou hladiny proti TP a proti SL?
//
// Čte jen výstup LabNormalize.normalizeRecord. Zdroj: řádky srTarget
// (hladiny mezi vstupem a cílem) a srStopLoss (mezi vstupem a SL).
//
// JÁDRO: hladina se do síly počítá jen tehdy, když ji cena otestovala.
// Netestovaná hladina (cena k ní vůbec nedošla) z výpočtu vypadne – jinak by
// vzdálená hladina vyšla jako nejsilnější jen proto, že k ní cena nikdy
// nedošla. Vzdálenost se nedopočítává odhadem: řádek bez ceny i vzdálenosti
// je „nelze vyhodnotit".

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const labels = isNode ? require('./labels.js') : root.LabLabels;
  const api = factory(labels);
  if (isNode) module.exports = api;
  if (root) root.LabStrength = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {

  const DEFAULT_TOLERANCE = 2;
  const GREY_BELOW = 5;      // N testovaných < 5 → řádek zešedne
  const NO_PCT_BELOW = 3;    // N testovaných < 3 → bez procent
  const has = v => v !== null && v !== undefined;

  const SIDES = [
    { key: 'target', field: 'srTarget', stateField: 'srTargetState', excursion: 'mfeMeasured', excursionLabel: 'MFE', label: 'Hladiny proti targetu' },
    { key: 'sl', field: 'srStopLoss', stateField: 'srStopLossState', excursion: 'maeMeasured', excursionLabel: 'MAE', label: 'Hladiny proti SL' }
  ];

  // e = naměřená excursion, d = vzdálenost hladiny od vstupu, obojí v ticích.
  function classify(d, e, tolerance = DEFAULT_TOLERANCE) {
    if (!has(d)) return { status: 'noDistance' };
    if (!has(e)) return { status: 'noExcursion' };
    if (e < d - tolerance) return { status: 'untested' };
    if (Math.abs(e - d) <= tolerance) return { status: 'held' };
    return { status: 'broken', overshoot: e - d };
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function sideStrength(perf, side, tolerance) {
    const rows = [];
    for (const r of perf) {
      for (const row of r[side.field]) {
        if (row.isNone) continue;
        rows.push({ record: r, row, ...classify(row.distanceTicks, r[side.excursion], tolerance) });
      }
    }
    const byLevel = new Map();
    for (const x of rows) {
      const key = x.row.level || '(bez typu)';
      if (!byLevel.has(key)) byLevel.set(key, []);
      byLevel.get(key).push(x);
    }
    const levels = [...byLevel.entries()].map(([level, list]) => {
      const held = list.filter(x => x.status === 'held');
      const broken = list.filter(x => x.status === 'broken');
      const tested = held.length + broken.length;
      const showPct = tested >= NO_PCT_BELOW;
      return {
        level,
        label: L.labelOf('ENTRY_LEVEL', level),
        known: L.isKnown('ENTRY_LEVEL', level),
        tested,
        held: held.length,
        broken: broken.length,
        heldPct: showPct ? held.length / tested : null,
        brokenPct: showPct ? broken.length / tested : null,
        medianOvershoot: showPct ? median(broken.map(x => x.overshoot)) : null,
        untested: list.filter(x => x.status === 'untested').length,
        noData: list.filter(x => x.status === 'noDistance' || x.status === 'noExcursion').length,
        grey: tested < GREY_BELOW,
        items: list
      };
    });
    levels.sort((a, b) => {
      const pa = a.heldPct == null ? -1 : a.heldPct, pb = b.heldPct == null ? -1 : b.heldPct;
      return pb - pa || b.tested - a.tested || a.level.localeCompare(b.level);
    });
    const withPlace = rows.filter(x => has(x.row.distanceTicks)).length;
    return {
      key: side.key,
      label: side.label,
      excursionLabel: side.excursionLabel,
      totalRows: rows.length,
      withPlace,
      tested: rows.filter(x => x.status === 'held' || x.status === 'broken').length,
      untested: rows.filter(x => x.status === 'untested').length,
      noExcursion: rows.filter(x => x.status === 'noExcursion').length,
      coverageMessage: withPlace < rows.length
        ? `Síla hladin potřebuje u SR řádku vyplněnou cenu nebo vzdálenost od vstupu. Má ji ${withPlace} z ${rows.length} řádků. Bez ní nejde poznat, jestli k hladině cena vůbec došla.`
        : null,
      levels
    };
  }

  // Kontrolní skupina: obchody s vědomě „žádná hladina" proti obchodům
  // s hladinou. „Nevyplněno" se jen spočítá a do porovnání NEVSTUPUJE.
  function controlGroup(perf, side) {
    const groups = { none: [], present: [], unknown: [] };
    for (const r of perf) groups[r[side.stateField]].push(r);
    const stats = list => {
      const wins = list.filter(r => r.result === 'target').length;
      const losses = list.filter(r => r.result === 'stoploss').length;
      const exc = list.map(r => r[side.excursion]).filter(has);
      return {
        n: list.length,
        winRate: wins + losses ? wins / (wins + losses) : null,
        targetHit: list.length ? wins / list.length : null,
        stopHit: list.length ? losses / list.length : null,
        medianExcursion: median(exc),
        excursionN: exc.length
      };
    };
    return {
      key: side.key,
      label: side.label,
      excursionLabel: side.excursionLabel,
      none: stats(groups.none),
      present: stats(groups.present),
      unknown: { n: groups.unknown.length }
    };
  }

  function computeStrength(perf, options = {}) {
    const tolerance = has(options.tolerance) ? options.tolerance : DEFAULT_TOLERANCE;
    return {
      tolerance,
      n: perf.length,
      sides: SIDES.map(side => sideStrength(perf, side, tolerance)),
      control: SIDES.map(side => controlGroup(perf, side))
    };
  }

  return { DEFAULT_TOLERANCE, GREY_BELOW, NO_PCT_BELOW, classify, computeStrength };
}));
