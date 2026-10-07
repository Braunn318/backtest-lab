'use strict';
// Úvodní obrazovka „Co teď vím". Jen vykresluje LabOverview.computeOverview:
// věty z existujících výpočtů, blok „Co vyplnit při nejbližším replayi"
// a odhad, kdy se nespuštěné analýzy rozběhnou. Žádné tabulky, žádný graf,
// žádné doporučení, co obchodovat.

(function () {
  const O = window.LabOverview;
  const { esc, stateIcon } = window.LabUI;

  function rowHtml(r) {
    return `<div class="ov-row st-row-${esc(r.state)}">
      ${stateIcon(r.state)}
      <div class="ov-text">${esc(r.text)}</div>
      <div class="ov-meta">${r.state === 'na' ? '' : `<span class="ov-n">${esc(r.n)}</span>`}<a href="#" class="goto" data-goto="${esc(r.screen)}">→ ${esc(r.screenLabel)}</a></div>
    </div>`;
  }

  function fillBlock(items) {
    const list = items.length
      ? `<ol class="fill-list">${items.map(x => `<li><b>${esc(x.field)}</b> — ${esc(x.detail)}${x.hint ? `<div class="muted fill-hint">(${esc(x.hint)})</div>` : ''}</li>`).join('')}</ol>`
      : '<p class="muted">Žádné pole dnes žádnou analýzu neblokuje.</p>';
    return `<div class="card" id="fill">
      <h2>Co vyplnit při nejbližším replayi</h2>
      <p class="section-sub">Jen pole, která dnes blokují nějakou analýzu, od nejužšího hrdla. Odvozuje se z dat – co vyplníš, samo zmizí.</p>
      ${list}
    </div>`;
  }

  function etaBlock(lines) {
    const list = lines.length
      ? `<ul class="eta-list">${lines.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>`
      : '<p class="muted">Všechny analýzy běží.</p>';
    return `<div class="card">
      <h2>Kdy to bude</h2>
      <p class="section-sub">Za každou analýzu, která dnes neběží. Obchody: prognóza ze Zdraví dat (cíl 50 použitelných, tempo = použitelné ÷ obchodní dny ve výběru) – předběžný výsledek se ukáže dřív, od 10. Denní stop: počet chybějících dnů.</p>
      ${list}
    </div>`;
  }

  function render(ctx) {
    const ov = O.computeOverview(ctx);
    const legend = ['ok', 'weak', 'na'].map(s => `${stateIcon(s)} ${esc(O.STATE_LABEL[s])}`).join('<span class="ov-sep"></span>');
    return `<div class="card overview">
        <div class="ov-legend muted">${legend}</div>
        ${ov.rows.map(rowHtml).join('')}
      </div>
      ${fillBlock(ov.fill)}
      ${etaBlock(ov.eta)}`;
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.overview = { title: 'Co teď vím', question: 'Co se z dnešních dat ví a jak moc', render };
})();
