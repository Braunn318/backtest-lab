'use strict';
// Stavy analýz, „Co vyplnit", „Kdy to bude" a sbalitelné sekce
// (ZADANI_PREHLEDNOST.md §4, od 0.4 obrazovka Data a Souhrn – ZADANI_LAB_SOUHRN.md).
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
require('../app/summary.js');
require('../app/ui-common.js');
require('../app/ui-summary.js');
require('../app/ui-health.js');
require('../app/ui-sltp.js');
require('../app/ui-levels.js');
require('../app/ui-risk.js');

function ctxOf(raws, views = {}) {
  const records = norm(raws);
  const options = H.includeOf(views);
  return { records, perf: H.partition(records, options).perf, health: H.computeHealth(records, options), views, options };
}
// HTML jedné sekce obrazovky podle data-section.
function sectionHtml(html, id) {
  const start = html.indexOf(`data-section="${id}"`);
  assert.ok(start >= 0, `sekce ${id} chybí`);
  const open = html.lastIndexOf('<', start);
  const next = html.indexOf('class="card section', start);
  return html.slice(open, next < 0 ? html.length : html.lastIndexOf('<', next));
}
const winner = (over = {}) => trade(over);
// Řádek hladiny bez ceny (ze starých dat, bez ticků) – poloha nejde určit.
const noPlace = { nearLevels: [{ level: 'VAH', price: null, legacySide: 'TG' }], nearLevelsNone: undefined };

// ---------------------------------------------------------------- 1. stav –

test('1: chybí vstup → stav „–" a „co chybí" obsahuje počet', () => {
  // 3 vítězové s naměřeným MAE: MAE vítězů nejde (pod 10), chybí 7.
  const st = O.computeOverview(ctxOf([winner(), winner(), winner()])).states;
  assert.equal(st.mae.state, 'na');
  assert.equal(O.ICON[st.mae.state], '–');
  assert.match(st.mae.missing, /^7 ziskových obchodů s naměřeným MAE do 10 \(je 3 z 3/);

  // Hladiny: řádky bez ceny – řekne se kolik.
  const lv = O.computeOverview(ctxOf(many(4, () => winner(noPlace)))).states.levels;
  assert.equal(lv.state, 'na');
  assert.match(lv.missing, /cena u 4 z 4 řádků hladin v blízkosti/);

  // Denní stop: dnů pod 20 – kolik dnů chybí.
  const ds = O.computeOverview(ctxOf([winner({ date: '2026-08-03' }), stop({ date: '2026-08-04' })])).states.dayStop;
  assert.equal(ds.state, 'na');
  assert.match(ds.missing, /^18 dnů do 20 \(data mají 2\)/);
});

// ---------------------------------------------------------------- 2. stav ~

test('2: prahy obrazovek se nemění: pod 10 nejde, pod 30 slabé (SL sweep a mřížka 50)', () => {
  const st = O.computeOverview(ctxOf(many(14, () => winner()))).states;
  assert.equal(st.mae.state, 'weak');
  assert.match(st.mae.fact, /^MAE vítězů: 90 % ziskových obchodů šlo proti nejvýš 3 t/);
  assert.equal(O.computeOverview(ctxOf(many(30, () => winner()))).states.mae.state, 'ok');
  assert.equal(O.bySample(9), 'na');
  assert.equal(O.bySample(10), 'weak');
  assert.equal(O.bySample(29), 'weak');
  assert.equal(O.bySample(30), 'ok');
  assert.equal(O.bySample(49, 50), 'weak');
});

test('pravidlo ze simulátoru: ušetřeno / zahozeno / čistě, pod 20 dny jen popis (slabé)', () => {
  const days = ['2026-08-03', '2026-08-04', '2026-08-05'];
  const raws = days.flatMap(date => [stop({ date, entryTime: '15:00' }), stop({ date, entryTime: '15:10' }), winner({ date, entryTime: '15:20' })]);
  const st = O.computeOverview(ctxOf(raws, { riskConsecutiveSL: 2 })).states.dayStop;
  assert.equal(st.state, 'weak');
  assert.match(st.fact, /^„konec po 2 SL za sebou“ ušetří 0 R a zahodí .+ R → čistě −.+ R; pod 20 dny jen popis$/);
});

test('analýzy se pro jeden render počítají jednou a sdílí je Souhrn i obrazovky', () => {
  const ctx = ctxOf(many(14, () => winner()), { levelBin: 2, sweepTargetR: 2 });
  const an = O.analyses(ctx);
  assert.equal(O.analyses(ctx), an, 'stejný objekt pro stejný render');
  assert.notEqual(O.analyses({ ...ctx }), an, 'nový render = nový výpočet');
  assert.equal(an.strength.bin, 2);
  assert.equal(an.sltp.sweep.targetR, 2);
  for (const key of ['sltp', 'strength', 'seq', 'va', 'sim', 'context']) assert.ok(an[key], key);
});

// ---------------------------------------------------------------- 3. co vyplnit

test('3: seznam „Co vyplnit" se vyplněním pole zkrátí (fixtura před / po)', () => {
  const before = many(6, () => winner({ targetLevel1: null }));
  const after = before.map(r => ({ ...r, targetLevel1: { type: 'VAL', price: 7806 } }));
  const fb = O.computeOverview(ctxOf(before)).fill;
  const fa = O.computeOverview(ctxOf(after)).fill;
  const planned = list => list.find(x => x.keys.includes('plannedTarget'));
  assert.ok(planned(fb), 'před: plánovaný cíl chybí');
  assert.match(planned(fb).detail, /má 0 z 6 obchodů/);
  assert.match(planned(fb).hint, /MANUAL_EXIT/);
  assert.equal(planned(fa), undefined, 'po vyplnění zmizí');
  const keys = list => list.flatMap(x => x.keys);
  assert.deepEqual(keys(fb).filter(k => !keys(fa).includes(k)), ['plannedTarget']);
  assert.deepEqual(keys(fa).filter(k => !keys(fb).includes(k)), []);
});

test('co vyplnit: od nejužšího hrdla, hladiny jednou položkou, fill rate na konci', () => {
  const raws = [...many(5, () => winner({ ...noPlace, targetLevel1: null })), ...many(5, () => winner({ maeTicks: null, maeTicksSource: undefined }))];
  const fill = O.computeOverview(ctxOf(raws)).fill;
  const lv = fill.find(x => x.keys.includes('levels'));
  assert.deepEqual(lv.keys, ['levels']);
  assert.match(lv.detail, /^má 0 z 5 řádků\. Bez toho nejde: Hladiny\.$/);
  assert.equal(lv.unit, 'řádků');
  // Nejdřív hrdla analýz fáze 2, pak pole kontextu, nenaplněné limitky poslední; uvnitř od nejmenšího N.
  const tiers = fill.map(x => x.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
  assert.deepEqual([...new Set(tiers)], [0, 1, 2]);
  for (const tier of [0, 1]) {
    const mins = fill.filter(x => x.tier === tier).map(x => x.minN);
    assert.deepEqual(mins, [...mins].sort((a, b) => a - b), 'vrstva ' + tier);
  }
  assert.equal(fill.filter(x => x.tier === 1).every(x => x.keys.every(k => k.startsWith('ctx-'))), true);
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

test('5: nespuštěná analýza nevykreslí tabulku – jen řádek „Zatím nejde — chybí …" a odkaz na Data', () => {
  const ctx = ctxOf([winner(), winner(), stop(), stop(noPlace)]);
  const checks = [
    ['sltp', ['mae', 'mfe', 'sweep', 'grid']],
    ['levels', ['dist', 'by-type', 'by-test', 'stop-behind', 'nearest-ahead', 'control']],
    ['risk', ['verdict', 'runs', 'perm', 'cond', 'variants']]
  ];
  for (const [screen, ids] of checks) {
    const html = window.LabScreens[screen].render(ctx);
    for (const id of ids) {
      const part = sectionHtml(html, id);
      assert.doesNotMatch(part, /<table|<details/, `${screen}/${id} kreslí tabulku`);
      assert.match(part, /Zatím nejde — chybí [^<]*\d/, `${screen}/${id}`);
      assert.match(part, /data-goto="health" data-anchor="fill"/, `${screen}/${id} bez odkazu`);
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
