'use strict';
// Obrazovka Co kdyby (docs/ZADANI_LAB_PRESTAVBA.md §3). Nahoře varianta
// (předvolby + čtyři sbalitelné bloky), dole výsledek vedle skutečnosti.
// Přepočet okamžitě při změně; varianta se pamatuje ve views.json (whatif).
// Jen vykresluje LabWhatIf.computeWhatIf – nic nepočítá.

(function () {
  const W = window.LabWhatIf;
  const DG = window.LabDiagnosis;
  const V = window.LabViews;
  const { esc, pct, num, usd, signClass, stateIcon, weeklyChart, equityChart } = window.LabUI;
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  // Znaménko až po zaokrouhlení – jinak „+0 R".
  const signedR = v => { if (v == null) return '—'; const x = Math.round(v * 100) / 100; return (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x)) + ' R'; };
  const SCREEN = 'whatif';

  function optionsOf(ctx) {
    return { ...ctx.options, unitUSD: ctx.views.riskUnitUSD };
  }
  function stateOf(views) {
    const wi = views.whatif || {};
    return { current: W.cleanConfig(wi.current || {}), saved: Array.isArray(wi.saved) ? wi.saved : [] };
  }

  // ------------------------------------------------------------- volby

  function block(id, title, headline, body, views) {
    const open = V.isOpen(views, SCREEN, id) ? ' open' : '';
    return `<details class="card section wi-block" data-section="${esc(id)}" data-screen="${SCREEN}"${open}>
      <summary><span class="section-title">${esc(title)}</span><span class="section-headline">${esc(headline)}</span></summary>
      <div class="section-body">${body}</div></details>`;
  }

  function numberInput(path, value, placeholder, step = '1') {
    return `<input type="number" min="0" step="${step}" data-wi="${esc(path)}" value="${value == null ? '' : esc(value)}" placeholder="${esc(placeholder)}">`;
  }

  function rulesBlock(cfg, res, views) {
    const r = cfg.rules;
    const unit = res.unit.usd;
    const row = (label, input, hint) => `<tr><td><b>${esc(label)}</b><div class="muted" style="font-size:11.5px">${esc(hint)}</div></td><td>${input}</td></tr>`;
    const body = `<table class="wi-form"><tbody>
      ${row('Max obchodů za den', numberInput('rules.maxTrades', r.maxTrades, 'vypnuto'), 'konec po N obchodech')}
      ${row('Konec po N SL za sebou', numberInput('rules.consecutiveSL', r.consecutiveSL, 'vypnuto'), 'jiný výsledek řadu přeruší')}
      ${row('Konec po N SL za den', numberInput('rules.dailySL', r.dailySL, 'vypnuto'), 'stoplossy za den celkem')}
      ${row('Konec po targetu', `<label class="toggle"><input type="checkbox" data-wi="rules.afterTarget"${r.afterTarget ? ' checked' : ''}> po prvním targetu dne</label>`, 'den končí prvním obchodem na cíli')}
      ${row('Denní limit ztráty', numberInput('rules.dailyLossUSD', r.dailyLossUSD, 'vypnuto', 'any') + ' $', 'konec, když P/L dne klesne na −X $')}
      ${row('Denní cíl', numberInput('rules.dailyTargetUSD', r.dailyTargetUSD, 'vypnuto', 'any') + ' $', 'konec, když P/L dne dosáhne +X $')}
      ${row('Vrácení zisku z maxima', numberInput('rules.giveBackUSD', r.giveBackUSD, 'vypnuto', 'any') + ' $', 'konec, když P/L dne klesne o X $ pod denní maximum')}
    </tbody></table>
    <p class="muted" style="font-size:12px">Prázdné = vypnuto. Pravidla se kombinují – den končí u prvního, které zabere. Počítá simulátor dne (Pokročilé → Denní risk); $ limity se převádí přes 1 R = ${esc(usd(unit, 2))} (${res.unit.overridden ? 'ručně' : `medián ztráty na SL, n ${res.unit.n}`}).</p>`;
    const head = Object.keys(r).length ? W.describeConfig({ rules: r }) : 'žádná';
    return block('rules', 'A) Pravidla dne', head, body, views);
  }

  function filtersBlock(cfg, ctx, views) {
    const base = DG.baseOf(ctx.records, ctx.options).trades;
    const counts = field => {
      const m = new Map();
      for (const r of base) { const k = DG.filterKeysOf(r)[field]; m.set(k, (m.get(k) || 0) + 1); }
      return m;
    };
    const fields = W.FILTER_FIELDS.map(field => {
      const c = DG.COMPARISONS.find(x => x.key === field);
      const n = counts(field);
      const out = cfg.exclude[field] || [];
      const choices = DG.groupChoices(base, field).filter(g => n.get(g.key) || out.includes(g.key));
      const chips = choices.map(g => `<label class="chip${out.includes(g.key) ? ' off' : ''}"><input type="checkbox" data-wi-ex="${esc(field)}" value="${esc(g.key)}"${out.includes(g.key) ? '' : ' checked'}>${esc(g.label)} <span class="muted">${n.get(g.key) || 0}</span></label>`).join('');
      return `<div class="wi-filter"><div class="wi-filter-title">${esc(c.title)}</div><div class="chips">${chips || '<span class="muted">bez dat</span>'}</div></div>`;
    }).join('');
    const body = `<p class="section-sub">Jen pole, která znáš <b>před vstupem</b>. Odškrtnutá skupina se nebere – den jede dál bez ní. Emoce a technika z poznámek sem nepatří: píšou se až po obchodu.</p>${fields}`;
    const off = Object.values(cfg.exclude).reduce((a, l) => a + l.length, 0);
    return block('filters', 'B) Které obchody brát', off ? `vyřazeno ${off} ${plural(off, 'skupina', 'skupiny', 'skupin')}` : 'všechny', body, views);
  }

  function radio(path, value, current, label, extra = '') {
    return `<label class="wi-radio"><input type="radio" name="${esc(path)}" data-wi="${esc(path)}" value="${esc(value)}"${current === value ? ' checked' : ''}> ${label}${extra}</label>`;
  }

  function slBlock(cfg, views) {
    const sl = cfg.sl;
    const t = sl.mode === 'actual' ? null : sl.ticks;
    const ticks = mode => (sl.mode === mode ? ` ${numberInput('sl.ticks', t, '2', 'any')} t` : '');
    const body = `<div class="wi-radios">
      ${radio('sl.mode', 'actual', sl.mode, 'jak jsem ho měl')}
      ${radio('sl.mode', 'wider', sl.mode, 'o X ticků širší', ticks('wider'))}
      ${radio('sl.mode', 'narrower', sl.mode, 'o X ticků užší', ticks('narrower'))}
      ${radio('sl.mode', 'fixed', sl.mode, 'pevně X ticků', ticks('fixed'))}
    </div>`;
    const head = sl.mode === 'actual' ? 'jak jsem ho měl' : W.describeConfig({ sl });
    return block('sl', 'C) SL', head, body, views);
  }

  function targetBlock(cfg, views) {
    const t = cfg.target;
    const k = (path, v) => numberInput(path, v, '', '0.25');
    const body = `<div class="wi-radios">
      ${radio('target.mode', 'actual', t.mode, 'jak jsem ho měl')}
      ${radio('target.mode', 'r', t.mode, 'jeden cíl k × R', t.mode === 'r' ? ` k = ${k('target.k', t.k)}` : '')}
      ${radio('target.mode', 'planned', t.mode, 'plánovaný cíl na hladině')}
      ${radio('target.mode', 'split', t.mode, 'rozdělení: 1. kontrakt k1 × R, 2. kontrakt k2 × R, po TG1 SL 2. kontraktu na BE',
        t.mode === 'split' ? ` k1 = ${k('target.k1', t.k1)} k2 = ${k('target.k2', t.k2)}` : '')}
    </div>
    <p class="muted" style="font-size:12px">Konzervativně: když pořadí neznáme, počítá se horší výsledek. Rozhodují naměřené MFE / MAE a pohyb po výstupu; co nejde rozhodnout, je „nerozhodnuto“ a do P/L nevstupuje (vedle je nejhorší případ = −1 R).</p>`;
    const head = t.mode === 'actual' ? 'jak jsem ho měl' : W.describeConfig({ target: t });
    return block('target', 'D) Cíl', head, body, views);
  }

  // ------------------------------------------------------------- výsledek

  function resultTable(res, saved) {
    const cols = [{ label: 'Skutečnost', s: res.actual, actual: true }, { label: 'Varianta', s: res.variant, res }]
      .concat(saved.map(x => ({ label: `Uložená ${x.i + 1}`, s: x.res.variant, res: x.res, title: W.describeConfig(x.cfg) })));
    const row = (label, f, strong) => `<tr${strong ? ' class="strong"' : ''}><td>${strong ? `<b>${esc(label)}</b>` : esc(label)}</td>${cols.map(c => `<td class="num">${f(c)}</td>`).join('')}</tr>`;
    const money = (v, dec = 1) => `<span class="${signClass(v)}">${esc(usd(v, dec))}</span>`;
    const head = `<tr><th></th>${cols.map(c => `<th class="num"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>`;
    const body = [
      row('Obchodů', c => String(c.s.n)),
      row('Nerozhodnuto (C, D)', c => (c.actual ? '—' : String(c.s.undecided))),
      row('Win %', c => esc(pct(c.s.winRate))),
      row('Průměrná výhra / ztráta R', c => esc(`${signedR(c.s.avgWinR)} / ${signedR(c.s.avgLossR)}`)),
      row('Expectancy R', c => esc(`${signedR(c.s.expectancyR)}`) + ` <span class="muted">n ${c.s.rN}</span>`),
      row('P/L $', c => money(c.s.pnl) + (!c.actual && c.s.undecided ? `<div class="muted" style="font-size:11px">nejhůř ${esc(usd(c.res.worst.pnl, 1))}</div>` : ''), true),
      row('Poplatky $', c => money(-c.s.fees)),
      row('Max drawdown $', c => money(-c.s.maxDrawdown)),
      row('Nejhorší den $', c => money(c.s.worstDay)),
      row('Ziskových dnů', c => `${c.s.profitableDays} / ${c.s.days}`),
      row('Rozdíl proti skutečnosti $', c => (c.actual ? '—' : money(c.s.diff)), true),
      // Bez nerozhodnutých obchodů na obou stranách – čistý účinek varianty.
      cols.some(c => !c.actual && c.s.undecided)
        ? row('Rozdíl na stejných obchodech $', c => (c.actual ? '—' : c.s.undecided ? money(c.s.diffSame) + `<div class="muted" style="font-size:11px">bez ${c.s.undecided} nerozhodnutých</div>` : money(c.s.diff)))
        : ''
    ].join('');
    return `<div class="table-scroll"><table class="wi-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function cutBlock(res) {
    const c = res.cut;
    const part = (label, x) => (x.n ? `<li><b>${esc(label)}:</b> ${x.n} ${plural(x.n, 'obchod', 'obchody', 'obchodů')} – ušetřené ztráty <span class="pos">${esc(usd(x.saved))}</span> (${x.savedN}), zahozené zisky <span class="neg">${esc(usd(-x.forgone))}</span> (${x.forgoneN}), čistě ${esc(usd(x.saved - x.forgone))}</li>` : '');
    const changed = c.changed.n ? `<li><b>Jiný SL / cíl (C, D):</b> ${c.changed.n} ${plural(c.changed.n, 'obchod', 'obchody', 'obchodů')} s jiným výsledkem, rozdíl ${esc(usd(c.changed.diff))}</li>` : '';
    const items = part('Filtry B', c.filter) + part('Pravidla dne A', c.rules) + changed;
    return items ? `<ul class="wi-cut">${items}</ul>` : '<p class="muted">Varianta žádný obchod neodřízla ani nezměnila.</p>';
  }

  function render(ctx) {
    const st = stateOf(ctx.views);
    const cfg = st.current;
    const opts = optionsOf(ctx);
    const res = W.computeWhatIf(ctx.records, cfg, opts);
    if (!res.trades) return '<div class="card empty-state">Ve výběru nejsou žádné obchody s P/L.</div>';
    const saved = st.saved.map((c, i) => (c ? { i, cfg: W.cleanConfig(c), res: W.computeWhatIf(ctx.records, c, opts) } : null)).filter(Boolean);

    const presets = `<div class="card wi-presets">
      <div class="sum-head"><span class="sum-title">Rychlé předvolby</span><span class="muted sum-sub">jen vyplní volby níže, dají se kombinovat</span></div>
      <div class="btn-row">${W.PRESETS.map(p => `<button type="button" class="btn" data-wi-preset="${esc(p.key)}">${esc(p.label)}</button>`).join('')}
        <button type="button" class="btn" data-wi-reset="1">Vynulovat variantu</button></div>
      <p class="wi-current"><b>Varianta:</b> ${esc(W.describeConfig(cfg))}</p>
    </div>`;

    const dates = res.actual.dayPnl.map(d => d.date);
    const series = [{ label: 'Skutečnost', cls: 's-actual', s: res.actual }, { label: 'Varianta', cls: 's-variant', s: res.variant }]
      .concat(saved.map(x => ({ label: `Uložená ${x.i + 1}`, cls: `s-saved${x.i + 1}`, s: x.res.variant })));
    const v = res.variant;
    const sameNote = v.undecided
      ? ` Na stejných obchodech bez ${v.undecided} nerozhodnutých by to bylo <b class="${signClass(v.pnl)}">${esc(usd(v.pnl))}</b> místo <b class="${signClass(res.same.pnl)}">${esc(usd(res.same.pnl))}</b> (rozdíl ${esc(usd(v.diffSame))}).`
      : '';
    const fact = res.changed || res.rulesActive || res.filtersOn
      ? (v.undecided
        ? `Kdyby platila tahle varianta: ${v.n} rozhodnutých obchodů dá <b class="${signClass(v.pnl)}">${esc(usd(v.pnl))}</b>, skutečnost všech ${res.actual.n} obchodů je <b class="${signClass(res.actual.pnl)}">${esc(usd(res.actual.pnl))}</b>.${sameNote}`
        : `Kdyby platila tahle varianta, P/L by bylo <b class="${signClass(v.pnl)}">${esc(usd(v.pnl))}</b> místo <b class="${signClass(res.actual.pnl)}">${esc(usd(res.actual.pnl))}</b> (${v.n} z ${res.actual.n} obchodů).`)
      : 'Varianta je zatím beze změny – vyber předvolbu nebo volbu nahoře.';
    const overfit = res.filtersOn
      ? '<div class="obs-warning">⚠ Filtry a pravidla nastavené na stejných datech vypadají vždy líp, než budou dál. Ověř na nových obchodech.</div>'
      : '';
    const undecided = res.undecidedNote
      ? `<div class="obs-warning">⚠ ${esc(res.undecidedNote)} Důvody: ${esc(res.undecidedReasons.map(x => `${x.label} ${x.n}`).join(' · '))}.
          ${window.LabDiagnosisUI.tradesDetails(res.undecidedRecords, 'Nerozhodnuté obchody')}</div>`
      : '';
    const legacy = res.legacy && res.changed ? `<p class="muted" style="font-size:12px">${res.legacy} legacy obchodů je při jiném SL / cíli nerozhodnuto – jejich ticky mají nejistou konvenci (do $ vstupují jen tak, jak proběhly).</p>` : '';

    const result = `<div class="card wi-result">
      <div class="sum-head">${stateIcon(res.state)}<span class="sum-title">Výsledek vedle skutečnosti</span>
        <span class="muted sum-sub">${res.days} ${plural(res.days, 'den', 'dny', 'dnů')} · ${res.trades} obchodů${res.legacy ? `, z toho ${res.legacy} legacy` : ''}</span></div>
      <p class="statement">${res.state === 'weak' && (res.changed || res.rulesActive || res.filtersOn) ? 'Předběžně: ' : ''}${fact}</p>
      ${overfit}${undecided}${legacy}
      ${resultTable(res, saved)}
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn" data-wi-save="0">Uložit jako 1</button>
        <button type="button" class="btn" data-wi-save="1">Uložit jako 2</button>
        ${saved.map(x => `<button type="button" class="btn" data-wi-drop="${x.i}">Smazat uloženou ${x.i + 1}</button>`).join('')}
        <button type="button" class="btn" data-wi-copy="1">Zkopírovat jako text</button>
        <span class="muted" id="wiCopied" style="font-size:12px;align-self:center"></span>
      </div>
      ${saved.length ? `<p class="muted" style="font-size:12px">${saved.map(x => `Uložená ${x.i + 1}: ${esc(W.describeConfig(x.cfg))}`).join('<br>')}</p>` : ''}
      <div class="sub-title">Drží to?</div>
      <p>${esc(res.holds.text)}</p>
      <div class="sub-title">Co varianta odřízla</div>
      ${cutBlock(res)}
      <div class="sub-title">Equity v $</div>
      ${equityChart(series.map(x => ({ label: x.label, cls: x.cls, values: x.s.dayPnl.map(d => d.pnl) })), dates)}
      <div class="sub-title">P/L po týdnech</div>
      ${weeklyChart(series.slice(0, 2).map(x => ({ label: x.label, cls: x.cls, weeks: x.s.weekly })))}
    </div>`;

    return presets
      + `<div class="wi-blocks">${rulesBlock(cfg, res, ctx.views)}${filtersBlock(cfg, ctx, ctx.views)}${slBlock(cfg, ctx.views)}${targetBlock(cfg, ctx.views)}</div>`
      + result;
  }

  // ------------------------------------------------------------- události

  function update(api, fn) {
    const st = stateOf(api.views);
    const next = { ...(api.views.whatif || {}), current: W.cleanConfig(fn(JSON.parse(JSON.stringify(st.current)))) };
    api.setView('whatif', next);
    api.render();
  }

  function setPath(cfg, path, value) {
    const [group, key] = path.split('.');
    if (group === 'rules') {
      if (value == null) delete cfg.rules[key]; else cfg.rules[key] = value;
    } else if (key === 'mode') {
      const prev = cfg[group];
      if (group === 'sl') cfg.sl = value === 'actual' ? { mode: 'actual' } : { mode: value, ticks: prev.ticks || 2 };
      else cfg.target = { ...prev, mode: value };
    } else cfg[group] = { ...cfg[group], [key]: value };
    return cfg;
  }

  function onChange(e, api) {
    const el = e.target;
    if (el.dataset.wiEx) {
      const field = el.dataset.wiEx;
      update(api, cfg => {
        const out = new Set(cfg.exclude[field] || []);
        if (el.checked) out.delete(el.value); else out.add(el.value);
        cfg.exclude[field] = [...out];
        return cfg;
      });
      return true;
    }
    const path = el.dataset.wi;
    if (!path) return false;
    let value;
    if (el.type === 'checkbox') value = el.checked ? 1 : null;
    else if (el.type === 'radio') value = el.value;
    else {
      const n = el.value.trim() === '' ? NaN : Number(el.value.replace(',', '.'));
      value = Number.isFinite(n) && n > 0 ? n : null;
    }
    update(api, cfg => setPath(cfg, path, value));
    return true;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
  }

  function onClick(e, api, ctx) {
    const btn = e.target.closest && e.target.closest('[data-wi-preset],[data-wi-reset],[data-wi-save],[data-wi-drop],[data-wi-copy]');
    if (!btn) return false;
    const d = btn.dataset;
    const wi = { ...(api.views.whatif || {}) };
    if (d.wiPreset) { update(api, cfg => W.applyPreset(cfg, d.wiPreset)); return true; }
    if (d.wiReset) { update(api, () => W.defaultConfig()); return true; }
    if (d.wiSave || d.wiDrop) {
      const saved = [0, 1].map(i => (wi.saved && wi.saved[i]) || null);
      if (d.wiSave) saved[Number(d.wiSave)] = stateOf(api.views).current;
      else saved[Number(d.wiDrop)] = null;
      wi.saved = saved;
      api.setView('whatif', wi);
      api.render();
      return true;
    }
    if (d.wiCopy && ctx) {
      const res = W.computeWhatIf(ctx.records, stateOf(api.views).current, optionsOf(ctx));
      copyText(W.textSummary(res)).then(() => {
        const el = document.getElementById('wiCopied');
        if (el) el.textContent = 'Zkopírováno do schránky.';
      }, () => {
        const el = document.getElementById('wiCopied');
        if (el) el.textContent = 'Schránka není dostupná.';
      });
      return true;
    }
    return false;
  }

  function scope(ctx) {
    const b = DG.baseOf(ctx.records, ctx.options);
    return { n: b.trades.length, note: `obchodů za ${b.days} ${plural(b.days, 'den', 'dny', 'dnů')}${b.legacy ? `, z toho ${b.legacy} legacy` : ''}` };
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.whatif = { title: 'Co kdyby', question: 'Co by udělala jiná pravidla dne, jiný cíl nebo SL', render, scope, onChange, onClick };
})();
