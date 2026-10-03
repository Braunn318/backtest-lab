'use strict';
// Fáze 2, otázka 1: zadávám správně SL a TP?
//
// Čte jen výstup LabNormalize.normalizeRecord. PRAVIDLO: do výpočtů vstupuje
// jen NAMĚŘENÉ MFE/MAE (mfeMeasured / maeMeasured a z nich složené
// maxFavorableMeasured / maxAdverseMeasured / slSweepAdverse). Dopočtená
// hodnota se nikdy nemíchá do průměrů, rozdělení, sweepu ani mřížky – jen se
// spočítá a ukáže jako „dopočítáno, do výpočtu nevstupuje: N".
//
// Lab nenavrhuje „optimální" nastavení. Ukazuje rozdělení a nejistotu.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabSlTp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const SL_RESERVE_TICKS = 2;          // rezerva, pod kterou je SL „těsně"
  const NEVER_RAN_SHARE = 0.5;         // MFE ≤ polovina SL ⇒ obchod se nerozjel
  const TP_CLOSE_MIN_TICKS = 4;        // pokračování po výstupu, od kterého byl cíl blízko
  const SWEEP_SL = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
  const GRID_SL = [4, 6, 8, 10, 12, 14, 16, 18, 20];
  const GRID_TP_R = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  const MFE_TP_TICKS = [4, 6, 8, 10, 12, 16, 20, 24, 30, 40];
  const MFE_TP_R = [0.5, 1, 1.5, 2, 3];
  const SAMPLE_WARN = 30;              // §5.5 specu
  const SAMPLE_GREY = 10;
  const SWEEP_SAMPLE_WARN = 50;

  const has = v => v !== null && v !== undefined;
  const t = v => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ','));

  // Percentil metodou nejbližšího pořadí – hodnota, kterou skutečně měl
  // některý obchod (žádná interpolace mezi obchody).
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // ------------------------------------------------------------- 2.1 po obchodech

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function stoppedVerdict(r, row) {
    const sl = r.slTicks;
    if (!has(sl)) return { text: 'Bez ceny SL nejde SL posoudit.', tags: ['no-sl'] };
    if (has(r.mfeMeasured) && r.mfeMeasured <= NEVER_RAN_SHARE * sl) {
      return { text: `MFE ${t(r.mfeMeasured)} t při SL ${t(sl)} t — obchod se nikdy nerozjel, chyba je ve vstupu, ne v SL.`, tags: ['entry'] };
    }
    if (has(row.widerBy)) {
      const back = r.postExitFavorableTicks;
      if (has(back) && back > Math.abs(r.exitTicks)) {
        return { text: `SL ${t(sl)} t, zasažen; cena se pak vrátila ${t(back)} t ve směru — SL o ${t(row.widerBy)} t dál by obchod uhájil.`, tags: ['sl-short'] };
      }
      const beyond = row.widerBy - 1;
      return {
        text: `SL ${t(sl)} t, zasažen; cena šla ${t(beyond)} t za SL` + (has(back) ? ` a vrátila se jen ${t(back)} t` : '') + ' — širší SL by ztrátu jen zvětšil.',
        tags: ['sl-ok']
      };
    }
    return { text: `SL ${t(sl)} t zasažen; pohyb po stopce není zapsaný — nejde říct, jestli by širší SL pomohl.`, tags: ['unknown'] };
  }

  function slPart(r, row) {
    const sl = r.slTicks;
    if (!has(sl)) return { text: 'bez ceny SL nejde SL posoudit', tag: 'no-sl' };
    if (!has(r.maeMeasured)) {
      return { text: r.mae.tier === 'derived' ? 'MAE je jen dopočtené — šířku SL nejde posoudit' : 'MAE není naměřené — šířku SL nejde posoudit', tag: 'unknown' };
    }
    const mae = r.maeMeasured;
    if (row.reserve <= 0) return { text: `MAE ${t(mae)} t ≥ SL ${t(sl)} t, a přesto nevystopován — zkontroluj zápis`, tag: 'sl-short' };
    if (row.reserve <= SL_RESERVE_TICKS) return { text: `SL ${t(sl)} t, cena proti šla ${t(mae)} t — SL byl těsně (rezerva ${t(row.reserve)} t)`, tag: 'sl-tight' };
    if (mae <= sl / 2) return { text: `SL ${t(sl)} t, cena proti šla ${t(mae)} t — SL byl zbytečně široký, ${t(mae + SL_RESERVE_TICKS)} t by stačilo`, tag: 'sl-wide' };
    return { text: `SL ${t(sl)} t, cena proti šla ${t(mae)} t — SL odpovídal`, tag: 'sl-ok' };
  }

  function tpPart(r) {
    if (r.result === 'target') {
      const fav = r.postExitFavorableTicks;
      if (!has(fav)) return { text: 'pokračování po výstupu není zapsané', tag: 'unknown' };
      if (fav === 0) return { text: 'po výstupu cena dál nešla — cíl byl na maximu', tag: 'tp-ok' };
      if (fav >= Math.max(TP_CLOSE_MIN_TICKS, NEVER_RAN_SHARE * Math.abs(r.exitTicks || 0))) {
        return { text: `TP ${t(r.exitTicks)} t, po výstupu pokračovalo dalších ${t(fav)} t — cíl byl blízko`, tag: 'tp-close' };
      }
      return { text: `po výstupu jen ${t(fav)} t — cíl odpovídal`, tag: 'tp-ok' };
    }
    if (has(r.mfeMeasured)) return { text: `obchod došel na MFE ${t(r.mfeMeasured)} t a skončil na ${t(r.exitTicks)} t`, tag: 'be' };
    return null;
  }

  function verdictOf(r, row) {
    if (r.isStopped) return stoppedVerdict(r, row);
    const a = slPart(r, row);
    const b = tpPart(r);
    return { text: capitalize(a.text) + (b ? '; ' + b.text : '') + '.', tags: [a.tag, b && b.tag].filter(Boolean) };
  }

  function tradeRow(r) {
    const row = {
      record: r,
      slTicks: r.slTicks,
      mae: r.maeMeasured, maeTier: r.mae.tier, maeRaw: r.mae.ticks,
      mfe: r.mfeMeasured, mfeTier: r.mfe.tier, mfeRaw: r.mfe.ticks,
      // rezerva SL: kolik místa do SL zbylo (jen z naměřeného MAE)
      reserve: has(r.slTicks) && has(r.maeMeasured) ? r.slTicks - r.maeMeasured : null,
      tight: null,
      // o kolik dál by SL stačil: přežití = cena SL nedosáhla (maxAdverse < SL),
      // tedy maxAdverse − SL + 1. Jen když je pohyb po stopce zapsaný.
      widerBy: null,
      returned: r.isStopped ? r.postExitFavorableTicks : null,
      leftOnTable: r.result === 'target' ? r.postExitFavorableTicks : null,
      plannedR: r.plannedRMultiple,
      actualR: r.rSigned
    };
    if (has(row.reserve)) row.tight = row.reserve <= 0 ? 'nestačil' : row.reserve <= SL_RESERVE_TICKS ? 'těsně' : null;
    if (r.isStopped && r.adverseObservedAfterExit && has(r.maxAdverseMeasured) && has(r.slTicks)) {
      row.widerBy = Math.max(0, r.maxAdverseMeasured - r.slTicks) + 1;
    }
    row.verdict = verdictOf(r, row);
    return row;
  }

  // ------------------------------------------------------------- 2.2 MAE vítězů

  function maeWinners(perf) {
    const winners = perf.filter(r => r.isProfitable === true);
    const values = winners.map(r => r.maeMeasured).filter(has).sort((a, b) => a - b);
    const p90 = percentile(values, 0.9);
    const histogram = [];
    if (values.length) {
      const top = values[values.length - 1];
      for (let from = 0; from <= top; from += 2) {
        histogram.push({ from, to: from + 1, count: values.filter(v => v >= from && v <= from + 1).length });
      }
    }
    return {
      n: values.length,
      winners: winners.length,
      derived: winners.filter(r => r.mae.tier === 'derived').length,
      missing: winners.filter(r => r.mae.tier == null).length,
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      p90,
      max: values.length ? values[values.length - 1] : null,
      // přežití = MAE < SL, takže SL musí být aspoň p90 + 1 tick
      slForP90: has(p90) ? p90 + 1 : null,
      histogram
    };
  }

  // ------------------------------------------------------------- 2.3 MFE stopnutých

  function mfeStopped(perf) {
    const stopped = perf.filter(r => r.isStopped);
    const measured = stopped.filter(r => has(r.mfeMeasured));
    const values = measured.map(r => r.mfeMeasured).sort((a, b) => a - b);
    const withSl = measured.filter(r => r.slTicks > 0);
    return {
      n: values.length,
      stopped: stopped.length,
      derived: stopped.filter(r => r.mfe.tier === 'derived').length,
      missing: stopped.filter(r => r.mfe.tier == null).length,
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      max: values.length ? values[values.length - 1] : null,
      byTicks: MFE_TP_TICKS.map(tp => {
        const reach = values.filter(v => v >= tp).length;
        return { tp, reach, pct: values.length ? reach / values.length : null };
      }),
      byR: MFE_TP_R.map(rr => {
        const reach = withSl.filter(r => r.mfeMeasured >= rr * r.slTicks).length;
        return { r: rr, n: withSl.length, reach, pct: withSl.length ? reach / withSl.length : null };
      })
    };
  }

  // ------------------------------------------------------------- 2.4 SL sweep

  // Obchod přežije šířku S, pokud protipohyb < S. U obchodu, který neskončil
  // na SL, rozhoduje MAE během obchodu; u stopnutého pohyb za stopkou – a ten
  // je známý jen tak daleko, jak daleko se uživatel po výstupu díval. Přežití
  // stopnutého obchodu bez zapsaného pohybu po stopce je NAD POZOROVANÝM
  // ROZSAHEM: sweep tam je dolní odhad a širší SL vypadá lépe, než byl.
  function slSweep(perf, options = {}) {
    const targetR = has(options.targetR) ? options.targetR : 1;
    const base = perf.filter(r => has(r.slSweepAdverse));
    const rows = SWEEP_SL.map(S => {
      let stopped = 0, survived = 0, rescued = 0, rescuedToTarget = 0, aboveObserved = 0, inWindow = 0;
      const aboveItems = [];
      for (const r of base) {
        if (r.slSweepAdverse >= S) { stopped++; continue; }
        survived++;
        if (!r.isStopped) continue;
        rescued++;
        if (has(r.maxFavorableMeasured) && r.maxFavorableMeasured >= targetR * S) rescuedToTarget++;
        if (r.adverseObservedAfterExit) inWindow++;
        else { aboveObserved++; aboveItems.push(r); }
      }
      return {
        S, n: base.length, stopped, survived,
        stoppedPct: base.length ? stopped / base.length : null,
        rescued, rescuedToTarget, inWindow, aboveObserved, aboveItems
      };
    });
    return {
      n: base.length,
      total: perf.length,
      targetR,
      derivedExcluded: perf.filter(r => !has(r.slSweepAdverse) && (r.mae.tier === 'derived')).length,
      sampleWarning: base.length < SWEEP_SAMPLE_WARN,
      rows
    };
  }

  // ------------------------------------------------------------- 2.5 mřížka SL × TP

  // Spec §5.4f, jen z naměřených hodnot:
  //   maxAdverse ≥ SL               → −SL
  //   jinak max ≥ TP × SL           → +TP × SL
  //   jinak                         → skutečný výsledek obchodu
  // SL má přednost (pořadí uvnitř baru neznáme → konzervativně).
  function gridOutcome(r, S, k) {
    if (r.maxAdverseMeasured >= S) return { kind: 'stop', ticks: -S };
    if (r.maxFavorableMeasured >= k * S) return { kind: 'target', ticks: k * S };
    return { kind: 'actual', ticks: r.exitTicks };
  }
  function gridResult(r, S, k) {
    return gridOutcome(r, S, k).ticks;
  }

  function grid(perf) {
    const base = perf.filter(r => has(r.maxAdverseMeasured) && has(r.maxFavorableMeasured) && has(r.exitTicks));
    const n = base.length;
    const cells = GRID_TP_R.map(k => GRID_SL.map(S => {
      if (!n) return { S, k, expectancyR: null, hits: 0, stops: 0 };
      let sum = 0, hits = 0, stops = 0;
      for (const r of base) {
        const o = gridOutcome(r, S, k);
        if (o.kind === 'stop') stops++;
        else if (o.kind === 'target') hits++;
        sum += o.ticks / S;
      }
      return { S, k, expectancyR: sum / n, hits, stops };
    }));
    const aboveObserved = GRID_SL.map(S => base.filter(r => r.isStopped && !r.adverseObservedAfterExit && r.maxAdverseMeasured < S).length);

    // Stabilní oblast: průměr přes okolí 3 × 3. Osamělý vrchol nad malým
    // vzorkem je šum; cennější je oblast, kde je výsledek dobrý i vedle.
    let best = null, peak = null;
    if (n) {
      for (let i = 0; i < GRID_TP_R.length; i++) {
        for (let j = 0; j < GRID_SL.length; j++) {
          const vals = [];
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const c = cells[i + di] && cells[i + di][j + dj];
            if (c && has(c.expectancyR)) vals.push(c.expectancyR);
          }
          const smooth = vals.reduce((a, v) => a + v, 0) / vals.length;
          cells[i][j].neighborhood = smooth;
          if (!best || smooth > best.value) best = { i, j, value: smooth };
          if (!peak || cells[i][j].expectancyR > peak.value) peak = { i, j, value: cells[i][j].expectancyR };
        }
      }
      for (let i = 0; i < GRID_TP_R.length; i++) {
        for (let j = 0; j < GRID_SL.length; j++) {
          cells[i][j].stable = Math.abs(i - best.i) <= 1 && Math.abs(j - best.j) <= 1;
          cells[i][j].peak = i === peak.i && j === peak.j;
          cells[i][j].stableCenter = i === best.i && j === best.j;
        }
      }
    }
    const isolatedPeak = !!(best && peak) && (Math.abs(peak.i - best.i) > 1 || Math.abs(peak.j - best.j) > 1);
    return {
      n, total: perf.length, slList: GRID_SL, tpList: GRID_TP_R, cells, aboveObserved,
      best: best && { S: GRID_SL[best.j], k: GRID_TP_R[best.i], neighborhood: best.value, expectancyR: cells[best.i][best.j].expectancyR },
      peak: peak && { S: GRID_SL[peak.j], k: GRID_TP_R[peak.i], expectancyR: peak.value },
      isolatedPeak,
      derivedExcluded: perf.filter(r => (r.mfe.tier === 'derived' || r.mae.tier === 'derived') && !base.includes(r)).length,
      sampleWarning: n < SWEEP_SAMPLE_WARN
    };
  }

  // ------------------------------------------------------------- celek

  function computeSlTp(perf, options = {}) {
    return {
      n: perf.length,
      trades: perf.map(tradeRow),
      derived: {
        mfe: perf.filter(r => r.mfe.tier === 'derived').length,
        mae: perf.filter(r => r.mae.tier === 'derived').length
      },
      maeWinners: maeWinners(perf),
      mfeStopped: mfeStopped(perf),
      sweep: slSweep(perf, options),
      grid: grid(perf)
    };
  }

  return {
    SL_RESERVE_TICKS, SWEEP_SL, GRID_SL, GRID_TP_R, SAMPLE_WARN, SAMPLE_GREY, SWEEP_SAMPLE_WARN,
    percentile, median, tradeRow, maeWinners, mfeStopped, slSweep, gridOutcome, gridResult, grid, computeSlTp
  };
}));
