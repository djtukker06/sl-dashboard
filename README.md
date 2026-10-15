# Studio Levant — Facturen

Interne facturatietool voor Studio Levant. Genereert altijd dezelfde, professionele factuur-PDF, houdt een archief bij per klant, en heeft klant-autocomplete zodat je bij een bekende klant niet steeds opnieuw de gegevens hoeft in te typen.

**Stack**: Next.js (App Router) · Supabase (Postgres, Storage, Auth) · Vercel.

## Lokaal draaien

1. Zorg dat Node.js beschikbaar is (`export PATH="$HOME/.local/node/bin:$PATH"` als het niet gevonden wordt).
2. `npm install`
3. Kopieer `.env.local.example` naar `.env.local` en vul de Supabase-projectgegevens in (Project Settings → API in het Supabase-dashboard): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Draai de migraties in `supabase/migrations/` tegen je Supabase-project (via de Supabase CLI: `supabase link` + `supabase db push`, of plak de SQL-bestanden op volgorde in de SQL Editor van het dashboard).
5. Maak in het Supabase-dashboard (Authentication → Users → Add user) een inlogaccount aan voor jezelf — er is geen publieke registratie.
6. `npm run dev` en ga naar `http://localhost:3000`.

## Hoe het werkt

- **Nieuwe factuur** (`/nieuwe-factuur`): vul klantgegevens en factuurregels in. Typ je een klantnaam die al eerder is gebruikt, dan verschijnt een suggestie — kies die en de overige klantgegevens worden automatisch ingevuld. De middelste kolom (bv. "Periode" of "Aantal") is optioneel.
- **Factuurnummer**: `JJ-NNN`. Het formulier stelt automatisch "hoogste bestaande nummer van dit jaar + 1" voor (verwijder je de laatste factuur, dan komt dat nummer weer vrij), maar je kunt het voor het genereren handmatig aanpassen. Omdat het jaartal in het nummer zit, begint de nummering elk kalenderjaar vanzelf weer bij `001`. De Postgres-functie `create_invoice` bewaakt dat een nummer nooit dubbel wordt gebruikt.
- **Naam factuur** (`invoices.name`): standaard `Factuur JJ-NNN` — verander je het factuurnummer, dan loopt de naam mee tot je hem zelf aanpast. Je kunt er een eigen omschrijving achter typen. De naam wordt **alleen** gebruikt als bestandsnaam van de PDF-download (`Content-Disposition`); op de factuur zelf staat hij niet.
- **Factuurdatum**: standaard vandaag (Nederlandse tijd), maar aanpasbaar — zo kun je ook een oudere factuur met de juiste datum invoeren. Het jaartal in het factuurnummer moet gelijk zijn aan het jaar van de datum; anders zouden het jaaroverzicht en de datum op de PDF elkaar tegenspreken.
- **Btw verlegd** (`invoices.vat_reverse_charged`): bij het aanmaken (en bewerken) van een factuur staat een vinkje "Btw verlegd". Aangevinkt betekent: geen btw op deze factuur. Daaronder kies je wat er in het btw-vakje op de PDF komt (tussen subtotaal en totaal): **Verlegd** of **N.v.t.** (`invoices.vat_reverse_charge_display`, standaard Verlegd). Dat staat er dan in plaats van een bedrag, het totaal is gelijk aan het subtotaal, en `vat_percentage`/`vat_amount` worden 0 opgeslagen. Het losse veld **Reden btw verlegd** (`invoices.vat_reverse_charge_reason`) verschijnt zodra je het vinkje aanzet; die tekst komt als extra regel onderaan de PDF, boven "Betaling van deze factuur…". Laat je hem leeg, dan komt er geen extra regel bij.
- **Aanbetaling** (`invoices.deposit_percentage`): bovenaan het factuurformulier kies je *Reguliere factuur* of *Aanbetaling*. Bij een aanbetaling vul je de **volledige prijzen** van de opdracht in en kies je met een slider het percentage (5% t/m 95%, per 5%). Op de PDF staat elke regel op dat percentage (per regel op centen afgerond, zodat alles precies optelt), met onder de titel "Aanbetaling 30%" en onderaan een regel met het percentage, het totale opdrachtbedrag en het restant dat later voldaan moet worden. `line_items` bewaart de volledige prijzen (zodat bewerken gewoon werkt); `subtotal`, `vat_amount`, `total` en `revenue_subtotal` zijn de bedragen van de aanbetaling — dat is wat er gefactureerd wordt en dus wat meetelt in de omzet. Bij een reguliere factuur is `deposit_percentage` leeg.
- **Factuur aanpassen**: klik in het overzicht op *Aanpassen* naast een factuur. Je krijgt hetzelfde scherm als bij een nieuwe factuur, maar dan ingevuld met de opgeslagen gegevens; met *Wijzigingen opslaan* worden de factuurgegevens bijgewerkt en wordt de PDF opnieuw gegenereerd. Het blijft dezelfde factuur (zelfde `id`, zelfde plek in het archief) — er komt dus geen tweede regel bij. Verandert het bedrag, dan loopt het jaaroverzicht (aantal en omzet) meteen mee. De nieuwe PDF krijgt een eigen pad in de opslag en de oude wordt daarna verwijderd; downloaden geeft dus altijd de laatste versie, nooit een gecachte oude. De database bewaakt bij het bewerken dezelfde regels als bij het aanmaken: geldig volgnummer, geen dubbel factuurnummer, en het jaartal in het nummer gelijk aan het jaar van de datum.
- **Jaaroverzicht**: het dashboard toont het aantal facturen en de omzet (excl. btw) van één kalenderjaar. Standaard is dat het nieuwste jaar waarin al een factuur staat — begin januari zie je dus nog het afgelopen jaar, en zodra de eerste factuur van het nieuwe jaar erin staat springt het overzicht mee. Zijn er meerdere jaren, dan verschijnen er jaarknoppen; oude jaren blijven zo altijd terug te vinden. Klanten staan er los van en blijven over de jaren heen bestaan.
- **Omzet per regel** (`invoices.revenue_subtotal`): bij elke factuurregel staat in het formulier een vinkje "Omzet", standaard aan. Uit betekent dat die regel niet meetelt in het omzetcijfer op het dashboard — handig bij een doorlopende post. Dit is puur een interne statistiek: op de factuur en de PDF is er niets van te zien, en `subtotal`/`total` (het echte factuurbedrag) blijven altijd de som van álle regels.
- **Prijsopgaven** (`/prijsopgaven`, tabel `quotes`): een eigen overzicht, los van de facturen — via *Prijsopgaven* rechtsboven op het dashboard. Het formulier is hetzelfde als bij een factuur, maar bijna alles is optioneel: nummer (voorstel `PJJ-NNN`, mag je aanpassen of leeg laten), bedrijfsnaam, t.a.v., adres en postcode. Op de PDF staat **Prijsopgave** als titel; wat je leeg laat komt er niet op, en het bankrekeningnummer en de betaalregel vallen weg. Je kunt een bestaande klant uit de lijst kiezen om de velden in te vullen, maar een nieuw ingetypte naam wordt **niet** als klant aangemaakt — een prijsopgave raakt de tabel `clients` nooit. Prijsopgaven tellen niet mee in de omzet of het aantal facturen, en zijn net als facturen aan te passen en te verwijderen. De PDF's staan in dezelfde privé-bucket, in de map `prijsopgaven/`.
- **Archief**: facturen staan in de Postgres-tabel `invoices`, de PDF's in een **privé** Supabase Storage-bucket (`invoices`). Downloaden gaat via een kortlevende signed URL, nooit een publieke link.
- **Klanten bewerken/verwijderen**: klik op een klant in het overzicht. Op de klantpagina pas je bedrijfsnaam, contactpersoon, adres en postcode aan, of verwijder je de klant. Een klant met facturen kan niet verwijderd worden — verwijder eerst die facturen, zodat het archief nooit ongemerkt gaten krijgt.
- **Klanten**: automatisch bijgehouden in de tabel `clients`, ge-upsert op bedrijfsnaam. Een factuur bewaart een eigen snapshot van de klantgegevens op het moment van factureren — een latere adreswijziging van de klant verandert oude facturen dus nooit met terugwerkende kracht.
- **Vaste bedrijfsgegevens** (IBAN, KVK, BTW-nummer, adres, BTW-percentage, teksten): staan in [lib/config.ts](lib/config.ts).
- **Login**: Supabase Auth (e-mail/wachtwoord). Nieuwe gebruikers kunnen zich niet zelf registreren — accounts worden handmatig aangemaakt in het Supabase-dashboard.

## Logo toevoegen

Er staat nu een marineblauw placeholder-vlak in plaats van het logo op de factuur. Zodra je het logo-bestand hebt, zet het in `assets/` en laat het weten — dan verwerk ik het als ingebedde afbeelding in [lib/invoice/template.ts](lib/invoice/template.ts).

## Deployen naar Vercel + facturen.studio-levant.nl

1. Zorg dat de laatste code op GitHub staat (`git push`).
2. Ga naar [vercel.com](https://vercel.com), maak een gratis account (Hobby-plan), en importeer deze GitHub-repository als nieuw project.
3. Zet bij "Environment Variables" dezelfde drie Supabase-variabelen als in `.env.local`.
4. Deploy — Vercel herkent Next.js automatisch, geen extra build-instellingen nodig.
5. Voeg in Vercel bij "Domains" `facturen.studio-levant.nl` toe, en volg de DNS-instructie die Vercel toont (meestal een CNAME-record bij je huidige hostingpartij/DNS-beheerder, aangezien de hoofdsite via Framer draait).

**Let op — Supabase gratis project pauzeert na 1 week inactiviteit.** Bij weinig gebruik (een paar facturen per maand) kan het voorkomen dat je project "slaapt". Zet 'm dan eerst even aan in het Supabase-dashboard voordat je een factuur probeert te maken.
