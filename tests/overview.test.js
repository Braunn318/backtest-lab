'use strict';
// Úvodní obrazovka „Co teď vím" a sbalitelné sekce (ZADANI_PREHLEDNOST.md §4).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../app/health.js');
const O = require('../app/overview.js');
const V = require('../app/views.js');
const { trade, stop, norm, many } = require('./helpers/records.js');

// Okno v Node: UI soubory jsou obyčejné skripty, které čtou window.Lab*.
// Výpočetní moduly se samy pověsí na globalThis, takže stačí window = globalThis.
globalThis.window = globalThis;
require('../app/labels.js');
require('../app/ui-common.js');
require('../app/ui-overview.js');
require('../app/ui-health.js');
require('../app/ui-sltp.js');
require('../app/ui-levels.js');
require('../app/ui-risk.js');

function ctxOf(raws, views = {}) {
  const records = norm(raws);
  const options = H.includeOf(views);
  return { records, perf: H.partition(records, options).perf, health: H.computeHealth(records, options), views, options };
}
const row = (ov, key) => ov.rows.find(r => r.key === key);
// HTML jedné sekce obrazovky podle data-section.
function sectionHtml(html, id) {
  const start = html.indexOf(`data-section="${id}"`);
  assert.ok(start >= 0, `sekce ${id} chybí`);
  const open = html.lastIndexOf('<', start);
  const next = html.indexOf('class="card section', start);
  return html.slice(open, next < 0 ? html.length : html.lastIndexOf('<', next));
}
// Bez SR hladin a s vědomě „žádná hladina" – ať nic neruší.
const winner = (over = {}) => trade(over);

// ---------------------------------------------------------------- 1. stav –

test('1: chybí vstup → stav „–“ a text obsahuje počet, co chybí', () => {
  // 3 vítězové s naměřeným MAE: MAE vítězů nejde (pod 10), chybí 7.
  const ov = O.computeOverview(ctxOf([winner(), winner(), winner()]));
  const mae = row(ov, 'mae');
  assert.equal(mae.state, 'na');
  assert.equal(mae.icon, '–');
  assert.match(mae.text, /^MAE vítězů zatím nejde — chybí 7 ziskových obchodů s naměřeným MAE do 10 \(je 3 z 3/);

  // Síla hladin: SR řádky bez ceny i vzdálenosti – věta řekne kolik.
  const noPlace = { srTarget: [{ level: 'VAH', price: null, ticksFromEntry: null }] };
  const lv = row(O.computeOverview(ctxOf(many(4, () => winner(noPlace)))), 'levels');
  assert.equal(lv.state, 'na');
  assert.match(lv.text, /cena nebo vzdálenost u 4 z 4 řádků proti TP/);

  // Denní stop: dnů pod 20 – kolik dnů chybí.
  const ds = row(O.computeOverview(ctxOf([winner({ date: '2026-08-03' }), stop({ date: '2026-08-04' })])), 'dayStop');
  assert.equal(ds.state, 'na');
  assert.match(ds.text, /chybí 18 dnů do 20 \(data mají 2\)/);
});

// ---------------------------------------------------------------- 2. stav ~

test('2: pod prahem → stav „~“ a věta začíná „Předběžně“', () => {
  // 14 vítězů s naměřeným MAE: spočítatelné (≥ 10), ale pod prahem 30.
  const ov = O.computeOverview(ctxOf(many(14, () => winner())));
  const mae = row(ov, 'mae');
  assert.equal(mae.state, 'weak');
  assert.equal(mae.icon, '~');
  assert.match(mae.text, /^Předběžně: MAE vítězů: 90 % ziskových obchodů šlo proti nejvýš 3 t/);
  // Nad prahem 30 už „ví se“ a bez „Předběžně“.
  const ok = row(O.computeOverview(ctxOf(many(30, () => winner()))), 'mae');
  assert.equal(ok.state, 'ok');
  assert.doesNotMatch(ok.text, /předběžně/i);
  // Každý slabý řádek začíná „Předběžně“, každý „ví se“ ne.
  for (const r of ov.rows) {
    if (r.state === 'weak') assert.match(r.text, /^Předběžně: /, r.key);
    else assert.doesNotMatch(r.text, /^Předběžně/, r.key);
  }
});

test('řádky jsou seřazené: ví se → slabé → nejde; prahy obrazovek se nemění', () => {
  const ov = O.computeOverview(ctxOf(many(14, () => winner())));
  const ranks = ov.rows.map(r => O.STATES.indexOf(r.state));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(O.bySample(9), 'na');
  assert.equal(O.bySample(10), 'weak');
  assert.equal(O.bySample(29), 'weak');
  assert.equal(O.bySample(30), 'ok');
  assert.equal(O.bySample(49, 50), 'weak');
});

test('pravidlo ze simulátoru: věta s ušetřeno / zahozeno / čistě, pod 20 dny předběžně', () => {
  const days = ['2026-08-03', '2026-08-04', '2026-08-05'];
  const raws = days.flatMap(date => [stop({ date, entryTime: '15:00' }), stop({ date, entryTime: '15:10' }), winner({ date, entryTime: '15:20' })]);
  const r = row(O.computeOverview(ctxOf(raws, { riskConsecutiveSL: 2 })), 'dayStop');
  assert.equal(r.state, 'weak');
  assert.match(r.text, /^Předběžně: „konec po 2 SL za sebou“ ušetří 0 R a zahodí .+ R → čistě −.+ R; pod 20 dny jen popis\.$/);
});

// ---------------------------------------------------------------- 3. co vyplnit

test('3: seznam „Co vyplnit“ se vyplněním pole zkrátí (fixtura před / po)', () => {
  const before = many(6, () => winner({ targetLevel1: null }));
  const after = before.map(r => ({ ...r, targetLevel1: { type: 'VAL', price: 7806 } }));
  const fb = O.computeOverview(ctxOf(before)).fill;
  const fa = O.computeOverview(ctxOf(after)).fill;
  const planned = list => list.find(x => x.keys.includes('plannedTarget'));
  assert.ok(planned(fb), 'před: plánovaný cíl chybí');
  assert.match(planned(fb).detail, /má 0 z 6 obchodů/);
  assert.match(planned(fb).hint, /MANUAL_EXIT/);
  assert.equal(planned(fa), undefined, 'po vyplnění zmizí');
  assert.equal(fa.length, fb.length - 1);
});

test('co vyplnit: od nejužšího hrdla, SR hladiny pod jednou položkou, fill rate na konci', () => {
  const noPlace = { srTarget: [{ level: 'VAH', price: null, ticksFromEntry: null }], srStopLoss: [{ level: 'POC', price: null, ticksFromEntry: null }] };
  const raws = [...many(5, () => winner({ ...noPlace, targetLevel1: null })), ...many(5, () => winner({ maeTicks: null, maeTicksSource: undefined }))];
  const fill = O.computeOverview(ctxOf(raws)).fill;
  const sr = fill.find(x => x.keys.includes('levelsTarget'));
  assert.deepEqual(sr.keys, ['levelsTarget', 'levelsSl']);
  assert.match(sr.detail, /0 z 5 řádků \(Síla hladin proti TP\), 0 z 5 řádků \(Síla hladin proti SL\)/);
  const mins = fill.map(x => x.minN);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
  assert.deepEqual(fill[fill.length - 1].keys, ['fillRate']);
});

test('kdy to bude: řádek za nespuštěnou analýzu z prognózy zdraví dat, dny u denního stopu', () => {
  const ctx = ctxOf([winner(), winner(), stop()]);
  const ov = O.computeOverview(ctx);
  const maeFc = ctx.health.forecast.rows.find(r => r.key === 'maeWinners');
  const mae = ov.eta.find(x => x.key === 'mae');
  assert.ok(mae.text.includes(`do 50 chybí ${maeFc.goals[0].remaining}`));
  assert.ok(mae.text.includes(`≈ ${maeFc.goals[0].days} replay dnů`));
  assert.match(ov.eta.find(x => x.key === 'dayStop').text, /do 20 dnů chybí 19 → 19 replay dnů/);
  assert.equal(ov.eta.some(x => ov.rows.find(r => r.key === x.key).state === 'ok'), false);
});

// ---------------------------------------------------------------- 4. paměť sekcí

test('4: rozbalený stav se pamatuje (views.json) a přežije změnu deníku', () => {
  let views = { journalId: 'a', instrument: 'ES', riskUnitUSD: 25, riskConsecutiveSL: 2 };
  views = { ...views, openSections: V.withSection(views, 'sltp', 'mae', true) };
  views = { ...views, openSections: V.withSection(views, 'risk', 'variants', true) };
  // Uložení do views.json (sanitize v hlavním procesu) a zpět.
  const saved = V.sanitizeViews(JSON.parse(JSON.stringify(views)));
  assert.deepEqual(saved.openSections, { sltp: ['mae'], risk: ['variants'] });
  // Změna deníku: pryč jen to, co patří k deníku.
  const changed = V.sanitizeViews({ ...V.forJournalChange(saved), journalId: 'b' });
  assert.deepEqual(changed.openSections, { sltp: ['mae'], risk: ['variants'] });
  assert.equal(changed.instrument, undefined);
  assert.equal(changed.riskUnitUSD, undefined);
  assert.equal(changed.riskConsecutiveSL, 2);
  // Per obrazovka: stejné id na jiné obrazovce rozbalené není.
  assert.equal(V.isOpen(changed, 'sltp', 'mae'), true);
  assert.equal(V.isOpen(changed, 'levels', 'mae'), false);
  // A vykreslí se rozbalená, ostatní sbalené (výchozí stav).
  const html = window.LabScreens.sltp.render(ctxOf(many(14, () => winner()), changed));
  assert.match(sectionHtml(html, 'mae'), /^<details[^>]* open>/);
  assert.match(sectionHtml(html, 'trades'), /^<details[^>]*"\s*>/);
  // Sbalení ho z paměti vyndá; prázdný seznam se neukládá.
  const closed = V.sanitizeViews({ ...changed, openSections: V.withSection(changed, 'sltp', 'mae', false) });
  assert.deepEqual(closed.openSections, { risk: ['variants'] });
});

test('views: openSections se čistí – jen známé obrazovky a krátká id', () => {
  const clean = V.sanitizeViews({ openSections: { sltp: ['mae', 'mae', 'x y', 5, 'a'.repeat(41)], hacker: ['a'], risk: 'nope' } });
  assert.deepEqual(clean.openSections, { sltp: ['mae'] });
  assert.equal(V.sanitizeViews({ openSections: [] }).openSections, undefined);
});

// ---------------------------------------------------------------- 5. nespuštěná analýza

test('5: nespuštěná analýza nevykreslí tabulku – jen řádek „Zatím nejde — chybí …“ a odkaz', () => {
  const ctx = ctxOf([winner(), winner(), stop(), stop({ srTarget: [{ level: 'VAH', price: null, ticksFromEntry: null }] })]);
  const checks = [
    ['sltp', ['mae', 'mfe', 'sweep', 'grid']],
    ['levels', ['side-target', 'side-sl', 'control-target', 'control-sl']],
    ['risk', ['verdict', 'runs', 'perm', 'cond', 'variants']]
  ];
  for (const [screen, ids] of checks) {
    const html = window.LabScreens[screen].render(ctx);
    for (const id of ids) {
      const part = sectionHtml(html, id);
      assert.doesNotMatch(part, /<table|<details/, `${screen}/${id} kreslí tabulku`);
      assert.match(part, /Zatím nejde — chybí [^<]*\d/, `${screen}/${id}`);
      assert.match(part, /data-goto="overview" data-anchor="fill"/, `${screen}/${id} bez odkazu`);
    }
    // Nespuštěné až za těmi, co běží.
    const order = [...html.matchAll(/class="card section( section-na)?/g)].map(m => (m[1] ? 1 : 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${screen}: pořadí`);
  }
  // Analýza se vzorkem tabulku má.
  const rich = window.LabScreens.sltp.render(ctxOf(many(14, () => winner())));
  assert.match(sectionHtml(rich, 'mae'), /histogram/);
});

test('hlavička sbalené sekce nese hlavní číslo', () => {
  const html = window.LabScreens.sltp.render(ctxOf(many(14, () => winner())));
  assert.match(sectionHtml(html, 'mae'), /<span class="section-headline">p90 3 t · naměřeno 14 z 14<\/span>/);
});

// ---------------------------------------------------------------- 6. žádné doporučení

test('6: žádná věta na úvodní obrazovce neobsahuje doporučení k obchodování', () => {
  const FORBIDDEN = ['doporuč', 'nastav si', 'optimální'];
  const days = d => `2026-08-${String(d).padStart(2, '0')}`;
  const big = [];
  for (let d = 1; d <= 25; d++) big.push(winner({ date: days(d), entryTime: '15:00' }), stop({ date: days(d), entryTime: '15:10' }), stop({ date: days(d), entryTime: '15:20' }));
  const fixtures = [
    [[], {}],
    [[winner(), stop()], {}],
    [many(14, () => winner()), {}],
    [big, {}],
    [big, { riskConsecutiveSL: 2 }],
    [big, { riskDailyLoss: 2, riskMaxTrades: 3 }]
  ];
  for (const [raws, views] of fixtures) {
    const ctx = ctxOf(raws, views);
    const html = window.LabScreens.overview.render(ctx).toLowerCase();
    const ov = O.computeOverview(ctx);
    const texts = [...ov.rows.map(r => r.text), ...ov.fill.map(x => `${x.field} ${x.detail} ${x.hint || ''}`), ...ov.eta.map(x => x.text)].map(t => t.toLowerCase());
    for (const word of FORBIDDEN) {
      assert.equal(html.includes(word), false, `„${word}“ v HTML`);
      for (const t of texts) assert.equal(t.includes(word), false, `„${word}“: ${t}`);
    }
    // Žádné tabulky ani graf.
    assert.doesNotMatch(html, /<table|<svg|<canvas/);
  }
});
