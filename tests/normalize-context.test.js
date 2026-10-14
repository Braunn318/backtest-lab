'use strict';
// Normalizace kontextu – v2 (docs/ZADANI_KONTEXT.md část B) dorovnaná na v3
// (docs/ZADANI_KONTEXT_V3.md B1, B4).
//
// Tvar ověřený proti exportu 14. 10. 2026 (deník 4.8.5): ruční pole na obchodu,
// jeden seznam hladin `nearLevels` { level, price, testState?, legacySide?,
// ticksFromEntry? } + `nearLevelsNone`, dopočty deníku v `derived` (geometrie
// řádků v derived.nearLevels[i]), kontext dne v dayNotes[date].dayContext.
// Starší export (srTarget / srStopLoss) Lab převede v paměti stejným pravidlem
// jako deník (repo_clone/app/taxonomy.js nearLevelsFromLegacy).
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../app/normalize.js');
const L = require('../app/labels.js');

let seq = 0;
// Long z 7840, SL 9 t pod, cíl 18 t nad (MES, tick 0,25) – obchod 9. 10. 16:21.
// Bez klíčů hladin = hladiny nevyplněné.
const long = (over = {}) => ({
  id: 'L' + (++seq), instrument: 'MES', date: '2026-10-09', entryTime: '16:21', side: 'long',
  entryPrice: '7840', slPrice: 7837.75, result: 'breakeven', fillStatus: 'FILLED',
  targetLevel1: { type: 'LVN', price: 7844.5 }, ...over
});
// Short z 7847.25, SL 8 t nad (7849.25), cíl 16 t pod (7843.25).
const short = (over = {}) => long({ side: 'short', entryPrice: '7847.25', slPrice: 7849.25, targetLevel1: { type: 'CUSTOM_FIX_RRR', price: 7843.25 }, ...over });
const row = (level, price, ticksFromEntry = null, extra = {}) => ({ level, price, ticksFromEntry, ...extra });
const near = (level, price, extra = {}) => ({ level, price, ...extra });
const one = (raw, dayNotes) => N.normalizeRecords([raw], dayNotes)[0];
const geo = r => r.nearLevels.map(x => [x.level, x.fromEntry, x.fromStop, x.toTarget, x.position]);
const metrics = d => [d.nearestAheadTicks, d.nearestAheadR, d.stopBehindTicks, d.levelsStopToEntry, d.levelsEntryToTarget];

// Záznam, který má dané pole vyplněné hodnotou `value` – podle toho, odkud pole je.
function withField(field, value) {
  if (field.source === 'day') return one(long(), { '2026-10-09': { notes: '', dayContext: { [field.key]: value } } });
  if (field.source === 'export') return one(long({ derived: { [field.key]: value } }));
  return one(long({ [field.key]: value }));
}
const sampleValue = field => (field.vocabulary ? Object.keys(L.VOCABULARIES[field.vocabulary]).find(k => !(field.none || []).includes(k)) : true);

test('B4/1: každé pole kontextu má tři stavy – nevyplněno nikdy nespadne do „vědomě žádná"', () => {
  assert.ok(N.CONTEXT_V2_FIELDS.length >= 11);
  const empty = one(long());
  for (const field of N.CONTEXT_V2_FIELDS) {
    assert.deepEqual(empty.ctx[field.key], { state: 'unknown', value: null }, field.key + ': bez hodnoty = nevyplněno');
    for (const blank of ['', '  ', null]) assert.equal(withField(field, blank).ctx[field.key].state, 'unknown', field.key + ': prázdné = nevyplněno');
    const filled = withField(field, sampleValue(field)).ctx[field.key];
    assert.equal(filled.state, 'value', field.key + ': hodnota');
    assert.equal(filled.value, sampleValue(field), field.key);
    for (const none of field.none || []) {
      assert.deepEqual(withField(field, none).ctx[field.key], { state: 'none', value: none }, field.key + ': vědomě žádná');
    }
  }
  // Pole s volbou „žádná / nevím" – ta se s nevyplněným nikdy nesleje.
  assert.deepEqual(N.CONTEXT_V2_FIELDS.filter(f => f.none).map(f => f.key).sort(), ['absLocation', 'dayTypeActual', 'dayTypeExpected', 'newsEvent']);
});

test('v3: smazaná pole a dopočty v Labu nejsou – ani když je starý export nese', () => {
  const r = one(long({
    liquiditySwept: 'YES', pathProfile: 'LVN', entryLevels: ['VAH'], entryLevelTests: { VAH: 'TESTED' },
    srTarget: [row('VAH', 7841.75, 7)], srStopLoss: [row('VAL', 7839.25, 3)],
    derived: { pathState: 'BLOCKED', freePathR: 0.78, firstObstacleTicks: 7, slBufferTicks: 6, slZoneCount: 1 }
  }));
  for (const key of ['liquiditySwept', 'pathProfile', 'entryLevelTest']) {
    assert.equal(N.CONTEXT_V2_FIELDS.some(f => f.key === key), false, key + ' není v registru');
    assert.equal(key in r.ctx, false, key + ' není v out.ctx');
    assert.equal(key in r, false, key + ' není ve výstupu');
  }
  for (const key of ['pathState', 'freePathR', 'firstObstacleTicks', 'slBufferTicks', 'slZoneCount']) assert.equal(key in r.derived, false, key);
  for (const key of ['srTarget', 'srStopLoss', 'srTargetState', 'srStopLossState']) assert.equal(key in r, false, key);
  for (const x of r.nearLevels) for (const key of ['beyondStop', 'beyondTarget', 'behindEntry', 'towardStopTicks', 'ticksFromEntrySigned']) assert.equal(key in x, false, key);
  assert.equal(L.VOCABULARIES.LIQUIDITY_SWEPT, undefined);
  assert.equal(L.VOCABULARIES.PATH_PROFILE, undefined);
  assert.equal(L.VOCABULARIES.PATH_STATE, undefined);
});

test('v3 převod starého exportu: oba seznamy v jednom, NONE pryč, duplicita jednou, legacySide jen bez ceny', () => {
  const r = one(long({
    srTarget: [row('VAH', 7841.75, 7), row('NONE', null)],
    srStopLoss: [row('VAL', 7839.25, 3), row('VAH', 7841.75, 7, { testState: 'TESTED' }), row('M2_EDGE', null, 5)]
  }));
  assert.deepEqual(r.nearLevels.map(x => [x.level, x.price, x.testState, x.legacySide, x.ticksFromEntry]), [
    ['VAH', 7841.75, 'TESTED', null, null],
    ['VAL', 7839.25, null, null, null],
    ['M2_EDGE', null, null, 'SL', 5]
  ], 'cílová strana první; test/netest z duplicity doplní první řádek; řádek s cenou nenese ticky ani stranu');
  assert.equal(r.nearLevelsNone, false);
  assert.equal(r.nearLevelsState, 'present');
  // Řádek bez ceny na stejné straně jako řádek s cenou zmizí; na druhé straně zůstane (nese stranu).
  assert.deepEqual(one(long({ srTarget: [row('VAH', null), row('VAH', 7841.75, 7)] })).nearLevels.map(x => [x.level, x.price, x.legacySide]), [['VAH', 7841.75, null]]);
  assert.deepEqual(one(long({ srTarget: [row('VAH', null)], srStopLoss: [row('VAH', 7841.75, 7)] })).nearLevels.map(x => [x.level, x.price, x.legacySide]),
    [['VAH', null, 'TG'], ['VAH', 7841.75, null]]);
  // Nejstarší tvar: holý klíč.
  assert.deepEqual(one(long({ srTarget: ['VAH'] })).nearLevels.map(x => [x.level, x.price, x.legacySide, x.ticksFromEntry]), [['VAH', null, 'TG', null]]);
});

test('v3 převod: nearLevelsNone jen když byly oba původní příznaky „žádná"', () => {
  const none = over => { const r = one(long(over)); return [r.nearLevelsNone, r.nearLevelsState]; };
  assert.deepEqual(none({ srTargetNone: true, srStopLoss: [row('NONE', null)] }), [true, 'none']);
  assert.deepEqual(none({ srTarget: [row('NONE', null)], srStopLossNone: true }), [true, 'none']);
  assert.deepEqual(none({ srTargetNone: true, srStopLossNone: true }), [true, 'none']);
  assert.deepEqual(none({ srTargetNone: true }), [false, 'unknown'], 'jen jedna strana „žádná" = nevyplněno');
  assert.deepEqual(none({ srTargetNone: true, srStopLossNone: true, srTarget: [row('VAH', 7841.75, 7)] }), [false, 'present']);
  assert.deepEqual(none({}), [false, 'unknown']);
  // Nový tvar: příznak platí jen s prázdným seznamem; starý tvar vedle nového se nečte.
  assert.deepEqual(none({ nearLevels: [], nearLevelsNone: true }), [true, 'none']);
  assert.deepEqual(none({ nearLevels: [near('VAH', 7841.75)], nearLevelsNone: true }), [false, 'present']);
  assert.deepEqual(none({ nearLevels: [], srTargetNone: true, srStopLossNone: true }), [false, 'unknown']);
  assert.deepEqual(none({ nearLevels: [near('NONE', null)] }), [false, 'unknown'], 'řádek NONE se zahodí – deník ho zahodil taky');
});

test('B4.1: starý export (srTarget / srStopLoss) dá stejnou geometrii jako nový', () => {
  const old = one(long({
    srTarget: [row('VAH', 7841.75, 7), row('NONE', null)],
    srStopLoss: [row('VAL', 7839.25, 3), row('VAH', 7841.75, 7, { testState: 'TESTED' }), row('M2_EDGE', null, 5)]
  }));
  const fresh = one(long({
    nearLevels: [near('VAH', 7841.75, { testState: 'TESTED' }), near('VAL', 7839.25), near('M2_EDGE', null, { ticksFromEntry: 5, legacySide: 'SL' })]
  }));
  const strip = r => r.nearLevels.map(({ level, price, testState, legacySide, ticksFromEntry, fromEntry, fromStop, toTarget, position }) => ({ level, price, testState, legacySide, ticksFromEntry, fromEntry, fromStop, toTarget, position }));
  assert.deepEqual(strip(old), strip(fresh));
  assert.deepEqual(old.derived, fresh.derived);
  assert.deepEqual(geo(fresh), [['VAH', 7, 16, 11, 'ENTRY_TO_TARGET'], ['VAL', -3, 6, 21, 'STOP_TO_ENTRY'], ['M2_EDGE', -5, 4, 23, 'STOP_TO_ENTRY']]);
  assert.deepEqual([fresh.derived.targetTicks, fresh.derived.slTicks], [18, 9]);
  assert.deepEqual(metrics(fresh.derived), [7, 0.78, 4, 2, 1]);
});

test('v3 geometrie u longu: poloha čistě podle ceny, žádná tolerance (hladina 1 t od cíle i 2 t nad vstupem)', () => {
  const r = one(long({
    nearLevels: [near('A', 7840.5), near('B', 7844.25), near('C', 7844.5), near('D', 7845), near('E', 7840), near('F', 7837.75), near('G', 7837.5)]
  }));
  assert.deepEqual(geo(r), [
    ['A', 2, 11, 16, 'ENTRY_TO_TARGET'],
    ['B', 17, 26, 1, 'ENTRY_TO_TARGET'],
    ['C', 18, 27, 0, 'ENTRY_TO_TARGET'],
    ['D', 20, 29, -2, 'BEYOND_TARGET'],
    ['E', 0, 9, 18, 'AT_ENTRY'],
    ['F', -9, 0, 27, 'STOP_TO_ENTRY'],
    ['G', -10, -1, 28, 'BEYOND_STOP']
  ]);
  assert.deepEqual(metrics(r.derived), [2, 0.22, 9, 1, 3]);
  // stopBehindTicks bere i hladinu nad vstupem do longu.
  const above = one(long({ nearLevels: [near('VWAP', 7840.5)] }));
  assert.deepEqual(metrics(above.derived), [2, 0.22, 11, 0, 1]);
});

test('v3 geometrie u shortu', () => {
  const r = one(short({ nearLevels: [near('M2_EDGE', 7847.75), near('CUSTOM_GAMMA', 7847), near('VAH', 7850)] }));
  assert.deepEqual(geo(r), [['M2_EDGE', -2, 6, 18, 'STOP_TO_ENTRY'], ['CUSTOM_GAMMA', 1, 9, 15, 'ENTRY_TO_TARGET'], ['VAH', -11, -3, 27, 'BEYOND_STOP']]);
  assert.deepEqual(metrics(r.derived), [1, 0.13, 6, 1, 1]);
  assert.equal(Object.is(one(short({ nearLevels: [near('X', 7847.25)] })).nearLevels[0].fromEntry, 0), true, 'na vstupu shortu 0, ne −0');
});

test('v3 geometrie: chybí-li vstup, je hodnota null – nic se nedomýšlí', () => {
  // Bez ceny cíle: kladná hladina nemá polohu, počty v úsecích nejdou.
  const noTarget = one(long({ targetLevel1: null, nearLevels: [near('VAH', 7841.75), near('VAL', 7839.25)] }));
  assert.deepEqual(geo(noTarget), [['VAH', 7, 16, null, null], ['VAL', -3, 6, null, 'STOP_TO_ENTRY']]);
  assert.deepEqual(metrics(noTarget.derived), [null, null, 6, null, null]);
  // Bez SL: záporná hladina nemá polohu, R nejde.
  const noSl = one(long({ slPrice: null, nearLevels: [near('VAH', 7841.75), near('VAL', 7839.25)] }));
  assert.deepEqual(geo(noSl), [['VAH', 7, null, 11, 'ENTRY_TO_TARGET'], ['VAL', -3, null, 21, null]]);
  assert.deepEqual(metrics(noSl.derived), [7, null, null, null, null]);
  // Řádek ze starých dat bez ceny: poloha jen z ticků a strany; bez ticků nic.
  const legacy = one(long({ nearLevels: [near('VAH', null, { ticksFromEntry: 4, legacySide: 'TG' }), near('M2_EDGE', null, { legacySide: 'TG' }), near('VAL', null, { ticksFromEntry: 5, legacySide: 'SL' })] }));
  assert.deepEqual(geo(legacy), [['VAH', 4, 13, 14, 'ENTRY_TO_TARGET'], ['M2_EDGE', null, null, null, null], ['VAL', -5, 4, 23, 'STOP_TO_ENTRY']]);
  assert.deepEqual(metrics(legacy.derived), [4, 0.44, 4, null, null], 'řádek bez polohy = počty v úsecích nejdou');
  // Vědomě žádná hladina = 0 v obou úsecích; nevyplněno = null.
  assert.deepEqual(metrics(one(long({ nearLevels: [], nearLevelsNone: true })).derived), [null, null, null, 0, 0]);
  assert.deepEqual(metrics(one(long()).derived), [null, null, null, null, null]);
  // Neznámý tick: řádek s cenou nemá vzdálenost; řádek s ticky ano, ale bez SL v ticích ne polohu.
  const fdxs = one(long({ instrument: 'FDXS', nearLevels: [near('VAH', 7841.75), near('VAL', null, { ticksFromEntry: 5, legacySide: 'SL' })] }));
  assert.deepEqual(geo(fdxs), [['VAH', null, null, null, null], ['VAL', -5, null, null, null]]);
  assert.deepEqual([fdxs.derived.targetTicks, fdxs.derived.slTicks], [null, null]);
});

test('kontrola 17 (data): Lab přepočte geometrii sám a nesoulad s exportem zapíše, hodnotu nepřepíše', () => {
  const raw = long({ nearLevels: [near('VPOC_DAY', 7841.75), near('VPOC_30M', 7839.25)] });
  const derived = {
    targetTicks: 18, slTicks: 9, targetOnLevel: true, nearestAheadTicks: 7, nearestAheadR: 0.78, stopBehindTicks: 6,
    levelsStopToEntry: 1, levelsEntryToTarget: 1, tradeNoInDay: 1, prevResultInDay: 'FIRST', dayPnlBefore: 0, session: 'US_OPEN', gradeRetro: null,
    nearLevels: [
      { fromEntry: 7, fromStop: 16, toTarget: 11, position: 'ENTRY_TO_TARGET' },
      { fromEntry: -3, fromStop: 6, toTarget: 21, position: 'STOP_TO_ENTRY' }
    ]
  };
  const r = one(raw);
  assert.equal(r.exported, null);
  assert.deepEqual(r.derivedMismatch, [], 'bez dopočtů v exportu není co porovnat');
  assert.deepEqual(one({ ...raw, derived }).derivedMismatch, []);
  assert.equal(one({ ...raw, derived }).exportedOldShape, false);

  // Jiná hodnota v exportu → nesoulad s oběma čísly, Lab dál počítá se svým.
  const off = one({ ...raw, derived: { ...derived, nearestAheadTicks: 5, stopBehindTicks: 2 } });
  assert.deepEqual(off.derivedMismatch, [
    { field: 'nearestAheadTicks', lab: 7, exported: 5 },
    { field: 'stopBehindTicks', lab: 6, exported: 2 }
  ]);
  assert.equal(off.derived.nearestAheadTicks, 7);
  // I rozdíl „Lab má hodnotu, deník ne" je nesoulad.
  assert.deepEqual(one({ ...raw, derived: { ...derived, nearestAheadR: null, levelsEntryToTarget: null } }).derivedMismatch.map(m => m.field),
    ['nearestAheadR', 'levelsEntryToTarget']);
  // Řádek: nesoulad nese index řádku.
  const rowOff = one({ ...raw, derived: { ...derived, nearLevels: [derived.nearLevels[0], { ...derived.nearLevels[1], fromStop: 4, position: 'BEYOND_STOP' }] } });
  assert.deepEqual(rowOff.derivedMismatch, [
    { field: 'nearLevels[1].fromStop', lab: 6, exported: 4 },
    { field: 'nearLevels[1].position', lab: 'STOP_TO_ENTRY', exported: 'BEYOND_STOP' }
  ]);
  // Neznámý tick instrumentu (v deníku ho dává šablona): Lab nepočítá a neporovnává.
  const fdxs = one({ ...raw, instrument: 'FDXS', derived });
  assert.deepEqual(fdxs.derivedMismatch, []);
  assert.equal(fdxs.derivedUnverified, true);
  assert.equal(one(raw).derivedUnverified, false);
  // Export ze starého deníku (dopočty v2): srovnají se jen klíče, které se nezměnily.
  const oldShape = one(long({
    srTarget: [row('VPOC_DAY', 7841.75, 7)], srStopLoss: [row('VPOC_30M', 7839.25, 3)],
    derived: { targetTicks: 18, slTicks: 9, pathState: 'BLOCKED', firstObstacleTicks: 7, srTarget: [{ ticksFromEntrySigned: 7 }], srStopLoss: [{ ticksFromEntrySigned: -3 }] }
  }));
  assert.equal(oldShape.exportedOldShape, true);
  assert.deepEqual(oldShape.derivedMismatch, []);
});

test('B4/3: targetOnLevel se jen přebírá z exportu – Lab ho z typu a ceny cíle nedomýšlí', () => {
  const on = one(long({ derived: { targetOnLevel: true } }));
  const off = one(long({ targetLevel1: { type: 'CUSTOM_FIX_RRR', price: 7844.5 }, derived: { targetOnLevel: false } }));
  assert.deepEqual(on.ctx.targetOnLevel, { state: 'value', value: true });
  assert.deepEqual(off.ctx.targetOnLevel, { state: 'value', value: false }, 'false je hodnota, ne nevyplněno');
  // Starší export: typ i cena cíle vyplněné, ale bez dopočtu deníku → nevyplněno.
  assert.deepEqual(one(long()).ctx.targetOnLevel, { state: 'unknown', value: null });
  assert.deepEqual(one(long({ derived: { targetOnLevel: null } })).ctx.targetOnLevel, { state: 'unknown', value: null }, 'null z deníku = nejde určit');
  assert.equal(one(long({ derived: { nearestAheadTicks: 3 } })).ctx.targetOnLevel.state, 'unknown');
});

test('B4/4: starší export bez nových polí projde – vše nové je nevyplněno', () => {
  const old = { id: 'o1', instrument: 'ES', date: '2026-08-05', entryTime: '15:30', entryPrice: '7800', exitPrice: '7806', side: 'long', result: 'target', srTarget: ['VAH'], entryLevels: ['M2_EDGE'] };
  const e = N.normalizeExport({ journalId: 'j', trades: [old, { id: 'o2', recordType: 'SETUP_ONLY' }, {}] });
  assert.equal(e.records.length, 3);
  for (const r of e.records) {
    for (const field of N.CONTEXT_V2_FIELDS) assert.equal(r.ctx[field.key].state, 'unknown', field.key);
    assert.equal(r.exported, null);
    assert.deepEqual(r.derivedMismatch, []);
    assert.deepEqual(r.dataCheck, []);
    assert.equal(r.gradeOrigin, null);
  }
  assert.equal(e.records[0].derived.tradeNoInDay, 1, 'pořadí v dni Lab spočítá i bez dopočtů deníku');
  assert.deepEqual(geo(e.records[0]), [['VAH', null, null, null, null]], 'řádek bez ceny polohu neurčí');
  assert.deepEqual(N.normalizeExport({ trades: [old], dayNotes: null }).records[0].ctx.newsEvent, { state: 'unknown', value: null });
  // Samotný záznam mimo deník (normalizeRecord) má pořadí i kontext dne nevyplněné.
  assert.equal(N.normalizeRecord(old).derived.tradeNoInDay, null);
  assert.equal(N.normalizeRecord(old).ctx.openVsValue.state, 'unknown');
});

test('netest / test na řádku hladiny: jen platná hodnota', () => {
  const r = one(long({ nearLevels: [near('VPOC_30M', 7842, { testState: 'UNTESTED' }), near('VAH', 7843, { testState: 'BOGUS' }), near('VAL', 7843.5)] }));
  assert.deepEqual(r.nearLevels.map(x => x.testState), ['UNTESTED', null, null]);
});

test('kontrola dat: cíl / SL na špatné straně vstupu – fixtury ze zadání A1.2', () => {
  const codes = raw => one(raw).dataCheck.map(i => i.code);
  // 2. 10. 15:44 short, cíl 779475 (překlep) · 5. 10. 18:18 long ze 7811, cíl 7783 · 9. 10. 17:01 cíl = cena SL
  assert.deepEqual(codes(long({ side: 'short', entryPrice: '7794.5', slPrice: 7797, targetLevel1: { type: 'VPOC_1M', price: 779475 } })), ['TARGET_WRONG_SIDE']);
  assert.deepEqual(codes(long({ entryPrice: '7811', slPrice: 7808, targetLevel1: { type: 'LIQUIDITY', price: 7783 } })), ['TARGET_WRONG_SIDE']);
  assert.deepEqual(codes(long({ entryPrice: '7847.75', slPrice: 7845.25, targetLevel1: { type: 'CUSTOM_FIX_RRR', price: 7845.25 } })), ['TARGET_WRONG_SIDE']);
  assert.match(one(long({ entryPrice: '7811', slPrice: 7808, targetLevel1: { type: 'LIQUIDITY', price: 7783 } })).dataCheck[0].message, /7783.*long z 7811/);
  // Cíl ani SL na ceně vstupu nedávají smysl.
  assert.deepEqual(codes(long({ targetLevel1: { type: 'VAH', price: 7840 }, slPrice: 7840 })), ['TARGET_WRONG_SIDE', 'SL_WRONG_SIDE']);
  assert.deepEqual(codes(long({ slPrice: 7841 })), ['SL_WRONG_SIDE']);
  // Dopočtená hodnota není vstup: SL z trailu do BE+ leží v zisku oprávněně.
  assert.deepEqual(codes(long({ slPrice: 7841, slDerived: true })), []);
  assert.deepEqual(codes(long({ targetLevel1: { type: 'VAH', price: 7839 }, targetLevel1PriceDerived: true })), []);
  // Setup bez vstupu má jen plánovaný vstup; bez směru se nekontroluje nic.
  assert.deepEqual(codes({ recordType: 'SETUP_ONLY', side: 'long', plannedEntryPrice: 7840, targetLevel1: { type: 'VAH', price: 7835 } }), ['TARGET_WRONG_SIDE']);
  assert.deepEqual(codes(long({ side: '', targetLevel1: { type: 'VAH', price: 7830 } })), []);
  assert.deepEqual(codes(long()), []);
});

test('pořadí v dni se počítá při čtení přes celý deník – po vynechání prostředního obchodu se přepočítá', () => {
  const t = (id, time, over = {}) => long({ id, entryTime: time, result: 'target', pnlRaw: 10, ...over });
  const day = [
    t('c', '17:00', { result: 'target', pnlRaw: 30 }),
    t('a', '15:00', { result: 'stoploss', pnlRaw: -20.5 }),
    t('b', '16:00', { result: 'breakeven', pnlRaw: -1.2 }),
    t('x', '15:30', { fillStatus: 'SKIPPED' }),
    t('y', '15:45', { recordType: 'SETUP_ONLY' }),
    t('z', '09:00', { date: '2026-10-08' })
  ];
  const by = recs => Object.fromEntries(recs.map(r => [r.id, r.derived]));
  const all = by(N.normalizeRecords(day));
  assert.deepEqual([all.a.tradeNoInDay, all.a.prevResultInDay, all.a.dayPnlBefore], [1, 'FIRST', 0]);
  assert.deepEqual([all.b.tradeNoInDay, all.b.prevResultInDay, all.b.dayPnlBefore], [2, 'stoploss', -20.5]);
  assert.deepEqual([all.c.tradeNoInDay, all.c.prevResultInDay, all.c.dayPnlBefore], [3, 'breakeven', -21.7]);
  assert.deepEqual([all.z.tradeNoInDay, all.z.prevResultInDay], [1, 'FIRST'], 'jiný den začíná znovu');
  // Hypotetický obchod ani setup bez vstupu do pořadí nepatří – null, ne 0.
  assert.deepEqual([all.x.tradeNoInDay, all.x.prevResultInDay, all.x.dayPnlBefore], [null, null, null]);
  assert.equal(all.y.tradeNoInDay, null);
  const without = by(N.normalizeRecords(day.filter(r => r.id !== 'b')));
  assert.deepEqual([without.c.tradeNoInDay, without.c.prevResultInDay, without.c.dayPnlBefore], [2, 'stoploss', -20.5]);
  // Bez pnlRaw: znaménko podle výsledku (pnl je v exportu absolutní hodnota).
  const legacy = by(N.normalizeRecords([t('a', '15:00', { result: 'stoploss', pnlRaw: undefined, pnl: 40 }), t('b', '16:00')]));
  assert.equal(legacy.b.dayPnlBefore, -40);
  // Nesoulad s exportem se hlásí i tady.
  const off = N.normalizeRecords([t('a', '15:00', { derived: { tradeNoInDay: 2, prevResultInDay: 'FIRST', dayPnlBefore: 0 } })])[0];
  assert.deepEqual(off.derivedMismatch, [{ field: 'tradeNoInDay', lab: 1, exported: 2 }]);
});

test('kontext dne se připojí ke každému záznamu dne podle data', () => {
  const dayNotes = {
    '2026-10-09': { comment: '', notes: '', dayContext: { openVsValue: 'IN_VA', dayTypeExpected: 'UNKNOWN', newsEvent: 'NONE' }, imageCount: 0 },
    '2026-10-08': { comment: 'BAD DAY', notes: 'x' }
  };
  const [a, b, c] = N.normalizeExport({ journalId: 'j', dayNotes, trades: [long({ id: 'a' }), long({ id: 'b', date: '2026-10-08' }), long({ id: 'c', date: '' })] }).records;
  assert.deepEqual(a.ctx.openVsValue, { state: 'value', value: 'IN_VA' });
  assert.deepEqual(a.ctx.dayTypeExpected, { state: 'none', value: 'UNKNOWN' }, 'vědomé „nevím" není nevyplněno');
  assert.deepEqual(a.ctx.newsEvent, { state: 'none', value: 'NONE' });
  assert.equal(a.ctx.dayTypeActual.state, 'unknown');
  assert.equal(a.hasDayContext, true);
  for (const r of [b, c]) {
    assert.equal(r.hasDayContext, false);
    assert.equal(r.ctx.openVsValue.state, 'unknown');
    assert.equal(r.ctx.newsEvent.state, 'unknown', 'den bez kontextu není „bez zpráv"');
  }
});

test('známka a její původ', () => {
  const g = over => one(long(over));
  assert.equal(g({}).gradeOrigin, null, 'bez známky není co třídit');
  assert.equal(g({ grade: 'A', gradeSetAt: '2026-10-09T14:00:00Z' }).gradeOrigin, 'clean');
  assert.equal(g({ grade: 'A', derived: { gradeRetro: null } }).gradeOrigin, 'clean', 'v backtestu nejde ověřit – null není „zpětně"');
  assert.equal(g({ grade: 'A', derived: { gradeRetro: false } }).gradeOrigin, 'clean');
  assert.equal(g({ grade: 'B', derived: { gradeRetro: true } }).gradeOrigin, 'retro');
  assert.equal(g({ grade: 'B', gradeEdited: true, derived: { gradeRetro: true } }).gradeOrigin, 'edited');
  assert.equal(g({ grade: 'C', gradeEdited: true }).gradeEdited, true);
});

test('úplnost: hladiny v blízkosti jako v deníku; trend 30m a známka chybí; hypotetický obchod s výstupem jako naplněný', () => {
  const full = {
    setupCode: 'M2_OF', fillStatus: 'FILLED', trend: 'LONG', trendHtf: 'UP', grade: 'A', entryLevels: ['M2_EDGE'], nearLevels: [], nearLevelsNone: true,
    ofConfirm: ['NONE'], targetLevel1: { type: 'VAL', price: 7806 }, slPrice: 7797, mfeTicks: 24, maeTicks: 0, postExitFavorableTicks: 0, postExitAdverseTicks: 3
  };
  assert.deepEqual(N.normalizeRecord(full).missingContext, [], 'absLocation, entryTestNo … úplnost neblokují');
  assert.deepEqual(N.normalizeRecord({ ...full, trendHtf: '', grade: undefined }).missingContext, ['trendHtf', 'grade']);
  assert.ok(N.CONTEXT_KEYS.includes('nearLevels'));
  assert.equal(N.CONTEXT_KEYS.includes('srTarget') || N.CONTEXT_KEYS.includes('srStopLoss'), false);
  assert.deepEqual(N.normalizeRecord({ ...full, nearLevelsNone: false }).missingContext, ['nearLevels']);
  assert.deepEqual(N.normalizeRecord({ ...full, nearLevelsNone: false, nearLevels: [near('VAH', null)] }).missingContext, [], 'řádek bez ceny je vyplněný');
  // Starý tvar: „žádná" na obou stranách = vyplněno.
  const { nearLevels, nearLevelsNone, ...oldFull } = full;
  assert.deepEqual(N.normalizeRecord({ ...oldFull, srTargetNone: true, srStopLossNone: true }).missingContext, []);
  assert.deepEqual(N.normalizeRecord({ ...oldFull, srTargetNone: true }).missingContext, ['nearLevels']);
  // NO_FILL bez výstupu: průběh se nekontroluje. S výstupní cenou („co by to udělalo") ano.
  assert.deepEqual(N.normalizeRecord({ ...full, fillStatus: 'NO_FILL', mfeTicks: null }).missingContext, []);
  assert.deepEqual(N.normalizeRecord({ ...full, fillStatus: 'NO_FILL', exitPrice: '7806', mfeTicks: null }).missingContext, ['mfeTicks']);
});

test('klíče deníku mají popisek a nejsou neznámé; neznámý typ hladiny se hlásí', () => {
  const r = one(long({
    trendHtf: 'UP', grade: 'A', absLocation: 'EXTREME', entryTestNo: '3+',
    entryLevels: ['HVN', 'VPOC_PREV_DAY'], nearLevels: [near('LVN', 7842), near('HOD_LOD', 7843)], targetLevel1: { type: 'VAH_PREV', price: 7844.5 }
  }));
  assert.deepEqual(r.unknownKeys, []);
  assert.deepEqual(one(long({ trendHtf: 'SIDEWAYS', grade: 'D' })).unknownKeys, [{ field: 'trendHtf', key: 'SIDEWAYS' }, { field: 'grade', key: 'D' }]);
  assert.deepEqual(one(long({ nearLevels: [near('XYZ', 7842)] })).unknownKeys, [{ field: 'nearLevels', key: 'XYZ' }]);
  assert.equal(L.labelOfField('trendHtf', 'UP'), 'Nahoru');
  assert.equal(L.labelOfField('entryTestNo', '3+'), '3. a další');
  assert.equal(L.labelOfField('dayTypeActual', 'BALANCE_D'), 'Balance (D)');
  assert.equal(L.labelOf('TEST_STATE', 'UNTESTED'), 'netest');
  assert.equal(L.fieldLabel('trendHtf'), 'Trend 30m');
  assert.equal(L.fieldLabel('nearLevels'), 'Hladiny v blízkosti');
  for (const f of N.CONTEXT_V2_FIELDS) assert.notEqual(L.fieldLabel(f.key), f.key, f.key + ' má popisek');
  for (const p of ['BEYOND_STOP', 'STOP_TO_ENTRY', 'AT_ENTRY', 'ENTRY_TO_TARGET', 'BEYOND_TARGET']) assert.ok(L.POSITION_LABEL[p], p);
});

test('tick instrumentu: kód bez kontraktního měsíce', () => {
  assert.equal(N.tickSizeOf('MES 09-26'), 0.25);
  assert.equal(N.tickSizeOf('FDXS'), null, 'neznámý instrument se nehádá');
});
