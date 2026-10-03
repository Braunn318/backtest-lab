'use strict';
// Obrazovka „Denní risk – pomáhá denní stop, nebo jen zmenšuje rozptyl?".
// Fáze 3, krok 1: jen sekvenční analýza (LabSequence.computeSequence).
// Verdikt jednou větou nahoře – rozhoduje o tom, jak číst simulátor
// a mřížku variant, které přijdou pod něj.

(function () {
  const SQ = window.LabSequence;
  const { esc, pct, num, metric, sampleNote, SAMPLE_GREY } = window.LabUI;

  function options(ctx) {
    return { includeSkipLive: !!ctx.views.includeSkipLive };
  }

  function heroCard(res, ctx) {
    const b = res.base;
    const cls = res.verdict.kind === 'clustered' ? 'warn-card' : '';
    const pill = { random: 'NÁHODNÉ', clustered: 'SHLUKOVÁNÍ', alternating: 'STŘÍDÁNÍ', insufficient: 'MÁLO DAT' }[res.verdict.kind];
    const notes = [];
    if (b.legacy) notes.push(`${b.legacy} legacy obchodů započteno (výsledek u nich platí, nejistá je jen konvence bodů)`);
    if (b.excluded.breakeven) notes.push(`${b.excluded.breakeven} breakeven vynecháno`);
    if (b.excluded.other) notes.push(`${b.excluded.other} s jiným výsledkem vynecháno`);
    if (b.skipLive) notes.push(`${b.skipLive} „naživo bych nevzal“ započteno`);
    if (b.noTime) notes.push(`${b.noTime} bez času vstupu (řazeno podle pořadí v deníku)`);
    const setupWarn = ctx.views.setupCode
      ? '<div class="obs-warning">⚠ Je zapnutý filtr setupu – sekvence vynechává obchody, které mezi nimi proběhly. Pro otázku denního stopu ber celý den bez filtru setupu.</div>'
      : '';
    return `<div class="card ${cls}">
      <h2><span class="pill ${res.verdict.kind === 'insufficient' ? 'warn' : 'tag'}">${pill}</span> Shlukují se ztráty?</h2>
      <p class="hero-message" style="font-size:16px"><b>${esc(res.verdict.text)}</b></p>
      ${setupWarn}
      <div class="metrics" style="margin-top:14px">
        ${metric('Obchodů W/L', String(res.n), `celkem ${b.trades} obchodů`)}
        ${metric('Dnů', String(b.days), 'denní pravidlo pracuje se dny')}
        ${metric('Win rate', pct(res.conditional.overall.rate), `${res.runs.wins} zisků / ${res.runs.losses} ztrát`)}
        ${metric('Runs test z', res.runs.z == null ? '—' : SQ.fmtZ(res.runs.z), res.runs.valid ? 'záporné = shlukování' : 'nelze vyhodnotit')}
      </div>
      <p class="muted" style="font-size:12.5px">${sampleNote(res.n)}${notes.length ? ' · ' + esc(notes.join(' · ')) : ''}</p>
    </div>`;
  }

  function runsCard(res) {
    const r = res.runs;
    return `<div class="card">
      <h2>Runs test</h2>
      <p class="section-sub">Je střídání zisků a ztrát náhodnější, nebo shlukovanější, než odpovídá tvému win rate? Celá sekvence v čase, přes dny; breakeven nevstupuje.</p>
      <div class="metrics">
        ${metric('Sérií ve skutečnosti', String(r.runs))}
        ${metric('Očekávaných při náhodě', r.expected == null ? '—' : num(Math.round(r.expected * 100) / 100))}
        ${metric('z', r.z == null ? '—' : SQ.fmtZ(r.z), `|z| ≥ ${num(SQ.Z_SIGNIFICANT)} = průkazné`)}
      </div>
      ${r.reason ? `<div class="obs-warning">⚠ ${esc(r.reason)}</div>` : ''}
      <p class="muted" style="font-size:12px">Méně sérií než při náhodě (z &lt; 0) = zisky i ztráty chodí v blocích. Víc sérií (z &gt; 0) = střídají se.</p>
    </div>`;
  }

  function permutationCard(res) {
    const p = res.permutation;
    return `<div class="card">
      <h2>Nejdelší série proti náhodě</h2>
      <p class="section-sub">Pořadí týchž obchodů zamíchané ${p.iterations.toLocaleString('cs-CZ')}×. Jak často náhoda vyrobí stejně dlouhou nebo delší sérii ztrát jako tvoje nejdelší?</p>
      <div class="metrics">
        ${metric('Nejdelší série ztrát', String(res.longestLoss))}
        ${metric('Nejdelší série zisků', String(res.longestWin))}
        ${metric('Náhoda ji vyrobí', p.p == null ? '—' : pct(p.p), `${p.atLeast.toLocaleString('cs-CZ')} z ${p.iterations.toLocaleString('cs-CZ')} zamíchání`)}
      </div>
      <p class="muted" style="font-size:12px">Vysoké procento = tak dlouhá série ztrát je při tvém win rate běžná, ne známka „špatného dne“.</p>
    </div>`;
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
    return `<div class="card">
      <h2>Podmíněný win rate</h2>
      <p class="section-sub">Jaký je win rate obchodu po 1, 2, 3 ztrátách za sebou – a po 1, 2, 3 ziscích? Počítá se uvnitř dne (série se na začátku dne nuluje), protože denní pravidlo vidí jen svůj den. Ploché řádky = žádné shlukování.</p>
      <div class="table-scroll"><table><thead><tr><th>Obchod</th><th class="num">N</th><th class="num">Win rate</th><th class="num">Proti celku</th></tr></thead><tbody>
        ${row('Všechny obchody', c.overall)}
        ${row('První obchod dne', c.firstOfDay)}
        ${c.afterLosses.map(x => row(`Po ${x.k} ${x.k === 1 ? 'ztrátě' : 'ztrátách'} za sebou`, x)).join('')}
        ${c.afterWins.map(x => row(`Po ${x.k} ${x.k === 1 ? 'zisku' : 'ziscích'} za sebou`, x)).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:12px">Pod ${SQ.NO_PCT_BELOW} případy bez procent – procento ze dvou případů není údaj. Šedě N &lt; ${SAMPLE_GREY}. Řádky se nesčítají – obchod po 3 ztrátách je zároveň i „po 1“ a „po 2“.</p>
    </div>`;
  }

  function render(ctx) {
    const res = SQ.computeSequence(ctx.records, options(ctx));
    return heroCard(res, ctx)
      + `<div class="two-col even">${runsCard(res)}${permutationCard(res)}</div>`
      + conditionalCard(res)
      + '<p class="muted" style="font-size:12px">Simulátor dne a mřížka variant pravidel přijdou v dalších krocích – tahle analýza rozhoduje o tom, jak je číst.</p>';
  }

  // Hlavička „Počítá se": tahle obrazovka bere i legacy obchody (výsledek
  // u nich platí), takže její N je jiné než výkonový vzorek ostatních obrazovek.
  function scope(ctx) {
    const b = SQ.sequenceBase(ctx.records, options(ctx));
    return { n: b.items.length, note: `obchodů W/L za ${b.days} dnů${b.legacy ? `, z toho ${b.legacy} legacy` : ''}` };
  }

  window.LabScreens = window.LabScreens || {};
  window.LabScreens.risk = { title: 'Denní risk', question: 'Pomáhá denní stop, nebo jen zmenšuje rozptyl?', render, scope };
})();
