'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/sltp.js');
const { trade, stop, norm, many } = require('./helpers/records.js');

const derivedMae = { maeTicksSource: undefined, maeTicksDerived: true };
const derivedMfe = { mfeTicksSource: undefined, mfeTicksDerived: true };

// ---------------------------------------------------------------- 1) dopočtené nevstupují

test('rozdělení MAE vítězů: dopočtené MAE nevstupuje, jen se spočítá', () => {
  const recs = norm([trade({ maeTicks: 2 }), trade({ maeTicks: 4 }), trade({ maeTicks: 40, ...derivedMae })]);
  const d = S.maeWinners(recs);
  assert.equal(d.n, 2);
  assert.equal(d.derived, 1);
  assert.equal(d.max, 4, 'dopočtených 40 t by jinak bylo maximum');
});

test('rozdělení MFE stopnutých: dopočtené MFE nevstupuje', () => {
  const recs = norm([stop({ mfeTicks: 5 }), stop({ mfeTicks: 30, ...derivedMfe })]);
  const d = S.mfeStopped(recs);
  assert.equal(d.n, 1);
  assert.equal(d.derived, 1);
  assert.equal(d.byTicks.find(x => x.tp === 20).reach, 0);
});

test('mřížka: obchod jen s dopočtenými hodnotami do ní nevstupuje', () => {
  // target s dopočteným MFE (= exitTicks) a dopočteným MAE, bez pohybu po výstupu
  const derivedOnly = trade({ ...derivedMfe, ...derivedMae, mfeTicks: 24, maeTicks: 0, postExitFavorableTicks: null, postExitAdverseTicks: null });
  const g = S.grid(norm([trade(), derivedOnly]));
  assert.equal(g.n, 1);
  assert.equal(g.derivedExcluded, 1);
});

test('mřížka: dopočtené MFE nesníží maximum ve směru (nechané na stole nevyjde 0)', () => {
  // naměřené pokračování po výstupu 20 t; dopočtené MFE = exit 24 by samo dalo 24
  const [r] = norm([trade({ ...derivedMfe, mfeTicks: 24, postExitFavorableTicks: 20 })]);
  assert.equal(r.maxFavorableMeasured, 44);
  assert.equal(S.gridOutcome(r, 12, 3).kind, 'target', '3R z 12 t = 36 t ≤ 44 t');
});

// ---------------------------------------------------------------- 2.1 po obchodech

test('verdikt: zbytečně široký SL', () => {
  const [r] = norm([trade({ slTicks: 12, maeTicks: 3 })]);
  const row = S.tradeRow(r);
  assert.equal(row.reserve, 9);
  assert.match(row.verdict.text, /SL 12 t, cena proti šla 3 t — SL byl zbytečně široký, 5 t by stačilo/);
});

test('verdikt: těsný a nestačící SL', () => {
  assert.equal(S.tradeRow(norm([trade({ slTicks: 12, maeTicks: 10 })])[0]).tight, 'těsně');
  assert.equal(S.tradeRow(norm([trade({ slTicks: 12, maeTicks: 12 })])[0]).tight, 'nestačil');
  assert.equal(S.tradeRow(norm([trade({ slTicks: 12, maeTicks: 6 })])[0]).tight, null);
});

test('verdikt: stopnutý obchod, cena se vrátila – o kolik dál by SL stačil', () => {
  // SL 8 t, za stopkou ještě 3 t (maxAdverse 11), pak zpátky 20 t ve směru
  const [r] = norm([stop({ slTicks: 8, exitTicks: -8, mfeTicks: 6, maeTicks: 8, ...derivedMae, postExitAdverseTicks: 3, postExitFavorableTicks: 20 })]);
  const row = S.tradeRow(r);
  assert.equal(row.widerBy, 4, 'maxAdverse 11 − SL 8 + 1');
  assert.equal(row.returned, 20);
  assert.match(row.verdict.text, /SL 8 t, zasažen; cena se pak vrátila 20 t ve směru — SL o 4 t dál by obchod uhájil/);
});

test('verdikt: obchod se nerozjel – chyba je ve vstupu, ne v SL', () => {
  const [r] = norm([stop({ slTicks: 12, mfeTicks: 6 })]);
  assert.match(S.tradeRow(r).verdict.text, /MFE 6 t při SL 12 t — obchod se nikdy nerozjel, chyba je ve vstupu, ne v SL/);
  // dopočtené MFE tenhle závěr dělat nesmí
  const [d] = norm([stop({ slTicks: 12, mfeTicks: 6, ...derivedMfe })]);
  assert.doesNotMatch(S.tradeRow(d).verdict.text, /nikdy nerozjel/);
});

test('verdikt: stopnutý bez pohybu po stopce – nejde říct', () => {
  const [r] = norm([stop({ mfeTicks: 10, postExitAdverseTicks: null, postExitFavorableTicks: null })]);
  const row = S.tradeRow(r);
  assert.equal(row.widerBy, null);
  assert.match(row.verdict.text, /pohyb po stopce není zapsaný/);
});

test('verdikt: cíl byl blízko / prázdné zůstane prázdné, ne 0', () => {
  const close = S.tradeRow(norm([trade({ exitTicks: 28, postExitFavorableTicks: 22 })])[0]);
  assert.match(close.verdict.text, /TP 28 t, po výstupu pokračovalo dalších 22 t — cíl byl blízko/);
  assert.equal(close.leftOnTable, 22);
  const unseen = S.tradeRow(norm([trade({ postExitFavorableTicks: null, maeTicks: null })])[0]);
  assert.equal(unseen.leftOnTable, null);
  assert.equal(unseen.reserve, null);
  assert.equal(unseen.mae, null);
});

test('plán vs. skutečnost: plannedRMultiple vedle R se znaménkem', () => {
  const row = S.tradeRow(norm([stop({ plannedRMultiple: 2 })])[0]);
  assert.equal(row.plannedR, 2);
  assert.equal(row.actualR, -1);
});

// ---------------------------------------------------------------- 2.2 percentily

test('MAE vítězů: p50 / p75 / p90 / max nejbližším pořadím a SL pro p90', () => {
  const recs = norm([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(m => trade({ maeTicks: m })));
  const d = S.maeWinners(recs);
  assert.deepEqual([d.p50, d.p75, d.p90, d.max], [5, 8, 9, 10]);
  assert.equal(d.slForP90, 10, 'přežití = MAE < SL');
  assert.equal(S.maeWinners(norm([stop()])).n, 0, 'jen ziskové obchody');
});

// ---------------------------------------------------------------- 2.3 MFE stopnutých

test('MFE stopnutých: kolik by stihlo TP v ticích i v R', () => {
  const recs = norm([stop({ mfeTicks: 4, slTicks: 8 }), stop({ mfeTicks: 8, slTicks: 8 }), stop({ mfeTicks: 16, slTicks: 8 })]);
  const d = S.mfeStopped(recs);
  assert.equal(d.byTicks.find(x => x.tp === 8).reach, 2);
  assert.equal(d.byR.find(x => x.r === 1).reach, 2);
  assert.equal(d.byR.find(x => x.r === 2).reach, 1);
});

// ---------------------------------------------------------------- 2.4 SL sweep

test('SL sweep: obchod přežije, když protipohyb < S', () => {
  const recs = norm([trade({ maeTicks: 5 }), trade({ maeTicks: 9 })]);
  const row = S.slSweep(recs).rows.find(x => x.S === 8);
  assert.equal(row.stopped, 1);
  assert.equal(row.survived, 1);
  assert.equal(S.slSweep(recs).rows.find(x => x.S === 6).stopped, 1, 'MAE 5 < 6 přežije');
});

test('SL sweep: přežití stopnutého bez pozorování po stopce je nad pozorovaným rozsahem', () => {
  const unseen = stop({ slTicks: 8, exitTicks: -8, maeTicks: 8, ...derivedMae, postExitAdverseTicks: null });
  const seen = stop({ slTicks: 8, exitTicks: -8, maeTicks: 8, ...derivedMae, postExitAdverseTicks: 2 });
  const sweep = S.slSweep(norm([unseen, seen]));
  const at12 = sweep.rows.find(x => x.S === 12);
  assert.equal(at12.rescued, 2, 'oba by při 12 t „přežily"');
  assert.equal(at12.aboveObserved, 1);
  assert.equal(at12.aboveItems[0].id, unseen.id);
  assert.equal(at12.inWindow, 1);
  const at8 = sweep.rows.find(x => x.S === 8);
  assert.equal(at8.aboveObserved, 0, 'na vlastní SL je stopka fakt');
  assert.equal(at8.stopped, 2);
});

test('SL sweep: zachráněný stopnutý obchod došel na cíl jen podle naměřeného maxima', () => {
  const r = stop({ slTicks: 8, exitTicks: -8, mfeTicks: 2, maeTicks: 8, postExitAdverseTicks: 2, postExitFavorableTicks: 30 });
  const row = S.slSweep(norm([r]), { targetR: 1 }).rows.find(x => x.S === 12);
  assert.equal(row.rescued, 1);
  assert.equal(row.rescuedToTarget, 1, 'max ve směru −8 + 30 = 22 ≥ 12');
  assert.equal(S.slSweep(norm([r]), { targetR: 2 }).rows.find(x => x.S === 12).rescuedToTarget, 0);
});

test('SL sweep: varování o vzorku pod 50', () => {
  assert.equal(S.slSweep(norm(many(49, trade))).sampleWarning, true);
  assert.equal(S.slSweep(norm(many(50, trade))).sampleWarning, false);
});

// ---------------------------------------------------------------- 2.5 mřížka

test('mřížka: SL má přednost, pak TP, jinak skutečný výsledek', () => {
  const [r] = norm([trade({ maeTicks: 6, postExitAdverseTicks: null, mfeTicks: 25, postExitFavorableTicks: 6, exitTicks: 24 })]);
  // maxAdverse 6, maxFavorable 30
  assert.deepEqual(S.gridOutcome(r, 6, 1), { kind: 'stop', ticks: -6 });
  assert.deepEqual(S.gridOutcome(r, 8, 2), { kind: 'target', ticks: 16 });
  assert.deepEqual(S.gridOutcome(r, 8, 4), { kind: 'actual', ticks: 24 });
});

test('mřížka: vyznačí stabilní oblast a pozná osamělý vrchol', () => {
  const g = S.grid(norm(many(10, () => trade())));
  assert.equal(g.n, 10);
  assert.ok(g.best);
  const stable = g.cells.flat().filter(c => c.stable);
  assert.ok(stable.length >= 4 && stable.length <= 9);
  assert.equal(g.cells.flat().filter(c => c.peak).length, 1);
  assert.equal(typeof g.isolatedPeak, 'boolean');
  assert.equal(g.sampleWarning, true);
});

test('mřížka: počet obchodů nad pozorovaným rozsahem pro každé SL', () => {
  const g = S.grid(norm([stop({ slTicks: 8, exitTicks: -8, mfeTicks: 3, maeTicks: 8, postExitAdverseTicks: null }), trade()]));
  assert.equal(g.aboveObserved[g.slList.indexOf(10)], 1);
  assert.equal(g.aboveObserved[g.slList.indexOf(8)], 0);
});
