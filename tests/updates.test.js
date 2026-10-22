'use strict';
// Automatické aktualizace (stejně jako Futures Journal PRO): čisté funkce
// hlavního procesu (lib/updates.js) a okna (app/updates.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LU = require('../lib/updates.js');
const AU = require('../app/updates.js');
const V = require('../app/views.js');

const ROOT = path.join(__dirname, '..');

test('Lab se aktualizuje jen ze svého repozitáře, nikdy z deníku', () => {
  assert.deepEqual(LU.UPDATE_REPO, { owner: 'Braunn318', repo: 'backtest-lab' });
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pj.build.publish, [{ provider: 'github', owner: 'Braunn318', repo: 'backtest-lab' }]);
  assert.match(pj.scripts.dist, /--publish never/);
  assert.ok(pj.dependencies['electron-updater']);
  assert.match(LU.releaseNotesUrl('v0.5.1'), /repos\/Braunn318\/backtest-lab\/releases\/tags\/v0\.5\.1$/);
});

test('electron-updater se načítá jen v hlavním procesu; okno ani preload ne', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'app')).filter(x => x.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), /require\(['"]electron-updater/, f);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8'), /electron-updater/);
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(main, /require\('electron-updater'\)/);
  // Nic se nestahuje ani neinstaluje bez potvrzení.
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
  // Ze zdrojových souborů se aktualizace nespouští.
  assert.match(main, /if \(!app\.isPackaged \|\| process\.platform !== 'win32'\) return false;/);
});

test('kanál podle tagu: přípona = testovací, jen číslo = finální', () => {
  assert.equal(LU.releaseChannelFromTag('v0.5.1'), 'stable');
  assert.equal(LU.releaseChannelFromTag('v0.5.1-test'), 'test');
  assert.equal(LU.releaseChannelFromTag('v0.5.1-test.2'), 'test');
});

test('porovnání verzí a vydání bez instalátoru', () => {
  assert.equal(LU.compareVersions('0.5.0', '0.5.1'), -1);
  assert.equal(LU.compareVersions('v0.5.1-test', '0.5.1'), 0);
  assert.equal(LU.compareVersions('0.10.0', '0.9.9'), 1);
  const err = { code: LU.UPDATE_NO_INSTALLER_CODE, message: 'Cannot find latest.yml in https://github.com/Braunn318/backtest-lab/releases/download/v0.5.0/latest.yml' };
  assert.equal(LU.releaseVersionFromUpdateError(err), '0.5.0');
  assert.equal(LU.releaseVersionFromUpdateError({ code: 'ENOTFOUND', message: 'x' }), null);
  assert.match(LU.updateWithoutInstallerMessage('0.6.0'), /backtest-lab\/releases/);
});

test('seznam změn: prostý text, zkrácený na celé řádky', () => {
  assert.equal(LU.cleanReleaseNotes('a\r\nb'), 'a\nb');
  const long = Array.from({ length: 200 }, (_, i) => `- řádek ${i}`).join('\n');
  const out = LU.cleanReleaseNotes(long, 300);
  assert.ok(out.length <= 302);
  assert.ok(out.endsWith('\n…'));
});

test('nabídka: odložená verze se znovu nenabízí, finální téhož čísla jako test ano', () => {
  const s = { status: 'available', version: '0.5.1', channel: 'test', currentVersion: '0.5.0' };
  assert.equal(AU.shouldOfferUpdate(s, null, false), true);
  assert.equal(AU.shouldOfferUpdate(s, AU.updateOfferKey(s), false), false);
  assert.equal(AU.shouldOfferUpdate(s, AU.updateOfferKey(s), true), true, 'ruční vyžádání ano');
  assert.equal(AU.shouldOfferUpdate({ ...s, channel: 'stable' }, AU.updateOfferKey(s), false), true);
  assert.equal(AU.shouldOfferUpdate({ ...s, status: 'none' }, null, true), false);
});

test('texty stavu a nabídky', () => {
  const base = { currentVersion: '0.5.1', version: '0.6.0', percent: 40, channel: 'stable' };
  for (const status of ['unsupported', 'checking', 'none', 'available', 'downloading', 'downloaded', 'error', 'idle']) {
    assert.match(AU.updateStatusText({ ...base, status }), /^Nainstalovaná verze: 0\.5\.1\./, status);
  }
  assert.match(AU.updateStatusText({ ...base, status: 'downloading' }), /40 %/);
  const msg = AU.updateOfferMessage({ ...base, channel: 'test', notes: '- novinka' });
  assert.match(msg, /testovací verze 0\.6\.0/);
  assert.match(msg, /Co je nového:\n- novinka/);
  assert.ok(msg.includes(AU.TEST_WARNING));
  assert.doesNotMatch(AU.updateOfferMessage({ ...base, notes: '' }), /Co je nového|testovací/);
  assert.equal(AU.installButtonText({ ...base, status: 'none' }), null);
  assert.equal(AU.installButtonText({ ...base, status: 'available' }), 'Aktualizovat na 0.6.0');
  assert.equal(AU.installButtonText({ ...base, status: 'downloaded', channel: 'test' }), 'Nainstalovat testovací verzi 0.6.0');
});

test('volba testovacích verzí se pamatuje ve views.json a přežije změnu deníku', () => {
  assert.equal(V.sanitizeViews({ updateTestChannel: true }).updateTestChannel, true);
  assert.equal(V.sanitizeViews({}).updateTestChannel, undefined);
  assert.equal(V.forJournalChange({ updateTestChannel: true }).updateTestChannel, true);
});

test('main.js a preload.js jdou přeložit (testy hlavní proces nenačítají)', () => {
  const { execFileSync } = require('child_process');
  for (const f of ['main.js', 'preload.js', 'lib/updates.js']) execFileSync(process.execPath, ['--check', path.join(ROOT, f)]);
});
