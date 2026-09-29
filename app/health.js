'use strict';
// Zdraví dat – fáze 1. Odpovídá na „sbírám použitelná data?", ne na „vydělává
// strategie?". Pracuje VÝHRADNĚ s výstupem LabNormalize.normalizeRecord;
// žádnou vlastní normalizaci ani čtení `raw` pro výpočty tu nedělej.
//
// Množiny záznamů:
//   trades  – TRADE záznamy (SETUP_ONLY nikdy)
//   perf    – výkonový vzorek: trades bez legacyPointsConvention a bez
//             obchodů „naživo bych nevzal" (pokud je přepínač nezapne)
//   fillBase – TRADE i SETUP_ONLY bez legacy, VČETNĚ „naživo bych nevzal":
//             naplnění limitky je mechanika vstupu, ne rozhodnutí o obchodu

(function (root, factory) {
  const normalize = (typeof module !== 'undefined' && module.exports)
    ? require('./normalize.js')
    : root.LabNormalize;
  const api = factory(normalize);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabHealth = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (N) {

  const USABLE_GOAL = 50;
  const SL_TICKS_MAX = 40;                 // stejná hranice jako v deníku (points.js)
  const R_TOLERANCE = 0.01;
  const DUPLICATE_WINDOW_MIN = 5;
  const FILL_WARN_MIN_RECORDS = 10;
  const NO_OBSERVATION_WARN_SHARE = 0.30;  // kontrola 11
  const SELECTIVE_WARN_PP = 25;            // kontrola 12, procentní body
  const WINDOW_SPREAD_FACTOR = 4;          // kontrola 13
  const FORECAST_GOALS = [50, 100];

  // Pole zvýrazněná v úplnosti – ukážou se i tehdy, když je nemá žádný obchod.
  const HIGHLIGHT_FIELDS = ['setupCode', 'slPrice', 'maeTicks', 'postExitFavorableTicks', 'targetLevel1'];
  // touchedEntry / touchedSl deník u stoplossu záměrně nevyplňuje (u stopnutého
  // obchodu jsou degenerované) – úplnost se jim měří jen mimo stoploss.
  const NOT_FOR_STOPLOSS = new Set(['touchedEntry', 'touchedSl']);

  // P/L pole, která SETUP_ONLY nesmí mít (kontrola 10).
  const PNL_FIELDS = ['pnl', 'pnlRaw', 'grossPnl', 'result', 'exitPrice', 'points', 'pointsTotal', 'pointsPerContract', 'exitTicks'];

  const has = v => v !== null && v !== undefined;

  // ------------------------------------------------------------- množiny

  function isPerformance(r, includeSkipLive) {
    return r.isTrade && !r.isLegacy && (includeSkipLive || r.isLiveEligible);
  }

  function partition(records, options = {}) {
    const includeSkipLive = !!options.includeSkipLive;
    const trades = records.filter(r => r.isTrade);
    return {
      all: records,
      trades,
      setups: records.filter(r => r.isSetupOnly),
      legacy: trades.filter(r => r.isLegacy),
      skipLive: trades.filter(r => !r.isLegacy && r.wouldSkipLive),
      perf: records.filter(r => isPerformance(r, includeSkipLive)),
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
      hasSkipLiveField: sets.all.some(r => r.hasWouldSkipLiveField),
      perf: sets.perf.length,
      days: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    };
  }

  function usabilityRow(key, label, usable, base, extra = {}) {
    const n = usable.length;
    return { key, label, n, m: base.length, missing: Math.max(0, USABLE_GOAL - n), ...extra };
  }

  function usability(sets) {
    const p = sets.perf;
    const rStat = p.filter(r => has(r.slTicks) && has(r.exitTicks));
    const sweep = p.filter(r => has(r.maxAdverseTicks));
    const reach = p.filter(r => has(r.maxFavorableTicks) && has(r.slTicks));
    const grid = p.filter(r => has(r.maxAdverseTicks) && has(r.maxFavorableTicks) && has(r.slTicks));
    const levels = p.filter(r => r.targetLevel1 && has(r.targetLevel1.type));
    const obstacles = p.filter(r => r.srTarget.length > 0);
    const obstaclesHavePlace = p.some(r => r.srTarget.some(N.levelRowHasPlace));

    const fillKnown = sets.fillBase.filter(r => r.fillStatus === 'FILLED' || r.fillStatus === 'NO_FILL');
    const filled = fillKnown.filter(r => r.fillStatus === 'FILLED').length;
    const noFill = fillKnown.length - filled;
    const fillUsable = noFill > 0 ? fillKnown : [];

    return [
      usabilityRow('r', 'R statistika', rStat, p, { needs: 'slTicks a exitTicks' }),
      usabilityRow('slSweep', 'SL sweep', sweep, p, { needs: 'maxAdverseTicks' }),
      usabilityRow('tpReach', 'Dosažitelnost TP', reach, p, { needs: 'maxFavorableTicks a slTicks' }),
      usabilityRow('grid', 'Mřížka SL × TP', grid, p, { needs: 'maxAdverseTicks, maxFavorableTicks a slTicks současně' }),
      usabilityRow('targetLevels', 'Cílové hladiny', levels, p, { needs: 'targetLevel1.type' }),
      usabilityRow('obstacles', 'Překážky', obstacles, p, {
        needs: 'srTarget neprázdné',
        note: obstaclesHavePlace ? null : 'Bez cen u srTarget nejde spočítat vzdálenost překážky od cíle (§5.4d).'
      }),
      usabilityRow('fillRate', 'Fill rate', fillUsable, sets.fillBase, {
        needs: 'FILLED / NO_FILL záznamy, aspoň jeden NO_FILL',
        note: noFill === 0 ? 'Žádný NO_FILL záznam – fill rate zatím nejde spočítat.' : null,
        rate: fillKnown.length ? filled / fillKnown.length : null,
        filled, noFill
      })
    ];
  }

  // ------------------------------------------------------------- B) úplnost

  function completeness(sets) {
    const p = sets.perf;
    const keys = new Set(HIGHLIGHT_FIELDS);
    for (const r of p) for (const k of Object.keys(r.filled)) keys.add(k);
    const rows = [];
    for (const field of keys) {
      const base = NOT_FOR_STOPLOSS.has(field) ? p.filter(r => r.result !== 'stoploss') : p;
      const filled = base.filter(r => r.filled[field] === true).length;
      rows.push({
        field,
        filled,
        total: base.length,
        pct: base.length ? filled / base.length : null,
        highlight: HIGHLIGHT_FIELDS.includes(field),
        note: NOT_FOR_STOPLOSS.has(field) ? 'bez stoplossů (tam se záměrně nevyplňuje)' : null
      });
    }
    rows.sort((a, b) => {
      const pa = a.pct == null ? -1 : a.pct, pb = b.pct == null ? -1 : b.pct;
      return pa - pb || a.field.localeCompare(b.field);
    });
    return rows;
  }

  // ------------------------------------------------------------- C) kontroly

  function item(r, detail) { return { record: r, detail }; }

  // Kontrola nad podmnožinou: `applies` vybere záznamy, `fails` vrátí text
  // selhání nebo null.
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
    // Každý podezřelý záznam jednou, se všemi dřívějšími shodami (trojice ve
    // stejné minutě = dva řádky, ne tři páry).
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

  function checkFillAllFilled(fillBase) {
    const known = fillBase.filter(r => r.fillStatus);
    const allFilled = known.length > 0 && known.every(r => r.fillStatus === 'FILLED');
    const base = { id: 9, title: 'fillStatus není 100 % FILLED', checked: known.length, items: [] };
    if (known.length <= FILL_WARN_MIN_RECORDS) return { ...base, status: 'na', summary: `jen ${known.length} záznamů s fillStatus (hranice je víc než ${FILL_WARN_MIN_RECORDS})` };
    if (allFilled) return { ...base, status: 'warn', summary: `všech ${known.length} je FILLED – nezaznamenané NO_FILL setupy zkreslí statistiku jen na přeživší` };
    const counts = {};
    for (const r of known) counts[r.fillStatus] = (counts[r.fillStatus] || 0) + 1;
    return { ...base, status: 'pass', summary: Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') };
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
  // prázdné. NULA JE PLATNÉ MĚŘENÍ („dál už nic nebylo", maxFavorableTicks pak
  // vyjde rovno exitTicks) a za chybějící pozorování se NEpovažuje.
  function isWithoutObservation(r) {
    return r.postExitFavorableTicks == null;
  }

  function checkMissingObservation(perf) {
    const base = perf.filter(r => r.result === 'target' && has(r.maxFavorableTicks));
    const missing = base.filter(isWithoutObservation);
    const share = base.length ? missing.length / base.length : null;
    const status = !base.length ? 'na' : share > NO_OBSERVATION_WARN_SHARE ? 'warn' : 'pass';
    return {
      id: 11, title: 'Zkreslení mřížky chybějícím pozorováním po výstupu',
      status, checked: base.length, share, missing: missing.length,
      items: missing.map(r => item(r, `target, maxFavorableTicks ${fmt(r.maxFavorableTicks)}, exitTicks ${fmt(r.exitTicks)}, postExitFavorableTicks prázdné`)),
      summary: base.length ? `${missing.length} z ${base.length} (${Math.round(share * 100)} %) bez pozorování` : 'žádný target s maxFavorableTicks',
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
      checkFillAllFilled(sets.fillBase),
      checkSetupsOutOfPnl(sets),
      checkMissingObservation(p),
      checkSelectiveRecording(p),
      checkObservationWindow(p)
    ];
  }

  // ------------------------------------------------------------- D) odhad

  function forecast(sets, usabilityRows) {
    const sweep = usabilityRows.find(r => r.key === 'slSweep');
    const days = new Set(sets.perf.map(r => r.date).filter(Boolean)).size;
    const perDay = days ? sweep.n / days : 0;
    return {
      usable: sweep.n,
      days,
      perDay,
      goals: FORECAST_GOALS.map(goal => ({
        goal,
        remaining: Math.max(0, goal - sweep.n),
        days: sweep.n >= goal ? 0 : perDay > 0 ? Math.ceil((goal - sweep.n) / perDay) : null
      }))
    };
  }

  // ------------------------------------------------------------- celek

  function computeHealth(records, options = {}) {
    const sets = partition(records, options);
    const usabilityRows = usability(sets);
    return {
      options: { includeSkipLive: !!options.includeSkipLive },
      sample: sampleOverview(sets),
      usability: usabilityRows,
      completeness: completeness(sets),
      checks: checks(sets),
      forecast: forecast(sets, usabilityRows)
    };
  }

  return {
    USABLE_GOAL,
    SL_TICKS_MAX,
    NO_OBSERVATION_WARN_SHARE,
    SELECTIVE_WARN_PP,
    WINDOW_SPREAD_FACTOR,
    HIGHLIGHT_FIELDS,
    partition,
    filterRecords,
    isWithoutObservation,
    computeHealth
  };
}));
