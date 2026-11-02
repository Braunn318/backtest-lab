'use strict';
// Jednotka vzdáleností: ticky, nebo body (pokyn uživatele 2. 11. 2026).
//
// Počítá se vždy v ticích – přepínač mění jen to, jak se vzdálenost ukáže
// a zadá. Body = tiky × velikost ticku. Obrazovka ukazuje body jen tehdy,
// když všechny záznamy výběru mají stejnou známou velikost ticku (ES / MES /
// NQ / MNQ = 0,25). Jinak (např. „Všechny" s FDXS, který Lab nezná) zůstane
// v ticích a `fallback` říká proč – ticky různých nástrojů se nepřevádějí
// každý zvlášť, protože agregáty (p90, sweep, mřížka) je sčítají dohromady.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LabUnits = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const UNITS = ['ticks', 'points'];
  const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

  function normalizeUnit(unit) {
    return unit === 'points' ? 'points' : 'ticks';
  }

  // Číslo česky: max. 2 desetinná místa, desetinná čárka, bez zbytečných nul.
  function cz(v, digits = 2) {
    const f = Math.pow(10, digits);
    const r = Math.round(Number(v) * f) / f;
    return (Object.is(r, -0) ? 0 : r).toString().replace('.', ',');
  }

  // Společná velikost ticku všech záznamů; null, když některý ji nemá nebo se liší.
  function commonTickSize(records) {
    let ts = null;
    for (const r of records || []) {
      const t = r && Number(r.tickSize);
      if (!(t > 0)) return null;
      if (ts === null) ts = t;
      else if (Math.abs(ts - t) > 1e-12) return null;
    }
    return ts;
  }

  // Kontext jednotky pro jednu obrazovku. Všechny metody berou tiky.
  function make(requested, tickSize, empty = false) {
    const pts = requested === 'points' && tickSize > 0;
    const conv = v => (pts ? Math.round(Number(v) * tickSize * 10000) / 10000 : Number(v));
    const suffix = pts ? 'b' : 't';
    return {
      unit: pts ? 'points' : 'ticks',
      requested,
      tickSize: pts ? tickSize : null,
      // Chtěl body, ale výběr je nemá jak převést (prázdný výběr nic neukazuje).
      fallback: requested === 'points' && !pts && !empty,
      suffix,
      // tiky → číslo v jednotce (null zůstane null)
      value: v => (finite(v) ? conv(v) : null),
      // tiky → text čísla bez jednotky ("4,25")
      num: v => (finite(v) ? cz(conv(v)) : '—'),
      // tiky → "17 t" / "4,25 b"; signed: "+" / "−" před číslem
      d(v, opts) {
        if (!finite(v)) return '—';
        const x = conv(v);
        if (opts && opts.signed) return (x > 0 ? '+' : x < 0 ? '−' : '') + cz(Math.abs(x)) + ' ' + suffix;
        return cz(x) + ' ' + suffix;
      },
      // číslo zadané v jednotce → tiky (vstupy); přijímá i desetinnou čárku
      toTicks(v) {
        const n = typeof v === 'string' ? Number(v.replace(/\s+/g, '').replace(',', '.')) : Number(v);
        if (v === '' || v === null || v === undefined || !Number.isFinite(n)) return null;
        return pts ? Math.round((n / tickSize) * 10000) / 10000 : n;
      },
      // slovo podle jednotky: word('ticky', 'body')
      word: (ticksWord, pointsWord) => (pts ? pointsWord : ticksWord)
    };
  }

  function context(records, unit) {
    const requested = normalizeUnit(unit);
    return make(requested, requested === 'points' ? commonTickSize(records) : null, !(records && records.length));
  }

  // Výchozí kontext (ticky) pro volání bez jednotky – logika i testy.
  const TICKS = make('ticks', null);
  const of = U => U || TICKS;

  // Krátká poznámka pro obrazovku, která chtěla body a ukazuje ticky.
  const FALLBACK_NOTE = 'Vzdálenosti jsou v ticích – výběr obsahuje instrumenty s různou nebo neznámou velikostí ticku. Pro body vyber jeden instrument nahoře.';

  return { UNITS, normalizeUnit, cz, commonTickSize, context, TICKS, of, FALLBACK_NOTE };
}));
