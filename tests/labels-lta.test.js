'use strict';
// LTA Levels (deník 4.8.99+): hladiny v blízkosti s klíči LTA_… z LiveTradingAsistent.
// Deník je zakládá ve vlastní skupině LTA_LEVELS (NEAR_LEVEL.extraFrom) a export je nese
// v taxonomy.LTA_LEVELS = { custom, sourceNames, labels?, hidden?, removed? }.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const L = require('../app/labels.js');
const ST = require('../app/strength.js');
const { trade } = require('./helpers/records.js');

function withNear(levels, over = {}) {
  const raw = trade(over);
  const entry = Number(raw.entryPrice);
  delete raw.nearLevelsNone;
  raw.nearLevels = levels.map(([level, p]) => ({ level, price: entry + p * 0.25 }));
  return raw;
}

const LTA = {
  custom: { LTA_ID_VPOC: 'ID VPOC', LTA_WEEKLY_OPEN: 'Weekly Open' },
  sourceNames: { LTA_ID_VPOC: 'ID VPOC', LTA_WEEKLY_OPEN: 'Weekly Open' },
  labels: { LTA_WEEKLY_OPEN: 'Týdenní open' },
  hidden: ['LTA_ID_VPOC'],
  removed: []
};

test('LTA klíč u hladin v blízkosti: popisek z LTA_LEVELS (labels > custom), známý klíč', () => {
  const e = N.normalizeExport({
    journalId: 'j', taxonomy: { LTA_LEVELS: LTA },
    trades: [withNear([['LTA_ID_VPOC', 4], ['LTA_WEEKLY_OPEN', 8], ['VAH', -2]])]
  });
  assert.deepEqual(e.records[0].unknownKeys, [], 'LTA klíče nejsou neznámé');
  assert.equal(L.labelOfField('nearLevels', 'LTA_ID_VPOC'), 'ID VPOC', 'custom');
  assert.equal(L.labelOfField('nearLevels', 'LTA_WEEKLY_OPEN'), 'Týdenní open', 'přejmenování má přednost');
  assert.equal(L.labelOfField('nearLevels', 'VAH'), 'VAH', 'výchozí ENTRY_LEVEL dál platí');
  assert.equal(L.isKnownField('nearLevels', 'LTA_ID_VPOC'), true, 'skrytí v deníku klíč neruší');
  assert.equal(L.vocabularyOfField('nearLevels', 'LTA_ID_VPOC'), 'LTA_LEVELS');
  assert.equal(L.vocabularyOfField('nearLevels', 'VAH'), 'ENTRY_LEVEL');
  assert.equal(L.labelOf('LTA_LEVELS', 'LTA_WEEKLY_OPEN'), 'Týdenní open');
});

test('Hladiny podle typu (strength) ukazují LTA popisek a known = true', () => {
  N.normalizeExport({ journalId: 'j', taxonomy: { LTA_LEVELS: LTA }, trades: [] });
  const recs = [withNear([['LTA_ID_VPOC', 4]], { mfeTicks: 10 }), withNear([['LTA_UNKNOWN', 4]], { mfeTicks: 10 })]
    .map(N.normalizeRecord);
  const type = Object.fromEntries(ST.computeStrength(recs).byType.map(t => [t.key, t]));
  assert.deepEqual([type.LTA_ID_VPOC.label, type.LTA_ID_VPOC.known], ['ID VPOC', true]);
  assert.deepEqual([type.LTA_UNKNOWN.label, type.LTA_UNKNOWN.known], ['LTA_UNKNOWN', false], 'klíč mimo export zůstane holý a neznámý');
});

test('LTA klíč platí jen u hladin v blízkosti; bez taxonomie v exportu je neznámý', () => {
  const raw = withNear([['LTA_ID_VPOC', 4]], { entryLevels: ['LTA_ID_VPOC'] });
  const e = N.normalizeExport({ journalId: 'j', taxonomy: { LTA_LEVELS: LTA }, trades: [raw] });
  assert.deepEqual(e.records[0].unknownKeys, [{ field: 'entryLevels', key: 'LTA_ID_VPOC' }],
    'Hladina vstupu LTA volby nebere (v deníku nemá extraFrom)');

  const old = N.normalizeExport({ journalId: 'k', trades: [withNear([['LTA_ID_VPOC', 4]])] });
  assert.deepEqual(old.records[0].unknownKeys, [{ field: 'nearLevels', key: 'LTA_ID_VPOC' }]);
  assert.equal(L.labelOfField('nearLevels', 'LTA_ID_VPOC'), 'LTA_ID_VPOC');
  assert.equal(L.isKnownField('nearLevels', 'LTA_ID_VPOC'), false);
});
