'use strict';
// Zdraví dat nad kontextem v2 (docs/ZADANI_KONTEXT.md B2): kontroly 14–17
// a pokrytí nových polí. Jen hlásí – nic neopravuje ani nepřepisuje.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const H = require('../app/health.js');
const { trade } = require('./helpers/records.js');

let seq = 0;
const long = (over = {}) => ({
  id: 'H' + (++seq), instrument: 'MES', date: '2026-10-09', entryTime: `16:${String(10 + seq % 50).padStart(2, '0')}`, side: 'long',
  entryPrice: '7840', slPrice: 7837.75, result: 'breakeven', fillStatus: 'FILLED',
  targetLevel1: { type: 'LVN', price: 7844.5 }, ...over
});
const row = (level, price, ticksFromEntry = null, extra = {}) => ({ level, price, ticksFromEntry, ...extra });
const near = (level, price, extra = {}) => ({ level, price, ...extra });
const health = (raws, dayNotes) => H.computeHealth(N.normalizeRecords(raws, dayNotes));
const check = (h, id) => h.checks.find(c => c.id === id);

// 9. 10. 17:15 short z 7847.25, hladina CUSTOM_GAMMA 7847.0 leží 1 t za vstupem – platný zápis.
const gamma = () => long({
  side: 'short', entryPrice: '7847.25', slPrice: 7849.25, entryTime: '17:15', targetLevel1: { type: 'CUSTOM_FIX_RRR', price: 7843.25 },
  nearLevels: [near('VAH', 7846.5), near('M2_EDGE', 7847.75), near('CUSTOM_GAMMA', 7847)]
});

test('kontroly 14 a 15: cíl / SL na špatné straně vstupu jsou chyba, s datem a časem obchodu', () => {
  const h = health([
    long({ date: '2026-10-02', entryTime: '15:44', side: 'short', entryPrice: '7794.5', slPrice: 7797, targetLevel1: { type: 'VPOC_1M', price: 779475 } }),
    long({ date: '2026-10-05', entryTime: '18:18', entryPrice: '7811', slPrice: 7808, targetLevel1: { type: 'LIQUIDITY', price: 7783 } }),
    long({ entryTime: '17:01', entryPrice: '7847.75', slPrice: 7845.25, targetLevel1: { type: 'CUSTOM_FIX_RRR', price: 7845.25 } }),
    long({ entryTime: '17:30', slPrice: 7841 }),
    gamma(), long()
  ]);
  const c14 = check(h, 14), c15 = check(h, 15);
  assert.equal(c14.status, 'fail');
  assert.deepEqual(c14.items.map(i => `${i.record.date} ${i.record.entryTime}`), ['2026-10-02 15:44', '2026-10-05 18:18', '2026-10-09 17:01']);
  assert.match(c14.items[1].detail, /7783.*long z 7811/);
  assert.equal(c14.checked, 6);
  assert.equal(c15.status, 'fail');
  assert.deepEqual(c15.items.map(i => i.record.entryTime), ['17:30']);
  // Zóna u SL za vstupem není chyba ani informace.
  for (const id of [14, 15, 16]) assert.equal(check(h, id).items.some(i => i.record.entryTime === '17:15'), false, 'kontrola ' + id);
});

test('kontroly 14 a 15: v pořádku projdou, bez cen není co ověřit; dopočtená cena se nekontroluje', () => {
  const ok = health([long(), gamma()]);
  assert.equal(check(ok, 14).status, 'pass');
  assert.equal(check(ok, 15).status, 'pass');
  const none = health([{ id: 'n', side: 'long', entryPrice: '7840' }, { id: 'm', recordType: 'SETUP_ONLY' }]);
  assert.equal(check(none, 14).status, 'na');
  assert.equal(check(none, 15).status, 'na');
  const derived = health([long({ slPrice: 7841, slDerived: true, targetLevel1: { type: 'VAH', price: 7839 }, targetLevel1PriceDerived: true })]);
  assert.equal(check(derived, 14).status, 'na');
  assert.equal(check(derived, 15).status, 'na');
});

test('kontrola 16: hladiny za SL nebo za cílem jsou jen informace (měření, ne chyba)', () => {
  const h = health([
    long({ entryTime: '17:01', nearLevels: [near('CUSTOM_GAMMA', 7851), near('VAL', 7839), near('VWAP', 7837), near('VAH', 7839.25)] }),
    gamma()
  ]);
  const c = check(h, 16);
  assert.equal(c.status, 'info');
  assert.deepEqual(c.items.map(i => i.detail), [
    'Hladiny v blízkosti: CUSTOM_GAMMA 7851 leží za cílem (+44 t od vstupu)',
    'Hladiny v blízkosti: VWAP 7837 leží za SL (−12 t od vstupu)'
  ]);
  assert.equal(c.items.every(i => i.record.entryTime === '17:01'), true);
  assert.equal(c.checked, 7, 'řádky s polohou');
  assert.equal(check(health([gamma()]), 16).status, 'pass');
  assert.equal(check(health([long({ nearLevels: [near('VAH', null, { legacySide: 'TG' })] })]), 16).status, 'na', 'bez polohy to nejde určit');
});

test('B4/2: kontrola 17 – nesoulad geometrie Labu s exportem deníku je chyba s oběma hodnotami', () => {
  const raw = long({ nearLevels: [near('VPOC_DAY', 7841.75), near('VPOC_30M', 7839.25)] });
  const derived = {
    targetTicks: 18, slTicks: 9, targetOnLevel: true, nearestAheadTicks: 7, nearestAheadR: 0.78, stopBehindTicks: 6,
    levelsStopToEntry: 1, levelsEntryToTarget: 1, tradeNoInDay: 1, prevResultInDay: 'FIRST', dayPnlBefore: 0,
    nearLevels: [{ fromEntry: 7, fromStop: 16, toTarget: 11, position: 'ENTRY_TO_TARGET' }, { fromEntry: -3, fromStop: 6, toTarget: 21, position: 'STOP_TO_ENTRY' }]
  };
  const ok = check(health([{ ...raw, derived }]), 17);
  assert.equal(ok.status, 'pass');
  assert.equal(ok.checked, 1);

  const bad = check(health([{ ...raw, derived: { ...derived, nearestAheadTicks: 5, stopBehindTicks: 2 } }, { ...long(), derived: { nearestAheadTicks: null } }]), 17);
  assert.equal(bad.status, 'fail');
  assert.equal(bad.items.length, 1);
  assert.equal(bad.items[0].detail, 'nearestAheadTicks: Lab 7 × deník 5; stopBehindTicks: Lab 6 × deník 2');
  assert.equal(bad.summary, '1 z 2');
});

test('kontrola 17: starší export bez dopočtů = není co porovnat; neznámý tick = nejde ověřit; starý tvar dopočtů se řekne', () => {
  const old = check(health([long(), gamma()]), 17);
  assert.equal(old.status, 'na');
  assert.match(old.summary, /export nenese dopočty deníku/);
  const fdxs = check(health([{ ...long({ instrument: 'FDXS' }), derived: { nearestAheadTicks: 3 } }, { ...long(), derived: { nearestAheadTicks: null, tradeNoInDay: 2 } }]), 17);
  assert.equal(fdxs.status, 'pass');
  assert.equal(fdxs.checked, 1);
  assert.equal(fdxs.unverified, 1);
  assert.match(fdxs.summary, /1 nejde ověřit/);
  // Řádek „žádná hladina" (NONE) zahodí Lab stejně jako deník – známý rozdíl z v2 zmizel.
  const none = check(health([{ ...long({ srTarget: [row('NONE', null)], srStopLossNone: true }), derived: { nearestAheadTicks: null, stopBehindTicks: null, levelsStopToEntry: 0, levelsEntryToTarget: 0, nearLevels: [] } }]), 17);
  assert.equal(none.status, 'pass');
  // Export ze starého deníku (dopočty v2): geometrie hladin se nesrovnává, řekne se kolik.
  const v2 = check(health([{ ...long({ srTarget: [row('VAH', 7841.75, 7)] }), derived: { targetTicks: 18, slTicks: 9, pathState: 'BLOCKED', srTarget: [{ ticksFromEntrySigned: 7 }] } }]), 17);
  assert.equal(v2.status, 'pass');
  assert.equal(v2.oldShape, 1);
  assert.match(v2.summary, /1 se starým tvarem dopočtů/);
});

test('původních 13 kontrol zůstává, nové mají čísla 14–17', () => {
  const h = health([long()]);
  assert.deepEqual(h.checks.map(c => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  // Helper obchod fáze 1 projde i novými kontrolami (nebo k nim nemá co říct).
  const clean = H.computeHealth([trade(), trade()].map(N.normalizeRecord));
  for (const id of [14, 15, 16, 17]) assert.notEqual(check(clean, id).status, 'fail', 'kontrola ' + id);
});

test('pokrytí kontextu: za každé pole hodnota / vědomě žádná / nevyplněno, odvozeno z registru', () => {
  const dayNotes = { '2026-10-09': { dayContext: { openVsValue: 'IN_VA', newsEvent: 'NONE' } } };
  const h = health([
    long({ trendHtf: 'UP', grade: 'A', absLocation: 'NONE', entryLevels: ['VAH'], derived: { targetOnLevel: false, session: 'US_OPEN' },
      nearLevels: [near('VAH', 7842, { testState: 'UNTESTED' }), near('VAL', 7843), near('VWAP', 7839)] }),
    long({ trendHtf: 'DOWN', absLocation: 'EXTREME', date: '2026-10-08', nearLevels: [near('VAH', 7842, { testState: 'TESTED' })] }),
    long({ date: '2026-10-08' }),
    { id: 's', recordType: 'SETUP_ONLY', date: '2026-10-09', trendHtf: 'UP' }
  ], dayNotes);
  const cov = Object.fromEntries(h.contextCoverage.rows.map(r => [r.field, r]));
  assert.deepEqual(Object.keys(cov).slice(0, N.CONTEXT_V2_FIELDS.length), N.CONTEXT_V2_FIELDS.map(f => f.key), 'každé pole registru má řádek');
  const counts = f => [cov[f].value, cov[f].none, cov[f].unknown, cov[f].total];
  assert.deepEqual(counts('trendHtf'), [2, 0, 1, 3], 'jen obchody, setup bez vstupu ne');
  assert.deepEqual(counts('absLocation'), [1, 1, 1, 3]);
  assert.deepEqual(counts('targetOnLevel'), [1, 0, 2, 3]);
  assert.deepEqual(counts('openVsValue'), [1, 0, 2, 3]);
  assert.deepEqual(counts('newsEvent'), [0, 1, 2, 3]);
  assert.deepEqual(counts('dayTypeActual'), [0, 0, 3, 3]);
  for (const gone of ['pathProfile', 'liquiditySwept', 'entryLevelTest', 'srTargetTest', 'srStopLossTest']) assert.equal(gone in cov, false, gone);
  // Netest / test u hladin v blízkosti – počítá řádky, ne obchody.
  assert.deepEqual(counts('nearLevelsTest'), [2, 0, 2, 4]);
  assert.equal(cov.nearLevelsTest.unit, 'řádků');
  assert.equal(cov.trendHtf.label, 'Trend 30m');
  assert.equal(h.contextCoverage.total, 3);
  assert.equal(h.contextCoverage.withExport, 1);
  // Úplnost polí (štítek „Neúplné"): trend 30m, známka a hladiny v blízkosti jako v deníku.
  const comp = Object.fromEntries(h.completeness.rows.map(r => [r.field, r.missing]));
  assert.deepEqual([comp.trendHtf, comp.grade, comp.nearLevels], [1, 2, 1]);
  assert.equal('absLocation' in comp, false);
  assert.equal('srTarget' in comp, false);
});

test('použitelnost: jeden řádek „Hladiny" (řádky s polohou a naměřenou dráhou), kontrolní skupina podle hladin v blízkosti', () => {
  const t = (over, mfe, mae) => ({ ...trade({ mfeTicks: mfe, maeTicks: mae }), ...over });
  const h = H.computeHealth(N.normalizeRecords([
    t({ nearLevels: [{ level: 'VAH', price: 7900 }], nearLevelsNone: undefined }, 25, 3),
    t({ nearLevels: [{ level: 'VAH', price: 7900 }, { level: 'VAL', price: null, legacySide: 'SL' }], nearLevelsNone: undefined }, 25, 3),
    t({}, 25, 3),
    t({ nearLevels: undefined, nearLevelsNone: undefined }, 25, 3)
  ]));
  const u = Object.fromEntries(h.usability.map(x => [x.key, x]));
  assert.equal('levelsTarget' in u || 'levelsSl' in u, false);
  assert.deepEqual([u.levels.n, u.levels.m, u.levels.unit], [2, 3, 'řádků']);
  assert.match(u.controlGroup.note, /žádná hladina 1 · s hladinou 2 · nevyplněno 1/);
});
