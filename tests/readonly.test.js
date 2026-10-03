'use strict';
// Pojistka „Lab do deníku nikdy nezapisuje":
//  1) statická kontrola zdrojáku – zapisovací volání fs smí být jen ve
//     writeViews() a ta musí jít přes assertLabWritable
//  2) okno ani preload na fs nesahají
//  3) assertLabWritable propustí jen složku Labu
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../lib/paths');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const WRITE_CALL = /\bfs\.(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|mkdirSync|mkdir|rmSync|rm|rmdirSync|unlinkSync|unlink|copyFileSync|copyFile|cpSync|createWriteStream|truncateSync|openSync|symlinkSync|linkSync|chmodSync|utimesSync)\s*\(/g;

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `funkce ${name} nenalezena`);
  let depth = 0, i = source.indexOf('{', start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return { start, end: i + 1, body: source.slice(open, i + 1) };
}

test('main.js: zapisovací volání fs jen uvnitř writeViews', () => {
  const src = read('main.js');
  const { start, end, body } = functionBody(src, 'writeViews');
  const outside = [...src.matchAll(WRITE_CALL)].filter(m => m.index < start || m.index >= end);
  assert.deepEqual(outside.map(m => m[0]), [], 'zápis mimo writeViews');
  assert.ok(body.includes('assertLabWritable'), 'writeViews musí volat assertLabWritable');
  const writes = [...body.matchAll(WRITE_CALL)].length;
  const asserts = (body.match(/assertLabWritable\(/g) || []).length;
  assert.ok(asserts >= 2, 'pojistka pro cílový i dočasný soubor');
  assert.ok(writes > 0);
});

test('main.js nastavuje vlastní userData před startem', () => {
  const src = read('main.js');
  assert.match(src, /app\.setPath\('userData', LAB_DIR\)/);
  assert.equal(P.LAB_APP_DIR === P.JOURNAL_APP_DIR, false);
});

test('okno, preload a knihovny na fs nesahají', () => {
  const appFiles = fs.readdirSync(path.join(ROOT, 'app')).filter(f => f.endsWith('.js')).map(f => 'app/' + f);
  assert.ok(appFiles.length >= 5);
  for (const f of ['preload.js', 'lib/paths.js', ...appFiles]) {
    const src = read(f);
    assert.equal(/require\(['"](node:)?fs['"]\)/.test(src), false, f + ' načítá fs');
    assert.equal([...src.matchAll(WRITE_CALL)].length, 0, f + ' volá zápis');
  }
});

test('assertLabWritable: propustí jen složku Labu, nikdy deník', () => {
  const appData = path.join('C:', 'Users', 'x', 'AppData', 'Roaming');
  const labDir = P.labUserDataDir(appData);
  const journalDir = P.journalUserDataDir(appData);
  const forbidden = [journalDir, path.join(journalDir, 'ai-export')];
  assert.equal(P.assertLabWritable(path.join(labDir, 'views.json'), { labDir, forbidden }), true);
  assert.throws(() => P.assertLabWritable(path.join(journalDir, 'ai-export', 'index.json'), { labDir, forbidden }));
  assert.throws(() => P.assertLabWritable(path.join(journalDir, 'journal-data', 'x.json'), { labDir, forbidden }));
  assert.throws(() => P.assertLabWritable(path.join(appData, 'views.json'), { labDir, forbidden }));
  assert.throws(() => P.assertLabWritable(path.join(labDir + '-evil', 'views.json'), { labDir, forbidden }), 'prefix jiné složky neprojde');
  // Zakázaná složka uvnitř Labu (přepsaná cesta ke zdroji) má přednost.
  const inside = path.join(labDir, 'ai-export');
  assert.throws(() => P.assertLabWritable(path.join(inside, 'x.json'), { labDir, forbidden: [inside] }));
});

test('resolveSourceDir: přepis → customDataDir deníku → výchozí', () => {
  const appData = path.join('C:', 'AD');
  const journalDir = P.journalUserDataDir(appData);
  const cfgFile = path.join(journalDir, 'data-location.json');
  const files = { [cfgFile]: JSON.stringify({ customDataDir: 'D:\\FJ' }) };
  const readFile = f => { if (f in files) return files[f]; throw new Error('ENOENT'); };

  assert.deepEqual(P.resolveSourceDir({ appData, override: 'E:\\x', readFile, exists: () => true }), { dir: 'E:\\x', origin: 'override' });
  assert.deepEqual(P.resolveSourceDir({ appData, readFile, exists: () => true }), { dir: path.join('D:\\FJ', 'ai-export'), origin: 'journal-custom' });
  assert.deepEqual(P.resolveSourceDir({ appData, readFile, exists: () => false }), { dir: path.join(journalDir, 'ai-export'), origin: 'default' });
  assert.deepEqual(P.resolveSourceDir({ appData, readFile: () => { throw new Error('x'); }, exists: () => true }).origin, 'default');
});

test('isValidJournalId: žádné cesty', () => {
  assert.equal(P.isValidJournalId('journal_1790178881642_mhr7kq'), true);
  assert.equal(P.isValidJournalId('../settings'), false);
  assert.equal(P.isValidJournalId('a\\b'), false);
  assert.equal(P.isValidJournalId(''), false);
});
