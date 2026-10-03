# Backtest Lab — denní risk management (fáze 3)

> Zadání pro Claude Code · 3. 10. 2026 · navazuje na `BACKTEST_TOOL_SPEC.md`
> a `ZADANI_FAZE_2.md`. Rozhodnutí uživatele jsou v §8 — řiď se jimi.
>
> **Dělá se až po fázi 2.** Platí beze změny: Lab je read-only, branch `test`.

---

## 1. Co ta funkce dělá

Vezme **skutečný sled obchodů** den po dni, pustí ho znovu pod navrženým
pravidlem a spočítá, jak by den dopadl.

```
3. 8.  W L L W W W L L W L L L      skutečnost:  +761 USD
       ───────┤ pravidlo „konec po 2 SL za sebou"
       W L L                        pod pravidlem: −xxx USD, 9 obchodů nevzato
```

Pravidlo nikdy nemění ceny — jen **odřízne konec dne**. Obchody, které by
následovaly, se spočítají zvlášť jako **ušlý zisk nebo ušetřená ztráta**.
To je celé jádro: pravidlo se neposuzuje podle toho, kolik ušetří,
ale podle **rozdílu** mezi ušetřeným a zahozeným.

---

## 2. Pravidla, která jdou testovat

| pravidlo | parametr | odpovídá tvému příkladu |
|---|---|---|
| denní ztrátový limit | konec dne při −X | „max ztráta 300 USD za den" |
| max SL za sebou | konec dne po N ztrátách v řadě | „max 2× SL" |
| max SL za den | konec dne po N ztrátách celkem | |
| max obchodů za den | konec po N obchodech | |
| denní cíl | konec dne při +X | |
| **vrácení zisku** | konec, když se z denního maxima vrátí X | „obchoduj v zisku až do 1× SL" |
| žádné pravidlo | kontrolní varianta | **povinně vždy zobrazená** |

„Obchoduj dokud jsi v plusu, konec po první ztrátě" je zvláštní případ
vrácení zisku — parametrizuj ho jako *konec, když denní P/L klesne o X
pod své maximum*, ne jako „po první ztrátě". Jedna ztráta po pěti ziscích
je něco jiného než jedna ztráta po jednom zisku.

Pravidla jdou **kombinovat** (ztrátový limit + max SL za sebou zároveň).

---

## 3. Co se vypisuje ke každé variantě

```
celkové P/L · max drawdown · nejhorší den · nejlepší den · počet ziskových dnů
dnů utnutých pravidlem · kolik obchodů nevzato
ušetřeno na zablokovaných ztrátách  −  zahozeno na zablokovaných ziscích  =  čistý přínos
```

Poslední řádek je ten, na kterém to stojí. Denní stop **vždycky** sníží
drawdown — to není zjištění. Zjištění je, jestli za to nezaplatíš víc,
než ušetříš.

K tomu tabulka **po dnech**: co udělal den ve skutečnosti, co by udělal
pod pravidlem, a rozdíl. Ať je vidět, jestli celkový výsledek nestojí
na jednom nebo dvou dnech.

---

## 4. Test náhodnosti sérií — běží PŘED optimalizací a je povinný

Tvoje úvaha stojí na předpokladu, že ztráty se **shlukují** — že po dvou SL
je třetí pravděpodobnější. Pokud to tak není, pravidlo „konec po 2 SL"
neumí špatné obchody předvídat; umí jen zmenšit rozptyl.

Lab proto nejdřív spočítá:

- **runs test** — je střídání W/L náhodnější nebo shlukovanější, než odpovídá
  tvému win rate?
- **permutační srovnání** — zamíchej pořadí obchodů 10 000×; jak často náhoda
  vyrobí stejně dlouhou sérii ztrát jako tvoje nejdelší?
- **podmíněný win rate** — jaký je win rate obchodu po 1 ztrátě, po 2, po 3?
  A po 1, 2, 3 ziscích? Ploché čáry = žádné shlukování.

Výsledek se zobrazí **nad** optimalizací, jednou větou, ne schovaný v detailu:

> *„Série ve tvých datech jsou v mezích náhody (z = +0,47). Pravidlo po N ztrátách
> nedokáže špatný obchod předvídat — omezí rozptyl, nezvýší edge."*

nebo

> *„Ztráty se shlukují víc, než odpovídá náhodě (z = −2,4). Pravidlo po N ztrátách
> má na čem stát."*

**Už teď, na tvých 129 živých obchodech, vychází první varianta** (§7).

---

## 5. Ochrany proti přeoptimalizování

Tahle obrazovka je ze všech nejnáchylnější. Parametry pracují na úrovni **dne**,
takže vzorek není 144 obchodů, ale **35 dnů**. Hledat v mřížce patnácti variant
optimum přes 35 pozorování je přesně to, co nefunguje.

Povinné:

1. **N = počet dnů**, zobrazené u každé varianty. Ne počet obchodů.
2. **Leave-one-day-out**: každou variantu přepočti 35× vždy bez jednoho dne.
   Zobraz rozsah, ne jen průměr. Varianta, která se bez jednoho dne rozpadne,
   stojí na tom dni, ne na pravidle.
3. **Žádné „doporučené nastavení"**, dokud leave-one-out nedrží. Místo toho
   ukaž **stabilní oblast** — sousedící varianty s podobným výsledkem.
   Osamělé maximum označ jako šum.
4. **Časové rozdělení**: první polovina dnů vs. druhá. Pravidlo nalezené
   na první polovině musí fungovat i na druhé, jinak je to tvar minulosti.
5. Pod 20 dnů obrazovka **nenabídne optimum vůbec** — jen vypíše, co se stalo,
   a kolik dnů chybí.

---

## 6. Jednotky — počítej v R, zobrazuj v USD

Tvůj příklad je v dolarech, ale dolary se mezi deníky nedají porovnat:

```
Backtest_1   ES   2 kontrakty   50 USD/bod   medián |P/L| 362 USD
Phidias 1    MES  2 kontrakty    5 USD/bod   medián |P/L|  24 USD
```

Stejný obchod je v jednom deníku desetkrát větší. Pravidlo „max ztráta
300 USD za den" znamená v jednom deníku dva obchody a v druhém dvacet.

Proto: **limity se zadávají i počítají v R** (násobcích rizika), a vedle se
zobrazí, kolik to dělá v USD pro zvolený deník a velikost pozice. Pole na
zadání velikosti účtu a velikosti pozice patří nahoru na obrazovku.

---

## 7. Co tvoje dnešní data říkají

**Phidias 1 — 35 dnů, 144 obchodů (živě/sim, MES)**

```
win rate 43 %          celkem −220 USD        nejhorší den −144    nejlepší +335
nejdelší série ztrát 7           nejdelší série zisků 8
runs test z = +0,47  →  série jsou NÁHODNÉ
```

Na těchto datech **„konec po 2 SL" nemá co předvídat.** Po dvou ztrátách
je pravděpodobnost třetí stejná jako jindy. Pravidlo ti usekne i dny, které
se po dvou ztrátách otočily — a takové tam jsou (24. 8.: `L W L L W W W`).

To neznamená, že denní stop je zbytečný. Znamená to, že jeho smysl je **ochrana
účtu v challengi**, ne vyšší zisk. To je dobrý důvod, ale jiný — a optimalizovat
se pak má na „nejmenší šance porušit limit", ne na „nejvyšší P/L".

**Backtest_1 — 5 dnů, 54 obchodů (replay, ES)**

```
win rate 48 %     celkem +7 003 USD     všech 5 dnů ziskových
runs z = −1,64 (mírné shlukování, na 54 obchodech neprůkazné)
```

Pět dnů je na tuhle funkci **málo** — a pět ziskových dnů z pěti znamená,
že žádné pravidlo nemá co zlepšovat. Rozdíl mezi +7 000 za 5 dnů v replayi
a −220 za 35 dnů naživo je tak velký, že risk management kalibrovaný na
backtestu na živý účet nesedne. Kalibruj na obojím a porovnej.

---

## 8. Rozhodnutí uživatele — 3. 10. 2026

### 8.1 Data: oba deníky vedle sebe

Obrazovka počítá **Phidias 1** (živě, MES, 35 dnů) i **Backtest_1** (replay, ES,
5 dnů) a staví výsledky **vedle sebe**, ne do jednoho čísla. Deníky se nikdy
nesčítají — mají jinou velikost kontraktu i jiný způsob vzniku.

U každého deníku vždy viditelně: počet dnů, instrument, velikost pozice.
Rozdíl mezi nimi je dnes zásadní (replay +7 003 USD / 5 dnů, živě −220 / 35 dnů);
pokud jedna varianta vychází dobře na jednom a špatně na druhém, **napiš to**.

Seznam deníků ber z `ai-export/index.json`, výběr je na uživateli (R2.7).

### 8.2 Nic nedoporučuj — ukaž všechny tři metriky

Ke každé variantě pravidla se zobrazí vedle sebe:

```
čistý přínos  (ušetřené ztráty − zahozené zisky)
max drawdown
nejhorší den
```

**Lab nevybírá vítěze a neřadí podle jedné metriky.** Žádné „doporučené
nastavení", žádná zvýrazněná buňka s maximem. Zvýrazni jen **stabilní oblast**
(sousedící varianty s podobným výsledkem) a varianty, které neprojdou
leave-one-day-out (§5) — ty označ jako nespolehlivé.

Důvod je v §4: dokud jsou série náhodné, „nejlepší" varianta je tvar minulosti.

### 8.3 Žádný tvrdý limit challenge

Uživatel uvádí, že Phidias nemá pevný denní limit ani trailing drawdown —
limity si určuje sám. Všechny hodnoty jsou tedy **parametry k prozkoumání**,
ne mantinely, a sloupec „kolikrát bys porušil limit" se **nedělá**.

Připrav to ale tak, aby šel doplnit jedním polem: `hardDailyLoss`
a `trailingDrawdown` v konfiguraci, prázdné = nepoužívá se. Kdyby se ukázalo,
že challenge nějaký limit má, je to změna na jednom místě, ne přestavba.

---

## 9. Pořadí stavby

1. **Sekvenční analýza** (§4) — runs test, permutace, podmíněný win rate.
   Postav ji **první a samostatně**. Dá odpověď i bez simulátoru a rozhoduje
   o tom, jak se má zbytek číst.
2. **Simulátor dne** (§1–§3) — jedno pravidlo, jeden deník, tabulka po dnech.
3. **Mřížka variant** + leave-one-day-out a časové rozdělení (§5).
4. **Dva deníky vedle sebe** (§8.1).

Po každém kroku aktualizuj `CLAUDE.md` a `CHANGELOG.txt`.

---

## 10. Testy (mutation-checked)

1. simulátor utne den ve správném obchodě a zbytek dne spočítá jako nevzatý
2. „vrácení zisku" se měří od **denního maxima**, ne od nuly
3. varianta „žádné pravidlo" dá přesně skutečné P/L deníku
4. čistý přínos = ušetřené ztráty − zahozené zisky (ne jen ušetřené)
5. leave-one-day-out opravdu vynechává den, ne obchod
6. runs test na známé sekvenci vrátí známé z
7. deníky se nikdy nesčítají do jednoho výsledku
8. pod 20 dnů se optimum nenabídne
9. read-only pojistka drží
