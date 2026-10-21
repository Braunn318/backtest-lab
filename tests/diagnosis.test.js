'use strict';
// Diagnóza – „Kde ztrácím a kde vydělávám" (docs/ZADANI_LAB_PRESTAVBA.md §2, testy §5.2–5.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const DG = require('../app/diagnosis.js');
const S = require('../app/sltp.js');
const { trade, stop, normAll, many } = require('./helpers/records.js');

const day = d => `2026-08-${String(d).padStart(2, '0')}`;
// Obchod s daným P/L v $ (target / stop podle znaménka), jeden za den, ať pořadí v dni nemíchá skupiny.
let dayNo = 0;
function pnlTrade(pnl, over = {}) {
  dayNo = dayNo % 28 + 1;
  const make = pnl >= 0 ? trade : stop;
  return make({ pnlRaw: pnl, date: day(dayNo), entryTime: '15:00', ...over });
}
const groupOf = (res, comp, key) => res.comparisons.find(c => c.key === comp).groups.find(g => g.key === key);

// ---------------------------------------------------------------- 2. dopad, řazení, práh

test('dopad = P/L skupiny − n × průměr P/L na obchod mimo skupinu', () => {
  assert.equal(DG.impactOf({ n: 12, pnl: -120 }, { n: 20, pnl: 100 }), -120 - 12 * 5);
  assert.equal(DG.impactOf({ n: 3, pnl: 30 }, { n: 0, pnl: 0 }), null, 'bez zbytku není s čím srovnat');

  dayNo = 0;
  const raws = [
    ...many(12, () => pnlTrade(-10, { setupCode: 'M2_TREND' })),
    ...many(20, () => pnlTrade(5, { setupCode: 'M2_OF' })),
    ...many(5, () => pnlTrade(-50, { setupCode: 'M2_DELTA' }))
  ];
  const res = DG.computeDiagnosis(normAll(raws), {});
  const trend = groupOf(res, 'setup', 'M2_TREND');
  assert.equal(trend.n, 12);
  assert.equal(Math.round(trend.pnl), -120);
  const restAvg = (100 - 250) / 25;
  assert.equal(Math.round(trend.impact * 100) / 100, Math.round((-120 - 12 * restAvg) * 100) / 100);
  assert.equal(trend.state, 'weak', '10–29 obchodů = předběžně');
});

test('řazení podle dopadu: 5 nejhorších, 3 nejlepší; skupina pod 10 obchodů není v top, jen ve všech (zešedle)', () => {
  dayNo = 0;
  const raws = [
    ...many(12, () => pnlTrade(-10, { setupCode: 'M2_TREND' })),
    ...many(14, () => pnlTrade(-4, { setupCode: 'M2_PA' })),
    ...many(20, () => pnlTrade(6, { setupCode: 'M2_OF' })),
    ...many(5, () => pnlTrade(-80, { setupCode: 'M2_DELTA' }))
  ];
  const res = DG.computeDiagnosis(normAll(raws), {});
  assert.ok(res.top.loss.length <= 5 && res.top.gain.length <= 3);
  const impacts = res.top.loss.map(c => c.impact);
  assert.deepEqual(impacts, [...impacts].sort((a, b) => a - b), 'ztráty od největšího dopadu');
  assert.ok(res.top.loss.every(c => c.impact < 0 && c.n >= 10));
  const gains = res.top.gain.map(c => c.impact);
  assert.deepEqual(gains, [...gains].sort((a, b) => b - a));
  assert.ok(res.top.gain.every(c => c.impact > 0 && c.n >= 10));
  const ids = [...res.top.loss, ...res.top.gain].map(c => c.id);
  assert.equal(ids.includes('setup:M2_DELTA'), false, 'skupina pod 10 obchodů v top není');
  const delta = groupOf(res, 'setup', 'M2_DELTA');
  assert.equal(delta.n, 5);
  assert.equal(delta.state, 'na');
  assert.ok(res.cards.some(c => c.id === 'setup:M2_DELTA'), 've všech srovnáních je');
});

test('stejná množina obchodů ve dvou srovnáních je v top jen jednou (1. obchod dne = první v dni)', () => {
  const raws = [];
  for (let d = 1; d <= 14; d++) {
    raws.push(stop({ date: day(d), entryTime: '15:00', pnlRaw: -30 }));
    raws.push(trade({ date: day(d), entryTime: '15:30', pnlRaw: 20 }));
  }
  const res = DG.computeDiagnosis(normAll(raws), {});
  const top = [...res.top.loss, ...res.top.gain];
  const firstOrder = top.filter(c => c.id === 'order:1' || c.id === 'prev:FIRST');
  assert.equal(firstOrder.length, 1);
});

// ---------------------------------------------------------------- 3. nevyplněno je vlastní skupina

test('nevyplněno je vlastní skupina a nikdy se nepočítá jako „žádná / ne"', () => {
  const raws = [
    ...many(11, () => trade({ ofConfirm: ['NONE'], absLocation: 'NONE', grade: 'A' })),
    ...many(12, () => trade({ ofConfirm: [], absLocation: '', grade: '' })),
    ...many(10, () => stop({ ofConfirm: ['ABS_BID'], absLocation: 'EXTREME', grade: 'B' }))
  ];
  const res = DG.computeDiagnosis(normAll(raws), {});
  const none = groupOf(res, 'orderFlow', 'NONE');
  const unknown = groupOf(res, 'orderFlow', 'UNKNOWN');
  assert.equal(none.n, 11);
  assert.equal(none.kind, 'none');
  assert.equal(unknown.n, 12);
  assert.equal(unknown.kind, 'unknown');
  assert.equal(groupOf(res, 'absLocation', 'NONE').n, 11);
  assert.equal(groupOf(res, 'absLocation', 'UNKNOWN').n, 12);
  assert.equal(groupOf(res, 'grade', 'UNKNOWN').n, 12);
  // Nevyplněno do top karet nejde – není to podmínka obchodu.
  assert.ok([...res.top.loss, ...res.top.gain].every(c => c.kind !== 'unknown'));
});

// ---------------------------------------------------------------- 4. slova v poznámce

test('hledání slov bez diakritiky a velikosti písmen v poznámce i v plánu dne', () => {
  assert.equal(DG.fold('Nasrán, ÚNAVA'), 'nasran, unava');
  const words = DG.DEFAULT_WORDS.emotion;
  const rec = normAll([
    trade({ comment: 'Vstup z FOMO' }),
    trade({ comment: '', dailyPlan: { setup: '', psychology: 'Unaven, nasrán', note: '' } }),
    trade({ comment: 'čistý obchod', dailyPlan: { setup: 'M2', psychology: 'klid', note: '' } })
  ]);
  assert.deepEqual(DG.matchedWords(rec[0], words), ['fomo']);
  assert.deepEqual(DG.matchedWords(rec[1], words).sort(), ['nasran', 'unaven']);
  assert.deepEqual(DG.matchedWords(rec[2], words), []);
  // Slovo v seznamu s diakritikou najde text bez ní a naopak.
  assert.deepEqual(DG.matchedWords(rec[2], ['ČISTÝ']), ['čistý']);
  assert.deepEqual(DG.matchedWords(normAll([trade({ comment: 'Easy Trade' })])[0], DG.DEFAULT_WORDS.technical), ['easy trade']);
});

test('úprava seznamu slov se projeví ve skupinách', () => {
  const raws = [...many(12, () => trade({ comment: 'fomo vstup' })), ...many(12, () => stop({ comment: 'pozdě' }))];
  const recs = normAll(raws);
  const a = DG.computeDiagnosis(recs, {});
  assert.equal(groupOf(a, 'emotion', 'MATCH').n, 12);
  const b = DG.computeDiagnosis(recs, {}, { words: { emotion: ['pozdě'], technical: [] } });
  assert.equal(groupOf(b, 'emotion', 'MATCH').n, 12);
  assert.equal(groupOf(b, 'emotion', 'MATCH').records.every(r => r.result === 'stoploss'), true);
  assert.equal(groupOf(b, 'technical', 'MATCH').n, 0);
  // Prázdný seznam = výchozí stav pohledů (nic se neukládá), ne „žádné slovo".
  assert.deepEqual(DG.wordsOf({}), DG.DEFAULT_WORDS);
  assert.deepEqual(DG.wordsOf({ diagWords: { emotion: ['x'] } }).technical, DG.DEFAULT_WORDS.technical);
});

// ---------------------------------------------------------------- pořadí v dni, SL v dni, dny, vrácený zisk

test('pořadí v dni, SL před obchodem, dny podle počtu obchodů a vrácený zisk', () => {
  const d1 = [
    stop({ date: day(1), entryTime: '15:00', pnlRaw: -30 }),
    stop({ date: day(1), entryTime: '15:10', pnlRaw: -30 }),
    trade({ date: day(1), entryTime: '15:20', pnlRaw: 50 }),
    stop({ date: day(1), entryTime: '15:30', pnlRaw: -30 }),
    stop({ date: day(1), entryTime: '15:40', pnlRaw: -30 })
  ];
  // Den 2: +60, pak −80 → maximum 60, konec −20 → vráceno 80, skončil v mínusu.
  const d2 = [trade({ date: day(2), entryTime: '15:00', pnlRaw: 60 }), stop({ date: day(2), entryTime: '15:10', pnlRaw: -80 })];
  const res = DG.computeDiagnosis(normAll([...d1, ...d2]), {});
  assert.equal(groupOf(res, 'order', '1').n, 2);
  assert.equal(groupOf(res, 'order', '4').n, 2, '4. a další');
  assert.equal(groupOf(res, 'slBefore', '2').n, 3, 'po 2+ SL ve stejný den');
  assert.equal(groupOf(res, 'prev', 'stoploss').n, 3);
  const five = groupOf(res, 'dayCount', '5');
  assert.equal(five.days, 1);
  assert.equal(five.n, 5);
  assert.equal(res.giveBack.days, 1, 'den 1 nebyl nikdy v plusu');
  assert.equal(res.giveBack.givenBack, 80);
  assert.equal(res.giveBack.endedNegative, 1);
});

// ---------------------------------------------------------------- 2.4 vstup, SL nebo cíl

test('karta „Vstup, SL nebo cíl?" bere čísla z LabSlTp (nic se nepočítá dvakrát)', () => {
  const raws = [
    ...many(6, () => stop({ mfeTicks: 1 })),
    ...many(3, () => stop({ mfeTicks: 0 })),
    ...many(4, () => stop({ mfeTicks: 14 })),
    ...many(12, () => trade({ maeTicks: 4, postExitFavorableTicks: 15 }))
  ];
  const recs = normAll(raws);
  const res = DG.computeDiagnosis(recs, {});
  const perf = recs.filter(r => !r.isLegacy);
  const m = S.mfeStopped(perf);
  const e = res.entrySlTarget;
  assert.equal(S.ENTRY_NO_RUN_TICKS, 2);
  assert.equal(e.entry.n, m.n);
  assert.equal(e.entry.noRun, m.noRun.length);
  assert.equal(e.entry.noRun, 9);
  assert.equal(e.entry.zero, 3);
  assert.equal(e.entry.oneR, m.byR.find(x => x.r === 1).reach);
  assert.equal(e.sl.p90, S.maeWinners(perf).p90);
  assert.equal(e.sl.medianSl, S.slMedian(perf));
  assert.equal(e.target.p50, S.tpAfter(perf).p50);
  assert.equal(e.target.oneR, 12, 'pokračování 15 t ≥ SL 12 t');
});

// ---------------------------------------------------------------- hlavička

test('hlavička: P/L, poplatky, win % a win % potřebné na nulu', () => {
  const raws = [
    ...many(10, () => trade({ pnlRaw: 26.2, commission: 3.8, contracts: 2, rMultiple: 2, exitTicks: 24, slTicks: 12, instrument: 'MES' })),
    ...many(10, () => stop({ pnlRaw: -33.8, commission: 3.8, contracts: 2, rMultiple: 1, exitTicks: -12, slTicks: 12, instrument: 'MES' }))
  ];
  const h = DG.computeDiagnosis(normAll(raws), {}).header;
  assert.equal(h.n, 20);
  assert.equal(Math.round(h.pnl * 10) / 10, -76);
  assert.equal(Math.round(h.fees * 10) / 10, 76);
  assert.equal(h.winRate, 0.5);
  assert.equal(h.avgWinR, 2);
  assert.equal(h.avgLossR, -1);
  // 1 R = 12 t × 1,25 × 2 = 30 $ → poplatek 3,8 / 30 R na obchod.
  assert.equal(Math.round(h.feeR * 10000) / 10000, Math.round(3.8 / 30 * 10000) / 10000);
  assert.equal(Math.round(h.breakEvenWinRate * 10000) / 10000, Math.round((1 + 3.8 / 30) / 3 * 10000) / 10000);
  assert.ok(Array.isArray(DG.computeDiagnosis(normAll(raws), {}).weekly));
});
