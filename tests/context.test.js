'use strict';
// Obrazovka „Kontext" – rozpad podle dimenze (docs/ZADANI_KONTEXT.md B3, testy B4/5–6),
// dimenze upravené podle docs/ZADANI_KONTEXT_V3.md B3.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../app/context.js');
const S = require('../app/sltp.js');
const { trade, stop, norm, normAll, many } = require('./helpers/records.js');

const dim = (res, key) => res.dimensions.find(d => d.key === key);
const rowOf = (d, key) => d.rows.find(r => r.key === key);
// Helper trade() je long s trendem 30m UP → „po trendu"; short proti.
const withTrend = () => trade();
const against = () => stop({ side: 'short', slPrice: 9000, targetLevel1: { type: 'VAL', price: 7000 } });
const noTrend = () => trade({ trendHtf: '' });

test('dimenze ze zadání v3 B3 jsou všechny, každá ve své skupině', () => {
  const byGroup = {};
  for (const d of C.DIMENSIONS) (byGroup[d.group] = byGroup[d.group] || []).push(d.key);
  assert.deepEqual(byGroup, {
    path: ['targetOnLevel'],
    entry: ['entryTestNo', 'absLocation'],
    direction: ['trendHtfAlign', 'trendAlign'],
    process: ['grade', 'tradeNoInDay', 'prevResultInDay'],
    day: ['openVsValue', 'dayTypeActual', 'dayTypeAccuracy', 'newsEvent']
  });
  assert.deepEqual(C.GROUPS.map(g => g.key), ['path', 'entry', 'direction', 'process', 'day']);
  for (const gone of ['pathState', 'freePathR', 'pathProfile', 'slBufferTicks', 'liquiditySwept', 'entryLevelTest']) {
    assert.equal(C.DIMENSIONS.some(d => d.key === gone), false, gone);
  }
  for (const d of C.DIMENSIONS) assert.ok(d.label && d.lacks, d.key + ' má popisek a říká, co vyplnit');
});

test('koše jsou na jednom místě a drží hranice ze zadání', () => {
  const b = (name, values) => values.map(v => C.bucketOf(name, v));
  assert.deepEqual(b('tradeNoInDay', [1, 2, 3, 4, 9]), ['N1', 'N2', 'N3', 'N4P', 'N4P']);
  assert.equal(C.bucketOf('tradeNoInDay', null), null, 'bez hodnoty žádný koš');
  assert.deepEqual(Object.keys(C.BUCKETS), ['tradeNoInDay'], 'koše hladin (volná cesta v R, SL za zónou) v3 zrušila');
});

test('B4/5: řádek „nevyplněno" nevstupuje do porovnání – stav ani věta se jím nezmění', () => {
  const filled = [...many(12, withTrend), ...many(12, against)];
  const a = dim(C.computeContext(norm(filled)), 'trendHtfAlign');
  const b = dim(C.computeContext(norm([...filled, ...many(40, noTrend)])), 'trendHtfAlign');
  assert.equal(a.state, 'weak');
  assert.equal(b.state, 'weak', '40 nevyplněných vzorek nezvětší');
  assert.equal(b.unknown, 40);
  assert.equal(b.known, 24);
  assert.equal(b.total, 64);
  assert.deepEqual(b.rows, a.rows, 'řádky skupin jsou stejné');
  assert.equal(b.fact, a.fact);
  assert.equal(b.rows.some(r => r.n === 40), false, 'nevyplněno není řádek se statistikou');
  // Bez nevyplněných by druhá skupina měla jen 5 – nevyplněné ji nezachrání.
  const small = dim(C.computeContext(norm([...many(12, withTrend), ...many(5, against), ...many(30, noTrend)])), 'trendHtfAlign');
  assert.equal(small.state, 'na');
  assert.equal(small.fact, null);
  assert.match(small.missing, /^5 obchodů v druhé největší skupině do 10 \(vyplněno 17 z 47, nevyplněno 30; po trendu 12, proti trendu 5\)$/);
});

test('stav dimenze: stávající prahy 10 / 30 nad druhou největší skupinou, nesnižují se', () => {
  assert.equal(S.SAMPLE_GREY, 10);
  assert.equal(S.SAMPLE_WARN, 30);
  const state = (a, b) => dim(C.computeContext(norm([...many(a, withTrend), ...many(b, against)])), 'trendHtfAlign').state;
  assert.equal(state(50, 9), 'na');
  assert.equal(state(50, 10), 'weak');
  assert.equal(state(50, 29), 'weak');
  assert.equal(state(50, 30), 'ok');
  assert.equal(state(50, 0), 'na', 'jedna skupina není porovnání');
  assert.equal(dim(C.computeContext([]), 'trendHtfAlign').state, 'na');
});

test('expectancy R vrací i průměrnou výhru a ztrátu v R (Souhrn je bere odtud)', () => {
  const e = C.expectancyR(norm([...many(3, withTrend), stop(), trade({ result: 'breakeven', exitTicks: 3, rMultiple: 0.25 })]));
  assert.deepEqual([e.n, e.avgWinR, e.avgLossR], [4, 2, -1]);
  assert.ok(Math.abs(e.value - 1.25) < 1e-9);
  assert.deepEqual(C.expectancyR([]), { value: null, n: 0, avgWinR: null, avgLossR: null });
});

test('čísla řádku: N, win %, průměr R a expectancy R ze stejné mechaniky jako jinde', () => {
  // 3 targety po +2 R, 1 stoploss −1 R, 1 breakeven +0,25 R (do expectancy nevstupuje).
  const recs = norm([...many(3, withTrend), stop(), trade({ result: 'breakeven', exitTicks: 3, rMultiple: 0.25 })]);
  const row = rowOf(dim(C.computeContext(recs), 'trendHtfAlign'), 'WITH');
  assert.equal(row.n, 5);
  assert.equal(row.winRate, 0.75);
  assert.equal(row.decided, 4);
  assert.equal(row.rCount, 5);
  assert.ok(Math.abs(row.avgR - (6 - 1 + 0.25) / 5) < 1e-9);
  assert.ok(Math.abs(row.expectancyR - (0.75 * 2 - 0.25 * 1)) < 1e-9);
  assert.equal(row.expectancyN, 4);
  assert.equal(row.grey, true, 'pod 10 obchodů šedě');
  // Pod 3 rozhodnuté obchody bez procent.
  const two = rowOf(dim(C.computeContext(norm([withTrend(), stop()])), 'trendHtfAlign'), 'WITH');
  assert.equal(two.winRate, null);
  assert.deepEqual([two.wins, two.decided], [1, 2]);
});

test('směr vůči trendu: po trendu / proti / range, bez trendu nebo směru nevyplněno', () => {
  const key = (over, d = 'trendHtfAlign') => { const res = dim(C.computeContext(norm([trade(over)])), d); return res.rows.length ? res.rows[0].key : 'unknown'; };
  assert.equal(key({ side: 'long', trendHtf: 'UP' }), 'WITH');
  assert.equal(key({ side: 'short', trendHtf: 'UP' }), 'AGAINST');
  assert.equal(key({ side: 'short', trendHtf: 'DOWN' }), 'WITH');
  assert.equal(key({ side: 'long', trendHtf: 'RANGE' }), 'RANGE');
  assert.equal(key({ side: 'long', trendHtf: '' }), 'unknown');
  assert.equal(key({ side: '', trendHtf: 'UP' }), 'unknown');
  assert.equal(key({ side: 'long', trend: 'LONG' }, 'trendAlign'), 'WITH');
  assert.equal(key({ side: 'long', trend: 'SHORT' }, 'trendAlign'), 'AGAINST');
  assert.equal(key({ side: 'short', trend: 'RANGE' }, 'trendAlign'), 'RANGE');
  assert.equal(key({ side: 'long', trend: '' }, 'trendAlign'), 'unknown');
});

test('„vědomě žádná" je normální řádek (kontrolní skupina), nevyplněno ne', () => {
  const recs = norm([...many(10, () => trade({ absLocation: 'EXTREME' })), ...many(10, () => stop({ absLocation: 'NONE' })), ...many(7, () => trade())]);
  const d = dim(C.computeContext(recs), 'absLocation');
  assert.deepEqual(d.rows.map(r => [r.key, r.kind, r.n]), [['EXTREME', 'value', 10], ['NONE', 'none', 10]]);
  assert.equal(d.unknown, 7);
  assert.equal(d.state, 'weak', 'obě skupiny po 10 – „bez absorpce" se počítá');
  assert.match(d.fact, /Na extrému win 100 %.*Bez absorpce win 0 %/);
});

test('B4/6: známka změněná dodatečně a doplněná zpětně jde stranou od A / B / C', () => {
  const recs = norm([
    ...many(10, () => trade({ grade: 'A' })),
    ...many(10, () => stop({ grade: 'B' })),
    ...many(25, () => trade({ grade: 'A', gradeEdited: true })),
    ...many(6, () => stop({ grade: 'C', derived: { gradeRetro: true } })),
    ...many(4, () => trade({ grade: 'B', derived: { gradeRetro: null } })),
    ...many(3, () => trade({ grade: '' }))
  ]);
  const d = dim(C.computeContext(recs), 'grade');
  assert.deepEqual(d.rows.map(r => [r.key, r.kind, r.n]), [['A', 'value', 10], ['B', 'value', 14], ['EDITED', 'aside', 25], ['RETRO', 'aside', 6]]);
  assert.equal(rowOf(d, 'EDITED').winRate, 1, 'řádek stranou má vlastní čísla');
  assert.equal(d.state, 'weak', 'práh z čistých známek (10), ne z 25 změněných');
  assert.equal(d.second, 10);
  assert.equal(d.known, 24);
  assert.equal(d.aside, 31);
  assert.equal(d.unknown, 3);
  assert.equal(/změněn|zpětně/.test(d.fact), false, 'do věty se nedostanou');
  assert.match(d.fact, /^Známka před vstupem: B .*\(n 14\); A .*\(n 10\)$/);
  // Jen změněné známky → porovnání neběží, i když jich je dost.
  const onlyEdited = dim(C.computeContext(norm([...many(40, () => trade({ grade: 'A', gradeEdited: true })), ...many(40, () => stop({ grade: 'B', gradeEdited: true }))])), 'grade');
  assert.equal(onlyEdited.state, 'na');
  assert.equal(onlyEdited.rows.length, 1);
  assert.match(onlyEdited.missing, /[(]vyplněno 0 z 80, stranou 80; žádná skupina[)]$/, 'počty sedí na celek');
});

test('dimenze dne a pořadí v dni jdou přes celý deník', () => {
  const dayNotes = {
    '2026-08-05': { dayContext: { openVsValue: 'IN_VA', dayTypeExpected: 'TREND_UP', dayTypeActual: 'TREND_UP', newsEvent: 'NONE' } },
    '2026-08-06': { dayContext: { openVsValue: 'GAP_UP', dayTypeExpected: 'BALANCE_D', dayTypeActual: 'TREND_DOWN', newsEvent: 'CPI' } },
    '2026-08-07': { dayContext: { dayTypeExpected: 'UNKNOWN', dayTypeActual: 'P' } },
    '2026-08-10': { dayContext: { dayTypeExpected: 'TREND_UP' } }
  };
  const res = C.computeContext(normAll([
    trade({ date: '2026-08-05' }), stop({ date: '2026-08-05' }), trade({ date: '2026-08-05' }),
    trade({ date: '2026-08-06' }), trade({ date: '2026-08-07' }), trade({ date: '2026-08-10' }), trade({ date: '2026-08-11' })
  ], dayNotes));
  const keys = k => dim(res, k).rows.map(r => `${r.key}:${r.kind}:${r.n}`);
  assert.deepEqual(keys('openVsValue'), ['IN_VA:value:3', 'GAP_UP:value:1']);
  assert.deepEqual(keys('newsEvent'), ['NONE:none:3', 'CPI:value:1'], '„bez zpráv" je skupina, den bez kontextu ne');
  assert.equal(dim(res, 'newsEvent').unknown, 3);
  assert.deepEqual(keys('dayTypeAccuracy'), ['MATCH:value:3', 'MISS:value:1', 'NO_EXPECTATION:none:1']);
  assert.equal(dim(res, 'dayTypeAccuracy').unknown, 2, 'bez skutečného typu dne přesnost nejde');
  assert.deepEqual(keys('tradeNoInDay'), ['N1:value:5', 'N2:value:1', 'N3:value:1']);
  assert.deepEqual(keys('prevResultInDay'), ['FIRST:value:5', 'target:value:1', 'stoploss:value:1']);
  assert.equal(rowOf(dim(res, 'prevResultInDay'), 'stoploss').label, 'po stoplossu');
});

test('skupiny: stav = nejlepší dimenze, nespuštěné se sečtou do jedné věty s počty', () => {
  const res = C.computeContext(norm([...many(12, withTrend), ...many(12, against)]));
  const direction = res.groups.find(g => g.key === 'direction');
  assert.equal(direction.state, 'weak');
  assert.match(direction.headline, /^2 z 2 dimenzí má vzorek/);
  const entry = res.groups.find(g => g.key === 'entry');
  assert.equal(entry.state, 'na');
  assert.equal(entry.headline, '0 z 2 dimenzí má vzorek');
  assert.match(entry.missing, /^vzorek: Kolikátý test vstupní hladiny [(]vyplněno 0 z 24[)]; .*Absorpce – kde [(]vyplněno 0 z 24[)].* aspoň 10 obchodů ve dvou skupinách$/);
  const one = C.computeContext(norm([...many(12, withTrend), ...many(3, against)])).groups.find(g => g.key === 'direction');
  assert.match(one.missing, /Směr vůči trendu 30m [(]vyplněno 15 z 15, druhá skupina 3[)]/);
});

test('„Co vyplnit": jen dimenze, které nejsou ✓ a mají nevyplněné obchody – vyplněním zmizí', () => {
  const before = C.fillRows(C.computeContext(norm([...many(30, withTrend), ...many(30, against)])));
  assert.equal(before.some(r => r.key === 'ctx-trendHtfAlign'), false, 'ví se → neblokuje');
  const abs = before.find(r => r.key === 'ctx-absLocation');
  assert.deepEqual([abs.n, abs.m, abs.unit, abs.lacks, abs.kind], [0, 60, 'obchodů', 'Absorpce – kde', 'context']);
  const after = C.fillRows(C.computeContext(norm([...many(30, () => trade({ absLocation: 'EXTREME' })), ...many(30, () => stop({ absLocation: 'NONE' }))])));
  assert.equal(after.some(r => r.key === 'ctx-absLocation'), false);
  // Pořadí v dni se počítá z času – nevyplněné tam být nemůže, takže se nenabízí.
  assert.equal(C.fillRows(C.computeContext(normAll(many(5, withTrend)))).some(r => r.key === 'ctx-tradeNoInDay'), false);
});

test('žádná věta ani popisek neobsahuje doporučení', () => {
  const res = C.computeContext(norm([...many(30, () => trade({ absLocation: 'EXTREME', grade: 'A' })), ...many(30, () => against())]));
  const text = JSON.stringify(res, (k, v) => (k === 'records' ? undefined : v)) + JSON.stringify(C.DIMENSIONS.map(d => [d.label, d.lacks]));
  assert.equal(/doporuč|nastav si|optimáln/i.test(text), false);
});
