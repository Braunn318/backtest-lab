'use strict';
// Obrazovka „SL a TP – zadávám je správně?". Jen vykresluje výsledek
// LabSlTp.computeSlTp. Dopočtené hodnoty se ukazují zvlášť a šedě, nikdy
// mezi naměřenými.

(function () {
  const S = window.LabSlTp;
  const O = window.LabOverview;
  const { esc, pct, num, signedNum, metric, sampleNote, sections } = window.LabUI;

  const TIER_LABEL = { nt8: 'NT8', manual: 'ručně', derived: 'dopočteno' };

  // Naměřená hodnota normálně; dopočtená šedě s poznámkou; chybějící pomlčka.
  function excursionCell(measured, raw, tier) {
    if (measured != null) return `${num(measured)}<span class="tier">${esc(TIER_LABEL[tier] || '')}</span>`;
    if (tier === 'derived') return `<span class="derived" title="Dopočteno z výstupní ceny – do výpočtu nevstupuje">${num(raw)} dop.</span>`;
    return '—';
  }

  const TAG_CLASS = { 'sl-wide': 'v-wide', 'sl-tight': 'v-tight', 'sl-short': 'v-short', entry: 'v-entry', 'tp-close': 'v-close', unknown: 'v-unknown', 'no-sl': 'v-unknown' };

  function tradeTable(res) {
    const rows = [...res.trades].sort((a, b) => ((b.record.date || '') + (b.record.entryTime || '')).localeCompare((a.record.date || '') + (a.record.entryTime || '')));
    const body = rows.map(row => {
      const r = row.record;
      const tag = row.verdict.tags.map(t => TAG_CLASS[t]).find(Boolean) || '';
      const tight = row.tight ? `<span class="pill ${row.tight === 'nestačil' ? 'fail' : 'warn'}">${esc(row.tight)}</span>` : '';
      const plan = row.plannedR != null ? `${num(row.plannedR)} R` : '—';
      return `<tr>
        <td class="mono">${esc(r.date || '—')}<div class="muted">${esc(r.entryTime || '')}</div></td>
        <td>${r.side ? `<span class="pill side ${esc(r.side)}">${esc(r.side)}</span>` : ''}<div class="muted">${esc(r.result || '')}</div></td>
        <td class="num">${num(row.slTicks)}</td>
        <td class="num">${excursionCell(row.mae, row.maeRaw, row.maeTier)}</td>
        <td class="num">${num(row.reserve)} ${tight}</td>
        <td class="num">${row.widerBy != null ? '+' + num(row.widerBy) : '—'}</td>
        <td class="num">${num(row.returned)}</td>
        <td class="num">${num(row.leftOnTable)}</td>
        <td class="num">${excursionCell(row.mfe, row.mfeRaw, row.mfeTier)}</td>
        <td class="num">${plan}<div class="muted">${row.actualR != null ? signedNum(Math.round(row.actualR * 100) / 100) + ' R' : '—'}</div></td>
        <td class="verdict ${tag}">${esc(row.verdict.text)}</td>
      </tr>`;
    }).join('');
    return {
      id: 'trades', letter: '1', title: 'Po obchodech – verdikt ke každému',
      state: res.n ? 'ok' : 'na', missing: 'obchody ve výkonovém vzorku',
      headline: esc(`${res.n} obchodů s verdiktem`),
      body: `<p class="section-sub">Vše v ticích. Prázdné zůstane prázdné, nikdy 0. Rezerva SL = SL − naměřené MAE (≤ 2 t „těsně“, ≤ 0 „nestačil“). „O kolik dál“ = maxAdverse − SL + 1 (přežití = cena SL nedosáhla), jen když je zapsaný pohyb po stopce. Ne každá ztráta je chyba SL.</p>
      <div class="table-scroll"><table class="trade-table"><thead><tr>
        <th>Datum</th><th>Směr</th><th class="num">SL</th><th class="num">MAE</th><th class="num">Rezerva SL</th><th class="num">O kolik dál</th>
        <th class="num">Vrátilo se</th><th class="num">Na stole</th><th class="num">MFE</th><th class="num">Plán / skut.</th><th>Verdikt</th>
      </tr></thead><tbody>${body}</tbody></table></div>`
    };
  }

  function maeCard(d) {
    const max = Math.max(1, ...d.histogram.map(b => b.count));
    const hist = d.histogram.map(b => `<div class="hbar"><span class="hlabel">${b.from}–${b.to} t</span><span class="htrack"><i style="width:${(b.count / max) * 100}%"></i></span><span class="hval">${b.count || ''}</span></div>`).join('');
    const st = O.maeState(d);
    return {
      id: 'mae', letter: '2', title: 'Kolik tepla musí SL unést – MAE u vítězů', state: st.state, missing: st.missing,
      headline: esc(st.headline),
      body: `<p class="section-sub">Naměřené MAE obchodů, které skončily ziskem. Nehledá maximum v mřížce, jen se ptá, kam cena proti šla u obchodů, které by vydělaly. ${sampleNote(d.n)}</p>
      <div class="metrics">
        ${metric('p50', num(d.p50) + ' t')}${metric('p75', num(d.p75) + ' t')}${metric('p90', num(d.p90) + ' t')}${metric('max', num(d.max) + ' t')}
        ${metric('Naměřeno', `${d.n} z ${d.winners}`, `dopočteno ${d.derived} · chybí ${d.missing} (nevstupují)`)}
      </div>
      ${d.slForP90 != null ? `<p class="statement">SL na <b>${num(d.slForP90)} t</b> (p90 + 1 t) přežije 90 % obchodů, které by vydělaly.</p>` : '<p class="muted">Bez naměřeného MAE vítězů nejde nic říct.</p>'}
      ${hist ? `<div class="histogram">${hist}</div>` : ''}`
    };
  }

  function mfeCard(d) {
    const ticks = d.byTicks.map(x => `<tr><td class="num">${x.tp} t</td><td class="num">${x.reach}</td><td class="num">${pct(x.pct)}</td></tr>`).join('');
    const rs = d.byR.map(x => `<tr><td class="num">${num(x.r)} R</td><td class="num">${x.reach} z ${x.n}</td><td class="num">${pct(x.pct)}</td></tr>`).join('');
    const st = O.mfeState(d);
    return {
      id: 'mfe', letter: '3', title: 'Bylo TP dosažitelné? – MFE u stopnutých', state: st.state, missing: st.missing,
      headline: esc(st.headline),
      body: `<p class="section-sub">Jak daleko došly stopnuté obchody, než se otočily (naměřené MFE během obchodu). Naměřeno ${d.n} z ${d.stopped} · dopočteno ${d.derived} · chybí ${d.missing}. ${sampleNote(d.n)}</p>
      <div class="two-col even">
        <div class="table-scroll"><table><thead><tr><th class="num">TP</th><th class="num">Stihlo</th><th class="num">%</th></tr></thead><tbody>${ticks}</tbody></table></div>
        <div class="table-scroll"><table><thead><tr><th class="num">TP v R (vlastní SL)</th><th class="num">Stihlo</th><th class="num">%</th></tr></thead><tbody>${rs}</tbody></table></div>
      </div>`
    };
  }

  function observationWarning(text) {
    return `<div class="obs-warning">⚠ ${text}</div>`;
  }

  const OBS_TEXT = 'maxAdverse sahá za stopku jen tak daleko, jak daleko ses po výstupu díval (postExitAdverseTicks, observedMinutes). Nad pozorovaným rozsahem je výsledek <b>dolní odhad</b> – širší SL vypadá lépe, než ve skutečnosti byl. Čím širší SL, tím víc to platí.';

  function sweepCard(sw) {
    const rows = sw.rows.map(r => `<tr>
      <td class="num"><b>${r.S} t</b></td><td class="num">${r.stopped} <span class="muted">(${pct(r.stoppedPct)})</span></td><td class="num">${r.survived}</td>
      <td class="num">${r.rescued}</td><td class="num">${r.rescuedToTarget}</td>
      <td class="num">${r.inWindow}</td><td class="num ${r.aboveObserved ? 'above' : ''}">${r.aboveObserved}</td></tr>`).join('');
    const st = O.sweepState(sw);
    return {
      id: 'sweep', letter: '4', title: 'SL sweep', state: st.state, missing: st.missing,
      headline: esc(st.headline),
      body: `<p class="section-sub">Pro každou šířku S: obchod přežije, pokud protipohyb &lt; S. U obchodu, který neskončil na SL, rozhoduje MAE během obchodu; u stopnutého pohyb za stopkou. Hodnotitelných ${sw.n} z ${sw.total}. ${sampleNote(sw.n, S.SWEEP_SAMPLE_WARN)}</p>
      ${observationWarning(OBS_TEXT)}
      <div class="table-scroll"><table><thead><tr>
        <th class="num">SL</th><th class="num">Vystopováno</th><th class="num">Přežilo</th><th class="num">Z dnešních stopek přežilo</th>
        <th class="num">…a došlo na ${num(sw.targetR)} R</th><th class="num">…v okně pozorování</th><th class="num">…nad pozorovaným rozsahem</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="font-size:12px">„Nad pozorovaným rozsahem“ = stopnutý obchod bez zapsaného pohybu po stopce: že by přežil, je jen předpoklad. „Došlo na cíl“ nezná pořadí uvnitř baru (jestli cena napřed nešla proti). Cíl v R se nastavuje vlevo.</p>`
    };
  }

  function heat(v) {
    if (v == null) return '';
    const a = Math.min(1, Math.abs(v) / 1);
    return v >= 0 ? `background:rgba(var(--green-rgb),${(0.1 + 0.5 * a).toFixed(2)})` : `background:rgba(var(--red-rgb),${(0.1 + 0.5 * a).toFixed(2)})`;
  }

  function gridCard(g) {
    const st = O.gridState(g);
    const meta = { id: 'grid', letter: '5', title: 'Mřížka SL × TP', state: st.state, missing: st.missing, headline: esc(st.headline) };
    if (st.state === 'na') return meta;
    const head = `<tr><th>TP \\ SL</th>${g.slList.map(s => `<th class="num">${s} t</th>`).join('')}</tr>`;
    const body = g.cells.map((row, i) => `<tr><th class="num">${num(g.tpList[i])} R</th>${row.map(c => {
      const cls = [c.stable ? 'stable' : '', c.stableCenter ? 'center' : '', c.peak ? 'peak' : ''].join(' ');
      return `<td class="num cell ${cls}" style="${heat(c.expectancyR)}" title="SL ${c.S} t, TP ${num(c.k)} R · expectancy ${num(c.expectancyR)} R · TP ${c.hits}× · SL ${c.stops}× · okolí ${num(c.neighborhood)} R">${signedNum(c.expectancyR == null ? null : Math.round(c.expectancyR * 100) / 100)}</td>`;
    }).join('')}</tr>`).join('');
    const above = `<tr><th class="muted">nad poz. rozsahem</th>${g.aboveObserved.map(n => `<td class="num ${n ? 'above' : 'muted'}">${n}</td>`).join('')}</tr>`;
    return {
      ...meta,
      body: `<p class="section-sub">Expectancy v R vůči kandidátnímu SL. Jen naměřené maximum proti i ve směru: maxAdverse ≥ SL → −SL; jinak max ≥ TP × SL → +TP × SL; jinak skutečný výsledek. ${sampleNote(g.n, S.SWEEP_SAMPLE_WARN)}</p>
      <div class="obs-warning">⚠ <b>Varování o vzorku:</b> mřížka nad ${g.n} obchody. Hledat v ní maximum je učebnicové přeoptimalizování – osamělý vrchol je šum, ne nastavení. Rámeček = stabilní oblast (nejlepší průměr přes okolí 3 × 3), ★ = maximum jedné buňky.${g.isolatedPeak ? ' <b>Maximum leží mimo stabilní oblast – je osamělé.</b>' : ''}</div>
      ${observationWarning(OBS_TEXT)}
      <div class="table-scroll"><table class="grid-table"><thead>${head}</thead><tbody>${body}${above}</tbody></table></div>
      <p class="muted" style="font-size:12px">Stabilní oblast kolem SL ${g.best.S} t / TP ${num(g.best.k)} R (průměr okolí ${signedNum(Math.round(g.best.neighborhood * 100) / 100)} R). Maximum buňky: SL ${g.peak.S} t / TP ${num(g.peak.k)} R (${signedNum(Math.round(g.peak.expectancyR * 100) / 100)} R). Nevstoupilo: ${g.total - g.n} obchodů bez naměřeného maxima${g.derivedExcluded ? `, z toho ${g.derivedExcluded} jen s dopočtenými hodnotami` : ''}. Lab nevybírá nastavení – vybíráš ty.</p>`
    };
  }

  function render(ctx) {
    const res = S.computeSlTp(ctx.perf, { targetR: ctx.views.sweepTargetR || 1 });
    const top = `<div class="card slim">
      <div class="hero-stats" style="margin:0">
        <span>Výkonový vzorek: <b>${res.n}</b> obchodů</span>
        <span>Dopočítáno, do výpočtu nevstupuje: MFE <b>${res.derived.mfe}</b> · MAE <b>${res.derived.mae}</b></span>
        <span>${sampleNote(res.n)}</span>
      </div></div>`;
    return top + sections('sltp', [tradeTable(res), maeCard(res.maeWinners), mfeCard(res.mfeStopped), sweepCard(res.sweep), gridCard(res.grid)], ctx.views);
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.sltp = { title: 'SL a TP', question: 'Zadávám správně SL a TP?', render };
})();
