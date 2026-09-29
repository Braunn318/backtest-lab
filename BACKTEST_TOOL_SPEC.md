# Backtest Lab — samostatná aplikace pro testování strategií

> Zadání pro Claude Code. Nový projekt, ne úprava deníku.
> Pracovní název `Backtest Lab`, přejmenuj podle chuti.
> Verze 1.0, 13. 9. 2026 · Autor zadání: Adam

---

## 1. Co to je a čím to není

Nástroj, ve kterém Adam vyhodnocuje obchody pořízené v NinjaTrader Market Replay
(a časem i jinde) proti definované strategii, a hledá nejvýhodnější velikost SL a cíle.

**Není to automatický tester strategií.** Obchody vznikají tím, že je Adam naklikal —
jeho metoda stojí na diskrečním čtení order flow, které se zakódovat nedá. Tool obchody
**anotuje a počítá**, negeneruje.

### Hranice vůči Futures Journal PRO

Futures Journal PRO (`F:\Trading\Denik\DEV\repo_clone`, Electron) zůstává **beze změny**
a je jediný, kdo mluví s NinjaTraderem. Jeho NT8 konektor je nejzrádnější část celého
projektu a je odladěný — nepřepisuj ho, nekopíruj, nevolej.

```
NinjaTrader ──► Futures Journal PRO ──► ai-export/<journalId>.json ──► Backtest Lab
                     (zápis)                  (čtení, read-only)        (anotace + analýza)
```

**Backtest Lab do deníku ani do jeho datové složky NIKDY nezapisuje.** Dva procesy nad jedním
souborem jsou v tomhle projektu obzvlášť citlivé — jednou už kvůli tomu došlo ke ztrátě dat.

---

## 2. Zdroj obchodů

`%APPDATA%\futures-journal-pro\ai-export\<journalId>.json`

Deník ten soubor přepisuje při každém uložení, takže je vždy aktuální. Obsahuje celé objekty
obchodů bez base64 obrázků. Cesta musí být v nastavení přepsatelná — Adam má datovou složku
konfigurovatelnou.

**Čti ho živě při každém otevření, needukuj kopii.** Anotace se klíčují na `trade.id`.
Když obchod z deníku zmizí, anotace se nemaže — označí se jako **osiřelá** a zobrazí
v samostatném seznamu. Nikdy ji nemaž automaticky.

Ze zdroje ber jako neměnná tato pole a nikdy je nepřepisuj:
`id`, `journalId`, `date`, `entryTime`, `exitTime`, `instrument`, `side`, `entryPrice`,
`exitPrice`, `contracts`, `commission`, `pnlRaw`, `result`, `pointsPerContract`,
`pointsTotal`, `legs`, `externalAccount`.

Obchody s příznakem `legacyPointsConvention` **vylouči z analýz** a v seznamu je označ —
to jsou Adamovy historické obchody s nejednoznačnou konvencí bodů.

---

## 3. Datový model

### 3.1 Strategie (uživatelsky definovaná)

```
Strategy {
  id, name, description,
  fields: [FieldDef],
  createdAt, updatedAt
}

FieldDef {
  key,                  // stabilní klíč, needitovatelný po vytvoření
  label,                // zobrazovaný název
  type,                 // 'select' | 'multiselect' | 'number' | 'text' | 'boolean'
  options: [{key,label}],   // jen pro select/multiselect
  group,                // volitelné seskupení v UI ("Kontext", "Order flow")
  hotkey,               // volitelná klávesa pro rychlé zadávání
  required              // jen měkké varování, nikdy neblokuje uložení
}
```

Adam si strategii založí a nadefinuje jí pole. `Strategy.md` v jeho Obsidian vaultu je
předloha, ne zdroj — **nic z ní nekóduj natvrdo.** Přilož ji jen jako předvyplněnou šablonu
„M2 + Order Flow", kterou si může upravit nebo smazat.

**Verzování:** změna definice pole nesmí zneplatnit existující anotace. Odebrané pole
se označí `archived: true` a jeho hodnoty zůstanou — v analýzách se dál dají použít.
Klíč pole je neměnný, mění se jen `label`.

### 3.2 Anotace obchodu

```
Annotation {
  tradeId, strategyId,
  values: { <fieldKey>: value },     // uživatelská pole
  slPrice,                            // STRUKTURÁLNÍ
  maePoints, mfePoints,               // STRUKTURÁLNÍ
  excursionSource: 'manual'|'nt8'|'bars',
  fillStatus: 'FILLED'|'NO_FILL'|'MISSED'|'SKIPPED',   // STRUKTURÁLNÍ
  targetLevels: [ {level, price} ],   // typ hladiny + cena, viz 3.2b
  targetObstacles: [ {obstacle, price} ],  // co stálo cíli v cestě, viz 3.2b
  postExit: { … },                    // co cena udělala po výstupu, viz 3.2b
  note, screenshots: [path],
  updatedAt
}
```

**Klíčové rozdělení, na kterém stojí celá obecnost nástroje:**

| | Pole | Role |
|---|---|---|
| **Strukturální** | `slPrice`, `maePoints`, `mfePoints`, `fillStatus` + neměnná pole z deníku | s nimi analytický engine **počítá**; jsou pevná a stejná pro každou strategii |
| **Uživatelská** | cokoli z `FieldDef` | engine s nimi nepočítá, jsou to **výhradně dimenze pro řezy** |

Díky tomu funguje „libovolná strategie" bez zásahu do kódu: analytika umí jen těch pár
strukturálních veličin, a **jakékoli uživatelské pole se automaticky objeví jako dimenze**,
podle které jde statistiku rozpadnout.

### 3.2b Cíle, překážky a chování ceny po výstupu

Jádro odpovědi na „jaký target a jaký SL nastavit". Rozdělení je zásadní:

- **Co zapisuje Adam** — věci, které stroj z čísel nevyčte, protože jsou to jeho pozorování grafu.
- **Co dopočítá stroj** — všechno ostatní, z těch zapsaných čísel.

#### Cílové hladiny

`targetLevels` — pro TG1 a TG2 vždy **typ hladiny i cena**. Typ ber ze stejného číselníku
jako hladiny vstupu (`ENTRY_LEVEL`), aby šly obě strany obchodu porovnávat stejnou optikou:
likvidita, VPOC dne, netestovaný VPOC 30min svíce, VPOC jiné minutové svíce, VAH, VAL, VWAP,
odchylka VWAP, hrana gapu, LTA level, hrana M2/IB.

Cena je povinná — bez ní nejde spočítat, na kolika R ta hladina ležela.

#### Překážky proti cíli

`targetObstacles` — multi-select, co leželo mezi vstupem a cílem a mohlo pohyb zastavit:

```
OBSTACLE = {
  VPOC_DAY, VPOC_30M, VPOC_1M, VAH, VAL, VWAP, VWAP_DEV,
  HIGH_VOLUME_NODE,        // uzel s velkou volume na cestě
  ABS_AGAINST,             // absorpce proti směru obchodu
  BIG_ASKS_AT_HIGH,        // velké asky na high (u longu) / bidy na low (u shortu)
  LIQUIDITY,               // nevybraná likvidita – magnet i brzda
  GAP_EDGE, LTA_LEVEL,
  NONE
}
```

Ke každé překážce ulož i cenu, ať jde spočítat, jak daleko před cílem ležela.

#### Co cena udělala po výstupu — zapisuje Adam ručně

**Pravidlo měření, bez kterého jsou čísla neporovnatelná:** obě čísla měř **od vstupní ceny**,
v okně **15 minut od vstupu, nebo do konce obchodního okna, co nastane dřív.**

Patnáct minut vychází z Adamových dat: ze 79 obchodů jich 47 trvalo do 3 minut a 71 do 10 minut,
medián jsou 3 minuty. Delší okno by připisovalo pohyby, které by reálně nikdy nedržel.
Jedno pravidlo pro všechny obchody, žádné „tady jsem to nechal doběhnout".

```
postExit {
  maxTicks,          // nejdál ve SMĚRU obchodu, od vstupní ceny, v ticích
  maxLevel,          // na jaké hladině se to zastavilo (ENTRY_LEVEL číselník)
  maxAdverseTicks,   // nejdál PROTI pozici, od vstupní ceny, v ticích
  touchedEntry,      // bool – vrátila se cena na vstupní cenu?
  touchedSl          // bool – vrátila se až na původní SL?
}
```

`maxAdverseTicks` je odpověď na „nebyl SL v tomhle obchodě moc těsný". U stopnutého obchodu
pokračuje za zásah SL — když byl SL 12 ticků a `maxAdverseTicks` je 14, SL o 4 ticky dál
by přežil. U nestopnutého obchodu je to totéž co MAE.

**Nezapisuje se, co se stalo po tom, co cena definitivně odešla proti.** Otočka po deseti
minutách Adama nezajímá a do okna se stejně nevejde — okno je záměrně krátké právě proto.

`touchedEntry` a `touchedSl` jsou pole, na která by Adam sám nepřišel, a bez nich se nedá
nic spočítat poctivě: samotné `maxTicks` neříká, jestli se cena mezitím nevrátila
a širší cíl by nebyl vystopován dřív, než ho dosáhne.

**U každého obchodu se vyplňuje všech pět.** Dvě čísla, jeden výběr, dva přepínače.

### 3.3 Setup bez obchodu

Kandidát, ze kterého obchod nevznikl. V deníku pro něj není místo (nemá exekuci), takže
patří sem — a tím se ten problém řeší celý.

```
SetupRecord {
  id, strategyId, date, time, instrument, direction,
  plannedEntry, slPrice, targetLevels,
  values: { <fieldKey>: value },
  fillStatus: 'NO_FILL'|'MISSED'|'SKIPPED',
  reason, candidateId, note
}
```

**Nikdy nevstupuje do P/L ani do equity.** Vstupuje do četnosti setupů a do fill rate.

### 3.4 Kandidáti z M2 Scanneru

Import CSV z NinjaScript indikátoru (`M2_SCANNER_SPEC.md`, sloupec `candidate_id`).
Kandidát se páruje na obchod podle instrumentu a času (tolerance ±2 min, párování potvrzuje
uživatel), nebo se z něj jedním kliknutím stane `SetupRecord`, když obchod nevznikl.

Tím se uzavře smyčka: **scanner najde → Adam v replayi rozhodne → deník zapíše → Lab vyhodnotí.**

### 3.5 Barová data

1min OHLC na instrument a den, importované z NT8 (`Tools → Historical Data → Export`).
Samostatná entita, ne součást obchodu — jeden den obsluhuje víc obchodů.
Potřebná jen pro analýzy po výstupu (§5.4).

---

## 4. Import

Jeden obecný, mapovatelný CSV importér — ne tři specializované:

1. Uživatel vybere soubor, tool ukáže hlavičku a prvních pět řádků
2. Uživatel namapuje sloupce na cílová pole, mapování se uloží jako **profil** pod názvem
3. Příště stačí profil vybrat

Předpřipravené profily: **NT8 Trade Performance** (zdroj MAE/MFE), **M2 Scanner**,
**1min OHLC**. TradingView se přidá jako další profil, až bude potřeba — žádný kód navíc.

Importér musí zvládnout desetinnou čárku i tečku, `;` i `,` jako oddělovač a UTF-8 s BOM.
Řádek, který nejde zpracovat, **přeskoč a vypiš** — nikdy tiše nezahazuj.

### MAE / MFE

Primárně z NT8 Trade Performance (jednotky přepnuté na **body**, ne měnu).
Párování: instrument + čas vstupu (±5 s) + směr. Nespárované nech prázdné a vypiš jejich počet.
U merged obchodu ber maximum přes nohy. Ruční hodnota má vždy přednost, importér ji nepřepíše.

---

## 5. Analýza

Engine pracuje jen se strukturálními veličinami. Každá analýza jde filtrovat
podle libovolného uživatelského pole.

Základ: `slPoints = |entryPrice − slPrice|`, `R = pointsPerContract / slPoints`
(**nikdy** z `pointsTotal`).

### 5.1 Rozpad podle libovolné dimenze

Vyber pole → tabulka `hodnota | N | Win % | Avg R | Expectancy (R) | Suma R | Fill rate | Avg MAE | Avg MFE`.
U `multiselect` se záznam započítá do každé vybrané hodnoty — do hlavičky napiš,
že se řádky proto nesčítají na celkové N.

### 5.2 SL sweep — hlavní přínos celého nástroje

Pro každou kandidátní velikost `S` ∈ {1.0, 1.25, … 4.0}:

```
pokud maePoints[i] >= S:  vysledek_S[i] = -S            // byl by vystopován
jinak:                    vysledek_S[i] = pointsPerContract[i]
r_S[i] = vysledek_S[i] / S
```

Výstup: tabulka + křivka expectancy proti velikosti SL.
Tahle simulace jen kontroluje, jestli by cena na užší SL sáhla. Nic nedomýšlí.

### 5.3 Rozdělení MAE a MFE

Histogram MAE u **ziskových** obchodů + tabulka „kolik % winnerů mělo MAE ≥ X bodů"
pro X = 0.5 … 4.0. Totéž pro MFE u všech naplněných.
Plus `mfePoints − pointsPerContract` = nevyužitý pohyb uvnitř obchodu.

### 5.4 Optimalizace cíle a SL — z ručně zapsaných pozorování

Všechno níže se počítá z `postExit`, `slPoints` a `maePoints`. Barová data nejsou potřeba.
Značení: `sl` = `slPoints` v ticích, `max` = `postExit.maxTicks`.

#### a) Které násobky R byly dosažitelné

Pro `X` ∈ {0.5, 1, 1.5, 2, 2.5, 3, 4, 5}:

```
dosazeno_X = (max >= X * sl) AND (postExit.touchedSl == false)
```

Tabulka „cíl na X R → dosažen v N % obchodů → expectancy".
Přímá odpověď na „nevyšlo 1:2, ale vyšlo by 1:1".

⚠️ `touchedSl` je v té podmínce nutné. Bez něj bys počítal jako úspěch i pohyb,
který se cestou vrátil na SL a byl by vystopován dřív, než cíle dosáhl.

#### b) Kolik bylo nechané na stole

`max − pointsPerContract v ticích` = co bylo k dispozici a Adam to nevzal.
Rozpad podle typu cílové hladiny odpoví, které hladiny systematicky vystupují moc brzo.

#### c) Dosažitelnost podle typu hladiny

Pro každý typ hladiny, který se objevil jako cíl nebo jako `maxLevel`: jak často
na něm cena zastavila, jak často ho přestřelila a o kolik.

Jádro Adamova pravidla, že se target volí podle hladiny — tohle řekne, které fungují.

#### d) Vliv překážek

Hit rate cíle u obchodů **s** překážkou mezi vstupem a cílem vs. **bez** ní,
rozpadem podle typu překážky, a se vzdáleností překážky od cíle.

Odpovídá na: stojí za to mířit za VPOC dne, nebo se tam pohyb spolehlivě zastaví?

#### e) SL sweep — jede z `maxAdverseTicks`

Nahrazuje základní sweep ze §5.2: `maePoints` z NinjaTraderu končí u výstupu a u stopnutých
obchodů proto neumí odpovědět na „stačil by SL o kousek dál". `maxAdverseTicks` ano.

```
pro každé S:  pokud maxAdverse >= S → -S, jinak skutečný výsledek
```

Navíc vypiš zvlášť: **kolik stopnutých obchodů by při jaké šířce SL skončilo ziskem**
(`maxAdverse < S` a zároveň `max >= zvolený cíl`). To je přímá odpověď na to,
jestli Adama těsný SL stojí obchody.

`maePoints` z NT8 si ponech jako kontrolu: u nestopnutých obchodů se musí rovnat
`maxAdverseTicks`; větší rozdíl znamená chybu v zápisu.

#### f) Mřížka SL × TP

Pro každou kombinaci `SL ∈ {1.0 … 4.0}` × `TP ∈ {0.5R … 5R}` expectancy přes celý vzorek,
zobrazená jako tabulka s barevnou škálou.

```
pokud maxAdverse >= SL:                           vysledek = -SL
jinak pokud max >= TP*SL AND touchedSl == false:  vysledek = +TP*SL
jinak:                                            vysledek = skutečný výsledek obchodu
```

⚠️ V první podmínce musí být `maxAdverseTicks`, **ne** `maePoints` z NinjaTraderu.
MAE končí v okamžiku výstupu: u obchodu stopnutého na 12 ticích řekne 12, takže by ti
kandidátní SL na 13 ticků vyšel jako „přežil by" i v případě, že cena došla na 14.

Tahle mřížka je to, podle čeho si Adam nastaví SL a cíle. **Nikdy ji nezobrazuj bez varování
o vzorku** — hledání maxima v mřížce nad padesáti obchody je učebnicová ukázka
přeoptimalizování. Vyznač i okolí maxima: stabilní oblast je cennější než osamělý vrchol.

#### g) Scale-out vs. jeden cíl

Adam obchoduje 2 MES kontrakty a používá obě varianty:

```
jeden cíl:  celá pozice na TP
scale-out:  1. kontrakt na TG1, 2. kontrakt na TP s SL na breakeven
            → runner vydělá, pokud max >= TP*sl A touchedEntry == false
            → runner skončí na BE, pokud touchedEntry == true
```

Expectancy obou variant pro stejnou dvojici (TG1, TP). Odpovídá na to,
jestli Adamovi runner vůbec platí.

### 5.5 Varování před malým vzorkem

`N < 30` → ikona a tooltip. `N < 10` → celý řádek zešedne. SL sweep navíc varuje při `N < 50`.
**Povinné.** Nejčastější chyba ručního backtestu je závěr z osmi obchodů.

---

## 6. UI

Electron, stejný stack i vizuální jazyk jako Futures Journal PRO — Adam si má sáhnout
do známého prostředí. Motiv a komponenty klidně převezmi z `app/index.html`.

Sekce: **Obchody** (seznam s anotacemi) · **Setupy** (záznamy bez obchodu) ·
**Strategie** (editor polí) · **Analýza** · **Import** · **Nastavení**.

### Anotační formulář

Anotace se vyplňuje po dávkách 15–30 obchodů. **Jeden obchod do 15 vteřin, celé z klávesnice.**

- Číselníky jako **dlaždice s přiřazenou klávesou**, ne dropdowny
- `Enter` uloží a otevře další **nevyplněný** obchod v dávce, `Esc` zavře bez uložení
- Nahoře „obchod 7 / 24"
- Hromadné vyplnění vybraných řádků (typicky celý replay den má stejný kontext),
  přepisuje jen pole vyplněná v dialogu
- Filtr „jen nedokončené" a indikátor u obchodů bez `strategyId` nebo bez `slPrice`

---

## 7. Rozsah první verze

Postav **jen to, co Adam potřebuje na M2 + Order Flow.** Obecnost má být ve struktuře
(definovatelná pole, mapovatelný import), ne v počtu funkcí.

| Fáze | Obsah |
|---|---|
| **1** | čtení ai-exportu, seznam obchodů, editor strategie, anotační formulář, ruční SL |
| **2** | import MAE/MFE z NT8, rozpad podle dimenzí, SL sweep, rozdělení MAE/MFE |
| **3** | `SetupRecord`, fill rate |
| **4** | optimalizace cíle a SL (§5.4) — mřížka SL × TP, překážky, scale-out |

Po fázi 1 může Adam začít anotovat. Fáze 2 dává smysl až kolem 50 obchodů.

**Nedělej dopředu:** vlastní NT8 konektor, TradingView import, cloud, export do deníku,
generátor strategií, optimalizátor parametrů nad víc proměnnými najednou.

---

## 7.1 Volitelně později — automatický dopočet z dat NT8

Ruční zápis podle §3.2b stačí na všechno v §5.4 a **staví se jako první.**
Tahle sekce je alternativa, ne předpoklad.

NinjaTrader umí přes `Tools → Historical Data → Export` vyexportovat tickovou nebo minutovou
historii za zvolené dny do CSV. Import takového souboru (profil v §4) by `postExit` dopočítal
přesně místo ručního odhadu a umožnil jemnější mřížku.

**Tickovou, ne minutovou.** Adamův SL je 2–4 body a cíle 3–10 bodů; jedna minutová svíčka na MES
běžně urazí víc, takže by v jednom baru ležel SL i cíl a z OHLC by nešlo určit pořadí.
Konzervativní pravidlo („počítej to jako SL") by systematicky podhodnotilo všechny cíle.

**Ruční zápis se tím neznehodnotí.** NinjaTrader si data drží, takže kterýkoli odehraný den
jde vyexportovat i zpětně. Ruční hodnota zůstane, dopočtená se uloží vedle ní s příznakem
`derived: true` a rozdíl se vypíše — to je zároveň kontrola, jak spolehlivě Adam odhaduje.

---

## 8. Akceptační kritéria

- [ ] Tool běží s vypnutým deníkem a nezapíše ani bajt do `futures-journal-pro`.
- [ ] Smazání obchodu v deníku nezpůsobí ztrátu anotace — objeví se jako osiřelá.
- [ ] Nová strategie s vlastními poli jde založit bez zásahu do kódu a její pole se
      **automaticky** objeví jako dimenze v rozpadu (§5.1).
- [ ] Odebrání pole ze strategie nezneplatní existující anotace.
- [ ] `R` se počítá z `pointsPerContract`, nikdy z `pointsTotal`. Test na obchodu se 2 kontrakty.
- [ ] Obchody s `legacyPointsConvention` jsou z analýz vyloučené a v seznamu označené.
- [ ] `SetupRecord` nefiguruje v žádné P/L agregaci; fill rate = `FILLED / (FILLED + NO_FILL)`.
- [ ] SL sweep: obchod s `maePoints >= S` je vyhodnocen jako `−S`.
- [ ] Dosažitelnost cíle (§5.4a) počítá s podmínkou `touchedSl == false`; obchod s `max >= X*sl`, ale `touchedSl == true`, se NEpočítá jako dosažený.
- [ ] Mřížka SL × TP se nezobrazí bez varování o velikosti vzorku a bez vyznačení okolí maxima.
- [ ] Scale-out varianta používá `touchedEntry` jako podmínku breakevenu runneru.
- [ ] `postExit.maxTicks` i `maxAdverseTicks` se zadávají jako vzdálenost OD VSTUPNÍ CENY, ne od výstupu — v UI to musí být napsané přímo u pole.
- [ ] Mřížka SL × TP i SL sweep používají `maxAdverseTicks`, nikdy `maePoints`.
- [ ] U nestopnutého obchodu se `maePoints` z NT8 a `maxAdverseTicks` shodují; rozdíl se vypíše jako varování.
- [ ] Import MAE/MFE nepřepíše ručně zadanou hodnotu a vypíše počet nespárovaných řádků.
- [ ] 10 obchodů jde okontextovat bez sáhnutí na myš.
- [ ] Řádky s `N < 30` mají varování o malém vzorku.
