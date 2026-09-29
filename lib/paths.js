'use strict';
// Cesty a pojistka zápisu – čisté funkce bez Electronu, aby šly testovat.
//
// Lab do deníku ani do jeho datové složky NIKDY nezapisuje. Dva procesy nad
// jedním souborem už v tomhle projektu jednou vedly ke ztrátě dat. Jediné, co
// Lab zapisuje, jsou uživatelské pohledy ve vlastní složce userData, a každý
// zápis jde přes assertLabWritable.

const path = require('path');

const JOURNAL_APP_DIR = 'futures-journal-pro';
const LAB_APP_DIR = 'backtest-lab';
const JOURNAL_ID_RE = /^[a-zA-Z0-9_-]+$/;

function norm(p) {
  return path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(child, parent) {
  const c = norm(child), p = norm(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(p + path.sep.toLowerCase()) || c.startsWith(p + '/');
}

function journalUserDataDir(appData) {
  return path.join(appData, JOURNAL_APP_DIR);
}

function labUserDataDir(appData) {
  return path.join(appData, LAB_APP_DIR);
}

// Složka ai-exportu. Pořadí: ruční přepis v nastavení Labu → customDataDir
// z data-location.json deníku (jen se čte) → výchozí userData deníku.
function resolveSourceDir({ appData, override, readFile, exists }) {
  if (override) return { dir: override, origin: 'override' };
  const journalDir = journalUserDataDir(appData);
  try {
    const cfg = JSON.parse(readFile(path.join(journalDir, 'data-location.json')));
    if (cfg && cfg.customDataDir && exists(cfg.customDataDir)) {
      return { dir: path.join(cfg.customDataDir, 'ai-export'), origin: 'journal-custom' };
    }
  } catch { /* soubor chybí nebo je poškozený → výchozí umístění */ }
  return { dir: path.join(journalDir, 'ai-export'), origin: 'default' };
}

// Zakázané kořeny: userData deníku, jeho přesměrovaná datová složka a zdroj
// dat Labu. Zápis smí jít jen dovnitř labDir a mimo všechny zakázané.
function assertLabWritable(target, { labDir, forbidden = [] }) {
  if (!labDir || !isInside(target, labDir)) {
    throw new Error(`Lab smí zapisovat jen do své složky (${labDir}), ne do: ${target}`);
  }
  for (const dir of forbidden) {
    if (dir && (isInside(target, dir) || isInside(dir, target))) {
      throw new Error(`Zápis do datové složky deníku je zakázaný: ${target}`);
    }
  }
  return true;
}

function isValidJournalId(id) {
  return typeof id === 'string' && JOURNAL_ID_RE.test(id);
}

module.exports = {
  JOURNAL_APP_DIR,
  LAB_APP_DIR,
  isInside,
  journalUserDataDir,
  labUserDataDir,
  resolveSourceDir,
  assertLabWritable,
  isValidJournalId
};
