'use strict';
// Automatické aktualizace – texty a rozhodnutí okna (čisté funkce, převzaté
// z Futures Journal PRO, app/index.html sekce „Automatické aktualizace“).
// Stav drží hlavní proces; tady se jen rozhoduje, co ukázat a kdy nabídnout.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabUpdates = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const TEST_WARNING = 'Jedná se o testovací pre-release verze, které můžou obsahovat chyby a můžou být nestabilní. Používej na vlastní riziko.';

  // Testovací a finální vydání nesou stejné číslo – odložená testovací nabídka
  // nesmí umlčet pozdější nabídku finální verze téhož čísla.
  function updateOfferKey(state) {
    return (state && state.channel === 'test' ? 'test:' : '') + String(state && state.version != null ? state.version : '');
  }

  function shouldOfferUpdate(state, postponedKey, requested) {
    if (!state || state.status !== 'available' || !state.version) return false;
    return !!requested || String(postponedKey == null ? '' : postponedKey) !== updateOfferKey(state);
  }

  function updateStatusText(state) {
    if (!state) return 'Dostupné jen v desktopové aplikaci.';
    const head = `Nainstalovaná verze: ${state.currentVersion || 'neznámá'}.`;
    const test = state.channel === 'test';
    switch (state.status) {
      case 'unsupported': return head + ' Aktualizace fungují jen v nainstalované aplikaci, ne při spuštění ze zdrojových souborů.';
      case 'checking': return head + ' Zjišťuji, jestli vyšla nová verze…';
      case 'none': return head + ' Máš aktuální verzi.';
      case 'available': return head + ` Dostupná je ${test ? 'testovací verze' : 'verze'} ${state.version}.` + (state.error ? ' ' + state.error : '');
      case 'downloading': return head + ` Stahuji ${test ? 'testovací verzi' : 'verzi'} ${state.version}: ${state.percent || 0} %`;
      case 'downloaded': return head + ` ${test ? 'Testovací verze' : 'Verze'} ${state.version} je stažená a připravená k instalaci.`;
      case 'error': return head + ' ' + (state.error || 'Kontrolu aktualizací se nepodařilo dokončit.');
      default: return head;
    }
  }

  // Seznam změn je text z GitHubu – okno ho vkládá přes textContent, nikdy jako HTML.
  function updateOfferMessage(state) {
    const test = state.channel === 'test';
    const lines = [`Je dostupná ${test ? 'testovací' : 'nová'} verze ${state.version} (nainstalovaná je ${state.currentVersion}).`];
    if (test) lines.push('', '⚠️ ' + TEST_WARNING);
    if (state.notes) lines.push('', 'Co je nového:', state.notes);
    lines.push('', 'Aktualizace se stáhne a nainstaluje, Lab se pak sám znovu spustí. Data deníku se nemění; uložené pohledy Labu zůstávají.');
    return lines.join('\n');
  }

  function installButtonText(state) {
    if (!state || (state.status !== 'available' && state.status !== 'downloaded')) return null;
    const test = state.channel === 'test';
    return state.status === 'downloaded'
      ? `Nainstalovat ${test ? 'testovací verzi' : 'verzi'} ${state.version}`
      : `Aktualizovat na ${test ? 'testovací verzi ' : ''}${state.version}`;
  }

  return { TEST_WARNING, updateOfferKey, shouldOfferUpdate, updateStatusText, updateOfferMessage, installButtonText };
}));
