# Backtest Lab 0.5 — přestavba: Diagnóza + Co kdyby

> Zadání pro Claude Code · 21. 10. 2026 · repozitář `F:\Trading\Denik\BackTestLab DEV`, branch `test`.
> **Nahrazuje `ZADANI_LAB_SIMULATOR_CILE.md`** (nebyl implementován — jeho §3 je převzatý níže).
> Merge do `main` až po ověření uživatelem.

## 0. Proč

Uživatel se v Labu nevyzná. Obrazovky odpovídají na otázky, které si nepoložil (síla hladin,
runs test, mřížky), a výhrady přebíjí obsah. Co potřebuje, je přesně tohle (ručně spočítané
z jeho dat 21. 10.):

> Od 14. 9. 104 obchodů, −753 $, z toho 393 $ poplatky. První obchod dne −69 $ (≈ 0 R),
> všechno ostatní −685 $. Po dvou SL v dni dalších 40 obchodů za −300 $. Dny s 5+ obchody −480 $.
> Ze 14 dnů, kdy byl v plusu, vrátil 393 $. Obchody s FOMO v poznámce −404 $. Ze 42 ztrát
> 22 nešlo do zisku víc než 2 ticky → problém je vstup, ne SL. „Konec po prvním SL nebo targetu"
> by dalo −44 $ místo −753 $.

Lab má tohle umět říct sám, srozumitelně, s čísly a s odkazem na konkrétní obchody.
A má mít průvodce „Co kdyby", kde si uživatel naklikne pravidla dne, jiný cíl (RRR) nebo SL
a uvidí P/L.

**Platí dál:** Lab jen čte. Do výpočtů MFE / MAE jen naměřené hodnoty (`*Measured`). Žádné číslo bez `N`.
Stavy vzorku ✓ / ~ („Předběžně") / – a prahy 10 / 30 se nesnižují.
**Mění se:** zákaz vět typu „doporučuji" zůstává, ale věta smí říct fakt simulace
(„Kdyby den skončil po prvním SL nebo targetu, P/L by bylo −44 $ místo −753 $"). To není doporučení.

---

## 1. Nová navigace — jen tři položky

```
Diagnóza          ← otevře se po spuštění
Co kdyby          ← průvodce
Data              ← dnešní „Zdraví dat a co vyplnit"
  ▸ Pokročilé     ← sbalené: SL a TP, Hladiny, Kontext, Denní risk (beze změny, nic nemazat)
```

Souhrn (0.4) zaniká — jeho výsledkové dlaždice přecházejí do hlavičky Diagnózy.

Nahoře na všech obrazovkách jeden řádek výběru: **deník · období (výchozí: celé) · instrument
(výchozí: nejčastější v deníku) · setup (vše)**. Výběr platí pro Diagnózu i Co kdyby a pamatuje se.

---

## 2. Obrazovka Diagnóza

### 2.1 Hlavička (bez tabulek)

Dlaždice: `Obchodů` · `P/L $` · `z toho poplatky $` · `Win %` · `Průměrná výhra / ztráta (R)` ·
**`Win % potřebné na nulu`** (z průměrné výhry, ztráty a poplatku v R) · `Poplatek na obchod v R`.

Pod tím **P/L po týdnech** jako jednoduché sloupce (zelená / červená, hodnota nad sloupcem).

### 2.2 „Kde ztrácím a kde vydělávám" — hlavní část

Seznam karet seřazený podle **dopadu v $**. Každá karta = jedno srovnání z katalogu (2.3):

```
[stav]  Po dvou SL ve stejný den: 40 obchodů, −300 $, 28 % targetů.        dopad −212 $
        Zbytek: 64 obchodů, −453 $.                                          n = 40   [Obchody ▾]
        ▮▮▮▮▮▮▮▮▮▮▮▮ (dvě vodorovné lišty: tahle skupina × zbytek, průměr $ na obchod)
```

- **Dopad** = `P/L skupiny − n_skupiny × průměr P/L na obchod mimo skupinu`. Jedno číslo, podle něj se řadí.
- Nahoře **5 karet s největší ztrátou**, pod nimi **3 s největším ziskem** („Co funguje").
  Zbytek pod „Zobrazit všechna srovnání".
- **[Obchody ▾]** rozbalí obchody té skupiny: datum, čas, směr, setup, výsledek, P/L, poznámka
  (zkrácená, celá v tooltipu). Bez toho uživatel číslům nevěří.
- Skupina pod 10 obchodů se nezobrazí v top seznamu (jen ve „všech" zešedle), 10–29 = „Předběžně".
- Nevyplněno je vždy vlastní skupina a **nikdy** se nepočítá jako „žádná / ne".

### 2.3 Katalog srovnání (jedno místo v kódu, `app/diagnosis.js`)

Každé srovnání = skupiny + text. Bez ručních prahů, kromě košů uvedených tady:

| # | srovnání | skupiny |
|---|---|---|
| 1 | Pořadí obchodu v dni | 1. obchod · 2. · 3. · 4.+ |
| 2 | Po čem obchod přišel | první v dni · po SL · po targetu · po BE |
| 3 | Kolik SL už ten den bylo | 0 · 1 · 2+ |
| 4 | Dny podle počtu obchodů (za den) | ≤ 2 · 3–4 · 5+ |
| 5 | Vrácený zisk (za den) | dny, které byly během dne v plusu: kolik $ vrátily z denního maxima, kolik skončilo v mínusu |
| 6 | Emoce v poznámce | obchod obsahuje slovo ze seznamu · ostatní |
| 7 | Technická chyba v poznámce | obchod obsahuje slovo ze seznamu · ostatní |
| 8 | Setup | podle `setupCode` |
| 9 | Order flow | s ABS · jiné potvrzení bez ABS · `NONE` · nevyplněno |
| 10 | Typ cíle | podle `targetLevel1.type` (popisky z `taxonomy` exportu) |
| 11 | Známka | A · B · C · nevyplněno |
| 12 | Směr | long · short |
| 13 | Seance | podle `derived.session` |
| 14 | Trend 30m vůči směru | po trendu · proti · range · nevyplněno |
| 15 | Absorpce – kde | extrém · uprostřed · žádná · nevyplněno |
| 16 | Psychika před vstupem | 1–3 · 4–5 · 6–8 · nevyplněno |
| 17 | Kontext dne | open vůči value · typ dne skutečný · zprávy |

**Seznamy slov (6, 7)** jsou upravitelné v Labu (Data → Nastavení diagnózy, uloží se do views.json).
Výchozí emoce: `fomo, nasran, vztek, unaven, revenge, netrpěliv, nervy, strach`.
Výchozí technika: `chyba, technical, easytrade, easy trade, špatně naplněn, zmrvená limitka`.
Hledá se bez diakritiky a velikosti písmen v `comment` a v `dailyPlan.setup / psychology / note`.

### 2.4 Karta „Vstup, SL nebo cíl?"

Jedna karta nad seznamem, tři řádky, každý s čísly a odkazem na obchody:

- **Vstup:** „Z N ztrát s naměřeným MFE se X nepohnulo do zisku víc než 2 ticky (Y vůbec). Na 1R došlo Z."
- **SL:** „90 % ziskových obchodů šlo proti nejvýš X t, tvůj medián SL je Y t."
- **Cíl:** „Po targetu cena v mediánu pokračovala X t, u Y z N obchodů ještě o 1R a víc."

Hranice 2 ticky je jediná konstanta (pojmenovaná, v jednom místě). Hodnoty berou z `LabSlTp`, nic se nepočítá dvakrát.

---

## 3. Obrazovka Co kdyby — průvodce

Jedna obrazovka, nahoře **varianta**, dole **výsledek vedle skutečnosti**. Přepočet okamžitě při změně.

### 3.1 Rychlé předvolby (tlačítka)

`1 obchod denně` · `Max 2 obchody` · `Konec po targetu nebo 2 SL` · `Konec po prvním SL nebo targetu` ·
`Denní limit −70 $` · `Cíl 1:1` · `Cíl 2:1` · `SL o 2 ticky širší` · `TG1 1R + runner 2R` · `Vyřadit M2 v trendu` ·
`Jen s ABS` · `Jen známka A`. Předvolba jen vyplní volby níže, kombinovat se dají.

### 3.2 Volby varianty (čtyři sbalitelné bloky)

**A) Pravidla dne** — přes stávající `LabDaySim`, žádná kopie logiky: max obchodů, konec po N SL
za sebou, konec po N SL za den, konec po targetu, denní limit ztráty **v $**, denní cíl v $,
vrácení zisku z maxima v $. (`LabDaySim` počítá v R → převod přes jednotku 1 R, kterou už má.)

**B) Které obchody brát** — jen pole známá **před vstupem**: setup, order flow (s ABS / bez),
známka, typ cíle, směr, seance, psychika před vstupem. Emoce z poznámek sem **nepatří**
(píšou se až po obchodu).

**C) SL** — jak jsem ho měl · o X ticků širší / užší · pevně X ticků.

**D) Cíl** — jak jsem ho měl · jeden cíl `k × R` · plánovaný cíl na hladině · rozdělení:
1. kontrakt `k1 × R`, 2. kontrakt `k2 × R`, po TG1 SL 2. kontraktu na BE.

### 3.3 Výsledek

Tabulka **Skutečnost | Varianta** (+ až 2 uložené varianty vedle sebe):

`Obchodů` · `nerozhodnuto (C, D)` · `Win %` · `Průměrná výhra / ztráta R` · `Expectancy R` ·
**`P/L $`** · `Poplatky $` · `Max drawdown $` · `Nejhorší den $` · `Ziskových dnů` · `Rozdíl proti skutečnosti $`.

Pod tím:
- **equity v $** — skutečnost a varianty jednou křivkou každá,
- **P/L po týdnech** obou vedle sebe,
- **co pravidla odřízla:** kolik ztrát ušetřila a kolik zisků zahodila ($, n),
- **drží to?** — stejný mechanismus jako `variants.js`: bez jednoho dne (leave-one-day-out)
  a první × druhá polovina období. Výsledek jednou větou: „Rozdíl drží i bez kteréhokoli dne
  a v obou polovinách" / „Rozdíl stojí na dnech X, Y". Pod 20 dny jen „Zatím málo dnů (N z 20)".
- **Varování o přeladění**, vždy viditelné, když jsou zapnuté filtry B: „Filtry a pravidla
  nastavené na stejných datech vypadají vždy líp, než budou dál. Ověř na nových obchodech."
- tlačítko **Zkopírovat jako text** (do schránky, pro obchodní plán).

### 3.4 Jak se počítá výsledek obchodu při jiném SL / cíli (C, D) — konzervativně

Nový modul `app/whatif.js`, čisté funkce nad výstupem `normalizeRecord`. Než začneš, ověř
v `repo_clone` význam polí `postExitFavorableTicks`, `postExitAdverseTicks`,
`postExitAdverseFirst` („Protipohyb přišel dřív?"), `touchedEntry` („Zpět na vstup"),
`touchedSl`, `observedMinutes`. Když se liší od tohoto popisu, zastav se a napiš to.

`S` = SL varianty v ticích, `T` = cíl v ticích, `mfe` / `mae` naměřené během obchodu,
`F` = `maxFavorableMeasured`, `A` = `maxAdverseMeasured`.
**Když pořadí neznáme, vždy horší výsledek.**

1. `mae ≥ S` → SL
2. jinak `mfe ≥ T` → target
3. jinak podle pohybu po výstupu: `F ≥ T` a `A < S` → target · `A ≥ S` a `F < T` → SL ·
   obojí → `postExitAdverseFirst === false` ? target : SL · jinak **nerozhodnuto**

Runner (jen po TG1): `F ≥ k2·S` a `touchedEntry === false` → target k2 · `F ≥ k2·S` a
`touchedEntry === true` → BE (ledaže `postExitAdverseFirst === false` → target k2) ·
`F < k2·S` a `touchedEntry === true` → BE · jinak nerozhodnuto.

Varianta s nezměněným SL **i** cílem = přesně skutečnost (pnlRaw), nic se nepřepočítává.
Nerozhodnuté se do P/L nepočítají; vedle P/L ukaž i **nejhorší případ** (nerozhodnuté = −1 R).
Nad 20 % nerozhodnutých je stav varianty nejvýš ~ a věta to řekne.
P/L v $ = `kontrakty × ticky × hodnota ticku − komise` (komise z obchodu, po kontraktech).

---

## 4. Kontrolní čísla (akceptace)

Výběr: deník Phidias 1, MES, období **14. 9. – 21. 10. 2026**, jen naplněné obchody (výchozí stav
přepínačů). Ručně spočítáno z CSV exportu deníku 21. 10. Lab musí vyjít **stejně (± 0,1 $)**;
když ne, zastav se a vysvětli rozdíl, čísla neupravuj:

| co | n | P/L $ |
|---|---|---|
| celkem | 104 | −753,3 (poplatky 393,3) |
| 1. obchod dne | 24 | −68,7 |
| po 2+ SL v dni | 40 | −300,1 |
| dny s 5+ obchody | 11 dnů | −480,2 |
| vrácený zisk z denního maxima | 14 dnů | 393,3 |
| setup M2 v trendu | 17 | −282,1 |
| typ cíle Fix RRR | 13 | −251,9 |
| Co kdyby: max 2 obchody | 48 | −309,9 |
| Co kdyby: konec po targetu nebo 2 SL | 40 | −224,5 |
| Co kdyby: konec po prvním SL nebo targetu | 26 | −43,8 |

---

## 5. Testy (`node --test`, napsané předem, bez implementace musí selhat)

1. kontrolní čísla z §4 na fixtuře z reálného exportu (fixtura v `Claude files/`, ne v repu)
2. dopad = P/L skupiny − n × průměr zbytku; řazení podle dopadu; skupina < 10 není v top
3. nevyplněno je vlastní skupina, nikdy „žádná"
4. hledání slov bez diakritiky a velikosti písmen; úprava seznamu se projeví
5. whatif: pravidla 1–3 a runner na fixturách; nezměněný SL + cíl = skutečnost
6. pravidla dne jdou přes `LabDaySim` (stejný výsledek jako dnešní simulátor)
7. filtry B nenabízí pole zapsaná až po obchodu
8. Pokročilé obrazovky dávají stejná čísla jako v 0.4
9. žádný text neobsahuje „doporuč", „nastav si", „optimální", „vyhýbej se"
10. read-only pojistka drží

---

## 6. Po dokončení

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt`. Uživateli napiš **česky a krátce**: co je v Diagnóze,
jak v Co kdyby porovnat např. „1:1" proti skutečnosti, a jestli kontrolní čísla sedí.
