'use strict';
// Obrazovka „Síla hladin – jak silné jsou hladiny proti TP a proti SL?".
// Jen vykresluje výsledek LabStrength.computeStrength. Nahoře vždy řekne,
// co jí chybí; ze dvou případů nedělá procenta.

(function () {
  const ST = window.LabStrength;
  const { esc, pct, num, metric, sampleNote, recordCells } = window.LabUI;

  const STATUS_TEXT = { held: 'zastavila', broken: 'propadla', untested: 'netestována', noDistance: 'bez ceny / vzdálenosti', noExcursion: 'bez naměřené excursion' };

  function levelTable(side, tolerance) {
    if (!side.totalRows) return `<p class="muted">Žádný obchod nemá v tomhle poli hladinu.</p>`;
    const rows = side.levels.map(l => {
      const detail = l.items.map(x => `<tr>${recordCells(x.record)}<td class="num">${num(x.row.distanceTicks)}</td><td class="num">${num(x.record[side.key === 'target' ? 'mfeMeasured' : 'maeMeasured'])}</td><td>${esc(STATUS_TEXT[x.status])}${x.overshoot != null ? ` o ${num(x.overshoot)} t` : ''}</td></tr>`).join('');
      return `<tr class="${l.grey ? 'grey' : ''}">
        <td><details><summary><b>${esc(l.label)}</b>${l.known ? '' : ' <span class="pill warn">neznámý klíč</span>'} <span class="mono muted">${esc(l.level)}</span></summary>
          <div class="table-scroll"><table class="items"><thead><tr><th>Datum</th><th>Vstup</th><th>Směr</th><th class="num">Cena</th><th>Výsledek</th><th class="num">Vzdálenost</th><th class="num">${esc(side.excursionLabel)}</th><th>Stav</th></tr></thead><tbody>${detail}</tbody></table></div>
        </details></td>
        <td class="num"><b>${l.tested}</b></td>
        <td class="num">${l.heldPct == null ? (l.tested ? `${l.held} z ${l.tested}` : '—') : pct(l.heldPct)}</td>
        <td class="num">${l.brokenPct == null ? (l.tested ? `${l.broken} z ${l.tested}` : '—') : pct(l.brokenPct)}</td>
        <td class="num">${l.medianOvershoot == null ? '—' : num(l.medianOvershoot) + ' t'}</td>
        <td class="num muted">${l.untested}</td>
        <td class="num muted">${l.noData}</td>
      </tr>`;
    }).join('');
    return `<div class="table-scroll"><table><thead><tr>
      <th>Hladina</th><th class="num">N testovaných</th><th class="num">% zastavila</th><th class="num">% propadla</th><th class="num">Medián přesahu</th><th class="num">Netestováno</th><th class="num">Nelze vyhodnotit</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="font-size:12px">Zastavila = ${esc(side.excursionLabel)} do ±${num(tolerance)} t od hladiny; propadla = přes hladinu o víc než ${num(tolerance)} t; netestována = cena k hladině nedošla – do síly NEvstupuje. Řazeno podle % zastavila. Šedě N &lt; ${ST.GREY_BELOW}; pod ${ST.NO_PCT_BELOW} bez procent – procento ze dvou případů není údaj.</p>`;
  }

  function sideCard(side, tolerance) {
    return `<div class="card">
      <h2>${esc(side.label)}</h2>
      <p class="section-sub">Řádků s hladinou ${side.totalRows} · s cenou nebo vzdáleností ${side.withPlace} · otestováno ${side.tested} · netestováno ${side.untested}. Měří se naměřeným ${esc(side.excursionLabel)} (dopočtené se nepočítá). ${sampleNote(side.tested)}</p>
      ${side.coverageMessage ? `<div class="obs-warning">⚠ ${esc(side.coverageMessage)}</div>` : ''}
      ${levelTable(side, tolerance)}
    </div>`;
  }

  function controlCard(cg) {
    const isTarget = cg.key === 'target';
    const col = s => `<td class="num">${s.n}</td><td class="num">${pct(s.winRate)}</td><td class="num">${pct(isTarget ? s.targetHit : s.stopHit)}</td><td class="num">${num(s.medianExcursion)} t <span class="muted">(${s.excursionN})</span></td>`;
    return `<div class="card">
      <h2>Kontrolní skupina: ${esc(cg.label)}</h2>
      <p class="section-sub">Obchody s vědomě „žádná hladina v cestě“ proti obchodům, kde hladina byla. ${isTarget ? 'Odpovídá na „stojí za to mířit za hladinu, nebo se tam pohyb spolehlivě zastaví?“' : 'Odpovídá na „chrání hladina mezi vstupem a SL, nebo nic nemění?“'} Nevyplněné obchody se jen spočítají a do porovnání nevstupují.</p>
      <div class="table-scroll"><table><thead><tr><th>Skupina</th><th class="num">N</th><th class="num">Win rate</th><th class="num">${isTarget ? 'Cíl dosažen' : 'SL zasažen'}</th><th class="num">Medián ${esc(cg.excursionLabel)}</th></tr></thead><tbody>
        <tr><td><b>Žádná hladina</b></td>${col(cg.none)}</tr>
        <tr><td><b>Hladina v cestě</b></td>${col(cg.present)}</tr>
        <tr class="grey"><td>Nevyplněno <span class="muted">(nevstupuje)</span></td><td class="num">${cg.unknown.n}</td><td colspan="3" class="muted">—</td></tr>
      </tbody></table></div>
      <p>${sampleNote(Math.min(cg.none.n, cg.present.n))} <span class="muted">(menší ze skupin)</span></p>
    </div>`;
  }

  function render(ctx) {
    const tolerance = ctx.views.levelTolerance != null ? ctx.views.levelTolerance : ST.DEFAULT_TOLERANCE;
    const res = ST.computeStrength(ctx.perf, { tolerance });
    const missing = res.sides.filter(s => s.coverageMessage);
    const top = `<div class="card ${missing.length ? 'warn-card' : 'slim'}">
      <h2>${missing.length ? '<span class="pill warn">ZATÍM MÁLO DAT</span> ' : ''}Co téhle obrazovce chybí</h2>
      ${missing.length ? missing.map(s => `<p class="hero-message"><b>${esc(s.label)}:</b> ${esc(s.coverageMessage)}</p>`).join('') : '<p class="hero-message muted">Všechny SR řádky mají cenu nebo vzdálenost.</p>'}
      <p class="muted" style="font-size:12.5px">Vzdálenost se nedopočítává odhadem – jen přesným přepočtem ceny přes velikost ticku. Z N = 2 se nedělají závěry. Tolerance „zastavila“ je ±${num(tolerance)} t (nastavuje se vlevo).</p>
      <div class="metrics">${res.sides.map(s => metric(s.label, `${s.tested} otestovaných`, `${s.withPlace} z ${s.totalRows} řádků s místem`)).join('')}</div>
    </div>`;
    return top + res.sides.map(s => sideCard(s, tolerance)).join('') + `<div class="two-col even">${res.control.map(controlCard).join('')}</div>`;
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.levels = { title: 'Síla hladin', question: 'Jak silné jsou hladiny proti TP a proti SL?', render };
})();
