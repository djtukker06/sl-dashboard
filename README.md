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
- **Factuurdatum**: standaard vandaag (Nederlandse tijd), maar aanpasbaar — zo kun je ook een oudere factuur met de juiste datum invoeren. Het jaartal in het factuurnummer moet gelijk zijn aan het jaar van de datum; anders zouden het jaaroverzicht en de datum op de PDF elkaar tegenspreken.
- **Jaaroverzicht**: het dashboard toont het aantal facturen en de omzet (excl. btw) van één kalenderjaar. Zodra er een factuur in een nieuw jaar staat, verschijnen er jaarknoppen om tussen de jaren te wisselen; oude jaren blijven zo altijd terug te vinden. Klanten staan er los van en blijven over de jaren heen bestaan.
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
