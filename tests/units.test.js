'use strict';
// Jednotka vzdáleností ticky ↔ body (2. 11. 2026). Počítá se v tikách,
// přepínač mění jen zobrazení a zadávání. Body jen když má celý výběr stejnou
// známou velikost ticku; jinak ticky s poznámkou.
const test = require('node:test');
const assert = require('node:assert/strict');
const LU = require('../app/units.js');
const H = require('../app/health.js');
const S = require('../app/sltp.js');
const O = require('../app/overview.js');
const V = require('../app/views.js');
const W = require('../app/whatif.js');
const { trade, stop, normAll, many } = require('./helpers/records.js');

globalThis.window = globalThis;
require('../app/labels.js');
require('../app/context.js');
require('../app/summary.js');
require('../app/diagnosis.js');
require('../app/ui-common.js');
require('../app/ui-summary.js');
require('../app/ui-sltp.js');
require('../app/ui-levels.js');

function ctxOf(raws, views = {}) {
  const records = normAll(raws);
  const options = H.includeOf(views);
  return { records, perf: H.partition(records, options).perf, health: H.computeHealth(records, options), views, options, units: LU.context(records, views.unitMode) };
}

test('kontext jednotky: body s desetinnou čárkou, ticky beze změny', () => {
  const pts = LU.context([{ tickSize: 0.25 }, { tickSize: 0.25 }], 'points');
  assert.equal(pts.unit, 'points');
  assert.equal(pts.d(17), '4,25 b');
  assert.equal(pts.d(5, { signed: true }), '+1,25 b');
  assert.equal(pts.d(null), '—');
  assert.equal(pts.toTicks('4,25'), 17);
  assert.equal(pts.value(17), 4.25);
  const ticks = LU.context([{ tickSize: 0.25 }], 'ticks');
  assert.equal(ticks.d(17), '17 t');
  assert.equal(ticks.toTicks(2), 2);
  assert.equal(LU.TICKS.d(2.5), '2,5 t');
});

test('smíšená nebo neznámá velikost ticku: ticky a fallback', () => {
  const mixed = LU.context([{ tickSize: 0.25 }, { tickSize: 1 }], 'points');
  assert.equal(mixed.unit, 'ticks');
  assert.equal(mixed.fallback, true);
  assert.equal(mixed.d(17), '17 t');
  const unknown = LU.context([{ tickSize: 0.25 }, { tickSize: null }], 'points');
  assert.equal(unknown.fallback, true);
  assert.equal(LU.context([{ tickSize: 0.25 }], 'ticks').fallback, false);
});

test('views.json: unitMode se ukládá jen jako „points“', () => {
  assert.equal(V.sanitizeViews({ unitMode: 'points' }).unitMode, 'points');
  assert.equal(V.sanitizeViews({ unitMode: 'ticks' }).unitMode, undefined);
  assert.equal(V.sanitizeViews({ unitMode: 'nesmysl' }).unitMode, undefined);
  assert.equal(V.forJournalChange({ unitMode: 'points' }).unitMode, 'points', 'změna deníku jednotku nemaže');
});

test('verdikt obchodu v bodech (ES, tick 0,25)', () => {
  const [r] = normAll([stop({ slTicks: 12, mfeTicks: 6 })]);
  const U = LU.context([r], 'points');
  assert.match(S.tradeRow(r, U).verdict.text, /^MFE 1,5 b při SL 3 b — obchod se nikdy nerozjel/);
  assert.match(S.tradeRow(r).verdict.text, /^MFE 6 t při SL 12 t/, 'bez jednotky ticky');
});

test('obrazovka SL a TP v bodech: žádné „ t“ u vzdáleností, čísla převedená', () => {
  const raws = [...many(12, () => trade({ maeTicks: 8 })), ...many(12, () => stop())];
  const html = window.LabScreens.sltp.render(ctxOf(raws, { unitMode: 'points' }));
  assert.match(html, /Vše v bodech/);
  assert.match(html, /p90[^<]*<\/[^>]+>\s*<[^>]+>2 b/);
  assert.doesNotMatch(html, /\d t\b/, 'zbylá vzdálenost v tikách');
  const ticks = window.LabScreens.sltp.render(ctxOf(raws));
  assert.match(ticks, /Vše v ticích/);
});

test('Co kdyby: popis SL v bodech', () => {
  const U = LU.context([{ tickSize: 0.25 }], 'points');
  assert.equal(W.describeConfig({ sl: { mode: 'wider', ticks: 8 } }, [], U), 'SL o 2 b širší');
  assert.equal(W.describeConfig({ sl: { mode: 'wider', ticks: 8 } }), 'SL o 8 t širší');
});
