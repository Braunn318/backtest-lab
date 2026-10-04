'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../app/daysim.js');
const { trade, norm } = require('./helpers/records.js');

const UNIT = 100;   // 1 R = 100 USD → pnlRaw 200 = +2 R
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Den ze zápisu 'W2 L1 B0.1 …' – výsledek a P/L v R (B = breakeven se ztrátou komise).
function day(date, spec, over = {}) {
  return spec.trim().split(/\s+/).map((tok, i) => {
    const kind = tok[0], r = Number(tok.slice(1) || 1);
    const result = kind === 'W' ? 'target' : kind === 'L' ? 'stoploss' : 'breakeven';
    const pnlRaw = (kind === 'W' ? r : -r) * UNIT;
    const entryTime = `${String(15 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`;
    return trade({ date, entryTime, result, pnlRaw, exitTicks: kind === 'W' ? 10 : -10, ...over });
  });
}
const sim = (raws, rules, opt = {}) => D.simulate(norm(raws), rules, { unitUSD: UNIT, ...opt });

test('simulátor utne den ve správném obchodě a zbytek spočítá jako nevzatý', () => {
  const res = sim(day('2026-08-03', 'W1 L1 L1 W2 W1'), { consecutiveSL: 2 });
  const d = res.days[0];
  assert.deepEqual(d.trades.map(t => t.taken), [true, true, true, false, false]);
  assert.equal(d.stopAfter, 2);
  assert.equal(d.reason, 'consecutiveSL');
  assert.equal(d.skipped, 2);
  close(d.ruleR, -1);
  close(d.actualR, 2);
  assert.equal(res.cutDays, 1);
  assert.equal(res.skippedTrades, 2);
});

test('vrácení zisku se měří od denního maxima, ne od nuly', () => {
  // +2, +2 (maximum +4), −1, −1 → +2 = vráceno 2 od maxima, pořád v plusu
  const res = sim(day('2026-08-03', 'W2 W2 L1 L1 W3'), { giveBack: 2 });
  assert.equal(res.days[0].stopAfter, 3);
  assert.equal(res.days[0].reason, 'giveBack');
  close(res.days[0].ruleR, 2);
  // maximum začíná na 0 (start dne): −1, −1 je vrácení 2
  const fromStart = sim(day('2026-08-03', 'L1 L1 W3'), { giveBack: 2 });
  assert.equal(fromStart.days[0].stopAfter, 1);
});

test('varianta „žádné pravidlo" dá přesně skutečné P/L deníku', () => {
  const raws = [...day('2026-08-03', 'W1.37 L1 B0.12 L0.8'), ...day('2026-08-04', 'L1 W2.5')];
  const res = sim(raws, {});
  assert.equal(res.active, false);
  close(res.none.totalR * UNIT, raws.reduce((s, r) => s + r.pnlRaw, 0), 1e-6);
  close(res.rule.totalR, res.none.totalR);
  assert.equal(res.cutDays, 0);
  for (const d of res.days) close(d.ruleR, d.actualR);
});

test('čistý přínos = ušetřené ztráty − zahozené zisky, ne jen ušetřené', () => {
  // po 1. obchodu konec: nevzato W3, L1, W0.5 → ušetřeno 1, zahozeno 3,5
  const res = sim(day('2026-08-03', 'L1 W3 L1 W0.5'), { maxTrades: 1 });
  close(res.savedR, 1);
  close(res.forgoneR, 3.5);
  close(res.netR, -2.5);
  close(res.netR, res.rule.totalR - res.none.totalR);
});

test('SL za sebou: jiný výsledek (i breakeven) řadu přeruší; SL za den počítá celkem', () => {
  const raws = day('2026-08-03', 'L1 B0.1 L1 W1');
  assert.equal(sim(raws, { consecutiveSL: 2 }).cutDays, 0);
  const daily = sim(raws, { dailySL: 2 });
  assert.equal(daily.days[0].stopAfter, 2);
  assert.equal(daily.days[0].reason, 'dailySL');
});

test('denní ztrátový limit, denní cíl a max obchodů', () => {
  const loss = sim(day('2026-08-03', 'L1 L1.5 W2 W1'), { dailyLoss: 2.5 });
  assert.equal(loss.days[0].stopAfter, 1);
  const target = sim(day('2026-08-03', 'W1 W1 L1 L1'), { dailyTarget: 2 });
  assert.equal(target.days[0].stopAfter, 1);
  assert.equal(target.days[0].reason, 'dailyTarget');
  const count = sim(day('2026-08-03', 'W1 L1 W1 L1'), { maxTrades: 3 });
  assert.equal(count.days[0].stopAfter, 2);
});

test('pravidla se kombinují – den končí u prvního, které zabere', () => {
  const raws = day('2026-08-03', 'L1 L1 L1 W2');
  const res = sim(raws, { dailyLoss: 3, consecutiveSL: 2 });
  assert.equal(res.days[0].stopAfter, 1);
  assert.equal(res.days[0].reason, 'consecutiveSL');
});

test('pravidlo zabrané na posledním obchodu dne den neutne', () => {
  const res = sim(day('2026-08-03', 'W1 L1 L1'), { consecutiveSL: 2 });
  assert.equal(res.days[0].cut, false);
  assert.equal(res.days[0].reason, null);
  assert.equal(res.cutDays, 0);
});

test('1 R = medián ztráty na SL (pnlRaw vč. komise); přepis má přednost', () => {
  const raws = norm([
    // medián 200, průměr by byl 400 – jedna velká ztráta jednotku nepřetáhne
    trade({ result: 'stoploss', pnlRaw: -150 }), trade({ result: 'stoploss', pnlRaw: -850 }),
    trade({ result: 'stoploss', pnlRaw: -200 }), trade({ result: 'target', pnlRaw: 900 })
  ]);
  const auto = D.unitOf(raws);
  assert.equal(auto.usd, 200);
  assert.equal(auto.n, 3);
  assert.equal(auto.overridden, false);
  const manual = D.unitOf(raws, 50);
  assert.equal(manual.usd, 50);
  assert.equal(manual.auto, 200);
  const res = D.simulate(raws, {});
  close(res.days[0].trades[3].r, 4.5);
});

test('legacy obchody se přehrají; obchod bez pnlRaw vypadne a spočítá se', () => {
  const raws = [...day('2026-08-03', 'W1 L1', { legacyPointsConvention: true }), trade({ date: '2026-08-03', entryTime: '18:00', pnlRaw: null })];
  const res = sim(raws, {});
  assert.equal(res.trades, 2);
  assert.equal(res.legacy, 2);
  assert.equal(res.missingPnl, 1);
});

test('max drawdown po obchodech přes celé období, ne po dnech', () => {
  // equity 3, 1, −1, 0 → drawdown 4 (po dnech by vyšlo jen 2)
  const res = sim([...day('2026-08-03', 'W3 L2'), ...day('2026-08-04', 'L2 W1')], {});
  close(res.none.maxDrawdownR, 4);
  close(res.none.worstDayR, -1);
  close(res.none.bestDayR, 1);
  assert.equal(res.none.profitableDays, 1);
  assert.equal(res.none.days, 2);
});

test('tvrdé limity: hardDailyLoss utne den, trailingDrawdown ukončí zbytek období', () => {
  const hard = sim(day('2026-08-03', 'L2 L1 W5'), { hardDailyLoss: 3 });
  assert.equal(hard.days[0].stopAfter, 1);
  assert.equal(hard.days[0].reason, 'hardDailyLoss');
  const trail = sim([...day('2026-08-03', 'W2 L1 L2 W1'), ...day('2026-08-04', 'W3 W3')], { trailingDrawdown: 3 });
  assert.equal(trail.days[0].stopAfter, 2);
  assert.equal(trail.days[0].reason, 'trailingDrawdown');
  assert.deepEqual(trail.days[1].trades.map(t => t.taken), [false, false]);
  assert.equal(trail.days[1].reason, 'trailingDrawdown');
  close(trail.forgoneR, 7);
});

test('závislost na pár dnech: čistý přínos bez dvou nejvíc změněných dnů', () => {
  const raws = [
    ...day('2026-08-03', 'L1 L1 W5'), ...day('2026-08-04', 'L1 L1 L2'),
    ...day('2026-08-05', 'L1 L1 W1'), ...day('2026-08-06', 'W1 W1')
  ];
  const res = sim(raws, { consecutiveSL: 2 });
  assert.deepEqual(res.topDays.map(d => d.date), ['2026-08-03', '2026-08-04']);
  close(res.netR, -5 + 2 - 1);
  close(res.netWithoutTopR, -1);
});

test('prázdné nebo nesmyslné hodnoty pravidla = pravidlo vypnuté', () => {
  const rules = D.cleanRules({ dailyLoss: '', consecutiveSL: 0, maxTrades: -2, dailyTarget: 'x', giveBack: '1,5' });
  assert.equal(D.hasAnyRule(rules), false);
  assert.equal(D.hasAnyRule(D.cleanRules({ maxTrades: '3' })), true);
});
