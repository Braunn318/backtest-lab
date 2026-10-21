'use strict';
// Obrazovka Diagnóza (docs/ZADANI_LAB_PRESTAVBA.md §2). Jen vykresluje
// LabDiagnosis.computeDiagnosis – nic nepočítá. Každé číslo nese N a vede
// k obchodům, ze kterých vzniklo (rozbalitelné „Obchody").

(function () {
  const DG = window.LabDiagnosis;
  const L = window.LabLabels;
  const { esc, pct, num, usd, signClass, czDate, shortDate, stateIcon, weeklyChart } = window.LabUI;

  // Znaménko až po zaokrouhlení – jinak „+0 R".
  const signedR = v => { if (v == null) return '—'; const x = Math.round(v * 100) / 100; return (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x)) + ' R'; };
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  const trades = n => `${n} ${plural(n, 'obchod', 'obchody', 'obchodů')}`;
  const NOTE_MAX = 70;

  // ------------------------------------------------------------- obchody

  function tradesTable(records, extra) {
    if (!records.length) return '<p class="muted">Žádné obchody.</p>';
    const rows = records.map(r => {
      const note = DG.noteTextOf(r).replace(/\s+/g, ' ').trim();
      const short = note.length > NOTE_MAX ? note.slice(0, NOTE_MAX - 1) + '…' : note;
      const side = r.side ? `<span class="pill side ${esc(r.side)}">${esc(r.side)}</span>` : '—';
      return `<tr><td class="mono">${esc(czDate(r.date))}</td><td class="mono">${esc(r.entryTime || '—')}</td><td>${side}</td>
        <td>${esc(r.setupCode ? L.labelOf('SETUP', r.setupCode) : '—')}</td><td>${esc(r.result || '—')}</td>
        <td class="num ${signClass(r.pnlRaw)}">${esc(usd(r.pnlRaw, 1))}</td>${extra ? `<td class="num">${extra(r)}</td>` : ''}
        <td class="note" title="${esc(note)}">${esc(short)}</td></tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="trade-list"><thead><tr><th>Datum</th><th>Čas</th><th>Směr</th><th>Setup</th><th>Výsledek</th><th class="num">P/L</th>${extra ? '<th class="num"></th>' : ''}<th>Poznámka</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function tradesDetails(records, label = 'Obchody', extra) {
    return `<details class="trades"><summary>${esc(label)} (${records.length}) ▾</summary>${tradesTable(records, extra)}</details>`;
  }

  // ------------------------------------------------------------- hlavička

  function tile(label, value, note, cls = '') {
    return `<div class="sum-tile"><div class="sum-tile-label">${esc(label)}</div><div class="sum-tile-value ${cls}">${esc(value)}</div>${note ? `<div class="sum-tile-note">${esc(note)}</div>` : ''}</div>`;
  }

  function headerCard(res) {
    const h = res.header;
    const decided = h.targets + h.stops;
    const legacy = h.legacy ? `, z toho ${h.legacy} legacy (jen v $)` : '';
    return `<div class="card dg-header">
      <div class="dg-tiles">
        ${tile('Obchodů', String(h.n), `${h.days} ${plural(h.days, 'den', 'dny', 'dnů')}${legacy}`)}
        ${tile('P/L $', usd(h.pnl, 1), 'pnlRaw obchodů, vč. poplatků', signClass(h.pnl))}
        ${tile('z toho poplatky $', usd(-h.fees, 1), `${trades(h.n)}`)}
        ${tile('Win %', pct(h.winRate), `${h.targets} targetů z ${decided} na cíli nebo SL`)}
        ${tile('Průměrná výhra / ztráta', `${signedR(h.avgWinR)} / ${signedR(h.avgLossR)}`, `n ${h.winRN} / ${h.lossRN} obchodů s R`)}
        ${tile('Win % potřebné na nulu', pct(h.breakEvenWinRate), h.breakEvenWinRate == null ? 'chybí R nebo poplatek v R' : 'z průměrné výhry, ztráty a poplatku v R')}
        ${tile('Poplatek na obchod', h.feeR == null ? '—' : `${num(Math.round(h.feeR * 100) / 100)} R`, `n ${h.feeN} obchodů s cenou SL a známým tickem`)}
      </div>
      <div class="sub-title">P/L po týdnech</div>
      ${weeklyChart([{ label: 'P/L', weeks: res.weekly }])}
    </div>`;
  }

  // ------------------------------------------------------------- 2.4 vstup, SL nebo cíl

  function line(label, state, text, missing, details) {
    return `<div class="dg-line">${stateIcon(state)}<b>${esc(label)}</b>
      <div class="dg-line-body">${state === 'na' ? `<span class="muted">Zatím nejde — chybí ${esc(missing)}.</span>` : `<span>${state === 'weak' ? 'Předběžně: ' : ''}${esc(text)}</span>`}${details || ''}</div></div>`;
  }

  function entryCard(res) {
    const e = res.entrySlTarget;
    const lack = n => Math.max(0, DG.GREY - n);
    const en = e.entry, sl = e.sl, tg = e.target;
    const entryText = `Z ${en.n} ztrát s naměřeným MFE se ${en.noRun} nepohnulo do zisku víc než ${e.noRunTicks} ticky (${en.zero} vůbec). Na 1R došlo ${en.oneR}${en.oneRN !== en.n ? ` (z ${en.oneRN} s cenou SL)` : ''}.`;
    const slText = `90 % ziskových obchodů šlo proti nejvýš ${num(sl.p90)} t, tvůj medián SL je ${num(sl.medianSl)} t (n ${sl.n} ziskových s naměřeným MAE).`;
    const tgText = `Po targetu cena v mediánu pokračovala ${num(tg.p50)} t, u ${tg.oneR} z ${tg.oneRN} obchodů ještě o 1R a víc.`;
    const mfeCol = r => `MFE ${num(r.mfeMeasured)} t`;
    return `<div class="card dg-entry">
      <div class="sum-head"><span class="sum-title">Vstup, SL nebo cíl?</span><span class="muted sum-sub">čísla ze stejných výpočtů jako Pokročilé → SL a TP</span></div>
      ${line('Vstup', en.state, entryText, `${lack(en.n)} stopnutých obchodů s naměřeným MFE do ${DG.GREY} (je ${en.n} z ${en.stopped})`,
        tradesDetails(en.records.noRun, `Nerozjeté ztráty (MFE ≤ ${e.noRunTicks} t)`, mfeCol) + tradesDetails(en.records.oneR, 'Ztráty, které došly na 1R', mfeCol))}
      ${line('SL', sl.state, slText, `${lack(sl.n)} ziskových obchodů s naměřeným MAE do ${DG.GREY} (je ${sl.n} z ${sl.winners})`,
        tradesDetails(sl.records, 'Ziskové obchody s MAE', r => `MAE ${num(r.maeMeasured)} t · SL ${num(r.slTicks)} t`))}
      ${line('Cíl', tg.state, tgText, `${lack(tg.n)} obchodů na targetu se zapsaným pohybem po výstupu do ${DG.GREY} (je ${tg.n} z ${tg.targets})`,
        tradesDetails(tg.records.oneR, 'Pokračovaly o 1R a víc', r => `+${num(r.postExitFavorableTicks)} t · SL ${num(r.slTicks)} t`))}
    </div>`;
  }

  // ------------------------------------------------------------- karta srovnání

  function bars(g) {
    if (g.avg == null || g.rest.avg == null) return '';
    const max = Math.max(Math.abs(g.avg), Math.abs(g.rest.avg)) || 1;
    const bar = (label, v) => `<div class="dg-bar"><span>${esc(label)}</span><div class="dg-track"><i class="${v < 0 ? 'neg' : 'pos'}" style="width:${(Math.abs(v) / max * 100).toFixed(1)}%"></i></div><b class="${signClass(v)}">${esc(usd(v, 1))} / obchod</b></div>`;
    return `<div class="dg-bars">${bar('tahle skupina', g.avg)}${bar('zbytek', g.rest.avg)}</div>`;
  }

  function giveBackCard(g) {
    const days = g.dayList.map(d => `<tr><td class="mono">${esc(czDate(d.date))}</td><td class="num pos">${esc(usd(d.peak, 1))}</td><td class="num ${signClass(d.end)}">${esc(usd(d.end, 1))}</td><td class="num neg">${esc(usd(-d.givenBack, 1))}</td><td class="num">${d.trades.length}</td></tr>`).join('');
    const amount = usd(g.givenBack).replace(/^\+/, '');
    const text = `${g.days} ${plural(g.days, 'den byl', 'dny byly', 'dnů bylo')} během dne v plusu a z denního maxima ${g.days === 1 ? 'vrátil' : 'vrátily'} ${amount}; ${g.endedNegative} z nich ${g.endedNegative === 1 ? 'skončil' : 'skončilo'} v mínusu.`;
    return `<div class="card dg-card is-${esc(g.state)}">
      <div class="dg-head">${stateIcon(g.state)}<span class="dg-kicker">${esc(g.comparisonTitle)}</span><span class="dg-impact neg">dopad ${esc(usd(g.impact))}</span></div>
      <p class="dg-text">${g.state === 'weak' ? 'Předběžně: ' : ''}${esc(text)}</p>
      <div class="dg-foot"><span class="sample ok">n = ${g.days} ${plural(g.days, 'den', 'dny', 'dnů')}</span></div>
      <details class="trades"><summary>Dny (${g.days}) ▾</summary><div class="table-scroll"><table class="trade-list"><thead><tr><th>Den</th><th class="num">Maximum dne</th><th class="num">Konec dne</th><th class="num">Vráceno</th><th class="num">Obchodů</th></tr></thead><tbody>${days}</tbody></table></div></details>
    </div>`;
  }

  function card(g) {
    if (g.comparison === 'giveBack') return giveBackCard(g);
    const dayUnit = g.unit === 'day';
    const count = dayUnit ? `${g.days} ${plural(g.days, 'den', 'dny', 'dnů')}, ${trades(g.n)}` : trades(g.n);
    const text = `${g.label}: ${count}, ${usd(g.pnl)}, ${pct(g.targetPct)} targetů.`;
    const impact = g.impact == null ? '' : `<span class="dg-impact ${signClass(g.impact)}">dopad ${esc(usd(g.impact))}</span>`;
    const kindNote = g.kind === 'unknown' ? ' <span class="pill na">nevyplněno</span>' : g.kind === 'rest' ? ' <span class="pill na">doplněk</span>' : '';
    return `<div class="card dg-card is-${esc(g.state)}">
      <div class="dg-head">${stateIcon(g.state)}<span class="dg-kicker">${esc(g.comparisonTitle)}${kindNote}</span>${impact}</div>
      <p class="dg-text">${g.state === 'weak' ? 'Předběžně: ' : ''}${esc(text)}</p>
      <p class="dg-rest muted">Zbytek: ${esc(trades(g.rest.n))}, ${esc(usd(g.rest.pnl))}.</p>
      ${bars(g)}
      <div class="dg-foot"><span class="sample ${g.state === 'na' ? 'bad' : g.state === 'weak' ? 'warn' : 'ok'}">n = ${g.n}${g.state === 'na' ? ` · pod ${DG.GREY} se nedá nic vyvodit` : ''}</span></div>
      ${tradesDetails(g.records)}
    </div>`;
  }

  function allComparisons(res, views) {
    const blocks = res.comparisons.map(c => `<div class="dg-all-block"><div class="sub-title">${esc(c.title)}</div>
      <div class="dg-grid">${c.groups.map(card).join('')}</div></div>`).join('');
    const open = window.LabViews.isOpen(views, 'diagnosis', 'all') ? ' open' : '';
    return `<details class="card section dg-all" data-section="all" data-screen="diagnosis"${open}><summary><span class="section-title">Zobrazit všechna srovnání</span>
      <span class="section-headline">${res.cards.length} skupin ve ${res.comparisons.length} srovnáních · šedě pod ${DG.GREY} obchodů · nevyplněno je vždy vlastní skupina</span></summary>
      <div class="section-body">${blocks}</div></details>`;
  }

  // ------------------------------------------------------------- obrazovka

  function render(ctx) {
    const res = DG.computeDiagnosis(ctx.records, ctx.options, { words: DG.wordsOf(ctx.views) });
    if (!res.header.n) return '<div class="card empty-state">Ve výběru nejsou žádné obchody s P/L.</div>';
    const loss = res.top.loss.length
      ? `<div class="dg-grid">${res.top.loss.map(card).join('')}</div>`
      : `<p class="muted">Žádná skupina s aspoň ${DG.GREY} obchody nemá záporný dopad.</p>`;
    const gain = res.top.gain.length
      ? `<div class="dg-grid">${res.top.gain.map(card).join('')}</div>`
      : `<p class="muted">Žádná skupina s aspoň ${DG.GREY} obchody nemá kladný dopad.</p>`;
    const notes = [];
    if (res.base.missingPnl) notes.push(`${res.base.missingPnl} obchodů bez pnlRaw nevstupuje`);
    if (ctx.views.setupCode) notes.push('je zapnutý filtr setupu – pořadí v dni a dny počítají jen vybraný setup');
    return `${headerCard(res)}
      ${entryCard(res)}
      <h2 class="dg-h2">Kde ztrácím</h2>
      <p class="section-sub">Skupiny seřazené podle dopadu v $: P/L skupiny minus to, co by stejný počet obchodů udělal s průměrem zbytku. Nevyplněno do pořadí nevstupuje.</p>
      ${loss}
      <h2 class="dg-h2">Co funguje</h2>
      ${gain}
      ${allComparisons(res, ctx.views)}
      ${notes.length ? `<p class="muted" style="font-size:12px">${esc(notes.join(' · '))}</p>` : ''}`;
  }

  function scope(ctx) {
    const b = DG.baseOf(ctx.records, ctx.options);
    return { n: b.trades.length, note: `obchodů za ${b.days} ${plural(b.days, 'den', 'dny', 'dnů')}${b.legacy ? `, z toho ${b.legacy} legacy (jen v $)` : ''}` };
  }

  window.LabDiagnosisUI = { tradesTable, tradesDetails, shortDate };
  window.LabScreens = window.LabScreens || {};
  window.LabScreens.diagnosis = { title: 'Diagnóza', question: 'Kde ztrácím a kde vydělávám', render, scope };
})();
