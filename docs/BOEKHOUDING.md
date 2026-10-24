# Boekhouding — Studio Levant backoffice

Uitleg voor de eigenaar (hoe werkt het, wat moet ik doen) en voor de boekhouder (hoe is het
opgezet, waar komen de cijfers vandaan). Technische details staan in de code
(`lib/boekhouding/**`) en in de README onder "Boekhouding".

---

## Deel 1 — Voor de eigenaar

### Wat het is

Eén plek onder **Boekhouding** voor alles wat er op de rekening gebeurt, de btw-aangifte, de
afschrijvingen en de jaarrekening. Het maken van facturen is **niet** veranderd: de
facturentool, de PDF, de nummering en de berekeningen zijn precies zoals ze waren. De
boekhouding *leest* de facturen en bonnetjes alleen.

Tabs: **Overzicht · Facturen · Bonnetjes · Bank & boekingen · Btw-aangifte · Activa ·
Rapporten & jaarrekening · Instellingen**.

### Het jaar rond

| Wanneer | Wat | Waar |
|---|---|---|
| Doorlopend | Facturen maken (zoals altijd) en bonnetjes uploaden | Facturen, Bonnetjes |
| Wekelijks/maandelijks | Bankafschrift importeren (CSV van RegioBank of Revolut) of regels zelf invoeren; "te verwerken" regels nalopen en betalingen aan facturen/bonnetjes koppelen | Bank & boekingen, Openstaand & afletteren |
| Bij een aankoop vanaf € 450 | Activeren: kies de termijn (bv. 3 of 5 jaar), afschrijven gaat vanzelf | Activa |
| Na elk kwartaal (uiterlijk de laatste dag van de maand erna) | Aangifte bekijken, overnemen in Mijn Belastingdienst Zakelijk, **Markeer als ingediend** (dit vergrendelt het kwartaal), btw-betaling op de bank koppelen | Btw-aangifte |
| Na 31 december | **Jaarafsluiting**: checklist, banksaldi per 31-12 invullen, afsluiten. Daarna de exports naar de boekhouder | Rapporten & jaarrekening |

### Een regel boeken

Bank (standaard RegioBank, om te zetten naar Revolut), datum, omschrijving, uitgave of
inkomst, bedrag (zoals op de bank, dus inclusief btw) en het btw-tarief. Het systeem rekent
direct uit: de **voorbelasting** (bij een uitgave) of de **af te dragen btw** (bij een
inkomst), het bedrag exclusief btw en het **kwartaal**. Andere soorten: privé (opname of
storting van Daniel of Bram), overboeking tussen eigen rekeningen en btw-betaling/-teruggaaf.

Software uit de EU (Adobe, Google: Ierland) en van buiten de EU (bv. Figma, VS): kies "Dienst
uit EU" of "Dienst van buiten de EU". Er is geen btw betaald; de 21% komt zowel als
verschuldigd als aftrekbaar in de aangifte (rubriek 4b of 4a en 5b), per saldo € 0.

### Afschrijvingen

Een laptop van € 2.499 (excl. btw) in 5 jaar: € 41,65 per maand vanaf de maand van
ingebruikname. Elke termijn van 1 tot 20 jaar kan (snelkeuze 3 of 5 jaar); de laatste maand
neemt het afrondingsverschil, zodat de boekwaarde precies op de restwaarde uitkomt. Let op:
fiscaal mag je per jaar meestal niet meer dan 20% afschrijven (dus minimaal 5 jaar); bij een
kortere termijn toont de app een waarschuwing. **Laat de boekhouder dat bevestigen.**

### Jaarafsluiting

**Rapporten & jaarrekening → Naar de jaarafsluiting.** De checklist controleert:

- het jaar is voorbij en eerdere jaren zijn afgesloten;
- alle btw-kwartalen zijn ingediend;
- er staan geen bankregels meer op "te verwerken";
- de winstverdeling telt op tot 100%;
- het **saldo volgens het bankafschrift per 31 december** (zelf invullen) is gelijk aan het
  berekende saldo per rekening — de belangrijkste controle;
- (waarschuwingen) kruisposten en vraagposten op nul, beginvermogen verdeeld, niets gewijzigd
  na het indienen van een aangifte.

Bij **Boekjaar afsluiten** (alleen de eigenaar, ingelogd met 2FA) gaat het resultaat naar de
kapitaalrekeningen van de vennoten volgens de winstverdeling (standaard 50/50, aan te passen
bij Instellingen), de privé-opnamen gaan van het kapitaal af, en het hele jaar wordt
vergrendeld. Heropenen kan (alleen de eigenaar, en alleen het laatst afgesloten jaar).

### Wat je naar de boekhouder stuurt

Bij **Rapporten & jaarrekening → Voor de boekhouder**: het **jaarrapport (PDF)**, de
**auditfile (XAF 3.2)** en CSV's (bankregels, journaal, winst & verlies, balans, proefbalans,
kapitaal per vennoot). Per kwartaal staat de **btw-aangifte als PDF** bij Btw-aangifte. De
bonnetjes staan als kopie in Google Drive.

### Demo-modus

Zolang `supabase/UITVOEREN_0027.sql` niet is uitgevoerd (of als `BOEKHOUDING_DEMO=1` staat),
toont de boekhouding voorbeeldgegevens met de banner **"Demo — voorbeeldgegevens, er wordt
niets opgeslagen"**. Alles is te proberen (ook afsluiten), maar niets komt in de database.
Wijzigingen blijven maximaal 4 uur in het geheugen van de server en kunnen op Vercel tussendoor
verdwijnen. **Demo herstellen** zet de voorbeeldgegevens terug. De rest van de app (facturen,
bonnetjes, mail, agenda) werkt gewoon met de echte gegevens.

### Bewust niet ingebouwd

Rechtstreeks indienen bij de Belastingdienst (SBR), bankkoppeling via PSD2, kasstelsel,
degressieve afschrijving, voorraad, loon, uren/kilometers, budgetten, meerdere administraties,
herinneringen/aanmaningen (die horen bij de facturen, en daar blijven we vanaf), automatische
KIA-berekening (hoort bij de IB-aangifte per vennoot; de activastaat toont de investeringen).

### Open punten voor de eigenaar of de boekhouder

1. **3 jaar afschrijven** tegenover de fiscale grens van 20% per jaar: akkoord?
2. **Winstverdeling** van de VOF (nu 50/50) en een eventuele arbeidsvergoeding vooraf (niet
   ingebouwd; kan als memoriaalpost of door de boekhouder in de IB-aangifte).
3. **CSV-formaat RegioBank**: de kolommen zijn niet met een echte export geverifieerd; een
   onbekend formaat gaat via de kolomkeuze (die per rekening wordt onthouden).
4. **EU-klanten** (btw verlegd, rubriek 3b): de ICP-opgaaf doe je apart; de aangifte-controle
   noemt de EU-klanten van het kwartaal.
5. **Beginbalans**: bij de echte start de banksaldi per startdatum invullen (Instellingen →
   Bankrekeningen) en het beginvermogen verdelen (Instellingen → Memoriaal → Beginvermogen
   verdelen).

---

## Deel 2 — Voor de boekhouder

### Opzet

- **Dubbel boekhouden onder de motorkap.** Elke bron wordt een journaalpost met debet- en
  creditregels die altijd sluit (`lib/boekhouding/kern/journaal.ts`, `assertSluit`). Bronnen:
  bankregels (`bk_boekingen`), beginsaldi, memoriaal (`bk_memoriaal`), verkoopfacturen
  (`invoices`, alleen gelezen), bonnetjes/inkoopfacturen (`expenses`, alleen gelezen, status
  "verwerkt" en EUR), activa (inbreng, afschrijving per maand, desinvestering) en per
  ingediende aangifte de btw-afsluitpost.
- **Afgeleid, niet gekopieerd**: facturen en bonnetjes worden bij het lezen omgezet, zodat
  wijzigen of verwijderen in de facturentool vanzelf klopt.
- **Factuurstelsel**: omzet en btw in de periode van de factuurdatum (Nederlandse tijd), kosten
  op de bondatum; een losse bankregel zonder document op de transactiedatum.
- **Geen dubbeltelling**: een bankregel die aan een factuur of bonnetje is gekoppeld is alleen
  een betaling (bank tegen 1300 Debiteuren of 1600 Crediteuren, zonder btw). Omzet, kosten en
  btw komen uit het document.
- **Bedragen** in hele centen (integers); btw per regel afgerond, half weg van nul.

### Grootboek (RGS indicatief, niveau 2)

| Groep | Rekeningen |
|---|---|
| Vaste activa | 0200 Inventaris · 0209 Cum. afschr. · 0210 Computers & apparatuur · 0219 Cum. afschr. |
| Eigen vermogen | 0500/0510 Kapitaal Daniel/Bram · 0600/0610 Privé Daniel/Bram · 0900 Beginbalans / onverdeeld |
| Liquide middelen | 1000 Kas · 1100 RegioBank · 1110 Revolut (elke nieuwe rekening een eigen 11x0) · 2000 Kruisposten |
| Vorderingen/schulden | 1300 Debiteuren · 1600 Crediteuren · 1900 Vraagposten |
| Btw | 1500 Te betalen hoog · 1505 Laag · 1510 Verlegd/import · 1520 Voorbelasting · 1530 Af te dragen (aangifte) |
| Kosten | 4000 Software · 4010 Kleine hardware · 4100 Kantoor · 4200 Reis · 4300 Marketing · 4400 Representatie · 4500 Opleiding · 4600 Uitbesteed werk · 4700 Telefoon/internet · 4750 Verzekeringen · 4800 Afschrijvingen · 4900 Bankkosten · 4990 Overig |
| Opbrengsten | 8000 Omzet · 8010 Omzet verlegd/buitenland · 8090 Doorberekende kosten · 8900 Overige opbrengsten |

Eigen categorieën (4xxx/8xxx) kunnen worden toegevoegd en uitgezet; systeemrekeningen niet.

### Btw-aangifte

Rubrieken 1a–1e, 2a, 3a–3c, 4a, 4b, 5a–5c uit het journaal. Op het formulier hele euro's in
het voordeel van de ondernemer (omzet en verschuldigde btw omlaag, voorbelasting omhoog). Bij
"Markeer als ingediend" wordt de berekening als snapshot bewaard en het kwartaal vergrendeld;
de afsluitpost boekt 1500/1505/1510/1520 naar 1530 en het afrondingsverschil naar 8900; de
btw-betaling (bankregel, soort btw) wordt aan de aangifte gekoppeld en maakt 1530 nul.
Wijzigt er later iets (bv. een factuur), dan toont de app het verschil met het advies
"volgende aangifte" of (boven € 1.000) "suppletie".

### Activa

Lineair per maand vanaf ingebruikname, vrije termijn (12–240 maanden), restwaarde,
afrondingsverschil in de laatste maand. Afschrijving D 4800 / C 0209 of 0219 op de laatste
dag van elke maand. Een geactiveerde aankoop (bonnetje of bankregel) gaat naar 0200/0210 en
niet naar de kosten. Desinvestering: aanschaf en cumulatieve afschrijving eraf, de resterende
boekwaarde ten laste van 8900; de verkoopopbrengst wordt als inkomst op 8900 (21%) geboekt.

### Rapporten

- **Winst & verlies** per kwartaal en t.o.v. vorig jaar (lopend jaar t/m vandaag).
- **Balans** begin (31-12 vorig jaar) en eind; btw per saldo; het nog niet verdeelde resultaat
  in het eigen vermogen. Sluit altijd (getest op elk maandeinde).
- **Kapitaal per vennoot**: begin + inbreng/correcties + winstaandeel + stortingen
  (incl. privé voorgeschoten kosten) − opnamen = eind.
- **Proefbalans** (begin, debet, credit, eind) en **grootboekkaart** met doorklik naar de bron.

### Jaarafsluiting (technisch)

Memoriaalpost (soort `jaarafsluiting`) op 31-12: elke resultaatrekening naar nul, het resultaat
naar 0500/0510 volgens de winstaandelen (exact verdeeld op de cent), een resultaat van vóór
het startjaar naar 0900, privé naar kapitaal. Daarna een rij in `bk_boekjaren` (= vergrendeld)
met een samenvatting (resultaat, verdeling, banksaldi). De afsluitpost telt niet mee in de
winst-en-verliesrekening van dat jaar, wel in de balans. Database: RPC `bk_jaar_afsluiten`
(één transactie, alleen de eigenaar), heropenen via `bk_jaar_heropenen`.

### Memoriaal

Voor beginbalans en correcties: sluitend, in een open periode, niet op bank (volgt het
afschrift), debiteuren/crediteuren (volgen facturen en bonnetjes) of btw-rekeningen (volgen de
aangifte). Kapitaal- en privéregels krijgen automatisch de vennoot.

### Exports

| Export | Inhoud |
|---|---|
| Jaarrapport (PDF) | W&V, balans, kapitaal per vennoot, activastaat |
| Auditfile (XAF 3.2) | grootboek, btw-codes, 12 perioden, openingsbalans, dagboeken BNK/VRK/INK/MEM; totalen = proefbalans. Niet tegen de officiële XSD gevalideerd |
| Bankregels (CSV) | datum, kwartaal, bank, soort, bedrag, excl., voorbelasting, af te dragen, btw-soort, rubriek, grootboek + RGS, vennoot, status, koppeling |
| Journaal (CSV) | alle mutaties debet/credit per rekening |
| W&V, balans, proefbalans, kapitaal (CSV) | zoals op het scherm |
| Btw-aangifte (PDF) | per kwartaal, zoals ingediend (snapshot) |

CSV: UTF-8 met BOM, puntkomma, decimale komma (Excel NL); tekst die met = + - @ begint krijgt
een apostrof (geen formules).

### Bewaarplicht en audit

Bankregels worden nooit echt verwijderd (markeren met reden; art. 52 AWR, 7 jaar). Vergrendelde
periodes (ingediende aangifte, afgesloten jaar) zijn in de database afgedwongen met triggers.
Elke rij heeft `created_by/created_at` en `updated_by/updated_at`. Alle `bk_*`-tabellen zitten
in de versleutelde back-up (`backup_tabellen()`).
