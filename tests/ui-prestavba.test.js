'use strict';
// Nová navigace a obrazovky Diagnóza / Co kdyby (docs/ZADANI_LAB_PRESTAVBA.md §1, testy §5.8–5.9).
// Vykreslení běží v Node jako v ostatních testech obrazovek.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../app/health.js');
const V = require('../app/views.js');
const SM = require('../app/summary.js');
const W = require('../app/whatif.js');
const { trade, stop, normAll, many } = require('./helpers/records.js');

globalThis.window = globalThis;
require('../app/labels.js');
require('../app/diagnosis.js');
require('../app/ui-common.js');
require('../app/ui-summary.js');
require('../app/ui-health.js');
require('../app/ui-sltp.js');
require('../app/ui-levels.js');
require('../app/ui-context.js');
require('../app/ui-risk.js');
require('../app/ui-diagnosis.js');
require('../app/ui-whatif.js');

function ctxOf(raws, views = {}) {
  const records = normAll(raws);
  const options = H.includeOf(views);
  return { records, perf: H.partition(records, options).perf, health: H.computeHealth(records, options), views, options };
}
const FORBIDDEN = /doporuč|nastav si|optimáln|vyhýbej se/i;
const day = d => `2026-08-${String(d).padStart(2, '0')}`;

function big() {
  const raws = [];
  for (let d = 1; d <= 24; d++) {
    raws.push(stop({ date: day(d), entryTime: '15:00', comment: d % 3 ? '' : 'FOMO', instrument: 'MES', contracts: 2, commission: 3.8, pnlRaw: -33.8, slTicks: 12 }));
    raws.push(trade({ date: day(d), entryTime: '15:10', setupCode: d % 2 ? 'M2_TREND' : 'M2_OF', instrument: 'MES', contracts: 2, commission: 3.8, pnlRaw: 56.2, slTicks: 12 }));
    raws.push(stop({ date: day(d), entryTime: '15:20', instrument: 'MES', contracts: 2, commission: 3.8, pnlRaw: -33.8, slTicks: 12, grade: '' }));
  }
  return raws;
}

test('navigace: Diagnóza · Co kdyby · Data · Pokročilé (sbalené) – Souhrn zaniká, Pokročilé zůstávají', () => {
  assert.deepEqual(SM.NAV, [
    { screen: 'diagnosis' },
    { screen: 'whatif' },
    { group: 'data', label: 'Data', screens: ['health'] },
    { group: 'advanced', label: 'Pokročilé', screens: ['sltp', 'levels', 'context', 'risk'] }
  ]);
  assert.equal(SM.START_SCREEN, 'diagnosis');
  assert.equal(window.LabScreens.summary, undefined);
  assert.equal(window.LabScreens.diagnosis.title, 'Diagnóza');
  assert.equal(window.LabScreens.whatif.title, 'Co kdyby');
  for (const s of ['sltp', 'levels', 'context', 'risk', 'health']) assert.ok(window.LabScreens[s], s);
  // Pokročilé jsou ve výchozím stavu sbalené; rozbalení se pamatuje a přežije změnu deníku.
  assert.equal(V.sanitizeViews({}).navAdvancedOpen, undefined);
  const saved = V.sanitizeViews({ navAdvancedOpen: true, instrument: 'ES' });
  assert.equal(V.sanitizeViews(V.forJournalChange(saved)).navAdvancedOpen, true);
});

test('výběr nahoře: instrument výchozí = nejčastější v deníku, „Všechny" se pamatuje zvlášť', () => {
  const recs = normAll([trade({ instrument: 'MES' }), trade({ instrument: 'MES' }), trade({ instrument: 'ES' })]);
  assert.equal(H.defaultInstrument(recs), 'MES');
  assert.equal(H.filtersOf(recs, {}).instrument, 'MES');
  assert.equal(H.filtersOf(recs, { instrument: H.ALL_INSTRUMENTS }).instrument, '');
  assert.equal(H.filtersOf(recs, { instrument: 'ES' }).instrument, 'ES');
  assert.equal(V.sanitizeViews({ instrument: H.ALL_INSTRUMENTS }).instrument, H.ALL_INSTRUMENTS);
});

test('9: žádný text Diagnózy ani Co kdyby neobsahuje doporučení; vše se vykreslí bez chyby', () => {
  const full = W.defaultConfig();
  full.rules = { maxTrades: 2, dailyLossUSD: 70 };
  full.target = { mode: 'split', k1: 1, k2: 2 };
  full.exclude = { setup: ['M2_TREND'] };
  const views = [{}, { whatif: { current: full, saved: [W.applyPreset(W.defaultConfig(), 'rr1'), null] } }, { whatif: { current: W.applyPreset(W.defaultConfig(), 'wider2') } }];
  for (const raws of [[], [trade(), stop()], big()]) {
    for (const v of views) {
      const ctx = ctxOf(raws, V.sanitizeViews(v));
      for (const screen of ['diagnosis', 'whatif', 'health', 'sltp', 'levels', 'context', 'risk']) {
        const html = window.LabScreens[screen].render(ctx);
        assert.equal(FORBIDDEN.test(html), false, `${screen}: ${html.match(FORBIDDEN)}`);
        assert.doesNotMatch(html, /undefined|NaN|\[object/, screen);
      }
    }
  }
});

test('Diagnóza: karta nese n, dopad a rozbalitelné obchody; Data nesou nastavení slov', () => {
  const html = window.LabScreens.diagnosis.render(ctxOf(big()));
  assert.match(html, /dopad/);
  assert.match(html, /n = \d+/);
  assert.match(html, /<details[^>]*class="[^"]*trades/);
  assert.match(html, /Vstup, SL nebo cíl\?/);
  assert.match(html, /Zobrazit všechna srovnání/);
  const data = window.LabScreens.health.render(ctxOf(big()));
  assert.match(data, /Nastavení diagnózy/);
  assert.match(data, /data-diag-words="emotion"/);
});

test('Co kdyby: tabulka Skutečnost | Varianta, varování o přeladění jen s filtry B', () => {
  const plain = window.LabScreens.whatif.render(ctxOf(big(), V.sanitizeViews({ whatif: { current: W.applyPreset(W.defaultConfig(), 'max2') } })));
  assert.match(plain, /Skutečnost/);
  assert.match(plain, /Varianta/);
  assert.doesNotMatch(plain, /vypadají vždy líp/);
  const filtered = window.LabScreens.whatif.render(ctxOf(big(), V.sanitizeViews({ whatif: { current: W.applyPreset(W.defaultConfig(), 'noM2Trend') } })));
  assert.match(filtered, /Filtry a pravidla nastavené na stejných datech vypadají vždy líp, než budou dál\. Ověř na nových obchodech\./);
  assert.match(filtered, /Drží to\?/);
  assert.match(filtered, /Rozdíl (drží|stojí|se)/);
});
