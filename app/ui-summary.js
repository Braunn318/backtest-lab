'use strict';
// Obrazovka Souhrn a karty, které sdílí s obrazovkami v Podrobnostech
// (docs/ZADANI_LAB_SOUHRN.md §2.2–2.4). Jen vykresluje LabSummary – nic nepočítá.
//
// Karta = <div … data-card="klíč"> … <!--/card--> patička </div>. Obsah po
// značku <!--/card--> je na Souhrnu i v Podrobnostech STEJNÝ (stejná čísla
// a věta); patička s odkazem „Podrobnosti →" je jen na Souhrnu.
// Souhrn se musí vejít na 1920 × 1080 bez scrollování – žádné tabulky.

(function () {
  const SM = window.LabSummary;
  const O = window.LabOverview;
  const { esc, pct, num, stateIcon } = window.LabUI;

  const signedR = v => (v == null ? '—' : O.signedR(v));
  const usd = v => {
    if (v == null) return '—';
    const x = Math.round(v);
    return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('cs-CZ') + ' USD';
  };
  const END = '<!--/card-->';
  const naLine = missing => `<p class="sum-text">Zatím nejde — chybí ${esc(missing)}.</p>
    <a href="#" class="goto" data-goto="health" data-anchor="fill">Co vyplnit → Data</a>`;
  const footer = (screen, label = 'Podrobnosti →') => `<div class="sum-foot"><a href="#" class="goto" data-goto="${esc(screen)}">${esc(label)}</a></div>`;

  // ------------------------------------------------------------- karty

  // Jedna ze čtyř otázek: ikona stavu, jedno velké číslo, jedna věta.
  function questionCard(c, withFooter = false) {
    const big = c.state === 'na' || c.big == null ? '–' : (c.bigText || num(c.big)) + (c.unit ? ` ${c.unit}` : '');
    return `<div class="card sum-card sum-q is-${esc(c.state)}" data-card="${esc(c.key)}">
      <div class="sum-head">${stateIcon(c.state)}<span class="sum-title">${esc(c.title)}</span></div>
      <div class="sum-big">${esc(big)}</div>
      <div class="sum-label">${esc(c.bigLabel)}</div>
      ${c.state === 'na' ? naLine(c.missing) : `<p class="sum-text">${esc(c.text)}</p>`}
      ${END}${withFooter ? footer(c.screen) : ''}
    </div>`;
  }

  // Equity v R: jen tvar a koncová hodnota, bez os a legendy.
  function sparkline(values) {
    if (values.length < 2) return '<div class="sum-spark-empty muted">Křivka potřebuje aspoň dva obchody s R.</div>';
    const W = 600, Hh = 56, pad = 3;
    const pts = [0, ...values];
    const min = Math.min(...pts), max = Math.max(...pts);
    const span = max - min || 1;
    const xy = pts.map((v, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(pad + (1 - (v - min) / span) * (Hh - 2 * pad)).toFixed(1)}`).join(' ');
    const zeroY = (pad + (1 - (0 - min) / span) * (Hh - 2 * pad)).toFixed(1);
    return `<svg class="sum-spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-label="Equity v R">
      <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="sum-spark-zero"/>
      <polyline points="${xy}" class="sum-spark-line"/>
    </svg>`;
  }

  function tile(label, value, note) {
    return `<div class="sum-tile"><div class="sum-tile-label">${esc(label)}</div><div class="sum-tile-value">${esc(value)}</div>${note ? `<div class="sum-tile-note">${esc(note)}</div>` : ''}</div>`;
  }

  // Řádek 1 – výsledek celého vzorku (tatáž mechanika jako řádky Kontextu).
  function resultCard(r) {
    const avg = r.avgWinR != null || r.avgLossR != null
      ? `výhra ⌀ ${signedR(r.avgWinR)} · ztráta ⌀ ${signedR(r.avgLossR)}`
      : 'bez obchodů s R';
    return `<div class="card sum-card sum-result" data-card="result">
      <div class="sum-tiles">
        ${tile('Obchodů', String(r.n), `${r.decided} na cíli nebo SL`)}
        ${tile('Win rate', pct(r.winRate), r.winRate == null ? 'pod 3 rozhodnutými bez procent' : `z ${r.decided} rozhodnutých`)}
        ${tile('Expectancy R', signedR(r.expectancyR), `${avg} · n ${r.expectancyN}`)}
        ${tile('P/L USD', usd(r.pnl), 'target + stoploss, jako v deníku')}
      </div>
      <div class="sum-equity">${sparkline(r.equity)}<span class="sum-equity-end">${r.equityEnd == null ? '—' : signedR(r.equityEnd)}</span></div>
      ${END}
    </div>`;
  }

  // Řádek 3 – kontext: největší rozdíly. Popis rozdílu, ne pokyn.
  function contextCard(cx, withFooter = false) {
    const line = row => `<div class="sum-ctx-row">${stateIcon(row.state)}<span><b>${esc(row.label)}:</b> `
      + row.groups.map(g => `${esc(g.label)} ${esc(signedR(g.expectancyR))} <span class="muted">(n ${g.n})</span>`).join(' · ')
      + `</span>${row.state === 'weak' ? '<span class="muted sum-weak">~ předběžně</span>' : ''}</div>`;
    const body = cx.rows.length
      ? cx.rows.map(line).join('')
      : `<p class="sum-text">Kontext zatím nemá vzorek — chybí ${esc(cx.missing)}.</p>`;
    return `<div class="card sum-card sum-context${cx.rows.length ? '' : ' is-na'}" data-card="context">
      <div class="sum-head"><span class="sum-title">Kontext: největší rozdíly</span><span class="muted sum-sub">expectancy R dvou největších skupin dimenze</span></div>
      ${body}
      ${END}${withFooter ? footer('context') : ''}
    </div>`;
  }

  // Řádek 4 – data: úplnost a nejužší hrdlo.
  function dataCard(d, withFooter = false) {
    const b = d.bottleneck;
    const neck = b ? `nejužší hrdlo: <b>${esc(b.field)}</b>${b.n == null ? '' : ` (${b.n} ${esc(b.unit)})`}` : 'žádné pole dnes analýzu neblokuje';
    return `<div class="card sum-card sum-data" data-card="data">
      <span>Úplnost kontextu <b>${esc(pct(d.completePct))}</b> <span class="muted">(${d.complete} z ${d.total} obchodů bez chybějícího pole)</span></span>
      <span class="sum-dot">·</span><span>${neck}</span>
      ${END}${withFooter ? footer('health', '→ Data') : ''}
    </div>`;
  }

  // ------------------------------------------------------------- obrazovka

  function render(ctx) {
    const s = SM.computeSummary(ctx);
    const c = s.cards;
    return `<div class="sum">
      ${resultCard(s.result)}
      <div class="sum-questions">${['sl', 'tp', 'levels', 'risk'].map(k => questionCard(c[k], true)).join('')}</div>
      ${contextCard(s.context, true)}
      ${dataCard(s.data, true)}
    </div>`;
  }

  // Obrazovka Souhrn od 0.5 v navigaci není (ZADANI_LAB_PRESTAVBA §1) – render
  // zůstává jen jako složení karet; karty dál nesou obrazovky v Pokročilých.
  window.LabSummaryUI = { questionCard, resultCard, contextCard, dataCard, render };
  window.LabScreens = window.LabScreens || {};
})();
