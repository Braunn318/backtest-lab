'use strict';
// Obrazovka „Hladiny – co hladiny v blízkosti v obchodu dělají?"
// (docs/ZADANI_KONTEXT_V3.md B2). Jen vykresluje LabStrength.computeStrength
// z LabOverview.analyses – nic nepočítá.
//
// Deník hladiny jen měří. Tady je rozložení podle vzdálenosti od vstupu po
// 1 ticku (sloučení po 2 / 4 t je volba zobrazení): kolik hladin cena dotkla,
// jak daleko za ně zajela a jak obchod dopadl. Žádné koše, role ani tolerance.

(function () {
  const ST = window.LabStrength;
  const O = window.LabOverview;
  const SM = window.LabSummary;
  const UI = window.LabSummaryUI;
  const { esc, pct, num, sampleNote, sections } = window.LabUI;

  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v));
  const binLabel = (b, sign = true) => {
    const f = sign ? signed : num;
    return b.from === b.to ? `${f(b.from)} t` : `${f(b.from)} až ${f(b.to)} t`;
  };
  const outcome = b => (b.winRate == null ? (b.decided ? `${b.wins} z ${b.decided}` : '—') : `${pct(b.winRate)} <span class="muted">(${b.wins} z ${b.decided})</span>`);
  const NOTE = `Dotčena = poloha leží v dráze ceny od −MAE do +MFE (jen naměřené; nad vstupem rozhoduje MFE, na vstupu a pod ním MAE). Nedotčená hladina z reakce vypadává – jen se spočítá. Přesah = jak daleko cena zajela za hladinu (nad vstupem MFE − poloha, pod ním MAE + poloha). Výsledek = podíl obchodů na cíli z obchodů na cíli nebo SL, jen u dotčených. Řádky, ne obchody: obchod s více hladinami je ve více řádcích. Šedě pod ${ST.GREY_BELOW} dotčených; pod ${ST.NO_PCT_BELOW} bez procent a mediánu.`;

  // Volba sloučení – jen zobrazení, uloží se do pohledů (views.levelBin).
  function binSelect(bin) {
    return `<label class="muted bin-select">Rozložení <select data-view="levelBin">${ST.BINS.map(b => `<option value="${b}"${b === bin ? ' selected' : ''}>po ${b} t</option>`).join('')}</select></label>`;
  }

  function distTable(dist, firstCol = 'Od vstupu') {
    const rows = dist.bins.map(b => `<tr class="${b.grey ? 'grey' : ''}"><td><b>${esc(binLabel(b))}</b></td><td class="num"><b>${b.n}</b></td>`
      + `<td class="num">${b.touched}</td><td class="num">${b.untouched}</td><td class="num muted">${b.noExcursion}</td>`
      + `<td class="num">${outcome(b)}</td><td class="num">${b.medianOvershoot == null ? '—' : num(b.medianOvershoot) + ' t'}</td></tr>`).join('');
    return `<div class="table-scroll"><table><thead><tr><th>${esc(firstCol)}</th><th class="num">N řádků</th><th class="num">Dotčeno</th><th class="num">Nedotčeno</th><th class="num">Bez dráhy</th><th class="num">Výsledek dotčených</th><th class="num">Medián přesahu</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function distSection(res, st) {
    return {
      id: 'dist', title: 'Podle vzdálenosti od vstupu', state: st.state, missing: st.missing, headline: esc(st.headline),
      body: `<div class="section-tools">${binSelect(res.bin)}<span>${sampleNote(res.touched)}</span></div>
        <p class="section-sub">Řádků ${res.totalRows} · s polohou ${res.withDistance} · bez polohy ${res.noDistance} (bez ceny – řádek ze starých dat bez ticků) · dotčeno ${res.touched} (${res.touchedAhead} ve směru, ${res.touchedBehind} na vstupu a proti) · nedotčeno ${res.untouched} · bez naměřené MFE / MAE ${res.noExcursion}. Poloha + = ve směru obchodu.</p>
        ${distTable(res.dist)}
        <p class="muted" style="font-size:12px">${esc(NOTE)}</p>`
    };
  }

  // Zvlášť podle typu hladiny / podle netest – test: souhrnný řádek a rozložení.
  function splitSection(id, title, groups, st, note) {
    const body = groups.map(g => `<details class="split"><summary><b>${esc(g.label)}</b>${g.known === false ? ' <span class="pill warn">neznámý klíč</span>' : ''}
        <span class="muted">· ${g.n} řádků · dotčeno ${g.touched} · výsledek ${g.winRate == null ? '—' : pct(g.winRate)} · medián přesahu ${g.medianOvershoot == null ? '—' : num(g.medianOvershoot) + ' t'}</span></summary>
        ${g.dist.bins.length ? distTable(g.dist) : '<p class="muted">Žádný řádek s polohou.</p>'}</details>`).join('');
    return {
      id, title, state: st.state, missing: st.missing,
      headline: esc(groups.filter(g => g.n).map(g => `${g.label} ${g.touched}`).join(' · ') || 'žádný řádek'),
      body: `<p class="section-sub">${esc(note)}</p>${body}`
    };
  }

  function pairTable(split, keys, labels, firstCol) {
    const rows = split.dist.bins.map(b => `<tr><td><b>${esc(binLabel(b, false))}</b></td><td class="num">${b[keys[0]]}</td><td class="num">${b[keys[1]]}</td></tr>`).join('');
    return `<div class="table-scroll"><table><thead><tr><th>${esc(firstCol)}</th><th class="num">${esc(labels[0])}</th><th class="num">${esc(labels[1])}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function stopBehindSection(sb, bin) {
    const st = O.stopBehindState(sb);
    return {
      id: 'stop-behind', title: 'SL za nejbližší hladinou', state: st.state, missing: st.missing, headline: esc(st.headline),
      body: `<p class="section-sub">O kolik ticků ležel SL za nejbližší hladinou mezi SL a cílem (zahrnuje i hladinu nad vstupem do longu) – u stopnutých a u přeživších obchodů. Počty obchodů po ${bin} t, žádné procento. Odpovídá na „kolik ticků za hladinou ještě chrání SL“ – z dat, ne z nastavení.</p>
        ${pairTable(sb, ['stopped', 'survived'], ['Stopnuté', 'Přeživší'], 'SL za hladinou')}
        <p>${sampleNote(Math.min(sb.stopped.n, sb.survived.n))} <span class="muted">(menší ze skupin · bez hladiny mezi SL a cílem ${sb.unknown}, nevstupuje)</span></p>`
    };
  }

  function nearestAheadSection(na, bin) {
    const st = O.nearestAheadState(na);
    return {
      id: 'nearest-ahead', title: 'Nejbližší hladina ve směru', state: st.state, missing: st.missing, headline: esc(st.headline),
      body: `<p class="section-sub">Jak daleko ve směru obchodu ležela nejbližší hladina mezi vstupem a cílem – u obchodů, které došly na cíl, a u ostatních. V R vůči vzdálenosti SL. Počty obchodů po ${bin} t.</p>
        ${pairTable(na, ['reached', 'missed'], ['Cíl dosažen', 'Nedosažen'], 'Hladina ve směru')}
        <p>${sampleNote(Math.min(na.reached.n, na.missed.n))} <span class="muted">(menší ze skupin · bez hladiny ve směru ${na.unknown}, nevstupuje)</span></p>`
    };
  }

  function controlSection(cg) {
    const st = O.controlState(cg);
    const col = s => `<td class="num">${s.n}</td><td class="num">${pct(s.winRate)}</td><td class="num">${pct(s.targetHit)}</td><td class="num">${pct(s.stopHit)}</td>`;
    return {
      id: 'control', title: 'Kontrolní skupina: s hladinou × žádná hladina', state: st.state, missing: st.missing, headline: esc(st.headline),
      body: `<p class="section-sub">Obchody s vědomě „žádná hladina v blízkosti“ proti obchodům, kde hladina byla. Nevyplněné se jen spočítají a do porovnání nevstupují.</p>
      <div class="table-scroll"><table><thead><tr><th>Skupina</th><th class="num">N</th><th class="num">Win rate</th><th class="num">Cíl dosažen</th><th class="num">SL zasažen</th></tr></thead><tbody>
        <tr><td><b>Žádná hladina v blízkosti</b></td>${col(cg.none)}</tr>
        <tr><td><b>S hladinou</b></td>${col(cg.present)}</tr>
        <tr class="grey"><td>Nevyplněno <span class="muted">(nevstupuje)</span></td><td class="num">${cg.unknown.n}</td><td colspan="3" class="muted">—</td></tr>
      </tbody></table></div>
      <p>${sampleNote(Math.min(cg.none.n, cg.present.n))} <span class="muted">(menší ze skupin)</span></p>`
    };
  }

  function render(ctx) {
    const res = O.analyses(ctx).strength;
    const st = O.levelsState(res);
    // Nahoře tatáž karta jako v Souhrnu.
    const card = UI.questionCard(SM.levelsCard(res));
    return card + sections('levels', [
      distSection(res, st),
      splitSection('by-type', 'Podle typu hladiny', res.byType, st, 'Každý typ hladiny zvlášť, typy podle počtu dotčených. Vlastní volby deníku se ukazují pod svým popiskem – Lab je neslučuje odhadem.'),
      splitSection('by-test', 'Podle netest / test', res.byTest, st, `Netest = cena se hladiny v seanci ještě nedotkla. Stav má ${res.totalRows - res.testStateUnknown} z ${res.totalRows} řádků; řádky bez stavu (${res.testStateUnknown}) se do rozpadu nepočítají.`),
      stopBehindSection(res.stopBehind, res.bin),
      nearestAheadSection(res.nearestAhead, res.bin),
      controlSection(res.control)
    ], ctx.views);
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.levels = { title: 'Hladiny', question: 'Co hladiny v blízkosti v obchodu dělají?', render };
})();
