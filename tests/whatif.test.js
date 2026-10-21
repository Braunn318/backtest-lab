'use strict';
// Co kdyby (docs/ZADANI_LAB_PRESTAVBA.md §3, testy §5.5–5.7).
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../app/whatif.js');
const D = require('../app/daysim.js');
const DG = require('../app/diagnosis.js');
const V = require('../app/views.js');
const { trade, stop, normAll } = require('./helpers/records.js');

const day = d => `2026-08-${String(d).padStart(2, '0')}`;
const r2 = v => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- 5. pravidla 1–3

test('pravidlo 1: MAE ≥ S → SL, i když MFE došlo na cíl (pořadí neznáme → horší)', () => {
  assert.equal(W.bracket({ mae: 10, mfe: 30, F: 30, A: 10 }, 10, 20), 'stop');
});

test('pravidlo 2: jinak MFE ≥ T → target', () => {
  assert.equal(W.bracket({ mae: 9, mfe: 20, F: 20, A: 9 }, 10, 20), 'target');
});

test('pravidlo 3: rozhoduje pohyb po výstupu, jinak nerozhodnuto', () => {
  const base = { mae: 4, mfe: 8 };
  assert.equal(W.bracket({ ...base, F: 25, A: 6 }, 10, 20), 'target', 'F ≥ T a A < S');
  assert.equal(W.bracket({ ...base, F: 12, A: 14 }, 10, 20), 'stop', 'A ≥ S a F < T');
  assert.equal(W.bracket({ ...base, F: 25, A: 14, adverseFirst: true }, 10, 20), 'stop', 'obojí, protipohyb dřív');
  assert.equal(W.bracket({ ...base, F: 12, A: 6 }, 10, 20), 'undecided', 'ani jedno');
  assert.equal(W.bracket({ ...base, F: 25, A: null }, 10, 20), 'undecided', 'bez protipohybu nejde říct, že SL nepadl');
  assert.equal(W.bracket({ ...base, F: null, A: 14 }, 10, 20), 'stop', 'protipohyb došel na SL, cíl neznámý → horší');
  assert.equal(W.bracket({ mae: null, mfe: 8, F: 25, A: 6 }, 10, 20), 'undecided', 'bez naměřeného MAE nic');
});

test('runner: TG1, pak k2 / BE / nerozhodnuto', () => {
  const tg1 = { mae: 4, mfe: 12, F: 30, A: 6 };
  assert.equal(W.runnerOutcome({ ...tg1, backToEntry: false }, 10, 2), 'target');
  assert.equal(W.runnerOutcome({ ...tg1, backToEntry: true, adverseFirst: true }, 10, 2), 'be');
  assert.equal(W.runnerOutcome({ ...tg1, backToEntry: true, adverseFirst: false }, 10, 2), 'target');
  assert.equal(W.runnerOutcome({ ...tg1, F: 15, backToEntry: true }, 10, 2), 'be');
  assert.equal(W.runnerOutcome({ ...tg1, F: 15, backToEntry: false }, 10, 2), 'undecided');
  assert.equal(W.runnerOutcome({ ...tg1, F: 30, backToEntry: null }, 10, 2), 'undecided');
});

test('nezměněný SL i cíl = přesně skutečnost (pnlRaw), nic se nepřepočítává', () => {
  const recs = normAll([trade({ pnlRaw: 26.2 }), stop({ pnlRaw: -33.8, mfeTicks: null })]);
  for (const r of recs) {
    const o = W.tradeOutcome(r, W.defaultConfig());
    assert.equal(o.kind, 'actual');
    assert.equal(o.pnl, r.pnlRaw);
  }
});

test('P/L v $ = kontrakty × ticky × hodnota ticku − komise; nerozhodnuté mimo P/L, nejhorší případ −1 R', () => {
  const mes = { instrument: 'MES', contracts: 2, commission: 3.8, slTicks: 10 };
  // Cíl 1:1 → MFE 12 ≥ 10, MAE 4 < 10 → target 10 t.
  const win = normAll([trade({ ...mes, mfeTicks: 12, maeTicks: 4 })])[0];
  const o = W.tradeOutcome(win, { ...W.defaultConfig(), target: { mode: 'r', k: 1 } });
  assert.equal(o.kind, 'target');
  assert.equal(r2(o.pnl), r2(2 * 10 * 1.25 - 3.8));
  assert.equal(o.r, 1);
  // Nerozhodnuté: MFE 6, po výstupu nic zapsaného.
  const open = normAll([trade({ ...mes, mfeTicks: 6, maeTicks: 4, exitTicks: 6, postExitFavorableTicks: null, postExitAdverseTicks: null })])[0];
  const u = W.tradeOutcome(open, { ...W.defaultConfig(), target: { mode: 'r', k: 1 } });
  assert.equal(u.kind, 'undecided');
  assert.equal(u.pnl, null);
  assert.equal(r2(u.worstPnl), r2(-2 * 10 * 1.25 - 3.8));
});

test('rozdělení: 1. kontrakt k1 × R, 2. kontrakt k2 × R nebo BE', () => {
  const mes = { instrument: 'MES', contracts: 2, commission: 3.8, slTicks: 10, exitTicks: 12, mfeTicks: 12, maeTicks: 3 };
  const cfg = { ...W.defaultConfig(), target: { mode: 'split', k1: 1, k2: 2 } };
  // Po výstupu +20 t (F = 32 ≥ 20), zpět na vstup ne → oba cíle.
  const full = normAll([trade({ ...mes, postExitFavorableTicks: 20, postExitAdverseTicks: 5 })])[0];
  const a = W.tradeOutcome(full, cfg);
  assert.equal(a.kind, 'target');
  assert.equal(r2(a.pnl), r2((10 + 20) * 1.25 - 3.8));
  assert.equal(a.r, 1.5);
  // Po výstupu jen +2 t a zpět přes vstup (protipohyb 15 ≥ 12) → runner na BE.
  const back = normAll([trade({ ...mes, postExitFavorableTicks: 2, postExitAdverseTicks: 15 })])[0];
  const b = W.tradeOutcome(back, cfg);
  assert.equal(b.kind, 'be');
  assert.equal(r2(b.pnl), r2(10 * 1.25 - 3.8));
});

test('změněný SL, cíl jak jsem ho měl: obchod, který SL nedotkl a neskončil na SL, zůstává jak byl', () => {
  const t = normAll([trade({ instrument: 'MES', contracts: 2, commission: 3.8, slTicks: 12, maeTicks: 3, pnlRaw: 26.2 })])[0];
  const wider = W.tradeOutcome(t, { ...W.defaultConfig(), sl: { mode: 'wider', ticks: 2 } });
  assert.equal(wider.kind, 'actual');
  assert.equal(wider.pnl, 26.2);
  const tight = W.tradeOutcome(t, { ...W.defaultConfig(), sl: { mode: 'fixed', ticks: 3 } });
  assert.equal(tight.kind, 'stop', 'MAE 3 ≥ pevný SL 3');
  assert.equal(r2(tight.pnl), r2(-2 * 3 * 1.25 - 3.8));
});

// ---------------------------------------------------------------- 6. pravidla dne přes LabDaySim

function dayFixture() {
  const raws = [];
  for (let d = 1; d <= 6; d++) {
    raws.push(stop({ date: day(d), entryTime: '15:00', pnlRaw: -30 }));
    raws.push(stop({ date: day(d), entryTime: '15:10', pnlRaw: -30 }));
    raws.push(trade({ date: day(d), entryTime: '15:20', pnlRaw: 45 }));
    raws.push(stop({ date: day(d), entryTime: '15:30', pnlRaw: -30 }));
  }
  return normAll(raws);
}

test('pravidla dne jdou přes LabDaySim – stejný výsledek jako simulátor na obrazovce Denní risk', () => {
  const recs = dayFixture();
  for (const rules of [{ maxTrades: 2 }, { consecutiveSL: 2 }, { dailySL: 1, afterTarget: 1 }]) {
    const wi = W.computeWhatIf(recs, { ...W.defaultConfig(), rules }, {});
    const sim = D.simulate(recs, rules, {});
    assert.equal(r2(wi.variant.pnl), r2(sim.rule.totalR * sim.unit.usd), JSON.stringify(rules));
    assert.equal(wi.variant.n, sim.rule.trades);
  }
  // Denní limit v $ se převede na R přes jednotku, kterou LabDaySim už má.
  const lim = W.computeWhatIf(recs, { ...W.defaultConfig(), rules: { dailyLossUSD: 60 } }, {});
  assert.equal(lim.variant.n, 12, 'den končí po druhé ztrátě −60 $');
  assert.equal(r2(lim.variant.pnl), -360);
});

test('konec po targetu je pravidlo LabDaySim (afterTarget)', () => {
  assert.ok(D.RULE_KEYS.includes('afterTarget'));
  const s = D.simulateDay([
    { record: { result: 'target' }, r: 1 },
    { record: { result: 'stoploss' }, r: -1 }
  ], D.cleanRules({ afterTarget: 1 }));
  assert.equal(s.ruleR, 1);
  assert.equal(s.reason, 'afterTarget');
});

test('bez varianty = skutečnost; rozdíl 0', () => {
  const recs = dayFixture();
  const wi = W.computeWhatIf(recs, W.defaultConfig(), {});
  assert.equal(r2(wi.variant.pnl), r2(wi.actual.pnl));
  assert.equal(wi.variant.diff, 0);
  assert.equal(wi.actual.n, 24);
});

// ---------------------------------------------------------------- 7. filtry B jen z polí před vstupem

test('filtry B nabízí jen pole známá před vstupem – emoce a technika z poznámek ne', () => {
  for (const key of W.FILTER_FIELDS) {
    const comp = DG.COMPARISONS.find(c => c.key === key);
    assert.ok(comp, key);
    assert.equal(comp.when, 'before', key + ' se zapisuje až po obchodu');
  }
  for (const key of ['emotion', 'technical', 'order', 'prev', 'slBefore', 'dayCount', 'giveBack']) {
    assert.equal(W.FILTER_FIELDS.includes(key), false, key);
  }
  assert.ok(DG.COMPARISONS.filter(c => c.when === 'after').some(c => c.key === 'emotion'));
});

test('filtr B vyřadí obchody ze skupiny, den jede dál bez nich', () => {
  const recs = normAll([
    trade({ date: day(1), entryTime: '15:00', setupCode: 'M2_TREND', pnlRaw: -30, result: 'stoploss', exitTicks: -12 }),
    trade({ date: day(1), entryTime: '15:10', setupCode: 'M2_OF', pnlRaw: 45 })
  ]);
  const wi = W.computeWhatIf(recs, { ...W.defaultConfig(), exclude: { setup: ['M2_TREND'] } }, {});
  assert.equal(wi.variant.n, 1);
  assert.equal(wi.variant.pnl, 45);
  assert.equal(wi.cut.filter.saved, 30);
  assert.equal(wi.filtersOn, true);
});

test('předvolby jen vyplní volby a dají se kombinovat', () => {
  let cfg = W.defaultConfig();
  cfg = W.applyPreset(cfg, 'max2');
  cfg = W.applyPreset(cfg, 'rr1');
  assert.equal(cfg.rules.maxTrades, 2);
  assert.deepEqual(cfg.target, { mode: 'r', k: 1 });
  cfg = W.applyPreset(cfg, 'onlyA');
  assert.ok(cfg.exclude.grade.includes('B') && !cfg.exclude.grade.includes('A'));
  // Volba přežije uložení do views.json.
  const saved = V.sanitizeViews({ whatif: { current: cfg, saved: [cfg, null] } });
  assert.deepEqual(saved.whatif.current, W.cleanConfig(cfg));
});

test('nad 20 % nerozhodnutých je stav varianty nejvýš ~ a věta to řekne', () => {
  const recs = normAll(Array.from({ length: 12 }, (_, i) => trade({
    date: day(i + 1), instrument: 'MES', contracts: 2, commission: 3.8, slTicks: 10, mfeTicks: 6, maeTicks: 4, exitTicks: 6,
    postExitFavorableTicks: null, postExitAdverseTicks: null, pnlRaw: 11.2
  })));
  const wi = W.computeWhatIf(recs, { ...W.defaultConfig(), target: { mode: 'r', k: 1 } }, {});
  assert.equal(wi.variant.undecided, 12);
  assert.notEqual(wi.state, 'ok');
  assert.match(wi.undecidedNote, /nerozhodnut/);
});
