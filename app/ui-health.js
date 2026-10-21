'use strict';
// Obrazovka „Zdraví dat a co vyplnit" (skupina Data). Jen vykresluje výsledek
// LabHealth.computeHealth; nahoře karta dat ze Souhrnu a bloky „Co vyplnit"
// a „Kdy to bude" (od 0.4 tady – úvodní „Co teď vím" zanikla).

(function () {
  const H = window.LabHealth;
  const { plural } = window.LabOverview;
  const { esc, pct, num, STATUS_LABEL, itemsTable, metric, sections } = window.LabUI;

  function heroCheck11(c) {
    const cls = c.status === 'warn' ? 'warn' : c.status === 'pass' ? 'pass' : '';
    const body = `<div class="hero-kicker">Nejdůležitější kontrola zdraví dat · kontrola ${c.id}</div>
      <div class="hero-stats">
        <span>Bez pozorování: <b>${c.missing ?? 0}</b> z <b>${c.checked}</b> targetů</span>
        <span>Podíl: <b>${c.share == null ? '—' : pct(c.share)}</b></span>
        <span>Práh varování: <b>více než ${Math.round(H.NO_OBSERVATION_WARN_SHARE * 100)} %</b></span>
      </div>
      ${c.message ? `<p class="hero-message">${esc(c.message)}</p>` : `<p class="hero-message muted">Počítá se ze všech obchodů s výsledkem target. Chybí = prázdné postExitFavorableTicks; 0 je platné měření („dál už nic nebylo“).</p>`}
      ${c.items.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Seznam targetů bez pozorování (${c.items.length})</summary>${itemsTable(c.items)}</details>` : ''}`;
    return {
      id: 'c11', title: c.title, cls: `hero ${cls}`,
      state: c.status === 'na' ? 'na' : 'ok',
      headline: `<span class="pill ${c.status}">${STATUS_LABEL[c.status]}</span> ${c.missing ?? 0} z ${c.checked} targetů bez pozorování (${c.share == null ? '—' : pct(c.share)})`,
      missing: 'obchody s výsledkem target',
      body
    };
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

    return {
      id: 'a', letter: 'A', title: 'Přehled vzorku a použitelnost pro analýzy', state: 'ok',
      headline: esc(`${s.perf} ${plural(s.perf, 'obchod', 'obchody', 'obchodů')} ve výkonovém vzorku · ${days} ${plural(days, 'den', 'dny', 'dnů')} s obchody · ${s.total} ${plural(s.total, 'záznam', 'záznamy', 'záznamů')}`),
      body: `<p class="section-sub">Kolik záznamů unese kterou analýzu fáze 2. Počítá se jen naměřené – dopočtené MFE/MAE a cíl převzatý z výstupu ne. Cíl je ${H.USABLE_GOAL}.</p>
      <div class="metrics">${metrics}</div>
      <div class="two-col">
        <div class="table-scroll"><table><thead><tr><th>Analýza</th><th class="num">Použitelné</th><th class="num">Do ${H.USABLE_GOAL}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <details ${s.days.length <= 12 ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin-bottom:8px">Podle dnů (${s.days.length})</summary>
          <div class="table-scroll"><table><thead><tr><th>Datum</th><th class="num">TRADE</th><th class="num">SETUP_ONLY</th><th class="num">NO_FILL</th>${s.legacy ? '<th class="num">legacy</th>' : ''}</tr></thead><tbody>${dayRows}</tbody></table></div>
        </details>
      </div>`
    };
  }

  // R2.5: blok „naživo bych nevzal" – bez ohledu na přepínač, jako v deníku.
  function skipLiveCard(h) {
    const s = h.skipLive;
    if (!h.sample.hasSkipLiveField || !s.count) return null;
    const money = v => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + ' $');
    const rVal = v => (v == null ? '—' : (v > 0 ? '+' : '') + num(Math.round(v * 100) / 100) + ' R');
    const reasons = s.byReason.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.count}</td><td class="num">${money(r.pnl)}</td><td class="num">${pct(r.winRate)}</td></tr>`).join('');
    return {
      id: 'skiplive', title: 'Obchody, které bych naživo nevzal', state: 'ok',
      headline: esc(`${s.count} ${plural(s.count, 'obchod', 'obchody', 'obchodů')} · P/L ${money(s.pnl)} · win rate ${pct(s.winRate)}`),
      body: `<p class="section-sub">Stejně jako v deníku: ve výchozím stavu mimo výkon, ve fill rate zůstávají. Tenhle blok se počítá vždy – odpovídá na to, jestli tě vlastní filtr nestojí peníze.</p>
      <div class="metrics">
        ${metric('Počet', s.count)}
        ${metric('P/L', money(s.pnl))}
        ${metric('Win rate', pct(s.winRate))}
        ${metric('Expectancy bez nich', money(s.without.expectancy), rVal(s.without.expectancyR))}
        ${metric('Expectancy s nimi', money(s.with.expectancy), rVal(s.with.expectancyR))}
      </div>
      <div class="table-scroll"><table><thead><tr><th>Důvod</th><th class="num">Počet</th><th class="num">P/L</th><th class="num">Win rate</th></tr></thead><tbody>${reasons}</tbody></table></div>`
    };
  }

  function unknownKeysCard(h) {
    if (!h.unknownKeys.length) return null;
    const L = window.LabLabels;
    const items = h.unknownKeys.map(u => ({ record: u.record, detail: `${L.fieldLabel(u.field)}: „${u.key}“ – slovník deníku tenhle klíč nezná` }));
    return {
      id: 'unknown', title: `Neznámé klíče (${h.unknownKeys.length})`, state: 'ok', cls: 'warn-card',
      headline: `<span class="pill warn">UPOZORNĚNÍ</span> ${h.unknownKeys.length} ${plural(h.unknownKeys.length, 'klíč', 'klíče', 'klíčů')}, které slovník deníku nezná`,
      body: `<p class="section-sub">Klíče, které nezná ani výchozí slovník, ani úprava slovníků z exportu deníku – smazaná vlastní volba, pozůstatek zrušeného slovníku, nebo export ze starší verze deníku (před 4.7.4 export vlastní volby nenesl; stačí v deníku cokoli uložit). Zobrazují se tak, jak přišly. Opravit obchod je na tobě v deníku; Lab nic nezapisuje.</p>
      ${itemsTable(items)}`
    };
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
    return {
      id: 'b', letter: 'B', title: 'Úplnost polí', state: 'ok',
      headline: esc(`neúplných obchodů ${c.incomplete} z ${c.total} · úplnost kontextu ${pct(c.total ? (c.total - c.incomplete) / c.total : null)}`),
      body: `<p class="section-sub">Stejná definice jako štítek „⚠ Neúplné“ v deníku (missingContextKeys): nula i dopočtená hodnota jsou vyplněné, u nenaplněného setupu se průběh nekontroluje. Nastavení karet formuláře se nepřebírá – pro analýzu chybí, co chybí. Všechny obchody ve výběru.</p>
      <div class="metrics">${metric('Neúplných obchodů', `${c.incomplete} z ${c.total}`)}</div>
      <div class="table-scroll"><table><thead><tr><th>Pole</th><th class="num">Vyplněno</th><th class="num">Chybí</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    };
  }

  // Kontext v2: za každé nové pole hodnota / vědomě žádná / nevyplněno. Řádky
  // dává registr v normalizaci (LabNormalize.CONTEXT_V2_FIELDS), nic natvrdo.
  function contextCoverageCard(h) {
    const c = h.contextCoverage;
    const SOURCE = { trade: 'pole obchodu', day: 'kontext dne', export: 'dopočet deníku', row: 'řádky hladin v blízkosti' };
    const filled = c.rows.filter(r => r.value + r.none > 0).length;
    const rows = c.rows.map(r => {
      const known = r.value + r.none;
      const w = r.total ? (known / r.total) * 100 : 0;
      const cls = !r.total ? 'low' : known / r.total >= 0.9 ? 'full' : known / r.total >= 0.5 ? 'mid' : 'low';
      return `<tr class="${known ? '' : 'grey'}"><td><b>${esc(r.label)}</b> <span class="mono muted">${esc(r.field)}</span><div class="muted" style="font-size:11px">${esc(SOURCE[r.source] || r.source)}</div></td>`
        + `<td class="num"><b>${r.value}</b></td><td class="num">${r.none}</td><td class="num">${r.unknown}</td><td class="num muted">${r.total} ${esc(r.unit)}</td>`
        + `<td style="width:24%"><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td></tr>`;
    }).join('');
    return {
      id: 'ctx-coverage', title: 'Pokrytí kontextu', state: 'ok',
      headline: esc(`${filled} z ${c.rows.length} polí má aspoň jednu hodnotu · dopočty deníku nese ${c.withExport} z ${c.total} obchodů`),
      body: `<p class="section-sub">Pole kontextu deníku (od 4.8.1, hladiny v blízkosti od 4.8.5). „Vědomě žádná“ (bez absorpce, bez zpráv, „nevím“) je vyplněná odpověď; nevyplněno je nevyplněno a do žádného porovnání na obrazovce Kontext nevstupuje. ${c.withExport < c.total ? `U ${c.total - c.withExport} z ${c.total} obchodů export nenese dopočty deníku (starší verze – stačí v deníku cokoli uložit); „cíl na hladině“ u nich Lab nezná.` : ''} Všechny obchody ve výběru.</p>
      <div class="table-scroll"><table><thead><tr><th>Pole</th><th class="num">Hodnota</th><th class="num">Vědomě žádná</th><th class="num">Nevyplněno</th><th class="num">Z</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    };
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
    const tally = ['fail', 'warn', 'info', 'pass', 'na'].filter(k => counts[k]).map(k => `<span class="pill ${k}">${STATUS_LABEL[k]} ${counts[k]}</span>`).join(' ');
    return {
      id: 'c', letter: 'C', title: 'Konzistenční kontroly', state: 'ok',
      headline: tally,
      body: `<p class="section-sub">Kliknutím na řádek se rozbalí seznam obchodů, které kontrolu shodily. R se znaménkem = rMultiple × znaménko exitTicks (deník ukládá rMultiple bez znaménka). Ziskový = exitTicks &gt; 0. Kontroly 14–16 odpovídají „Kontrole dat“ v deníku a berou všechny záznamy výběru; 17 porovnává dopočty deníku s přepočtem Labu. Lab nic neopravuje – oprava je na tobě v deníku.</p>
      ${list}`
    };
  }

  function sectionD(h) {
    const f = h.forecast;
    const b = f.bottleneck;
    const daysText = g => (g.days == null ? 'nelze odhadnout' : g.days === 0 ? 'hotovo' : g.days + ' dnů');
    const rows = f.rows.map(r => `<tr class="${b && r.key === b.key ? 'hl' : ''}"><td><b>${esc(r.label)}</b>${b && r.key === b.key ? ' <span class="pill warn">hrdlo</span>' : ''}<div class="lacks">chybí: ${esc(r.lacks)}</div></td>`
      + `<td class="num">${r.n} <span class="muted">${esc(r.unit)}</span></td><td class="num">${num(r.perDay)}</td>`
      + r.goals.map(g => `<td class="num">${daysText(g)}</td>`).join('') + '</tr>').join('');
    return {
      id: 'd', letter: 'D', title: 'Kdy budu mít vzorek', state: 'ok',
      headline: b ? esc(`hrdlo: ${b.label} – ${b.n} ${b.unit}, do ${b.goals[0].goal} ${daysText(b.goals[0])}`) : '',
      body: `<p class="section-sub">Pro každou analýzu zvlášť, z jejího vlastního N ÷ ${f.days} obchodních dnů ve výběru. Předpokládá, že budeš dál zapisovat stejně úplně jako dosud. Fill rate se neodhaduje – nevzniká z obchodů, ale ze zapsaných nenaplněných limitek.</p>
      ${b ? `<div class="metrics">${metric('Úzké hrdlo', b.label, `${b.n} ${b.unit} · chybí: ${b.lacks}`, 'wide')}${b.goals.map(g => metric(`Do ${g.goal}`, daysText(g), g.remaining ? `chybí ${g.remaining}` : 'splněno')).join('')}</div>` : ''}
      <div class="table-scroll"><table><thead><tr><th>Analýza</th><th class="num">Použitelné</th><th class="num">Za den</th>${f.rows[0] ? f.rows[0].goals.map(g => `<th class="num">Do ${g.goal}</th>`).join('') : ''}</tr></thead><tbody>${rows}</tbody></table></div>`
    };
  }

  // ------------------------------------------------------------- co vyplnit, kdy to bude

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
      <p class="section-sub">Za každou analýzu, která dnes neběží. Obchody: prognóza z bloku D níže (cíl 50 použitelných, tempo = použitelné ÷ obchodní dny ve výběru) – předběžný výsledek se ukáže dřív, od 10. Denní stop: počet chybějících dnů.</p>
      ${list}
    </div>`;
  }

  function render(ctx) {
    const h = ctx.health;
    const c11 = h.checks.find(c => c.id === 11);
    const ov = window.LabOverview.computeOverview(ctx);
    // Nahoře tatáž karta jako v Souhrnu (úplnost, nejužší hrdlo), pak co vyplnit a kdy to bude.
    const top = window.LabSummaryUI.dataCard(window.LabSummary.dataOf(h, ov)) + fillBlock(ov.fill) + etaBlock(ov.eta);
    return top + sections('health', [heroCheck11(c11), unknownKeysCard(h), sectionA(h), skipLiveCard(h), sectionB(h), contextCoverageCard(h), sectionC(h), sectionD(h)], ctx.views)
      + diagnosisSettings(ctx.views);
  }

  // ------------------------------------------------------------- nastavení diagnózy

  // Seznamy slov pro srovnání „Emoce / Technická chyba v poznámce" (Diagnóza).
  // Hledá se bez diakritiky a velikosti písmen v poznámce obchodu a v plánu dne.
  // Ukládá se do views.json; prázdné pole = výchozí seznam.
  function diagnosisSettings(views) {
    const DG = window.LabDiagnosis;
    const words = DG.wordsOf(views);
    const saved = views.diagWords || {};
    const area = (key, label) => `<label class="dg-words"><span><b>${esc(label)}</b>${saved[key] ? '' : ' <span class="muted">(výchozí)</span>'}</span>
      <textarea data-diag-words="${key}" rows="3" spellcheck="false">${esc(words[key].join(', '))}</textarea>
      <span class="hint">Výchozí: ${esc(DG.DEFAULT_WORDS[key].join(', '))}</span></label>`;
    return `<div class="card" id="diag-settings">
      <h2>Nastavení diagnózy</h2>
      <p class="section-sub">Slova oddělená čárkou. Hledají se bez diakritiky a velikosti písmen v poznámce obchodu a v plánu dne (setup, psychika, poznámka); stačí začátek slova („unaven“ najde „unavený“). Prázdné pole = výchozí seznam.</p>
      <div class="two-col even">${area('emotion', 'Emoce v poznámce')}${area('technical', 'Technická chyba v poznámce')}</div>
    </div>`;
  }

  // Úprava seznamu slov – uloží se do views.json (prázdné = výchozí).
  function onChange(e, api) {
    const key = e.target.dataset && e.target.dataset.diagWords;
    if (!key) return false;
    const list = e.target.value.split(/[,;\n]/).map(w => w.trim()).filter(Boolean);
    const next = { ...(api.views.diagWords || {}) };
    if (list.length) next[key] = list; else delete next[key];
    api.setView('diagWords', Object.keys(next).length ? next : undefined);
    api.render();
    return true;
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.health = { title: 'Zdraví dat a co vyplnit', question: 'Sbírám použitelná data a co doplnit?', render, onChange };
})();
