'use strict';
// Úvodní obrazovka „Co teď vím" a stavy sekcí na ostatních obrazovkách.
//
// NIC NEPOČÍTÁ. Bere výsledky existujících analýz (LabHealth, LabSlTp,
// LabStrength, LabSequence, LabDaySim, LabVariants) a jejich vlastní prahy
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
    ? ['./health.js', './sltp.js', './strength.js', './sequence.js', './daysim.js', './variants.js'].map(f => require(f))
    : [root.LabHealth, root.LabSlTp, root.LabStrength, root.LabSequence, root.LabDaySim, root.LabVariants];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  if (root) root.LabOverview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (H, S, ST, SQ, D, VA) {

  const STATES = ['ok', 'weak', 'na'];
  const ICON = { ok: '✓', weak: '~', na: '–' };
  const STATE_LABEL = { ok: 'ví se', weak: 'zatím slabé', na: 'nejde' };
  const GREY = S.SAMPLE_GREY;
  const WARN = S.SAMPLE_WARN;
  const SWEEP_WARN = S.SWEEP_SAMPLE_WARN;
  const SCREEN_LABEL = { health: 'Zdraví dat', sltp: 'SL a TP', levels: 'Síla hladin', risk: 'Denní risk' };
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
    controlGroup: 'Když v cestě žádná hladina nebyla, vyber „žádná hladina v cestě“ – prázdné se do porovnání nepočítá.'
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

  const SIDE_NAME = { target: 'proti TP', sl: 'proti SL' };

  function levelSideState(side) {
    const name = SIDE_NAME[side.key];
    const state = side.totalRows ? bySample(side.tested) : 'na';
    // Nejčastěji testované hladiny – ne „nejsilnější", ať věta nic nevybírá.
    const top = side.levels.filter(l => l.tested > 0).sort((a, b) => b.tested - a.tested).slice(0, 2);
    let missing;
    if (!side.totalRows) missing = `zapsané hladiny ${name} – je 0 řádků, do ${GREY} otestovaných chybí ${GREY}`;
    else if (side.withPlace < side.totalRows) missing = `cena nebo vzdálenost u ${side.totalRows - side.withPlace} z ${side.totalRows} řádků ${name} (otestováno ${side.tested}, do ${GREY} chybí ${GREY - side.tested})`;
    else missing = `${GREY - side.tested} otestovaných hladin ${name} do ${GREY} (je ${side.tested}, netestovaných ${side.untested})`;
    return {
      state,
      fact: top.length ? `${name}: ${top.map(l => `${l.label} zastavila ${l.held} z ${l.tested}`).join(', ')} (otestováno ${side.tested})` : null,
      headline: `${side.tested} otestovaných · ${side.withPlace} z ${side.totalRows} řádků s cenou nebo vzdáleností`,
      missing
    };
  }

  function controlState(cg) {
    const name = SIDE_NAME[cg.key];
    const m = Math.min(cg.none.n, cg.present.n);
    const isTarget = cg.key === 'target';
    const hit = s => pct(isTarget ? s.targetHit : s.stopHit);
    const what = isTarget ? 'cíl dosažen' : 'SL zasažen';
    return {
      state: bySample(m),
      fact: `${name}: s hladinou v cestě ${what} ${hit(cg.present)} (n ${cg.present.n}), bez hladiny ${hit(cg.none)} (n ${cg.none.n})`,
      headline: `žádná hladina ${cg.none.n} · hladina ${cg.present.n} · nevyplněno ${cg.unknown.n}`,
      missing: `${GREY - m} ${plural(GREY - m, 'obchod', 'obchody', 'obchodů')} v menší skupině ${name} do ${GREY} (žádná hladina ${cg.none.n} · hladina ${cg.present.n} · nevyplněno ${cg.unknown.n})`
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

  // ------------------------------------------------------------- úvodní obrazovka

  // Věta končí jednou tečkou, i když fakt (verdikt sekvence) tečkou končí sám.
  const stop = s => s.replace(/[.\s]+$/, '') + '.';
  function sentence(title, st) {
    if (st.state === 'na') return stop(`${title} zatím nejde — chybí ${st.missing}`);
    if (st.state === 'weak') return stop(`Předběžně: ${lowerFirst(st.fact)}`);
    return stop(capitalize(st.fact));
  }

  // Dvě strany (proti TP / proti SL) v jednom řádku: stav = ta lepší,
  // u nespuštěné strany se řekne, co jí chybí.
  function mergedSides(title, sides) {
    const best = sides.reduce((a, s) => (rank(s.state) < rank(a.state) ? s : a), sides[0]);
    if (best.state === 'na') {
      return { state: 'na', text: stop(`${title} zatím nejde — chybí ${sides.map(s => s.missing).join('; ')}`) };
    }
    const parts = sides.map(s => (s.state === 'na' ? `${s.name} zatím nejde — chybí ${s.missing}` : s.fact));
    const body = `${title.toLowerCase()} ${parts.join('; ')}`;
    return { state: best.state, text: stop(best.state === 'weak' ? `Předběžně: ${body}` : capitalize(body)) };
  }

  function computeOverview(ctx) {
    const { records, perf, health, views = {}, options = {} } = ctx;
    const sltp = S.computeSlTp(perf, { targetR: views.sweepTargetR || 1 });
    const strength = ST.computeStrength(perf, { tolerance: has(views.levelTolerance) ? views.levelTolerance : ST.DEFAULT_TOLERANCE });
    const seq = SQ.computeSequence(records, options);
    const riskOptions = { ...options, unitUSD: views.riskUnitUSD };
    const va = VA.computeVariants(records, riskOptions);
    const sim = D.simulate(records, rulesFromViews(views), riskOptions);

    const st = {
      series: seriesState(seq),
      dayStop: sim.active ? simState(sim, va) : variantsState(va),
      mae: maeState(sltp.maeWinners),
      mfe: mfeState(sltp.mfeStopped),
      sweep: sweepState(sltp.sweep),
      grid: gridState(sltp.grid),
      levelsTarget: { ...levelSideState(strength.sides[0]), name: SIDE_NAME.target },
      levelsSl: { ...levelSideState(strength.sides[1]), name: SIDE_NAME.sl },
      controlTarget: { ...controlState(strength.control[0]), name: SIDE_NAME.target },
      controlSl: { ...controlState(strength.control[1]), name: SIDE_NAME.sl },
      fill: fillState(health.checks.find(c => c.id === 9))
    };
    const days = n => `n = ${n} ${plural(n, 'den', 'dny', 'dnů')}`;
    const levels = mergedSides('Síla hladin', [st.levelsTarget, st.levelsSl]);
    const control = mergedSides('Kontrolní skupina hladin', [st.controlTarget, st.controlSl]);

    // pending = řádky prognózy zdraví dat pro analýzy, které dnes neběží
    // (u sloučeného řádku i nespuštěná strana, když druhá běží).
    const pending = (state, ...keys) => (state === 'na' ? keys : []);
    const rows = [
      { key: 'series', screen: 'risk', state: st.series.state, text: sentence('Test náhodnosti sérií', st.series), n: `n = ${seq.n}`, pending: [] },
      { key: 'dayStop', screen: 'risk', state: st.dayStop.state, text: sentence(sim.active ? 'Pravidlo ze simulátoru dne' : 'Mřížka variant denního stopu', st.dayStop), n: days(sim.active ? sim.days.length : va.days), pending: [] },
      { key: 'mae', screen: 'sltp', state: st.mae.state, text: sentence('MAE vítězů', st.mae), n: `n = ${sltp.maeWinners.n}`, pending: pending(st.mae.state, 'maeWinners') },
      { key: 'mfe', screen: 'sltp', state: st.mfe.state, text: sentence('MFE stopnutých', st.mfe), n: `n = ${sltp.mfeStopped.n}`, pending: pending(st.mfe.state, 'mfeStopped') },
      { key: 'sweep', screen: 'sltp', state: st.sweep.state, text: sentence('SL sweep', st.sweep), n: `n = ${sltp.sweep.n}`, pending: pending(st.sweep.state, 'slSweep') },
      { key: 'grid', screen: 'sltp', state: st.grid.state, text: sentence('Mřížka SL × TP', st.grid), n: `n = ${sltp.grid.n}`, pending: pending(st.grid.state, 'grid') },
      { key: 'levels', screen: 'levels', state: levels.state, text: levels.text, n: `n = ${strength.sides[0].tested} / ${strength.sides[1].tested} otestovaných (TP / SL)`, pending: [...pending(st.levelsTarget.state, 'levelsTarget'), ...pending(st.levelsSl.state, 'levelsSl')] },
      // Prognóza kontrolní skupiny je jen pro stranu proti TP (řádek použitelnosti controlGroup).
      { key: 'control', screen: 'levels', state: control.state, text: control.text, n: `n = ${Math.min(strength.control[0].none.n, strength.control[0].present.n)} / ${Math.min(strength.control[1].none.n, strength.control[1].present.n)} v menší skupině (TP / SL)`, pending: pending(st.controlTarget.state, 'controlGroup') },
      { key: 'fill', screen: 'health', state: st.fill.state, text: sentence('Fill rate', st.fill), n: `n = ${st.fill.state === 'na' ? 0 : health.checks.find(c => c.id === 9).fill.n}`, pending: [] }
    ];
    for (const row of rows) {
      row.icon = ICON[row.state];
      row.screenLabel = SCREEN_LABEL[row.screen];
    }

    // Stavy pro řádky použitelnosti – blok „Co vyplnit" z nich pozná, co dnes něco blokuje.
    const usabilityState = {
      maeWinners: st.mae.state, mfeStopped: st.mfe.state, slSweep: st.sweep.state, grid: st.grid.state,
      levelsTarget: st.levelsTarget.state, levelsSl: st.levelsSl.state, controlGroup: st.controlTarget.state, fillRate: st.fill.state
    };
    const lacking = { controlGroup: strength.control[0].unknown.n };

    const sorted = byState(rows);
    return {
      rows: sorted,
      states: st,
      fill: fillList(health, usabilityState, lacking),
      eta: etaLines(sorted, { health, seq, va, fill: st.fill, series: st.series })
    };
  }

  // ------------------------------------------------------------- §1.1 co vyplnit

  // Jen pole, která dnes blokují nějakou analýzu: analýza není „ví se"
  // (bez vlastního stavu – R statistika, plánovaný cíl – pod cílem
  // použitelnosti) a aspoň jednomu záznamu pole chybí. Seskupené podle
  // chybějícího pole, od nejužšího hrdla (nejmenší N). Co se vyplní, zmizí samo.
  function fillList(health, usabilityState = {}, lackingOverride = {}) {
    const groups = new Map();
    for (const u of health.usability) {
      const state = usabilityState[u.key];
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
      return { field: capitalize(lacks), keys: rows.map(u => u.key), minN, lacking: Math.max(...rows.map(u => u.m - u.n)), detail, hint: hints.join(' ') || null };
    });
    items.sort((a, b) => a.minN - b.minN || b.lacking - a.lacking);
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
    maeState, mfeState, sweepState, gridState, levelSideState, controlState, fillState, seriesState, variantsState, simState,
    computeOverview, fillList, etaLines
  };
}));
