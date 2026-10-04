'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SQ = require('../app/sequence.js');
const { trade, stop, setup, norm } = require('./helpers/records.js');

// 'W' / 'L' řetězec → pole boolů pro runs test a permutace.
const bools = s => [...s.replace(/\s/g, '')].map(c => c === 'W');

// Den obchodů ze řetězce 'W' / 'L' / 'B' (breakeven), časy po 10 minutách.
function day(date, s, over = {}) {
  return [...s.replace(/\s/g, '')].map((c, i) => {
    const entryTime = `${String(15 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`;
    const base = { date, entryTime, ...over };
    if (c === 'W') return trade(base);
    if (c === 'L') return stop(base);
    return trade({ result: 'breakeven', exitTicks: 1, rMultiple: 0.08, ...base });
  });
}
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('runs test: známé sekvence vrátí známé z (záporné = shlukování)', () => {
  // 5 W + 5 L ve dvou blocích: R = 2, μ = 6, σ² = 50·40/(100·9)
  const clustered = SQ.runsTest(bools('WWWWWLLLLL'));
  assert.equal(clustered.runs, 2);
  close(clustered.expected, 6);
  close(clustered.z, -2.6833);
  const alternating = SQ.runsTest(bools('WLWLWLWLWL'));
  assert.equal(alternating.runs, 10);
  close(alternating.z, 2.6833);
  // nesymetrické: n₁ = 3, n₂ = 7, R = 6, μ = 5,2, σ² = 42·32/(100·9)
  const uneven = SQ.runsTest(bools('WLLWLLLWLL'));
  assert.equal(uneven.wins, 3);
  assert.equal(uneven.runs, 6);
  close(uneven.expected, 5.2);
  close(uneven.z, 0.6547);
});

test('runs test: pod 10 zisky nebo ztrátami není platný, z se jen ukáže', () => {
  const small = SQ.runsTest(bools('WWWWWLLLLL'));
  assert.equal(small.valid, false);
  assert.match(small.reason, /aspoň 10/);
  const ok = SQ.runsTest(bools('W'.repeat(10) + 'L'.repeat(10)));
  assert.equal(ok.valid, true);
  close(ok.z, -4.1352);
  const oneSided = SQ.runsTest(bools('WWWW'));
  assert.equal(oneSided.z, null);
});

test('sekvence: breakeven a jiné výsledky nejsou ztráta – vypadnou a spočítají se', () => {
  const recs = norm([...day('2026-08-03', 'WBL'), trade({ date: '2026-08-03', entryTime: '17:00', result: 'manual' })]);
  const b = SQ.sequenceBase(recs);
  assert.deepEqual(b.items.map(x => x.win), [true, false]);
  assert.equal(b.excluded.breakeven, 1);
  assert.equal(b.excluded.other, 1);
  assert.equal(b.trades, 4);
});

test('sekvence: legacy ano, „naživo bych nevzal" jen s přepínačem, SETUP_ONLY nikdy', () => {
  const recs = norm([
    trade({ date: '2026-08-03', entryTime: '15:00', legacyPointsConvention: true }),
    stop({ date: '2026-08-03', entryTime: '15:10', wouldSkipLive: true, wouldSkipReason: 'SR_IN_WAY' }),
    trade({ date: '2026-08-03', entryTime: '15:20' }),
    setup({ date: '2026-08-03', entryTime: '15:30' })
  ]);
  const def = SQ.sequenceBase(recs);
  assert.deepEqual(def.items.map(x => x.record.id), [recs[0].id, recs[2].id]);
  assert.equal(def.legacy, 1);
  assert.equal(def.trades, 2);
  assert.equal(def.excluded.other, 0);
  const withSkip = SQ.sequenceBase(recs, { includeSkipLive: true });
  assert.deepEqual(withSkip.items.map(x => x.record.id), [recs[0].id, recs[1].id, recs[2].id]);
  assert.equal(withSkip.skipLive, 1);
});

test('sekvence: hypotetické výsledky (no fill / vynechané) ve výchozím stavu mimo', () => {
  const recs = norm([
    trade({ date: '2026-08-03', entryTime: '15:00' }),
    stop({ date: '2026-08-03', entryTime: '15:10', fillStatus: 'NO_FILL' }),
    trade({ date: '2026-08-03', entryTime: '15:20', fillStatus: 'SKIPPED' }),
    stop({ date: '2026-08-03', entryTime: '15:30', fillStatus: 'MISSED' })
  ]);
  const def = SQ.sequenceBase(recs);
  assert.deepEqual(def.items.map(x => x.record.id), [recs[0].id]);
  assert.equal(def.hypothetical, 0);
  assert.deepEqual(def.ordered.map(r => r.id), [recs[0].id], 'simulátor jede nad stejnou množinou');
  const withNoFill = SQ.sequenceBase(recs, { includeNoFill: true });
  assert.deepEqual(withNoFill.items.map(x => x.record.id), [recs[0].id, recs[1].id, recs[3].id]);
  assert.equal(withNoFill.hypothetical, 2);
  assert.equal(SQ.sequenceBase(recs, { includeSkipLive: true }).items.length, 1);
});

test('sekvence: řazení podle data a času vstupu, ne podle pořadí v exportu', () => {
  const recs = norm([
    stop({ date: '2026-08-04', entryTime: '15:00', id: 'c' }),
    trade({ date: '2026-08-03', entryTime: '16:30', id: 'b' }),
    trade({ date: '2026-08-03', entryTime: '9:45', id: 'a' })
  ]);
  const b = SQ.sequenceBase(recs);
  assert.deepEqual(b.items.map(x => x.record.id), ['a', 'b', 'c']);
  assert.equal(b.days, 2);
});

test('permutace: deterministická se seedem; série délky 1 je vždy ≥ (p = 1)', () => {
  const seq = bools('WWLWLLLWWWLLWLWLLLLW');
  const a = SQ.permutationTest(seq, { iterations: 500, seed: 7 });
  const b = SQ.permutationTest(seq, { iterations: 500, seed: 7 });
  assert.deepEqual(a, b);
  const alt = SQ.permutationTest(bools('WLWLWLWLWLWL'), { iterations: 200 });
  assert.equal(alt.observed, 1);
  assert.equal(alt.atLeast, 200);
  assert.equal(alt.p, 1);
});

test('permutace: blok 10 ztrát za sebou náhoda skoro nikdy nevyrobí', () => {
  const res = SQ.permutationTest(bools('W'.repeat(10) + 'L'.repeat(10)), { iterations: 2000 });
  assert.equal(res.observed, 10);
  assert.ok(res.p < 0.01, `p = ${res.p}`);
});

test('podmíněný win rate: série se na začátku dne nuluje', () => {
  // 3. 8. končí L L; 4. 8. začíná L W – to W je „po 1 ztrátě", NE po 2 ani po 3
  // (přes noc by série vyšla 3)
  const recs = norm([...day('2026-08-03', 'LL'), ...day('2026-08-04', 'LWLLW')]);
  const c = SQ.conditionalWinRate(SQ.sequenceBase(recs).items);
  const [after1, after2, after3] = c.afterLosses;
  assert.deepEqual([after1.n, after1.wins], [4, 2]);   // 3. 8.: L po L; 4. 8.: W po L, L po L, W po LL
  assert.deepEqual([after2.n, after2.wins], [1, 1]);   // jen poslední W
  assert.equal(after3.n, 0);
  assert.equal(c.firstOfDay.n, 2);
  assert.equal(c.firstOfDay.wins, 0);
});

test('podmíněný win rate: „po k ztrátách" = posledních k obchodů dne; pod 3 bez procent', () => {
  const recs = norm(day('2026-08-03', 'LLLW WWL'));
  const c = SQ.conditionalWinRate(SQ.sequenceBase(recs).items);
  const [l1, l2, l3] = c.afterLosses;
  assert.deepEqual([l1.n, l1.wins], [3, 1]);   // po L: L, L, W
  assert.deepEqual([l2.n, l2.wins], [2, 1]);   // po LL: L, W
  assert.deepEqual([l3.n, l3.wins], [1, 1]);   // po LLL: W
  close(l1.rate, 1 / 3);
  assert.equal(l2.rate, null);
  const [w1, w2, w3] = c.afterWins;
  assert.deepEqual([w1.n, w1.wins], [3, 2]);   // po W: W, W, L
  assert.deepEqual([w2.n, w2.wins], [2, 1]);   // po WW: W, L
  assert.deepEqual([w3.n, w3.wins], [1, 0]);   // po WWW: L
  assert.deepEqual([c.overall.n, c.overall.wins], [7, 3]);
});

test('verdikt: náhodné / shlukování / střídání podle |z| ≥ 1,96', () => {
  const v = s => SQ.verdictOf(SQ.runsTest(bools(s)));
  const clustered = v('W'.repeat(10) + 'L'.repeat(10));
  assert.equal(clustered.kind, 'clustered');
  assert.match(clustered.text, /shlukují víc, než odpovídá náhodě \(z = −4,14\)/);
  assert.equal(v('WL'.repeat(10)).kind, 'alternating');
  // 10 W + 10 L v 11 sériích: z = 0
  const random = v('WWWWW LL W LL W LL W LL W LL W');
  assert.equal(random.kind, 'random');
  assert.match(random.text, /v mezích náhody \(z = 0,00\)/);
  assert.doesNotMatch(random.text, /náznak/);
  // 8 sérií: z ≈ −1,38 → náhodné s náznakem
  const hint = v('WWWWWWW LLLLLLL W L W L W L');
  assert.equal(hint.kind, 'random');
  assert.match(hint.text, /z = −1,38\).*Mírný náznak shlukování, na 20 obchodech neprůkazný/);
});

test('verdikt: malý vzorek žádný verdikt nedá, ani při velkém |z|', () => {
  const res = SQ.verdictOf(SQ.runsTest(bools('WWWWWLLLLL')));   // z = −2,68, ale 5 / 5
  assert.equal(res.kind, 'insufficient');
  assert.doesNotMatch(res.text, /shlukují/);
});

test('computeSequence: složí sekvenci přes dny, legacy se počítá a hlásí', () => {
  const recs = norm([
    ...day('2026-08-03', 'WWWWW', { legacyPointsConvention: true }),
    ...day('2026-08-04', 'WWWWWB'),
    ...day('2026-08-05', 'LLLLL LLLLL')
  ]);
  const res = SQ.computeSequence(recs, { iterations: 300 });
  assert.equal(res.n, 20);
  assert.equal(res.base.days, 3);
  assert.equal(res.base.legacy, 5);
  assert.equal(res.base.excluded.breakeven, 1);
  assert.equal(res.runs.runs, 2);
  assert.equal(res.verdict.kind, 'clustered');
  assert.equal(res.longestLoss, 10);
  assert.equal(res.longestWin, 10);
  assert.equal(res.permutation.iterations, 300);
});
