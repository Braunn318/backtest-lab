'use strict';
// Zdraví dat. Odpovídá na „sbírám použitelná data?", ne na „vydělává
// strategie?". Pracuje VÝHRADNĚ s výstupem LabNormalize.normalizeRecord;
// žádnou vlastní normalizaci ani čtení `raw` pro výpočty tu nedělej.
//
// Množiny záznamů:
//   trades   – TRADE záznamy (SETUP_ONLY nikdy)
//   perf     – výkonový vzorek: trades bez legacyPointsConvention, bez
//              obchodů „naživo bych nevzal" a bez hypotetických výsledků
//              (no fill / vědomě vynechané), pokud je přepínače nezapnou –
//              LabNormalize.inPerformance, stejně jako performanceRecords() v deníku
//   fillBase – TRADE i SETUP_ONLY bez legacy, VČETNĚ „naživo bych nevzal":
//              naplnění limitky je mechanika vstupu, ne rozhodnutí o obchodu

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const normalize = isNode ? require('./normalize.js') : root.LabNormalize;
  const labels = isNode ? require('./labels.js') : root.LabLabels;
  const api = factory(normalize, labels);
  if (isNode) module.exports = api;
  if (root) root.LabHealth = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (N, L) {

  const USABLE_GOAL = 50;
  const SL_TICKS_MAX = 40;                 // stejná hranice jako v deníku (points.js)
  const R_TOLERANCE = 0.01;
  const DUPLICATE_WINDOW_MIN = 5;
  // Fill rate: pod tímhle počtem nenaplněných záznamů (NO_FILL) není fill
  // rate statistika – jmenovatel ze dvou NO_FILL vyrobí číslo, které jen
  // vypadá jako údaj.
  const FILL_WARN_MIN_RECORDS = 10;
  const FILL_HIGH_RATE = 0.90;
  const FILL_HIGH_MIN_RECORDS = 20;
  const NO_OBSERVATION_WARN_SHARE = 0.30;  // kontrola 11
  const SELECTIVE_WARN_PP = 25;            // kontrola 12, procentní body
  const WINDOW_SPREAD_FACTOR = 4;          // kontrola 13
  const FORECAST_GOALS = [50, 100];

  // P/L pole, která SETUP_ONLY nesmí mít (kontrola 10).
  const PNL_FIELDS = ['pnl', 'pnlRaw', 'grossPnl', 'result', 'exitPrice', 'points', 'pointsTotal', 'pointsPerContract', 'exitTicks'];

  const has = v => v !== null && v !== undefined;

  // ------------------------------------------------------------- množiny

  function isPerformance(r, include) {
    return !r.isLegacy && N.inPerformance(r, include);
  }

  // Přepínače skupin mimo výkon – výchozí stav všechny vypnuté. Bere options
  // i uložené pohledy (stejné klíče) – UI z nich staví options pro všechny obrazovky.
  function includeOf(options = {}) {
    return {
      includeSkipLive: !!options.includeSkipLive,
      includeNoFill: !!options.includeNoFill,
      includeSkipped: !!options.includeSkipped
    };
  }

  function partition(records, options = {}) {
    const include = includeOf(options);
    const trades = records.filter(r => r.isTrade);
    return {
      all: records,
      trades,
      include,
      setups: records.filter(r => r.isSetupOnly),
      legacy: trades.filter(r => r.isLegacy),
      skipLive: trades.filter(r => !r.isLegacy && r.wouldSkipLive),
      noFill: trades.filter(r => !r.isLegacy && r.hypotheticalGroup === 'noFill'),
      skipped: trades.filter(r => !r.isLegacy && r.hypotheticalGroup === 'skipped'),
      perf: records.filter(r => isPerformance(r, include)),
      fillBase: records.filter(r => !r.isLegacy)
    };
  }

  // Filtry pohledu. Rozsah dat, instrument a setup platí pro obchody i setupy.
  function filterRecords(records, filters = {}) {
    const from = filters.dateFrom || null;
    const to = filters.dateTo || null;
    const instrument = filters.instrument || null;
    const setup = filters.setupCode || null;
    return records.filter(r => {
      if (from && (!r.date || r.date < from)) return false;
      if (to && (!r.date || r.date > to)) return false;
      if (instrument && r.instrument !== instrument) return false;
      if (setup === '__none__') { if (r.setupCode) return false; }
      else if (setup && r.setupCode !== setup) return false;
      return true;
    });
  }

  // Obchodní dny výkonového vzorku – jmenovatel tempa v prognóze.
  function tradingDays(perf) {
    return new Set(perf.map(r => r.date).filter(Boolean)).size;
  }

  function dateRange(records) {
    const dates = records.map(r => r.date).filter(Boolean).sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  }

  // ------------------------------------------------------------- fill rate

  // Jediný výpočet fill rate – sdílí ho řádek použitelnosti i kontrola 9.
  function fillStats(fillBase) {
    const filled = fillBase.filter(r => r.fillStatus === 'FILLED').length;
    const noFill = fillBase.filter(r => r.fillStatus === 'NO_FILL').length;
    const n = filled + noFill;
    const enough = noFill >= FILL_WARN_MIN_RECORDS;
    return {
      filled, noFill, n,
      rate: enough && n ? filled / n : null,
      enough,
      reason: enough ? null : `Nenaplněných záznamů (NO_FILL) je ${noFill}, méně než ${FILL_WARN_MIN_RECORDS} – fill rate by z nich nebyl statistika.`
    };
  }

  // ------------------------------------------------------------- A) vzorek

  function sampleOverview(sets) {
    const days = new Map();
    const day = d => {
      const key = d || '(bez data)';
      if (!days.has(key)) days.set(key, { date: key, trades: 0, setups: 0, noFill: 0, legacy: 0 });
      return days.get(key);
    };
    for (const r of sets.all) {
      const row = day(r.date);
      if (r.isSetupOnly) row.setups++;
      else row.trades++;
      if (r.isLegacy) row.legacy++;
      if (r.fillStatus === 'NO_FILL') row.noFill++;
    }
    return {
      total: sets.all.length,
      trades: sets.trades.length,
      setups: sets.setups.length,
      legacy: sets.legacy.length,
      skipLive: sets.skipLive.length,
      noFill: sets.noFill.length,
      skipped: sets.skipped.length,
      hasSkipLiveField: sets.all.some(r => r.hasWouldSkipLiveField),
      perf: sets.perf.length,
      range: dateRange(sets.all),
      days: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    };
  }

  // Řádky SR hladin s hladinou (bez 'NONE') napříč obchody.
  function levelRows(perf, field) {
    const out = [];
    for (const r of perf) for (const row of r[field]) if (!row.isNone) out.push({ record: r, row });
    return out;
  }

  function usabilityRow(key, label, n, m, extra = {}) {
    return { key, label, n, m, missing: Math.max(0, USABLE_GOAL - n), unit: 'obchodů', ...extra };
  }

  // Použitelnost pro analýzy fáze 2. U každé: kolik jich unese, z kolika
  // a co konkrétně chybí.
  function usability(sets) {
    const p = sets.perf;
    const count = (base, test) => base.filter(test).length;
    const winners = p.filter(r => r.isProfitable === true);
    const stopped = p.filter(r => r.isStopped);
    const tRows = levelRows(p, 'srTarget');
    const sRows = levelRows(p, 'srStopLoss');
    const states = { none: 0, present: 0, unknown: 0 };
    for (const r of p) states[r.srTargetState]++;
    const fill = fillStats(sets.fillBase);

    return [
      usabilityRow('r', 'R statistika', count(p, r => has(r.slTicks) && has(r.exitTicks)), p.length,
        { needs: 'slTicks a exitTicks', lacks: 'cena SL' }),
      usabilityRow('maeWinners', 'MAE vítězů → šířka SL', count(winners, r => has(r.maeMeasured)), winners.length,
        { needs: 'ziskové obchody s naměřeným MAE', lacks: 'naměřené MAE (NT8 nebo ručně; dopočtené se nepočítá)' }),
      usabilityRow('mfeStopped', 'MFE stopnutých → dosažitelnost TP', count(stopped, r => has(r.mfeMeasured)), stopped.length,
        { needs: 'stopnuté obchody s naměřeným MFE', lacks: 'naměřené MFE' }),
      usabilityRow('slSweep', 'SL sweep', count(p, r => has(r.slSweepAdverse)), p.length,
        { needs: 'naměřený protipohyb (u stopnutých i za stopkou)', lacks: 'naměřené MAE / protipohyb po výstupu' }),
      usabilityRow('grid', 'Mřížka SL × TP', count(p, r => has(r.maxAdverseMeasured) && has(r.maxFavorableMeasured) && has(r.exitTicks)), p.length,
        { needs: 'naměřené maximum proti i ve směru', lacks: 'naměřené MFE / pokračování po výstupu' }),
      usabilityRow('plannedTarget', 'Plánovaný cíl (§5.4a, c)', count(p, r => r.plannedTarget && has(r.plannedTarget.price)), p.length,
        { needs: 'cílová hladina s cenou – ne MANUAL_EXIT, ne cena převzatá z výstupu', lacks: 'plánovaná cílová hladina s cenou' }),
      usabilityRow('levelsTarget', 'Síla hladin proti TP', tRows.filter(x => has(x.row.distanceTicks) && has(x.record.mfeMeasured)).length, tRows.length,
        { unit: 'řádků', needs: 'SR řádek s cenou nebo vzdáleností + naměřené MFE', lacks: 'cena / vzdálenost SR hladiny od vstupu' }),
      usabilityRow('levelsSl', 'Síla hladin proti SL', sRows.filter(x => has(x.row.distanceTicks) && has(x.record.maeMeasured)).length, sRows.length,
        { unit: 'řádků', needs: 'SR řádek s cenou nebo vzdáleností + naměřené MAE', lacks: 'cena / vzdálenost SR hladiny od vstupu' }),
      usabilityRow('controlGroup', 'Kontrolní skupina hladin', Math.min(states.none, states.present), p.length,
        { needs: 'obchody s vědomě „žádná hladina“ i s hladinou proti TP', lacks: 'vyplněné „žádná hladina v cestě“',
          note: `žádná hladina ${states.none} · hladina ${states.present} · nevyplněno ${states.unknown} (do porovnání nevstupuje)` }),
      usabilityRow('fillRate', 'Fill rate', fill.enough ? fill.n : 0, sets.fillBase.length,
        { needs: `FILLED / NO_FILL, aspoň ${FILL_WARN_MIN_RECORDS} NO_FILL`, lacks: 'zapsané nenaplněné limitky (NO_FILL)',
          note: fill.reason, rate: fill.rate, filled: fill.filled, noFill: fill.noFill, forecast: false })
    ];
  }

  // ------------------------------------------------------------- B) úplnost

  // Podle definice deníku (missingContextKeys, R2.6) nad všemi obchody ve
  // výběru – stejný základ jako štítek „Neúplné" v deníku.
  function completeness(sets) {
    const base = sets.trades;
    const rows = N.CONTEXT_KEYS.map(field => {
      const missing = base.filter(r => r.missingContext.includes(field)).length;
      let derived = null;
      if (field === 'mfeTicks') derived = base.filter(r => r.mfe.tier === 'derived').length;
      if (field === 'maeTicks') derived = base.filter(r => r.mae.tier === 'derived').length;
      if (field === 'slPrice') derived = base.filter(r => r.slDerived === true).length;
      if (field === 'targetLevel1') derived = base.filter(r => r.targetLevel1 && (r.targetLevel1.type === 'MANUAL_EXIT' || r.targetLevel1PriceDerived)).length;
      return {
        field,
        label: L.fieldLabel(field),
        filled: base.length - missing,
        missing,
        total: base.length,
        pct: base.length ? (base.length - missing) / base.length : null,
        derived
      };
    });
    rows.sort((a, b) => ((a.pct == null ? -1 : a.pct) - (b.pct == null ? -1 : b.pct)) || a.field.localeCompare(b.field));
    return {
      rows,
      incomplete: base.filter(r => r.missingContext.length > 0).length,
      total: base.length
    };
  }

  function unknownKeys(sets) {
    const items = [];
    for (const r of sets.all) for (const u of r.unknownKeys) items.push({ record: r, field: u.field, key: u.key });
    return items;
  }

  // ------------------------------------------------------------- naživo bych nevzal (R2.5)

  // Zrcadlí computeSkipLiveStats v deníku: počítá se vždy, nezávisle na
  // přepínači. P/L = pnlRaw targetů a stoplossů, expectancy = součet / počet.
  function overall(rows) {
    const wins = rows.filter(r => r.result === 'target');
    const losses = rows.filter(r => r.result === 'stoploss');
    const sum = list => list.reduce((a, r) => a + (r.pnlRaw || 0), 0);
    const pnl = sum(wins) + sum(losses);
    const rs = rows.map(r => r.rSigned).filter(has);
    return {
      count: rows.length,
      pnl,
      winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
      expectancy: rows.length ? pnl / rows.length : null,
      expectancyR: rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null,
      rCount: rs.length
    };
  }

  // Srovnání „bez nich / s nimi" přepíná jen „naživo bych nevzal"; ostatní
  // přepínače (no fill, vynechané) platí – jako computeGroupStats v deníku.
  function skipLiveStats(sets) {
    const all = sets.trades.filter(r => !r.isLegacy && N.inPerformance(r, { ...sets.include, includeSkipLive: true }));
    const group = sets.skipLive;
    const byReason = new Map();
    for (const r of group) {
      const key = r.wouldSkipReason || '';
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(r);
    }
    return {
      ...overall(group),
      without: overall(all.filter(r => !r.wouldSkipLive)),
      with: overall(all),
      byReason: [...byReason.entries()].map(([key, rows]) => ({ key, label: key ? L.labelOf('SKIP_REASON', key) : '(bez důvodu)', ...overall(rows) }))
        .sort((a, b) => b.count - a.count)
    };
  }

  // ------------------------------------------------------------- C) kontroly

  function item(r, detail) { return { record: r, detail }; }

  function simpleCheck(id, title, base, applies, fails, statusOnFail = 'fail') {
    const relevant = base.filter(applies);
    const items = [];
    for (const r of relevant) {
      const why = fails(r);
      if (why) items.push(item(r, why));
    }
    const status = !relevant.length ? 'na' : items.length ? statusOnFail : 'pass';
    return { id, title, status, checked: relevant.length, items, summary: relevant.length ? `${items.length} z ${relevant.length}` : 'nic k ověření' };
  }

  const fmt = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

  function checkDuplicates(trades) {
    const byKey = new Map();
    for (const r of trades) {
      if (!r.date || r.entryPrice == null || r.entryMinutes == null) continue;
      const key = r.date + '|' + r.entryPrice;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    // Každý podezřelý záznam jednou, se všemi dřívějšími shodami.
    const items = [];
    for (const group of byKey.values()) {
      group.sort((a, b) => a.entryMinutes - b.entryMinutes);
      for (let j = 1; j < group.length; j++) {
        const earlier = [];
        for (let i = j - 1; i >= 0; i--) {
          const gap = group[j].entryMinutes - group[i].entryMinutes;
          if (gap > DUPLICATE_WINDOW_MIN) break;
          earlier.unshift(`${group[i].entryTime || '?'} (${fmt(gap)} min)`);
        }
        if (earlier.length) items.push(item(group[j], `stejné datum a vstup ${fmt(group[j].entryPrice)} jako ${earlier.join(', ')}`));
      }
    }
    return {
      id: 8, title: 'Možné duplicity (datum + vstupní cena + čas do 5 min)',
      status: items.length ? 'fail' : 'pass', checked: trades.length, items,
      summary: items.length ? `${items.length} podezřelých` : `bez duplicit (${trades.length} obchodů)`
    };
  }

  function checkFillRate(fillBase) {
    const f = fillStats(fillBase);
    const base = { id: 9, title: 'Fill rate není nezvykle vysoký', checked: f.n, items: [], fill: f };
    if (!f.enough) return { ...base, status: 'na', summary: f.reason };
    const pctText = `${Math.round(f.rate * 100)} % (${f.filled} FILLED / ${f.noFill} NO_FILL)`;
    if (f.n > FILL_HIGH_MIN_RECORDS && f.rate > FILL_HIGH_RATE) {
      return { ...base, status: 'warn', summary: pctText, message: 'Fill rate je nezvykle vysoký — zapisuješ všechny nenaplněné limitky?' };
    }
    return { ...base, status: 'pass', summary: pctText };
  }

  function checkSetupsOutOfPnl(sets) {
    const items = [];
    for (const r of sets.setups) {
      const leaked = PNL_FIELDS.filter(k => r.filled[k] === true);
      if (leaked.length) items.push(item(r, 'SETUP_ONLY má P/L pole: ' + leaked.join(', ')));
    }
    // Invariant Labu: výkonový vzorek ani obchody nikdy neobsahují setup.
    const codeOk = sets.perf.every(r => r.isTrade) && sets.trades.every(r => r.isTrade);
    if (!codeOk) items.push({ record: null, detail: 'Chyba Labu: SETUP_ONLY prošel do výkonového vzorku.' });
    return {
      id: 10, title: 'SETUP_ONLY mimo P/L agregace',
      status: items.length ? 'fail' : sets.setups.length ? 'pass' : 'na',
      checked: sets.setups.length, items,
      summary: sets.setups.length ? `${sets.setups.length} setupů, ${items.length} s P/L poli` : 'žádné setupy'
    };
  }

  // 11 – zkreslení mřížky chybějícím pozorováním. Chybí = postExitFavorableTicks
  // prázdné. NULA JE PLATNÉ MĚŘENÍ („dál už nic nebylo") a za chybějící
  // pozorování se NEpovažuje.
  function isWithoutObservation(r) {
    return r.postExitFavorableTicks == null;
  }

  function checkMissingObservation(perf) {
    // Jmenovatel = VŠECHNY targety. Podmínka na maxFavorableTicks by vyřadila
    // právě obchody bez pozorování (maxFavorable je z pozorování dopočtené)
    // a kontrola by se ptala sama sebe.
    const base = perf.filter(r => r.result === 'target');
    const missing = base.filter(isWithoutObservation);
    const share = base.length ? missing.length / base.length : null;
    const status = !base.length ? 'na' : share > NO_OBSERVATION_WARN_SHARE ? 'warn' : 'pass';
    return {
      id: 11, title: 'Zkreslení mřížky chybějícím pozorováním po výstupu',
      status, checked: base.length, share, missing: missing.length,
      items: missing.map(r => item(r, `target, exitTicks ${fmt(r.exitTicks)}, postExitFavorableTicks prázdné`)),
      summary: base.length ? `${missing.length} z ${base.length} (${Math.round(share * 100)} %) bez pozorování` : 'žádný target',
      message: status === 'warn'
        ? `U ${missing.length} obchodů chybí pozorování po výstupu. Ty nemohou rozlišit 'cíl byl optimální' od 'nikdo se nedíval dál' a v mřížce SL × TP budou systematicky hlasovat pro těsnější cíl.`
        : null
    };
  }

  function checkSelectiveRecording(perf) {
    const group = result => {
      const g = perf.filter(r => r.result === result);
      const filled = g.filter(r => has(r.postExitFavorableTicks)).length;
      return { n: g.length, filled, pct: g.length ? filled / g.length : null };
    };
    const target = group('target');
    const stoploss = group('stoploss');
    const base = { id: 12, title: 'Selektivní zápis pozorování podle výsledku', target, stoploss, checked: target.n + stoploss.n };
    const missingItems = perf
      .filter(r => (r.result === 'target' || r.result === 'stoploss') && !has(r.postExitFavorableTicks))
      .map(r => item(r, `${r.result}, postExitFavorableTicks prázdné`));
    if (!target.n || !stoploss.n) return { ...base, status: 'na', items: missingItems, summary: 'chybí obchody jedné ze skupin (target / stoploss)' };
    const diffPp = (target.pct - stoploss.pct) * 100;
    const pctText = `target ${Math.round(target.pct * 100)} % · stoploss ${Math.round(stoploss.pct * 100)} %`;
    if (Math.abs(diffPp) > SELECTIVE_WARN_PP) {
      const side = diffPp > 0 ? 'ziskových' : 'ztrátových';
      return {
        ...base, status: 'warn', diffPp, items: missingItems, summary: pctText,
        message: `Pozorování po výstupu zapisuješ hlavně u ${side} obchodů. Vzorek pro mřížku je tím vychýlený.`
      };
    }
    return { ...base, status: 'pass', diffPp, items: missingItems, summary: pctText };
  }

  function median(sorted) {
    const n = sorted.length;
    if (!n) return null;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  function checkObservationWindow(perf) {
    const withValue = perf.filter(r => has(r.observedMinutes));
    const values = withValue.map(r => r.observedMinutes).sort((a, b) => a - b);
    const stats = {
      filled: values.length,
      total: perf.length,
      pct: perf.length ? values.length / perf.length : null,
      min: values.length ? values[0] : null,
      median: median(values),
      max: values.length ? values[values.length - 1] : null
    };
    const base = { id: 13, title: 'Srovnatelnost okna pozorování (observedMinutes)', stats, checked: values.length };
    const statText = values.length
      ? `vyplněno ${Math.round(stats.pct * 100)} % · min ${fmt(stats.min)} · medián ${fmt(stats.median)} · max ${fmt(stats.max)} min`
      : 'observedMinutes není vyplněné u žádného obchodu';
    if (values.length < 2 || !(stats.median > 0)) return { ...base, status: 'na', items: [], summary: statText };
    const limit = WINDOW_SPREAD_FACTOR * stats.median;
    if (stats.max > limit) {
      return {
        ...base, status: 'warn', summary: statText,
        items: withValue.filter(r => r.observedMinutes > limit).map(r => item(r, `observedMinutes ${fmt(r.observedMinutes)} > ${WINDOW_SPREAD_FACTOR} × medián (${fmt(stats.median)})`)),
        message: 'Délka pozorování po výstupu se mezi obchody liší řádově. maxFavorableTicks pak u každého obchodu znamená něco jiného a v mřížce se míchají dvě různé veličiny.'
      };
    }
    return { ...base, status: 'pass', items: [], summary: statText };
  }

  function checks(sets) {
    const p = sets.perf;
    return [
      simpleCheck(1, "result='stoploss' ⇒ R < 0", p,
        r => r.result === 'stoploss' && has(r.rSigned),
        r => (r.rSigned < 0 ? null : `R se znaménkem ${fmt(r.rSigned)} (rMultiple ${fmt(r.rMultiple)}, exitTicks ${fmt(r.exitTicks)})`)),
      simpleCheck(2, "result='target' ⇒ R > 0", p,
        r => r.result === 'target' && has(r.rSigned),
        r => (r.rSigned > 0 ? null : `R se znaménkem ${fmt(r.rSigned)} (rMultiple ${fmt(r.rMultiple)}, exitTicks ${fmt(r.exitTicks)})`)),
      simpleCheck(3, '|R − exitTicks / slTicks| < 0,01', p,
        r => has(r.rSigned) && has(r.exitTicks) && r.slTicks > 0,
        r => {
          const expected = r.exitTicks / r.slTicks;
          return Math.abs(r.rSigned - expected) < R_TOLERANCE + 1e-9 ? null : `R ${fmt(r.rSigned)} vs. exitTicks/slTicks ${fmt(expected)} (${fmt(r.exitTicks)} / ${fmt(r.slTicks)})`;
        }),
      simpleCheck(4, 'Ziskový obchod nemá maeTicks > slTicks', p,
        r => r.isProfitable === true && has(r.maeTicks) && has(r.slTicks),
        r => (r.maeTicks > r.slTicks ? `maeTicks ${fmt(r.maeTicks)} > slTicks ${fmt(r.slTicks)}` : null)),
      simpleCheck(5, 'maxAdverseTicks ≥ maeTicks a maxFavorableTicks ≥ mfeTicks', p,
        r => (has(r.maxAdverseTicks) && has(r.maeTicks)) || (has(r.maxFavorableTicks) && has(r.mfeTicks)),
        r => {
          const why = [];
          if (has(r.maxAdverseTicks) && has(r.maeTicks) && r.maxAdverseTicks < r.maeTicks) why.push(`maxAdverseTicks ${fmt(r.maxAdverseTicks)} < maeTicks ${fmt(r.maeTicks)}`);
          if (has(r.maxFavorableTicks) && has(r.mfeTicks) && r.maxFavorableTicks < r.mfeTicks) why.push(`maxFavorableTicks ${fmt(r.maxFavorableTicks)} < mfeTicks ${fmt(r.mfeTicks)}`);
          return why.length ? why.join('; ') : null;
        }),
      simpleCheck(6, `slTicks ≤ ${SL_TICKS_MAX}`, p,
        r => has(r.slTicks),
        r => (r.slTicks > SL_TICKS_MAX ? `slTicks ${fmt(r.slTicks)} (slPrice ${fmt(r.slPrice)}) – pravděpodobně překlep` : null)),
      simpleCheck(7, 'Ziskový bez maeTicks nemá maxAdverseTicks = 0 (má být null)', p,
        r => r.isProfitable === true && !has(r.maeTicks) && has(r.maxAdverseTicks),
        r => (r.maxAdverseTicks === 0 ? 'maxAdverseTicks 0 bez naměřeného maeTicks' : null)),
      checkDuplicates(sets.trades),
      checkFillRate(sets.fillBase),
      checkSetupsOutOfPnl(sets),
      checkMissingObservation(p),
      checkSelectiveRecording(p),
      checkObservationWindow(p)
    ];
  }

  // ------------------------------------------------------------- D) prognóza

  // Prognóza pro KAŽDOU analýzu zvlášť, z jejího vlastního N. Hrdlo = ta
  // s nejmenším N – ta blokuje a té se má zápis věnovat. Fill rate se
  // neprognózuje (nevzniká z obchodů, ale ze zapsaných nenaplněných limitek).
  function forecast(sets, usabilityRows) {
    const days = tradingDays(sets.perf);
    const rows = usabilityRows.filter(u => u.forecast !== false).map(u => {
      const perDay = days ? u.n / days : 0;
      return {
        key: u.key, label: u.label, n: u.n, unit: u.unit, lacks: u.lacks, perDay,
        goals: FORECAST_GOALS.map(goal => ({
          goal,
          remaining: Math.max(0, goal - u.n),
          days: u.n >= goal ? 0 : perDay > 0 ? Math.ceil((goal - u.n) / perDay) : null
        }))
      };
    });
    let bottleneck = null;
    for (const row of rows) if (!bottleneck || row.n < bottleneck.n) bottleneck = row;
    return { days, rows, bottleneck };
  }

  // ------------------------------------------------------------- celek

  function computeHealth(records, options = {}) {
    const sets = partition(records, options);
    const usabilityRows = usability(sets);
    return {
      options: sets.include,
      sample: sampleOverview(sets),
      usability: usabilityRows,
      completeness: completeness(sets),
      unknownKeys: unknownKeys(sets),
      skipLive: skipLiveStats(sets),
      checks: checks(sets),
      forecast: forecast(sets, usabilityRows)
    };
  }

  return {
    USABLE_GOAL,
    SL_TICKS_MAX,
    FILL_WARN_MIN_RECORDS,
    FILL_HIGH_RATE,
    FILL_HIGH_MIN_RECORDS,
    NO_OBSERVATION_WARN_SHARE,
    SELECTIVE_WARN_PP,
    WINDOW_SPREAD_FACTOR,
    partition,
    includeOf,
    filterRecords,
    tradingDays,
    dateRange,
    fillStats,
    isWithoutObservation,
    computeHealth
  };
}));
