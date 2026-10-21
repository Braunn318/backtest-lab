'use strict';
// Sdílené pomocníky vykreslování. Jen formátování – žádné výpočty.

(function () {
  const L = window.LabLabels;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  // Prázdné zůstane prázdné (pomlčka), nikdy 0.
  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const signedNum = v => (v == null ? '—' : (v > 0 ? '+' : '') + num(v));
  const STATUS_LABEL = { pass: 'PROŠLO', fail: 'SELHALO', warn: 'VAROVÁNÍ', info: 'INFORMACE', na: 'N/A' };
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
  // „Co vyplnit“ na obrazovce Data.
  function section(screen, s, views) {
    const letter = s.letter ? `<span class="letter">${esc(s.letter)}</span>` : '';
    if (s.state === 'na') {
      return `<div class="card section section-na ${esc(s.cls || '')}" data-section="${esc(s.id)}">
        <div class="section-head">${stateIcon('na')}${letter}<span class="section-title">${esc(s.title)}</span>
          <span class="section-headline">Zatím nejde — chybí ${esc(s.missing)}</span>
          <a href="#" class="goto" data-goto="health" data-anchor="fill">Co vyplnit → Data</a></div>
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

  // ------------------------------------------------------------- $ a grafy (Diagnóza, Co kdyby)

  // Znaménko až po zaokrouhlení – jinak „−0 $".
  function usd(v, decimals = 0) {
    if (v == null || !Number.isFinite(v)) return '—';
    const f = Math.pow(10, decimals);
    const x = Math.round(v * f) / f;
    const abs = Math.abs(x).toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return (x > 0 ? '+' : x < 0 ? '−' : '') + abs + ' $';
  }
  const signClass = v => (v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '');
  const shortDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}. ${Number(m[2])}.` : (iso || '—'); };

  const hasNegOf = (series, weeks) => series.some(s => s.weeks.some(w => weeks.includes(w.week) && w.pnl < 0));

  // P/L po týdnech – sloupce (zelená / červená), hodnota nad sloupcem. series =
  // [{ label, cls, weeks: [{ week, pnl }] }]; víc řad = sloupce vedle sebe.
  function weeklyChart(series) {
    const weeks = [...new Set(series.flatMap(s => s.weeks.map(w => w.week)))].sort();
    if (!weeks.length) return '<p class="muted">Bez obchodů s P/L.</p>';
    const value = (s, w) => { const x = s.weeks.find(y => y.week === w); return x ? x.pnl : 0; };
    const all = series.flatMap(s => weeks.map(w => value(s, w)));
    const max = Math.max(1, ...all.map(Math.abs));
    const hasNeg = all.some(v => v < 0), hasPos = all.some(v => v > 0);
    // Dole místo na hodnotu záporného sloupce i na datum týdne – nepřekrývají se.
    const groupW = 22 * series.length + 26, W = Math.max(320, weeks.length * groupW), H = 190, top = 18, bottom = hasNegOf(series, weeks) ? 36 : 22;
    const span = H - top - bottom;
    const zero = top + (hasPos ? (hasNeg ? span / 2 : span) : 0);
    const scale = (hasPos && hasNeg ? span / 2 : span) / max;
    let out = `<line x1="0" y1="${zero}" x2="${W}" y2="${zero}" class="ch-zero"/>`;
    weeks.forEach((w, i) => {
      const x0 = i * groupW + 13;
      series.forEach((s, j) => {
        const v = value(s, w), h = Math.abs(v) * scale, x = x0 + j * 22;
        const y = v >= 0 ? zero - h : zero;
        out += `<rect x="${x}" y="${y.toFixed(1)}" width="18" height="${Math.max(1, h).toFixed(1)}" class="ch-bar ${v >= 0 ? 'pos' : 'neg'} ${esc(s.cls || '')}"><title>${esc(s.label)} · týden od ${esc(shortDate(w))}: ${esc(usd(v, 1))}</title></rect>`;
        const ty = v >= 0 ? y - 4 : y + h + 11;
        out += `<text x="${x + 9}" y="${ty.toFixed(1)}" class="ch-val">${esc(Math.round(v))}</text>`;
      });
      out += `<text x="${x0 + (series.length * 22 - 4) / 2}" y="${H - 6}" class="ch-lab">${esc(shortDate(w))}</text>`;
    });
    const legend = series.length > 1 ? `<div class="ch-legend">${series.map(s => `<span class="${esc(s.cls || '')}"><i class="swatch"></i>${esc(s.label)}</span>`).join('')}<span class="muted">sloupce vedle sebe v tomto pořadí</span></div>` : '';
    return `<div class="ch-scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="P/L po týdnech">${out}</svg></div>${legend}`;
  }

  // Equity v $ po dnech: series = [{ label, cls, values: [P/L dne] }] (stejné dny).
  function equityChart(series, dates) {
    const curves = series.map(s => { let c = 0; return [0, ...s.values.map(v => (c += v))]; });
    if (!dates.length) return '<p class="muted">Bez obchodů s P/L.</p>';
    const pts = curves.flat();
    const min = Math.min(0, ...pts), max = Math.max(0, ...pts), span = max - min || 1;
    const W = 720, H = 180, pad = 10;
    const x = i => (i / Math.max(1, dates.length) * (W - 2 * pad) + pad).toFixed(1);
    const y = v => (pad + (1 - (v - min) / span) * (H - 2 * pad)).toFixed(1);
    let out = `<line x1="0" y1="${y(0)}" x2="${W}" y2="${y(0)}" class="ch-zero"/>`;
    curves.forEach((c, j) => {
      out += `<polyline points="${c.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" class="ch-line ${esc(series[j].cls || '')}"><title>${esc(series[j].label)}: ${esc(usd(c[c.length - 1], 1))}</title></polyline>`;
    });
    const legend = `<div class="ch-legend">${series.map((s, j) => `<span class="${esc(s.cls || '')}"><i></i>${esc(s.label)} <b>${esc(usd(curves[j][curves[j].length - 1]))}</b></span>`).join('')}</div>`;
    // Data mimo SVG – roztažený viewBox by text deformoval.
    const axis = `<div class="ch-axis"><span>${esc(shortDate(dates[0]))}</span><span>po dnech</span><span>${esc(shortDate(dates[dates.length - 1]))}</span></div>`;
    return `<svg class="chart wide" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Equity v $">${out}</svg>${axis}${legend}`;
  }

  window.LabUI = { esc, pct, num, signedNum, czDate, shortDate, usd, signClass, STATUS_LABEL, SAMPLE_WARN, SAMPLE_GREY, recordCells, itemsTable, metric, sampleNote, levelLabel, stateIcon, section, sections, weeklyChart, equityChart };
})();
