'use strict';
// Kontext obchodu – rozpad výsledků podle dimenze (docs/ZADANI_KONTEXT.md B3,
// dimenze upravené podle docs/ZADANI_KONTEXT_V3.md B3).
//
// Čte jen výstup LabNormalize (out.ctx, out.derived, gradeOrigin …) nad
// výkonovým vzorkem – žádné vlastní předzpracování. Čísla řádku jsou stejná
// mechanika jako jinde v Labu (LabHealth.overall): N, win %, průměr R,
// k tomu expectancy v R z obchodů target / stoploss.
//
// PRAVIDLA:
//  - Každá dimenze má tři druhy řádků: hodnota, „vědomě žádná / nevím"
//    (normální řádek – bývá to kontrolní skupina) a NEVYPLNĚNO. Nevyplněno se
//    ukáže s počtem a do porovnání NEVSTUPUJE: nepočítá se do prahu ani do věty.
//  - Stav dimenze dávají stávající prahy vzorku (SAMPLE_GREY / SAMPLE_WARN)
//    nad DRUHOU největší skupinou – porovnání potřebuje aspoň dvě. Prahy se
//    kvůli plnější obrazovce nesnižují.
//  - Koše jsou jen tady (BUCKETS). Hladiny v3 koše nemají – jejich rozložení
//    jde po tickách (LabStrength), ne podle předem daných hranic.
//  - Lab nic nedoporučuje. Ukazuje rozdělení a kolik za ním stojí obchodů.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? ['./labels.js', './health.js', './sltp.js'].map(f => require(f))
    : [root.LabLabels, root.LabHealth, root.LabSlTp];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabContext = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (L, H, S) {

  const GREY = S.SAMPLE_GREY;
  const WARN = S.SAMPLE_WARN;
  const NO_PCT_BELOW = 3;     // pod 3 obchody bez procent – procento ze dvou případů není údaj
  const has = v => v !== null && v !== undefined;

  // ------------------------------------------------------------- koše
  //
  // První koš, jehož test projde. Pořadí v dni: 1. · 2. · 3. · 4. a další.
  const BUCKETS = {
    tradeNoInDay: [
      { key: 'N1', label: '1. obchod dne', test: v => v === 1 },
      { key: 'N2', label: '2. obchod dne', test: v => v === 2 },
      { key: 'N3', label: '3. obchod dne', test: v => v === 3 },
      { key: 'N4P', label: '4. a další', test: () => true }
    ]
  };

  function bucketOf(name, value) {
    return has(value) ? BUCKETS[name].find(b => b.test(value)).key : null;
  }
  const bucketKeys = name => BUCKETS[name].map(b => b.key);
  const bucketLabel = name => key => (BUCKETS[name].find(b => b.key === key) || { label: key }).label;

  // ------------------------------------------------------------- dimenze
  //
  // valueOf(record) → { kind, key }:
  //   'value'   hodnota                         → řádek, vstupuje do porovnání
  //   'none'    vědomě žádná / nevím            → řádek, vstupuje do porovnání
  //   'aside'   stranou (známka změněná / zpětně) → řádek s čísly, do porovnání NE
  //   'unknown' nevyplněno                       → jen počet
  // lacks = co vyplnit, když dimenzi chybí vstup (blok „Co vyplnit").

  const UNKNOWN = { kind: 'unknown', key: null };
  const fromCtx = field => r => {
    const c = r.ctx[field];
    return c.state === 'unknown' ? UNKNOWN : { kind: c.state, key: String(c.value) };
  };
  const value = key => ({ kind: 'value', key });

  // Soulad směru obchodu s trendem: po trendu / proti / range.
  const ALIGN_LABEL = { WITH: 'po trendu', AGAINST: 'proti trendu', RANGE: 'range' };
  function alignOf(direction, trendDirection, isRange) {
    if (isRange) return value('RANGE');
    if (direction == null || trendDirection == null) return UNKNOWN;
    return value(direction === trendDirection ? 'WITH' : 'AGAINST');
  }
  const HTF_DIRECTION = { UP: 1, DOWN: -1 };
  const TREND_DIRECTION = { LONG: 1, SHORT: -1 };

  // Krátce – název dimenze stojí před nimi (ve větě i v hlavičce tabulky).
  const PREV_RESULT_LABEL = { FIRST: 'první obchod dne', target: 'po targetu', stoploss: 'po stoplossu', breakeven: 'po breakevenu' };
  const DAY_CONTEXT_LACKS = 'kontext dne (v deníku ☀ Kontext dne nebo Kalendář → den)';

  const GROUPS = [
    { key: 'path', label: 'Cíl' },
    { key: 'entry', label: 'Vstup' },
    { key: 'direction', label: 'Směr' },
    { key: 'process', label: 'Proces' },
    { key: 'day', label: 'Den' }
  ];

  const DIMENSIONS = [
    // ---- cíl
    {
      key: 'targetOnLevel', group: 'path', label: 'Cíl na hladině',
      lacks: 'typ cílové hladiny – „cíl na hladině“ dopočítává deník (export od 4.8.1)',
      order: ['true', 'false'], labelOf: k => (k === 'true' ? 'na hladině' : 'mimo hladinu (fix RRR, ruční výstup, cena z výstupu)'),
      valueOf: fromCtx('targetOnLevel')
    },
    // ---- vstup
    {
      key: 'entryTestNo', group: 'entry', label: 'Kolikátý test vstupní hladiny', lacks: L.fieldLabel('entryTestNo'),
      order: ['1', '2', '3+'], labelOf: k => L.labelOf('ENTRY_TEST_NO', k), valueOf: fromCtx('entryTestNo')
    },
    {
      key: 'absLocation', group: 'entry', label: 'Absorpce – kde', lacks: L.fieldLabel('absLocation'),
      order: ['EXTREME', 'MIDDLE', 'NONE'], labelOf: k => L.labelOf('ABS_LOCATION', k), valueOf: fromCtx('absLocation')
    },
    // ---- směr
    {
      key: 'trendHtfAlign', group: 'direction', label: 'Směr vůči trendu 30m', lacks: L.fieldLabel('trendHtf'),
      order: ['WITH', 'AGAINST', 'RANGE'], labelOf: k => ALIGN_LABEL[k] || k,
      valueOf: r => (r.ctx.trendHtf.state === 'unknown' ? UNKNOWN : alignOf(r.direction, HTF_DIRECTION[r.ctx.trendHtf.value], r.ctx.trendHtf.value === 'RANGE'))
    },
    {
      key: 'trendAlign', group: 'direction', label: 'Směr vůči trendu', lacks: L.fieldLabel('trend'),
      order: ['WITH', 'AGAINST', 'RANGE'], labelOf: k => ALIGN_LABEL[k] || k,
      valueOf: r => (!r.trend ? UNKNOWN : alignOf(r.direction, TREND_DIRECTION[r.trend], r.trend === 'RANGE'))
    },
    // ---- proces
    {
      key: 'grade', group: 'process', label: 'Známka před vstupem', lacks: L.fieldLabel('grade'),
      order: ['A', 'B', 'C', 'EDITED', 'RETRO'],
      labelOf: k => (k === 'EDITED' ? 'známka změněná dodatečně' : k === 'RETRO' ? 'známka doplněná zpětně' : L.labelOf('GRADE', k)),
      // Deník neumí ověřit, že známka vznikla před vstupem – změněná nebo
      // zpětně doplněná jde stranou, ať nevyrábí zdání, že „A" vyhrává.
      valueOf: r => (!r.gradeOrigin ? UNKNOWN : r.gradeOrigin === 'clean' ? value(r.grade) : { kind: 'aside', key: r.gradeOrigin === 'edited' ? 'EDITED' : 'RETRO' })
    },
    {
      key: 'tradeNoInDay', group: 'process', label: 'Kolikátý obchod dne', lacks: 'datum a čas vstupu',
      order: bucketKeys('tradeNoInDay'), labelOf: bucketLabel('tradeNoInDay'),
      valueOf: r => (has(r.derived.tradeNoInDay) ? value(bucketOf('tradeNoInDay', r.derived.tradeNoInDay)) : UNKNOWN)
    },
    {
      key: 'prevResultInDay', group: 'process', label: 'Po čem obchod přišel', lacks: 'datum a čas vstupu',
      order: ['FIRST', 'target', 'stoploss', 'breakeven'], labelOf: k => PREV_RESULT_LABEL[k] || k,
      valueOf: r => (has(r.derived.prevResultInDay) ? value(r.derived.prevResultInDay) : UNKNOWN)
    },
    // ---- den
    {
      key: 'openVsValue', group: 'day', label: 'Open vůči včerejší value', lacks: DAY_CONTEXT_LACKS,
      order: ['IN_VA', 'ABOVE_VAH', 'BELOW_VAL', 'GAP_UP', 'GAP_DOWN'], labelOf: k => L.labelOf('OPEN_VS_VALUE', k), valueOf: fromCtx('openVsValue')
    },
    {
      key: 'dayTypeActual', group: 'day', label: 'Typ dne – skutečný', lacks: DAY_CONTEXT_LACKS,
      order: ['TREND_UP', 'TREND_DOWN', 'BALANCE_D', 'P', 'b', 'DOUBLE_DIST', 'UNKNOWN'], labelOf: k => L.labelOf('DAY_TYPE', k), valueOf: fromCtx('dayTypeActual')
    },
    {
      key: 'dayTypeAccuracy', group: 'day', label: 'Přesnost očekávaného typu dne', lacks: DAY_CONTEXT_LACKS,
      order: ['MATCH', 'MISS', 'NO_EXPECTATION'],
      labelOf: k => ({ MATCH: 'očekávání sedělo', MISS: 'očekávání nesedělo', NO_EXPECTATION: 'bez očekávání („nevím“)' }[k] || k),
      // Potřebuje skutečný typ dne. Vědomé „nevím" ráno je vlastní skupina.
      valueOf: r => {
        const exp = r.ctx.dayTypeExpected, act = r.ctx.dayTypeActual;
        if (act.state !== 'value' || exp.state === 'unknown') return UNKNOWN;
        if (exp.state === 'none') return { kind: 'none', key: 'NO_EXPECTATION' };
        return value(exp.value === act.value ? 'MATCH' : 'MISS');
      }
    },
    {
      key: 'newsEvent', group: 'day', label: 'Zprávy', lacks: DAY_CONTEXT_LACKS,
      order: ['NONE', 'CPI', 'FOMC', 'NFP', 'OTHER'], labelOf: k => L.labelOf('NEWS_EVENT', k), valueOf: fromCtx('newsEvent')
    }
  ];

  // ------------------------------------------------------------- čísla řádku

  const mean = list => (list.length ? list.reduce((a, v) => a + v, 0) / list.length : null);

  // Expectancy v R z rozhodnutých obchodů (target / stoploss):
  // podíl výher × průměrná výhra − podíl ztrát × průměrná ztráta. Jen
  // z obchodů, které R mají; breakeven do ní nevstupuje (je v průměru R).
  // Průměrná výhra / ztráta v R jdou ven jak jsou (Souhrn je ukazuje pod ní).
  function expectancyR(records) {
    const wins = records.filter(r => r.result === 'target' && has(r.rSigned)).map(r => r.rSigned);
    const losses = records.filter(r => r.result === 'stoploss' && has(r.rSigned)).map(r => r.rSigned);
    const n = wins.length + losses.length;
    const avgWinR = mean(wins), avgLossR = mean(losses);
    if (!n) return { value: null, n: 0, avgWinR, avgLossR };
    return { value: (wins.length / n) * (avgWinR || 0) + (losses.length / n) * (avgLossR || 0), n, avgWinR, avgLossR };
  }

  function rowStats(records) {
    const o = H.overall(records);
    const exp = expectancyR(records);
    const decided = records.filter(r => r.result === 'target' || r.result === 'stoploss').length;
    return {
      n: o.count,
      winRate: decided >= NO_PCT_BELOW ? o.winRate : null,
      wins: records.filter(r => r.result === 'target').length,
      decided,
      avgR: o.expectancyR,
      rCount: o.rCount,
      expectancyR: exp.value,
      expectancyN: exp.n,
      avgWinR: exp.avgWinR,
      avgLossR: exp.avgLossR,
      // P/L v USD jako v deníku (computeSkipLiveStats): pnlRaw targetů a stoplossů.
      pnl: o.pnl,
      grey: o.count < GREY
    };
  }

  // ------------------------------------------------------------- dimenze → výsledek

  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  const signedR = v => { const x = Math.round(v * 100) / 100; return (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x)) + ' R'; };

  function stateOf(second) {
    return second < GREY ? 'na' : second < WARN ? 'weak' : 'ok';
  }

  // Jedna skupina ve větě: „po trendu win 55 %, průměr +0,3 R (n 31)".
  function groupPhrase(row) {
    const parts = [];
    if (has(row.winRate)) parts.push(`win ${pct(row.winRate)}`);
    else if (row.decided) parts.push(`${row.wins} z ${row.decided} na cíli`);
    if (has(row.avgR)) parts.push(`průměr ${signedR(row.avgR)}`);
    return `${row.label} ${parts.join(', ') || 'bez výsledku'} (n ${row.n})`;
  }

  function dimensionResult(dim, perf) {
    const buckets = new Map();
    let unknown = 0;
    for (const r of perf) {
      const v = dim.valueOf(r);
      if (v.kind === 'unknown') { unknown++; continue; }
      const id = v.kind + '|' + v.key;
      if (!buckets.has(id)) buckets.set(id, { key: v.key, kind: v.kind, records: [] });
      buckets.get(id).records.push(r);
    }
    const position = key => { const i = dim.order.indexOf(key); return i < 0 ? dim.order.length : i; };
    const rows = [...buckets.values()]
      .map(b => ({ key: b.key, kind: b.kind, label: dim.labelOf(b.key), ...rowStats(b.records) }))
      .sort((a, b) => (a.kind === 'aside') - (b.kind === 'aside') || position(a.key) - position(b.key) || a.key.localeCompare(b.key));

    // Do porovnání jdou jen hodnoty a „vědomě žádná"; nevyplněno ani řádky stranou ne.
    const compared = rows.filter(r => r.kind !== 'aside').sort((a, b) => b.n - a.n);
    const known = compared.reduce((a, r) => a + r.n, 0);
    const aside = rows.filter(r => r.kind === 'aside').reduce((a, r) => a + r.n, 0);
    const second = compared.length > 1 ? compared[1].n : 0;
    const state = stateOf(second);

    const sizes = compared.length ? compared.slice(0, 3).map(r => `${r.label} ${r.n}`).join(', ') : 'žádná skupina';
    const lack = GREY - second;
    const missing = `${lack} ${plural(lack, 'obchod', 'obchody', 'obchodů')} v druhé největší skupině do ${GREY} `
      + `(vyplněno ${known} z ${perf.length}${aside ? `, stranou ${aside}` : ''}${unknown ? `, nevyplněno ${unknown}` : ''}; ${sizes})`;
    return {
      key: dim.key, group: dim.group, label: dim.label, lacks: dim.lacks,
      // compared = skupiny v porovnání od největší (při shodě v pořadí dimenze);
      // práh stojí na compared[1].
      rows, compared, unknown, known, aside, total: perf.length, second, state,
      // fact: co se ví – dvě nejpočetnější skupiny, žádný výběr „lepší".
      fact: state === 'na' ? null : `${dim.label}: ${compared.slice(0, 2).map(groupPhrase).join('; ')}`,
      headline: `${compared.length} ${plural(compared.length, 'skupina', 'skupiny', 'skupin')} · vyplněno ${known} z ${perf.length}${aside ? ` · stranou ${aside}` : ''}${unknown ? ` · nevyplněno ${unknown}` : ''}`,
      missing,
      // krátce pro souhrnnou větu skupiny
      missingShort: `${dim.label} (vyplněno ${known} z ${perf.length}` + (compared.length > 1 ? `, druhá skupina ${second})` : compared.length ? ', jen jedna skupina)' : ')')
    };
  }

  const STATES = ['ok', 'weak', 'na'];
  const best = list => list.reduce((a, s) => (STATES.indexOf(s) < STATES.indexOf(a) ? s : a), 'na');

  function computeContext(perf) {
    const dimensions = DIMENSIONS.map(dim => dimensionResult(dim, perf));
    const groups = GROUPS.map(g => {
      const dims = dimensions.filter(d => d.group === g.key);
      const running = dims.filter(d => d.state !== 'na');
      const na = dims.filter(d => d.state === 'na');
      return {
        key: g.key, label: g.label, dimensions: dims, state: best(dims.map(d => d.state)),
        headline: running.length
          ? `${running.length} z ${dims.length} ${plural(dims.length, 'dimenze', 'dimenzí', 'dimenzí')} má vzorek: ${running.map(d => d.label.toLowerCase()).join(', ')}`
          : `0 z ${dims.length} ${plural(dims.length, 'dimenze', 'dimenzí', 'dimenzí')} má vzorek`,
        missing: 'vzorek: ' + na.map(d => d.missingShort).join('; ') + ` – do porovnání je potřeba aspoň ${GREY} obchodů ve dvou skupinách`
      };
    });
    return { n: perf.length, dimensions, groups };
  }

  // Řádky pro blok „Co vyplnit": dimenze, která není „ví se" a má nevyplněné
  // obchody. Tvar jako řádek použitelnosti zdraví dat; kind 'context' je řadí
  // za hrdla analýz fáze 2.
  function fillRows(context) {
    return context.dimensions
      .filter(d => d.state !== 'ok' && d.unknown > 0)
      .map(d => ({ key: 'ctx-' + d.key, kind: 'context', label: d.label, n: d.known + d.aside, m: d.total, unit: 'obchodů', lacks: d.lacks, state: d.state }));
  }

  return {
    BUCKETS, GROUPS, DIMENSIONS, NO_PCT_BELOW, ALIGN_LABEL,
    bucketOf, expectancyR, rowStats, stateOf, dimensionResult, computeContext, fillRows
  };
}));
