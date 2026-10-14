'use strict';
// Obrazovka Souhrn (docs/ZADANI_LAB_SOUHRN.md §2): jedna obrazovka s čísly,
// podrobnosti o úroveň níž.
//
// NIC NOVÉHO SE NEPOČÍTÁ. Karty berou výsledky, které počítají obrazovky
// v Podrobnostech – z JEDNOHO objektu LabOverview.analyses(ctx) pro daný
// render – a jejich stavy (✓ / ~ / –) a prahy. Každá obrazovka v Podrobnostech
// ukazuje nahoře tutéž kartu, takže čísla jsou z definice stejná.
//
// Žádné doporučení, co obchodovat, žádné zvýraznění „vítěze". Karta, která
// nemůže běžet, zůstane na svém místě: „–" a co chybí.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? ['./overview.js', './context.js', './sequence.js'].map(f => require(f))
    : [root.LabOverview, root.LabContext, root.LabSequence];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabSummary = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (O, CX, SQ) {

  const { num, signedR, capitalize, lowerFirst, plural, bySample } = O;
  const GREY = 10;
  const has = v => v !== null && v !== undefined;
  const stop = s => s.replace(/[.\s]+$/, '') + '.';

  // Navigace: Souhrn · Podrobnosti (sbalitelná, pamatuje se) · Data.
  const NAV = [
    { screen: 'summary' },
    { group: 'details', label: 'Podrobnosti', screens: ['sltp', 'levels', 'context', 'risk'] },
    { group: 'data', label: 'Data', screens: ['health'] }
  ];
  const START_SCREEN = 'summary';
  // Kolik dimenzí kontextu ukáže řádek „největší rozdíly".
  const CONTEXT_ROWS = 3;

  // Věta karty: pod prahem začíná „Předběžně", bez vstupu ji nahradí „co chybí".
  function textOf(state, fact) {
    if (state === 'na' || !fact) return null;
    return stop(state === 'weak' ? `Předběžně: ${lowerFirst(fact)}` : capitalize(fact));
  }

  function card(key, screen, title, bigLabel, st, big, unit, extra = {}) {
    return {
      key, screen, title, bigLabel, unit,
      state: st.state,
      big: st.state === 'na' ? null : big,
      text: textOf(st.state, st.fact),
      missing: st.state === 'na' ? st.missing : null,
      ...extra
    };
  }

  // ------------------------------------------------------------- čtyři otázky

  function slCard(sltp) {
    const d = sltp.maeWinners;
    const mode = sltp.slMode;
    const st = O.maeState(d);
    const modeText = mode.values.length ? `, tvůj nejčastější SL je ${mode.values.map(num).join(' / ')} t` : '';
    return card('sl', 'sltp', 'SL', 'p90 MAE vítězů', { ...st, fact: d.n ? `90 % ziskových obchodů šlo proti nejvýš ${num(d.p90)} t${modeText}` : null },
      d.p90, 't', { slMode: mode.values, n: d.n });
  }

  function tpCard(sltp) {
    const d = sltp.tpAfter;
    const lack = GREY - d.n;
    const st = {
      state: bySample(d.n),
      fact: d.n ? `po targetu cena v mediánu pokračovala ještě ${num(d.p50)} t` : null,
      missing: `${lack} ${plural(lack, 'obchod', 'obchody', 'obchodů')} na targetu se zapsaným pohybem po výstupu do ${GREY} (je ${d.n} z ${d.targets})`
    };
    return card('tp', 'sltp', 'TP', 'medián pohybu po targetu', st, d.p50, 't', { n: d.n });
  }

  // Bod zlomu se nehledá (rozhodnutí uživatele 14. 10.) – jen N dotčených a popis rozložení.
  function levelsCard(strength) {
    return card('levels', 'levels', 'Hladiny', 'dotčených hladin', O.levelsState(strength), strength.touched, '', { n: strength.touched });
  }

  const SERIES_FACT = {
    random: 'série ztrát jsou v mezích náhody',
    clustered: 'ztráty se shlukují',
    alternating: 'zisky a ztráty se střídají'
  };

  function riskCard(seq) {
    const st = O.seriesState(seq);
    return card('risk', 'risk', 'Denní risk', 'runs test z', { ...st, fact: SERIES_FACT[seq.verdict.kind] || null }, seq.runs.z, '',
      { bigText: has(seq.runs.z) ? SQ.fmtZ(seq.runs.z) : null, n: seq.n });
  }

  // ------------------------------------------------------------- výsledek

  // Tatáž mechanika jako řádky obrazovky Kontext (CX.rowStats). Equity v R =
  // kumulativní R rozhodnutých obchodů (target / stoploss s R) v čase – jen
  // tvar a koncová hodnota (= expectancy × N).
  function resultOf(perf) {
    const rs = CX.rowStats(perf);
    const decided = perf.filter(r => (r.result === 'target' || r.result === 'stoploss') && has(r.rSigned))
      .map((r, i) => ({ r, i }))
      .sort((a, b) => String(a.r.date || '').localeCompare(String(b.r.date || ''))
        || (has(a.r.entryMinutes) ? a.r.entryMinutes : -1) - (has(b.r.entryMinutes) ? b.r.entryMinutes : -1) || a.i - b.i)
      .map(x => x.r);
    let sum = 0;
    const equity = decided.map(r => (sum += r.rSigned));
    return {
      n: rs.n, decided: rs.decided, winRate: rs.winRate,
      expectancyR: rs.expectancyR, expectancyN: rs.expectancyN, avgWinR: rs.avgWinR, avgLossR: rs.avgLossR,
      pnl: rs.pnl, equity, equityEnd: equity.length ? equity[equity.length - 1] : null
    };
  }

  // ------------------------------------------------------------- kontext: největší rozdíly

  // Dimenze nad prahem, ze dvou NEJVĚTŠÍCH skupin (tytéž, na kterých stojí práh –
  // rozhodnutí uživatele 14. 10.); řazení podle rozdílu expectancy R. Skupiny ve
  // větě v pořadí dimenze, nic se nezvýrazňuje. Nevyplněno ani řádky stranou nevstupují.
  function contextDiffs(context) {
    const rows = [];
    for (const d of context.dimensions) {
      if (d.state === 'na') continue;
      const pair = d.compared.slice(0, 2);
      if (pair.length < 2 || pair.some(g => !has(g.expectancyR))) continue;
      const groups = pair.sort((a, b) => d.rows.indexOf(a) - d.rows.indexOf(b))
        .map(g => ({ key: g.key, kind: g.kind, label: g.label, expectancyR: g.expectancyR, n: g.n }));
      rows.push({ key: d.key, label: d.label, state: d.state, diff: Math.abs(groups[0].expectancyR - groups[1].expectancyR), groups });
    }
    rows.sort((a, b) => b.diff - a.diff);
    const top = rows.slice(0, CONTEXT_ROWS);
    let missing = null;
    if (!top.length) {
      const near = context.dimensions.reduce((a, d) => (!a || d.second > a.second ? d : a), null);
      const lack = near ? GREY - near.second : GREY;
      missing = near && near.second > 0
        ? `nejblíž je ${near.label.toLowerCase()}: ${lack} ${plural(lack, 'obchod', 'obchody', 'obchodů')} v druhé největší skupině do ${GREY} (je ${near.second})`
        : `aspoň ${GREY} obchodů ve dvou skupinách jedné dimenze (vyplněná pole kontextu)`;
    }
    return { rows: top, missing };
  }

  // ------------------------------------------------------------- data

  function dataOf(health, overview) {
    const c = health.completeness;
    const first = overview.fill[0] || null;
    return {
      complete: c.total - c.incomplete,
      total: c.total,
      completePct: c.total ? (c.total - c.incomplete) / c.total : null,
      bottleneck: first && { field: first.field, n: first.minN === Infinity ? null : first.minN, unit: first.unit || 'obchodů' }
    };
  }

  // ------------------------------------------------------------- celek

  function computeSummary(ctx) {
    const an = O.analyses(ctx);
    const overview = O.computeOverview(ctx);
    return {
      result: resultOf(ctx.perf),
      cards: {
        sl: slCard(an.sltp),
        tp: tpCard(an.sltp),
        levels: levelsCard(an.strength),
        risk: riskCard(an.seq)
      },
      context: contextDiffs(an.context),
      data: dataOf(ctx.health, overview)
    };
  }

  return {
    NAV, START_SCREEN, CONTEXT_ROWS,
    textOf, slCard, tpCard, levelsCard, riskCard, resultOf, contextDiffs, dataOf, computeSummary
  };
}));
