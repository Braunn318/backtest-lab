'use strict';
// Hladiny – statistika místo pravidel (docs/ZADANI_KONTEXT_V3.md B2).
//
// Čte jen výstup LabNormalize.normalizeRecord: řádky nearLevels s geometrií
// (fromEntry …) a dopočty obchodu (derived.stopBehindTicks, nearestAheadTicks).
//
// Deník hladiny jen MĚŘÍ. Lab z dat ukazuje, co hladina v obchodu dělá – bez
// předem daných košů, rolí a tolerancí. Pro každý řádek:
//   p          = fromEntry (ticky od vstupu, + ve směru obchodu)
//   dotčena    = p leží v dráze ceny [−MAE, +MFE] (jen NAMĚŘENÉ MFE / MAE);
//                jinak nedotčena – z výpočtů reakce vypadává
//   přesah     = jak daleko cena zajela za hladinu: p > 0 → MFE − p, p ≤ 0 → MAE + p
// Rozložení podle vzdálenosti jde po 1 ticku; sloučení po 2 / 4 t je jen volba
// zobrazení (views.levelBin), data zůstávají stejná.
//
// Tohle odpovídá na „kolik ticků nad vstupem ještě chrání SL" – z dat, ne z nastavení.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode ? [require('./labels.js')] : [root.LabLabels];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabStrength = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {

  const GREY_BELOW = 5;      // N dotčených < 5 → řádek zešedne
  const NO_PCT_BELOW = 3;    // N < 3 → bez procent a mediánu – procento ze dvou případů není údaj
  const BINS = [1, 2, 4];    // sloučení po ticích – jen zobrazení
  const TEST_STATE_ORDER = ['UNTESTED', 'TESTED'];
  const has = v => v !== null && v !== undefined;

  // p = poloha, mfe / mae = naměřená dráha (null = neznámá).
  function classify(p, mfe, mae) {
    if (!has(p)) return { status: 'noDistance' };
    const reach = p > 0 ? mfe : mae;
    if (!has(reach)) return { status: 'noExcursion' };
    const overshoot = p > 0 ? reach - p : reach + p;
    if (overshoot < 0) return { status: 'untouched' };
    return { status: 'touched', overshoot: overshoot + 0 };
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function groupBy(list, keyOf) {
    const map = new Map();
    for (const x of list) {
      const key = keyOf(x);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(x);
    }
    return map;
  }

  const binOf = (value, bin) => Math.floor(value / bin) * bin + 0;
  const binSize = bin => (BINS.includes(bin) ? bin : 1);

  // Koše po `bin` ticích nad hodnotou valueOf(x); jen koše, kde něco je.
  function bins(list, valueOf, bin, stats) {
    const map = groupBy(list.filter(x => has(valueOf(x))), x => binOf(valueOf(x), bin));
    return [...map.entries()].sort((a, b) => a[0] - b[0])
      .map(([from, items]) => ({ from, to: from + bin - 1, ...stats(items) }));
  }

  // Čísla jedné skupiny řádků: kolik je, kolik dotčených, výsledek obchodu
  // (win % z target / stoploss u DOTČENÝCH) a medián přesahu dotčených.
  function rowStats(items) {
    const touched = items.filter(x => x.status === 'touched');
    const wins = touched.filter(x => x.record.result === 'target').length;
    const decided = wins + touched.filter(x => x.record.result === 'stoploss').length;
    return {
      n: items.length,
      touched: touched.length,
      untouched: items.filter(x => x.status === 'untouched').length,
      noExcursion: items.filter(x => x.status === 'noExcursion').length,
      wins,
      decided,
      winRate: decided >= NO_PCT_BELOW ? wins / decided : null,
      medianOvershoot: touched.length >= NO_PCT_BELOW ? median(touched.map(x => x.overshoot)) : null,
      grey: touched.length < GREY_BELOW
    };
  }

  // Rozložení řádků podle vzdálenosti od vstupu. Nesahá na řádky – jen je třídí.
  function distribution(rows, bin = 1) {
    const size = binSize(bin);
    return { bin: size, bins: bins(rows, x => x.p, size, rowStats) };
  }

  // Rozdělení obchodů podle dopočtu obchodu na dvě skupiny (stopnuté × přeživší,
  // cíl dosažen × nedosažen) – počty po tickách, k tomu mediány.
  function split(perf, field, isA, keys, bin, extra = () => ({})) {
    const known = perf.filter(r => has(r.derived[field]));
    const part = list => ({ n: list.length, median: median(list.map(r => r.derived[field])), ...extra(list) });
    return {
      [keys[0]]: part(known.filter(isA)),
      [keys[1]]: part(known.filter(r => !isA(r))),
      n: known.length,
      unknown: perf.length - known.length,
      dist: { bin, bins: bins(known, r => r.derived[field], bin, list => ({ n: list.length, [keys[0]]: list.filter(isA).length, [keys[1]]: list.filter(r => !isA(r)).length })) }
    };
  }

  // Kontrolní skupina: obchody s vědomě „žádná hladina v blízkosti" proti
  // obchodům s hladinou. „Nevyplněno" se jen spočítá a do porovnání NEVSTUPUJE.
  function controlGroup(perf) {
    const groups = { none: [], present: [], unknown: [] };
    for (const r of perf) groups[r.nearLevelsState].push(r);
    const stats = list => {
      const wins = list.filter(r => r.result === 'target').length;
      const losses = list.filter(r => r.result === 'stoploss').length;
      return {
        n: list.length,
        winRate: wins + losses ? wins / (wins + losses) : null,
        targetHit: list.length ? wins / list.length : null,
        stopHit: list.length ? losses / list.length : null
      };
    };
    return { none: stats(groups.none), present: stats(groups.present), unknown: { n: groups.unknown.length } };
  }

  function computeStrength(perf, options = {}) {
    const bin = binSize(options.bin);
    const rows = [];
    for (const r of perf) {
      for (const row of r.nearLevels) {
        rows.push({ record: r, row, p: row.fromEntry, ...classify(row.fromEntry, r.mfeMeasured, r.maeMeasured) });
      }
    }
    const touched = rows.filter(x => x.status === 'touched');
    const withState = rows.filter(x => x.row.testState);
    const sub = (key, label, list) => ({ key, label, ...rowStats(list), dist: distribution(list, bin) });
    const byType = [...groupBy(rows, x => x.row.level).entries()]
      .map(([level, list]) => ({ ...sub(level, L.labelOf('ENTRY_LEVEL', level), list), known: L.isKnown('ENTRY_LEVEL', level) }))
      .sort((a, b) => b.touched - a.touched || b.n - a.n || a.key.localeCompare(b.key));
    return {
      n: perf.length,
      bin,
      rows,
      totalRows: rows.length,
      withDistance: rows.filter(x => has(x.p)).length,
      noDistance: rows.filter(x => x.status === 'noDistance').length,
      noExcursion: rows.filter(x => x.status === 'noExcursion').length,
      touched: touched.length,
      untouched: rows.filter(x => x.status === 'untouched').length,
      touchedAhead: touched.filter(x => x.p > 0).length,
      touchedBehind: touched.filter(x => x.p <= 0).length,
      medianOvershoot: touched.length >= NO_PCT_BELOW ? median(touched.map(x => x.overshoot)) : null,
      dist: distribution(rows, bin),
      byType,
      byTest: TEST_STATE_ORDER.map(key => sub(key, L.labelOf('TEST_STATE', key), withState.filter(x => x.row.testState === key))),
      testStateUnknown: rows.length - withState.length,
      stopBehind: split(perf, 'stopBehindTicks', r => r.isStopped, ['stopped', 'survived'], bin),
      nearestAhead: split(perf, 'nearestAheadTicks', r => r.result === 'target', ['reached', 'missed'], bin, list => {
        const values = list.map(r => r.derived.nearestAheadR).filter(has);
        return { medianTicks: median(list.map(r => r.derived.nearestAheadTicks)), medianR: median(values), rN: values.length };
      }),
      control: controlGroup(perf)
    };
  }

  return { GREY_BELOW, NO_PCT_BELOW, BINS, classify, distribution, computeStrength };
}));
