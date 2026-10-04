'use strict';
// Kostra okna: stav, postranní panel, navigace mezi obrazovkami a hlavička
// „který deník, kolik záznamů, jaký rozsah dat" (zadání fáze 2 §0.4).
// Data načítá hlavní proces, předzpracování dělá LabNormalize, výpočty
// LabHealth / LabSlTp / LabStrength / LabSequence, vykreslení obrazovky LabScreens.*.

(function () {
  const N = window.LabNormalize;
  const H = window.LabHealth;
  const UI = window.LabUI;
  const { esc, czDate } = UI;
  const api = window.labAPI;
  const $ = id => document.getElementById(id);
  const SCREENS = ['health', 'sltp', 'levels', 'risk'];

  const state = {
    views: {},
    sourceDir: '',
    sourceOrigin: '',
    journals: [],
    journal: null,       // { id, name, updatedAt, records }
    error: null
  };

  // ------------------------------------------------------------- pohledy

  let saveTimer = null;
  function saveViews() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await api.saveViews(state.views);
      if (res && res.ok) state.views = res.views;
    }, 250);
  }
  function setView(key, value) {
    if (value === '' || value === null || value === undefined || value === false || Number.isNaN(value)) delete state.views[key];
    else state.views[key] = value;
    saveViews();
  }

  function applyTheme() {
    const theme = state.views.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
  }

  function currentScreen() {
    return SCREENS.includes(state.views.screen) ? state.views.screen : 'health';
  }

  // ------------------------------------------------------------- načtení

  async function loadState() {
    const s = await api.getState();
    state.views = s.views || {};
    state.sourceDir = s.sourceDir;
    state.sourceOrigin = s.sourceOrigin;
    applyTheme();
  }

  async function loadJournals() {
    const res = await api.listJournals();
    state.error = null;
    if (!res || !res.ok) {
      state.journals = [];
      state.error = (res && res.error) || 'Seznam deníků nejde načíst.';
      if (res && res.dir) state.sourceDir = res.dir;
      return;
    }
    state.sourceDir = res.dir;
    state.sourceOrigin = res.origin;
    state.journals = res.journals;
  }

  function visibleJournals() {
    const all = state.journals;
    const shown = state.views.showOutsideIndex ? all : all.filter(j => j.inIndex);
    return shown.length ? shown : all;
  }

  function pickJournalId() {
    const list = visibleJournals();
    const wanted = state.views.journalId;
    if (wanted && list.some(j => j.id === wanted)) return wanted;
    return list.length ? list[0].id : null;
  }

  async function loadJournal() {
    const id = pickJournalId();
    if (!id) { state.journal = null; return; }
    const res = await api.readJournal(id);
    if (!res || !res.ok) {
      state.journal = null;
      state.error = `Deník ${id} nejde přečíst: ${(res && res.error) || 'neznámá chyba'}`;
      return;
    }
    const meta = state.journals.find(j => j.id === id) || { name: id, inIndex: false };
    const data = N.normalizeExport(res.json);
    state.journal = { id, name: meta.name, inIndex: meta.inIndex, updatedAt: data.updatedAt, records: data.records };
  }

  async function reloadAll() {
    await loadJournals();
    await loadJournal();
    render();
  }

  // ------------------------------------------------------------- postranní panel

  function fillSelect(el, options, value) {
    el.innerHTML = options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    el.value = options.some(o => o.value === value) ? value : (options[0] ? options[0].value : '');
  }

  function renderSidebar() {
    const screen = currentScreen();
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));

    const journals = visibleJournals();
    fillSelect($('journalSelect'),
      journals.map(j => ({ value: j.id, label: j.inIndex ? j.name : `${j.name} (mimo index)` })),
      state.journal ? state.journal.id : '');
    $('journalSelect').disabled = !journals.length;
    $('showOutsideIndex').checked = !!state.views.showOutsideIndex;

    const records = state.journal ? state.journal.records : [];
    const instruments = [...new Set(records.map(r => r.instrument).filter(Boolean))].sort();
    fillSelect($('instrumentSelect'), [{ value: '', label: 'Všechny' }, ...instruments.map(i => ({ value: i, label: i }))], state.views.instrument || '');
    const setups = [...new Set(records.map(r => r.setupCode).filter(Boolean))].sort();
    const noSetup = records.filter(r => r.isTrade && !r.setupCode).length;
    fillSelect($('setupSelect'), [
      { value: '', label: 'Všechny' },
      ...setups.map(s => ({ value: s, label: window.LabLabels.labelOf('SETUP', s) })),
      { value: '__none__', label: `— bez setupu (${noSetup}) —` }
    ], state.views.setupCode || '');

    $('dateFrom').value = state.views.dateFrom || '';
    $('dateTo').value = state.views.dateTo || '';

    const hasField = records.some(r => r.hasWouldSkipLiveField);
    $('includeSkipLive').checked = !!state.views.includeSkipLive;
    $('includeSkipLive').disabled = !hasField;
    $('skipLiveToggle').classList.toggle('disabled', !hasField);
    $('skipLiveHint').textContent = hasField
      ? 'Jako v deníku: ve výchozím stavu mimo výkon, ve fill rate zůstávají vždy.'
      : 'Pole wouldSkipLive v datech není.';

    // Hypotetické výsledky (deník 4.7.3) – každá skupina svůj přepínač jako v deníku.
    // Počty z celého deníku bez filtrů pohledu, legacy se nepočítá (do výkonu nevstupuje).
    const hypoCount = group => records.filter(r => !r.isLegacy && r.hypotheticalGroup === group).length;
    const hypo = { noFill: hypoCount('noFill'), skipped: hypoCount('skipped') };
    for (const [group, key] of [['noFill', 'includeNoFill'], ['skipped', 'includeSkipped']]) {
      $(key).checked = !!state.views[key];
      $(key).disabled = !hypo[group];
      $(group + 'Toggle').classList.toggle('disabled', !hypo[group]);
      $(group + 'Label').textContent = (group === 'noFill' ? 'Včetně no fill obchodů' : 'Včetně vědomě vynechaných') + ` (${hypo[group]})`;
    }
    $('hypotheticalHint').textContent = hypo.noFill || hypo.skipped
      ? 'Hypotetický výsledek („co by to udělalo“), ne exekuce – jako v deníku ve výchozím stavu mimo výkon. No fill zůstávají ve fill rate vždy.'
      : 'V deníku nejsou žádné no fill ani vědomě vynechané obchody vyplněné jako obchod.';

    $('levelTolerance').value = state.views.levelTolerance != null ? state.views.levelTolerance : window.LabStrength.DEFAULT_TOLERANCE;
    $('sweepTargetR').value = state.views.sweepTargetR != null ? state.views.sweepTargetR : 1;
    $('settingTolerance').style.display = screen === 'levels' ? '' : 'none';
    $('settingTargetR').style.display = screen === 'sltp' ? '' : 'none';

    $('sourcePath').textContent = state.sourceDir || '—';
    $('sourceOrigin').textContent = {
      override: 'Nastaveno ručně v Labu.',
      'journal-custom': 'Vlastní datová složka deníku (z jeho nastavení).',
      default: 'Výchozí umístění deníku.'
    }[state.sourceOrigin] || '';
    $('sourceDefault').disabled = !state.views.sourceDir;
  }

  // ------------------------------------------------------------- hlavička

  function formatUpdated(iso) {
    if (!iso) return 'neznámo';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('cs-CZ');
  }

  // Vždy: který deník, kolik záznamů a jaký rozsah dat se počítá.
  // Obrazovka, která počítá jinou množinu než výkonový vzorek (Denní risk
  // bere i legacy obchody), ji vrátí ze screen.scope(ctx) → { n, note }.
  function headerStrip(filtered, sample, scope) {
    const j = state.journal;
    const range = sample.range ? `${czDate(sample.range.from)} – ${czDate(sample.range.to)}` : 'bez dat';
    const filtersOn = filtered.length !== j.records.length;
    const group = (n, label, on) => (n ? ` · ${n} ${label} ${on ? 'započítáno' : 'mimo výkon'}` : '');
    const skip = group(sample.skipLive, '„naživo bych nevzal“', state.views.includeSkipLive)
      + group(sample.noFill, 'no fill (hypotetické)', state.views.includeNoFill)
      + group(sample.skipped, 'vědomě vynechaných (hypotetické)', state.views.includeSkipped);
    return `<div class="scope">
      <div><span class="scope-label">Deník</span><b>${esc(j.name)}</b>${j.inIndex ? '' : ' <span class="pill warn">mimo index</span>'}</div>
      <div><span class="scope-label">Záznamů</span><b>${filtered.length}</b> <span class="muted">(${sample.trades} obchodů, ${sample.setups} setupů${filtersOn ? ` · filtr z ${j.records.length}` : ''})</span></div>
      <div><span class="scope-label">Rozsah dat</span><b>${esc(range)}</b></div>
      <div><span class="scope-label">Počítá se</span>${scope
        ? `<b>${scope.n}</b> <span class="muted">${esc(scope.note)}</span>`
        : `<b>${sample.perf}</b> <span class="muted">obchodů${esc(skip)}</span>`}</div>
      <div class="muted scope-updated">export ${esc(formatUpdated(j.updatedAt))} · sleduje změny</div>
    </div>`;
  }

  // ------------------------------------------------------------- obsah

  function render() {
    renderSidebar();
    const screen = window.LabScreens[currentScreen()];
    $('screenTitle').textContent = screen.title;
    $('screenQuestion').textContent = screen.question;
    const content = $('content');
    const errorBox = state.error ? `<div class="error">${esc(state.error)}</div>` : '';
    if (!state.journal) {
      content.innerHTML = errorBox + '<div class="card empty-state">Žádný deník k zobrazení. Zkontroluj zdroj dat vlevo.</div>';
      return;
    }
    const filtered = H.filterRecords(state.journal.records, state.views);
    const options = H.includeOf(state.views);
    const health = H.computeHealth(filtered, options);
    const perf = H.partition(filtered, options).perf;
    const ctx = { records: filtered, perf, health, views: state.views, options };
    let body, scope = null;
    try {
      body = screen.render(ctx);
      if (screen.scope) scope = screen.scope(ctx);
    } catch (err) {
      body = `<div class="error">Obrazovku nejde vykreslit: ${esc(err && err.message)}</div>`;
    }
    content.innerHTML = errorBox + headerStrip(filtered, health.sample, scope) + body;
  }

  // ------------------------------------------------------------- události

  function bind() {
    document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => {
      setView('screen', b.dataset.screen);
      render();
      window.scrollTo(0, 0);
    }));
    $('journalSelect').addEventListener('change', async e => {
      setView('journalId', e.target.value);
      // Jednotka R a velikost pozice patří k deníku – u jiného by byly nesmysl.
      for (const key of ['instrument', 'setupCode', 'riskUnitUSD', 'riskPosition']) delete state.views[key];
      await loadJournal(); render();
    });
    $('showOutsideIndex').addEventListener('change', async e => {
      setView('showOutsideIndex', e.target.checked);
      await loadJournal(); render();
    });
    $('dateFrom').addEventListener('change', e => { setView('dateFrom', e.target.value); render(); });
    $('dateTo').addEventListener('change', e => { setView('dateTo', e.target.value); render(); });
    $('dateReset').addEventListener('click', () => { setView('dateFrom', ''); setView('dateTo', ''); render(); });
    $('instrumentSelect').addEventListener('change', e => { setView('instrument', e.target.value); render(); });
    $('setupSelect').addEventListener('change', e => { setView('setupCode', e.target.value); render(); });
    for (const key of ['includeSkipLive', 'includeNoFill', 'includeSkipped']) {
      $(key).addEventListener('change', e => { setView(key, e.target.checked); render(); });
    }
    $('levelTolerance').addEventListener('change', e => {
      const v = Number(e.target.value);
      setView('levelTolerance', Number.isFinite(v) && v >= 0 && v <= 20 ? v : undefined); render();
    });
    $('sweepTargetR').addEventListener('change', e => {
      const v = Number(e.target.value);
      setView('sweepTargetR', Number.isFinite(v) && v >= 0.25 && v <= 10 ? v : undefined); render();
    });
    // Číselná pole uvnitř obrazovky (data-view="klíč"): prázdné = vypnuto.
    // Rozsah hlídá i hlavní proces při ukládání.
    $('content').addEventListener('change', e => {
      const key = e.target.dataset && e.target.dataset.view;
      if (!key) return;
      const v = e.target.value.trim() === '' ? NaN : Number(e.target.value.replace(',', '.'));
      setView(key, Number.isFinite(v) && v > 0 ? v : undefined);
      render();
    });
    $('themeToggle').addEventListener('click', () => {
      setView('theme', document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      applyTheme();
    });
    $('reload').addEventListener('click', reloadAll);
    $('sourceChoose').addEventListener('click', async () => {
      const dir = await api.chooseSourceDir();
      if (!dir) return;
      state.views.sourceDir = dir;
      const res = await api.saveViews(state.views);
      if (res && res.ok) state.views = res.views;
      else state.error = (res && res.error) || 'Cestu nejde uložit.';
      await reloadAll();
    });
    $('sourceDefault').addEventListener('click', async () => {
      delete state.views.sourceDir;
      const res = await api.saveViews(state.views);
      if (res && res.ok) state.views = res.views;
      await reloadAll();
    });
    api.onSourceChanged(async () => {
      const y = window.scrollY;
      await reloadAll();
      window.scrollTo(0, y);
    });
  }

  async function init() {
    bind();
    await loadState();
    await reloadAll();
  }

  init().catch(err => {
    $('content').innerHTML = `<div class="error">Chyba při startu: ${esc(err && err.message)}</div>`;
  });
})();
