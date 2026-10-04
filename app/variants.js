'use strict';
// Fáze 3, krok 3: mřížka variant + ochrany proti přeoptimalizování
// (PLAN_RISK_MANAGEMENT.md §5, rozhodnutí §8.2).
//
// Každé pravidlo zvlášť přes řadu hodnot parametru (rodina variant). Sousedé
// jsou sousední hodnoty téhož pravidla. Kombinace víc parametrů najednou se
// nehledají – spec §7 výslovně: žádný optimalizátor nad víc proměnnými.
//
// Lab NEVYBÍRÁ VÍTĚZE (§8.2): žádné „doporučené nastavení", žádné řazení
// podle jedné metriky, žádná zvýrazněná buňka s maximem. Ke každé variantě
// vedle sebe čistý přínos, max drawdown a nejhorší den. Zvýrazní se jen:
//  - stabilní oblast: aspoň 3 sousední varianty, které projdou leave-one-day-
//    out a mají stejné znaménko čistého přínosu (přidává / ubírá),
//  - osamělá kladná varianta (sousedé nepřidávají) = šum,
//  - varianta, která neprojde leave-one-day-out = nespolehlivá.
//
// Vzorek je počet DNŮ, ne obchodů. Pod 20 dny se nic z toho nehodnotí –
// obrazovka jen vypíše, co se stalo, a kolik dnů chybí (§5.5).
//
// Čte výsledky LabDaySim.simulate (stejná množina, pořadí a jednotka R).

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const daysim = isNode ? require('./daysim.js') : root.LabDaySim;
  const api = factory(daysim);
  if (isNode) module.exports = api;
  if (root) root.LabVariants = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {

  const MIN_DAYS = D.MIN_DAYS;
  const STABLE_MIN_RUN = 3;
  const EPS = 1e-9;   // součty plovoucí čárky: „nic nezměnilo" není 1e-15
  const FAMILIES = [
    { key: 'consecutiveSL', values: [1, 2, 3, 4, 5] },
    { key: 'dailySL', values: [2, 3, 4, 5, 6] },
    { key: 'maxTrades', values: [2, 3, 4, 5, 6, 8] },
    { key: 'dailyLoss', values: [1, 1.5, 2, 2.5, 3, 4, 5] },
    { key: 'giveBack', values: [1, 1.5, 2, 2.5, 3, 4] },
    { key: 'dailyTarget', values: [2, 3, 4, 5, 6, 8] }
  ];

  const sum = a => a.reduce((s, v) => s + v, 0);
  const sign = v => (v > EPS ? 1 : v < -EPS ? -1 : 0);
  // Čistý přínos přes množinu dnů = Σ (pod pravidlem − skutečnost).
  const netOf = days => sum(days.map(d => d.diffR));

  // Leave-one-day-out: varianta přepočtená N× vždy bez jednoho DNE (ne obchodu).
  // Neprojde, když po vynechání kteréhokoli dne čistý přínos změní znaménko
  // nebo spadne na nulu – pak stojí na tom dni, ne na pravidle.
  function leaveOneDayOut(days) {
    const full = netOf(days);
    const rows = days.map((d, i) => {
      const rest = days.filter((_, j) => j !== i);
      const s = D.summary(rest, 'rule');
      return { date: d.date, netR: full - d.diffR, maxDrawdownR: s.maxDrawdownR, worstDayR: s.worstDayR };
    });
    const nets = rows.map(r => r.netR);
    const dds = rows.map(r => r.maxDrawdownR);
    const breaking = sign(full) === 0 ? [] : rows.filter(r => sign(r.netR) !== sign(full));
    return {
      rows,
      min: nets.length ? Math.min(...nets) : null,
      max: nets.length ? Math.max(...nets) : null,
      ddMin: dds.length ? Math.min(...dds) : null,
      ddMax: dds.length ? Math.max(...dds) : null,
      // null = pravidlo nic nezměnilo, není co posuzovat
      pass: sign(full) === 0 || rows.length < 2 ? null : breaking.length === 0,
      breakingDates: breaking.map(r => r.date)
    };
  }

  // Časové rozdělení: první polovina dnů vs. druhá (při lichém počtu má druhá
  // o den víc). Drží, když má čistý přínos v obou polovinách stejné znaménko.
  function timeSplit(days) {
    const half = Math.floor(days.length / 2);
    const first = days.slice(0, half), second = days.slice(half);
    const a = netOf(first), b = netOf(second);
    return {
      first: { days: first.length, netR: a, from: first[0] && first[0].date, to: first.length ? first[first.length - 1].date : null },
      second: { days: second.length, netR: b, from: second[0] && second[0].date, to: second.length ? second[second.length - 1].date : null },
      holds: sign(a) === 0 || sign(b) === 0 ? null : sign(a) === sign(b)
    };
  }

  // Značky v rodině (pole variant v pořadí parametru). Jen při dost dnech.
  function markFamily(variants, enoughDays) {
    for (const v of variants) { v.stable = null; v.isolated = false; }
    if (!enoughDays) return variants;
    let i = 0;
    while (i < variants.length) {
      const s = sign(variants[i].netR);
      let j = i;
      while (j < variants.length && s !== 0 && variants[j].looPass === true && sign(variants[j].netR) === s) j++;
      if (j - i >= STABLE_MIN_RUN) for (let k = i; k < j; k++) variants[k].stable = s > 0 ? 'up' : 'down';
      i = Math.max(j, i + 1);
    }
    variants.forEach((v, idx) => {
      if (sign(v.netR) <= 0 || v.stable) return;
      const neighbors = [variants[idx - 1], variants[idx + 1]].filter(Boolean);
      v.isolated = neighbors.length > 0 && neighbors.every(n => sign(n.netR) <= 0);
    });
    return variants;
  }

  function variantOf(records, family, value, options) {
    const sim = D.simulate(records, { [family.key]: value }, options);
    const v = {
      family: family.key, value,
      netR: sim.netR, savedR: sim.savedR, forgoneR: sim.forgoneR,
      totalR: sim.rule ? sim.rule.totalR : null,
      maxDrawdownR: sim.rule ? sim.rule.maxDrawdownR : null,
      worstDayR: sim.rule ? sim.rule.worstDayR : null,
      cutDays: sim.cutDays, skippedTrades: sim.skippedTrades,
      // Kolik by vyneslo NÁHODNÉ vynechání stejného počtu obchodů. Při záporné
      // expectancy vyjde každé pravidlo, které obchody ubírá, kladně jen proto,
      // že obchodů je míň – tohle to od pravidla odliší (navazuje na §4).
      chanceR: null, beyondChanceR: null,
      loo: null, looPass: null, split: null
    };
    if (sim.none && sim.none.trades) {
      v.chanceR = -(sim.none.totalR / sim.none.trades) * sim.skippedTrades;
      v.beyondChanceR = v.netR - v.chanceR;
    }
    if (sim.enoughDays) {
      v.loo = leaveOneDayOut(sim.days);
      v.looPass = v.loo.pass;
      v.split = timeSplit(sim.days);
    }
    return { v, sim };
  }

  function computeVariants(records, options = {}) {
    const control = D.simulate(records, {}, options);
    const days = control.days.length;
    const enoughDays = days >= MIN_DAYS;
    const res = {
      days,
      enoughDays,
      missingDays: Math.max(0, MIN_DAYS - days),
      unit: control.unit,
      contracts: control.contracts,
      // Kontrolní varianta „žádné pravidlo" – povinně vždy zobrazená.
      none: control.none,
      meanR: control.none && control.none.trades ? control.none.totalR / control.none.trades : null,
      families: []
    };
    if (!control.none) return res;
    res.families = FAMILIES.map(family => {
      const variants = family.values.map(value => variantOf(records, family, value, options).v);
      return { key: family.key, variants: markFamily(variants, enoughDays) };
    });
    return res;
  }

  return { MIN_DAYS, STABLE_MIN_RUN, FAMILIES, leaveOneDayOut, timeSplit, markFamily, computeVariants };
}));
