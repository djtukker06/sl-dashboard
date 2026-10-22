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
- **Aanbetaling** (`invoices.deposit_percentage`): bovenaan het factuurformulier kies je *Reguliere factuur* of *Aanbetaling*. Bij een aanbetaling vul je de **volledige prijzen** van de opdracht in en kies je met een slider het percentage (5% t/m 95%, per 5%). Op de PDF staat elke regel op dat percentage (per regel op centen afgerond, zodat alles precies optelt), met onder de titel "Aanbetaling 30%" en onderaan een regel met het percentage, het totale opdrachtbedrag en het restant dat later voldaan moet worden (beide bedragen altijd excl. btw). `line_items` bewaart de volledige prijzen (zodat bewerken gewoon werkt); `subtotal`, `vat_amount`, `total` en `revenue_subtotal` zijn de bedragen van de aanbetaling — dat is wat er gefactureerd wordt en dus wat meetelt in de omzet. Bij een reguliere factuur is `deposit_percentage` leeg.
- **Restfactuur**: aanbetalingen zonder restfactuur staan op het dashboard in het blok *Open aanbetalingen*, en in de facturentabel met een label. Met **Restfactuur maken** ontstaat in één klik een gewone factuur voor het resterende deel: zelfde klant, regels en btw-instellingen, datum vandaag en het eerstvolgende factuurnummer. Elke regel krijgt de volledige prijs min wat er op de aanbetaling stond, zodat aanbetaling + restfactuur samen precies de opdracht zijn. Op de PDF staat "Restbetaling 70%" en onderaan een verwijzing naar de aanbetalingsfactuur. De koppeling staat in `invoices.remainder_of_invoice_id` (met `remainder_percentage` en `remainder_of_number` als snapshot voor de PDF); per aanbetaling kan er maar één restfactuur zijn. Verwijder je de restfactuur, dan kun je hem opnieuw maken.
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

---

# Studio Levant Dashboard

Deze repo is uitgegroeid tot één overkoepelend backoffice-dashboard voor Studio Levant.
Na inloggen (Supabase Auth, dezelfde login als voorheen) kom je op een dashboard met
tegels per module. De facturentool hierboven werkt precies zoals altijd, alleen onder
`/facturen`. De social-media-tool (voorheen de lokale "Levant Social Studio") draait nu
online, met dezelfde schermen en werking.

## Modules en routes

| Route | Inhoud |
|---|---|
| `/` | Dashboard met moduletegels (uit `lib/modules.ts`) |
| `/login` | Inloggen; daarna naar `/` |
| `/facturen` | Facturenoverzicht (met `?jaar=`) |
| `/facturen/nieuwe-factuur`, `/facturen/[id]/bewerken` | Factuur maken en bewerken |
| `/facturen/klanten/[clientId]` | Klantpagina |
| `/facturen/prijsopgaven`, `/facturen/prijsopgaven/nieuw`, `/facturen/prijsopgaven/[id]/bewerken` | Prijsopgaven |
| `/api/invoices…`, `/api/quotes…`, `/api/clients/search` | Facturen-API (ongewijzigd) |
| `/social` | Social-media-tool (statische frontend in `public/social/`) |
| `/api/social/…` | Social-API (spiegelt de oude Express-API: `/api/X` werd `/api/social/X`) |
| `/social-files/…` | Slides, huisstijl-CSS, logo's en beeldmateriaal die de slides laden |

Elke pagina en elke API-route zit achter de login: `proxy.ts` stuurt niet-ingelogde
bezoekers naar `/login`, en elke API-route controleert daarnaast zelf de sessie.

Oude adressen blijven werken via tijdelijke redirects in `next.config.ts`:
`/nieuwe-factuur`, `/klanten/…`, `/prijsopgaven/…` en `/?jaar=…` gaan naar dezelfde
pagina onder `/facturen`.

## Omgevingsvariabelen

Lokaal in `.env.local` (zie `.env.local.example`), online in Vercel onder
Project Settings → Environment Variables:

| Variabele | Waarvoor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL van het Supabase-project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publieke anon-key (login in de browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Geheime service-role key, alleen op de server |
| `ANTHROPIC_API_KEY` | Anthropic-key voor het genereren van social posts |

De API-key kan niet meer in de social-tool zelf worden ingevuld (het oude
`.env`-bestand in de Social-media-tool-map is vervallen). De instellingen-dialoog
laat alleen zien of er een key op de server staat.

## Database-migraties 0014–0016 (social-module)

De social-module heeft drie nieuwe migraties. De bestaande facturen-migraties
0001–0013 zijn niet veranderd.

- `supabase/migrations/0014_social.sql`: tabellen `social_projects`, `social_slides`,
  `social_versions` en `social_brand`, met RLS en de functie `social_restore_latest`.
- `supabase/migrations/0015_social_storage.sql`: privé Storage-bucket `social-assets`.
- `supabase/migrations/0016_social_brand_seed.sql`: de huisstijl (`brand.css` en
  `huisstijl.md`) als startwaarde.

Draai ze in volgorde, **eerst op een testproject** en pas daarna op het echte project:

- via de Supabase SQL-editor: plak elk bestand en voer het uit, of
- met de CLI: `supabase link --project-ref <ref>` en daarna `supabase db push`.

## Social-projecten importeren

De projecten van de oude lokale tool (`Social-media-tool/projects/`) kun je overzetten
met `scripts/importeer-social-projecten.mjs`. Draai eerst de migraties.

```bash
# 1. Dry-run (standaard): toont alleen wat er geïmporteerd zou worden, schrijft niets
node scripts/importeer-social-projecten.mjs --bron ../Social-media-tool

# 2. Echt importeren: vraagt om bevestiging door de Supabase-host over te typen
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> \
  node scripts/importeer-social-projecten.mjs --bron ../Social-media-tool --uitvoeren
```

Het script slaat `.prullenbak` over, neemt alle slide-bestanden en versies mee en zet
het beeldmateriaal in de bucket `social-assets`. Het is veilig om opnieuw te draaien
(upsert). Dode verwijzingen naar beeldmateriaal worden gemeld en overgeslagen.

## Deployen op Vercel

- Maak een nieuw Vercel-project voor deze repo, of koppel de repo aan het bestaande
  project (en domein) van de facturentool. Oude bookmarks blijven werken via de
  redirects.
- Zet de vier omgevingsvariabelen hierboven.
- Zet **Fluid compute** aan (standaard bij nieuwe projecten). Dan kan de generatie
  van social posts tot `maxDuration` 300 seconden duren, ook op het Hobby-plan.
- `vercel.json` geeft de PDF- en exportroutes `memory` 2048 MB (Chromium via
  `@sparticuz/chromium`), en generate/revise `maxDuration` 300. Controleer na de eerste
  build in het Vercel-dashboard (Functions) dat deze instellingen zijn toegepast.
- Generaties hebben daardoor een limiet van circa 4:45 min (`TIME_LIMIT_MS` in
  `lib/social/generation.ts`). De lokale tool had geen limiet; een grote carrousel met
  veel beelden kan erover gaan. Op het **Pro-plan** kan dit omhoog tot 800 seconden: zet
  dan `maxDuration` op 800 in `vercel.json` én in
  `app/api/social/projects/[id]/generate/route.ts` en
  `app/api/social/projects/[id]/slides/[file]/revise/route.ts`, en `TIME_LIMIT_MS` op
  `785_000` (pas ook de foutmelding aan). Op het Hobby-plan is 300 het maximum; een hogere
  waarde laat de deploy mislukken.

## Nieuwe git-remote toevoegen

Deze map is gekopieerd uit de facturen-repo; de oude `origin` is bewust verwijderd,
zodat een push nooit per ongeluk in de facturen-repo belandt. Maak een nieuwe (lege)
repo aan, bijvoorbeeld op GitHub, en koppel die:

```bash
git remote add origin git@github.com:<account>/studio-levant-dashboard.git
git push -u origin dashboard
```

## Een module toevoegen

1. Voeg één entry toe aan `MODULES` in `lib/modules.ts` (id, naam, beschrijving, `href`,
   icoon, `actief: true`). Het dashboard toont de tegel automatisch. Een nieuw icoon
   voeg je toe in `components/dashboard/ModuleIcoon.tsx`.
2. Maak een map `app/<module>/` met de pagina's. Zet `<DashboardLink />` in de navigatie,
   zodat je terug kunt naar het dashboard.
3. Eventueel: API-routes in `app/api/<module>/`. Begin elke route met een sessiecheck,
   zoals de bestaande routes.
4. Eventueel: een migratie `supabase/migrations/00NN_<module>.sql` met RLS aan, in de
   stijl van de bestaande migraties.

## Bekende beperkingen

- **Generatie maximaal 5 minuten.** Duurt een generatie langer, dan stopt de server met
  een melding. Probeer het opnieuw of met minder beelden.
- **Uploads maximaal 5 MB per afbeelding** (limiet van Anthropic). Foto's worden in de
  browser al verkleind; dit raakt vooral grote GIF's.
- **Export via een Storage-link.** PNG-zip, PDF en de ZIP met HTML-bestanden worden eerst
  in Storage gezet; je browser downloadt ze via een tijdelijke link (5 minuten geldig).
  Oude exports in `social-assets/exports/` worden nog niet automatisch opgeruimd.
- **"Map met HTML-bestanden tonen"** is online "HTML-bestanden downloaden (ZIP)".
- **De lokale `.env`-key is vervallen**; de key staat in `ANTHROPIC_API_KEY` op de server.
