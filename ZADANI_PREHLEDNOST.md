# Backtest Lab — přehlednost

> Zadání pro Claude Code · 5. 10. 2026
> **Má přednost před krokem 4 fáze 3** (dva deníky vedle sebe). Ten se odkládá.
>
> Důvod: Lab umí počítat víc, než kolik dnes data unesou. Každá obrazovka je proto
> převážně výhrada a uživatel se v tom neorientuje. Nepřidávej analýzy. Přidej
> jedno místo, kde se dozví, co se dnes ví.

---

## 1. Nová úvodní obrazovka „Co teď vím"

První položka v navigaci, otevírá se po spuštění. Celá obrazovka je
**6 až 10 řádků v běžné češtině**, žádné tabulky.

Každý řádek má:

```
[ikona stavu]  jedna věta, co se ví  ·  (n = X)  ·  → odkaz na obrazovku, odkud to je
```

Stavy jsou tři, nic mezi tím:

| | kdy |
|---|---|
| **✓ ví se** | vzorek projde prahem dané analýzy |
| **~ zatím slabé** | spočítatelné, ale pod prahem — věta musí začít „předběžně" |
| **– nejde** | chybí vstup; věta říká **co** chybí a **kolik** |

Věty generuj z výpočtů, které už existují — nic nového nepočítej. Například:

```
✓  Série ve tvých datech jsou v mezích náhody (z = +0,47). Denní stop zisk nezvýší,
   jen zmenší rozptyl.                                        n = 129  → Denní risk
~  Předběžně: MAE vítězů končí na 15 t, tvůj nejčastější SL je 12 t.
                                                               n = 14   → SL a TP
~  Předběžně: „konec po 2 SL za sebou" ušetří 15,9 R a zahodí 17,9 R → čistě −1,9 R.
                                                               n = 35 dnů → Denní risk
–  Síla hladin zatím nejde: u 11 z 21 řádků proti TP chybí cena nebo vzdálenost.
                                                               → Síla hladin
```

**Zákaz:** na téhle obrazovce žádné doporučení, co má uživatel obchodovat.
Jen co se ví a jak moc.

### 1.1 Blok „Co vyplnit při nejbližším replayi"

Pod řádky, oddělený. Vypisuje **jen pole, která dnes blokují nějakou analýzu**,
od nejsilnějšího hrdla, s číslem:

```
1. Plánovaný cíl s cenou — má 4 obchody. Bez něj nejde dosažitelnost cílů.
   (Vystoupil jsi ručně bez plánované hladiny? Nech prázdné, ne MANUAL_EXIT.)
2. Vzdálenost SR hladiny od vstupu — 10 z 21 proti TP, 13 z 30 proti SL.
3. …
```

Seznam se **odvozuje z dat**, není napsaný v kódu natvrdo. Co je vyplněné,
z něj zmizí samo.

### 1.2 Odhad, kdy to bude

Pod tím jeden řádek za každou nespuštěnou analýzu: kolik obchodů nebo dnů ještě
chybí a kolik to je replay dnů při dosavadním tempu. Použij prognózu z hrdla,
která už ve zdraví dat je — nepočítej to znovu.

---

## 2. Obrazovky se zabalí

Na všech čtyřech obrazovkách (Zdraví dat, SL a TP, Síla hladin, Denní risk):

- Každá sekce je **sbalená** a v hlavičce nese **své hlavní číslo nebo verdikt**,
  aby se sbalením nic neztratilo. Stejný vzor jako „Hladiny (N)" v deníku.
- Rozbalený stav se **pamatuje** (views.json), per obrazovka.
- **Analýza, která nemůže běžet, se nekreslí.** Místo prázdné tabulky s deseti
  řádky „n = 1, bez procent" jen jeden řádek: *„Zatím nejde — chybí …"*
  a odkaz na blok §1.1. Tohle je dnes největší zdroj zmatku.
- Pořadí sekcí: nejdřív to, co má vzorek, pak slabé, pak nespuštěné.

---

## 3. Co nedělat

- **Nepřidávej žádnou novou analýzu.** Ani krok 4, ani nic z §5 specu.
- **Neměň výpočty.** Tohle je zadání na zobrazení, ne na čísla. Když ti při tom
  vyjde, že je některé číslo špatně, nahlas to a nech rozhodnout — neopravuj to
  v téhle dávce.
- **Nesnižuj prahy**, aby se obrazovky naplnily. Prázdno je správná odpověď.
- Nedávej na úvodní obrazovku graf. Věty stačí.

---

## 4. Testy

1. řádek dostane stav `–`, když chybí vstup, a text obsahuje počet, co chybí
2. řádek dostane `~`, když je pod prahem, a věta začíná „předběžně"
3. seznam §1.1 se vyplněním pole zkrátí (fixtura před/po)
4. sbalený stav se pamatuje a přežije změnu deníku
5. nespuštěná analýza nevykreslí tabulku
6. žádná věta na úvodní obrazovce neobsahuje doporučení k obchodování
   (kontrola na slovník „doporuč", „nastav si", „optimální")

---

## 5. Až to bude

Aktualizuj `CLAUDE.md` a `CHANGELOG.txt`. Krok 4 fáze 3 zůstává jako další v řadě,
ale **nezačínej ho** — čeká na rozhodnutí uživatele, až bude víc dnů.
