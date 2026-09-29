'use strict';
// Obrazovka „Zdraví dat". Jen vykresluje – data načítá hlavní proces,
// předzpracování dělá LabNormalize, výpočty LabHealth.

(function () {
  const N = window.LabNormalize;
  const H = window.LabHealth;
  const api = window.labAPI;
  const $ = id => document.getElementById(id);

  const state = {
    views: {},
    sourceDir: '',
    sourceOrigin: '',
    journals: [],
    journal: null,       // { id, name, updatedAt, records }
    error: null
  };

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const STATUS_LABEL = { pass: 'PROŠLO', fail: 'SELHALO', warn: 'VAROVÁNÍ', na: 'N/A' };

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
    if (value === '' || value === null || value === undefined || value === false) delete state.views[key];
    else state.views[key] = value;
    saveViews();
  }

  function applyTheme() {
    const theme = state.views.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
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
    // Bez indexu (nebo s prázdným) se ukáže všechno, ať není obrazovka prázdná.
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
    fillSelect($('setupSelect'), [{ value: '', label: 'Všechny' }, ...setups.map(s => ({ value: s, label: s })), { value: '__none__', label: '— bez setupu —' }], state.views.setupCode || '');

    $('dateFrom').value = state.views.dateFrom || '';
    $('dateTo').value = state.views.dateTo || '';

    const hasField = records.some(r => r.hasWouldSkipLiveField);
    $('includeSkipLive').checked = !!state.views.includeSkipLive;
    $('includeSkipLive').disabled = !hasField;
    $('skipLiveToggle').classList.toggle('disabled', !hasField);
    $('skipLiveHint').textContent = hasField
      ? 'Výchozí stav je bez nich: obchody vzaté v replayi jen kvůli měření nepatří do výkonu. Ve fill rate zůstávají vždy.'
      : 'Pole wouldSkipLive zatím v datech není – přepínač se zapne, až ho deník začne zapisovat.';

    $('sourcePath').textContent = state.sourceDir || '—';
    $('sourceOrigin').textContent = {
      override: 'Nastaveno ručně v Labu.',
      'journal-custom': 'Vlastní datová složka deníku (z jeho nastavení).',
      default: 'Výchozí umístění deníku.'
    }[state.sourceOrigin] || '';
    $('sourceDefault').disabled = !state.views.sourceDir;
  }

  // ------------------------------------------------------------- obsah

  function recordCells(r) {
    if (!r) return '<td colspan="5" class="muted">—</td>';
    const side = r.side ? `<span class="pill side ${esc(r.side)}">${esc(r.side)}</span>` : '';
    const kind = r.isSetupOnly ? '<span class="pill tag">SETUP</span>' : esc(r.result || '—');
    return `<td class="mono">${esc(r.date || '—')}</td><td class="mono">${esc(r.entryTime || '—')}</td><td>${side}</td>`
      + `<td class="num mono">${esc(num(r.isSetupOnly ? r.plannedEntryPrice : r.entryPrice))}</td><td>${kind}</td>`;
  }

  function itemsTable(items) {
    if (!items || !items.length) return '';
    return `<div class="table-scroll"><table class="items"><thead><tr><th>Datum</th><th>Vstup</th><th>Směr</th><th class="num">Cena</th><th>Výsledek</th><th>Proč</th></tr></thead><tbody>`
      + items.map(i => `<tr>${recordCells(i.record)}<td>${esc(i.detail)}</td></tr>`).join('')
      + '</tbody></table></div>';
  }

  function heroCheck11(c) {
    const cls = c.status === 'warn' ? 'warn' : c.status === 'pass' ? 'pass' : '';
    const share = c.share == null ? '—' : pct(c.share);
    return `<div class="card hero ${cls}">
      <div class="hero-kicker">Nejdůležitější kontrola fáze 1 · kontrola ${c.id}</div>
      <div class="hero-head"><span class="pill ${c.status}">${STATUS_LABEL[c.status]}</span><span class="hero-title">${esc(c.title)}</span></div>
      <div class="hero-stats">
        <span>Bez pozorování: <b>${c.missing ?? 0}</b> z <b>${c.checked}</b></span>
        <span>Podíl: <b>${share}</b></span>
        <span>Práh varování: <b>více než ${Math.round(H.NO_OBSERVATION_WARN_SHARE * 100)} %</b></span>
      </div>
      ${c.message ? `<p class="hero-message">${esc(c.message)}</p>` : `<p class="hero-message muted">Počítá se z obchodů s výsledkem target a vyplněným maxFavorableTicks. Chybí = prázdné postExitFavorableTicks; 0 je platné měření („dál už nic nebylo“).</p>`}
      ${c.items.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Seznam obchodů bez pozorování (${c.items.length})</summary>${itemsTable(c.items)}</details>` : ''}
    </div>`;
  }

  function barClass(n) {
    return n >= H.USABLE_GOAL ? 'full' : n >= H.USABLE_GOAL / 2 ? 'mid' : 'low';
  }

  function sectionA(h) {
    const s = h.sample;
    const days = s.days.filter(d => d.trades > 0).length;
    const metric = (label, value, note) => `<div class="metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
    const metrics = [
      metric('Záznamů', s.total),
      metric('TRADE', s.trades),
      metric('SETUP_ONLY', s.setups, 'nikdy v P/L'),
      metric('Legacy', s.legacy, 'mimo použitelné'),
      s.hasSkipLiveField ? metric('Naživo bych nevzal', s.skipLive, h.options.includeSkipLive ? 'započítané' : 'mimo výkon') : '',
      metric('Výkonový vzorek', s.perf, 'TRADE bez legacy'),
      metric('Dnů s obchody', days, s.legacy ? 'vč. dnů jen s legacy' : '')
    ].join('');

    const rows = h.usability.map(u => {
      const w = Math.min(100, (u.n / H.USABLE_GOAL) * 100);
      const extra = u.key === 'fillRate' && u.rate != null ? ` · fill rate ${pct(u.rate)} (${u.filled} FILLED / ${u.noFill} NO_FILL)` : '';
      return `<tr><td><b>${esc(u.label)}</b><div class="muted" style="font-size:11.5px">${esc(u.needs)}${esc(extra)}</div></td>`
        + `<td class="num"><b>${u.n}</b> z ${u.m}</td>`
        + `<td class="num">${u.missing ? `chybí ${u.missing}` : '<span class="pill pass">50+</span>'}</td>`
        + `<td style="width:28%"><div class="bar"><i class="${barClass(u.n)}" style="width:${w}%"></i></div></td></tr>`
        + (u.note ? `<tr class="note-row"><td colspan="4">${esc(u.note)}</td></tr>` : '');
    }).join('');

    const dayRows = s.days.map(d => `<tr><td class="mono">${esc(d.date)}</td><td class="num">${d.trades}</td><td class="num">${d.setups}</td><td class="num">${d.noFill}</td><td class="num">${d.legacy || ''}</td></tr>`).join('');

    return `<div class="card">
      <h2><span class="letter">A</span>Přehled vzorku</h2>
      <p class="section-sub">Kolik záznamů je a kolik z nich unese kterou analýzu. „Použitelné“ = TRADE bez legacy${h.options.includeSkipLive ? '' : ' a bez obchodů „naživo bych nevzal“'}; cíl je ${H.USABLE_GOAL}.</p>
      <div class="metrics">${metrics}</div>
      <div class="two-col">
        <div class="table-scroll"><table><thead><tr><th>Analýza</th><th class="num">Použitelné</th><th class="num">Do ${H.USABLE_GOAL}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <details ${s.days.length <= 12 ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin-bottom:8px">Podle dnů (${s.days.length})</summary>
          <div class="table-scroll"><table><thead><tr><th>Datum</th><th class="num">TRADE</th><th class="num">SETUP_ONLY</th><th class="num">NO_FILL</th><th class="num">legacy</th></tr></thead><tbody>${dayRows}</tbody></table></div>
        </details>
      </div>
    </div>`;
  }

  function sectionB(h) {
    const rows = h.completeness.map(r => {
      const w = r.pct == null ? 0 : r.pct * 100;
      const cls = r.pct == null ? 'low' : r.pct >= 0.9 ? 'full' : r.pct >= 0.5 ? 'mid' : 'low';
      return `<tr class="${r.highlight ? 'hl' : ''}"><td class="mono">${esc(r.field)}${r.highlight ? ' <span class="pill tag">sledované</span>' : ''}${r.note ? `<div class="muted" style="font-size:11px;font-family:inherit">${esc(r.note)}</div>` : ''}</td>`
        + `<td class="num"><b>${pct(r.pct)}</b></td><td class="num muted">${r.filled} / ${r.total}</td>`
        + `<td style="width:40%"><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td></tr>`;
    }).join('');
    return `<div class="card">
      <h2><span class="letter">B</span>Úplnost polí</h2>
      <p class="section-sub">Výkonový vzorek, od nejhůř vyplněných. Prázdné = null, "" nebo []; 0 je vyplněná hodnota.</p>
      <div class="table-scroll"><table><thead><tr><th>Pole</th><th class="num">Vyplněno</th><th class="num">Obchodů</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  function checkExtra(c) {
    if (c.id === 12 && c.target) {
      return `<div class="hero-stats" style="margin:0 0 8px"><span>target: <b>${pct(c.target.pct)}</b> (${c.target.filled} / ${c.target.n})</span><span>stoploss: <b>${pct(c.stoploss.pct)}</b> (${c.stoploss.filled} / ${c.stoploss.n})</span>${c.diffPp != null ? `<span>rozdíl: <b>${Math.round(Math.abs(c.diffPp))} p. b.</b> (práh ${H.SELECTIVE_WARN_PP})</span>` : ''}</div>`;
    }
    if (c.id === 13 && c.stats) {
      const s = c.stats;
      return `<div class="hero-stats" style="margin:0 0 8px"><span>vyplněno <b>${pct(s.pct)}</b> (${s.filled} / ${s.total})</span><span>min <b>${num(s.min)}</b></span><span>medián <b>${num(s.median)}</b></span><span>max <b>${num(s.max)}</b> min</span><span>práh: max &gt; ${H.WINDOW_SPREAD_FACTOR} × medián</span></div>`;
    }
    return '';
  }

  function sectionC(h) {
    const list = h.checks.map(c => {
      const extra = checkExtra(c);
      const body = (c.message ? `<p class="cmsg">${esc(c.message)}</p>` : '') + extra + itemsTable(c.items)
        + (c.id === 11 ? '<p class="muted" style="font-size:12px">Podrobně nahoře na stránce.</p>' : '');
      const hasBody = !!(c.message || extra || c.items.length || c.id === 11);
      return `<details class="check${hasBody ? '' : ' nolist'}">
        <summary><span class="cid">${c.id}</span><span class="pill ${c.status}">${STATUS_LABEL[c.status]}</span><span class="ctitle">${esc(c.title)}</span><span class="csum">${esc(c.summary)}</span></summary>
        ${hasBody ? `<div class="cbody">${body}</div>` : ''}
      </details>`;
    }).join('');
    const counts = h.checks.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), {});
    const tally = ['fail', 'warn', 'pass', 'na'].filter(k => counts[k]).map(k => `<span class="pill ${k}">${STATUS_LABEL[k]} ${counts[k]}</span>`).join(' ');
    return `<div class="card">
      <h2><span class="letter">C</span>Konzistenční kontroly ${tally}</h2>
      <p class="section-sub">Kliknutím na řádek se rozbalí seznam obchodů, které kontrolu shodily. R se znaménkem = rMultiple × znaménko exitTicks (deník ukládá rMultiple bez znaménka). Ziskový = exitTicks &gt; 0.</p>
      ${list}
    </div>`;
  }

  function sectionD(h) {
    const f = h.forecast;
    const goals = f.goals.map(g => `<div class="metric"><div class="label">Do ${g.goal} použitelných</div><div class="value">${g.days == null ? '—' : g.days === 0 ? 'hotovo' : g.days + ' dnů'}</div><div class="note">${g.remaining ? `chybí ${g.remaining}` : 'splněno'}${g.days == null && g.remaining ? ' · tempo 0, nelze odhadnout' : ''}</div></div>`).join('');
    return `<div class="card">
      <h2><span class="letter">D</span>Odhad pro SL sweep</h2>
      <p class="section-sub">Tempo = použitelné pro SL sweep ÷ obchodní dny ve zvoleném rozsahu. Předpokládá, že budeš dál zapisovat stejně úplně jako dosud.</p>
      <div class="forecast">
        <div class="metric"><div class="label">Použitelné teď</div><div class="value">${f.usable}</div><div class="note">za ${f.days} ${f.days === 1 ? 'den' : f.days >= 2 && f.days <= 4 ? 'dny' : 'dnů'}</div></div>
        <div class="metric"><div class="label">Tempo</div><div class="value">${num(f.perDay)}</div><div class="note">použitelných za den</div></div>
        ${goals}
      </div>
    </div>`;
  }

  function formatUpdated(iso) {
    if (!iso) return 'neznámo';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('cs-CZ');
  }

  function render() {
    renderSidebar();
    const content = $('content');
    const errorBox = state.error ? `<div class="error">${esc(state.error)}</div>` : '';
    if (!state.journal) {
      $('subtitle').textContent = 'Sbírám použitelná data?';
      content.innerHTML = errorBox + '<div class="card empty-state">Žádný deník k zobrazení. Zkontroluj zdroj dat vlevo.</div>';
      return;
    }
    const filtered = H.filterRecords(state.journal.records, state.views);
    const h = H.computeHealth(filtered, { includeSkipLive: !!state.views.includeSkipLive });
    const filterNote = filtered.length !== state.journal.records.length ? ` · filtr: ${filtered.length} z ${state.journal.records.length} záznamů` : '';
    $('subtitle').textContent = `${state.journal.name} · export aktualizován ${formatUpdated(state.journal.updatedAt)}${filterNote} · sleduje změny`;
    const c11 = h.checks.find(c => c.id === 11);
    content.innerHTML = errorBox + heroCheck11(c11) + sectionA(h) + sectionB(h) + sectionC(h) + sectionD(h);
  }

  // ------------------------------------------------------------- události

  function bind() {
    $('journalSelect').addEventListener('change', async e => {
      setView('journalId', e.target.value);
      // Instrument a setup jiného deníku nemusí existovat.
      delete state.views.instrument; delete state.views.setupCode;
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
    $('includeSkipLive').addEventListener('change', e => { setView('includeSkipLive', e.target.checked); render(); });
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
