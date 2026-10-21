'use strict';
// Co kdyby – průvodce variantou (docs/ZADANI_LAB_PRESTAVBA.md §3).
//
// Varianta = A) pravidla dne · B) které obchody brát · C) SL · D) cíl.
// Pořadí výpočtu: B vyřadí obchody → C/D přepočítají výsledek obchodu → A pustí
// den znovu přes LabDaySim (žádná kopie jeho logiky; $ limity se převedou na R
// jednotkou, kterou LabDaySim už má).
//
// Výsledek obchodu při jiném SL / cíli (§3.4) – KONZERVATIVNĚ, čisté funkce nad
// výstupem normalizeRecord. S = SL varianty, T = cíl, mfe / mae naměřené během
// obchodu, F / A = maxFavorableMeasured / maxAdverseMeasured. Když pořadí
// neznáme, vždy horší výsledek:
//   1. mae ≥ S → SL
//   2. jinak mfe ≥ T → target
//   3. jinak pohyb po výstupu: F ≥ T a A < S → target · A ≥ S a F < T → SL ·
//      obojí → postExitAdverseFirst === false ? target : SL · jinak nerozhodnuto
// Varianta s nezměněným SL i cílem = přesně skutečnost (pnlRaw). Nerozhodnuté se
// do P/L nepočítají; nejhorší případ je bere jako −1 R.
//
// Lab nevybírá vítěze a nic nedoporučuje – věty říkají fakt simulace.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? ['./sequence.js', './daysim.js', './variants.js', './diagnosis.js', './views.js'].map(f => require(f))
    : [root.LabSequence, root.LabDaySim, root.LabVariants, root.LabDiagnosis, root.LabViews];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabWhatIf = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (SQ, D, VA, DG, V) {

  const UNDECIDED_WARN = 0.2;   // nad 20 % nerozhodnutých je varianta nejvýš ~
  const EPS = 1e-9;             // převod $ → R: limit přesně na hranici má zabrat
  const FILTER_FIELDS = V.WHATIF_FILTER_FIELDS;
  const has = v => v !== null && v !== undefined;
  const sum = list => list.reduce((a, v) => a + v, 0);
  const mean = list => (list.length ? sum(list) / list.length : null);

  const cleanConfig = V.cleanWhatIfConfig;
  const defaultConfig = () => cleanConfig({});

  // Rychlé předvolby (§3.1) – jen vyplní volby, kombinují se.
  const set = (path, value) => cfg => {
    const out = JSON.parse(JSON.stringify(cfg));
    if (path === 'rules') Object.assign(out.rules, value);
    else out[path] = value;
    return out;
  };
  const exclude = (field, keys, add = false) => cfg => {
    const out = JSON.parse(JSON.stringify(cfg));
    out.exclude[field] = add ? [...new Set([...(out.exclude[field] || []), ...keys])] : keys;
    return out;
  };
  const PRESETS = [
    { key: 'one', label: '1 obchod denně', apply: set('rules', { maxTrades: 1 }) },
    { key: 'max2', label: 'Max 2 obchody', apply: set('rules', { maxTrades: 2 }) },
    { key: 'targetOr2SL', label: 'Konec po targetu nebo 2 SL', apply: set('rules', { afterTarget: 1, dailySL: 2 }) },
    { key: 'firstSLOrTarget', label: 'Konec po prvním SL nebo targetu', apply: set('rules', { afterTarget: 1, dailySL: 1 }) },
    { key: 'limit70', label: 'Denní limit −70 $', apply: set('rules', { dailyLossUSD: 70 }) },
    { key: 'rr1', label: 'Cíl 1:1', apply: set('target', { mode: 'r', k: 1 }) },
    { key: 'rr2', label: 'Cíl 2:1', apply: set('target', { mode: 'r', k: 2 }) },
    { key: 'wider2', label: 'SL o 2 ticky širší', apply: set('sl', { mode: 'wider', ticks: 2 }) },
    { key: 'runner', label: 'TG1 1R + runner 2R', apply: set('target', { mode: 'split', k1: 1, k2: 2 }) },
    { key: 'noM2Trend', label: 'Vyřadit M2 v trendu', apply: exclude('setup', ['M2_TREND'], true) },
    { key: 'onlyAbs', label: 'Jen s ABS', apply: exclude('orderFlow', ['OTHER', 'NONE', DG.UNKNOWN]) },
    { key: 'onlyA', label: 'Jen známka A', apply: exclude('grade', ['B', 'C', DG.UNKNOWN]) }
  ];

  function applyPreset(cfg, key) {
    const p = PRESETS.find(x => x.key === key);
    return p ? cleanConfig(p.apply(cleanConfig(cfg))) : cleanConfig(cfg);
  }

  // ------------------------------------------------------------- jeden obchod

  // Pravidla 1–3. x = { mae, mfe, F, A, adverseFirst }.
  function bracket(x, S, T) {
    if (!has(x.mae) || !has(x.mfe)) return 'undecided';
    if (x.mae >= S) return 'stop';
    if (x.mfe >= T) return 'target';
    const fHit = has(x.F) && x.F >= T;
    const aHit = has(x.A) && x.A >= S;
    if (aHit) return fHit && x.adverseFirst === false ? 'target' : 'stop';
    if (fHit && has(x.A)) return 'target';
    return 'undecided';
  }

  // Runner (jen po TG1): F ≥ k2·S a zpět na vstup ne → target k2 · F ≥ k2·S a zpět
  // ano → BE (ledaže protipohyb nepřišel dřív → target k2) · F < k2·S a zpět ano
  // → BE · jinak nerozhodnuto. Po TG1 má runner SL na vstupu, takže „zpět na vstup"
  // bez známého F je nejhůř BE.
  function runnerOutcome(x, S, k2) {
    const reach = has(x.F) && x.F >= k2 * S;
    if (x.backToEntry === true) return reach && x.adverseFirst === false ? 'target' : 'be';
    if (x.backToEntry === false) return reach ? 'target' : 'undecided';
    return 'undecided';
  }

  function slTicksOf(r, sl) {
    if (sl.mode === 'fixed') return sl.ticks;
    if (!(r.slTicks > 0)) return null;
    if (sl.mode === 'wider') return r.slTicks + sl.ticks;
    if (sl.mode === 'narrower') return r.slTicks - sl.ticks > 0 ? r.slTicks - sl.ticks : null;
    return r.slTicks;
  }

  const UNDECIDED_REASON = {
    legacy: 'legacy obchod (ticky nejistá konvence)',
    sl: 'bez ceny SL',
    tick: 'neznámá hodnota ticku nebo počet kontraktů',
    measured: 'MFE / MAE nejsou naměřené',
    planned: 'bez plánovaného cíle s cenou',
    target: 'stopnutý obchod bez plánovaného cíle',
    'post-exit': 'pohyb po výstupu nerozhodne',
    runner: 'runner: pohyb po výstupu nerozhodne'
  };

  // Výsledek obchodu ve variantě. kind: actual · target · stop · be (runner na BE) ·
  // undecided. pnl v $ (null u nerozhodnutého), worstPnl = nejhorší případ, r v R.
  function tradeOutcome(r, cfgIn) {
    const cfg = cleanConfig(cfgIn);
    const slChanged = cfg.sl.mode !== 'actual';
    const tgChanged = cfg.target.mode !== 'actual';
    if (!slChanged && !tgChanged) {
      return { kind: 'actual', pnl: r.pnlRaw, worstPnl: r.pnlRaw, r: r.rSigned, result: r.result, S: r.slTicks };
    }
    const c = r.contracts, tv = r.tickValue, comm = r.commission || 0;
    const S = slTicksOf(r, cfg.sl);
    const money = ticks => ticks * tv * c - comm;
    const priced = S != null && c > 0 && has(tv);
    const und = (reason, worst) => ({ kind: 'undecided', reason, pnl: null, worstPnl: has(worst) ? worst : priced ? money(-S) : null, r: null, result: null, S });
    if (r.isLegacy) return und('legacy');
    if (S == null) return und('sl');
    if (!priced) return und('tick');
    if (!has(r.maeMeasured) || !has(r.mfeMeasured)) return und('measured');
    const x = { mae: r.maeMeasured, mfe: r.mfeMeasured, F: r.maxFavorableMeasured, A: r.maxAdverseMeasured, adverseFirst: r.postExitAdverseFirst, backToEntry: r.backToEntry };
    const stop = () => ({ kind: 'stop', pnl: money(-S), worstPnl: money(-S), r: -1, result: 'stoploss', ticks: -S, S });
    const target = T => ({ kind: 'target', pnl: money(T), worstPnl: money(T), r: T / S, result: 'target', ticks: T, S });
    const decide = (T, reason) => {
      const o = bracket(x, S, T);
      return o === 'stop' ? stop() : o === 'target' ? target(T) : und(reason);
    };
    const mode = cfg.target.mode;
    if (mode === 'actual') {
      // Jen jiný SL: obchod, kterého se nový SL nedotkl a který neskončil na SL,
      // dopadne přesně jako ve skutečnosti.
      if (x.mae >= S) return stop();
      if (r.result !== 'stoploss') {
        return { kind: 'actual', pnl: r.pnlRaw, worstPnl: r.pnlRaw, r: has(r.exitTicks) ? r.exitTicks / S : null, result: r.result, ticks: r.exitTicks, S };
      }
      if (!has(r.plannedTargetTicks)) return has(x.A) && x.A >= S ? stop() : und('target');
      return decide(r.plannedTargetTicks, 'post-exit');
    }
    if (mode === 'r') return decide(cfg.target.k * S, 'post-exit');
    if (mode === 'planned') return has(r.plannedTargetTicks) ? decide(r.plannedTargetTicks, 'post-exit') : und('planned');
    // Rozdělení: 1. kontrakt k1 × R, 2. kontrakt k2 × R, po TG1 SL 2. kontraktu na BE.
    // Lichý počet kontraktů: na TG1 jde větší polovina; 1 kontrakt = jen TG1.
    const T1 = cfg.target.k1 * S;
    const first = bracket(x, S, T1);
    if (first === 'stop') return stop();
    if (first === 'undecided') return und('post-exit');
    const c1 = Math.ceil(c / 2), c2 = c - c1;
    if (!c2) return target(T1);
    const both = ticks2 => (c1 * T1 + c2 * ticks2) / c;   // ticky na kontrakt (průměr)
    const ro = runnerOutcome(x, S, cfg.target.k2);
    if (ro === 'undecided') return und('runner', money(both(0)));
    const ticks = both(ro === 'target' ? cfg.target.k2 * S : 0);
    return { kind: ro === 'target' ? 'target' : 'be', pnl: money(ticks), worstPnl: money(ticks), r: ticks / S, result: 'target', ticks, S };
  }

  // ------------------------------------------------------------- souhrn

  function maxDrawdown(values) {
    let eq = 0, peak = 0, dd = 0;
    for (const v of values) { eq += v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
    return dd;
  }

  // items = [{ record, pnl, r, result }] v pořadí; dates = všechny dny výběru
  // (den bez vzatého obchodu má P/L 0).
  function summarize(items, dates) {
    const byDay = new Map(dates.map(d => [d, 0]));
    for (const x of items) byDay.set(x.record.date, (byDay.get(x.record.date) || 0) + x.pnl);
    const dayPnl = [...byDay.values()];
    const wins = items.filter(x => x.result === 'target');
    const losses = items.filter(x => x.result === 'stoploss');
    const rs = items.map(x => x.r).filter(has);
    let cum = 0;
    return {
      n: items.length,
      pnl: sum(items.map(x => x.pnl)),
      fees: sum(items.map(x => x.record.commission || 0)),
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
      avgWinR: mean(wins.map(x => x.r).filter(has)),
      avgLossR: mean(losses.map(x => x.r).filter(has)),
      expectancyR: mean(rs),
      rN: rs.length,
      maxDrawdown: maxDrawdown(items.map(x => x.pnl)),
      worstDay: dayPnl.length ? Math.min(...dayPnl) : null,
      profitableDays: dayPnl.filter(v => v > 0).length,
      days: dayPnl.length,
      dayPnl: [...byDay.entries()].map(([date, pnl]) => ({ date, pnl })),
      weekly: DG.weeklyOf(items, x => x.pnl, x => x.record.date),
      equity: items.map(x => (cum += x.pnl))
    };
  }

  // Pravidla dne varianty v jednotkách LabDaySim: počty beze změny, $ ÷ 1 R.
  function rulesInR(rules, unitUSD) {
    const toR = v => (has(v) ? v / unitUSD - EPS : null);
    return {
      maxTrades: rules.maxTrades, consecutiveSL: rules.consecutiveSL, dailySL: rules.dailySL, afterTarget: rules.afterTarget,
      dailyLoss: toR(rules.dailyLossUSD), dailyTarget: toR(rules.dailyTargetUSD), giveBack: toR(rules.giveBackUSD)
    };
  }

  // Den znovu přes LabDaySim. list = [{ record, pnl, result }] v pořadí.
  function runDays(list, rulesR, unitUSD, options) {
    const virtual = list.map(x => ({ ...x.record, pnlRaw: x.pnl, result: x.result, src: x }));
    const sim = D.simulate(virtual, rulesR, { ...options, unitUSD });
    const taken = [], cut = [];
    for (const d of sim.days) for (const t of d.trades) (t.taken ? taken : cut).push(t.record.src);
    return { sim, taken, cut };
  }

  const cutOf = list => {
    const saved = list.filter(x => x.pnl < 0), forgone = list.filter(x => x.pnl > 0);
    return { n: list.length, saved: -sum(saved.map(x => x.pnl)), savedN: saved.length, forgone: sum(forgone.map(x => x.pnl)), forgoneN: forgone.length };
  };

  // Drží to? Stejný mechanismus jako mřížka variant: bez jednoho dne a 1. × 2. polovina.
  function holdsOf(actual, variant, unitUSD) {
    const days = actual.dayPnl.map((d, i) => {
      const v = variant.dayPnl[i].pnl;
      return { date: d.date, actualR: d.pnl / unitUSD, ruleR: v / unitUSD, diffR: (v - d.pnl) / unitUSD, trades: [{ r: v / unitUSD, taken: true }] };
    });
    const out = { days: days.length, enough: days.length >= D.MIN_DAYS, minDays: D.MIN_DAYS, loo: null, split: null, text: null };
    const diff = variant.pnl - actual.pnl;
    if (!out.enough) { out.text = `Zatím málo dnů (${days.length} z ${D.MIN_DAYS}).`; return out; }
    if (Math.abs(diff) < 0.005) { out.text = 'Varianta na těchto datech nic nemění.'; return out; }
    out.loo = VA.leaveOneDayOut(days);
    out.split = VA.timeSplit(days);
    const czDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}. ${Number(m[2])}.` : iso; };
    const parts = [];
    if (out.loo.pass === false) parts.push(`Rozdíl stojí na ${out.loo.breakingDates.length === 1 ? 'dni' : 'dnech'} ${out.loo.breakingDates.slice(0, 5).map(czDate).join(', ')}${out.loo.breakingDates.length > 5 ? ' …' : ''} – bez ${out.loo.breakingDates.length === 1 ? 'něj' : 'kteréhokoli z nich'} se obrátí nebo zmizí.`);
    if (out.split.holds === false) parts.push(`Rozdíl se v první a druhé polovině období obrací.`);
    out.text = parts.length ? parts.join(' ') : 'Rozdíl drží i bez kteréhokoli dne a v obou polovinách.';
    out.pass = !parts.length;
    return out;
  }

  // Varianta celkem. options = výchozí přepínače výkonu (+ unitUSD přepis 1 R).
  function computeWhatIf(records, cfgIn, options = {}) {
    const cfg = cleanConfig(cfgIn);
    const base = SQ.sequenceBase(records, options);
    const all = base.ordered.filter(r => has(r.pnlRaw));
    const dates = [...new Set(all.map(r => r.date))];
    const unit = D.unitOf(all, options.unitUSD);
    const unitUSD = unit.usd || 1;
    const actualItems = all.map(r => ({ record: r, pnl: r.pnlRaw, r: r.rSigned, result: r.result }));
    const actual = summarize(actualItems, dates);

    // B – které obchody brát
    const filtered = [], kept = [];
    for (const x of actualItems) {
      const keys = DG.filterKeysOf(x.record);
      const out = FILTER_FIELDS.some(f => (cfg.exclude[f] || []).includes(keys[f]));
      (out ? filtered : kept).push(x);
    }
    // C, D – výsledek obchodu
    const outcomes = kept.map(x => ({ ...x, o: tradeOutcome(x.record, cfg) }));
    const decided = outcomes.filter(x => x.o.kind !== 'undecided').map(x => ({ record: x.record, pnl: x.o.pnl, r: x.o.r, result: x.o.result, kind: x.o.kind, actualPnl: x.pnl }));
    const undecided = outcomes.filter(x => x.o.kind === 'undecided');
    // A – pravidla dne přes LabDaySim
    const rulesR = rulesInR(cfg.rules, unitUSD);
    const active = D.hasAnyRule(D.cleanRules(rulesR));
    const day = active ? runDays(decided, rulesR, unitUSD, options) : { taken: decided, cut: [] };
    const variant = summarize(day.taken, dates);
    variant.undecided = undecided.length;
    variant.diff = variant.pnl - actual.pnl;
    // Nejhorší případ: nerozhodnuté jako −1 R (runner po TG1 na BE).
    const worstList = outcomes.filter(x => x.o.kind !== 'undecided' || has(x.o.worstPnl)).map(x => (x.o.kind === 'undecided'
      ? { record: x.record, pnl: x.o.worstPnl, r: -1, result: 'stoploss' }
      : { record: x.record, pnl: x.o.pnl, r: x.o.r, result: x.o.result }));
    const worstDay = active ? runDays(worstList, rulesR, unitUSD, options) : { taken: worstList };
    const worst = summarize(worstDay.taken, dates);
    worst.unpriced = undecided.filter(x => !has(x.o.worstPnl)).length;

    const changed = decided.filter(x => x.kind !== 'actual');
    const share = kept.length ? undecided.length / kept.length : 0;
    const filtersOn = Object.keys(cfg.exclude).length > 0;
    const reasons = {};
    for (const x of undecided) reasons[x.o.reason] = (reasons[x.o.reason] || 0) + 1;
    // Skutečnost na STEJNÝCH obchodech: bez nerozhodnutých (ty do varianty
    // nevstupují). Jinak by se rozdíl tvářil jako účinek varianty, i když jen
    // vypadly obchody, které nejde přepočítat.
    const undecidedSet = new Set(undecided.map(x => x.record));
    const same = undecided.length ? summarize(actualItems.filter(x => !undecidedSet.has(x.record)), dates) : actual;
    variant.diffSame = variant.pnl - same.pnl;
    const holds = holdsOf(same, variant, unitUSD);
    let state = variant.n < DG.GREY ? 'na' : holds.enough ? 'ok' : 'weak';
    if (share > UNDECIDED_WARN && state === 'ok') state = 'weak';
    const undecidedNote = undecided.length
      ? `${undecided.length} z ${kept.length} obchodů nerozhodnuto (${Math.round(share * 100)} %) – do P/L varianty nevstupují`
        + (share > UNDECIDED_WARN ? `; nad ${Math.round(UNDECIDED_WARN * 100)} % nerozhodnutých je výsledek jen předběžný.` : '.')
      : null;

    return {
      config: cfg,
      unit, actual, same, variant, worst, holds, state, filtersOn,
      rulesActive: active,
      changed: cfg.sl.mode !== 'actual' || cfg.target.mode !== 'actual',
      trades: all.length,
      days: dates.length,
      legacy: all.filter(r => r.isLegacy).length,
      missingPnl: base.ordered.length - all.length,
      undecidedShare: share,
      undecidedNote,
      undecidedReasons: Object.entries(reasons).map(([key, n]) => ({ key, n, label: UNDECIDED_REASON[key] || key })).sort((a, b) => b.n - a.n),
      undecidedRecords: undecided.map(x => x.record),
      cut: {
        filter: cutOf(filtered),
        rules: cutOf(day.cut),
        changed: { n: changed.length, diff: sum(changed.map(x => x.pnl - x.actualPnl)) }
      },
      filteredRecords: filtered.map(x => x.record)
    };
  }

  // ------------------------------------------------------------- popis a text

  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const usd = v => (v == null ? '—' : (Math.round(v * 10) / 10 < 0 ? '−' : '') + num(Math.abs(Math.round(v * 10) / 10)) + ' $');
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  const RULE_TEXT = {
    maxTrades: v => `max ${num(v)} ${v === 1 ? 'obchod' : v < 5 ? 'obchody' : 'obchodů'} denně`,
    consecutiveSL: v => `konec po ${num(v)} SL za sebou`,
    dailySL: v => `konec po ${num(v)} SL za den`,
    afterTarget: v => (v === 1 ? 'konec po targetu' : `konec po ${num(v)} targetech`),
    dailyLossUSD: v => `denní limit −${num(v)} $`,
    dailyTargetUSD: v => `denní cíl +${num(v)} $`,
    giveBackUSD: v => `konec po vrácení ${num(v)} $ z denního maxima`
  };

  // Varianta slovy – pro hlavičku sloupce a kopírovaný text.
  function describeConfig(cfgIn, records = []) {
    const cfg = cleanConfig(cfgIn);
    const parts = Object.entries(cfg.rules).map(([k, v]) => RULE_TEXT[k](v));
    for (const field of FILTER_FIELDS) {
      const out = cfg.exclude[field];
      if (!out || !out.length) continue;
      const c = DG.COMPARISONS.find(x => x.key === field);
      parts.push(`bez: ${out.map(k => DG.groupLabel(c, k)).join(', ')}`);
    }
    const sl = cfg.sl;
    if (sl.mode === 'wider') parts.push(`SL o ${num(sl.ticks)} t širší`);
    if (sl.mode === 'narrower') parts.push(`SL o ${num(sl.ticks)} t užší`);
    if (sl.mode === 'fixed') parts.push(`SL pevně ${num(sl.ticks)} t`);
    const t = cfg.target;
    if (t.mode === 'r') parts.push(`cíl ${num(t.k)}:1`);
    if (t.mode === 'planned') parts.push('cíl na plánované hladině');
    if (t.mode === 'split') parts.push(`TG1 ${num(t.k1)} R + runner ${num(t.k2)} R (po TG1 SL na BE)`);
    return parts.length ? parts.join(' · ') : 'beze změny (= skutečnost)';
  }

  // Zkopírovat jako text (pro obchodní plán). Fakt simulace, žádné doporučení.
  function textSummary(res, label = 'Varianta') {
    const a = res.actual, v = res.variant;
    const lines = [
      `${label}: ${describeConfig(res.config)}`,
      `Kdyby platila tahle varianta, P/L by bylo ${usd(v.pnl)} místo ${usd(a.pnl)} (rozdíl ${usd(v.diff)}).`,
      `Obchodů ${v.n} z ${a.n}${v.undecided ? `, nerozhodnuto ${v.undecided}` : ''} · win % ${pct(v.winRate)} (skutečnost ${pct(a.winRate)}) · poplatky ${usd(v.fees)}.`,
      `Max drawdown ${usd(-v.maxDrawdown)} (skutečnost ${usd(-a.maxDrawdown)}) · nejhorší den ${usd(v.worstDay)} (skutečnost ${usd(a.worstDay)}) · ziskových dnů ${v.profitableDays} z ${v.days} (skutečnost ${a.profitableDays}).`
    ];
    if (v.undecided) {
      lines.push(`Nerozhodnuto ${v.undecided} obchodů (do P/L varianty nevstupují). Na stejných obchodech bez nich: skutečnost ${usd(res.same.pnl)}, varianta ${usd(v.pnl)}, rozdíl ${usd(v.diffSame)}.`);
      lines.push(`Nejhorší případ (nerozhodnuté jako −1 R): ${usd(res.worst.pnl)}.`);
    }
    lines.push(`Drží to? ${res.holds.text}`);
    if (res.filtersOn) lines.push('Filtry a pravidla nastavené na stejných datech vypadají vždy líp, než budou dál. Ověř na nových obchodech.');
    return lines.join('\n');
  }

  return {
    UNDECIDED_WARN, FILTER_FIELDS, PRESETS, UNDECIDED_REASON,
    cleanConfig, defaultConfig, applyPreset, bracket, runnerOutcome, slTicksOf, tradeOutcome,
    summarize, rulesInR, holdsOf, computeWhatIf, describeConfig, textSummary
  };
}));
