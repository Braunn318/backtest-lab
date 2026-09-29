'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const H = require('../app/health.js');

// Syntetický obchod, který projde všemi kontrolami. Každý dostane jiný čas
// i vstup, aby se nehlásil jako duplicita.
let seq = 0;
function trade(over = {}) {
  seq++;
  const minutes = 9 * 60 + seq * 10;
  return {
    id: 't' + seq,
    date: '2026-08-05',
    entryTime: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    entryPrice: String(7800 + seq),
    side: 'long',
    result: 'target',
    fillStatus: 'FILLED',
    setupCode: 'M2_OF',
    slPrice: 7797,
    exitTicks: 24,
    slTicks: 12,
    rMultiple: 2,
    mfeTicks: 25,
    maeTicks: 3,
    maxFavorableTicks: 30,
    maxAdverseTicks: 5,
    postExitFavorableTicks: 6,
    observedMinutes: 3,
    targetLevel1: { type: 'VAL', price: 7806 },
    srTarget: ['NONE'],
    ...over
  };
}
const stop = (over = {}) => trade({ result: 'stoploss', exitTicks: -12, rMultiple: 1, mfeTicks: 2, maeTicks: 12, maxFavorableTicks: 4, maxAdverseTicks: 14, postExitFavorableTicks: 3, ...over });
const setup = (over = {}) => ({ id: 's' + (++seq), recordType: 'SETUP_ONLY', date: '2026-08-05', entryTime: '16:04', side: 'long', setupCode: 'M2_OF', fillStatus: 'NO_FILL', plannedEntryPrice: 7803.5, ...over });

const health = (raws, options) => H.computeHealth(raws.map(N.normalizeRecord), options);
const check = (h, id) => h.checks.find(c => c.id === id);
const usable = (h, key) => h.usability.find(u => u.key === key);

// ---------------------------------------------------------------- A) vzorek

test('přehled vzorku: TRADE / SETUP_ONLY / legacy / po dnech', () => {
  const h = health([trade(), trade({ date: '2026-08-06' }), trade({ legacyPointsConvention: true }), setup(), setup({ fillStatus: 'SKIPPED' })]);
  assert.equal(h.sample.total, 5);
  assert.equal(h.sample.trades, 3);
  assert.equal(h.sample.setups, 2);
  assert.equal(h.sample.legacy, 1);
  assert.equal(h.sample.perf, 2);
  assert.equal(h.sample.days[0].date, '2026-08-06', 'nejnovější den nahoře');
  const d5 = h.sample.days.find(d => d.date === '2026-08-05');
  assert.deepEqual({ t: d5.trades, s: d5.setups, nf: d5.noFill, l: d5.legacy }, { t: 2, s: 2, nf: 1, l: 1 });
});

test('použitelnost: legacy se nepočítá, SETUP_ONLY nikdy ve výkonu', () => {
  const h = health([trade(), trade({ legacyPointsConvention: true }), setup({ maxFavorableTicks: 50, slTicks: 10 })]);
  for (const key of ['r', 'slSweep', 'tpReach', 'grid', 'targetLevels', 'obstacles']) {
    assert.equal(usable(h, key).n, 1, key);
    assert.equal(usable(h, key).m, 1, key);
  }
  assert.equal(usable(h, 'r').missing, 49);
});

test('použitelnost: mřížka potřebuje všechna tři pole současně', () => {
  const h = health([
    trade(),
    trade({ maxAdverseTicks: null }),
    trade({ maxFavorableTicks: null }),
    trade({ slTicks: null, rMultiple: null })
  ]);
  assert.equal(usable(h, 'slSweep').n, 3);
  assert.equal(usable(h, 'tpReach').n, 2);
  assert.equal(usable(h, 'grid').n, 1);
  assert.ok(usable(h, 'grid').n <= Math.min(usable(h, 'slSweep').n, usable(h, 'tpReach').n));
});

test('použitelnost: maxAdverseTicks 0 je vyplněné, null ne', () => {
  const h = health([trade({ maxAdverseTicks: 0, maeTicks: 0 }), trade({ maxAdverseTicks: null })]);
  assert.equal(usable(h, 'slSweep').n, 1);
});

test('překážky: ["NONE"] je vyplněné, [] ne; poznámka o cenách mizí s první cenou', () => {
  const noPrice = health([trade({ srTarget: ['NONE'] }), trade({ srTarget: [] })]);
  assert.equal(usable(noPrice, 'obstacles').n, 1);
  assert.match(usable(noPrice, 'obstacles').note, /Bez cen/);
  const priced = health([trade({ srTarget: [{ level: 'VWAP', price: 7810, ticksFromEntry: null }] })]);
  assert.equal(usable(priced, 'obstacles').n, 1);
  assert.equal(usable(priced, 'obstacles').note, null);
});

test('fill rate: bez NO_FILL je použitelných 0, jinak FILLED+NO_FILL', () => {
  const none = health([trade(), trade(), setup({ fillStatus: 'SKIPPED' })]);
  assert.equal(usable(none, 'fillRate').n, 0);
  assert.match(usable(none, 'fillRate').note, /NO_FILL/);
  const some = health([trade(), trade(), setup(), setup({ fillStatus: 'MISSED' })]);
  assert.equal(usable(some, 'fillRate').n, 3);
  assert.equal(usable(some, 'fillRate').m, 4);
  assert.equal(usable(some, 'fillRate').rate, 2 / 3);
});

// ---------------------------------------------------------------- wouldSkipLive

test('wouldSkipLive: ve výchozím stavu mimo výkon, ale ve fill rate zůstává', () => {
  const raws = [trade(), trade({ wouldSkipLive: true, wouldSkipReason: 'jen měření' }), setup()];
  const h = health(raws);
  assert.equal(h.sample.skipLive, 1);
  assert.equal(h.sample.hasSkipLiveField, true);
  assert.equal(usable(h, 'r').n, 1);
  assert.equal(usable(h, 'r').m, 1);
  assert.equal(usable(h, 'fillRate').n, 3, 'fill rate: 2 FILLED + 1 NO_FILL');
  const incl = health(raws, { includeSkipLive: true });
  assert.equal(usable(incl, 'r').n, 2);
  assert.equal(usable(incl, 'fillRate').n, 3);
});

test('wouldSkipLive: pole v datech zatím není ⇒ nic se nevylučuje', () => {
  const h = health([trade(), trade()]);
  assert.equal(h.sample.hasSkipLiveField, false);
  assert.equal(h.sample.skipLive, 0);
  assert.equal(usable(h, 'r').n, 2);
});

// ---------------------------------------------------------------- B) úplnost

test('úplnost: od nejhoršího, zvýrazněná pole i když chybí všude', () => {
  const h = health([trade({ setupCode: '' }), trade({ maeTicks: undefined })]);
  const row = f => h.completeness.find(r => r.field === f);
  assert.equal(row('setupCode').pct, 0.5);
  assert.equal(row('setupCode').highlight, true);
  assert.equal(row('maeTicks').pct, 0.5);
  assert.equal(row('entryPrice').pct, 1);
  assert.equal(h.completeness.some(r => r.field === 'id' || r.field === 'createdAt'), false);
  for (let i = 1; i < h.completeness.length; i++) assert.ok(h.completeness[i - 1].pct <= h.completeness[i].pct);

  const empty = health([{ id: 'x', result: 'target', exitTicks: 4 }]);
  assert.equal(empty.completeness.find(r => r.field === 'postExitFavorableTicks').pct, 0);
});

test('úplnost: touchedEntry se neměří u stoplossů', () => {
  const h = health([trade({ touchedEntry: false }), stop()]);
  const row = h.completeness.find(r => r.field === 'touchedEntry');
  assert.equal(row.total, 1);
  assert.equal(row.pct, 1);
});

// ---------------------------------------------------------------- C) kontroly 1–10

test('kontrola 1: stoploss s rMultiple bez znaménka projde přes exitTicks', () => {
  assert.equal(check(health([stop()]), 1).status, 'pass');
  assert.equal(check(health([stop({ exitTicks: 12 })]), 1).status, 'fail');
  assert.equal(check(health([trade()]), 1).status, 'na');
});

test('kontrola 2: target ⇒ R > 0', () => {
  assert.equal(check(health([trade()]), 2).status, 'pass');
  assert.equal(check(health([trade({ exitTicks: -3, rMultiple: 0.25 })]), 2).status, 'fail');
});

test('kontrola 3: |R − exitTicks/slTicks| < 0,01', () => {
  assert.equal(check(health([trade(), stop(), trade({ exitTicks: 3, slTicks: 13, rMultiple: 0.23 })]), 3).status, 'pass');
  const h = health([trade({ exitTicks: 18, slTicks: 12, rMultiple: 2 })]);
  assert.equal(check(h, 3).status, 'fail');
  assert.equal(check(h, 3).items.length, 1);
});

test('kontrola 4: ziskový obchod nesmí mít maeTicks > slTicks', () => {
  assert.equal(check(health([trade({ maeTicks: 12 })]), 4).status, 'pass');
  assert.equal(check(health([trade({ maeTicks: 13, maxAdverseTicks: 13 })]), 4).status, 'fail');
  assert.equal(check(health([stop({ maeTicks: 20, maxAdverseTicks: 20 })]), 4).status, 'na', 'stoploss se nekontroluje');
});

test('kontrola 5: max ≥ mae/mfe, chybějící hodnota není selhání', () => {
  assert.equal(check(health([trade()]), 5).status, 'pass');
  assert.equal(check(health([trade({ maxAdverseTicks: 2, maeTicks: 3 })]), 5).status, 'fail');
  assert.equal(check(health([trade({ maxFavorableTicks: 20, mfeTicks: 25 })]), 5).status, 'fail');
  assert.equal(check(health([trade({ maxAdverseTicks: null, maxFavorableTicks: null })]), 5).status, 'na');
});

test('kontrola 6: slTicks ≤ 40', () => {
  assert.equal(check(health([trade({ slTicks: 40, exitTicks: 80, rMultiple: 2 })]), 6).status, 'pass');
  assert.equal(check(health([trade({ slTicks: 1607, exitTicks: 24, rMultiple: 0.01 })]), 6).status, 'fail');
});

test('kontrola 7: maxAdverseTicks 0 u ziskového bez maeTicks', () => {
  assert.equal(check(health([trade({ maeTicks: null, maxAdverseTicks: 0 })]), 7).status, 'fail');
  assert.equal(check(health([trade({ maeTicks: null, maxAdverseTicks: 4 })]), 7).status, 'pass');
  assert.equal(check(health([trade({ maeTicks: 0, maxAdverseTicks: 0 })]), 7).status, 'na', 's naměřeným MAE je 0 platná');
});

test('kontrola 8: duplicity – stejné datum, vstup a čas do 5 minut', () => {
  const a = trade({ entryTime: '15:40', entryPrice: '7566' });
  const b = trade({ entryTime: '15:44', entryPrice: 7566 });
  const c = trade({ entryTime: '15:50', entryPrice: '7566' });
  const h = health([a, b, c]);
  assert.equal(check(h, 8).status, 'fail');
  assert.deepEqual(check(h, 8).items.map(i => i.record.id), [b.id]);
  assert.equal(check(health([trade(), trade()]), 8).status, 'pass');
});

test('kontrola 8: trojice ve stejné minutě = každý podezřelý jednou', () => {
  const x = { entryTime: '20:12', entryPrice: '7674.25' };
  const a = trade(x), b = trade({ ...x, entryTime: '20:13' }), c = trade({ ...x, entryTime: '20:13' });
  const items = check(health([a, b, c]), 8).items;
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map(i => i.record.id)).size, 2);
  assert.match(items[1].detail, /20:12 \(1 min\), 20:13 \(0 min\)/);
});

test('kontrola 9: >10 záznamů a vše FILLED ⇒ varování', () => {
  const eleven = Array.from({ length: 11 }, () => trade());
  assert.equal(check(health(eleven), 9).status, 'warn');
  assert.equal(check(health(eleven.slice(0, 10)), 9).status, 'na');
  assert.equal(check(health([...eleven, setup()]), 9).status, 'pass');
});

test('kontrola 10: SETUP_ONLY bez P/L polí projde, s pnl selže', () => {
  assert.equal(check(health([trade(), setup()]), 10).status, 'pass');
  const h = health([trade(), setup({ pnlRaw: -20, result: 'stoploss' })]);
  assert.equal(check(h, 10).status, 'fail');
  assert.match(check(h, 10).items[0].detail, /pnlRaw/);
  // Setup s P/L poli se přesto nikdy nedostane do výkonového vzorku.
  const sets = H.partition([setup({ pnlRaw: -20, result: 'stoploss', exitTicks: -8 })].map(N.normalizeRecord));
  assert.equal(sets.perf.length, 0);
  assert.equal(sets.trades.length, 0);
});

// ---------------------------------------------------------------- C) kontroly 11–13

test('kontrola 11: postExitFavorableTicks = 0 NENÍ chybějící pozorování', () => {
  const zero = N.normalizeRecord(trade({ postExitFavorableTicks: 0, maxFavorableTicks: 24, exitTicks: 24 }));
  assert.equal(H.isWithoutObservation(zero), false);
  const empty = N.normalizeRecord(trade({ postExitFavorableTicks: null }));
  assert.equal(H.isWithoutObservation(empty), true);
  const blank = N.normalizeRecord(trade({ postExitFavorableTicks: '' }));
  assert.equal(H.isWithoutObservation(blank), true);
  const absent = trade();
  delete absent.postExitFavorableTicks;
  assert.equal(H.isWithoutObservation(N.normalizeRecord(absent)), true);
});

test('kontrola 11: práh 30 % – přesně 30 % projde, víc varuje s textem', () => {
  const ok = [...Array(7)].map(() => trade()).concat([...Array(3)].map(() => trade({ postExitFavorableTicks: null })));
  assert.equal(check(health(ok), 11).status, 'pass');
  const bad = [...Array(6)].map(() => trade()).concat([...Array(4)].map(() => trade({ postExitFavorableTicks: null })));
  const c = check(health(bad), 11);
  assert.equal(c.status, 'warn');
  assert.equal(c.items.length, 4);
  assert.match(c.message, /^U 4 obchodů chybí pozorování po výstupu\./);
  assert.match(c.message, /systematicky hlasovat pro těsnější cíl/);
});

test('kontrola 11: jen target s vyplněným maxFavorableTicks; nuly nepočítá', () => {
  const h = health([
    trade({ postExitFavorableTicks: 0, maxFavorableTicks: 24 }),
    trade({ maxFavorableTicks: null, postExitFavorableTicks: null }),
    stop({ postExitFavorableTicks: null })
  ]);
  const c = check(h, 11);
  assert.equal(c.checked, 1);
  assert.equal(c.status, 'pass');
  assert.equal(check(health([stop()]), 11).status, 'na');
});

test('kontrola 12: rozdíl > 25 p. b. varuje a říká směr', () => {
  const winners = [...Array(4)].map(() => trade());
  const losers = [stop(), stop({ postExitFavorableTicks: null }), stop({ postExitFavorableTicks: null }), stop({ postExitFavorableTicks: null })];
  const c = check(health([...winners, ...losers]), 12);
  assert.equal(c.status, 'warn');
  assert.equal(c.target.pct, 1);
  assert.equal(c.stoploss.pct, 0.25);
  assert.match(c.message, /hlavně u ziskových obchodů/);

  const reverse = check(health([trade({ postExitFavorableTicks: null }), stop()]), 12);
  assert.equal(reverse.status, 'warn');
  assert.match(reverse.message, /hlavně u ztrátových obchodů/);
});

test('kontrola 12: přesně 25 p. b. projde; jedna skupina prázdná ⇒ N/A', () => {
  const c = check(health([...[...Array(4)].map(() => trade()), stop(), stop(), stop(), stop({ postExitFavorableTicks: null })]), 12);
  assert.equal(c.status, 'pass');
  assert.equal(check(health([trade(), trade()]), 12).status, 'na');
});

test('kontrola 13: max > 4 × medián varuje, přesně 4× projde', () => {
  const warn = check(health([trade({ observedMinutes: 2 }), trade({ observedMinutes: 3 }), trade({ observedMinutes: 30 })]), 13);
  assert.equal(warn.status, 'warn');
  assert.deepEqual([warn.stats.min, warn.stats.median, warn.stats.max], [2, 3, 30]);
  assert.equal(warn.items.length, 1);
  assert.match(warn.message, /liší řádově/);
  const edge = check(health([trade({ observedMinutes: 2 }), trade({ observedMinutes: 3 }), trade({ observedMinutes: 12 })]), 13);
  assert.equal(edge.status, 'pass');
});

test('kontrola 13: méně než 2 hodnoty nebo medián 0 ⇒ jen statistika', () => {
  const one = check(health([trade({ observedMinutes: 5 }), trade({ observedMinutes: null })]), 13);
  assert.equal(one.status, 'na');
  assert.equal(one.stats.pct, 0.5);
  assert.equal(check(health([trade({ observedMinutes: 0 }), trade({ observedMinutes: 0 }), trade({ observedMinutes: 9 })]), 13).status, 'na');
});

// ---------------------------------------------------------------- D) odhad

test('odhad: tempo = použitelné pro SL sweep / obchodní dny', () => {
  const h = health([
    trade({ date: '2026-08-03' }), trade({ date: '2026-08-03' }),
    trade({ date: '2026-08-04' }), trade({ date: '2026-08-04', maxAdverseTicks: null })
  ]);
  assert.equal(h.forecast.usable, 3);
  assert.equal(h.forecast.days, 2);
  assert.equal(h.forecast.perDay, 1.5);
  assert.deepEqual(h.forecast.goals.map(g => [g.goal, g.remaining, g.days]), [[50, 47, 32], [100, 97, 65]]);
  const zero = health([trade({ maxAdverseTicks: null })]);
  assert.equal(zero.forecast.goals[0].days, null);
});

// ---------------------------------------------------------------- filtry

test('filtry: rozsah dat, instrument, setup', () => {
  const recs = [
    trade({ date: '2026-08-03', instrument: 'ES' }),
    trade({ date: '2026-08-05', instrument: 'MES', setupCode: 'M2_TREND' }),
    trade({ date: '2026-08-05', instrument: 'MES', setupCode: '' }),
    setup({ date: '2026-08-05', instrument: 'MES' })
  ].map(N.normalizeRecord);
  assert.equal(H.filterRecords(recs, { dateFrom: '2026-08-04' }).length, 3);
  assert.equal(H.filterRecords(recs, { dateTo: '2026-08-04' }).length, 1);
  assert.equal(H.filterRecords(recs, { instrument: 'MES' }).length, 3);
  assert.equal(H.filterRecords(recs, { setupCode: 'M2_TREND' }).length, 1);
  assert.equal(H.filterRecords(recs, { setupCode: '__none__' }).length, 1);
});
