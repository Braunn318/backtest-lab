'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');

test('ceny ze stringů jsou čísla, staré číselné zůstávají', () => {
  const a = N.normalizeRecord({ entryPrice: '7554', exitPrice: '7550.5', slPrice: 7563 });
  assert.equal(a.entryPrice, 7554);
  assert.equal(a.exitPrice, 7550.5);
  assert.equal(a.slPrice, 7563);
  const b = N.normalizeRecord({ entryPrice: 7748.75, plannedEntryPrice: '7803,5' });
  assert.equal(b.entryPrice, 7748.75);
  assert.equal(b.plannedEntryPrice, 7803.5);
});

test('nula zůstává nulou, prázdné je null', () => {
  const r = N.normalizeRecord({ postExitFavorableTicks: 0, maxAdverseTicks: 0, maeTicks: '', mfeTicks: null, slTicks: 'x' });
  assert.equal(r.postExitFavorableTicks, 0);
  assert.equal(r.maxAdverseTicks, 0);
  assert.equal(r.maeTicks, null);
  assert.equal(r.mfeTicks, null);
  assert.equal(r.slTicks, null);
  assert.equal(r.observedMinutes, null, 'chybějící pole je null');
});

test('R se znaménkem: stoploss záporné, target kladné', () => {
  const sl = N.normalizeRecord({ result: 'stoploss', rMultiple: 1, exitTicks: -12 });
  assert.equal(sl.rSigned, -1);
  const tg = N.normalizeRecord({ result: 'target', rMultiple: 1.9, exitTicks: 19 });
  assert.equal(tg.rSigned, 1.9);
});

test('R u BE: exitTicks > 0 a pnlRaw < 0 (komise) ⇒ kladné R a ziskový podle ticků', () => {
  const be = N.normalizeRecord({ result: 'breakeven', rMultiple: 0.14, exitTicks: 1, pnlRaw: -1.3 });
  assert.equal(be.rSigned, 0.14);
  assert.equal(be.isProfitable, true);
});

test('R bez rMultiple nebo exitTicks je null; exitTicks 0 dává 0', () => {
  assert.equal(N.normalizeRecord({ rMultiple: null, exitTicks: 10 }).rSigned, null);
  assert.equal(N.normalizeRecord({ rMultiple: 1 }).rSigned, null);
  assert.equal(N.normalizeRecord({ rMultiple: 1, exitTicks: 0 }).rSigned, 0);
  assert.equal(N.normalizeRecord({ exitTicks: 0 }).isProfitable, false);
  assert.equal(N.normalizeRecord({}).isProfitable, null);
});

test('R: kdyby deník uložil rMultiple se znaménkem, výsledek je stejný', () => {
  assert.equal(N.normalizeRecord({ rMultiple: -1, exitTicks: -12 }).rSigned, -1);
});

test('srTarget: starý tvar (klíče) i nový (řádky s cenou) → řádky', () => {
  const old = N.normalizeRecord({ srTarget: ['VPOC_1M', 'NONE'], srStopLoss: [] });
  assert.deepEqual(old.srTarget, [
    { level: 'VPOC_1M', price: null, ticksFromEntry: null },
    { level: 'NONE', price: null, ticksFromEntry: null }
  ]);
  assert.deepEqual(old.srStopLoss, []);
  assert.equal(old.srTarget.some(N.levelRowHasPlace), false);

  const neu = N.normalizeRecord({ srTarget: [{ level: 'VWAP', price: '7770.5', ticksFromEntry: null }, { level: 'VAH', price: null, ticksFromEntry: 8 }] });
  assert.deepEqual(neu.srTarget, [
    { level: 'VWAP', price: 7770.5, ticksFromEntry: null },
    { level: 'VAH', price: null, ticksFromEntry: 8 }
  ]);
  assert.equal(neu.srTarget.every(N.levelRowHasPlace), true);
});

test('srTarget: chybějící nebo nesmyslné pole → prázdné pole', () => {
  assert.deepEqual(N.normalizeRecord({}).srTarget, []);
  assert.deepEqual(N.normalizeRecord({ srTarget: 'VAH' }).srTarget, []);
  assert.deepEqual(N.normalizeRecord({ srTarget: [null, '', {}] }).srTarget, []);
});

test('wouldSkipLive: chybí ⇒ live-eligible; true ⇒ ne', () => {
  const missing = N.normalizeRecord({ result: 'target' });
  assert.equal(missing.isLiveEligible, true);
  assert.equal(missing.hasWouldSkipLiveField, false);
  const skip = N.normalizeRecord({ wouldSkipLive: true, wouldSkipReason: 'jen měření' });
  assert.equal(skip.isLiveEligible, false);
  assert.equal(skip.wouldSkipReason, 'jen měření');
  assert.equal(skip.hasWouldSkipLiveField, true);
  assert.equal(N.normalizeRecord({ wouldSkipLive: false }).isLiveEligible, true);
});

test('SETUP_ONLY ⇒ isTrade false; bez recordType ⇒ TRADE', () => {
  const s = N.normalizeRecord({ recordType: 'SETUP_ONLY', fillStatus: 'NO_FILL' });
  assert.equal(s.isTrade, false);
  assert.equal(s.isSetupOnly, true);
  const t = N.normalizeRecord({ result: 'target' });
  assert.equal(t.isTrade, true);
  assert.equal(t.isSetupOnly, false);
});

test('legacyPointsConvention se převezme jako isLegacy', () => {
  assert.equal(N.normalizeRecord({ legacyPointsConvention: true }).isLegacy, true);
  assert.equal(N.normalizeRecord({}).isLegacy, false);
});

test('prázdné řetězce v textových polích jsou null', () => {
  const r = N.normalizeRecord({ setupCode: '', fillStatus: '', trend: '  ', side: 'long' });
  assert.equal(r.setupCode, null);
  assert.equal(r.fillStatus, null);
  assert.equal(r.trend, null);
  assert.equal(r.side, 'long');
});

test('targetLevel: typ a cena, prázdný objekt ⇒ null', () => {
  assert.deepEqual(N.normalizeRecord({ targetLevel1: { type: 'VAL', price: '7744.75' } }).targetLevel1, { type: 'VAL', price: 7744.75 });
  assert.deepEqual(N.normalizeRecord({ targetLevel1: { type: 'MANUAL_EXIT', price: null } }).targetLevel1, { type: 'MANUAL_EXIT', price: null });
  assert.equal(N.normalizeRecord({ targetLevel1: { type: null, price: null } }).targetLevel1, null);
  assert.equal(N.normalizeRecord({}).targetLevel2, null);
});

test('entryMinutes z času vstupu', () => {
  assert.equal(N.normalizeRecord({ entryTime: '15:30' }).entryMinutes, 930);
  assert.equal(N.normalizeRecord({ entryTime: '09:05:30' }).entryMinutes, 545.5);
  assert.equal(N.normalizeRecord({ entryTime: '' }).entryMinutes, null);
});

test('isEmpty: 0 a false nejsou prázdné, [] a prázdný objekt ano', () => {
  assert.equal(N.isEmpty(0), false);
  assert.equal(N.isEmpty(false), false);
  assert.equal(N.isEmpty(''), true);
  assert.equal(N.isEmpty('  '), true);
  assert.equal(N.isEmpty([]), true);
  assert.equal(N.isEmpty(['NONE']), false);
  assert.equal(N.isEmpty({ type: null, price: null }), true);
  assert.equal(N.isEmpty({ type: 'VAL', price: null }), false);
  assert.equal(N.isEmpty(null), true);
});

test('filled: vyplněnost surových polí bez systémových', () => {
  const r = N.normalizeRecord({ id: 'x', createdAt: 1, setupCode: '', maeTicks: 0, targetLevel1: { type: null, price: null }, entryLevels: ['M2_EDGE'] });
  assert.deepEqual(r.filled, { setupCode: false, maeTicks: true, targetLevel1: false, entryLevels: true });
});

test('normalizeExport: celý soubor', () => {
  const e = N.normalizeExport({ journalId: 'journal_1', updatedAt: '2026-09-29T15:13:55Z', trades: [{ id: 'a' }, { id: 'b', recordType: 'SETUP_ONLY' }], dayNotes: { '2026-09-01': { notes: 'x' } } });
  assert.equal(e.journalId, 'journal_1');
  assert.equal(e.records.length, 2);
  assert.equal(e.records[1].isSetupOnly, true);
  assert.equal(e.dayNotes['2026-09-01'].notes, 'x');
  assert.deepEqual(N.normalizeExport(null).records, []);
});
