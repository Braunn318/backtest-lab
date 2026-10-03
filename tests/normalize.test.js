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
    { level: 'VPOC_1M', price: null, ticksFromEntry: null, isNone: false, distanceTicks: null },
    { level: 'NONE', price: null, ticksFromEntry: null, isNone: true, distanceTicks: null }
  ]);
  assert.deepEqual(old.srStopLoss, []);
  assert.equal(old.srTarget.some(N.levelRowHasPlace), false);

  const neu = N.normalizeRecord({ instrument: 'ES', entryPrice: '7756.25', srTarget: [{ level: 'VWAP', price: '7750.75', ticksFromEntry: null }, { level: 'VAH', price: null, ticksFromEntry: 8 }] });
  assert.deepEqual(neu.srTarget, [
    { level: 'VWAP', price: 7750.75, ticksFromEntry: null, isNone: false, distanceTicks: 22 },
    { level: 'VAH', price: null, ticksFromEntry: 8, isNone: false, distanceTicks: 8 }
  ]);
  assert.equal(neu.srTarget.every(N.levelRowHasPlace), true);
});

test('vzdálenost SR hladiny: zapsané ticky mají přednost; cena se převede jen se známým tickem', () => {
  const both = N.normalizeRecord({ instrument: 'ES', entryPrice: 7800, srTarget: [{ level: 'VAL', price: 7805, ticksFromEntry: 21 }] });
  assert.equal(both.srTarget[0].distanceTicks, 21);
  const unknownTick = N.normalizeRecord({ instrument: 'XYZ', entryPrice: 7800, srTarget: [{ level: 'VAL', price: 7805, ticksFromEntry: null }] });
  assert.equal(unknownTick.srTarget[0].distanceTicks, null, 'bez velikosti ticku se nic neodhaduje');
  const noEntry = N.normalizeRecord({ instrument: 'ES', srTarget: [{ level: 'VAL', price: 7805, ticksFromEntry: null }] });
  assert.equal(noEntry.srTarget[0].distanceTicks, null);
});

test('stav hladin: none / present / unknown se nikdy neslijí – unknown není none', () => {
  const st = raw => N.normalizeRecord(raw).srTargetState;
  assert.equal(st({ srTargetNone: true, srTarget: [] }), 'none');
  assert.equal(st({ srTarget: [{ level: 'NONE', price: null, ticksFromEntry: null }] }), 'none');
  assert.equal(st({ srTarget: ['NONE', 'NONE'] }), 'none');
  assert.equal(st({ srTarget: [{ level: 'VAL', price: 1, ticksFromEntry: null }] }), 'present');
  assert.equal(st({ srTarget: ['NONE', 'VAL'] }), 'present');
  assert.equal(st({ srTarget: [] }), 'unknown');
  assert.equal(st({}), 'unknown');
  assert.equal(st({ srTargetNone: false, srTarget: [] }), 'unknown');
  assert.equal(N.normalizeRecord({ srStopLossNone: true }).srStopLossState, 'none');
  assert.equal(N.normalizeRecord({ entryLevels: ['NONE'] }).entryLevelsState, 'none');
  assert.equal(N.normalizeRecord({ ofConfirm: [] }).ofConfirmState, 'unknown');
});

test('MFE/MAE: původ nt8 / manual / derived; do *Measured jde jen naměřené', () => {
  const nt8 = N.normalizeRecord({ mfeTicks: 24, mfeTicksSource: 'nt8', maeTicks: 6, maeTicksSource: 'nt8' });
  assert.deepEqual(nt8.mfe, { ticks: 24, tier: 'nt8' });
  assert.equal(nt8.mfeMeasured, 24);
  assert.equal(nt8.maeMeasured, 6);
  const manual = N.normalizeRecord({ mfeTicks: 10, maeTicks: 0 });
  assert.equal(manual.mfe.tier, 'manual');
  assert.equal(manual.maeMeasured, 0, 'nula je měření');
  const derived = N.normalizeRecord({ result: 'target', exitTicks: 24, mfeTicks: 24, mfeTicksDerived: true, maeTicks: 12, maeTicksDerived: true });
  assert.deepEqual(derived.mfe, { ticks: 24, tier: 'derived' });
  assert.equal(derived.mfeMeasured, null);
  assert.equal(derived.maeMeasured, null);
  const missing = N.normalizeRecord({});
  assert.deepEqual(missing.mfe, { ticks: null, tier: null });
});

test('maxFavorable/maxAdverse z naměřeného: dopočtené MFE se nepoužije, pohyb po výstupu ano', () => {
  const r = N.normalizeRecord({ result: 'target', exitTicks: 24, mfeTicks: 24, mfeTicksDerived: true, postExitFavorableTicks: 21, maeTicks: 6, maeTicksSource: 'nt8', postExitAdverseTicks: 40 });
  assert.equal(r.maxFavorableMeasured, 45, 'exit 24 + po výstupu 21');
  assert.equal(r.maxAdverseMeasured, 16, '40 − 24');
  assert.equal(r.slSweepAdverse, 6, 'u targetu rozhoduje MAE během obchodu');
  const onlyDerived = N.normalizeRecord({ result: 'target', exitTicks: 24, mfeTicks: 24, mfeTicksDerived: true });
  assert.equal(onlyDerived.maxFavorableMeasured, null, 'dopočtené MFE samo nic nenaměřilo');
});

test('maximum bez průběhu během obchodu je neznámé, ne 0', () => {
  // vítěz bez naměřeného MAE: pohyb proti po výstupu (10 − 24 < 0) nesmí udělat „0 proti"
  const w = N.normalizeRecord({ result: 'target', exitTicks: 24, postExitAdverseTicks: 10, postExitFavorableTicks: 5 });
  assert.equal(w.maxAdverseMeasured, null);
  assert.equal(w.maxFavorableMeasured, 29, 'u targetu je výstup fakt, pokračování zapsané');
  // stopnutý bez naměřeného MFE: maximum ve směru během obchodu neznáme
  const s = N.normalizeRecord({ result: 'stoploss', exitTicks: -8, postExitFavorableTicks: 30 });
  assert.equal(s.maxFavorableMeasured, null);
  const s2 = N.normalizeRecord({ result: 'stoploss', exitTicks: -8, mfeTicks: 3, mfeTicksSource: 'nt8', postExitFavorableTicks: 30 });
  assert.equal(s2.maxFavorableMeasured, 22);
});

test('stopnutý obchod: protipohyb za stopkou jen ze zapsaného pohybu po výstupu', () => {
  const seen = N.normalizeRecord({ result: 'stoploss', exitTicks: -8, slTicks: 8, maeTicks: 8, maeTicksDerived: true, postExitAdverseTicks: 4 });
  assert.equal(seen.maeMeasured, null);
  assert.equal(seen.maxAdverseMeasured, 12);
  assert.equal(seen.adverseObservedAfterExit, true);
  assert.equal(seen.slSweepAdverse, 12);
  const unseen = N.normalizeRecord({ result: 'stoploss', exitTicks: -8, slTicks: 8 });
  assert.equal(unseen.maxAdverseMeasured, 8, 'výstup na SL je fakt exekuce');
  assert.equal(unseen.adverseObservedAfterExit, false);
});

test('plánovaný cíl: MANUAL_EXIT ani cena převzatá z výstupu nejsou plán', () => {
  const pt = raw => N.normalizeRecord(raw).plannedTarget;
  assert.deepEqual(pt({ targetLevel1: { type: 'VAL', price: '7744.75' } }), { type: 'VAL', price: 7744.75 });
  assert.equal(pt({ targetLevel1: { type: 'MANUAL_EXIT', price: 7744.75 } }), null);
  assert.equal(pt({ targetLevel1: { type: 'MANUAL_EXIT', price: 7744.75 }, targetLevel1PriceDerived: true }), null);
  assert.equal(pt({ targetLevel1: { type: 'LIQUIDITY', price: 7744.75 }, targetLevel1PriceDerived: true }), null);
  assert.deepEqual(pt({ targetLevel1: { type: 'VAH', price: null } }), { type: 'VAH', price: null });
  assert.equal(pt({}), null);
  const r = N.normalizeRecord({ instrument: 'ES', entryPrice: '7800', targetLevel1: { type: 'VAL', price: 7806 }, plannedRMultiple: 2 });
  assert.equal(r.plannedTargetTicks, 24);
  assert.equal(r.plannedRMultiple, 2);
});

test('missingContext: stejná definice jako missingContextKeys v deníku', () => {
  const full = {
    setupCode: 'M2_OF', fillStatus: 'FILLED', trend: 'LONG', entryLevels: ['M2_EDGE'], srTarget: [], srTargetNone: true,
    srStopLoss: [{ level: 'VAL', price: 1, ticksFromEntry: null }], ofConfirm: ['NONE'], targetLevel1: { type: 'VAL', price: 7806 },
    slPrice: 7797, mfeTicks: 24, mfeTicksDerived: true, maeTicks: 0, postExitFavorableTicks: 0, postExitAdverseTicks: 3
  };
  assert.deepEqual(N.normalizeRecord(full).missingContext, [], 'nula i dopočtená hodnota jsou vyplněné');
  assert.deepEqual(N.normalizeRecord({ ...full, srTargetNone: undefined, setupCode: '', targetLevel1: { type: 'VAL', price: null } }).missingContext, ['setupCode', 'srTarget', 'targetLevel1']);
  assert.deepEqual(N.normalizeRecord({ ...full, fillStatus: 'NO_FILL', mfeTicks: null, slPrice: '' }).missingContext, [], 'u nenaplněného se průběh nekontroluje');
  assert.deepEqual(N.normalizeRecord({ recordType: 'SETUP_ONLY' }).missingContext, []);
});

test('neznámé klíče: sbírají se, nic se neskrývá ani nepřepisuje', () => {
  const r = N.normalizeRecord({ setupCode: 'MY_SETUP', srStopLoss: [{ level: 'GONE', price: 1, ticksFromEntry: null }], entryLevels: ['VWAP_DEV'], targetLevel1: { type: 'VAL', price: 1 } });
  assert.deepEqual(r.unknownKeys, [{ field: 'setupCode', key: 'MY_SETUP' }, { field: 'srStopLoss', key: 'GONE' }]);
  assert.equal(r.setupCode, 'MY_SETUP');
  assert.equal(r.srStopLoss[0].level, 'GONE');
});

test('příznaky původu hodnoty nejsou systémová pole', () => {
  for (const key of ['mfeTicksSource', 'maeTicksSource', 'mfeTicksDerived', 'maeTicksDerived', 'slDerived', 'targetLevel1PriceDerived']) {
    assert.equal(N.SYSTEM_FIELDS.has(key), false, key);
  }
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
