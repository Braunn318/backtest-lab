'use strict';
// Kontrolní čísla z docs/ZADANI_LAB_PRESTAVBA.md §4 – ručně spočítaná z CSV exportu
// deníku 21. 10. 2026. Lab musí vyjít stejně (± 0,1 $).
//
// Fixtura je reálný ai-export deníku Phidias 1 – do repozitáře nepatří. Hledá se
// v proměnné prostředí LAB_FIXTURE, jinak v „Claude files/phidias1-2026-10-21.json"
// (gitignore). Bez ní se test přeskočí.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const N = require('../app/normalize.js');
const H = require('../app/health.js');
const DG = require('../app/diagnosis.js');
const W = require('../app/whatif.js');

const FIXTURE = process.env.LAB_FIXTURE || path.join(__dirname, '..', 'Claude files', 'phidias1-2026-10-21.json');
const skip = fs.existsSync(FIXTURE) ? false : `fixtura chybí (${FIXTURE})`;

function load() {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const data = N.normalizeExport(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  const views = { instrument: 'MES', dateFrom: '2026-09-14', dateTo: '2026-10-21' };
  return { records: H.filterRecords(data.records, views), options: H.includeOf(views) };
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 0.1, `${label}: ${actual} místo ${expected}`);
const group = (res, comp, key) => res.comparisons.find(c => c.key === comp).groups.find(g => g.key === key);

test('§4 kontrolní čísla – Diagnóza', { skip }, () => {
  const { records, options } = load();
  const res = DG.computeDiagnosis(records, options);
  assert.equal(res.header.n, 104);
  near(res.header.pnl, -753.3, 'celkem');
  near(res.header.fees, 393.3, 'poplatky');
  const first = group(res, 'order', '1');
  assert.equal(first.n, 24); near(first.pnl, -68.7, '1. obchod dne');
  const sl2 = group(res, 'slBefore', '2');
  assert.equal(sl2.n, 40); near(sl2.pnl, -300.1, 'po 2+ SL');
  const five = group(res, 'dayCount', '5');
  assert.equal(five.days, 11); near(five.pnl, -480.2, 'dny s 5+ obchody');
  assert.equal(res.giveBack.days, 14); near(res.giveBack.givenBack, 393.3, 'vrácený zisk');
  const trend = group(res, 'setup', 'M2_TREND');
  assert.equal(trend.n, 17); near(trend.pnl, -282.1, 'M2 v trendu');
  const fix = group(res, 'targetType', 'CUSTOM_FIX_RRR');
  assert.equal(fix.n, 13); near(fix.pnl, -251.9, 'Fix RRR');
});

test('§4 kontrolní čísla – Co kdyby', { skip }, () => {
  const { records, options } = load();
  const run = preset => W.computeWhatIf(records, W.applyPreset(W.defaultConfig(), preset), options).variant;
  const max2 = run('max2');
  assert.equal(max2.n, 48); near(max2.pnl, -309.9, 'max 2 obchody');
  const tg2 = run('targetOr2SL');
  assert.equal(tg2.n, 40); near(tg2.pnl, -224.5, 'konec po targetu nebo 2 SL');
  const first = run('firstSLOrTarget');
  assert.equal(first.n, 26); near(first.pnl, -43.8, 'konec po prvním SL nebo targetu');
});
