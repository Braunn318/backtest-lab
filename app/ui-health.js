'use strict';
// Obrazovka „Zdraví dat". Jen vykresluje výsledek LabHealth.computeHealth.

(function () {
  const H = window.LabHealth;
  const { esc, pct, num, STATUS_LABEL, itemsTable, metric } = window.LabUI;

  function heroCheck11(c) {
    const cls = c.status === 'warn' ? 'warn' : c.status === 'pass' ? 'pass' : '';
    return `<div class="card hero ${cls}">
      <div class="hero-kicker">Nejdůležitější kontrola zdraví dat · kontrola ${c.id}</div>
      <div class="hero-head"><span class="pill ${c.status}">${STATUS_LABEL[c.status]}</span><span class="hero-title">${esc(c.title)}</span></div>
      <div class="hero-stats">
        <span>Bez pozorování: <b>${c.missing ?? 0}</b> z <b>${c.checked}</b> targetů</span>
        <span>Podíl: <b>${c.share == null ? '—' : pct(c.share)}</b></span>
        <span>Práh varování: <b>více než ${Math.round(H.NO_OBSERVATION_WARN_SHARE * 100)} %</b></span>
      </div>
      ${c.message ? `<p class="hero-message">${esc(c.message)}</p>` : `<p class="hero-message muted">Počítá se ze všech obchodů s výsledkem target. Chybí = prázdné postExitFavorableTicks; 0 je platné měření („dál už nic nebylo“).</p>`}
      ${c.items.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Seznam targetů bez pozorování (${c.items.length})</summary>${itemsTable(c.items)}</details>` : ''}
    </div>`;
  }

  function barClass(n) {
    return n >= H.USABLE_GOAL ? 'full' : n >= H.USABLE_GOAL / 2 ? 'mid' : 'low';
  }

  function sectionA(h) {
    const s = h.sample;
    const days = s.days.filter(d => d.trades > 0).length;
    const metrics = [
      metric('Záznamů', s.total),
      metric('TRADE', s.trades),
      metric('SETUP_ONLY', s.setups, 'nikdy v P/L'),
      s.legacy ? metric('Legacy', s.legacy, 'mimo použitelné') : '',
      s.hasSkipLiveField ? metric('Naživo bych nevzal', s.skipLive, h.options.includeSkipLive ? 'započítané' : 'mimo výkon') : '',
      s.noFill ? metric('No fill (hypotetické)', s.noFill, h.options.includeNoFill ? 'započítané' : 'mimo výkon') : '',
      s.skipped ? metric('Vědomě vynechané (hypotetické)', s.skipped, h.options.includeSkipped ? 'započítané' : 'mimo výkon') : '',
      metric('Výkonový vzorek', s.perf, 'obchody, které se počítají'),
      metric('Dnů s obchody', days)
    ].join('');

    const rows = h.usability.map(u => {
      const w = Math.min(100, (u.n / H.USABLE_GOAL) * 100);
      const extra = u.key === 'fillRate' && u.rate != null ? ` · fill rate ${pct(u.rate)} (${u.filled} FILLED / ${u.noFill} NO_FILL)` : '';
      const lacking = u.n < u.m ? `<div class="lacks">chybí: ${esc(u.lacks)}</div>` : '';
      return `<tr><td><b>${esc(u.label)}</b><div class="muted" style="font-size:11.5px">${esc(u.needs)}${esc(extra)}</div>${lacking}</td>`
        + `<td class="num"><b>${u.n}</b> z ${u.m}<div class="muted" style="font-size:11px">${esc(u.unit)}</div></td>`
        + `<td class="num">${u.key === 'fillRate' && u.n === 0 ? '<span class="pill na">n/a</span>' : u.missing ? `chybí ${u.missing}` : '<span class="pill pass">50+</span>'}</td>`
        + `<td style="width:24%"><div class="bar"><i class="${barClass(u.n)}" style="width:${w}%"></i></div></td></tr>`
        + (u.note ? `<tr class="note-row"><td colspan="4">${esc(u.note)}</td></tr>` : '');
    }).join('');

    const dayRows = s.days.map(d => `<tr><td class="mono">${esc(d.date)}</td><td class="num">${d.trades}</td><td class="num">${d.setups}</td><td class="num">${d.noFill}</td>${s.legacy ? `<td class="num">${d.legacy || ''}</td>` : ''}</tr>`).join('');

    return `<div class="card">
      <h2><span class="letter">A</span>Přehled vzorku a použitelnost pro analýzy</h2>
      <p class="section-sub">Kolik záznamů unese kterou analýzu fáze 2. Počítá se jen naměřené – dopočtené MFE/MAE a cíl převzatý z výstupu ne. Cíl je ${H.USABLE_GOAL}.</p>
      <div class="metrics">${metrics}</div>
      <div class="two-col">
        <div class="table-scroll"><table><thead><tr><th>Analýza</th><th class="num">Použitelné</th><th class="num">Do ${H.USABLE_GOAL}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <details ${s.days.length <= 12 ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin-bottom:8px">Podle dnů (${s.days.length})</summary>
          <div class="table-scroll"><table><thead><tr><th>Datum</th><th class="num">TRADE</th><th class="num">SETUP_ONLY</th><th class="num">NO_FILL</th>${s.legacy ? '<th class="num">legacy</th>' : ''}</tr></thead><tbody>${dayRows}</tbody></table></div>
        </details>
      </div>
    </div>`;
  }

  // R2.5: blok „naživo bych nevzal" – bez ohledu na přepínač, jako v deníku.
  function skipLiveCard(h) {
    const s = h.skipLive;
    if (!h.sample.hasSkipLiveField || !s.count) return '';
    const money = v => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + ' $');
    const rVal = v => (v == null ? '—' : (v > 0 ? '+' : '') + num(Math.round(v * 100) / 100) + ' R');
    const reasons = s.byReason.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.count}</td><td class="num">${money(r.pnl)}</td><td class="num">${pct(r.winRate)}</td></tr>`).join('');
    return `<div class="card">
      <h2>Obchody, které bych naživo nevzal</h2>
      <p class="section-sub">Stejně jako v deníku: ve výchozím stavu mimo výkon, ve fill rate zůstávají. Tenhle blok se počítá vždy – odpovídá na to, jestli tě vlastní filtr nestojí peníze.</p>
      <div class="metrics">
        ${metric('Počet', s.count)}
        ${metric('P/L', money(s.pnl))}
        ${metric('Win rate', pct(s.winRate))}
        ${metric('Expectancy bez nich', money(s.without.expectancy), rVal(s.without.expectancyR))}
        ${metric('Expectancy s nimi', money(s.with.expectancy), rVal(s.with.expectancyR))}
      </div>
      <div class="table-scroll"><table><thead><tr><th>Důvod</th><th class="num">Počet</th><th class="num">P/L</th><th class="num">Win rate</th></tr></thead><tbody>${reasons}</tbody></table></div>
    </div>`;
  }

  function unknownKeysCard(h) {
    if (!h.unknownKeys.length) return '';
    const L = window.LabLabels;
    const items = h.unknownKeys.map(u => ({ record: u.record, detail: `${L.fieldLabel(u.field)}: „${u.key}“ – výchozí slovník deníku tenhle klíč nezná` }));
    return `<div class="card warn-card">
      <h2><span class="pill warn">UPOZORNĚNÍ</span> Neznámé klíče (${h.unknownKeys.length})</h2>
      <p class="section-sub">Klíče, které výchozí slovníky deníku neznají – vlastní volba, nebo pozůstatek zrušeného slovníku. Zobrazují se tak, jak přišly. Opravit obchod je na tobě v deníku; Lab nic nezapisuje.</p>
      ${itemsTable(items)}
    </div>`;
  }

  function sectionB(h) {
    const c = h.completeness;
    const rows = c.rows.map(r => {
      const w = r.pct == null ? 0 : r.pct * 100;
      const cls = r.pct == null ? 'low' : r.pct >= 0.9 ? 'full' : r.pct >= 0.5 ? 'mid' : 'low';
      const derived = r.derived ? `<div class="muted" style="font-size:11px">z toho dopočteno / převzato z výstupu: ${r.derived} (do analýz nevstupuje)</div>` : '';
      return `<tr><td><b>${esc(r.label)}</b> <span class="mono muted">${esc(r.field)}</span>${derived}</td>`
        + `<td class="num"><b>${pct(r.pct)}</b></td><td class="num">${r.missing ? `chybí ${r.missing}` : '—'}</td>`
        + `<td style="width:36%"><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td></tr>`;
    }).join('');
    return `<div class="card">
      <h2><span class="letter">B</span>Úplnost polí</h2>
      <p class="section-sub">Stejná definice jako štítek „⚠ Neúplné“ v deníku (missingContextKeys): nula i dopočtená hodnota jsou vyplněné, u nenaplněného setupu se průběh nekontroluje. Nastavení karet formuláře se nepřebírá – pro analýzu chybí, co chybí. Všechny obchody ve výběru.</p>
      <div class="metrics">${metric('Neúplných obchodů', `${c.incomplete} z ${c.total}`)}</div>
      <div class="table-scroll"><table><thead><tr><th>Pole</th><th class="num">Vyplněno</th><th class="num">Chybí</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
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
    const b = f.bottleneck;
    const daysText = g => (g.days == null ? 'nelze odhadnout' : g.days === 0 ? 'hotovo' : g.days + ' dnů');
    const rows = f.rows.map(r => `<tr class="${b && r.key === b.key ? 'hl' : ''}"><td><b>${esc(r.label)}</b>${b && r.key === b.key ? ' <span class="pill warn">hrdlo</span>' : ''}<div class="lacks">chybí: ${esc(r.lacks)}</div></td>`
      + `<td class="num">${r.n} <span class="muted">${esc(r.unit)}</span></td><td class="num">${num(r.perDay)}</td>`
      + r.goals.map(g => `<td class="num">${daysText(g)}</td>`).join('') + '</tr>').join('');
    return `<div class="card">
      <h2><span class="letter">D</span>Kdy budu mít vzorek</h2>
      <p class="section-sub">Pro každou analýzu zvlášť, z jejího vlastního N ÷ ${f.days} obchodních dnů ve výběru. Předpokládá, že budeš dál zapisovat stejně úplně jako dosud. Fill rate se neodhaduje – nevzniká z obchodů, ale ze zapsaných nenaplněných limitek.</p>
      ${b ? `<div class="metrics">${metric('Úzké hrdlo', b.label, `${b.n} ${b.unit} · chybí: ${b.lacks}`, 'wide')}${b.goals.map(g => metric(`Do ${g.goal}`, daysText(g), g.remaining ? `chybí ${g.remaining}` : 'splněno')).join('')}</div>` : ''}
      <div class="table-scroll"><table><thead><tr><th>Analýza</th><th class="num">Použitelné</th><th class="num">Za den</th>${f.rows[0] ? f.rows[0].goals.map(g => `<th class="num">Do ${g.goal}</th>`).join('') : ''}</tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  function render(ctx) {
    const h = ctx.health;
    const c11 = h.checks.find(c => c.id === 11);
    return heroCheck11(c11) + unknownKeysCard(h) + sectionA(h) + skipLiveCard(h) + sectionB(h) + sectionC(h) + sectionD(h);
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.health = { title: 'Zdraví dat', question: 'Sbírám použitelná data?', render };
})();
