'use strict';
// Backtest Lab – hlavní proces.
//
// READ-ONLY vůči deníku: zdroj dat (ai-export) se jen čte (fs.readFileSync,
// fs.readdirSync, fs.statSync, fs.watch). Jediná funkce, která zapisuje, je
// writeViews() – uživatelské pohledy ve vlastní složce Labu, hlídané přes
// assertLabWritable. tests/readonly.test.js to kontroluje nad zdrojákem.

const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const P = require('./lib/paths');
const U = require('./lib/updates');

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
// Co se o pohledu ukládá a jak se to čistí: app/views.js (sdílí ho i okno).
// Nic o obchodech.
const { sanitizeViews } = require('./app/views.js');

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

// ------------------------------------------------------------- automatické aktualizace
//
// Stejně jako Futures Journal PRO: Lab si na GitHubu (jen repozitář backtest-lab)
// sám zjistí novou FINÁLNÍ verzi (release „Latest“) a nabídne ji. Bez potvrzení se
// nic nestahuje ani neinstaluje. Testovací pre-release se hledá jen ručně – tlačítko,
// které si uživatel musí zapnout. electron-updater si instalátor stáhne do své
// cache (%LOCALAPPDATA%acktest-lab-updater) – do dat deníku nesahá nic.

let autoUpdater = null;
let updateNoInstallerLogged = false;
// status: unsupported (spuštěno ze zdrojů) | idle | checking | none | available |
// downloading | downloaded | error; channel: 'stable' | 'test' (co se našlo)
let updateState = { status: 'unsupported', currentVersion: app.getVersion(), version: null, percent: 0, error: null, notes: '', channel: 'stable' };

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', updateState);
}

async function fetchReleaseNotes(tag) {
  try {
    const response = await net.fetch(U.releaseNotesUrl(tag), { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return '';
    return U.cleanReleaseNotes((await response.json())?.body);
  } catch (error) {
    console.error('Auto-update release notes', error && error.message);
    return '';
  }
}

async function onUpdateAvailable(info) {
  const version = String(info?.version || '');
  // Kontrola testovacích verzí bere nejnovější vydání vůbec – kanál říká, co se našlo.
  const tag = String(info?.tag || `v${version}`);
  const notes = await fetchReleaseNotes(tag);
  setUpdateState({ status: 'available', version, percent: 0, error: null, notes, channel: U.releaseChannelFromTag(tag) });
}

function initAutoUpdate() {
  // Ze zdrojových souborů (npm start) není co aktualizovat. Chyba aktualizací
  // nesmí nikdy zabránit startu.
  if (!app.isPackaged || process.platform !== 'win32') return false;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    console.error('Auto-update init', error && error.message);
    return false;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  autoUpdater.on('error', error => {
    if (U.releaseVersionFromUpdateError(error)) return;
    console.error('Auto-update', String(error?.message || error).split(/\r?\n/)[0].slice(0, 300));
  });
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', info => onUpdateAvailable(info));
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'none', version: null, percent: 0, notes: '', channel: 'stable' }));
  autoUpdater.on('download-progress', progress => setUpdateState({ status: 'downloading', percent: Math.round(progress?.percent || 0) }));
  autoUpdater.on('update-downloaded', () => setUpdateState({ status: 'downloaded', percent: 100, error: null }));
  setUpdateState({ status: 'idle' });
  setTimeout(() => checkForUpdates(false), U.UPDATE_FIRST_CHECK_MS);
  setInterval(() => checkForUpdates(false), U.UPDATE_CHECK_INTERVAL_MS);
  return true;
}

// test = true: i testovací pre-release (jen ručně). Automatická kontrola jen finální.
async function checkForUpdates(manual, test = false) {
  if (!autoUpdater) return { ok: false, unsupported: true };
  if (['checking', 'downloading', 'downloaded'].includes(updateState.status)) return { ok: true };
  // Automatická kontrola nesmí přepsat testovací nabídku, kterou si uživatel vyžádal.
  if (!manual && updateState.status === 'available' && updateState.channel === 'test') return { ok: true };
  const before = updateState.status;
  try {
    autoUpdater.allowPrerelease = !!test;
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    const releaseVersion = U.releaseVersionFromUpdateError(error);
    if (releaseVersion) {
      if (!updateNoInstallerLogged) {
        updateNoInstallerLogged = true;
        console.error('Auto-update', `Vydání ${releaseVersion} nenese instalátor pro automatickou aktualizaci (nainstalovaná verze ${updateState.currentVersion}).`);
      }
      if (U.compareVersions(releaseVersion, updateState.currentVersion) <= 0) {
        setUpdateState({ status: 'none', version: null, percent: 0, error: null, notes: '', channel: 'stable' });
        return { ok: true };
      }
      const message = U.updateWithoutInstallerMessage(releaseVersion);
      setUpdateState({ status: 'error', version: null, percent: 0, error: message, notes: '', channel: 'stable' });
      return { ok: false, error: message };
    }
    // Automatická kontrola selhává tiše; ruční chybu ukáže.
    if (manual) setUpdateState({ status: 'error', error: U.UPDATE_CHECK_FAILED });
    else setUpdateState({ status: before === 'available' ? 'available' : 'idle', error: null });
    return { ok: false, error: U.UPDATE_CHECK_FAILED };
  }
}

async function downloadUpdate() {
  if (!autoUpdater || updateState.status !== 'available') return { ok: false, error: 'Žádná aktualizace ke stažení.' };
  setUpdateState({ status: 'downloading', percent: 0, error: null });
  try {
    await autoUpdater.downloadUpdate();
    if (updateState.status !== 'downloaded') setUpdateState({ status: 'downloaded', percent: 100, error: null });
    return { ok: true };
  } catch (error) {
    setUpdateState({ status: 'available', percent: 0, error: U.UPDATE_DOWNLOAD_FAILED });
    return { ok: false, error: U.UPDATE_DOWNLOAD_FAILED };
  }
}

function installUpdate() {
  if (!autoUpdater || updateState.status !== 'downloaded') return { ok: false, error: 'Aktualizace ještě není stažená.' };
  // Tichá instalace do stávající složky, po ní se Lab sám spustí.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
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
ipcMain.handle('update:getState', () => updateState);
ipcMain.handle('update:check', (_e, options) => checkForUpdates(true, !!(options && options.test)));
ipcMain.handle('update:download', () => downloadUpdate());
ipcMain.handle('update:install', () => installUpdate());
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
  initAutoUpdate();
});
app.on('window-all-closed', () => {
  if (watcher) { try { watcher.close(); } catch {} }
  app.quit();
});
