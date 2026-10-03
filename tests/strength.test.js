'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../app/strength.js');
const { trade, stop, norm } = require('./helpers/records.js');

const row = (level, ticksFromEntry, price = null) => ({ level, price, ticksFromEntry });
const side = (res, key) => res.sides.find(s => s.key === key);
const lvl = (s, level) => s.levels.find(l => l.level === level);

test('klasifikace: netestována / zastavila / propadla podle tolerance', () => {
  assert.equal(ST.classify(20, 10, 2).status, 'untested');
  assert.equal(ST.classify(20, 18, 2).status, 'held');
  assert.equal(ST.classify(20, 22, 2).status, 'held');
  assert.deepEqual(ST.classify(20, 30, 2), { status: 'broken', overshoot: 10 });
  assert.equal(ST.classify(20, 17, 2).status, 'untested');
  assert.equal(ST.classify(20, 17, 3).status, 'held', 'tolerance je nastavitelná');
  assert.equal(ST.classify(null, 30).status, 'noDistance');
  assert.equal(ST.classify(20, null).status, 'noExcursion');
});

test('netestovaná hladina nevstupuje do síly', () => {
  // VAL: jednou zastavila (MFE 20 u hladiny 20), dvakrát k ní cena nedošla (MFE 5)
  const recs = norm([
    trade({ mfeTicks: 20, srTarget: [row('VAL', 20)] }),
    trade({ mfeTicks: 5, srTarget: [row('VAL', 20)] }),
    trade({ mfeTicks: 5, srTarget: [row('VAL', 20)] })
  ]);
  const val = lvl(side(ST.computeStrength(recs), 'target'), 'VAL');
  assert.equal(val.tested, 1);
  assert.equal(val.held, 1);
  assert.equal(val.untested, 2);
});

test('vzdálená netestovaná hladina nevyjde jako nejsilnější', () => {
  const recs = norm([
    ...[1, 2, 3, 4, 5].map(() => trade({ mfeTicks: 10, srTarget: [row('VPOC_DAY', 80)] })),
    trade({ mfeTicks: 10, srTarget: [row('VWAP', 10)] }), trade({ mfeTicks: 30, srTarget: [row('VWAP', 10)] }),
    trade({ mfeTicks: 30, srTarget: [row('VWAP', 10)] })
  ]);
  const s = side(ST.computeStrength(recs), 'target');
  const far = lvl(s, 'VPOC_DAY');
  assert.equal(far.tested, 0);
  assert.equal(far.heldPct, null);
  assert.equal(s.levels[0].level, 'VWAP', 'řadí se jen otestované');
});

test('proti SL se měří MAE, proti TP MFE; dopočtené se nepočítá', () => {
  const recs = norm([
    stop({ maeTicks: 6, mfeTicks: 30, srStopLoss: [row('VAH', 6)], srTarget: [row('VAL', 40)] }),
    trade({ maeTicks: 6, maeTicksSource: undefined, maeTicksDerived: true, srStopLoss: [row('VAH', 6)] })
  ]);
  const res = ST.computeStrength(recs);
  assert.equal(lvl(side(res, 'sl'), 'VAH').held, 1);
  assert.equal(lvl(side(res, 'sl'), 'VAH').noData, 1, 'dopočtené MAE = nelze vyhodnotit');
  assert.equal(lvl(side(res, 'target'), 'VAL').untested, 1);
});

test('malé N: pod 3 bez procent, pod 5 šedé', () => {
  const two = norm([trade({ mfeTicks: 10, srTarget: [row('VAL', 10)] }), trade({ mfeTicks: 30, srTarget: [row('VAL', 10)] })]);
  const v2 = lvl(side(ST.computeStrength(two), 'target'), 'VAL');
  assert.equal(v2.tested, 2);
  assert.equal(v2.heldPct, null);
  assert.equal(v2.grey, true);
  const four = norm([10, 10, 30, 30].map(m => trade({ mfeTicks: m, srTarget: [row('VAL', 10)] })));
  const v4 = lvl(side(ST.computeStrength(four), 'target'), 'VAL');
  assert.equal(v4.heldPct, 0.5);
  assert.equal(v4.medianOvershoot, 20);
  assert.equal(v4.grey, true);
});

test('pokrytí: řádky bez ceny i vzdálenosti se vypíšou konkrétně', () => {
  const recs = norm([trade({ srTarget: [row('VAL', 10), row('VAH', null)] })]);
  const s = side(ST.computeStrength(recs), 'target');
  assert.equal(s.totalRows, 2);
  assert.equal(s.withPlace, 1);
  assert.match(s.coverageMessage, /Má ji 1 z 2 řádků\. Bez ní nejde poznat, jestli k hladině cena vůbec došla\./);
});

test('kontrolní skupina: nevyplněno se do „žádná hladina" nikdy nepřimíchá', () => {
  const recs = norm([
    trade({ srTarget: [], srTargetNone: true }),
    stop({ srTarget: [row('NONE', null)] }),
    trade({ srTarget: [row('VAL', 10)] }),
    stop({ srTarget: [] }), stop({ srTarget: [] }), stop({ srTarget: undefined })
  ]);
  const cg = ST.computeStrength(recs).control.find(c => c.key === 'target');
  assert.equal(cg.none.n, 2);
  assert.equal(cg.none.winRate, 0.5, 'nevyplněné stopky by ji stáhly');
  assert.equal(cg.present.n, 1);
  assert.equal(cg.unknown.n, 3);
});
