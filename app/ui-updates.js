'use strict';
// Automatické aktualizace v okně – stejný průběh jako ve Futures Journal PRO:
// hlavní proces najde verzi, okno ji nabídne (dialog s „Co je nového“),
// „Později“ platí do konce běhu, ruční kontrola v postranním panelu vždy odpoví,
// testovací verze jen tlačítkem po zapnutí volby (pamatuje se ve views.json).
// Lab nemá přihlášení ani otevřené pozice – nabídka se ukáže po prvním vykreslení.

(function () {
  const U = window.LabUpdates;
  const api = window.labAPI;
  const $ = id => document.getElementById(id);

  let state = null;
  let views = null;            // { get(), set(key, value) } z ui.js
  let offerReady = false;
  let offerOpen = false;
  let postponedKey = null;     // „Později“ – jen do konce běhu
  let manualCheck = false;     // false | 'stable' | 'test'
  let installing = false;

  function toast(text) {
    const el = $('updateToast');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  function testChannel() {
    return !!(views && views.get().updateTestChannel);
  }

  function render() {
    if ($('updateInfo')) $('updateInfo').textContent = U.updateStatusText(state);
    const label = U.installButtonText(state);
    const btn = $('installUpdate');
    if (btn) { btn.hidden = !label; if (label) btn.textContent = label; }
    const busy = !!state && (state.status === 'checking' || state.status === 'downloading');
    if ($('checkUpdates')) $('checkUpdates').disabled = busy || !state || state.status === 'unsupported';
    if ($('checkTestUpdates')) $('checkTestUpdates').disabled = busy || !state || state.status === 'unsupported';
    if ($('updateTestChannel')) $('updateTestChannel').checked = testChannel();
    if ($('updateTestBox')) $('updateTestBox').hidden = !testChannel();
    if ($('updateTestWarning')) $('updateTestWarning').textContent = '⚠️ ' + U.TEST_WARNING;
  }

  // Modální dialog nabídky. Text jde přes textContent (seznam změn je z internetu).
  function confirmOffer(title, message) {
    const dlg = $('updateDialog');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(message));
    $('updateDialogTitle').textContent = title;
    $('updateDialogText').textContent = message;
    return new Promise(resolve => {
      const done = ok => { dlg.close(); $('updateDialogOk').onclick = $('updateDialogCancel').onclick = null; resolve(ok); };
      $('updateDialogOk').onclick = () => done(true);
      $('updateDialogCancel').onclick = () => done(false);
      dlg.oncancel = e => { e.preventDefault(); done(false); };
      dlg.showModal();
    });
  }

  async function startUpdate() {
    if (installing) return;
    installing = true;
    try {
      // Kontrola na pozadí může stav na chvíli přepnout na „zjišťuji“ – počkat.
      for (let i = 0; i < 40 && state && state.status === 'checking'; i++) {
        await new Promise(r => setTimeout(r, 500));
        state = await api.getUpdateState();
      }
      render();
      if (state && state.status === 'available') {
        toast('Stahuji aktualizaci…');
        const r = await api.downloadUpdate();
        if (!r || !r.ok) { toast((r && r.error) || 'Stažení aktualizace se nezdařilo.'); return; }
        state = await api.getUpdateState();
        render();
      }
      if (!state || state.status !== 'downloaded') { toast('Aktualizaci teď nejde spustit. ' + U.updateStatusText(state)); return; }
      toast('Aktualizace je stažená, Lab se za chvíli restartuje…');
      await new Promise(r => setTimeout(r, 1200));
      const r = await api.installUpdate();
      if (!r || !r.ok) toast((r && r.error) || 'Instalaci se nepodařilo spustit.');
    } catch (e) {
      toast('Aktualizace se nezdařila: ' + (e && e.message || e));
    } finally {
      installing = false;
    }
  }

  async function maybeOffer(requested = false) {
    if (!offerReady || offerOpen || installing || !U.shouldOfferUpdate(state, postponedKey, requested)) return;
    offerOpen = true;
    try {
      const s = state;
      const ok = await confirmOffer(s.channel === 'test' ? 'Testovací verze Labu' : 'Aktualizace Labu', U.updateOfferMessage(s));
      if (!ok) { postponedKey = U.updateOfferKey(s); return; }
      await startUpdate();
    } finally {
      offerOpen = false;
    }
  }

  // Ruční kontrola vždy odpoví (aktuální verze / nabídka); automatická je tichá.
  function settleManual() {
    if (!manualCheck || !state || state.status === 'checking') return;
    const test = manualCheck === 'test';
    manualCheck = false;
    if (state.status === 'none') toast(test ? `Žádná novější testovací verze není (máš ${state.currentVersion}).` : `Máš aktuální verzi (${state.currentVersion}).`);
    else if (state.status === 'available') maybeOffer(true);
  }

  function apply(next) {
    state = next || null;
    render();
    if (!state) return;
    if (installing && state.status === 'downloading') toast(`Stahuji aktualizaci… ${state.percent || 0} %`);
    if (manualCheck) { settleManual(); return; }
    maybeOffer(false);
  }

  async function runManual(test) {
    if (!api || !api.checkForUpdates) return;
    if (state && state.status === 'downloaded') { startUpdate(); return; }
    toast('');
    manualCheck = test ? 'test' : 'stable';
    const r = await api.checkForUpdates({ test: !!test });
    if (r && r.unsupported) { manualCheck = false; toast(U.updateStatusText(state)); return; }
    if (!r || !r.ok) { manualCheck = false; toast((r && r.error) || 'Kontrolu aktualizací se nepodařilo dokončit.'); return; }
    settleManual();
  }

  // ui.js volá po načtení pohledů; ready() po prvním vykreslení obrazovky.
  function init(viewsApi) {
    views = viewsApi;
    if ($('checkUpdates')) $('checkUpdates').onclick = () => runManual(false);
    if ($('checkTestUpdates')) $('checkTestUpdates').onclick = () => runManual(true);
    if ($('installUpdate')) $('installUpdate').onclick = () => (state && state.status === 'downloaded' ? startUpdate() : maybeOffer(true));
    if ($('updateTestChannel')) $('updateTestChannel').onchange = e => {
      views.set('updateTestChannel', !!e.target.checked);
      render();
      toast(e.target.checked ? 'Testovací verze jsou povolené. Hledají se jen tlačítkem „Zkontrolovat aktualizace Test verze“.' : 'Testovací verze jsou vypnuté.');
    };
    if (api && api.getUpdateState) {
      api.onUpdateState(apply);
      api.getUpdateState().then(apply).catch(() => render());
    } else render();
  }

  function ready() {
    if (offerReady) return;
    offerReady = true;
    setTimeout(() => maybeOffer(false), 1500);
  }

  window.LabUpdatesUI = { init, ready, render };
})();
