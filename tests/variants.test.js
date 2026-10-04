'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../app/variants.js');
const D = require('../app/daysim.js');
const { trade, norm } = require('./helpers/records.js');

const UNIT = 100;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

function day(date, spec) {
  return spec.trim().split(/\s+/).map((tok, i) => {
    const kind = tok[0], r = Number(tok.slice(1) || 1);
    const result = kind === 'W' ? 'target' : kind === 'L' ? 'stoploss' : 'breakeven';
    const entryTime = `${String(15 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`;
    return trade({ date, entryTime, result, pnlRaw: (kind === 'W' ? r : -r) * UNIT, exitTicks: kind === 'W' ? 10 : -10 });
  });
}
// n dnů od 1. 8. 2026, spec(i) → zápis dne
function days(n, spec) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    out.push(...day(d, spec(i)));
  }
  return out;
}
// Výsledky dnů jen s tím, co LOO a časové rozdělení čtou.
const fakeDays = diffs => diffs.map((diffR, i) => ({ date: `d${i + 1}`, diffR, ruleR: diffR, actualR: 0, trades: [{ r: diffR, taken: true }] }));

test('leave-one-day-out vynechává DEN, ne obchod', () => {
  // 3 dny po 3–4 obchodech; consecutiveSL 2 změní 3. 8. o −5 a 4. 8. o +2
  const sim = D.simulate(norm([...day('2026-08-03', 'L1 L1 W5'), ...day('2026-08-04', 'L1 L1 L2'), ...day('2026-08-05', 'W1 L1 W1 W1')]), { consecutiveSL: 2 }, { unitUSD: UNIT });
  const loo = V.leaveOneDayOut(sim.days);
  assert.equal(loo.rows.length, 3);   // dnů, ne 10 obchodů
  assert.deepEqual(loo.rows.map(r => r.date), ['2026-08-03', '2026-08-04', '2026-08-05']);
  close(loo.rows[0].netR, 2);         // bez 3. 8. zbude jen +2
  close(loo.rows[1].netR, -5);
  close(loo.rows[2].netR, -3);
  close(loo.min, -5);
  close(loo.max, 2);
  // drawdown bez dne se přepočítá z obchodů zbylých dnů
  close(loo.rows[0].maxDrawdownR, D.summary(sim.days.slice(1), 'rule').maxDrawdownR);
});

test('leave-one-day-out: neprojde, když po vynechání jednoho dne znaménko padne nebo se změní', () => {
  assert.equal(V.leaveOneDayOut(fakeDays([1, 1, 1, -0.5])).pass, true);
  const flip = V.leaveOneDayOut(fakeDays([4, -1, -1, -1]));   // celkem +1, bez prvního dne −3
  assert.equal(flip.pass, false);
  assert.deepEqual(flip.breakingDates, ['d1']);
  const oneDay = V.leaveOneDayOut(fakeDays([2, 0, 0, 0]));    // stojí na jednom dni → bez něj 0
  assert.equal(oneDay.pass, false);
  assert.equal(V.leaveOneDayOut(fakeDays([0, 0, 0])).pass, null);   // nic nezměnilo
});

test('časové rozdělení: první polovina dnů vs. druhá, drží jen se stejným znaménkem', () => {
  const s = V.timeSplit(fakeDays([1, 1, -1, -1, -1]));
  assert.equal(s.first.days, 2);
  assert.equal(s.second.days, 3);
  close(s.first.netR, 2);
  close(s.second.netR, -3);
  assert.equal(s.holds, false);
  assert.equal(V.timeSplit(fakeDays([1, 0.5, 2, 1])).holds, true);
  assert.equal(V.timeSplit(fakeDays([0, 0, 1, 1])).holds, null);
});

test('stabilní oblast: aspoň 3 sousední varianty, které projdou LOO, se stejným znaménkem', () => {
  const fam = rows => V.markFamily(rows.map(([netR, looPass]) => ({ netR, looPass })), true);
  const up = fam([[1, true], [2, true], [1.5, true], [-1, true]]);
  assert.deepEqual(up.map(v => v.stable), ['up', 'up', 'up', null]);
  const two = fam([[1, true], [2, true], [-1, true]]);
  assert.deepEqual(two.map(v => v.stable), [null, null, null]);
  const down = fam([[-1, true], [-2, true], [-3, true]]);
  assert.deepEqual(down.map(v => v.stable), ['down', 'down', 'down']);
  const broken = fam([[1, true], [2, false], [1.5, true], [1, true]]);   // LOO neprošla → oblast přeruší
  assert.deepEqual(broken.map(v => v.stable), [null, null, null, null]);
});

test('osamělá kladná varianta (sousedé nepřidávají) se označí jako šum', () => {
  const rows = V.markFamily([{ netR: -1, looPass: true }, { netR: 5, looPass: true }, { netR: 0, looPass: null }, { netR: 1, looPass: true }], true);
  // +5 mezi −1 a 0; +1 na kraji vedle 0 – obě osamělé. Záporné a nulové nikdy.
  assert.deepEqual(rows.map(v => v.isolated), [false, true, false, true]);
  const pair = V.markFamily([{ netR: 1, looPass: false }, { netR: 2, looPass: false }, { netR: -1, looPass: true }], true);
  assert.deepEqual(pair.map(v => v.isolated), [false, false, false]);   // kladný soused = není osamělá
  const edge = V.markFamily([{ netR: 3, looPass: true }, { netR: -1, looPass: true }], true);
  assert.equal(edge[0].isolated, true);
});

test('pod 20 dny se optimum nenabízí: žádná stabilní oblast, LOO ani časové rozdělení', () => {
  const res = V.computeVariants(norm(days(19, () => 'W1 L1 L1 W2 L1')), { unitUSD: UNIT });
  assert.equal(res.days, 19);
  assert.equal(res.enoughDays, false);
  assert.equal(res.missingDays, 1);
  for (const fam of res.families) for (const v of fam.variants) {
    assert.equal(v.loo, null);
    assert.equal(v.looPass, null);
    assert.equal(v.split, null);
    assert.equal(v.stable, null);
    assert.equal(v.isolated, false);
  }
  // značky se nedají ani ručně – bez dost dnů markFamily nic neoznačí
  assert.deepEqual(V.markFamily([{ netR: 1, looPass: true }, { netR: 1, looPass: true }, { netR: 1, looPass: true }], false).map(v => v.stable), [null, null, null]);
});

test('od 20 dnů: kontrolní varianta = skutečnost, varianty v pořadí parametru, bez vítěze', () => {
  const raws = days(22, i => (i % 3 === 0 ? 'L1 L1 W3 W1' : i % 3 === 1 ? 'W2 L1 L1 L1' : 'L1 W1 L1 W1'));
  const res = V.computeVariants(norm(raws), { unitUSD: UNIT });
  assert.equal(res.enoughDays, true);
  close(res.none.totalR * UNIT, raws.reduce((s, r) => s + r.pnlRaw, 0), 1e-6);
  assert.deepEqual(res.families.map(f => f.key), V.FAMILIES.map(f => f.key));
  for (const fam of res.families) {
    const def = V.FAMILIES.find(f => f.key === fam.key);
    assert.deepEqual(fam.variants.map(v => v.value), def.values);
    for (const v of fam.variants) {
      assert.equal(v.loo.rows.length, 22);
      assert.ok(v.split);
    }
  }
  for (const key of ['best', 'recommended', 'winner', 'optimum']) assert.equal(key in res, false);
});

test('náhodné vynechání stejného počtu obchodů: −(průměr R na obchod) × nevzaté', () => {
  // průměr = (−1 −1 +3 −2) / 4 = −0,25 R; „konec po 1. SL" nevezme 3 obchody denně
  const raws = days(20, () => 'L1 L1 W3 L2');
  const res = V.computeVariants(norm(raws), { unitUSD: UNIT });
  close(res.meanR, -1 / 4);
  const v = res.families.find(f => f.key === 'consecutiveSL').variants.find(x => x.value === 1);
  assert.equal(v.skippedTrades, 60);
  close(v.chanceR, 0.25 * 60);       // náhodné vynechání 60 obchodů by vyneslo +15 R
  close(v.netR, 0);                  // pravidlo denně ušetří 1 + 2 a zahodí 3
  close(v.beyondChanceR, -15);       // proti náhodě je pravidlo o 15 R horší
});
