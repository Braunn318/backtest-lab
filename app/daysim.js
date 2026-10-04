'use strict';
// Fáze 3, krok 2: simulátor dne (PLAN_RISK_MANAGEMENT.md §1–§3).
//
// Vezme skutečný sled obchodů den po dni a pustí ho znovu pod pravidlem.
// Pravidlo NIKDY nemění ceny ani výsledky – jen odřízne konec dne. Obchody,
// které by následovaly, se spočítají zvlášť: ušetřené ztráty a zahozené zisky.
// Pravidlo se posuzuje podle ROZDÍLU (čistý přínos), ne podle toho, kolik ušetří.
//
// Jednotky (§6): limity se zadávají i počítají v R, USD se jen zobrazí.
// R obchodu = pnlRaw / (1 R v USD). 1 R je jednotka deníku: medián ztráty
// obchodu na SL (pnlRaw, tedy včetně komise), uživatel ji může přepsat.
// Per-trade R z rMultiple nejde: legacy obchody ho nemají (do sérií a USD
// vstupují – rozhodnutí 3. 10.) a ani u novějších není u všech.
//
// Množina a pořadí obchodů = LabSequence.sequenceBase (stejně jako krok 1).
// Obchod bez pnlRaw se nedá přehrát – vypadne a spočítá se.
// Čte jen výstup LabNormalize.normalizeRecord.

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const sequence = isNode ? require('./sequence.js') : root.LabSequence;
  const api = factory(sequence);
  if (isNode) module.exports = api;
  if (root) root.LabDaySim = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (SQ) {

  const MIN_DAYS = 20;   // §5: pod 20 dnů se optimum nenabízí (krok 3)
  const has = v => v !== null && v !== undefined;
  const sum = a => a.reduce((s, v) => s + v, 0);

  // Pravidla (§2). Prázdné = nepoužívá se. Kombinují se: den končí
  // u prvního obchodu, po kterém kterékoli z nich zabere.
  //   dailyLoss      R    konec, když denní P/L ≤ −X
  //   consecutiveSL  N    konec po N stoplossech za sebou (jiný výsledek řadu přeruší)
  //   dailySL        N    konec po N stoplossech za den celkem
  //   maxTrades      N    konec po N obchodech
  //   dailyTarget    R    konec, když denní P/L ≥ +X
  //   giveBack       R    konec, když denní P/L klesne o X pod své denní MAXIMUM
  //                       (maximum začíná na 0 – start dne)
  const RULE_KEYS = ['dailyLoss', 'consecutiveSL', 'dailySL', 'maxTrades', 'dailyTarget', 'giveBack'];

  // Tvrdé limity challenge (§8.3). Dnes je Phidias nemá → prázdné = nepoužívá se.
  // Kdyby se objevily, doplní se jen hodnota:
  //   hardDailyLoss     R  den končí při −X (jako dailyLoss, ale je to mantinel)
  //   trailingDrawdown  R  účet skončí, když equity klesne o X pod své maximum –
  //                        zbytek období se už neobchoduje
  const LIMIT_KEYS = ['hardDailyLoss', 'trailingDrawdown'];

  function positiveOrNull(v) {
    const n = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : n;
  }

  function cleanRules(input = {}) {
    const out = {};
    for (const key of [...RULE_KEYS, ...LIMIT_KEYS]) out[key] = positiveOrNull(input[key]);
    return out;
  }

  function hasAnyRule(rules) {
    return [...RULE_KEYS, ...LIMIT_KEYS].some(k => has(rules[k]));
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // 1 R v USD: medián ztráty obchodu na SL. Přepis má přednost.
  function unitOf(trades, override) {
    const losses = trades.filter(r => r.result === 'stoploss' && has(r.pnlRaw) && r.pnlRaw < 0).map(r => -r.pnlRaw);
    const auto = median(losses);
    const manual = positiveOrNull(override);
    return { usd: manual != null ? manual : auto, auto, n: losses.length, overridden: manual != null };
  }

  // ------------------------------------------------------------- jeden den

  // Které pravidlo zabere po právě vzatém obchodu (null = žádné).
  function triggerOf(rules, s) {
    if (has(rules.hardDailyLoss) && s.cum <= -rules.hardDailyLoss) return 'hardDailyLoss';
    if (has(rules.dailyLoss) && s.cum <= -rules.dailyLoss) return 'dailyLoss';
    if (has(rules.consecutiveSL) && s.slStreak >= rules.consecutiveSL) return 'consecutiveSL';
    if (has(rules.dailySL) && s.slCount >= rules.dailySL) return 'dailySL';
    if (has(rules.maxTrades) && s.count >= rules.maxTrades) return 'maxTrades';
    if (has(rules.dailyTarget) && s.cum >= rules.dailyTarget) return 'dailyTarget';
    if (has(rules.giveBack) && s.peak - s.cum >= rules.giveBack) return 'giveBack';
    return null;
  }

  // trades: [{ record, r }] jednoho dne v pořadí. account: sdílený stav přes
  // dny kvůli trailingDrawdown ({ equity, peak, blown }).
  function simulateDay(trades, rules, account = { equity: 0, peak: 0, blown: false }) {
    const s = { cum: 0, peak: 0, slStreak: 0, slCount: 0, count: 0 };
    const out = trades.map(t => ({ ...t, taken: false }));
    let reason = null;
    for (const t of out) {
      if (account.blown) break;
      t.taken = true;
      s.count++;
      s.cum += t.r;
      s.peak = Math.max(s.peak, s.cum);
      if (t.record.result === 'stoploss') { s.slStreak++; s.slCount++; } else s.slStreak = 0;
      account.equity += t.r;
      account.peak = Math.max(account.peak, account.equity);
      if (has(rules.trailingDrawdown) && account.peak - account.equity >= rules.trailingDrawdown) account.blown = true;
      reason = triggerOf(rules, s);
      if (reason) break;
    }
    if (!reason && account.blown) reason = 'trailingDrawdown';
    const taken = out.filter(t => t.taken).length;
    const skipped = out.filter(t => !t.taken);
    const stopAfter = taken - 1;
    const actualR = sum(out.map(t => t.r));
    const ruleR = sum(out.filter(t => t.taken).map(t => t.r));
    return {
      trades: out,
      actualR,
      ruleR,
      diffR: ruleR - actualR,
      // Utnutý den = pravidlo zabralo a nějaký obchod se kvůli tomu nevzal.
      cut: skipped.length > 0,
      stopAfter: skipped.length ? stopAfter : null,   // index posledního vzatého obchodu
      reason: skipped.length ? reason : null,
      skipped: skipped.length,
      savedR: sum(skipped.filter(t => t.r < 0).map(t => -t.r)),
      forgoneR: sum(skipped.filter(t => t.r > 0).map(t => t.r))
    };
  }

  // ------------------------------------------------------------- souhrn varianty

  // Max drawdown po obchodech přes celé období (equity od 0, vzaté obchody).
  function maxDrawdown(rs) {
    let eq = 0, peak = 0, dd = 0;
    for (const r of rs) {
      eq += r;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    return dd;
  }

  function summary(days, pick) {
    const dayR = days.map(d => pick === 'rule' ? d.ruleR : d.actualR);
    const rs = days.flatMap(d => d.trades.filter(t => pick === 'none' || t.taken).map(t => t.r));
    return {
      days: days.length,
      totalR: sum(dayR),
      maxDrawdownR: maxDrawdown(rs),
      worstDayR: dayR.length ? Math.min(...dayR) : null,
      bestDayR: dayR.length ? Math.max(...dayR) : null,
      profitableDays: dayR.filter(v => v > 0).length,
      trades: rs.length
    };
  }

  // ------------------------------------------------------------- celek

  function simulate(records, rulesInput, options = {}) {
    const rules = cleanRules(rulesInput);
    const base = SQ.sequenceBase(records, options);
    const withPnl = base.ordered.filter(r => has(r.pnlRaw));
    const unit = unitOf(withPnl, options.unitUSD);
    const contracts = median(withPnl.map(r => r.contracts).filter(has));
    const res = {
      rules,
      active: hasAnyRule(rules),
      unit,
      contracts,
      instruments: [...new Set(withPnl.map(r => r.instrument).filter(Boolean))],
      // Deník může míchat instrumenty (Phidias 1: MES + FDXS + ES) – UI to hlásí.
      instrumentCounts: [...withPnl.reduce((m, r) => m.set(r.instrument || '?', (m.get(r.instrument || '?') || 0) + 1), new Map())]
        .map(([instrument, n]) => ({ instrument, n })).sort((a, b) => b.n - a.n),
      legacy: withPnl.filter(r => r.isLegacy).length,
      missingPnl: base.ordered.length - withPnl.length,
      trades: withPnl.length,
      days: [],
      none: null,
      rule: null,
      enoughDays: false
    };
    if (!has(unit.usd) || !withPnl.length) return res;

    const byDay = new Map();
    for (const r of withPnl) {
      const key = r.date || '(bez data)';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ record: r, r: r.pnlRaw / unit.usd });
    }
    const account = { equity: 0, peak: 0, blown: false };
    res.days = [...byDay.entries()].map(([date, trades]) => ({ date, ...simulateDay(trades, rules, account) }));
    res.none = summary(res.days, 'none');
    res.rule = summary(res.days, 'rule');
    res.enoughDays = res.days.length >= MIN_DAYS;

    res.savedR = sum(res.days.map(d => d.savedR));
    res.forgoneR = sum(res.days.map(d => d.forgoneR));
    // Čistý přínos = ušetřené ztráty − zahozené zisky (= P/L pod pravidlem − skutečnost).
    res.netR = res.savedR - res.forgoneR;
    res.cutDays = res.days.filter(d => d.cut).length;
    res.skippedTrades = sum(res.days.map(d => d.skipped));

    // Stojí výsledek na jednom dvou dnech? Čistý přínos bez dvou dnů,
    // které pravidlo změnilo nejvíc.
    const top = [...res.days].filter(d => d.cut).sort((a, b) => Math.abs(b.diffR) - Math.abs(a.diffR)).slice(0, 2);
    res.topDays = top.map(d => ({ date: d.date, diffR: d.diffR }));
    res.netWithoutTopR = res.netR - sum(top.map(d => d.diffR));
    return res;
  }

  return { MIN_DAYS, RULE_KEYS, LIMIT_KEYS, cleanRules, hasAnyRule, unitOf, triggerOf, simulateDay, maxDrawdown, summary, simulate };
}));
