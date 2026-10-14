'use strict';
// Obrazovka Souhrn a podrobnosti o úroveň níž (docs/ZADANI_LAB_SOUHRN.md §2–3).
// Souhrn NIC NEPOČÍTÁ: bere výsledky, které počítají obrazovky v Podrobnostech,
// a každá obrazovka nahoře ukazuje tutéž kartu (stejná čísla a věta).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../app/health.js');
const O = require('../app/overview.js');
const V = require('../app/views.js');
const CX = require('../app/context.js');
const SM = require('../app/summary.js');
const { trade, stop, normAll, many } = require('./helpers/records.js');

globalThis.window = globalThis;
require('../app/labels.js');
require('../app/ui-common.js');
require('../app/ui-summary.js');
require('../app/ui-health.js');
require('../app/ui-sltp.js');
require('../app/ui-levels.js');
require('../app/ui-context.js');
require('../app/ui-risk.js');

function ctxOf(raws, views = {}, dayNotes = {}) {
  const records = normAll(raws, dayNotes);
  const options = H.includeOf(views);
  return { records, perf: H.partition(records, options).perf, health: H.computeHealth(records, options), views, options };
}
// HTML jedné karty podle data-card (karta je vždy jeden <div> bez vnořených data-card).
function cardHtml(html, key) {
  const start = html.indexOf(`data-card="${key}"`);
  assert.ok(start >= 0, `karta ${key} chybí`);
  const open = html.lastIndexOf('<div', start);
  const end = html.indexOf('<!--/card-->', start);
  assert.ok(end > start, `karta ${key} nemá konec`);
  return html.slice(open, end);
}
const FORBIDDEN = /doporuč|nastav si|optimáln|vyhýbej/i;

// Obchod s hladinou 4 t nad vstupem (helper: ES long, MFE 25 → hladina dotčena).
function withLevel(make = trade, over = {}) {
  const raw = make(over);
  delete raw.nearLevelsNone;
  raw.nearLevels = [{ level: 'VAL', price: Number(raw.entryPrice) + 1 }];
  return raw;
}
const against = () => stop({ side: 'short', slPrice: 9000, targetLevel1: { type: 'VAL', price: 7000 } });
// Fixtura, ve které běží všechny karty: 15 vítězů s hladinou (po trendu 30m),
// 12 stopnutých shortů proti trendu, v jednom dni.
const full = () => [...many(15, () => withLevel()), ...many(12, against)];

// ---------------------------------------------------------------- 1. stejná čísla jako Podrobnosti

test('1: každé číslo v Souhrnu je identické s číslem na obrazovce v Podrobnostech', () => {
  const ctx = ctxOf(full());
  const s = SM.computeSummary(ctx);
  const an = O.analyses(ctx);
  for (const key of ['sl', 'tp', 'levels', 'risk']) assert.notEqual(s.cards[key].state, 'na', key + ' má běžet');

  // Souhrn i obrazovky berou JEDEN objekt analýz pro daný render.
  assert.equal(O.analyses(ctx), an);
  assert.equal(s.cards.sl.big, an.sltp.maeWinners.p90);
  assert.deepEqual(s.cards.sl.slMode, an.sltp.slMode.values);
  assert.equal(s.cards.tp.big, an.sltp.tpAfter.p50);
  assert.equal(s.cards.levels.big, an.strength.touched);
  assert.equal(s.cards.risk.big, an.seq.runs.z);

  // Karta na obrazovce v Podrobnostech je tatáž (stejné HTML = stejná čísla i věta).
  const summary = window.LabScreens.summary.render(ctx);
  const screens = { sl: 'sltp', tp: 'sltp', levels: 'levels', risk: 'risk' };
  for (const [key, screen] of Object.entries(screens)) {
    assert.equal(cardHtml(window.LabScreens[screen].render(ctx), key), cardHtml(summary, key), key);
  }
  // Číslo karty je i v sekcích obrazovky.
  assert.match(window.LabScreens.sltp.render(ctx), new RegExp(`p90 ${an.sltp.maeWinners.p90} t`));
  assert.match(window.LabScreens.levels.render(ctx), new RegExp(`${an.strength.touched} dotčených`));

  // Kontext: řádky největších rozdílů jsou na obrazovce Kontext stejné.
  assert.ok(s.context.rows.length >= 1);
  assert.equal(cardHtml(window.LabScreens.context.render(ctx), 'context'), cardHtml(summary, 'context'));
  const trend = s.context.rows.find(r => r.key === 'trendHtfAlign');
  const dim = an.context.dimensions.find(d => d.key === 'trendHtfAlign');
  const triple = list => list.map(g => [g.label, g.expectancyR, g.n]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(triple(trend.groups), triple(dim.compared.slice(0, 2)), 'dvě největší skupiny – tytéž, na kterých stojí práh');
  // V pořadí dimenze (po trendu před proti), ne podle výsledku.
  assert.deepEqual(trend.groups.map(g => g.key), ['WITH', 'AGAINST']);

  // Výsledek: tatáž mechanika jako řádky Kontextu (CX.rowStats), ukázaná i nahoře na Kontextu.
  const rs = CX.rowStats(ctx.perf);
  assert.deepEqual([s.result.n, s.result.winRate, s.result.expectancyR], [rs.n, rs.winRate, rs.expectancyR]);
  assert.equal(cardHtml(window.LabScreens.context.render(ctx), 'result'), cardHtml(summary, 'result'));
  // Equity v R: kumulativní R rozhodnutých obchodů, konec = expectancy × N.
  assert.ok(Math.abs(s.result.equityEnd - rs.expectancyR * rs.expectancyN) < 1e-9);
  assert.equal(s.result.equity.length, rs.expectancyN);

  // Data: úplnost a nejužší hrdlo jsou ze Zdraví dat.
  const c = ctx.health.completeness;
  assert.equal(s.data.completePct, (c.total - c.incomplete) / c.total);
  assert.equal(s.data.bottleneck.field, O.computeOverview(ctx).fill[0].field);
  assert.equal(cardHtml(window.LabScreens.health.render(ctx), 'data'), cardHtml(summary, 'data'));
});

// ---------------------------------------------------------------- 2. pod prahem / bez vstupu

test('2: karta pod prahem začíná „Předběžně", bez vstupu ukáže „–" a co chybí; nikdy tabulku', () => {
  const weak = SM.computeSummary(ctxOf(full()));
  for (const key of ['sl', 'tp', 'levels']) {
    assert.equal(weak.cards[key].state, 'weak', key);
    assert.match(weak.cards[key].text, /^Předběžně: /, key);
  }
  const empty = ctxOf([]);
  const s = SM.computeSummary(empty);
  const html = window.LabScreens.summary.render(empty);
  for (const key of ['sl', 'tp', 'levels', 'risk']) {
    const card = cardHtml(html, key);
    assert.equal(s.cards[key].state, 'na', key);
    assert.match(card, /class="[^"]*sum-card[^"]*is-na/, key + ' zešedlá');
    assert.match(card, /<div class="sum-big">–<\/div>/, key + ' místo čísla –');
    assert.match(card, /Zatím nejde — chybí [^<]*\d/, key + ' co chybí');
    assert.match(card, /data-goto="health" data-anchor="fill"/, key + ' odkaz na Data');
  }
  assert.match(cardHtml(html, 'context'), /Kontext zatím nemá vzorek — chybí /);
  // Rozložení se nehýbe: všechny karty jsou na svém místě i bez dat, žádná tabulka.
  for (const key of ['result', 'sl', 'tp', 'levels', 'risk', 'context', 'data']) cardHtml(html, key);
  for (const ctx of [empty, ctxOf(full())]) assert.doesNotMatch(window.LabScreens.summary.render(ctx), /<table/);
});

// ---------------------------------------------------------------- 3. největší rozdíly

test('3: největší rozdíly berou jen dimenze nad prahem, řadí podle rozdílu expectancy; unknown nevstupuje', () => {
  const ctx = ctxOf([
    ...many(12, () => trade({ absLocation: 'EXTREME' })), ...many(12, () => against()),
    ...many(10, () => trade({ trendHtf: 'DOWN', side: 'long', absLocation: 'NONE' })),
    // Nevyplněné ve všech dimenzích, které tu běží (trend 30m, trend, absorpce).
    ...many(30, () => trade({ trendHtf: '', trend: '', absLocation: '' }))
  ]);
  const s = SM.computeSummary(ctx);
  const dims = O.analyses(ctx).context.dimensions;
  for (const r of s.context.rows) assert.notEqual(dims.find(d => d.key === r.key).state, 'na', r.key);
  assert.ok(s.context.rows.length <= 3);
  const diffs = s.context.rows.map(r => r.diff);
  assert.deepEqual(diffs, [...diffs].sort((a, b) => b - a));
  for (const r of s.context.rows) {
    assert.equal(r.groups.length, 2);
    assert.ok(Math.abs(r.diff - Math.abs(r.groups[0].expectancyR - r.groups[1].expectancyR)) < 1e-9);
    assert.equal(r.groups.some(g => g.kind === 'aside'), false);
  }
  // 30 nevyplněných nezmění nic.
  const without = SM.computeSummary(ctxOf([
    ...many(12, () => trade({ absLocation: 'EXTREME' })), ...many(12, () => against()),
    ...many(10, () => trade({ trendHtf: 'DOWN', side: 'long', absLocation: 'NONE' }))
  ]));
  const strip = rows => rows.filter(r => r.key !== 'tradeNoInDay' && r.key !== 'prevResultInDay').map(r => [r.key, r.diff, r.groups.map(g => [g.key, g.n])]);
  assert.deepEqual(strip(s.context.rows), strip(without.context.rows));
  // Pod prahem žádný řádek a věta, co chybí.
  const none = SM.computeSummary(ctxOf(many(5, () => trade())));
  assert.deepEqual(none.context.rows, []);
  assert.match(none.context.missing, /\d/);
});

// ---------------------------------------------------------------- 4. žádné doporučení

test('4: žádný text v Souhrnu ani v Podrobnostech neobsahuje doporučení', () => {
  const days = d => `2026-08-${String(d).padStart(2, '0')}`;
  const big = [];
  for (let d = 1; d <= 25; d++) big.push(withLevel(trade, { date: days(d), entryTime: '15:00' }), stop({ date: days(d), entryTime: '15:10' }), against());
  const fixtures = [[[], {}], [[trade(), stop()], {}], [full(), {}], [big, {}], [big, { riskConsecutiveSL: 2, levelBin: 2 }]];
  for (const [raws, views] of fixtures) {
    const ctx = ctxOf(raws, views);
    const s = SM.computeSummary(ctx);
    const texts = JSON.stringify(s);
    assert.equal(FORBIDDEN.test(texts), false, texts.match(FORBIDDEN));
    for (const screen of ['summary', 'sltp', 'levels', 'context', 'risk', 'health']) {
      const html = window.LabScreens[screen].render(ctx);
      assert.equal(FORBIDDEN.test(html), false, `${screen}: ${html.match(FORBIDDEN)}`);
      assert.doesNotMatch(html, /undefined|NaN|\[object/, screen);
    }
  }
});

// ---------------------------------------------------------------- 5. navigace se pamatuje

test('5: sbalení skupiny Podrobnosti se pamatuje (views.json) a přežije změnu deníku', () => {
  const saved = V.sanitizeViews({ journalId: 'a', instrument: 'ES', navDetailsClosed: true, levelBin: 2 });
  assert.equal(saved.navDetailsClosed, true);
  assert.equal(saved.levelBin, 2);
  const changed = V.sanitizeViews({ ...V.forJournalChange(saved), journalId: 'b' });
  assert.equal(changed.navDetailsClosed, true);
  assert.equal(changed.levelBin, 2);
  assert.equal(changed.instrument, undefined);
  // Výchozí stav = rozbaleno (nic se neukládá); sloučení jen po 1 / 2 / 4 t.
  assert.equal(V.sanitizeViews({}).navDetailsClosed, undefined);
  assert.equal(V.sanitizeViews({ levelBin: 3 }).levelBin, undefined);
  assert.equal(V.sanitizeViews({ levelTolerance: 2 }).levelTolerance, undefined, 'tolerance hladin v3 zmizela');
});

test('navigace: Souhrn, Podrobnosti (SL a TP, Hladiny, Kontext, Denní risk), Data; „Co teď vím" zaniká', () => {
  assert.deepEqual(SM.NAV, [
    { screen: 'summary' },
    { group: 'details', label: 'Podrobnosti', screens: ['sltp', 'levels', 'context', 'risk'] },
    { group: 'data', label: 'Data', screens: ['health'] }
  ]);
  assert.equal(SM.START_SCREEN, 'summary');
  assert.equal(window.LabScreens.overview, undefined);
  assert.equal(window.LabScreens.summary.title, 'Souhrn');
  assert.equal(window.LabScreens.levels.title, 'Hladiny');
  assert.equal(window.LabScreens.health.title, 'Zdraví dat a co vyplnit');
  // Obrazovka Data začíná bloky „Co vyplnit" a „Kdy to bude".
  const html = window.LabScreens.health.render(ctxOf([trade(), stop()]));
  const fill = html.indexOf('id="fill"'), eta = html.indexOf('Kdy to bude'), first = html.indexOf('class="card section');
  assert.ok(fill >= 0 && eta > fill && first > eta, 'Co vyplnit → Kdy to bude → sekce');
});
