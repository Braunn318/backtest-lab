'use strict';
// Automatické aktualizace – čisté funkce hlavního procesu (bez Electronu, ať jdou
// testovat). Převzaté z Futures Journal PRO (repo_clone/main.js, sekce
// „Automatické aktualizace“), jen s repozitářem Labu.

// Lab se aktualizuje JEN ze svého repozitáře – nikdy z deníku.
const UPDATE_REPO = { owner: 'Braunn318', repo: 'backtest-lab' };
// Po startu Windows ještě nemusí běžet síť, proto první kontrola až za chvíli.
const UPDATE_FIRST_CHECK_MS = 30 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_NOTES_MAX = 1800;
const UPDATE_CHECK_FAILED = 'Kontrolu aktualizací se nepodařilo dokončit – GitHub neodpověděl nebo není připojení k internetu.';
const UPDATE_DOWNLOAD_FAILED = 'Stažení aktualizace se nezdařilo. Zkontroluj připojení k internetu a zkus to znovu.';
// Kód, kterým electron-updater hlásí, že poslední vydání nenese latest.yml
// (vydání Labu do 0.5.0 instalátor pro aktualizace neměla).
const UPDATE_NO_INSTALLER_CODE = 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND';

// Seznam změn je text z internetu: do okna jde jen jako prostý text a zkrácený na celé řádky.
function cleanReleaseNotes(body, max = UPDATE_NOTES_MAX) {
  const text = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastLine = cut.lastIndexOf('\n');
  return (lastLine > max / 2 ? cut.slice(0, lastLine) : cut).trimEnd() + '\n…';
}

// Testovací vydání má tag s příponou (v0.5.1-test, v0.5.1-test.2), finální jen
// číslo. Verze v instalátoru je u obou stejná X.Y.Z, pozná se to jen z tagu.
function releaseChannelFromTag(tag) {
  return /^v?\d+\.\d+\.\d+-/.test(String(tag || '')) ? 'test' : 'stable';
}

// Porovnání verzí X.Y.Z podle čísel: záporné, když a < b. Přípona se nepočítá.
function compareVersions(a, b) {
  const parts = v => String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// Vydání bez instalátoru není chyba připojení: adresa v chybě nese verzi
// posledního vydání. Jiná chyba → null.
function releaseVersionFromUpdateError(error) {
  if (!error || error.code !== UPDATE_NO_INSTALLER_CODE) return null;
  const match = /\/releases\/download\/v?(\d+\.\d+\.\d+[^/]*)\//.exec(String(error.message || ''));
  return match ? match[1] : null;
}

function updateWithoutInstallerMessage(version) {
  return `Na GitHubu je verze ${version}, ale bez instalátoru pro automatickou aktualizaci. Stáhni ji ručně ze stránky vydání: github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases`;
}

function releaseNotesUrl(tag) {
  return `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tags/${encodeURIComponent(tag)}`;
}

module.exports = {
  UPDATE_REPO, UPDATE_FIRST_CHECK_MS, UPDATE_CHECK_INTERVAL_MS, UPDATE_NOTES_MAX,
  UPDATE_CHECK_FAILED, UPDATE_DOWNLOAD_FAILED, UPDATE_NO_INSTALLER_CODE,
  cleanReleaseNotes, releaseChannelFromTag, compareVersions, releaseVersionFromUpdateError,
  updateWithoutInstallerMessage, releaseNotesUrl
};
