'use strict';
// Hladiny – statistika místo pravidel (docs/ZADANI_KONTEXT_V3.md B2, testy B4/2–4).
// Žádná tolerance, žádné role: poloha p = fromEntry, dráha ceny [−MAE, +MFE].
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../app/strength.js');
const { trade, stop, norm } = require('./helpers/records.js');

// Obchod z helperu (ES long, SL 12 t pod, cíl 24 t nad) s hladinami p ticků od vstupu.
function at(make, levels, over = {}) {
  const raw = make(over);
  const entry = Number(raw.entryPrice);
  delete raw.nearLevelsNone;
  raw.nearLevels = levels.map(([level, p, extra]) => ({ level, price: entry + p * 0.25, ...(extra || {}) }));
  return raw;
}
const touchedOf = res => res.rows.filter(x => x.status === 'touched');

test('dotčena = poloha leží v dráze [−MAE, +MFE]; přesah pro p > 0 i p ≤ 0 (B4/3)', () => {
  assert.deepEqual(ST.classify(5, 10, 3), { status: 'touched', overshoot: 5 });
  assert.deepEqual(ST.classify(5, 5, 3), { status: 'touched', overshoot: 0 }, 'cena přesně na hladinu = dotčena');
  assert.deepEqual(ST.classify(5, 4, 30), { status: 'untouched' });
  assert.deepEqual(ST.classify(-3, 0, 3), { status: 'touched', overshoot: 0 });
  assert.deepEqual(ST.classify(-3, 50, 2), { status: 'untouched' });
  assert.deepEqual(ST.classify(-3, null, 7), { status: 'touched', overshoot: 4 });
  // Hladina na vstupu je dotčena vždy (limitka se přes ni plnila).
  assert.deepEqual(ST.classify(0, null, 0), { status: 'touched', overshoot: 0 });
  // Hladina 2 t nad vstupem do longu, MAE 0: rozhoduje MFE, ne MAE.
  assert.deepEqual(ST.classify(2, 6, 0), { status: 'touched', overshoot: 4 });
  assert.deepEqual(ST.classify(-2, 6, 0), { status: 'untouched' }, 'hladina pod vstupem do longu s MAE 0');
  // Bez polohy nebo bez potřebné naměřené dráhy nejde rozhodnout.
  assert.deepEqual(ST.classify(null, 10, 10), { status: 'noDistance' });
  assert.deepEqual(ST.classify(2, null, 10), { status: 'noExcursion' });
  assert.deepEqual(ST.classify(-2, 10, null), { status: 'noExcursion' });
});

test('B4/2: nedotčená hladina nevstupuje do přesahu ani do výsledku', () => {
  const recs = norm([
    at(trade, [['VAL', 4]], { mfeTicks: 10 }), at(trade, [['VAL', 4]], { mfeTicks: 12 }), at(trade, [['VAL', 4]], { mfeTicks: 14 }),
    at(stop, [['VAL', 4]], { mfeTicks: 1 }), at(stop, [['VAL', 4]], { mfeTicks: 2 })
  ]);
  const res = ST.computeStrength(recs);
  assert.equal(res.touched, 3);
  assert.equal(res.untouched, 2);
  const bin = res.dist.bins.find(b => b.from === 4);
  assert.deepEqual([bin.n, bin.touched, bin.untouched], [5, 3, 2]);
  assert.equal(bin.medianOvershoot, 8, 'jen dotčené: 6, 8, 10');
  assert.equal(bin.winRate, 1, 'stopnuté obchody s nedotčenou hladinou do výsledku nejdou');
  assert.equal(res.medianOvershoot, 8);
});

test('rozložení po 1 ticku; sloučení po 2 / 4 t mění jen zobrazení, ne data (B4/4)', () => {
  const recs = norm([
    at(trade, [['VAL', 1], ['VAH', -1]], { mfeTicks: 25, maeTicks: 3 }),
    at(trade, [['VAL', 2]], { mfeTicks: 25 }),
    at(stop, [['VAL', 3], ['VWAP', -4]], { mfeTicks: 5, maeTicks: 12 }),
    at(trade, [['HVN', 5]], { mfeTicks: 25 }),
    at(trade, [['LVN', 6]], { mfeTicks: 25 })
  ]);
  const one = ST.computeStrength(recs);
  const snapshot = JSON.stringify(one.rows.map(x => [x.p, x.status, x.overshoot]));
  assert.equal(one.bin, 1);
  assert.deepEqual(one.dist.bins.map(b => [b.from, b.to, b.n]), [[-4, -4, 1], [-1, -1, 1], [1, 1, 1], [2, 2, 1], [3, 3, 1], [5, 5, 1], [6, 6, 1]]);
  const two = ST.computeStrength(recs, { bin: 2 });
  assert.deepEqual(two.dist.bins.map(b => [b.from, b.to, b.n]), [[-4, -3, 1], [-2, -1, 1], [0, 1, 1], [2, 3, 2], [4, 5, 1], [6, 7, 1]]);
  const four = ST.distribution(one.rows, 4);
  assert.deepEqual(four.bins.map(b => [b.from, b.to, b.n]), [[-4, -1, 2], [0, 3, 3], [4, 7, 2]]);
  for (const d of [one.dist, two.dist, four]) assert.equal(d.bins.reduce((a, b) => a + b.n, 0), 7);
  assert.equal(JSON.stringify(one.rows.map(x => [x.p, x.status, x.overshoot])), snapshot, 'sloučení nesahá na řádky');
  assert.deepEqual([two.touched, two.untouched, two.totalRows], [one.touched, one.untouched, one.totalRows]);
  assert.equal(ST.computeStrength(recs, { bin: 3 }).bin, 1, 'jen 1 / 2 / 4');
});

test('zvlášť podle typu hladiny a podle netest / test', () => {
  const recs = norm([
    at(trade, [['HVN', 4, { testState: 'UNTESTED' }]], { mfeTicks: 10 }),
    at(trade, [['HVN', 4, { testState: 'UNTESTED' }]], { mfeTicks: 10 }),
    at(stop, [['HVN', 4, { testState: 'TESTED' }]], { mfeTicks: 6 }),
    at(trade, [['VAL', -2]], { maeTicks: 3 })
  ]);
  const res = ST.computeStrength(recs);
  const type = Object.fromEntries(res.byType.map(t => [t.key, t]));
  assert.deepEqual(Object.keys(type), ['HVN', 'VAL'], 'řazeno podle počtu dotčených');
  assert.deepEqual([type.HVN.touched, type.HVN.dist.bins.length], [3, 1]);
  assert.equal(type.HVN.label, 'HVN');
  const tst = Object.fromEntries(res.byTest.map(t => [t.key, t]));
  assert.deepEqual([tst.UNTESTED.touched, tst.TESTED.touched, tst.UNTESTED.label], [2, 1, 'netest']);
  assert.equal(res.testStateUnknown, 1, 'řádek bez stavu se jen spočítá');
});

test('SL za nejbližší hladinou (stopBehindTicks): stopnuté × přeživší po tickách', () => {
  // SL 12 t pod vstupem; hladina −4 t → SL 8 t za ní, −10 t → 2 t.
  const recs = norm([
    at(stop, [['VAL', -10]]), at(stop, [['VAL', -10]]), at(stop, [['VAL', -4]]),
    at(trade, [['VAL', -4]]), at(trade, [['VAL', 2]]), trade()
  ]);
  const sb = ST.computeStrength(recs).stopBehind;
  assert.deepEqual([sb.stopped.n, sb.stopped.median, sb.survived.n, sb.survived.median], [3, 2, 2, 11]);
  assert.deepEqual(sb.dist.bins.map(b => [b.from, b.stopped, b.survived]), [[2, 2, 0], [8, 1, 1], [14, 0, 1]]);
  assert.equal(sb.unknown, 1, 'obchod bez hladiny mezi SL a cílem do rozdělení nevstupuje');
});

test('nejbližší hladina ve směru (nearestAheadTicks / R): cíl dosažen × nedosažen', () => {
  const recs = norm([
    at(trade, [['VAH', 6]]), at(trade, [['VAH', 6]]), at(trade, [['VAH', 12]]),
    at(stop, [['VAH', 3]]), at(stop, [['VAH', 3], ['VAL', 9]]), at(trade, [['VAL', -2]])
  ]);
  const na = ST.computeStrength(recs).nearestAhead;
  assert.deepEqual([na.reached.n, na.reached.medianTicks, na.reached.medianR], [3, 6, 0.5]);
  assert.deepEqual([na.missed.n, na.missed.medianTicks, na.missed.medianR], [2, 3, 0.25]);
  assert.deepEqual(na.dist.bins.map(b => [b.from, b.reached, b.missed]), [[3, 0, 2], [6, 2, 0], [12, 1, 0]]);
  assert.equal(na.unknown, 1);
});

test('dopočtené MFE / MAE se nepočítá – jen naměřené', () => {
  const recs = norm([at(trade, [['VAL', 4]], { mfeTicks: 10, mfeTicksSource: undefined, mfeTicksDerived: true })]);
  const res = ST.computeStrength(recs);
  assert.deepEqual([res.touched, res.noExcursion, res.withDistance, res.totalRows], [0, 1, 1, 1]);
});

test('malé N: pod 3 dotčenými bez procent a mediánu, pod 5 šedé', () => {
  const two = ST.computeStrength(norm([at(trade, [['VAL', 4]], { mfeTicks: 10 }), at(stop, [['VAL', 4]], { mfeTicks: 6 })]));
  const b = two.dist.bins[0];
  assert.deepEqual([b.touched, b.winRate, b.medianOvershoot, b.grey], [2, null, null, true]);
});

test('řádek bez polohy (bez ceny a ticků) se jen spočítá', () => {
  const raw = trade();
  delete raw.nearLevelsNone;
  raw.nearLevels = [{ level: 'VAH', price: null, legacySide: 'TG' }, { level: 'VAL', price: Number(raw.entryPrice) + 1 }];
  const res = ST.computeStrength(norm([raw]));
  assert.deepEqual([res.totalRows, res.withDistance, res.noDistance], [2, 1, 1]);
});

test('kontrolní skupina: nevyplněno se do „žádná hladina" nikdy nepřimíchá', () => {
  const recs = norm([
    trade(), stop({ nearLevels: undefined, srTargetNone: true, srStopLossNone: true }),
    at(trade, [['VAL', 4]]),
    stop({ nearLevels: [], nearLevelsNone: false }), stop({ nearLevels: undefined, nearLevelsNone: undefined }), stop({ nearLevels: undefined, nearLevelsNone: undefined, srTargetNone: true })
  ]);
  const cg = ST.computeStrength(recs).control;
  assert.equal(cg.none.n, 2);
  assert.equal(cg.none.winRate, 0.5, 'nevyplněné stopky by ji stáhly');
  assert.equal(cg.present.n, 1);
  assert.equal(cg.unknown.n, 3);
});

test('v kódu hladin není tolerance ani koš', () => {
  assert.equal('DEFAULT_TOLERANCE' in ST, false);
  assert.equal(require('../app/context.js').BUCKETS.slBufferTicks, undefined);
});
