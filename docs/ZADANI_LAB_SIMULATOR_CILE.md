> ⚠️ **21. 10. 2026: nahrazeno `ZADANI_LAB_PRESTAVBA.md`.** Neimplementovat.

# Backtest Lab — simulátor cíle a SL (RRR)

> Zadání pro Claude Code · 19. 10. 2026 · repozitář `F:\Trading\Denik\BackTestLab DEV`, branch `test`.
> Navazuje na Lab 0.4.0. Merge do `main` až po ověření uživatelem.
>
> Platí beze změny: Lab jen čte, nic nedopočítává odhadem, do výpočtů jen NAMĚŘENÉ MFE/MAE
> (`*Measured`), žádné číslo bez `N`, Lab **nevybírá vítěze** (stejně jako mřížka variant),
> prahy vzorku se nesnižují (10 / 30 / 50, mřížky 20 dnů).

## 0. Proč

Uživatel píše obchodní plán (`Trading coach/Obchodní plán.md`) a potřebuje z dat rozhodnout:

- jestli mu víc vynese cíl **1:1, 2:1 nebo 3:1** se **SL, který skutečně dává** (ne pevný SL v ticích jako dnešní mřížka SL × TP),
- jestli se vyplatí jeho výstup z plánu: **1. kontrakt na TG1, 2. kontrakt jako runner se SL na BE**,
- kolik by to bylo **v USD včetně komise** a s jakým **drawdownem**,
- a jak to dopadne **pod jeho denními pravidly** (plán: −70 USD/den, prakticky 2 SL = konec dne).

Chce to ve stejné podobě jako simulátor na obrazovce Denní risk: zadá variantu, vidí výsledek
vedle skutečnosti, pak mřížku s kontrolou stability.

---

## 1. Navigace

Nová skupina mezi Souhrnem a Podrobnostmi:

```
Souhrn
Pro obchodní plán ▸
   Cíl a SL           ← nové (tohle zadání)
   Denní limity       ← dnešní simulátor + mřížka variant z „Denní risk", jen přesunuté
Podrobnosti ▸
   SL a TP · Hladiny · Kontext · Denní risk (zůstane jen sekvenční analýza)
Data
```

Přesun simulátoru dne nemění žádný výpočet ani uložené volby (views.json zůstanou platné).

---

## 2. Obrazovka „Cíl a SL" — průvodce ve 4 krocích

Kroky pod sebou jako sbalitelné sekce (stejný vzor jako jinde), stav ✓ / ~ / – v hlavičce.

### Krok 1 — Vzorek

- Filtry: deník (jako všude), období, **setup** (vše / každý setup zvlášť, výchozí: všechny),
  stávající přepínače hypotetických obchodů a „naživo bych nevzal".
- Vypiš, kolik obchodů jde simulovat a **proč ostatní vypadly**, po důvodech
  (chybí cena SL · MFE / MAE nejsou naměřené · neznámý tick instrumentu). Odkaz na Data.
- Přepínač **„porovnat podle setupu"**: všechny další kroky se pak ukážou zvlášť pro každý setup
  s vlastním `N` (plán obchoduje naostro jen M2 + OF a M2 v trendu).

### Krok 2 — Varianty vedle sebe

Sloupec **Skutečnost** (obchody, jak proběhly) a až **4 varianty**, které si uživatel nadefinuje.
Každá varianta:

| volba | možnosti | výchozí |
|---|---|---|
| **SL** | jak jsem ho skutečně měl (`slTicks` obchodu) · pevně X ticků | skutečný |
| **Výstup** | jeden cíl `k × R` (oba kontrakty) · plánovaný cíl na hladině (`plannedTarget`) · **rozdělení**: 1. kontrakt `k1 × R`, 2. kontrakt `k2 × R`, po TG1 SL 2. kontraktu na BE | 1 cíl, k = 1 |
| `k`, `k1`, `k2` | číslo, krok 0,25 | 1 / 1 / 2 |
| **Kontrakty** | z obchodu · přepsat (výchozí 2) | z obchodu |
| **Komise** | z obchodu (`commission ÷ contracts` na kontrakt) · přepsat USD / kontrakt | z obchodu |
| **Denní pravidla** | žádná · převzít z „Denní limity" (stejná pravidla, stejný `LabDaySim`) | žádná |

Rychlé předvolby nad tabulkou: **1:1 · 1,5:1 · 2:1 · 3:1 · TG1 1R + runner 2R** (vyplní variantu, nic víc).

**Výstup tabulky** (řádky = metriky, sloupce = Skutečnost + varianty):

`Obchodů simulováno` · `z toho nerozhodnuto` · `Win %` · `Break-even win % pro tento poměr` ·
`Průměrná výhra / ztráta (R)` · `Expectancy R` · `Suma R` · **`P/L USD (vč. komise)`** ·
`Profit factor` · `Max drawdown (USD a R)` · `Nejhorší den (USD)` · `Ziskových dnů` ·
`Nejdelší série ztrát` · `Rozdíl proti Skutečnosti (R a USD)`.

Pod tabulkou **jedna equity křivka v USD** se všemi variantami (legenda = názvy variant).
Sbalené: **po obchodech** (výsledek každé varianty a proč: target / SL / BE / nerozhodnuto)
a **po dnech**.

### Krok 3 — Mřížka poměrů

Zvlášť pro „jeden cíl" a pro „rozdělení":

- **Jeden cíl:** `k` = 0,5 · 0,75 · 1 · 1,25 · 1,5 · 2 · 2,5 · 3 · 4 · 5 → řádek na `k`
  (N, nerozhodnuto, win %, expectancy R, P/L USD, max DD).
- **Rozdělení:** mřížka `k1` (0,5–2) × `k2` (1–5), buňka = expectancy R; najetí myší = P/L USD a N.
- Stabilita **stejným mechanismem jako `variants.js`**: vynechání jednoho dne (leave-one-day-out),
  první × druhá polovina období, stabilní oblast (≥ 3 sousední hodnoty se stejným znaménkem,
  projdou LOO), osamělý vrchol = šum. **Žádné zvýraznění maxima, žádné řazení podle výsledku.**
- Pod 20 dny / pod 50 obchody jen popis, bez stabilní oblasti (stejně jako dnes).

### Krok 4 — Do plánu

Pár vět v běžné češtině, stav ✓ / ~ / – podle prahů, například:

> ~ Předběžně: se skutečným SL vychází 2:1 na +0,21 R / obchod (P/L +312 USD), 1:1 na +0,04 R
>   (+58 USD). n = 41, nerozhodnuto u 2:1: 6. Stabilní oblast mřížka zatím neukazuje (14 dnů z 20).

Tlačítko **„Zkopírovat"** (text do schránky — uživatel ho vloží do plánu). Žádná slova
„doporučuji", „optimální", „nastav si" (stejný test jako u Souhrnu).

Jedna věta navíc, protože ji plán chce (§12 „časový stop"): *„Časový stop zatím nejde — chybí
průběh ceny po svíčkách (barová data)."* Nic dalšího k časovému stopu nedělej.

---

## 3. Jak se počítá výsledek obchodu ve variantě — konzervativně

Nový modul `app/targetsim.js`, čisté funkce, čte jen výstup `normalizeRecord`.
**Před psaním ověř význam polí v deníku** (`repo_clone`): `postExitFavorableTicks`,
`postExitAdverseTicks`, `postExitAdverseFirst` („Protipohyb přišel dřív?"), `touchedEntry`
(„Zpět na vstup"), `touchedSl` („Až na SL"), `observedMinutes`, `legs`. Když se význam liší
od níže uvedeného, zastav se a napiš to uživateli.

Značení: `S` = SL varianty v ticích, `T` = cíl v ticích (`k × S`, u plánovaného cíle jeho
vzdálenost), během obchodu `mfe` / `mae` (naměřené), celkově `F = maxFavorableMeasured`,
`A = maxAdverseMeasured`.

**Pravidlo: když pořadí událostí neznáme, vždy horší výsledek pro obchodníka.**

1. `mae ≥ S` → **SL** (i když `mfe ≥ T` — pořadí uvnitř obchodu neznáme).
2. jinak `mfe ≥ T` → **target**.
3. jinak (cíl leží za tím, kam obchod během držení došel) rozhoduje pohyb po výstupu:
   - `F ≥ T` a `A < S` → **target**
   - `A ≥ S` a `F < T` → **SL**
   - obojí: `postExitAdverseFirst === false` → **target**, jinak **SL**
   - nic z toho a pohyb po výstupu je zapsaný → **nerozhodnuto** (do konce pozorování nedošlo ani na cíl, ani na SL)
   - pohyb po výstupu není zapsaný → **nerozhodnuto**

**Runner (2. kontrakt v rozdělení)** — jen když 1. kontrakt došel na TG1, jinak má stejný výsledek jako 1. kontrakt:

- `F ≥ k2 × S` a cena se po TG1 nevrátila na vstup (`touchedEntry === false`) → **target k2**
- `F ≥ k2 × S` a `touchedEntry === true` → **BE**, ledaže `postExitAdverseFirst === false` → target k2
- `F < k2 × S` a `touchedEntry === true` → **BE**
- jinak → **nerozhodnuto**

**Nerozhodnuté obchody**: do Expectancy a P/L se počítají **jen rozhodnuté**. Vedle každé varianty
ukaž i **nejhorší případ** (nerozhodnuté = −1 R) a počet nerozhodnutých. Když je nerozhodnutých
víc než 20 % vzorku, stav varianty je nejvýš ~ a věta to řekne.

**P/L v USD** = `kontrakty × ticky × hodnota ticku − komise` (hodnota ticku z vestavěné tabulky
instrumentů jako dnes; bez ní USD „nejde", R ano). Rozdělení: každý kontrakt zvlášť, komise po kontraktech.

**Skutečnost** = skutečný výsledek obchodu (pnlRaw, exitTicks) — žádné přepočítávání.

**Denní pravidla**: výsledné R obchodů varianty se pošlou do `LabDaySim` ve skutečném pořadí
dne. Žádná vlastní kopie logiky pravidel.

Dnešní mřížka SL × TP na obrazovce SL a TP **zůstává beze změny**. Pokud se její čísla
od nového simulátoru liší (má jiné pravidlo pro „nedošlo nikam" — bere skutečný výsledek), napiš
v ní pod tabulku jednu větu, v čem je rozdíl. Výpočet mřížky neměň.

---

## 4. Co vyplňovat, aby to šlo

Do bloku „Co vyplnit" (Data) přidej pole, která tenhle simulátor blokují, se stejnou mechanikou
jako dnes (odvozuje se z dat, vyplněné samo zmizí): cena SL · naměřené MFE / MAE · pohyb po
výstupu (oba směry) · „Protipohyb přišel dřív?" · „Zpět na vstup". U každého řádku napiš, kolik
nerozhodnutých obchodů by vyplnění vyřešilo.

---

## 5. Testy (`node --test`, napsané předem, bez implementace musí selhat)

1. pravidla 1–3 na fixturách: SL i cíl během obchodu → SL; cíl za MFE, dosažen po výstupu bez SL → target; obojí po výstupu, `postExitAdverseFirst` true / false / null
2. runner: všechny čtyři větve, včetně `touchedEntry` true × `postExitAdverseFirst` false
3. nerozhodnuté nevstupují do expectancy ani P/L; nejhorší případ je počítá jako −1 R
4. varianta „SL skutečný, výstup = plánovaný cíl" u obchodu, který na plánovaný cíl skutečně došel, dá **stejné ticky** jako skutečnost
5. P/L v USD: 2 MES, 12 t, komise 1,90 / kontrakt → 2 × 12 × 1,25 − 3,80 = 26,20
6. denní pravidla jdou přes `LabDaySim` (stejný výsledek jako simulátor dne nad stejnými R)
7. mřížka: žádné zvýraznění maxima; pod 20 dny bez stabilní oblasti
8. věty v kroku 4 neobsahují „doporuč", „optimální", „nastav si", „vyhýbej"
9. přesun „Denní limity" nezmění žádné číslo ani uloženou volbu
10. read-only pojistka drží

---

## 6. Po dokončení

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt`. Uživateli napiš **česky a krátce**: kde simulátor najde,
jak zadat variantu 1:1 vs. 2:1 a TG1 + runner, a kolik obchodů z jeho dat jde dnes simulovat
a co by jich odemklo nejvíc.
