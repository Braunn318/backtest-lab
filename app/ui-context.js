'use strict';
// Obrazovka „Kontext – v jakém kontextu obchody vycházejí?". Jen vykresluje
// LabContext.computeContext nad výkonovým vzorkem. Jedna sbalená sekce za
// skupinu dimenzí; dimenze, která nemá dvě dost velké skupiny, se nekreslí
// jako tabulka – jen řádek, co jí chybí. Žádné doporučení, co obchodovat.

(function () {
  const O = window.LabOverview;
  const SM = window.LabSummary;
  const UI = window.LabSummaryUI;
  const { esc, pct, num, sampleNote, sections, stateIcon, SAMPLE_GREY, SAMPLE_WARN } = window.LabUI;

  const rVal = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(Math.round(v * 100) / 100)) + ' R');

  function dimensionTable(d) {
    const rows = d.rows.map(r => {
      const aside = r.kind === 'aside' ? ' <span class="pill na">stranou – do porovnání nevstupuje</span>' : '';
      const win = r.winRate != null ? pct(r.winRate) : r.decided ? `${r.wins} z ${r.decided}` : '—';
      return `<tr class="${r.grey || r.kind === 'aside' ? 'grey' : ''}"><td><b>${esc(r.label)}</b>${aside}</td><td class="num"><b>${r.n}</b></td>`
        + `<td class="num">${win}</td><td class="num">${rVal(r.avgR)} <span class="muted">(${r.rCount})</span></td>`
        + `<td class="num">${rVal(r.expectancyR)} <span class="muted">(${r.expectancyN})</span></td></tr>`;
    }).join('');
    return `<div class="table-scroll"><table><thead><tr><th>${esc(d.label)}</th><th class="num">N</th><th class="num">Win %</th><th class="num">Průměr R <span class="muted">(n s R)</span></th><th class="num">Expectancy R <span class="muted">(target / SL)</span></th></tr></thead><tbody>
        ${rows}
        <tr class="grey"><td>Nevyplněno <span class="muted">(nevstupuje)</span></td><td class="num">${d.unknown}</td><td colspan="3" class="muted">—</td></tr>
      </tbody></table></div>`;
  }

  function dimensionBlock(d) {
    if (d.state === 'na') {
      return `<div class="dim dim-na">${stateIcon('na')}<span><b>${esc(d.label)}</b> <span class="muted">zatím nejde — chybí ${esc(d.missing)}</span></span></div>`;
    }
    return `<div class="dim">
      <div class="dim-head">${stateIcon(d.state)}<b>${esc(d.label)}</b> <span class="muted">${esc(d.headline)}</span></div>
      ${dimensionTable(d)}
      <p>${sampleNote(d.second)} <span class="muted">(druhá největší skupina)</span></p>
    </div>`;
  }

  function groupSection(group) {
    return {
      id: 'ctx-' + group.key, title: group.label, state: group.state, missing: group.missing, headline: esc(group.headline),
      body: O.byState(group.dimensions).map(dimensionBlock).join('')
    };
  }

  function render(ctx) {
    const res = O.analyses(ctx).context;
    const running = res.dimensions.filter(d => d.state !== 'na').length;
    // Nahoře tatáž karta jako v Souhrnu (největší rozdíly) a výsledek celého
    // vzorku stejnou mechanikou jako řádky tabulek – základ pro porovnání skupin.
    const cards = UI.contextCard(SM.contextDiffs(res)) + UI.resultCard(SM.resultOf(ctx.perf));
    const top = `<div class="card slim">
      <div class="hero-stats" style="margin:0">
        <span>Obchodů ve výkonovém vzorku: <b>${res.n}</b></span>
        <span>Dimenzí se vzorkem: <b>${running}</b> z ${res.dimensions.length}</span>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Rozpad výsledků podle jedné dimenze. Řádek „nevyplněno“ má jen počet a do porovnání nevstupuje; „vědomě žádná“ (bez absorpce, bez zpráv) je normální skupina. Dimenze běží, až má druhá největší skupina aspoň ${SAMPLE_GREY} obchodů; pod ${SAMPLE_WARN} je orientační. Pořadí v dni počítá Lab z cen a časů sám; „cíl na hladině“ přebírá z exportu deníku. Hladiny v blízkosti mají vlastní obrazovku Hladiny. Tabulka ukazuje, co se stalo – ne proč.</p>
    </div>`;
    return cards + top + sections('context', res.groups.map(groupSection), ctx.views);
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.context = { title: 'Kontext', question: 'V jakém kontextu obchody vycházejí?', render };
})();
