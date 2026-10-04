'use strict';
// Backtest Lab – hlavní proces.
//
// READ-ONLY vůči deníku: zdroj dat (ai-export) se jen čte (fs.readFileSync,
// fs.readdirSync, fs.statSync, fs.watch). Jediná funkce, která zapisuje, je
// writeViews() – uživatelské pohledy ve vlastní složce Labu, hlídané přes
// assertLabWritable. tests/readonly.test.js to kontroluje nad zdrojákem.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const P = require('./lib/paths');

// Vlastní userData Labu (%APPDATA%\backtest-lab) – nastavuje se před 'ready',
// aby ani cache Chromia nevznikla jinde. Kdyby vyšla stejná jako u deníku,
// aplikace se nespustí.
const APP_DATA = app.getPath('appData');
const LAB_DIR = P.labUserDataDir(APP_DATA);
const JOURNAL_DIR = P.journalUserDataDir(APP_DATA);
if (P.isInside(LAB_DIR, JOURNAL_DIR) || P.isInside(JOURNAL_DIR, LAB_DIR)) {
  throw new Error('Složka Labu se nesmí překrývat se složkou deníku.');
}
app.setPath('userData', LAB_DIR);

const VIEWS_FILE = path.join(LAB_DIR, 'views.json');
// Co se o pohledu ukládá. Nic o obchodech.
// Číselná nastavení analýz a jejich povolený rozsah. risk* = pravidlo
// simulátoru dne (prázdné = vypnuté), jednotka R, velikost pozice a účtu.
const VIEW_NUMBERS = {
  levelTolerance: [0, 20], sweepTargetR: [0.25, 10],
  riskDailyLoss: [0.1, 100], riskConsecutiveSL: [1, 50], riskDailySL: [1, 50], riskMaxTrades: [1, 100],
  riskDailyTarget: [0.1, 100], riskGiveBack: [0.1, 100],
  riskUnitUSD: [0.01, 1e6], riskPosition: [1, 1000], riskAccount: [1, 1e9]
};
const BOOL_VIEWS = new Set(['includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex']);
const VIEW_KEYS = ['journalId', 'dateFrom', 'dateTo', 'instrument', 'setupCode', 'includeSkipLive', 'includeNoFill', 'includeSkipped', 'showOutsideIndex', 'sourceDir', 'theme', 'screen', ...Object.keys(VIEW_NUMBERS)];

let mainWindow = null;
let watcher = null;
let watchTimer = null;

// ------------------------------------------------------------- pohledy

function readViews() {
  try {
    const data = JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function sanitizeViews(input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const key of VIEW_KEYS) {
    const v = src[key];
    if (v === undefined || v === null || v === '') continue;
    if (BOOL_VIEWS.has(key)) out[key] = v === true;
    else if (VIEW_NUMBERS[key]) {
      const n = Number(v);
      const [min, max] = VIEW_NUMBERS[key];
      if (Number.isFinite(n) && n >= min && n <= max) out[key] = n;
    } else out[key] = String(v).slice(0, 1000);
  }
  return out;
}

function sourceInfo(views = readViews()) {
  return P.resolveSourceDir({
    appData: APP_DATA,
    override: views.sourceDir || null,
    readFile: f => fs.readFileSync(f, 'utf8'),
    exists: d => fs.existsSync(d)
  });
}

// JEDINÝ zápis v celém Labu.
function writeViews(views) {
  const clean = sanitizeViews(views);
  const src = sourceInfo(clean).dir;
  const forbidden = [JOURNAL_DIR, src, path.dirname(src)];
  P.assertLabWritable(VIEWS_FILE, { labDir: LAB_DIR, forbidden });
  const temp = VIEWS_FILE + '.tmp';
  P.assertLabWritable(temp, { labDir: LAB_DIR, forbidden });
  fs.mkdirSync(LAB_DIR, { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), 'utf8');
  fs.renameSync(temp, VIEWS_FILE);
  return clean;
}

// ------------------------------------------------------------- zdroj dat

function listJournals() {
  const { dir, origin } = sourceInfo();
  if (!fs.existsSync(dir)) return { ok: false, dir, origin, error: 'Složka ai-exportu neexistuje. Zapni v deníku odlehčený export, nebo nastav cestu ručně.' };
  let index = [];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    index = Array.isArray(data?.journals) ? data.journals : [];
  } catch { /* bez indexu se ukážou soubory */ }
  const names = new Map(index.filter(j => P.isValidJournalId(j?.id)).map(j => [j.id, String(j.name || j.id)]));
  const journals = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const id = file.slice(0, -5);
    if (!P.isValidJournalId(id)) continue;
    const stat = fs.statSync(path.join(dir, file));
    journals.push({ id, name: names.get(id) || id, inIndex: names.has(id), mtime: stat.mtimeMs, size: stat.size });
  }
  journals.sort((a, b) => (b.inIndex - a.inIndex) || a.name.localeCompare(b.name));
  return { ok: true, dir, origin, journals };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// Deník píše atomicky (.tmp + rename), ale při přesunu složky nebo ručním
// zásahu může soubor chvíli být rozepsaný – proto pár pokusů.
async function readJournal(id) {
  if (!P.isValidJournalId(id)) return { ok: false, error: 'Neplatný identifikátor deníku.' };
  const { dir } = sourceInfo();
  const file = path.join(dir, id + '.json');
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      return { ok: true, json, mtime: fs.statSync(file).mtimeMs };
    } catch (error) {
      lastError = error;
      if (error.code === 'ENOENT') break;
      await delay(200);
    }
  }
  return { ok: false, error: lastError ? lastError.message : 'Soubor nejde přečíst.' };
}

function startWatcher() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  const { dir } = sourceInfo();
  if (!fs.existsSync(dir)) return;
  try {
    watcher = fs.watch(dir, (_event, name) => {
      if (name && String(name).endsWith('.tmp')) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('source:changed');
      }, 400);
    });
  } catch { watcher = null; }
}

// ------------------------------------------------------------- IPC

ipcMain.handle('lab:getState', () => {
  const views = readViews();
  const src = sourceInfo(views);
  return { views, sourceDir: src.dir, sourceOrigin: src.origin, labDir: LAB_DIR };
});
ipcMain.handle('source:list', () => {
  try { return listJournals(); } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('source:read', (_e, id) => readJournal(id));
ipcMain.handle('views:set', (_e, views) => {
  try {
    const before = sourceInfo().dir;
    const saved = writeViews(views);
    if (sourceInfo(saved).dir !== before) startWatcher();
    return { ok: true, views: saved };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('source:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Složka ai-exportu deníku', properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
});

// ------------------------------------------------------------- okno

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Backtest Lab',
    backgroundColor: '#07070a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  startWatcher();
});
app.on('window-all-closed', () => {
  if (watcher) { try { watcher.close(); } catch {} }
  app.quit();
});
