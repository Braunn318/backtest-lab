'use strict';
// Fáze 3, krok 1: sekvenční analýza (PLAN_RISK_MANAGEMENT.md §4).
//
// Otázka: shlukují se ztráty? Pravidlo „konec dne po N ztrátách" má smysl
// jako předpověď jen tehdy, když je po N ztrátách další ztráta
// pravděpodobnější. Jsou-li série W/L v mezích náhody, pravidlo špatný obchod
// nepředvídá – jen zmenší rozptyl. Proto tohle běží PŘED simulátorem
// a optimalizací a výsledek se ukazuje nad nimi.
//
// Čte jen výstup LabNormalize.normalizeRecord.
//
// Konvence (ověřeno proti číslům z plánu §7 na skutečných datech):
//  - W = result 'target', L = result 'stoploss'. Breakeven a ostatní výsledky
//    ze sekvence vypadnou (nejsou ztráta ani zisk) a jen se spočítají.
//  - Runs test a permutace jedou přes CELOU chronologickou sekvenci (přes dny).
//  - Podmíněný win rate se počítá UVNITŘ DNE – série se na začátku dne nuluje,
//    protože denní pravidlo vidí jen svůj den.
//  - Legacy obchody (legacyPointsConvention) VSTUPUJÍ – rozhodnutí uživatele
//    3. 10. 2026: výsledek obchodu je u nich v pořádku, nejistá je jen
//    konvence bodů (do ničeho v R/bodech nevstupují). Bez nich by Phidias 1
//    měl 9 dnů místo 35.
//  - „Naživo bych nevzal" zrcadlí deník (R2.5): ve výchozím stavu mimo,
//    přepínač je zapne. SETUP_ONLY nikdy.
//  - Hypotetické výsledky (no fill / vědomě vynechané, deník 4.7.3) ve
//    výchozím stavu mimo – nejsou exekuce. Množinu rozhoduje jen
//    LabNormalize.inPerformance.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const normalize = isNode ? require('./normalize.js') : root.LabNormalize;
  const api = factory(normalize);
  if (isNode) module.exports = api;
  if (root) root.LabSequence = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (N) {

  const RUNS_MIN_EACH = 10;       // n₁ i n₂ aspoň 10, jinak normální aproximace neplatí
  const Z_SIGNIFICANT = 1.96;     // oboustranně 5 %
  const Z_HINT = 1;               // od |z| ≥ 1 se zmíní náznak (neprůkazný)
  const PERMUTATIONS = 10000;
  const DEFAULT_SEED = 20261003;  // pevný seed: stejné číslo po každém překreslení
  const CONDITIONAL_MAX_K = 3;
  const NO_PCT_BELOW = 3;         // procento ze dvou případů není údaj

  const has = v => v !== null && v !== undefined;
  const fmtZ = z => (z > 0 ? '+' : z < 0 ? '−' : '') + Math.abs(z).toFixed(2).replace('.', ',');

  // ------------------------------------------------------------- sekvence

  function sequenceBase(records, options = {}) {
    const base = records
      .map((record, index) => ({ record, index }))
      .filter(x => N.inPerformance(x.record, options));
    base.sort((a, b) => {
      const da = a.record.date || '', db = b.record.date || '';
      if (da !== db) return da < db ? -1 : 1;
      const ma = has(a.record.entryMinutes) ? a.record.entryMinutes : Infinity;
      const mb = has(b.record.entryMinutes) ? b.record.entryMinutes : Infinity;
      if (ma !== mb) return ma < mb ? -1 : 1;
      return a.index - b.index;
    });
    const items = [];
    const excluded = { breakeven: 0, other: 0 };
    for (const { record } of base) {
      if (record.result === 'target') items.push({ record, win: true });
      else if (record.result === 'stoploss') items.push({ record, win: false });
      else if (record.result === 'breakeven') excluded.breakeven++;
      else excluded.other++;
    }
    return {
      items,
      // Všechny obchody v pořadí, vč. breakevenu – simulátor dne (krok 2)
      // jede nad stejnou množinou a stejným řazením.
      ordered: base.map(x => x.record),
      excluded,
      trades: base.length,
      legacy: items.filter(x => x.record.isLegacy).length,
      skipLive: items.filter(x => x.record.wouldSkipLive).length,
      hypothetical: items.filter(x => x.record.isHypothetical).length,
      days: new Set(base.map(x => x.record.date).filter(Boolean)).size,
      noTime: base.filter(x => !has(x.record.entryMinutes)).length
    };
  }

  // ------------------------------------------------------------- runs test

  // Wald–Wolfowitz. Záporné z = méně sérií, než odpovídá náhodě = shlukování.
  function runsTest(wins) {
    const n = wins.length;
    const n1 = wins.filter(Boolean).length;
    const n2 = n - n1;
    let runs = n ? 1 : 0;
    for (let i = 1; i < n; i++) if (wins[i] !== wins[i - 1]) runs++;
    const out = { n, wins: n1, losses: n2, runs, expected: null, sd: null, z: null, valid: false, reason: null };
    if (n1 < RUNS_MIN_EACH || n2 < RUNS_MIN_EACH) {
      out.reason = `Na runs test je potřeba aspoň ${RUNS_MIN_EACH} zisků i ${RUNS_MIN_EACH} ztrát (je ${n1} / ${n2}).`;
      if (!n1 || !n2) return out;
    }
    const p = 2 * n1 * n2;
    out.expected = p / n + 1;
    const variance = p * (p - n) / (n * n * (n - 1));
    out.sd = Math.sqrt(variance);
    out.z = out.sd > 0 ? (runs - out.expected) / out.sd : null;
    out.valid = !out.reason && has(out.z);
    return out;
  }

  function longestRun(wins, value) {
    let best = 0, cur = 0;
    for (const w of wins) {
      cur = w === value ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best;
  }

  // ------------------------------------------------------------- permutace

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Jak často náhodné pořadí týchž obchodů vyrobí stejně dlouhou nebo delší
  // sérii ztrát jako skutečná nejdelší.
  function permutationTest(wins, options = {}) {
    const iterations = has(options.iterations) ? options.iterations : PERMUTATIONS;
    const rand = mulberry32(has(options.seed) ? options.seed : DEFAULT_SEED);
    const observed = longestRun(wins, false);
    const arr = wins.slice();
    let atLeast = 0;
    for (let it = 0; it < iterations; it++) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      if (longestRun(arr, false) >= observed) atLeast++;
    }
    return { observed, iterations, atLeast, p: iterations ? atLeast / iterations : null };
  }

  // ------------------------------------------------------------- podmíněný win rate

  function cell() { return { n: 0, wins: 0, rate: null }; }
  function close(c) { c.rate = c.n >= NO_PCT_BELOW ? c.wins / c.n : null; return c; }

  // „Po k ztrátách" = posledních k obchodů TÉHOŽ DNE bylo ztrátových.
  function conditionalWinRate(items, maxK = CONDITIONAL_MAX_K) {
    const overall = cell();
    const firstOfDay = cell();
    const afterLosses = Array.from({ length: maxK }, (_, i) => ({ k: i + 1, ...cell() }));
    const afterWins = Array.from({ length: maxK }, (_, i) => ({ k: i + 1, ...cell() }));
    let day = undefined, lossStreak = 0, winStreak = 0;
    for (const { record, win } of items) {
      overall.n++; if (win) overall.wins++;
      if (record.date !== day) {
        day = record.date; lossStreak = 0; winStreak = 0;
        firstOfDay.n++; if (win) firstOfDay.wins++;
      } else {
        for (const c of afterLosses) if (lossStreak >= c.k) { c.n++; if (win) c.wins++; }
        for (const c of afterWins) if (winStreak >= c.k) { c.n++; if (win) c.wins++; }
      }
      if (win) { winStreak++; lossStreak = 0; } else { lossStreak++; winStreak = 0; }
    }
    return {
      overall: close(overall),
      firstOfDay: close(firstOfDay),
      afterLosses: afterLosses.map(close),
      afterWins: afterWins.map(close)
    };
  }

  // ------------------------------------------------------------- verdikt

  function verdictOf(runs) {
    if (!runs.valid) {
      return { kind: 'insufficient', text: `Na test náhodnosti sérií zatím nejsou data. ${runs.reason || ''}`.trim() };
    }
    const z = runs.z;
    if (z <= -Z_SIGNIFICANT) {
      return { kind: 'clustered', text: `Ztráty se shlukují víc, než odpovídá náhodě (z = ${fmtZ(z)}). Pravidlo po N ztrátách má na čem stát.` };
    }
    if (z >= Z_SIGNIFICANT) {
      return { kind: 'alternating', text: `Zisky a ztráty se střídají víc, než odpovídá náhodě (z = ${fmtZ(z)}). Pravidlo po N ztrátách by utínalo dny, které se otáčejí.` };
    }
    const hint = z <= -Z_HINT ? ` Mírný náznak shlukování, na ${runs.n} obchodech neprůkazný.` : '';
    return { kind: 'random', text: `Série ve tvých datech jsou v mezích náhody (z = ${fmtZ(z)}). Pravidlo po N ztrátách nedokáže špatný obchod předvídat — omezí rozptyl, nezvýší edge.${hint}` };
  }

  // ------------------------------------------------------------- celek

  function computeSequence(records, options = {}) {
    const base = sequenceBase(records, options);
    const wins = base.items.map(x => x.win);
    const runs = runsTest(wins);
    return {
      base,
      n: wins.length,
      runs,
      verdict: verdictOf(runs),
      longestLoss: longestRun(wins, false),
      longestWin: longestRun(wins, true),
      permutation: permutationTest(wins, options),
      conditional: conditionalWinRate(base.items, options.maxK)
    };
  }

  return {
    RUNS_MIN_EACH, Z_SIGNIFICANT, PERMUTATIONS, NO_PCT_BELOW,
    fmtZ, sequenceBase, runsTest, longestRun, permutationTest, conditionalWinRate, verdictOf, computeSequence
  };
}));
