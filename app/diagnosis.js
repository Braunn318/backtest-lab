'use strict';
// Diagnóza – „Kde ztrácím a kde vydělávám" (docs/ZADANI_LAB_PRESTAVBA.md §2).
//
// Katalog srovnání (§2.3) je JEDNO místo: COMPARISONS. Každé srovnání rozdělí
// obchody do skupin; každá skupina je karta s P/L v $, počtem, podílem targetů
// a DOPADEM = P/L skupiny − n × průměr P/L na obchod mimo skupinu. Podle dopadu
// se karty řadí: 5 s největší ztrátou, 3 s největším ziskem, zbytek ve „všech".
//
// PRAVIDLA:
//  - Množina = LabSequence.sequenceBase (jako Denní risk a Co kdyby): výchozí
//    přepínače, legacy obchody VSTUPUJÍ do $ (rozhodnutí 3. 10.), do R a ticků ne.
//    Obchod bez pnlRaw vypadne a spočítá se.
//  - Pořadí v dni se počítá nad zvoleným výběrem (instrument, období) – stejně
//    jako simulátor dne, ne přes celý deník.
//  - Nevyplněno je vždy vlastní skupina (kind 'unknown') a nikdy nespadne do
//    „žádná / ne" (kind 'none'). Do top karet nejde – není to podmínka obchodu.
//  - Skupina pod 10 obchodů (SAMPLE_GREY) v top není, jen ve „všech" (stav na),
//    10–29 = předběžně (weak). Prahy se nesnižují.
//  - Ruční prahy jen tady: koše pořadí, počtu SL, počtu obchodů za den a psychiky.
//  - Věty říkají fakt, nic nedoporučují.
//
// Čte jen výstup LabNormalize; karta „Vstup, SL nebo cíl?" bere čísla z LabSlTp.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? ['./sequence.js', './sltp.js', './context.js', './labels.js', './views.js'].map(f => require(f))
    : [root.LabSequence, root.LabSlTp, root.LabContext, root.LabLabels, root.LabViews];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabDiagnosis = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (SQ, S, CX, L, V) {

  const GREY = S.SAMPLE_GREY;
  const WARN = S.SAMPLE_WARN;
  const TOP_LOSS = 5;
  const TOP_GAIN = 3;
  const has = v => v !== null && v !== undefined;
  const sum = list => list.reduce((a, v) => a + v, 0);
  const mean = list => (list.length ? sum(list) / list.length : null);

  // Výchozí seznamy slov (§2.3) – upravitelné v Data → Nastavení diagnózy.
  const DEFAULT_WORDS = {
    emotion: ['fomo', 'nasran', 'vztek', 'unaven', 'revenge', 'netrpěliv', 'nervy', 'strach'],
    technical: ['chyba', 'technical', 'easytrade', 'easy trade', 'špatně naplněn', 'zmrvená limitka']
  };

  // Bez diakritiky a velikosti písmen.
  function fold(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function wordsOf(views = {}) {
    const saved = V.sanitizeWords(views.diagWords) || {};
    return { emotion: saved.emotion || DEFAULT_WORDS.emotion, technical: saved.technical || DEFAULT_WORDS.technical };
  }

  // Poznámka obchodu a plán dne (setup / psychika / poznámka), který deník kopíruje k obchodu.
  function noteTextOf(r) {
    const p = r.dailyPlan || {};
    return [r.comment, p.setup, p.psychology, p.note].filter(Boolean).join('\n');
  }

  function matchedWords(r, words) {
    const text = fold(noteTextOf(r));
    if (!text) return [];
    return [...new Set((words || []).map(w => String(w).trim().toLowerCase()).filter(w => w && text.includes(fold(w))))];
  }

  function stateOf(n) {
    return n < GREY ? 'na' : n < WARN ? 'weak' : 'ok';
  }

  // ------------------------------------------------------------- množina a dny

  function baseOf(records, options = {}) {
    const b = SQ.sequenceBase(records, options);
    const trades = b.ordered.filter(r => has(r.pnlRaw));
    return {
      trades,
      missingPnl: b.ordered.length - trades.length,
      legacy: trades.filter(r => r.isLegacy).length,
      days: new Set(trades.map(r => r.date).filter(Boolean)).size
    };
  }

  // Pořadí v dni, výsledek předchozího obchodu a kolik SL ten den už bylo – nad
  // seřazenou množinou (datum, čas vstupu). Plus průběh dne v $ (maximum, konec).
  function dayInfoOf(trades) {
    const info = new Map();
    const days = [];
    let current = null;
    for (const r of trades) {
      if (!current || current.date !== r.date) {
        current = { date: r.date, trades: [], cum: 0, peak: 0, sl: 0 };
        days.push(current);
      }
      const prev = current.trades[current.trades.length - 1];
      info.set(r, {
        no: current.trades.length + 1,
        prev: prev ? (prev.result === 'target' || prev.result === 'stoploss' || prev.result === 'breakeven' ? prev.result : 'other') : 'FIRST',
        slBefore: current.sl
      });
      current.trades.push(r);
      if (r.result === 'stoploss') current.sl++;
      current.cum += r.pnlRaw;
      current.peak = Math.max(current.peak, current.cum);
    }
    for (const d of days) {
      d.pnl = d.cum;
      d.count = d.trades.length;
      for (const r of d.trades) info.get(r).dayCount = d.count;
    }
    return { info, days };
  }

  // ------------------------------------------------------------- katalog srovnání

  const UNKNOWN = 'UNKNOWN';
  const dim = key => CX.DIMENSIONS.find(d => d.key === key);
  // Dimenze Kontextu (tři stavy) → klíč skupiny; nevyplněno = UNKNOWN. Vědomé
  // „nevím" typu dne (hodnota UNKNOWN deníku) je jiná skupina: DAY_UNKNOWN.
  const VOCAB_UNKNOWN = 'DAY_UNKNOWN';
  const fromDim = key => r => {
    const v = dim(key).valueOf(r);
    if (v.kind === 'unknown') return UNKNOWN;
    return v.key === UNKNOWN ? VOCAB_UNKNOWN : v.key;
  };
  const kindOfKeys = noneKeys => k => (k === UNKNOWN ? 'unknown' : noneKeys.includes(k) ? 'none' : 'value');
  const labelFromDim = (key, prefix) => k => (k === UNKNOWN ? `${prefix}: nevyplněno`
    : `${prefix}: ${dim(key).labelOf(k === VOCAB_UNKNOWN ? UNKNOWN : k)}`);

  const ABS_RE = /^ABS_/;
  function orderFlowOf(r) {
    if (r.ofConfirmState === 'unknown') return UNKNOWN;
    if (r.ofConfirmState === 'none') return 'NONE';
    return r.ofConfirm.some(k => ABS_RE.test(k)) ? 'ABS' : 'OTHER';
  }

  function psychOf(r) {
    const n = Number(String(r.psychBefore == null ? '' : r.psychBefore).replace(',', '.'));
    if (r.psychBefore == null || !Number.isFinite(n)) return UNKNOWN;
    return n <= 3 ? '1-3' : n <= 5 ? '4-5' : '6-8';
  }

  const fixed = groups => ({ groups });
  // when: 'before' = známé před vstupem (smí do filtrů Co kdyby), 'after' = zapsané
  // až po obchodu, 'day' = průběh dne (pravidla dne v Co kdyby).
  const COMPARISONS = [
    {
      key: 'order', title: 'Pořadí obchodu v dni', when: 'day',
      ...fixed([['1', '1. obchod dne'], ['2', '2. obchod dne'], ['3', '3. obchod dne'], ['4', '4. a další obchod dne']]),
      groupOf: (r, i) => (i.no >= 4 ? '4' : String(i.no))
    },
    {
      key: 'prev', title: 'Po čem obchod přišel', when: 'day',
      ...fixed([['FIRST', 'První obchod dne'], ['stoploss', 'Obchod po SL'], ['target', 'Obchod po targetu'], ['breakeven', 'Obchod po BE'], ['other', 'Obchod po jiném výsledku']]),
      groupOf: (r, i) => i.prev
    },
    {
      key: 'slBefore', title: 'Kolik SL už ten den bylo', when: 'day',
      ...fixed([['0', 'Před prvním SL dne'], ['1', 'Po jednom SL ve stejný den'], ['2', 'Po dvou a více SL ve stejný den']]),
      groupOf: (r, i) => (i.slBefore >= 2 ? '2' : String(i.slBefore))
    },
    {
      key: 'dayCount', title: 'Dny podle počtu obchodů', when: 'day', unit: 'day',
      ...fixed([['2', 'Dny s nejvýš 2 obchody'], ['3', 'Dny se 3–4 obchody'], ['5', 'Dny s 5 a více obchody']]),
      groupOf: (r, i) => (i.dayCount <= 2 ? '2' : i.dayCount <= 4 ? '3' : '5')
    },
    { key: 'giveBack', title: 'Vrácený zisk', when: 'day', special: true },
    {
      key: 'emotion', title: 'Emoce v poznámce', when: 'after',
      groups: [['MATCH', 'Obchody s emocí v poznámce'], ['REST', 'Obchody bez emoce v poznámce', 'rest']],
      groupOf: (r, i, ctx) => (matchedWords(r, ctx.words.emotion).length ? 'MATCH' : 'REST')
    },
    {
      key: 'technical', title: 'Technická chyba v poznámce', when: 'after',
      groups: [['MATCH', 'Obchody s technickou chybou v poznámce'], ['REST', 'Obchody bez technické chyby v poznámce', 'rest']],
      groupOf: (r, i, ctx) => (matchedWords(r, ctx.words.technical).length ? 'MATCH' : 'REST')
    },
    {
      key: 'setup', title: 'Setup', when: 'before', dynamic: true,
      labelOf: k => (k === UNKNOWN ? 'Bez setupu' : `Setup ${L.labelOf('SETUP', k)}`),
      groupOf: r => r.setupCode || UNKNOWN
    },
    {
      key: 'orderFlow', title: 'Order flow', when: 'before',
      groups: [['ABS', 'S absorpcí (ABS) v order flow'], ['OTHER', 'Jiné potvrzení order flow bez ABS'], ['NONE', 'Order flow „žádné"', 'none'], [UNKNOWN, 'Order flow nevyplněno', 'unknown']],
      groupOf: orderFlowOf
    },
    {
      key: 'targetType', title: 'Typ cíle', when: 'before', dynamic: true,
      labelOf: k => (k === UNKNOWN ? 'Typ cíle nevyplněn' : `Cíl ${L.labelOf('TARGET_LEVEL', k)}`),
      groupOf: r => (r.targetLevel1 && r.targetLevel1.type) || UNKNOWN
    },
    {
      key: 'grade', title: 'Známka', when: 'before',
      groups: [['A', 'Známka A'], ['B', 'Známka B'], ['C', 'Známka C'], [UNKNOWN, 'Bez známky', 'unknown']],
      groupOf: r => (['A', 'B', 'C'].includes(r.grade) ? r.grade : UNKNOWN)
    },
    {
      key: 'side', title: 'Směr', when: 'before',
      groups: [['long', 'Long'], ['short', 'Short'], [UNKNOWN, 'Směr nevyplněn', 'unknown']],
      groupOf: r => (r.side === 'long' || r.side === 'short' ? r.side : UNKNOWN)
    },
    {
      key: 'session', title: 'Seance', when: 'before', dynamic: true,
      labelOf: k => (k === UNKNOWN ? 'Seance neznámá' : `Seance ${L.labelOf('SESSION', k)}`),
      groupOf: r => (r.ctx.session.state === 'value' ? r.ctx.session.value : UNKNOWN)
    },
    {
      key: 'trendHtf', title: 'Trend 30m vůči směru', when: 'before',
      groups: [['WITH', 'Po trendu 30m'], ['AGAINST', 'Proti trendu 30m'], ['RANGE', 'Trend 30m range'], [UNKNOWN, 'Trend 30m nevyplněn', 'unknown']],
      groupOf: fromDim('trendHtfAlign')
    },
    {
      key: 'absLocation', title: 'Absorpce – kde', when: 'before',
      groups: [['EXTREME', 'Absorpce na extrému'], ['MIDDLE', 'Absorpce uprostřed'], ['NONE', 'Bez absorpce', 'none'], [UNKNOWN, 'Absorpce nevyplněna', 'unknown']],
      groupOf: fromDim('absLocation')
    },
    {
      key: 'psychBefore', title: 'Psychika před vstupem', when: 'before',
      groups: [['1-3', 'Psychika před vstupem 1–3'], ['4-5', 'Psychika před vstupem 4–5'], ['6-8', 'Psychika před vstupem 6–8'], [UNKNOWN, 'Psychika nevyplněna', 'unknown']],
      groupOf: psychOf
    },
    {
      key: 'openVsValue', title: 'Kontext dne – open vůči value', when: 'day', dynamic: true,
      labelOf: labelFromDim('openVsValue', 'Open'), kindOf: kindOfKeys([]), groupOf: fromDim('openVsValue')
    },
    {
      key: 'dayTypeActual', title: 'Kontext dne – typ dne skutečný', when: 'day', dynamic: true,
      labelOf: labelFromDim('dayTypeActual', 'Typ dne'), kindOf: kindOfKeys([VOCAB_UNKNOWN]), groupOf: fromDim('dayTypeActual')
    },
    {
      key: 'newsEvent', title: 'Kontext dne – zprávy', when: 'day', dynamic: true,
      labelOf: labelFromDim('newsEvent', 'Zprávy'), kindOf: kindOfKeys(['NONE']), groupOf: fromDim('newsEvent')
    }
  ];

  // Klíče skupin, podle kterých jde obchod vyřadit (filtry B v Co kdyby).
  function filterKeysOf(r) {
    const out = {};
    for (const c of COMPARISONS) if (c.when === 'before' && c.groupOf) out[c.key] = c.groupOf(r, {}, {});
    return out;
  }

  // Skupiny srovnání, které jde vybrat ve filtrech (z dat + pevné).
  function groupChoices(trades, key) {
    const c = COMPARISONS.find(x => x.key === key);
    const keys = c.dynamic ? [...new Set(trades.map(r => c.groupOf(r, {}, {})))] : c.groups.map(g => g[0]);
    return keys.map(k => ({ key: k, label: groupLabel(c, k), kind: groupKind(c, k) }));
  }

  function groupLabel(c, key) {
    if (c.dynamic) return c.labelOf(key);
    const g = c.groups.find(x => x[0] === key);
    return g ? g[1] : key;
  }

  function groupKind(c, key) {
    if (c.kindOf) return c.kindOf(key);
    if (c.dynamic) return key === UNKNOWN ? 'unknown' : 'value';
    const g = c.groups.find(x => x[0] === key);
    return (g && g[2]) || (key === UNKNOWN ? 'unknown' : 'value');
  }

  // ------------------------------------------------------------- čísla skupiny

  function statsOf(list) {
    const pnl = sum(list.map(r => r.pnlRaw));
    const targets = list.filter(r => r.result === 'target').length;
    return {
      n: list.length,
      pnl,
      targets,
      stops: list.filter(r => r.result === 'stoploss').length,
      targetPct: list.length ? targets / list.length : null,
      avg: list.length ? pnl / list.length : null,
      days: new Set(list.map(r => r.date).filter(Boolean)).size
    };
  }

  // Dopad = P/L skupiny − n × průměr P/L na obchod mimo skupinu. Bez zbytku null.
  function impactOf(group, rest) {
    if (!rest || !rest.n) return null;
    return group.pnl - group.n * (rest.pnl / rest.n);
  }

  function compareGroups(c, trades, info, ctx, total) {
    const buckets = new Map();
    if (!c.dynamic) for (const [key] of c.groups) buckets.set(key, []);
    for (const r of trades) {
      const key = c.groupOf(r, info.get(r), ctx);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    let keys = [...buckets.keys()];
    // Dynamické skupiny od největší, nevyplněno na konec.
    if (c.dynamic) keys = keys.sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || buckets.get(b).length - buckets.get(a).length || String(a).localeCompare(String(b)));
    return keys.map(key => {
      const list = buckets.get(key);
      const st = statsOf(list);
      const rest = { n: total.n - st.n, pnl: total.pnl - st.pnl };
      rest.avg = rest.n ? rest.pnl / rest.n : null;
      return {
        id: `${c.key}:${key}`, comparison: c.key, comparisonTitle: c.title, unit: c.unit || 'trade',
        key, label: groupLabel(c, key), kind: groupKind(c, key),
        ...st, rest, impact: impactOf(st, rest), state: stateOf(st.n), records: list
      };
    });
  }

  // #5 vrácený zisk: dny, které byly během dne v plusu (maximum dne > 0) – kolik
  // vrátily z denního maxima a kolik jich skončilo v mínusu. Dopad = −vráceno.
  function giveBackOf(days) {
    const list = days.filter(d => d.peak > 0).map(d => ({ date: d.date, peak: d.peak, end: d.pnl, givenBack: d.peak - d.pnl, trades: d.trades }));
    const givenBack = sum(list.map(d => d.givenBack));
    return {
      id: 'giveBack', comparison: 'giveBack', comparisonTitle: 'Vrácený zisk', unit: 'day', key: 'giveBack', kind: 'value',
      label: 'Dny, které byly během dne v plusu',
      days: list.length, n: list.length, givenBack, endedNegative: list.filter(d => d.end < 0).length,
      pnl: sum(list.map(d => d.end)), dayList: list,
      records: list.flatMap(d => d.trades),
      impact: list.length ? -givenBack : null, state: stateOf(list.length)
    };
  }

  // Top karty: bez nevyplněno, bez „ostatních" (doplněk skupiny), stejná množina obchodů jen jednou.
  function topCards(cards, index) {
    const eligible = cards.filter(c => has(c.impact) && c.kind !== 'unknown' && c.kind !== 'rest' && c.state !== 'na');
    const pick = (list, count) => {
      const seen = new Set(), out = [];
      for (const c of list) {
        const sig = c.records.map(r => index.get(r)).sort((a, b) => a - b).join(',');
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(c);
        if (out.length === count) break;
      }
      return out;
    };
    return {
      loss: pick(eligible.filter(c => c.impact < 0).sort((a, b) => a.impact - b.impact), TOP_LOSS),
      gain: pick(eligible.filter(c => c.impact > 0).sort((a, b) => b.impact - a.impact), TOP_GAIN)
    };
  }

  // ------------------------------------------------------------- hlavička

  function mondayOf(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  // P/L po týdnech (týden od pondělí). pnlOf umí i jiný P/L než pnlRaw (Co kdyby).
  function weeklyOf(items, pnlOf = r => r.pnlRaw, dateOf = r => r.date) {
    const weeks = new Map();
    for (const x of items) {
      const w = mondayOf(dateOf(x));
      if (!w) continue;
      if (!weeks.has(w)) weeks.set(w, { week: w, pnl: 0, n: 0 });
      const row = weeks.get(w);
      row.pnl += pnlOf(x);
      row.n++;
    }
    return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  }

  // Win % = targety z rozhodnutých (target + SL), R jen u obchodů, které ho mají
  // (legacy ne). Poplatek v R = komise ÷ riziko obchodu (SL × tick × kontrakty).
  // Win % potřebné na nulu: p × výhra = (1 − p) × ztráta + poplatek → p = (ztráta + poplatek) ÷ (výhra + ztráta).
  function headerOf(trades) {
    const st = statsOf(trades);
    const wins = trades.filter(r => r.result === 'target');
    const losses = trades.filter(r => r.result === 'stoploss');
    const winR = wins.map(r => r.rSigned).filter(has);
    const lossR = losses.map(r => r.rSigned).filter(has);
    const feeRs = trades.filter(r => r.riskUSD > 0).map(r => (r.commission || 0) / r.riskUSD);
    const avgWinR = mean(winR), avgLossR = mean(lossR), feeR = mean(feeRs);
    const W = avgWinR, Lo = has(avgLossR) ? Math.abs(avgLossR) : null;
    return {
      n: st.n,
      pnl: st.pnl,
      fees: sum(trades.map(r => r.commission || 0)),
      targets: wins.length,
      stops: losses.length,
      winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
      avgWinR, avgLossR, winRN: winR.length, lossRN: lossR.length,
      feeR, feeN: feeRs.length,
      breakEvenWinRate: has(W) && has(Lo) && has(feeR) && W + Lo > 0 ? (Lo + feeR) / (W + Lo) : null,
      days: st.days,
      legacy: trades.filter(r => r.isLegacy).length
    };
  }

  // ------------------------------------------------------------- 2.4 vstup, SL nebo cíl

  // Všechna čísla z LabSlTp (stejné funkce jako obrazovka SL a TP), nad obchody
  // s ticky – legacy do ticků nevstupují.
  function entrySlTargetOf(trades) {
    const perf = trades.filter(r => !r.isLegacy);
    const m = S.mfeStopped(perf);
    const w = S.maeWinners(perf);
    const tp = S.tpAfter(perf);
    const oneR = m.byR.find(x => x.r === 1);
    return {
      noRunTicks: S.ENTRY_NO_RUN_TICKS,
      entry: {
        n: m.n, stopped: m.stopped, noRun: m.noRun.length, zero: m.zero.length,
        oneR: oneR ? oneR.reach : 0, oneRN: oneR ? oneR.n : 0, state: stateOf(m.n),
        records: { measured: m.measured, noRun: m.noRun, zero: m.zero, oneR: m.reachOneR }
      },
      sl: { n: w.n, winners: w.winners, p90: w.p90, medianSl: S.slMedian(perf), slN: perf.filter(r => has(r.slTicks)).length, state: stateOf(w.n), records: w.records },
      target: { n: tp.n, targets: tp.targets, p50: tp.p50, oneR: tp.oneR.records.length, oneRN: tp.oneR.n, state: stateOf(tp.n), records: { observed: tp.observed, oneR: tp.oneR.records } }
    };
  }

  // ------------------------------------------------------------- celek

  function computeDiagnosis(records, options = {}, opts = {}) {
    const base = baseOf(records, options);
    const trades = base.trades;
    const { info, days } = dayInfoOf(trades);
    const ctx = { words: opts.words || DEFAULT_WORDS };
    const total = { n: trades.length, pnl: sum(trades.map(r => r.pnlRaw)) };
    const index = new Map(trades.map((r, i) => [r, i]));
    const giveBack = giveBackOf(days);
    const comparisons = COMPARISONS.map(c => (c.special
      ? { key: c.key, title: c.title, when: c.when, special: true, groups: [giveBack] }
      : { key: c.key, title: c.title, when: c.when, unit: c.unit || 'trade', groups: compareGroups(c, trades, info, ctx, total) }));
    const cards = comparisons.flatMap(c => c.groups);
    return {
      base,
      header: headerOf(trades),
      weekly: weeklyOf(trades),
      comparisons,
      cards,
      top: topCards(cards, index),
      giveBack,
      entrySlTarget: entrySlTargetOf(trades),
      words: ctx.words,
      dayInfo: info
    };
  }

  return {
    GREY, WARN, TOP_LOSS, TOP_GAIN, DEFAULT_WORDS, COMPARISONS, UNKNOWN,
    fold, wordsOf, noteTextOf, matchedWords, stateOf, baseOf, dayInfoOf, statsOf, impactOf,
    filterKeysOf, groupChoices, groupLabel, mondayOf, weeklyOf, headerOf, entrySlTargetOf, computeDiagnosis
  };
}));
