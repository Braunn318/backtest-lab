'use strict';
// Sdílené pomocníky vykreslování. Jen formátování – žádné výpočty.

(function () {
  const L = window.LabLabels;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  // Prázdné zůstane prázdné (pomlčka), nikdy 0.
  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const signedNum = v => (v == null ? '—' : (v > 0 ? '+' : '') + num(v));
  const STATUS_LABEL = { pass: 'PROŠLO', fail: 'SELHALO', warn: 'VAROVÁNÍ', na: 'N/A' };
  const SAMPLE_WARN = 30;
  const SAMPLE_GREY = 10;

  function czDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : (iso || '—');
  }

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

  function metric(label, value, note, cls = '') {
    return `<div class="metric ${cls}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
  }

  // Povinné varování o vzorku (§5.5 specu): N < 30 ikona, N < 10 šedě.
  // SL sweep a mřížka varují pod 50.
  function sampleNote(n, warnAt = SAMPLE_WARN) {
    if (n < SAMPLE_GREY) return `<span class="sample bad" title="Vzorek pod ${SAMPLE_GREY} – z toho se nedá nic vyvodit.">⚠ N = ${n}: z tak malého vzorku se nedá nic vyvodit</span>`;
    if (n < warnAt) return `<span class="sample warn" title="Vzorek pod ${warnAt}.">⚠ N = ${n}: malý vzorek (pod ${warnAt}), ber jako orientační</span>`;
    return `<span class="sample ok">N = ${n}</span>`;
  }

  function levelLabel(key) {
    return L.labelOf('ENTRY_LEVEL', key);
  }

  // ------------------------------------------------------------- sekce obrazovek

  const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STATE_TITLE = { ok: 'ví se – vzorek projde prahem analýzy', weak: 'zatím slabé – spočítatelné, ale pod prahem', na: 'nejde – chybí vstup' };

  function stateIcon(state) {
    return `<span class="st st-${esc(state)}" title="${esc(STATE_TITLE[state])}">${esc(window.LabOverview.ICON[state])}</span>`;
  }

  // Jedna sekce obrazovky: s = { id, title, letter?, state, headline (HTML),
  // body (HTML), missing (text), cls? }. Výchozí stav sbaleno; hlavička nese
  // hlavní číslo nebo verdikt, ať se sbalením nic neztratí. Analýza, která
  // nemůže běžet, se nekreslí – jen jeden řádek, co chybí, a odkaz na blok
  // „Co vyplnit“ na úvodní obrazovce.
  function section(screen, s, views) {
    const letter = s.letter ? `<span class="letter">${esc(s.letter)}</span>` : '';
    if (s.state === 'na') {
      return `<div class="card section section-na ${esc(s.cls || '')}" data-section="${esc(s.id)}">
        <div class="section-head">${stateIcon('na')}${letter}<span class="section-title">${esc(s.title)}</span>
          <span class="section-headline">Zatím nejde — chybí ${esc(s.missing)}</span>
          <a href="#" class="goto" data-goto="overview" data-anchor="fill">Co vyplnit →</a></div>
      </div>`;
    }
    const open = window.LabViews.isOpen(views, screen, s.id);
    return `<details class="card section ${esc(s.cls || '')}" data-section="${esc(s.id)}" data-screen="${esc(screen)}"${open ? ' open' : ''}>
      <summary>${CHEV}${stateIcon(s.state)}${letter}<span class="section-title">${esc(s.title)}</span><span class="section-headline">${s.headline || ''}</span></summary>
      <div class="section-body">${s.body}</div>
    </details>`;
  }

  // Pořadí: nejdřív co má vzorek, pak slabé, pak nespuštěné.
  function sections(screen, list, views) {
    return window.LabOverview.byState(list.filter(Boolean)).map(s => section(screen, s, views)).join('');
  }

  window.LabUI = { esc, pct, num, signedNum, czDate, STATUS_LABEL, SAMPLE_WARN, SAMPLE_GREY, recordCells, itemsTable, metric, sampleNote, levelLabel, stateIcon, section, sections };
})();
