'use strict';
// Kontext na obrazovkách: Kontext, Hladiny, Zdraví dat a co vyplnit
// (docs/ZADANI_KONTEXT.md B2–B3, v3 B2–B3). Vykreslení běží v Node jako v overview.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const H = require('../app/health.js');
const O = require('../app/overview.js');
const V = require('../app/views.js');
const { trade, stop, normAll, many } = require('./helpers/records.js');

globalThis.window = globalThis;
require('../app/labels.js');
require('../app/context.js');
require('../app/summary.js');
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
function sectionHtml(html, id) {
  const start = html.indexOf(`data-section="${id}"`);
  assert.ok(start >= 0, `sekce ${id} chybí`);
  const open = html.lastIndexOf('<', start);
  const next = html.indexOf('class="card section', start);
  return html.slice(open, next < 0 ? html.length : html.lastIndexOf('<', next));
}
// Short proti trendu 30m (helper trade() je long s trendem UP).
const against = () => stop({ side: 'short', slPrice: 9000, targetLevel1: { type: 'VAL', price: 7000 } });
const FORBIDDEN = /doporuč|nastav si|optimáln|vyhýbej/i;

test('Co vyplnit: pole kontextu přibudou sama, kontext dne pod jednou položkou, vyplněné zmizí', () => {
  const fill = O.computeOverview(ctxOf([...many(12, () => trade()), ...many(12, against)])).fill;
  const abs = fill.find(x => x.keys.includes('ctx-absLocation'));
  assert.equal(abs.field, 'Absorpce – kde');
  assert.match(abs.detail, /^má 0 z 24 obchodů\. Bez toho nejde: Absorpce – kde\.$/);
  const day = fill.find(x => x.keys.includes('ctx-openVsValue'));
  assert.deepEqual(day.keys, ['ctx-openVsValue', 'ctx-dayTypeActual', 'ctx-dayTypeAccuracy', 'ctx-newsEvent']);
  assert.match(day.field, /^Kontext dne/);
  assert.equal(fill.some(x => x.keys.includes('ctx-trendHtfAlign')), false, 'trend 30m mají všechny obchody – není co vyplnit');
  // Jakmile se pole vyplní, položka zmizí.
  const filled = O.computeOverview(ctxOf([...many(12, () => trade({ absLocation: 'EXTREME' })), ...many(12, () => stop({ side: 'short', slPrice: 9000, targetLevel1: { type: 'VAL', price: 7000 }, absLocation: 'NONE' }))])).fill;
  assert.equal(filled.some(x => x.keys.includes('ctx-absLocation')), false);
});

test('obrazovka Kontext: skupina bez vzorku se nekreslí, běžící má tabulku s N a řádek „nevyplněno"', () => {
  const ctx = ctxOf([...many(12, () => trade()), ...many(12, against), ...many(5, () => trade({ trendHtf: '' }))]);
  const html = window.LabScreens.context.render(ctx);
  for (const id of ['ctx-entry', 'ctx-day']) {
    const part = sectionHtml(html, id);
    assert.doesNotMatch(part, /<table|<details/, id + ' kreslí tabulku');
    assert.match(part, /Zatím nejde — chybí vzorek: [^<]*\d/);
    assert.match(part, /data-goto="health" data-anchor="fill"/);
  }
  const direction = sectionHtml(html, 'ctx-direction');
  assert.match(direction, /^<details/);
  assert.match(direction, /<th>Směr vůči trendu 30m<\/th><th class="num">N<\/th><th class="num">Win %<\/th>/);
  assert.match(direction, /<td><b>po trendu<\/b><\/td><td class="num"><b>12<\/b><\/td><td class="num">100 %<\/td>/);
  assert.match(direction, /Nevyplněno <span class="muted">\(nevstupuje\)<\/span><\/td><td class="num">5<\/td>/);
  assert.match(direction, /N = 12: malý vzorek/);
  // Známka: všichni mají A – jedna skupina není porovnání, takže jen řádek, žádná tabulka.
  const process = sectionHtml(html, 'ctx-process');
  assert.match(process, /class="dim dim-na"[^]*Známka před vstupem[^]*zatím nejde — chybí \d+ obchodů v druhé největší skupině/);
  assert.equal(FORBIDDEN.test(html), false);
  assert.equal(window.LabScreens.context.title, 'Kontext');
  assert.equal(html.includes('data-section="ctx-sl"'), false, 'skupina SL (zóny u SL) v3 zmizela');
});

test('obrazovka Kontext: sbalené sekce se pamatují jako na ostatních obrazovkách', () => {
  assert.ok(V.SECTION_SCREENS.includes('context'));
  const views = V.sanitizeViews({ openSections: V.withSection({}, 'context', 'ctx-direction', true) });
  assert.deepEqual(views.openSections, { context: ['ctx-direction'] });
  const html = window.LabScreens.context.render(ctxOf([...many(12, () => trade()), ...many(12, against)], views));
  assert.match(sectionHtml(html, 'ctx-direction'), /^<details[^>]* open>/);
  assert.match(sectionHtml(html, 'ctx-process'), /^<details[^>]*"\s*>/);
});

test('Hladiny: rozložení podle vzdálenosti po 1 ticku, sloučení po 2 / 4 t je jen volba zobrazení', () => {
  // ES long, hladiny 1–4 t nad vstupem (MFE 25 → dotčené), 5 t pod vstupem (MAE 3 → nedotčená).
  const at = (make, ps, over = {}) => {
    const raw = make(over);
    delete raw.nearLevelsNone;
    raw.nearLevels = ps.map(([level, p, extra]) => ({ level, price: Number(raw.entryPrice) + p * 0.25, ...(extra || {}) }));
    return raw;
  };
  const raws = [];
  for (let i = 0; i < 4; i++) raws.push(at(trade, [['HVN', 1 + i, { testState: 'UNTESTED' }], ['VAL', -5]]));
  for (let i = 0; i < 8; i++) raws.push(at(trade, [['HVN', 2]]));
  const ctx = ctxOf(raws);
  const html = window.LabScreens.levels.render(ctx);
  assert.equal(window.LabScreens.levels.title, 'Hladiny');
  const dist = sectionHtml(html, 'dist');
  assert.match(dist, /12 dotčených · 4 nedotčených · 16 z 16 řádků s polohou/);
  assert.match(dist, /<td><b>\+2 t<\/b><\/td><td class="num"><b>9<\/b><\/td><td class="num">9<\/td>/);
  assert.match(dist, /<td><b>−5 t<\/b><\/td><td class="num"><b>4<\/b><\/td><td class="num">0<\/td><td class="num">4<\/td>/);
  assert.doesNotMatch(html, /zastavila|propadla|tolerance|Tolerance/, 'v3 bez tolerance a bez „zastavila / propadla"');
  // Volba sloučení: select s 1 / 2 / 4 t; sloučené koše jen přeskupí řádky.
  assert.match(dist, /<select data-view="levelBin"[^>]*>[^]*<option value="1" selected>po 1 t<\/option>/);
  const merged = sectionHtml(window.LabScreens.levels.render(ctxOf(raws, { levelBin: 2 })), 'dist');
  assert.match(merged, /<option value="2" selected>po 2 t<\/option>/);
  assert.match(merged, /<td><b>\+2 až \+3 t<\/b><\/td><td class="num"><b>10<\/b><\/td>/);
  // Podle typu a podle netest / test.
  assert.match(sectionHtml(html, 'by-type'), /<b>HVN<\/b>[^]*<b>VAL<\/b>/);
  assert.match(sectionHtml(html, 'by-test'), /netest/);
  assert.equal(FORBIDDEN.test(html), false);
});

test('Zdraví dat: sekce pokrytí kontextu a kontrola s informací se vykreslí', () => {
  const raws = [
    trade({ instrument: 'MES', entryPrice: '7840', slPrice: 7837.75, targetLevel1: { type: 'VAL', price: 7844.5 }, absLocation: 'NONE', nearLevels: [{ level: 'VAH', price: 7846 }], nearLevelsNone: undefined }),
    trade()
  ];
  const html = window.LabScreens.health.render(ctxOf(raws));
  const cov = sectionHtml(html, 'ctx-coverage');
  assert.match(cov, /Pokrytí kontextu/);
  assert.match(cov, /<b>Absorpce – kde<\/b> <span class="mono muted">absLocation<\/span>[^]*?<td class="num"><b>0<\/b><\/td><td class="num">1<\/td><td class="num">1<\/td>/);
  assert.match(cov, /export nenese dopočty deníku/);
  const checks = sectionHtml(html, 'c');
  assert.match(checks, /<span class="cid">16<\/span><span class="pill info">INFORMACE<\/span>/);
  assert.match(checks, /<span class="pill info">INFORMACE 1<\/span>/);
  assert.match(checks, /VAH 7846 leží za cílem \(\+24 t od vstupu\)/);
});

test('B4/4: starší export bez nových polí vykreslí všechny obrazovky bez chyby a bez doporučení', () => {
  const old = (over = {}) => {
    const { trendHtf, grade, ...rest } = trade(over);
    return rest;
  };
  const days = d => `2026-08-${String(d).padStart(2, '0')}`;
  const raws = [];
  for (let d = 1; d <= 22; d++) raws.push(old({ date: days(d) }), old({ date: days(d), result: 'stoploss', exitTicks: -12, rMultiple: 1, pnlRaw: -300, maeTicks: 12, mfeTicks: 2 }));
  const data = N.normalizeExport({ journalId: 'old', trades: raws });
  const options = H.includeOf({});
  const ctx = { records: data.records, perf: H.partition(data.records, options).perf, health: H.computeHealth(data.records, options), views: {}, options };
  for (const screen of ['summary', 'health', 'sltp', 'levels', 'context', 'risk']) {
    const html = window.LabScreens[screen].render(ctx);
    assert.ok(html.length > 200, screen);
    assert.equal(FORBIDDEN.test(html), false, screen + ' obsahuje doporučení');
    assert.doesNotMatch(html, /undefined|NaN|\[object/, screen);
  }
  // Dimenze z cen a časů běží i nad starým exportem, ruční pole a „cíl na hladině" ne.
  const cx = O.analyses(ctx).context;
  assert.equal(cx.dimensions.find(d => d.key === 'tradeNoInDay').state, 'weak');
  assert.equal(cx.dimensions.find(d => d.key === 'targetOnLevel').known, 0);
  assert.equal(cx.dimensions.find(d => d.key === 'trendHtfAlign').known, 0);
});
