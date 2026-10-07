'use strict';
// Obrazovka „Denní risk – pomáhá denní stop, nebo jen zmenšuje rozptyl?".
// Fáze 3, krok 1: jen sekvenční analýza (LabSequence.computeSequence).
// Verdikt jednou větou nahoře – rozhoduje o tom, jak číst simulátor
// a mřížku variant, které přijdou pod něj.

(function () {
  const SQ = window.LabSequence;
  const O = window.LabOverview;
  const { esc, pct, num, czDate, metric, sampleNote, SAMPLE_GREY, sections } = window.LabUI;

  function options(ctx) {
    return ctx.options;
  }

  function heroCard(res, ctx, st) {
    const b = res.base;
    const cls = res.verdict.kind === 'clustered' ? 'warn-card' : '';
    const pill = { random: 'NÁHODNÉ', clustered: 'SHLUKOVÁNÍ', alternating: 'STŘÍDÁNÍ', insufficient: 'MÁLO DAT' }[res.verdict.kind];
    const notes = [];
    if (b.legacy) notes.push(`${b.legacy} legacy obchodů započteno (výsledek u nich platí, nejistá je jen konvence bodů)`);
    if (b.excluded.breakeven) notes.push(`${b.excluded.breakeven} breakeven vynecháno`);
    if (b.excluded.other) notes.push(`${b.excluded.other} s jiným výsledkem vynecháno`);
    if (b.skipLive) notes.push(`${b.skipLive} „naživo bych nevzal“ započteno`);
    if (b.hypothetical) notes.push(`${b.hypothetical} hypotetických (no fill / vynechané) započteno`);
    if (b.noTime) notes.push(`${b.noTime} bez času vstupu (řazeno podle pořadí v deníku)`);
    return {
      id: 'verdict', title: 'Shlukují se ztráty?', cls, state: st.state, missing: st.missing,
      headline: `<span class="pill ${res.verdict.kind === 'insufficient' ? 'warn' : 'tag'}">${pill}</span> ${esc(res.verdict.text)}`,
      body: `<div class="metrics" style="margin-top:4px">
        ${metric('Obchodů W/L', String(res.n), `celkem ${b.trades} obchodů`)}
        ${metric('Dnů', String(b.days), 'denní pravidlo pracuje se dny')}
        ${metric('Win rate', pct(res.conditional.overall.rate), `${res.runs.wins} zisků / ${res.runs.losses} ztrát`)}
        ${metric('Runs test z', res.runs.z == null ? '—' : SQ.fmtZ(res.runs.z), res.runs.valid ? 'záporné = shlukování' : 'nelze vyhodnotit')}
      </div>
      <p class="muted" style="font-size:12.5px">${sampleNote(res.n)}${notes.length ? ' · ' + esc(notes.join(' · ')) : ''}</p>`
    };
  }

  function runsCard(res, st) {
    const r = res.runs;
    return {
      id: 'runs', title: 'Runs test', state: st.state, missing: st.missing,
      headline: esc(`${r.runs} sérií, při náhodě ${r.expected == null ? '—' : num(Math.round(r.expected * 100) / 100)} · z = ${r.z == null ? '—' : SQ.fmtZ(r.z)}`),
      body: `<p class="section-sub">Je střídání zisků a ztrát náhodnější, nebo shlukovanější, než odpovídá tvému win rate? Celá sekvence v čase, přes dny; breakeven nevstupuje.</p>
      <div class="metrics">
        ${metric('Sérií ve skutečnosti', String(r.runs))}
        ${metric('Očekávaných při náhodě', r.expected == null ? '—' : num(Math.round(r.expected * 100) / 100))}
        ${metric('z', r.z == null ? '—' : SQ.fmtZ(r.z), `|z| ≥ ${num(SQ.Z_SIGNIFICANT)} = průkazné`)}
      </div>
      ${r.reason ? `<div class="obs-warning">⚠ ${esc(r.reason)}</div>` : ''}
      <p class="muted" style="font-size:12px">Méně sérií než při náhodě (z &lt; 0) = zisky i ztráty chodí v blocích. Víc sérií (z &gt; 0) = střídají se.</p>`
    };
  }

  // Obchodů W/L pod SAMPLE_GREY – z tak malého vzorku se nedá nic vyvodit (stejný práh jako hlavička).
  const seqMissing = res => `${SAMPLE_GREY - res.n} ${O.plural(SAMPLE_GREY - res.n, 'obchod', 'obchody', 'obchodů')} W/L do ${SAMPLE_GREY} (je ${res.n})`;

  function permutationCard(res) {
    const p = res.permutation;
    return {
      id: 'perm', title: 'Nejdelší série proti náhodě', state: O.bySample(res.n), missing: seqMissing(res),
      headline: esc(`nejdelší série ztrát ${res.longestLoss} · náhoda ji vyrobí v ${p.p == null ? '—' : pct(p.p)}`),
      body: `<p class="section-sub">Pořadí týchž obchodů zamíchané ${p.iterations.toLocaleString('cs-CZ')}×. Jak často náhoda vyrobí stejně dlouhou nebo delší sérii ztrát jako tvoje nejdelší?</p>
      <div class="metrics">
        ${metric('Nejdelší série ztrát', String(res.longestLoss))}
        ${metric('Nejdelší série zisků', String(res.longestWin))}
        ${metric('Náhoda ji vyrobí', p.p == null ? '—' : pct(p.p), `${p.atLeast.toLocaleString('cs-CZ')} z ${p.iterations.toLocaleString('cs-CZ')} zamíchání`)}
      </div>
      <p class="muted" style="font-size:12px">Vysoké procento = tak dlouhá série ztrát je při tvém win rate běžná, ne známka „špatného dne“.</p>`
    };
  }

  function conditionalCard(res) {
    const c = res.conditional;
    const base = c.overall.rate;
    const row = (label, x) => {
      const diff = x.rate == null || base == null ? null : x.rate - base;
      const rate = x.rate == null ? (x.n ? `${x.wins} z ${x.n}` : '—') : pct(x.rate);
      const diffText = diff == null ? '—' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.abs(Math.round(diff * 100)) + ' p. b.';
      return `<tr class="${x.n < SAMPLE_GREY ? 'grey' : ''}"><td>${esc(label)}</td><td class="num">${x.n}</td><td class="num">${rate}</td><td class="num">${diffText}</td></tr>`;
    };
    const after1 = c.afterLosses[0];
    return {
      id: 'cond', title: 'Podmíněný win rate', state: O.bySample(res.n), missing: seqMissing(res),
      headline: esc(`celkem ${pct(base)} · po 1 ztrátě ${after1.rate == null ? (after1.n ? `${after1.wins} z ${after1.n}` : '—') : pct(after1.rate)}`),
      body: `<p class="section-sub">Jaký je win rate obchodu po 1, 2, 3 ztrátách za sebou – a po 1, 2, 3 ziscích? Počítá se uvnitř dne (série se na začátku dne nuluje), protože denní pravidlo vidí jen svůj den. Ploché řádky = žádné shlukování.</p>
      <div class="table-scroll"><table><thead><tr><th>Obchod</th><th class="num">N</th><th class="num">Win rate</th><th class="num">Proti celku</th></tr></thead><tbody>
        ${row('Všechny obchody', c.overall)}
        ${row('První obchod dne', c.firstOfDay)}
        ${c.afterLosses.map(x => row(`Po ${x.k} ${x.k === 1 ? 'ztrátě' : 'ztrátách'} za sebou`, x)).join('')}
        ${c.afterWins.map(x => row(`Po ${x.k} ${x.k === 1 ? 'zisku' : 'ziscích'} za sebou`, x)).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:12px">Pod ${SQ.NO_PCT_BELOW} případy bez procent – procento ze dvou případů není údaj. Šedě N &lt; ${SAMPLE_GREY}. Řádky se nesčítají – obchod po 3 ztrátách je zároveň i „po 1“ a „po 2“.</p>`
    };
  }

  // ------------------------------------------------------------- krok 2: simulátor dne

  const DS = window.LabDaySim;
  const RULE_FIELDS = [
    { key: 'dailyLoss', view: 'riskDailyLoss', label: 'Denní ztrátový limit', unit: 'R', hint: 'konec dne při −X' },
    { key: 'consecutiveSL', view: 'riskConsecutiveSL', label: 'Max SL za sebou', unit: '×', hint: 'konec po N stoplossech v řadě' },
    { key: 'dailySL', view: 'riskDailySL', label: 'Max SL za den', unit: '×', hint: 'konec po N stoplossech celkem' },
    { key: 'maxTrades', view: 'riskMaxTrades', label: 'Max obchodů za den', unit: '×', hint: 'konec po N obchodech' },
    { key: 'dailyTarget', view: 'riskDailyTarget', label: 'Denní cíl', unit: 'R', hint: 'konec dne při +X' },
    { key: 'giveBack', view: 'riskGiveBack', label: 'Vrácení zisku', unit: 'R', hint: 'konec, když P/L klesne o X pod denní maximum' }
  ];
  const REASON_TEXT = {
    dailyLoss: 'ztrátový limit', consecutiveSL: 'SL za sebou', dailySL: 'SL za den', maxTrades: 'max obchodů',
    dailyTarget: 'denní cíl', giveBack: 'vrácení zisku', hardDailyLoss: 'tvrdý denní limit', trailingDrawdown: 'trailing drawdown'
  };

  const r2 = v => Math.round(v * 100) / 100;
  // Znaménko až po zaokrouhlení – jinak vyjde „−0 R“ z plovoucí čárky.
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
  const fmtR = v => (v == null ? '—' : sign(r2(v)) + num(Math.abs(r2(v))) + ' R');
  const fmtUsd = (v, k) => (v == null || !k ? '' : sign(Math.round(v * k)) + Math.abs(Math.round(v * k)).toLocaleString('cs-CZ') + ' USD');
  const both = (v, k) => `${fmtR(v)}${k ? ` <span class="muted">${fmtUsd(v, k)}</span>` : ''}`;
  // Velikost bez znaménka (ušetřeno / zahozeno).
  const amount = (v, k) => `${num(r2(v))} R${k ? ` <span class="muted">${Math.round(v * k).toLocaleString('cs-CZ')} USD</span>` : ''}`;

  function rulesFromViews(views) {
    const out = {};
    for (const f of RULE_FIELDS) out[f.key] = views[f.view];
    return out;
  }

  // USD za 1 R pro zvolenou velikost pozice (deník počítá s jeho typickou).
  function usdPerR(sim, views) {
    if (sim.unit.usd == null) return null;
    const pos = views.riskPosition;
    return pos && sim.contracts ? sim.unit.usd * pos / sim.contracts : sim.unit.usd;
  }

  function input(view, value, placeholder, step = 'any') {
    return `<input type="number" min="0" step="${step}" data-view="${esc(view)}" value="${value == null ? '' : esc(value)}" placeholder="${esc(placeholder)}" style="width:96px">`;
  }

  function setupCard(sim, ctx) {
    const v = ctx.views;
    const k = usdPerR(sim, v);
    const instruments = sim.instrumentCounts.map(x => `${x.instrument} ${x.n}`).join(' · ');
    const mixed = sim.instrumentCounts.length > 1
      ? `<div class="obs-warning">⚠ Deník míchá instrumenty (${esc(instruments)}). 1 R je medián ztráty přes všechny a jeden velký obchod na jiném instrumentu může nést celý výsledek. Zúžit jde filtrem instrumentu vlevo.</div>`
      : '';
    const rows = RULE_FIELDS.map(f => {
      const val = v[f.view];
      const usd = f.unit === 'R' && val && k ? `= ${Math.round(val * k).toLocaleString('cs-CZ')} USD` : '';
      return `<tr><td><b>${esc(f.label)}</b><div class="muted" style="font-size:11.5px">${esc(f.hint)}</div></td>
        <td>${input(f.view, val, 'vypnuto', f.unit === 'R' ? '0.5' : '1')} <span class="muted">${esc(f.unit)}</span></td>
        <td class="muted">${usd}</td></tr>`;
    }).join('');
    return `<div>
      <p class="section-sub">Skutečný sled obchodů den po dni, znovu pod pravidlem. Pravidlo nemění ceny – jen odřízne konec dne. Posuzuje se podle rozdílu mezi ušetřenými ztrátami a zahozenými zisky.</p>
      <div class="metrics">
        ${metric('Dnů', String(sim.days.length), sim.enoughDays ? '' : `pod ${DS.MIN_DAYS} dnů jen popis`)}
        ${metric('Instrument', sim.instruments.join(', ') || '—', `${sim.trades} obchodů`)}
        ${metric('Velikost pozice', sim.contracts == null ? '—' : `${num(v.riskPosition || sim.contracts)} ks`, v.riskPosition ? `v deníku typicky ${num(sim.contracts)}` : 'typicky v deníku')}
        ${metric('1 R', k == null ? '—' : `${num(r2(k))} USD`, sim.unit.overridden ? `ručně · auto ${num(r2(sim.unit.auto))} USD` : `medián ztráty na SL (${sim.unit.n})`)}
      </div>
      ${mixed}
      ${sim.missingPnl ? `<div class="obs-warning">⚠ ${sim.missingPnl} obchodů bez pnlRaw se nedá přehrát – do simulace nevstupují.</div>` : ''}
      <div class="two-col even">
        <div class="table-scroll"><table><thead><tr><th>Pravidlo</th><th>Hodnota</th><th></th></tr></thead><tbody>${rows}</tbody></table>
          <p class="muted" style="font-size:12px">Prázdné = vypnuto. Pravidla se kombinují – den končí u prvního, které zabere. Limity v R; „SL za sebou“ přeruší jakýkoli jiný výsledek, i breakeven.</p></div>
        <div>
          <table><tbody>
            <tr><td>1 R v USD</td><td>${input('riskUnitUSD', v.riskUnitUSD, sim.unit.auto == null ? '' : r2(sim.unit.auto))}</td></tr>
            <tr><td>Velikost pozice (kontraktů)</td><td>${input('riskPosition', v.riskPosition, sim.contracts == null ? '' : sim.contracts, '1')}</td></tr>
            <tr><td>Velikost účtu (USD)</td><td>${input('riskAccount', v.riskAccount, 'volitelné', '100')}</td></tr>
          </tbody></table>
          <p class="muted" style="font-size:12px">Počítá se v R, USD se jen zobrazuje. Velikost pozice mění jen přepočet na USD. 1 R a pozice platí pro zvolený deník – při změně deníku se vrátí na výchozí.</p>
        </div>
      </div>
    </div>`;
  }

  function resultCard(sim, ctx) {
    const k = usdPerR(sim, ctx.views);
    const acc = ctx.views.riskAccount;
    const ofAcc = v => (acc && k && v != null ? ` <span class="muted">(${num(r2(v * k / acc * 100))} % účtu)</span>` : '');
    const a = sim.none, b = sim.rule;
    if (!sim.active) {
      return `<div style="margin-top:18px">
        <h2>Skutečnost <span class="muted" style="font-weight:400">· žádné pravidlo</span></h2>
        <div class="metrics">
          ${metric('Celkové P/L', fmtR(a.totalR), fmtUsd(a.totalR, k))}
          ${metric('Max drawdown', fmtR(-a.maxDrawdownR), fmtUsd(-a.maxDrawdownR, k))}
          ${metric('Nejhorší den', fmtR(a.worstDayR), fmtUsd(a.worstDayR, k))}
          ${metric('Nejlepší den', fmtR(a.bestDayR), fmtUsd(a.bestDayR, k))}
          ${metric('Ziskových dnů', `${a.profitableDays} / ${a.days}`)}
        </div>
        <p class="muted">Zadej pravidlo nahoře – výsledek se postaví vedle skutečnosti.</p>
      </div>`;
    }
    const row = (label, x, y, d, strong = false) => `<tr${strong ? ' class="strong"' : ''}><td>${strong ? `<b>${esc(label)}</b>` : esc(label)}</td><td class="num">${x}</td><td class="num">${y}</td><td class="num">${d}</td></tr>`;
    const diff = (x, y) => both(y - x, k);
    const netCls = sim.netR > 0 ? 'pos' : sim.netR < 0 ? 'neg' : '';
    const top = sim.topDays.length
      ? `Bez ${sim.topDays.length === 1 ? 'dne' : 'dvou dnů'}, které pravidlo změnilo nejvíc (${sim.topDays.map(d => esc(czDate(d.date))).join(', ')}), by čistý přínos byl <b>${both(sim.netWithoutTopR, k)}</b>.`
      : '';
    return `<div style="margin-top:18px">
      <h2>Bez pravidla vs. pod pravidlem</h2>
      <p class="section-sub">N = <b>${sim.days.length} dnů</b> (pravidlo pracuje se dny, ne s obchody). ${sim.enoughDays ? '' : `<span class="sample warn">⚠ pod ${DS.MIN_DAYS} dnů – jen popis toho, co se stalo, ne základ pro nastavení</span>`}</p>
      <div class="table-scroll"><table><thead><tr><th></th><th class="num">Bez pravidla</th><th class="num">Pod pravidlem</th><th class="num">Rozdíl</th></tr></thead><tbody>
        ${row('Celkové P/L', both(a.totalR, k), both(b.totalR, k), diff(a.totalR, b.totalR))}
        ${row('Max drawdown', both(-a.maxDrawdownR, k) + ofAcc(a.maxDrawdownR), both(-b.maxDrawdownR, k) + ofAcc(b.maxDrawdownR), diff(-a.maxDrawdownR, -b.maxDrawdownR))}
        ${row('Nejhorší den', both(a.worstDayR, k) + ofAcc(-a.worstDayR), both(b.worstDayR, k) + ofAcc(-b.worstDayR), diff(a.worstDayR, b.worstDayR))}
        ${row('Nejlepší den', both(a.bestDayR, k), both(b.bestDayR, k), diff(a.bestDayR, b.bestDayR))}
        ${row('Ziskových dnů', `${a.profitableDays} / ${a.days}`, `${b.profitableDays} / ${b.days}`, sign(b.profitableDays - a.profitableDays) + Math.abs(b.profitableDays - a.profitableDays))}
        ${row('Dnů utnutých pravidlem', '—', String(sim.cutDays), '')}
        ${row('Obchodů nevzato', '—', `${sim.skippedTrades} z ${a.trades}`, '')}
      </tbody></table></div>
      <div class="net-line ${netCls}" style="margin-top:14px;font-size:15px">
        Ušetřeno na zablokovaných ztrátách <b>${amount(sim.savedR, k)}</b> − zahozeno na zablokovaných ziscích <b>${amount(sim.forgoneR, k)}</b> = čistý přínos <b>${both(sim.netR, k)}</b>
      </div>
      <p class="muted" style="font-size:12.5px">${top} Denní stop drawdown sníží skoro vždycky – to není zjištění. Zjištění je, jestli za to nezaplatíš víc, než ušetříš.</p>
    </div>`;
  }

  function seqCells(d) {
    return d.trades.map((t, i) => {
      const res = t.record.result;
      const ch = res === 'target' ? 'W' : res === 'stoploss' ? 'L' : res === 'breakeven' ? 'B' : '·';
      const cls = t.taken ? (ch === 'W' ? 'pos' : ch === 'L' ? 'neg' : '') : 'muted';
      const style = t.taken ? '' : 'text-decoration:line-through;opacity:.55';
      return `<span class="mono ${cls}" style="${style}" title="${esc(t.record.entryTime || '')} · ${esc(fmtR(t.r))}">${ch}</span>${i === d.stopAfter && d.cut ? ' <b class="mono">┤</b>' : ''}`;
    }).join(' ');
  }

  function dayTable(sim, ctx) {
    if (!sim.days.length) return '';
    const k = usdPerR(sim, ctx.views);
    const rows = sim.days.map(d => `<tr class="${d.cut ? '' : 'grey'}">
      <td class="mono">${esc(czDate(d.date))}</td>
      <td>${seqCells(d)}</td>
      <td class="num">${both(d.actualR, k)}</td>
      <td class="num">${sim.active ? both(d.ruleR, k) : '—'}</td>
      <td class="num">${d.cut ? both(d.diffR, k) : '—'}</td>
      <td>${d.cut ? `po ${d.stopAfter + 1}. obchodu · ${esc(REASON_TEXT[d.reason] || d.reason)} · nevzato ${d.skipped}` : ''}</td>
    </tr>`).join('');
    return `<p class="section-sub">Co den udělal ve skutečnosti, co by udělal pod pravidlem a rozdíl – ať je vidět, jestli celkový výsledek nestojí na jednom dvou dnech. ┤ = konec dne podle pravidla, přeškrtnuté = nevzato. Šedě dny, které pravidlo nezměnilo.</p>
      <div class="table-scroll"><table><thead><tr><th>Den</th><th>Sled</th><th class="num">Skutečnost</th><th class="num">Pod pravidlem</th><th class="num">Rozdíl</th><th>Utnuto</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function simSections(ctx, va) {
    const sim = DS.simulate(ctx.records, rulesFromViews(ctx.views), { ...options(ctx), unitUSD: ctx.views.riskUnitUSD });
    const st = O.simState(sim, va);
    const head = { id: 'sim', title: 'Simulátor dne', state: st.state, missing: st.missing, headline: esc(st.headline) };
    if (sim.unit.usd == null) {
      return [{ ...head, body: setupCard(sim, ctx) + '<p class="muted">Bez obchodu na SL s pnlRaw nejde určit 1 R – zadej ho ručně.</p>' }];
    }
    const out = [{ ...head, body: setupCard(sim, ctx) + resultCard(sim, ctx) }];
    if (sim.days.length) {
      out.push({
        id: 'days', title: 'Po dnech', state: st.state, missing: st.missing,
        headline: esc(sim.active ? `${sim.cutDays} z ${sim.days.length} dnů utnuto` : `${sim.days.length} ${O.plural(sim.days.length, 'den', 'dny', 'dnů')} · bez pravidla`),
        body: dayTable(sim, ctx)
      });
    }
    return out;
  }

  // ------------------------------------------------------------- krok 3: mřížka variant

  const VA = window.LabVariants;

  function variantLabel(key, value, k) {
    const f = RULE_FIELDS.find(x => x.key === key);
    const usd = f.unit === 'R' && k ? ` <span class="muted">(${Math.round(value * k).toLocaleString('cs-CZ')} USD)</span>` : '';
    return `${num(value)}${f.unit === '×' ? '×' : ' ' + esc(f.unit)}${usd}`;
  }

  function statusPills(v, enough) {
    if (!enough) return '';
    const out = [];
    if (Math.abs(v.netR) < 1e-9) return '<span class="muted">nic nemění</span>';
    if (v.stable === 'up') out.push('<span class="pill pass">stabilně přidává</span>');
    if (v.stable === 'down') out.push('<span class="pill fail">stabilně ubírá</span>');
    if (v.isolated) out.push('<span class="pill warn">osamělá – šum</span>');
    if (v.looPass === false) out.push(`<span class="pill warn" title="Bez dne ${esc(v.loo.breakingDates.map(czDate).join(', '))} se čistý přínos obrátí nebo zmizí.">nespolehlivá – neprojde LOO</span>`);
    if (v.split && v.split.holds === false) out.push('<span class="pill warn">nedrží v čase</span>');
    return out.join(' ');
  }

  function variantsCard(ctx, seqVerdict, res) {
    const st = O.variantsState(res);
    const meta = { id: 'variants', title: 'Mřížka variant', state: st.state, missing: st.missing, headline: esc(st.headline) };
    if (st.state === 'na') return meta;
    const k = usdPerR({ unit: res.unit, contracts: res.contracts }, ctx.views);
    const enough = res.enoughDays;
    const cols = enough ? 9 : 6;
    const head = `<tr><th>Varianta</th><th class="num">Čistý přínos</th><th class="num" title="Kolik by vyneslo náhodné vynechání stejného počtu obchodů">Náhodné vynechání</th><th class="num">Max drawdown</th><th class="num">Nejhorší den</th><th class="num">Utnuto dnů · nevzato</th>${enough ? '<th class="num">Bez jednoho dne (rozsah)</th><th class="num">1. / 2. polovina</th><th>Stav</th>' : ''}</tr>`;
    const control = `<tr class="strong"><td><b>Žádné pravidlo</b> <span class="muted">(kontrola)</span></td><td class="num">${both(0, k)}</td><td class="num">—</td><td class="num">${both(-res.none.maxDrawdownR, k)}</td><td class="num">${both(res.none.worstDayR, k)}</td><td class="num">0 · 0</td>${enough ? '<td></td><td></td><td></td>' : ''}</tr>`;
    const body = res.families.map(fam => {
      const label = RULE_FIELDS.find(f => f.key === fam.key).label;
      const rows = fam.variants.map(v => {
        const border = v.stable === 'up' ? 'box-shadow:inset 3px 0 0 var(--green)' : v.stable === 'down' ? 'box-shadow:inset 3px 0 0 var(--red)' : '';
        const extra = enough
          ? `<td class="num" title="Max drawdown bez jednoho dne: ${esc(fmtR(-v.loo.ddMax))} … ${esc(fmtR(-v.loo.ddMin))}">${fmtR(v.loo.min)} … ${fmtR(v.loo.max)}</td>
             <td class="num" title="${esc(czDate(v.split.first.from))} – ${esc(czDate(v.split.first.to))} / ${esc(czDate(v.split.second.from))} – ${esc(czDate(v.split.second.to))}">${fmtR(v.split.first.netR)} / ${fmtR(v.split.second.netR)}</td>
             <td>${statusPills(v, enough)}</td>`
          : '';
        return `<tr class="${v.cutDays ? '' : 'grey'}"><td style="${border}">${variantLabel(fam.key, v.value, k)}</td>
          <td class="num">${both(v.netR, k)}</td>
          <td class="num">${v.chanceR == null ? '—' : fmtR(v.chanceR)}</td>
          <td class="num">${both(-v.maxDrawdownR, k)}</td>
          <td class="num">${both(v.worstDayR, k)}</td>
          <td class="num">${v.cutDays} · ${v.skippedTrades}</td>${extra}</tr>`;
      }).join('');
      return `<tr><th colspan="${cols}" style="text-align:left;padding-top:14px">${esc(label)}</th></tr>${rows}`;
    }).join('');
    const negEdge = res.meanR != null && res.meanR < 0
      ? `<div class="obs-warning">⚠ Bez pravidla deník prodělává průměrně ${esc(fmtR(res.meanR))} na obchod. Každá varianta, která obchody ubírá, proto vyjde kladně už jen tím, že obchodů je míň. Sloupec „Náhodné vynechání“ ukazuje, kolik by vyneslo vynechat stejný počet obchodů náhodně – pravidlo, které je nepřekoná, nic nepředvídá.</div>`
      : '';
    const seqNote = seqVerdict.kind === 'random'
      ? '<p class="muted" style="font-size:12.5px">Podle testu sérií výše jsou ztráty v mezích náhody – kladný čistý přínos tu znamená menší rozptyl nebo méně obchodů, ne předpověď špatného obchodu.</p>'
      : '';
    const gate = enough
      ? `<p class="section-sub">N = <b>${res.days} dnů</b>. Ke každé variantě vedle sebe čistý přínos, max drawdown a nejhorší den – Lab nevybírá vítěze a neřadí podle jedné metriky. Zvýrazněná je jen <b>stabilní oblast</b> (aspoň ${VA.STABLE_MIN_RUN} sousední hodnoty, které projdou „bez jednoho dne“ a mají stejné znaménko čistého přínosu) a označené jsou varianty, které neobstojí.</p>`
      : `<div class="card warn-card slim" style="margin:0 0 12px"><b>Pod ${VA.MIN_DAYS} dny se nic nehodnotí.</b> Data mají ${res.days} dnů, chybí ${res.missingDays}. Níže je jen to, co se stalo – bez stabilní oblasti, bez „bez jednoho dne“ a bez časového rozdělení. Pravidlo pracuje se dny, takže vzorek je ${res.days}, ne počet obchodů.</div>`;
    return {
      ...meta,
      body: `${gate}
      ${negEdge}
      ${seqNote}
      <div class="table-scroll"><table><thead>${head}</thead><tbody>${control}${body}</tbody></table></div>
      <p class="muted" style="font-size:12px">Každé pravidlo zvlášť; kombinace víc parametrů najednou se nehledají (spec §7). ${enough ? '„Bez jednoho dne“ = varianta přepočtená ' + res.days + '× vždy bez jednoho dne; nespolehlivá je, když se po vynechání kteréhokoli dne čistý přínos obrátí nebo zmizí – pak stojí na tom dni, ne na pravidle. „1. / 2. polovina“ = čistý přínos v první a druhé polovině dnů; nedrží v čase, když se znaménko liší. Osamělá = kladná varianta, jejíž sousedé nepřidávají – šum. ' : ''}Šedě varianty, které na datech nic neutnuly.</p>`
    };
  }

  function render(ctx) {
    const res = SQ.computeSequence(ctx.records, options(ctx));
    const va = VA.computeVariants(ctx.records, { ...options(ctx), unitUSD: ctx.views.riskUnitUSD });
    const st = O.seriesState(res);
    // Mimo sekce, ať je vidět i se vším sbaleným.
    const setupWarn = ctx.views.setupCode
      ? '<div class="obs-warning">⚠ Je zapnutý filtr setupu – sekvence vynechává obchody, které mezi nimi proběhly. Pro otázku denního stopu ber celý den bez filtru setupu.</div>'
      : '';
    return setupWarn + sections('risk', [
      heroCard(res, ctx, st),
      runsCard(res, st),
      permutationCard(res),
      conditionalCard(res),
      ...simSections(ctx, va),
      variantsCard(ctx, res.verdict, va)
    ], ctx.views)
      + '<p class="muted" style="font-size:12px">Dva deníky vedle sebe přijdou v dalším kroku.</p>';
  }

  // Hlavička „Počítá se": tahle obrazovka bere i legacy obchody (výsledek
  // u nich platí), takže její N je jiné než výkonový vzorek ostatních obrazovek.
  function scope(ctx) {
    const b = SQ.sequenceBase(ctx.records, options(ctx));
    const hypoOut = ctx.records.filter(r => r.isHypothetical).length - b.hypothetical;
    return { n: b.items.length, note: `obchodů W/L za ${b.days} dnů${b.legacy ? `, z toho ${b.legacy} legacy` : ''}${hypoOut ? ` · ${hypoOut} hypotetických (no fill / vynechané) mimo` : ''}` };
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.risk = { title: 'Denní risk', question: 'Pomáhá denní stop, nebo jen zmenšuje rozptyl?', render, scope };
})();
