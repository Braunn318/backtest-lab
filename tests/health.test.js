'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const H = require('../app/health.js');
const { trade, stop, setup, many } = require('./helpers/records.js');

const health = (raws, options) => H.computeHealth(raws.map(N.normalizeRecord), options);
const check = (h, id) => h.checks.find(c => c.id === id);
const usable = (h, key) => h.usability.find(u => u.key === key);

// ---------------------------------------------------------------- A) vzorek

test('přehled vzorku: TRADE / SETUP_ONLY / legacy / po dnech / rozsah dat', () => {
  const h = health([trade(), trade({ date: '2026-08-06' }), trade({ legacyPointsConvention: true }), setup(), setup({ fillStatus: 'SKIPPED', date: '2026-08-03' })]);
  assert.equal(h.sample.total, 5);
  assert.equal(h.sample.trades, 3);
  assert.equal(h.sample.setups, 2);
  assert.equal(h.sample.legacy, 1);
  assert.equal(h.sample.perf, 2);
  assert.deepEqual(h.sample.range, { from: '2026-08-03', to: '2026-08-06' });
  assert.equal(h.sample.days[0].date, '2026-08-06', 'nejnovější den nahoře');
  const d5 = h.sample.days.find(d => d.date === '2026-08-05');
  assert.deepEqual({ t: d5.trades, s: d5.setups, nf: d5.noFill, l: d5.legacy }, { t: 2, s: 1, nf: 1, l: 1 });
});

test('použitelnost: legacy se nepočítá, SETUP_ONLY nikdy ve výkonu', () => {
  const h = health([trade(), trade({ legacyPointsConvention: true }), setup({ maxFavorableTicks: 50, slTicks: 10, mfeTicks: 9 })]);
  for (const key of ['r', 'slSweep', 'grid', 'plannedTarget']) {
    assert.equal(usable(h, key).n, 1, key);
    assert.equal(usable(h, key).m, 1, key);
  }
  assert.equal(usable(h, 'r').missing, 49);
});

test('použitelnost: dopočtené MFE/MAE se nepočítá', () => {
  const h = health([
    trade(),
    trade({ maeTicksSource: undefined, maeTicksDerived: true }),
    stop({ mfeTicksSource: undefined, mfeTicksDerived: true })
  ]);
  assert.equal(usable(h, 'maeWinners').n, 1);
  assert.equal(usable(h, 'maeWinners').m, 2);
  assert.equal(usable(h, 'mfeStopped').n, 0);
  assert.equal(usable(h, 'mfeStopped').m, 1);
});

test('použitelnost: mřížka potřebuje naměřené maximum proti i ve směru', () => {
  const h = health([
    trade(),
    trade({ maeTicks: null, postExitAdverseTicks: null }),
    trade({ mfeTicks: null, postExitFavorableTicks: null })
  ]);
  assert.equal(usable(h, 'grid').n, 1);
});

test('použitelnost: plánovaný cíl – MANUAL_EXIT a cena z výstupu se nepočítají', () => {
  const h = health([
    trade(),
    trade({ targetLevel1: { type: 'MANUAL_EXIT', price: 7830 } }),
    trade({ targetLevel1: { type: 'VAH', price: 7830 }, targetLevel1PriceDerived: true }),
    trade({ targetLevel1: { type: 'VAH', price: null } })
  ]);
  assert.equal(usable(h, 'plannedTarget').n, 1);
});

test('použitelnost: síla hladin počítá řádky s místem (cena nebo vzdálenost)', () => {
  const h = health([
    trade({ srTarget: [{ level: 'VAL', price: 7830, ticksFromEntry: null }, { level: 'VWAP', price: null, ticksFromEntry: null }] }),
    trade({ srTarget: [{ level: 'VAH', price: null, ticksFromEntry: 10 }] })
  ]);
  assert.equal(usable(h, 'levelsTarget').n, 2);
  assert.equal(usable(h, 'levelsTarget').m, 3);
  assert.equal(usable(h, 'levelsTarget').unit, 'řádků');
});

test('použitelnost: kontrolní skupina = menší ze skupin žádná / hladina; nevyplněno nevstupuje', () => {
  const h = health([
    trade(), trade({ srTarget: [], srTargetNone: true }),
    trade({ srTarget: [{ level: 'VAL', price: 7830, ticksFromEntry: null }] }),
    trade({ srTarget: [] }), trade({ srTarget: undefined })
  ]);
  assert.equal(usable(h, 'controlGroup').n, 1);
  assert.match(usable(h, 'controlGroup').note, /žádná hladina 2 · hladina 1 · nevyplněno 2/);
});

test('fill rate: pod 10 NO_FILL je n/a s důvodem, ne číslo', () => {
  const few = health([trade(), trade(), setup(), setup()]);
  assert.equal(usable(few, 'fillRate').n, 0);
  assert.equal(usable(few, 'fillRate').rate, null);
  assert.match(usable(few, 'fillRate').note, /NO_FILL\) je 2, méně než 10/);
  const enough = health([...many(30, trade), ...many(10, setup)]);
  assert.equal(usable(enough, 'fillRate').n, 40);
  assert.equal(usable(enough, 'fillRate').rate, 0.75);
  assert.equal(usable(enough, 'fillRate').note, null);
});

// ---------------------------------------------------------------- wouldSkipLive

test('wouldSkipLive: ve výchozím stavu mimo výkon, ale ve fill rate zůstává', () => {
  const raws = [trade(), trade({ wouldSkipLive: true, wouldSkipReason: 'SR_IN_WAY' }), ...many(10, setup)];
  const h = health(raws);
  assert.equal(h.sample.skipLive, 1);
  assert.equal(h.sample.hasSkipLiveField, true);
  assert.equal(usable(h, 'r').n, 1);
  assert.equal(usable(h, 'fillRate').n, 12, 'fill rate: 2 FILLED + 10 NO_FILL');
  const incl = health(raws, { includeSkipLive: true });
  assert.equal(usable(incl, 'r').n, 2);
  assert.equal(usable(incl, 'fillRate').n, 12);
});

test('wouldSkipLive: blok „bez nich / s nimi" se počítá bez ohledu na přepínač', () => {
  const raws = [trade({ pnlRaw: 100 }), stop({ pnlRaw: -50 }), stop({ wouldSkipLive: true, wouldSkipReason: 'SR_IN_WAY', pnlRaw: -60 })];
  for (const includeSkipLive of [false, true]) {
    const s = health(raws, { includeSkipLive }).skipLive;
    assert.equal(s.count, 1);
    assert.equal(s.pnl, -60);
    assert.equal(s.without.expectancy, 25);
    assert.equal(s.with.expectancy, -10 / 3);
    assert.equal(s.byReason[0].label, 'SR zóna / hladina v cestě');
  }
});

// ---------------------------------------------------------------- B) úplnost

test('úplnost: podle missingContextKeys deníku, od nejhoršího', () => {
  const h = health([trade({ setupCode: '' }), trade({ maeTicks: undefined, maeTicksSource: undefined }), trade()]);
  const row = f => h.completeness.rows.find(r => r.field === f);
  assert.deepEqual(h.completeness.rows.map(r => r.field).sort(), [...N.CONTEXT_KEYS].sort());
  assert.equal(row('setupCode').missing, 1);
  assert.equal(row('maeTicks').missing, 1);
  assert.equal(row('trend').missing, 0);
  assert.equal(h.completeness.incomplete, 2);
  for (let i = 1; i < h.completeness.rows.length; i++) assert.ok(h.completeness.rows[i - 1].pct <= h.completeness.rows[i].pct);
});

test('úplnost: dopočtená hodnota je vyplněná, ale ukáže se zvlášť', () => {
  const h = health([trade({ mfeTicksSource: undefined, mfeTicksDerived: true }), trade()]);
  const mfe = h.completeness.rows.find(r => r.field === 'mfeTicks');
  assert.equal(mfe.missing, 0);
  assert.equal(mfe.derived, 1);
});

test('neznámé klíče se nahlásí, známé ne', () => {
  const h = health([trade({ srStopLoss: [{ level: 'OLD_LEVEL', price: 7790, ticksFromEntry: null }], setupCode: 'MY_SETUP' }), trade()]);
  assert.deepEqual(h.unknownKeys.map(u => `${u.field}:${u.key}`).sort(), ['setupCode:MY_SETUP', 'srStopLoss:OLD_LEVEL']);
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

test('kontrola 9: pod 10 NO_FILL n/a s důvodem (54 FILLED + 2 NO_FILL není statistika)', () => {
  const c = check(health([...many(54, trade), setup(), setup()]), 9);
  assert.equal(c.status, 'na');
  assert.match(c.summary, /je 2, méně než 10/);
});

test('kontrola 9: fill rate > 90 % při více než 20 ⇒ varování; přesně 90 % projde', () => {
  const high = check(health([...many(95, trade), ...many(10, setup)]), 9);
  assert.equal(high.status, 'warn');
  assert.match(high.message, /nezvykle vysoký — zapisuješ všechny nenaplněné limitky\?/);
  assert.equal(check(health([...many(90, trade), ...many(10, setup)]), 9).status, 'pass');
  assert.equal(check(health([...many(30, trade), ...many(10, setup)]), 9).status, 'pass');
});

test('kontrola 10: SETUP_ONLY bez P/L polí projde, s pnl selže', () => {
  assert.equal(check(health([trade(), setup()]), 10).status, 'pass');
  const h = health([trade(), setup({ pnlRaw: -20, result: 'stoploss' })]);
  assert.equal(check(h, 10).status, 'fail');
  assert.match(check(h, 10).items[0].detail, /pnlRaw/);
  const sets = H.partition([setup({ pnlRaw: -20, result: 'stoploss', exitTicks: -8 })].map(N.normalizeRecord));
  assert.equal(sets.perf.length, 0);
  assert.equal(sets.trades.length, 0);
});

// ---------------------------------------------------------------- C) kontroly 11–13

test('kontrola 11: postExitFavorableTicks = 0 NENÍ chybějící pozorování', () => {
  assert.equal(H.isWithoutObservation(N.normalizeRecord(trade({ postExitFavorableTicks: 0, maxFavorableTicks: 24, exitTicks: 24 }))), false);
  assert.equal(H.isWithoutObservation(N.normalizeRecord(trade({ postExitFavorableTicks: null }))), true);
  assert.equal(H.isWithoutObservation(N.normalizeRecord(trade({ postExitFavorableTicks: '' }))), true);
  const absent = trade();
  delete absent.postExitFavorableTicks;
  assert.equal(H.isWithoutObservation(N.normalizeRecord(absent)), true);
});

test('kontrola 11: target bez maxFavorableTicks i bez pozorování JE v základu i mezi chybějícími', () => {
  const lost = trade({ maxFavorableTicks: null, postExitFavorableTicks: null, mfeTicks: null });
  const c = check(health([trade(), lost]), 11);
  assert.equal(c.checked, 2);
  assert.equal(c.missing, 1);
  assert.deepEqual(c.items.map(i => i.record.id), [lost.id]);
});

test('kontrola 11: 26 targetů, 6 bez pozorování ⇒ 23 %, ne 8 %', () => {
  // Stav dat 3. 10.: 20 targetů s pozorováním, 6 bez – ty nemají ani maxFavorableTicks.
  const raws = [
    ...many(20, () => trade()),
    ...many(6, () => trade({ postExitFavorableTicks: null, maxFavorableTicks: null })),
    ...many(28, () => stop())
  ];
  const c = check(health(raws), 11);
  assert.equal(c.checked, 26);
  assert.equal(c.missing, 6);
  assert.equal(Math.round(c.share * 100), 23);
  assert.equal(c.status, 'pass');
});

test('kontrola 11: práh 30 % – přesně 30 % projde, víc varuje s textem', () => {
  const ok = [...many(7, trade), ...many(3, () => trade({ postExitFavorableTicks: null }))];
  assert.equal(check(health(ok), 11).status, 'pass');
  const bad = [...many(6, trade), ...many(4, () => trade({ postExitFavorableTicks: null }))];
  const c = check(health(bad), 11);
  assert.equal(c.status, 'warn');
  assert.equal(c.items.length, 4);
  assert.match(c.message, /^U 4 obchodů chybí pozorování po výstupu\./);
  assert.match(c.message, /systematicky hlasovat pro těsnější cíl/);
  assert.equal(check(health([stop()]), 11).status, 'na');
});

test('kontrola 12: rozdíl > 25 p. b. varuje a říká směr', () => {
  const winners = many(4, trade);
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
  const c = check(health([...many(4, trade), stop(), stop(), stop(), stop({ postExitFavorableTicks: null })]), 12);
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

// ---------------------------------------------------------------- D) prognóza

test('prognóza: pro každou analýzu zvlášť, hrdlo = nejmenší N a říká, co chybí', () => {
  const h = health([
    trade({ date: '2026-08-03' }), trade({ date: '2026-08-03', targetLevel1: { type: 'MANUAL_EXIT', price: 7830 } }),
    trade({ date: '2026-08-04', targetLevel1: null }), trade({ date: '2026-08-04', targetLevel1: null })
  ]);
  const f = h.forecast;
  assert.equal(f.days, 2);
  const planned = f.rows.find(r => r.key === 'plannedTarget');
  assert.equal(planned.n, 1);
  assert.equal(planned.perDay, 0.5);
  assert.deepEqual(planned.goals.map(g => [g.goal, g.remaining, g.days]), [[50, 49, 98], [100, 99, 198]]);
  const sweep = f.rows.find(r => r.key === 'slSweep');
  assert.equal(sweep.n, 4);
  assert.deepEqual(sweep.goals.map(g => g.days), [23, 48]);
  // hrdlo: nejmenší N (tady síla hladin bez řádků = 0)
  assert.equal(f.bottleneck.n, Math.min(...f.rows.map(r => r.n)));
  assert.ok(f.bottleneck.lacks);
  assert.equal(f.rows.some(r => r.key === 'fillRate'), false, 'fill rate se neprognózuje');
});

test('prognóza: tempo 0 ⇒ nelze odhadnout (null), ne nekonečno', () => {
  const f = health([trade({ targetLevel1: null })]).forecast;
  assert.equal(f.rows.find(r => r.key === 'plannedTarget').goals[0].days, null);
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
