'use strict';
// Syntetické záznamy ve tvaru ai-exportu deníku 4.7.2 (revize R2). Reálná
// data do repozitáře nepatří – fixtury z nich žijí v „Claude files/".
//
// trade() je obchod, který projde všemi kontrolami zdraví dat a má VŠECHNA
// kontextová pole vyplněná (missingContextKeys = []). Každý dostane jiný
// čas i vstup, aby se nehlásil jako duplicita.
const N = require('../../app/normalize.js');

let seq = 0;

function trade(over = {}) {
  seq++;
  const minutes = 9 * 60 + seq * 10;
  return {
    id: 't' + seq,
    instrument: 'ES',
    date: '2026-08-05',
    entryTime: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    entryPrice: String(7800 + seq),
    side: 'long',
    result: 'target',
    fillStatus: 'FILLED',
    setupCode: 'M2_OF',
    trend: 'LONG',
    entryLevels: ['M2_EDGE'],
    ofConfirm: ['ABS_BID'],
    srTarget: [{ level: 'NONE', price: null, ticksFromEntry: null }],
    srStopLoss: [{ level: 'NONE', price: null, ticksFromEntry: null }],
    slPrice: 7797,
    exitTicks: 24,
    slTicks: 12,
    rMultiple: 2,
    mfeTicks: 25,
    mfeTicksSource: 'nt8',
    maeTicks: 3,
    maeTicksSource: 'nt8',
    maxFavorableTicks: 30,
    maxAdverseTicks: 5,
    postExitFavorableTicks: 6,
    postExitAdverseTicks: 10,
    observedMinutes: 3,
    targetLevel1: { type: 'VAL', price: 7806 },
    pnlRaw: 588.48,
    ...over
  };
}

const stop = (over = {}) => trade({
  result: 'stoploss', exitTicks: -12, rMultiple: 1, pnlRaw: -311.52,
  mfeTicks: 2, maeTicks: 12, maxFavorableTicks: 4, maxAdverseTicks: 14,
  postExitFavorableTicks: 3, postExitAdverseTicks: 2,
  ...over
});

const setup = (over = {}) => ({
  id: 's' + (++seq), recordType: 'SETUP_ONLY', instrument: 'ES', date: '2026-08-05', entryTime: '16:04',
  side: 'long', setupCode: 'M2_OF', fillStatus: 'NO_FILL', plannedEntryPrice: 7803.5, ...over
});

const norm = raws => raws.map(N.normalizeRecord);
const many = (count, make) => Array.from({ length: count }, () => make());

module.exports = { trade, stop, setup, norm, many };
