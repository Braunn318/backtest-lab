'use strict';
// Stavy analýz (sekce obrazovek, karty Souhrnu) a bloky „Co vyplnit" / „Kdy
// to bude" na obrazovce Data. Od 0.4 i JEDINÉ místo, kde se pro render
// spouští analýzy (analyses) – Souhrn i obrazovky čtou tentýž objekt.
//
// NIC NEPOČÍTÁ. Bere výsledky existujících analýz (LabHealth, LabSlTp,
// LabStrength, LabSequence, LabDaySim, LabVariants, LabContext) a jejich vlastní prahy
// a skládá z nich jednu větu a stav:
//   ok   ✓ ví se         vzorek projde prahem dané analýzy
//   weak ~ zatím slabé   spočítatelné, ale pod prahem – věta začíná „Předběžně"
//   na   – nejde         chybí vstup – věta říká co a kolik
// Prahy jsou ty, které ukazují obrazovky (§5.5 specu): pod SAMPLE_GREY
// „nedá se nic vyvodit" = nejde, pod SAMPLE_WARN (u SL sweepu a mřížky
// SWEEP_SAMPLE_WARN) „orientační" = slabé. Prahy se tu nesnižují.
//
// Žádné doporučení, co obchodovat – jen co se ví a jak moc.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? ['./health.js', './sltp.js', './strength.js', './sequence.js', './daysim.js', './variants.js', './context.js'].map(f => require(f))
    : [root.LabHealth, root.LabSlTp, root.LabStrength, root.LabSequence, root.LabDaySim, root.LabVariants, root.LabContext];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabOverview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (H, S, ST, SQ, D, VA, CX) {

  const STATES = ['ok', 'weak', 'na'];
  const ICON = { ok: '✓', weak: '~', na: '–' };
  const STATE_LABEL = { ok: 'ví se', weak: 'zatím slabé', na: 'nejde' };
  const GREY = S.SAMPLE_GREY;
  const WARN = S.SAMPLE_WARN;
  const SWEEP_WARN = S.SWEEP_SAMPLE_WARN;
  const SCREEN_LABEL = { summary: 'Souhrn', health: 'Data', sltp: 'SL a TP', levels: 'Hladiny', context: 'Kontext', risk: 'Denní risk' };
  // Body SL sweepu, které jdou do věty – pevné hodnoty z jeho řady, žádný výběr „nejlepší".
  const SWEEP_POINTS = [8, 12, 16];

  // Pravidla simulátoru dne: klíč v pohledech a jak se řeknou ve větě.
  // (Pole na obrazovce Denní risk mají vlastní popisky v ui-risk.js.)
  const RULES = [
    { key: 'consecutiveSL', view: 'riskConsecutiveSL', phrase: v => `konec po ${num(v)} SL za sebou`, family: 'SL za sebou', unit: '×' },
    { key: 'dailySL', view: 'riskDailySL', phrase: v => `konec po ${num(v)} SL za den`, family: 'SL za den', unit: '×' },
    { key: 'maxTrades', view: 'riskMaxTrades', phrase: v => `max ${num(v)} obchodů za den`, family: 'max obchodů za den', unit: '×' },
    { key: 'dailyLoss', view: 'riskDailyLoss', phrase: v => `denní ztrátový limit ${num(v)} R`, family: 'denní ztrátový limit', unit: ' R' },
    { key: 'giveBack', view: 'riskGiveBack', phrase: v => `vrácení zisku ${num(v)} R`, family: 'vrácení zisku', unit: ' R' },
    { key: 'dailyTarget', view: 'riskDailyTarget', phrase: v => `denní cíl ${num(v)} R`, family: 'denní cíl', unit: ' R' }
  ];

  // Nápověda u polí v bloku „Co vyplnit" – podle klíče řádku použitelnosti.
  const FILL_HINTS = {
    plannedTarget: 'Vystoupil jsi ručně bez plánované hladiny? Nech prázdné, ne MANUAL_EXIT.',
    controlGroup: 'Když v blízkosti žádná hladina nebyla, zaškrtni „žádná hladina v blízkosti“ – prázdné se do porovnání nepočítá.'
  };

  const has = v => v !== null && v !== undefined;
  const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString().replace('.', ','));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  const r2 = v => Math.round(v * 100) / 100;
  // Znaménko až po zaokrouhlení – jinak „−0 R".
  const signedR = v => { const x = r2(v); return (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x)) + ' R'; };
  const absR = v => num(r2(Math.abs(v))) + ' R';
  const czDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}. ${Number(m[2])}.` : (iso || '—'); };
  const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  // „Série…" → „série…", ale „MAE…" zůstane.
  const lowerFirst = s => (s && s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  const rank = state => STATES.indexOf(state);
  // Ze sample N stav podle prahů obrazovky.
  function bySample(n, warnAt = WARN) {
    return n < GREY ? 'na' : n < warnAt ? 'weak' : 'ok';
  }
  // Stabilní řazení: co má vzorek, pak slabé, pak nespuštěné.
  function byState(list, stateOf = x => x.state) {
    return list.map((x, i) => ({ x, i }))
      .sort((a, b) => rank(stateOf(a.x)) - rank(stateOf(b.x)) || a.i - b.i)
      .map(({ x }) => x);
  }

  // ------------------------------------------------------------- stavy analýz
  //
  // Každá vrací { state, fact, headline, missing }:
  //   fact     – co se ví (věta bez „Předběžně"), jen když state ≠ na
  //   headline – hlavní číslo / verdikt do hlavičky sbalené sekce
  //   missing  – co chybí a kolik („Zatím nejde — chybí …"), jen když state = na

  function maeState(d) {
    const state = bySample(d.n);
    return {
      state,
      fact: d.n ? `MAE vítězů: 90 % ziskových obchodů šlo proti nejvýš ${num(d.p90)} t (medián ${num(d.p50)} t)` : null,
      headline: d.n ? `p90 ${num(d.p90)} t · naměřeno ${d.n} z ${d.winners}` : `naměřeno ${d.n} z ${d.winners}`,
      missing: `${GREY - d.n} ${plural(GREY - d.n, 'ziskový obchod', 'ziskové obchody', 'ziskových obchodů')} s naměřeným MAE do ${GREY} (je ${d.n} z ${d.winners} ziskových)`
    };
  }

  function mfeState(d) {
    const state = bySample(d.n);
    const oneR = d.byR.find(x => x.r === 1);
    const reach = oneR && oneR.n ? `; 1 R by stihlo ${oneR.reach} z ${oneR.n}` : '';
    return {
      state,
      fact: d.n ? `stopnuté obchody došly ve směru mediánem ${num(d.p50)} t (p75 ${num(d.p75)} t)${reach}` : null,
      headline: d.n ? `medián ${num(d.p50)} t${oneR && oneR.n ? ` · 1 R ${pct(oneR.pct)}` : ''} · naměřeno ${d.n} z ${d.stopped}` : `naměřeno ${d.n} z ${d.stopped}`,
      missing: `${GREY - d.n} ${plural(GREY - d.n, 'stopnutý obchod', 'stopnuté obchody', 'stopnutých obchodů')} s naměřeným MFE do ${GREY} (je ${d.n} z ${d.stopped} stopnutých)`
    };
  }

  function sweepState(sw) {
    const points = SWEEP_POINTS.map(s => sw.rows.find(r => r.S === s)).filter(Boolean);
    const above = points.some(r => r.aboveObserved > 0);
    const list = points.map((r, i) => `${i ? 's' : 'se SL'} ${r.S} t ${pct(r.stoppedPct)}`).join(', ');
    return {
      state: bySample(sw.n, SWEEP_WARN),
      fact: sw.n ? `SL sweep: ${list} obchodů by vystopovalo${above ? ' (část přežití je nad pozorovaným rozsahem)' : ''}` : null,
      headline: sw.n ? `${points.map(r => `${r.S} t → ${pct(r.stoppedPct)} stop`).join(' · ')} · n ${sw.n} z ${sw.total}` : `hodnotitelných ${sw.n} z ${sw.total}`,
      missing: `${GREY - sw.n} ${plural(GREY - sw.n, 'obchod', 'obchody', 'obchodů')} s naměřeným protipohybem do ${GREY} (je ${sw.n} z ${sw.total})`
    };
  }

  function gridState(g) {
    const ok = g.n && g.best;
    return {
      state: ok ? bySample(g.n, SWEEP_WARN) : 'na',
      fact: ok ? `stabilní oblast mřížky SL × TP leží kolem SL ${g.best.S} t / TP ${num(g.best.k)} R (okolí ${signedR(g.best.neighborhood)} na obchod)${g.isolatedPeak ? ', maximum jedné buňky je osamělé' : ''}` : null,
      headline: ok ? `stabilní oblast SL ${g.best.S} t / TP ${num(g.best.k)} R · okolí ${signedR(g.best.neighborhood)} · n ${g.n} z ${g.total}` : `n ${g.n} z ${g.total}`,
      missing: `${GREY - g.n} ${plural(GREY - g.n, 'obchod', 'obchody', 'obchodů')} s naměřeným maximem proti i ve směru do ${GREY} (je ${g.n} z ${g.total})`
    };
  }

  // Hladiny v blízkosti (v3 B2): stav podle počtu DOTČENÝCH řádků – nedotčená
  // hladina z výpočtů reakce vypadává. Věta popisuje rozložení, nic nevybírá.
  const signedT = v => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v)) + ' t';

  function levelsState(st) {
    const state = st.totalRows ? bySample(st.touched) : 'na';
    const lack = Math.max(0, GREY - st.touched);
    let missing;
    if (!st.totalRows) missing = `zapsané hladiny v blízkosti s cenou – je 0 řádků, do ${GREY} dotčených chybí ${GREY}`;
    else if (st.withDistance < st.totalRows) missing = `cena u ${st.totalRows - st.withDistance} z ${st.totalRows} řádků hladin v blízkosti (dotčených ${st.touched}, do ${GREY} chybí ${lack})`;
    else missing = `${lack} ${plural(lack, 'dotčená hladina', 'dotčené hladiny', 'dotčených hladin')} do ${GREY} (je ${st.touched}, nedotčených ${st.untouched}, bez naměřené MFE / MAE ${st.noExcursion})`;
    return {
      state,
      fact: st.touched
        ? `${st.touched} ${plural(st.touched, 'dotčená hladina', 'dotčené hladiny', 'dotčených hladin')} – ${st.touchedAhead} ve směru obchodu, ${st.touchedBehind} na vstupu a proti`
          + (has(st.medianOvershoot) ? `; cena za ně zajela mediánem ${num(st.medianOvershoot)} t` : '')
        : null,
      headline: `${st.touched} dotčených · ${st.untouched} nedotčených · ${st.withDistance} z ${st.totalRows} řádků s polohou`
        + (has(st.medianOvershoot) ? ` · medián přesahu ${num(st.medianOvershoot)} t` : ''),
      missing
    };
  }

  // SL za nejbližší hladinou mezi SL a cílem: stopnuté × přeživší.
  function stopBehindState(sb) {
    const m = Math.min(sb.stopped.n, sb.survived.n);
    return {
      state: bySample(m),
      fact: sb.n ? `SL ležel za nejbližší hladinou mediánem ${num(sb.stopped.median)} t u stopnutých (n ${sb.stopped.n}) a ${num(sb.survived.median)} t u přeživších (n ${sb.survived.n})` : null,
      headline: `stopnuté ${sb.stopped.n}${has(sb.stopped.median) ? ` · medián ${num(sb.stopped.median)} t` : ''} · přeživší ${sb.survived.n}${has(sb.survived.median) ? ` · medián ${num(sb.survived.median)} t` : ''} · bez hladiny mezi SL a cílem ${sb.unknown}`,
      missing: `${GREY - m} ${plural(GREY - m, 'obchod', 'obchody', 'obchodů')} v menší skupině do ${GREY} (stopnuté ${sb.stopped.n} · přeživší ${sb.survived.n} · bez hladiny s polohou mezi SL a cílem ${sb.unknown})`
    };
  }

  // Nejbližší hladina ve směru obchodu: cíl dosažen × nedosažen.
  function nearestAheadState(na) {
    const m = Math.min(na.reached.n, na.missed.n);
    const part = p => `${num(p.medianTicks)} t${has(p.medianR) ? ` (${num(p.medianR)} R)` : ''}`;
    return {
      state: bySample(m),
      fact: na.n ? `nejbližší hladina ve směru ležela mediánem ${part(na.reached)} u obchodů na cíli (n ${na.reached.n}) a ${part(na.missed)} u ostatních (n ${na.missed.n})` : null,
      headline: `cíl dosažen ${na.reached.n}${na.reached.n ? ` · medián ${part(na.reached)}` : ''} · nedosažen ${na.missed.n}${na.missed.n ? ` · medián ${part(na.missed)}` : ''}`,
      missing: `${GREY - m} ${plural(GREY - m, 'obchod', 'obchody', 'obchodů')} v menší skupině do ${GREY} (cíl dosažen ${na.reached.n} · nedosažen ${na.missed.n} · bez hladiny ve směru ${na.unknown})`
    };
  }

  // Kontrolní skupina: obchody s vědomě „žádná hladina v blízkosti" × s hladinou.
  function controlState(cg) {
    const m = Math.min(cg.none.n, cg.present.n);
    return {
      state: bySample(m),
      fact: `s hladinou v blízkosti cíl dosažen ${pct(cg.present.targetHit)} (n ${cg.present.n}), bez hladiny ${pct(cg.none.targetHit)} (n ${cg.none.n})`,
      headline: `žádná hladina ${cg.none.n} · s hladinou ${cg.present.n} · nevyplněno ${cg.unknown.n}`,
      missing: `${GREY - m} ${plural(GREY - m, 'obchod', 'obchody', 'obchodů')} v menší skupině do ${GREY} (žádná hladina ${cg.none.n} · s hladinou ${cg.present.n} · nevyplněno ${cg.unknown.n})`
    };
  }

  // Fill rate: kontrola 9 zdraví dat (fillStats). Bez 10 NO_FILL to není statistika.
  function fillState(check9) {
    const f = check9.fill;
    const need = H.FILL_WARN_MIN_RECORDS - f.noFill;
    return {
      state: f.enough ? 'ok' : 'na',
      fact: f.enough ? `fill rate ${pct(f.rate)} (${f.filled} FILLED / ${f.noFill} NO_FILL)${check9.status === 'warn' ? ' — nezvykle vysoký' : ''}` : null,
      headline: f.enough ? `${pct(f.rate)} (${f.filled} / ${f.noFill})` : `NO_FILL ${f.noFill}`,
      missing: `${need} ${plural(need, 'zapsaná nenaplněná limitka', 'zapsané nenaplněné limitky', 'zapsaných nenaplněných limitek')} (NO_FILL) do ${H.FILL_WARN_MIN_RECORDS} (je ${f.noFill})`
    };
  }

  // Test náhodnosti sérií (fáze 3 krok 1). Bez platného runs testu nejde;
  // platný pod SAMPLE_WARN obchody je orientační (stejně jako na obrazovce).
  function seriesState(res) {
    const r = res.runs;
    const lackW = Math.max(0, SQ.RUNS_MIN_EACH - r.wins);
    const lackL = Math.max(0, SQ.RUNS_MIN_EACH - r.losses);
    const parts = [lackW ? `${lackW} ${plural(lackW, 'zisk', 'zisky', 'zisků')}` : '', lackL ? `${lackL} ${plural(lackL, 'ztráta', 'ztráty', 'ztrát')}` : ''].filter(Boolean);
    const pill = { random: 'náhodné', clustered: 'shlukování', alternating: 'střídání', insufficient: 'málo dat' }[res.verdict.kind];
    return {
      state: !r.valid ? 'na' : res.n < WARN ? 'weak' : 'ok',
      fact: r.valid ? res.verdict.text : null,
      headline: `${pill}${r.z == null ? '' : ` · z = ${SQ.fmtZ(r.z)}`} · ${res.n} obchodů W/L`,
      missing: `${parts.join(' a ') || 'obchody'} (test potřebuje aspoň ${SQ.RUNS_MIN_EACH} zisků i ${SQ.RUNS_MIN_EACH} ztrát, je ${r.wins} / ${r.losses})`,
      lack: { wins: lackW, losses: lackL }
    };
  }

  // Stabilní oblasti v mřížce variant – souvislé běhy se stejnou značkou.
  function stableRuns(va) {
    const out = [];
    for (const fam of va.families) {
      const rule = RULES.find(x => x.key === fam.key);
      let run = null;
      for (const v of [...fam.variants, null]) {
        if (v && v.stable && run && run.stable === v.stable) { run.values.push(v.value); continue; }
        if (run) out.push(run);
        run = v && v.stable ? { rule, stable: v.stable, values: [v.value] } : null;
      }
    }
    return out.map(x => `${x.rule.family} ${num(x.values[0])}–${num(x.values[x.values.length - 1])}${x.rule.unit} ${x.stable === 'up' ? 'přidává' : 'ubírá'}`);
  }

  function variantsState(va) {
    if (!va.none) {
      return { state: 'na', fact: null, headline: 'bez obchodů s P/L', missing: 'obchody s P/L a aspoň jedna ztráta na SL (1 R)' };
    }
    if (!va.enoughDays) {
      return {
        state: 'na', fact: null,
        headline: `${va.days} ${plural(va.days, 'den', 'dny', 'dnů')} · pod ${VA.MIN_DAYS} dny se nehodnotí`,
        missing: `${va.missingDays} ${plural(va.missingDays, 'den', 'dny', 'dnů')} do ${VA.MIN_DAYS} (data mají ${va.days})`
      };
    }
    const runs = stableRuns(va);
    return {
      state: 'ok',
      fact: runs.length
        ? `stabilní oblast v mřížce denního stopu: ${runs.join('; ')}`
        : 'v mřížce variant denního stopu není stabilní oblast — žádné jednotlivé pravidlo nepřidává ani neubírá spolehlivě přes sousední hodnoty',
      headline: `${va.days} dnů · ${runs.length ? `stabilní oblast: ${runs.join('; ')}` : 'bez stabilní oblasti'}`,
      missing: null
    };
  }

  function rulesFromViews(views = {}) {
    const out = {};
    for (const r of RULES) out[r.key] = views[r.view];
    return out;
  }

  // Pravidlo zadané v simulátoru dne. Pod 20 dny jen popis (slabé); nad
  // nimi „ví se" jen to, co obstojí v mřížce variant (bez jednoho dne,
  // v čase, ne osamělé). Kombinaci pravidel ani hodnotu mimo mřížku mřížka
  // nekontroluje – zůstane slabé.
  function simState(sim, va) {
    if (!sim.trades) {
      return { state: 'na', fact: null, headline: 'bez obchodů s P/L', missing: 'obchody s P/L' };
    }
    if (!has(sim.unit.usd) || !sim.none) {
      return { state: 'weak', fact: null, headline: '1 R nejde určit – zadej ho ručně', missing: null };
    }
    const days = sim.days.length;
    if (!sim.active) {
      return {
        state: sim.enoughDays ? 'ok' : 'weak',
        fact: `bez pravidla ${signedR(sim.none.totalR)} za ${days} ${plural(days, 'den', 'dny', 'dnů')}`,
        headline: `bez pravidla ${signedR(sim.none.totalR)} · ${days} ${plural(days, 'den', 'dny', 'dnů')}`,
        missing: null
      };
    }
    const active = RULES.filter(r => has(sim.rules[r.key]));
    const phrase = active.map(r => r.phrase(sim.rules[r.key])).join(' + ');
    let fact = `„${phrase}“ ušetří ${absR(sim.savedR)} a zahodí ${absR(sim.forgoneR)} → čistě ${signedR(sim.netR)}`;
    let state;
    if (!sim.enoughDays) {
      state = 'weak';
      fact += `; pod ${D.MIN_DAYS} dny jen popis`;
    } else {
      const fam = active.length === 1 && va ? va.families.find(f => f.key === active[0].key) : null;
      const v = fam ? fam.variants.find(x => x.value === sim.rules[active[0].key]) : null;
      const issues = [];
      if (!v) issues.push(active.length > 1 ? 'kombinaci pravidel mřížka bez jednoho dne nekontroluje' : 'hodnota mimo mřížku variant – bez kontroly bez jednoho dne');
      else {
        if (v.looPass === false) issues.push(`neprojde bez jednoho dne (stojí na ${v.loo.breakingDates.slice(0, 3).map(czDate).join(', ')})`);
        if (v.isolated) issues.push('osamělá varianta – sousední hodnoty nepřidávají');
        if (v.split && v.split.holds === false) issues.push('v první a druhé polovině dnů vychází opačně');
      }
      state = issues.length ? 'weak' : 'ok';
      if (issues.length) fact += '; ' + issues.join('; ');
    }
    return { state, fact, headline: `${phrase}: čistě ${signedR(sim.netR)} · ${days} ${plural(days, 'den', 'dny', 'dnů')}`, missing: null };
  }

  // ------------------------------------------------------------- analýzy jednoho renderu

  // Všechny analýzy pro jeden render, spočítané JEDNOU a se stejnými volbami
  // jako obrazovky v Podrobnostech – Souhrn i obrazovky čtou tentýž objekt,
  // takže čísla v Souhrnu jsou z definice stejná jako v Podrobnostech.
  // Memo na objektu ctx (každý render staví nový ctx).
  const memo = new WeakMap();

  function analyses(ctx) {
    if (memo.has(ctx)) return memo.get(ctx);
    const { records, perf, views = {}, options = {} } = ctx;
    const riskOptions = { ...options, unitUSD: views.riskUnitUSD };
    const an = {
      sltp: S.computeSlTp(perf, { targetR: views.sweepTargetR || 1 }),
      strength: ST.computeStrength(perf, { bin: views.levelBin }),
      seq: SQ.computeSequence(records, options),
      va: VA.computeVariants(records, riskOptions),
      sim: D.simulate(records, rulesFromViews(views), riskOptions),
      context: CX.computeContext(perf)
    };
    memo.set(ctx, an);
    return an;
  }

  // ------------------------------------------------------------- stavy analýz celkem

  // Stav každé analýzy + bloky „Co vyplnit" a „Kdy to bude" (obrazovka Data).
  // rows = jedna položka za analýzu: stav a řádky prognózy zdraví dat, které
  // patří k analýze, jež dnes neběží (pending).
  function computeOverview(ctx) {
    const { health } = ctx;
    const { sltp, strength, seq, va, sim, context } = analyses(ctx);
    const st = {
      series: seriesState(seq),
      dayStop: sim.active ? simState(sim, va) : variantsState(va),
      mae: maeState(sltp.maeWinners),
      mfe: mfeState(sltp.mfeStopped),
      sweep: sweepState(sltp.sweep),
      grid: gridState(sltp.grid),
      levels: levelsState(strength),
      stopBehind: stopBehindState(strength.stopBehind),
      nearestAhead: nearestAheadState(strength.nearestAhead),
      control: controlState(strength.control),
      fill: fillState(health.checks.find(c => c.id === 9))
    };
    const pending = (state, ...keys) => (state === 'na' ? keys : []);
    const rows = byState([
      { key: 'series', screen: 'risk', state: st.series.state, pending: [] },
      { key: 'dayStop', screen: 'risk', state: st.dayStop.state, pending: [] },
      { key: 'mae', screen: 'sltp', state: st.mae.state, pending: pending(st.mae.state, 'maeWinners') },
      { key: 'mfe', screen: 'sltp', state: st.mfe.state, pending: pending(st.mfe.state, 'mfeStopped') },
      { key: 'sweep', screen: 'sltp', state: st.sweep.state, pending: pending(st.sweep.state, 'slSweep') },
      { key: 'grid', screen: 'sltp', state: st.grid.state, pending: pending(st.grid.state, 'grid') },
      { key: 'levels', screen: 'levels', state: st.levels.state, pending: pending(st.levels.state, 'levels') },
      { key: 'control', screen: 'levels', state: st.control.state, pending: pending(st.control.state, 'controlGroup') },
      { key: 'fill', screen: 'health', state: st.fill.state, pending: [] }
    ]);

    // Stavy pro řádky použitelnosti – blok „Co vyplnit" z nich pozná, co dnes něco blokuje.
    const usabilityState = {
      maeWinners: st.mae.state, mfeStopped: st.mfe.state, slSweep: st.sweep.state, grid: st.grid.state,
      levels: st.levels.state, controlGroup: st.control.state, fillRate: st.fill.state
    };
    const lacking = { controlGroup: strength.control.unknown.n };
    return {
      rows,
      states: st,
      context,
      fill: fillList(health, usabilityState, lacking, CX.fillRows(context)),
      eta: etaLines(rows, { health, seq, va, fill: st.fill, series: st.series })
    };
  }

  // ------------------------------------------------------------- §1.1 co vyplnit

  // Jen pole, která dnes blokují nějakou analýzu: analýza není „ví se"
  // (bez vlastního stavu – R statistika, plánovaný cíl – pod cílem
  // použitelnosti) a aspoň jednomu záznamu pole chybí. Seskupené podle
  // chybějícího pole, od nejužšího hrdla (nejmenší N). Co se vyplní, zmizí samo.
  // extraRows = pole kontextu v2 (LabContext.fillRows) – stejný tvar, stav nesou
  // samy; řadí se za hrdla analýz fáze 2, nenaplněné limitky zůstávají poslední.
  function fillList(health, usabilityState = {}, lackingOverride = {}, extraRows = []) {
    const groups = new Map();
    for (const u of [...health.usability, ...extraRows]) {
      const state = usabilityState[u.key] || u.state;
      const blocking = state ? state !== 'ok' : u.n < H.USABLE_GOAL;
      const lacking = u.key === 'fillRate' ? (state === 'na' ? 1 : 0)
        : has(lackingOverride[u.key]) ? lackingOverride[u.key] : u.m - u.n;
      if (!blocking || lacking <= 0) continue;
      if (!groups.has(u.lacks)) groups.set(u.lacks, []);
      groups.get(u.lacks).push(u);
    }
    const items = [...groups.entries()].map(([lacks, rows]) => {
      // Fill rate není pole obchodu, ale zvláštní druh záznamu – stejně jako
      // v prognóze zdraví dat se do hrdla nepočítá, jde na konec.
      const minN = rows.every(u => u.forecast === false) ? Infinity : Math.min(...rows.map(u => u.n));
      let detail;
      if (rows.length === 1 && rows[0].key === 'fillRate') {
        const u = rows[0];
        detail = `zapsaných je ${u.noFill}, potřeba aspoň ${H.FILL_WARN_MIN_RECORDS}. Bez nich nejde: ${u.label}.`;
      } else if (rows.length === 1) {
        const u = rows[0];
        detail = `má ${u.n} z ${u.m} ${u.unit}. Bez toho nejde: ${u.label}.`;
      } else {
        detail = rows.map(u => `${u.n} z ${u.m} ${u.unit} (${u.label})`).join(', ') + '.';
      }
      const hints = rows.map(u => FILL_HINTS[u.key]).filter(Boolean);
      const tier = minN === Infinity ? 2 : rows.every(u => u.kind === 'context') ? 1 : 0;
      // unit = jednotka nejužšího řádku (obchodů / řádků) – Souhrn ji píše k N hrdla.
      const narrow = rows.reduce((a, u) => (u.n < a.n ? u : a), rows[0]);
      return { field: capitalize(lacks), keys: rows.map(u => u.key), tier, minN, unit: narrow.unit, lacking: Math.max(...rows.map(u => u.m - u.n)), detail, hint: hints.join(' ') || null };
    });
    items.sort((a, b) => a.tier - b.tier || a.minN - b.minN || b.lacking - a.lacking);
    return items;
  }

  // ------------------------------------------------------------- §1.2 kdy to bude

  // Jeden řádek za každou nespuštěnou analýzu. Obchody: prognóza ze zdraví
  // dat (health.forecast, cíl USABLE_GOAL, tempo = použitelné ÷ obchodní dny).
  // Dny (mřížka variant): kolik dnů chybí, jeden replay den = jeden den.
  function etaLines(rows, { health, seq, va, fill, series }) {
    const out = [];
    const fc = health.forecast;
    for (const row of rows) {
      if (row.state !== 'na' && !row.pending.length) continue;
      if (row.key === 'dayStop') {
        if (va.none && !va.enoughDays) out.push({ key: row.key, text: `Mřížka variant denního stopu: do ${VA.MIN_DAYS} dnů chybí ${va.missingDays} → ${va.missingDays} replay ${plural(va.missingDays, 'den', 'dny', 'dnů')}.` });
        continue;
      }
      if (row.key === 'series') {
        const b = seq.base;
        // Tempo zisků / ztrát za den ve stejné množině, jakou bere test.
        const need = [['wins', series.lack.wins, seq.runs.wins], ['losses', series.lack.losses, seq.runs.losses]]
          .filter(([, lack]) => lack > 0)
          .map(([, lack, have]) => (have && b.days ? Math.ceil(lack / (have / b.days)) : null));
        const daysText = need.length && need.every(has) ? `≈ ${Math.max(...need)} replay dnů při dosavadním tempu` : 'tempo zatím nejde odhadnout';
        out.push({ key: row.key, text: `Test náhodnosti sérií: chybí ${series.missing.split(' (')[0]} → ${daysText}.` });
        continue;
      }
      if (row.key === 'fill') {
        out.push({ key: row.key, text: `Fill rate: chybí ${fill.missing.split(' (NO_FILL)')[0]} – tempo se neodhaduje, nevzniká z obchodů.` });
        continue;
      }
      for (const key of row.pending) {
        const f = fc.rows.find(x => x.key === key);
        if (!f) continue;
        const g = f.goals[0];
        const when = g.days == null ? 'tempo zatím nejde odhadnout (0 za den)' : `≈ ${g.days} replay ${plural(g.days, 'den', 'dny', 'dnů')} při dosavadním tempu ${num(r2(f.perDay))} za den`;
        out.push({ key: row.key, text: `${f.label}: použitelných ${f.n}, do ${g.goal} chybí ${g.remaining} → ${when}.` });
      }
    }
    return out;
  }

  return {
    STATES, ICON, STATE_LABEL, SCREEN_LABEL, RULES, plural,
    bySample, byState, rulesFromViews,
    num, pct, signedR, capitalize, lowerFirst,
    maeState, mfeState, sweepState, gridState, levelsState, stopBehindState, nearestAheadState, controlState,
    fillState, seriesState, variantsState, simState,
    analyses, computeOverview, fillList, etaLines
  };
}));
