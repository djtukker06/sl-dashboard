# Studio Levant — backoffice

Eén backoffice voor Studio Levant: een dashboard voor elke dag, met mail, agenda & taken,
facturen en social media in dezelfde omgeving. Na het inloggen (Supabase Auth) zie je links
altijd dezelfde navigatierail met het Studio Levant-beeldmerk; een klik op het logo brengt
je vanuit elke module terug naar het dashboard.

**Stack**: Next.js 16 (App Router) · Supabase (Postgres, Storage, Auth) · Vercel.

| Module | Route | Wat |
|---|---|---|
| Dashboard | `/` | "Vandaag": begroeting, snelle acties, snelinvoer voor taken, dagplanning, taken, deze week, inbox, facturen en recente social posts |
| Mail | `/mail` | Inbox van info@studio-levant.nl (Private Email): lezen, beantwoorden, doorsturen, nieuwe mail, mail → taak |
| Agenda | `/agenda` | Taken en afspraken in één agenda (week/maand), snelinvoer in gewone taal |
| Facturen | `/facturen` | De facturentool: facturen, prijsopgaven, klanten en PDF's (ongewijzigd) |
| Social | `/social` | De social-media-tool (voorheen lokaal), met dezelfde schermen en werking |

## Eerste keer inrichten (checklist)

1. **SQL uitvoeren** in Supabase: `supabase/UITVOEREN_IN_SQL_EDITOR.sql` (zie hieronder).
   Tot dan tonen social en de agenda een nette melding "nog niet ingericht".
2. **Oude social-posts importeren** met `scripts/importeer-social-projecten.mjs`
   (zie "Social-projecten importeren").
3. **Omgevingsvariabelen** zetten in `.env.local` en in Vercel (zie "Omgevingsvariabelen"),
   inclusief `MAIL_USER`/`MAIL_PASSWORD` om de mail te koppelen.
4. Deployen op Vercel (zie "Deployen op Vercel").

## Lokaal draaien

1. Zorg dat Node.js (≥ 22.17) beschikbaar is (`export PATH="$HOME/.local/node/bin:$PATH"` als het niet gevonden wordt).
2. `npm install`
3. Kopieer `.env.local.example` naar `.env.local` en vul de waarden in (zie "Omgevingsvariabelen").
4. Draai de database-SQL (zie "Database inrichten").
5. Maak in het Supabase-dashboard (Authentication → Users → Add user) een inlogaccount aan
   voor jezelf — er is geen publieke registratie. Zet eventueel bij de gebruiker in
   *User Metadata* `{"naam": "Daniel"}`; die naam gebruikt het dashboard voor de begroeting.
6. `npm run dev` en ga naar `http://localhost:3000`.

## Database inrichten: één SQL-bestand

Alles wat de nieuwe modules nodig hebben staat in **`supabase/UITVOEREN_IN_SQL_EDITOR.sql`**:
de migraties 0014–0019 achter elkaar, in één transactie.

| Migratie | Inhoud |
|---|---|
| `0014_social.sql` | tabellen `social_projects`, `social_slides`, `social_versions`, `social_brand` (RLS) en functie `social_restore_latest` |
| `0015_social_storage.sql` | privé-bucket `social-assets` met policies |
| `0016_social_brand_seed.sql` | de huisstijl (`brand.css` en `huisstijl.md`) als startwaarde |
| `0017_social_storage_limieten.sql` | max. 50 MB en alleen beeld/ZIP/PDF in `social-assets` |
| `0018_agenda_taken.sql` | tabellen `tasks` en `calendar_events` (RLS, `updated_at`-trigger) |
| `0019_mail_opslag.sql` | privé-bucket `mail-tmp` voor grote mailbijlagen |

**Uitvoeren:** Supabase-dashboard → je project → **SQL Editor** → *New query* → plak het hele
bestand → **Run**. Onderaan verschijnt een controletabel; elke regel moet `ok` tonen.

- Het bestand is **veilig om nogmaals uit te voeren** (`if not exists`, `drop policy if exists`,
  `on conflict do nothing`): bestaande posts, taken en een aangepaste huisstijl blijven staan.
  Getest door het twee keer achter elkaar uit te voeren op een lege lokale Postgres.
- De facturen-tabellen (0001–0013) worden niet aangeraakt.
- Het bestand wordt gegenereerd uit `supabase/migrations/` met
  `node scripts/genereer-sql-editor.mjs` (controle: `--controleer`). Pas het niet met de hand
  aan; pas de migratie aan en genereer opnieuw.
- Met de Supabase CLI kan het ook: `supabase link --project-ref <ref>` en `supabase db push`
  (draait de losse migraties).

## Social-projecten importeren

De projecten van de oude lokale tool (`Social-media-tool/projects/`) zet je over met
`scripts/importeer-social-projecten.mjs`. **Volgorde:** eerst het SQL-bestand hierboven, dan
pas importeren.

```bash
# 1. Dry-run (standaard): toont alleen wat er geïmporteerd zou worden, schrijft niets
node scripts/importeer-social-projecten.mjs --bron ../Social-media-tool

# 2. Echt importeren: vraagt om bevestiging door de Supabase-host over te typen
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> \
  node scripts/importeer-social-projecten.mjs --bron ../Social-media-tool --uitvoeren
```

Het script slaat `.prullenbak` over, neemt alle slide-bestanden en versies mee en zet het
beeldmateriaal in de bucket `social-assets`. Het is veilig om opnieuw te draaien (upsert).
Dode verwijzingen naar beeldmateriaal worden gemeld en overgeslagen. Daarna staan de oude
posts gewoon in de social-sidebar en op het dashboard.

## Omgevingsvariabelen

Lokaal in `.env.local` (voorbeeld zonder waarden: `.env.local.example`), online in Vercel
onder **Project Settings → Environment Variables** (Production én Preview):

| Variabele | Verplicht | Waarvoor |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ja | URL van het Supabase-project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ja | Publieke anon-key (login in de browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | ja | Geheime service-role key, alleen op de server |
| `ANTHROPIC_API_KEY` | voor social | Anthropic-key voor het genereren van social posts |
| `MAIL_USER`, `MAIL_PASSWORD` | voor mail | Mailbox voor `/mail` (zie "Mail koppelen") |
| `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | nee | Standaard `mail.privateemail.com`, 993 en 465 |
| `MAIL_FROM_NAME`, `MAIL_HANDTEKENING` | nee | Afzendernaam (standaard "Studio Levant") en handtekening (`\n` = nieuwe regel) |
| `CHROME_PATH` | nee, alleen lokaal | Eigen Chrome/Chromium voor social-exports tijdens `npm run dev` |

Na het wijzigen van een variabele in Vercel: opnieuw deployen (Deployments → … → Redeploy),
anders gebruikt de site nog de oude waarden. De API-key kan niet in de social-tool zelf
worden ingevuld; de instellingen-dialoog laat alleen zien of er een key op de server staat.

## De shell: één geheel

- **Eén bron voor de navigatie:** `lib/modules.ts`. De rail, de actieve staat en de snelle
  acties op het dashboard lezen alleen daaruit. Iconen staan in `lib/shell/iconen.ts`.
- **React-pagina's** staan in de route-group `app/(app)/` (dashboard, mail, agenda, facturen);
  `app/(app)/layout.tsx` controleert de sessie en zet de rail (`components/shell/Rail.tsx`)
  eromheen. De URL's veranderen daardoor niet.
- **Social** is een los HTML-document (`assets/social-app/index.html` + `public/social/app.js`/
  `app.css`). `app/social/route.ts` controleert de sessie en zet dezelfde rail
  (`railHtml()` uit `lib/shell/rail.ts`) direct na `<body>`. Binnen zijn eigen kolommen is
  social gelijk aan het origineel; de banner linkt naar het dashboard.
- **Stijl en gedrag** voor beide: `public/shell/shell.css` (alles met prefix `sl-`, botst niet
  met facturen of social) en `public/shell/shell.js` (accountmenu, mail-badge,
  `/social#nieuw` opent "Nieuwe post").
- **Logo's:** `public/brand/beeldmerk-licht.png` (rail, favicon via `app/icon.png`) en
  `public/brand/banner-licht.png` (login). Ze zijn openbaar, net als op de website.
- **Uitloggen** is een gewoon formulier naar `POST /auth/uitloggen` (controleert de
  `Origin`), zodat het ook in social werkt.
- Op een telefoon (≤ 720 px) wordt de rail een tabbalk onderaan.

## Dashboard

`app/(app)/page.tsx`: kop met dag, weeknummer en begroeting; snelle acties (Taak, Nieuwe
factuur, Nieuwe post, Nieuwe mail); snelinvoer voor taken; widgets Vandaag, Taken, Deze week,
Inbox, Facturen en Social. Elke widget laadt los (eigen laad-, leeg- en foutstaat), zodat één
trage of nog niet ingerichte bron de rest niet blokkeert. De facturen-widget is alleen-lezen
en rekent met dezelfde regels als het facturenoverzicht (omzet excl. btw per jaar; open =
aanbetaling zonder restfactuur).

## Agenda & taken

- `supabase/migrations/0018_agenda_taken.sql`: tabellen `tasks` en `calendar_events`
  (idempotent, met RLS en `set_updated_at`-trigger). Tot deze migratie is uitgevoerd tonen
  de agenda en de dashboard-widgets een nette melding "nog niet ingericht".
- Snelinvoer (`lib/agenda/snelinvoer.ts`) herkent o.a. `vandaag`, `morgen`, `vrijdag`,
  `volgende week di`, `12 nov`, `22-10`, `14:00`, `om 9`, `10:00-11:00`, `1u`, `45 min`,
  `!`/`!laag` en `@klant`. Begint de tekst met `afspraak` (of staat er een tijdvak in), dan
  wordt het een afspraak. Alle datums in Europe/Amsterdam-tijd.
- Tests: `node scripts/test-snelinvoer.mjs` (ook zomer-/wintertijd rond 25 okt 2026).

## Mail koppelen (Namecheap Private Email)

De inbox van studio-levant.nl staat op `/mail` en als widget op het dashboard; de rail toont
het aantal ongelezen mails. Lezen, zoeken, markeren, archiveren, verwijderen (naar de
prullenbak, nooit definitief), bijlagen downloaden, beantwoorden (met juiste threading),
allen beantwoorden, doorsturen (met de originele bijlagen) en nieuwe mail met bijlagen
(samen max. 4 MB). Vanuit een mail maak je met één klik (of `t`) een taak "Reageren: …"
voor vandaag.

**Koppelen.** Zet in Vercel (en lokaal in `.env.local`), en deploy daarna opnieuw:

| Variabele | Waarde voor Private Email |
|---|---|
| `MAIL_USER` | `info@studio-levant.nl` (het volledige adres) |
| `MAIL_PASSWORD` | het wachtwoord van die mailbox |
| `MAIL_IMAP_HOST` / `MAIL_IMAP_PORT` | `mail.privateemail.com` / `993` (SSL) — standaardwaarden, mag leeg |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` | `mail.privateemail.com` / `465` (SSL) — standaardwaarden, mag leeg |
| `MAIL_FROM_NAME` | bv. `Studio Levant` |
| `MAIL_HANDTEKENING` | optioneel, bv. `Met vriendelijke groet,\nDaniel\nStudio Levant` |

Zonder `MAIL_USER`/`MAIL_PASSWORD` tonen `/mail` en het dashboard een nette uitleg; er
komt geen foutmelding. Het wachtwoord blijft op de server.

**Hoe het werkt.**
- Elke API-route opent één IMAP-sessie en logt daarna uit (geen open verbindingen; past bij
  Vercel). `lib/mail/` bevat de verbinding (`imap.ts`), mappen (`mappen.ts`), berichten
  (`berichten.ts`), sanering (`saneren.ts`), verzenden (`smtp.ts`) en grote bijlagen
  (`opslag.ts`).
- Een bericht wordt met PEEK opgehaald; de app zet het pas op gelezen als het even open
  staat (of nooit, na "Ongelezen").
- Verzonden mail wordt via IMAP `APPEND` in Verzonden bewaard (SMTP doet dat niet zelf).
- **Veilig tonen:** de HTML wordt op de server gesaneerd (geen scripts, iframes, formulieren,
  `on*`-attributen of `javascript:`-links) en daarna getoond in een iframe met `sandbox`
  zonder scripts en zonder same-origin, plus een CSP die alleen inline stijlen en
  `data:`-afbeeldingen toestaat. Externe afbeeldingen (tracking-pixels) laden pas na
  "Tonen". Bijlagen worden altijd als download geserveerd (`nosniff`, HTML/SVG als
  `application/octet-stream`).
- Bijlagen groter dan 4 MB (Vercel-limiet) gaan via de privé-bucket `mail-tmp`
  (migratie `0019_mail_opslag.sql`) en een signed URL van 60 s.
- Sneltoetsen op `/mail`: `j`/`k`, `r`, `a`, `f`, `e`, `#`, `u`, `s`, `t`, `c`, `/`, `⌘ Enter`.

## Facturen

De facturentool werkt precies zoals altijd, alleen onder `/facturen` en binnen de shell.
Oude adressen blijven werken via tijdelijke redirects in `next.config.ts`: `/nieuwe-factuur`,
`/klanten/…`, `/prijsopgaven/…` en `/?jaar=…` gaan naar dezelfde pagina onder `/facturen`.


- **Nieuwe factuur** (`/facturen/nieuwe-factuur`): vul klantgegevens en factuurregels in. Typ je een klantnaam die al eerder is gebruikt, dan verschijnt een suggestie — kies die en de overige klantgegevens worden automatisch ingevuld. De middelste kolom (bv. "Periode" of "Aantal") is optioneel.
- **Factuurnummer**: `JJ-NNN`. Het formulier stelt automatisch "hoogste bestaande nummer van dit jaar + 1" voor (verwijder je de laatste factuur, dan komt dat nummer weer vrij), maar je kunt het voor het genereren handmatig aanpassen. Omdat het jaartal in het nummer zit, begint de nummering elk kalenderjaar vanzelf weer bij `001`. De Postgres-functie `create_invoice` bewaakt dat een nummer nooit dubbel wordt gebruikt.
- **Naam factuur** (`invoices.name`): standaard `Factuur JJ-NNN` — verander je het factuurnummer, dan loopt de naam mee tot je hem zelf aanpast. Je kunt er een eigen omschrijving achter typen. De naam wordt **alleen** gebruikt als bestandsnaam van de PDF-download (`Content-Disposition`); op de factuur zelf staat hij niet.
- **Factuurdatum**: standaard vandaag (Nederlandse tijd), maar aanpasbaar — zo kun je ook een oudere factuur met de juiste datum invoeren. Het jaartal in het factuurnummer moet gelijk zijn aan het jaar van de datum; anders zouden het jaaroverzicht en de datum op de PDF elkaar tegenspreken.
- **Btw verlegd** (`invoices.vat_reverse_charged`): bij het aanmaken (en bewerken) van een factuur staat een vinkje "Btw verlegd". Aangevinkt betekent: geen btw op deze factuur. Daaronder kies je wat er in het btw-vakje op de PDF komt (tussen subtotaal en totaal): **Verlegd** of **N.v.t.** (`invoices.vat_reverse_charge_display`, standaard Verlegd). Dat staat er dan in plaats van een bedrag, het totaal is gelijk aan het subtotaal, en `vat_percentage`/`vat_amount` worden 0 opgeslagen. Het losse veld **Reden btw verlegd** (`invoices.vat_reverse_charge_reason`) verschijnt zodra je het vinkje aanzet; die tekst komt als extra regel onderaan de PDF, boven "Betaling van deze factuur…". Laat je hem leeg, dan komt er geen extra regel bij.
- **Aanbetaling** (`invoices.deposit_percentage`): bovenaan het factuurformulier kies je *Reguliere factuur* of *Aanbetaling*. Bij een aanbetaling vul je de **volledige prijzen** van de opdracht in en kies je met een slider het percentage (5% t/m 95%, per 5%). Op de PDF staat elke regel op dat percentage (per regel op centen afgerond, zodat alles precies optelt), met onder de titel "Aanbetaling 30%" en onderaan een regel met het percentage, het totale opdrachtbedrag en het restant dat later voldaan moet worden (beide bedragen altijd excl. btw). `line_items` bewaart de volledige prijzen (zodat bewerken gewoon werkt); `subtotal`, `vat_amount`, `total` en `revenue_subtotal` zijn de bedragen van de aanbetaling — dat is wat er gefactureerd wordt en dus wat meetelt in de omzet. Bij een reguliere factuur is `deposit_percentage` leeg.
- **Restfactuur**: aanbetalingen zonder restfactuur staan op het facturenoverzicht in het blok *Open aanbetalingen*, en in de facturentabel met een label. Met **Restfactuur maken** ontstaat in één klik een gewone factuur voor het resterende deel: zelfde klant, regels en btw-instellingen, datum vandaag en het eerstvolgende factuurnummer. Elke regel krijgt de volledige prijs min wat er op de aanbetaling stond, zodat aanbetaling + restfactuur samen precies de opdracht zijn. Op de PDF staat "Restbetaling 70%" en onderaan een verwijzing naar de aanbetalingsfactuur. De koppeling staat in `invoices.remainder_of_invoice_id` (met `remainder_percentage` en `remainder_of_number` als snapshot voor de PDF); per aanbetaling kan er maar één restfactuur zijn. Verwijder je de restfactuur, dan kun je hem opnieuw maken.
- **Factuur aanpassen**: klik in het overzicht op *Aanpassen* naast een factuur. Je krijgt hetzelfde scherm als bij een nieuwe factuur, maar dan ingevuld met de opgeslagen gegevens; met *Wijzigingen opslaan* worden de factuurgegevens bijgewerkt en wordt de PDF opnieuw gegenereerd. Het blijft dezelfde factuur (zelfde `id`, zelfde plek in het archief) — er komt dus geen tweede regel bij. Verandert het bedrag, dan loopt het jaaroverzicht (aantal en omzet) meteen mee. De nieuwe PDF krijgt een eigen pad in de opslag en de oude wordt daarna verwijderd; downloaden geeft dus altijd de laatste versie, nooit een gecachte oude. De database bewaakt bij het bewerken dezelfde regels als bij het aanmaken: geldig volgnummer, geen dubbel factuurnummer, en het jaartal in het nummer gelijk aan het jaar van de datum.
- **Jaaroverzicht**: het facturenoverzicht toont het aantal facturen en de omzet (excl. btw) van één kalenderjaar. Standaard is dat het nieuwste jaar waarin al een factuur staat — begin januari zie je dus nog het afgelopen jaar, en zodra de eerste factuur van het nieuwe jaar erin staat springt het overzicht mee. Zijn er meerdere jaren, dan verschijnen er jaarknoppen; oude jaren blijven zo altijd terug te vinden. Klanten staan er los van en blijven over de jaren heen bestaan.
- **Omzet per regel** (`invoices.revenue_subtotal`): bij elke factuurregel staat in het formulier een vinkje "Omzet", standaard aan. Uit betekent dat die regel niet meetelt in het omzetcijfer (facturenoverzicht en dashboard-widget) — handig bij een doorlopende post. Dit is puur een interne statistiek: op de factuur en de PDF is er niets van te zien, en `subtotal`/`total` (het echte factuurbedrag) blijven altijd de som van álle regels.
- **Prijsopgaven** (`/facturen/prijsopgaven`, tabel `quotes`): een eigen overzicht, los van de facturen — via *Prijsopgaven* rechtsboven op het facturenoverzicht. Het formulier is hetzelfde als bij een factuur, maar bijna alles is optioneel: nummer (voorstel `PJJ-NNN`, mag je aanpassen of leeg laten), bedrijfsnaam, t.a.v., adres en postcode. Op de PDF staat **Prijsopgave** als titel; wat je leeg laat komt er niet op, en het bankrekeningnummer en de betaalregel vallen weg. Je kunt een bestaande klant uit de lijst kiezen om de velden in te vullen, maar een nieuw ingetypte naam wordt **niet** als klant aangemaakt — een prijsopgave raakt de tabel `clients` nooit. Prijsopgaven tellen niet mee in de omzet of het aantal facturen, en zijn net als facturen aan te passen en te verwijderen. De PDF's staan in dezelfde privé-bucket, in de map `prijsopgaven/`.
- **Archief**: facturen staan in de Postgres-tabel `invoices`, de PDF's in een **privé** Supabase Storage-bucket (`invoices`). Downloaden gaat via een kortlevende signed URL, nooit een publieke link.
- **Klanten bewerken/verwijderen**: klik op een klant in het overzicht. Op de klantpagina pas je bedrijfsnaam, contactpersoon, adres en postcode aan, of verwijder je de klant. Een klant met facturen kan niet verwijderd worden — verwijder eerst die facturen, zodat het archief nooit ongemerkt gaten krijgt.
- **Klanten**: automatisch bijgehouden in de tabel `clients`, ge-upsert op bedrijfsnaam. Een factuur bewaart een eigen snapshot van de klantgegevens op het moment van factureren — een latere adreswijziging van de klant verandert oude facturen dus nooit met terugwerkende kracht.
- **Vaste bedrijfsgegevens** (IBAN, KVK, BTW-nummer, adres, BTW-percentage, teksten): staan in [lib/config.ts](lib/config.ts).
- **Login**: Supabase Auth (e-mail/wachtwoord). Nieuwe gebruikers kunnen zich niet zelf registreren — accounts worden handmatig aangemaakt in het Supabase-dashboard.

## Routes

| Route | Inhoud |
|---|---|
| `/` | Dashboard "Vandaag" |
| `/login`, `/wachtwoord-vergeten` | Openbaar; na inloggen terug naar waar je was (`?next=`) |
| `/nieuw-wachtwoord`, `/auth/callback`, `POST /auth/uitloggen` | Wachtwoord instellen, inlog-callback, uitloggen |
| `/facturen…` | Facturen, prijsopgaven, klanten |
| `/api/invoices…`, `/api/quotes…`, `/api/clients/search` | Facturen-API (ongewijzigd) |
| `/agenda` | Agenda & taken (`?dag=`, `?weergave=maand`, `?taak=`, `?afspraak=`) |
| `/api/agenda`, `/api/taken…`, `/api/afspraken…` | Agenda-API (503 `tabel_ontbreekt` vóór de SQL) |
| `/mail` | Mail (`?map=`, `?uid=`, `?nieuw=1`) |
| `/api/mail/…` | Mail-API (503 `niet_gekoppeld` zonder mail-variabelen) |
| `/social` | Social-media-tool (`#p=<id>` opent een project, `#nieuw` een nieuwe post) |
| `/api/social/…`, `/social-files/…` | Social-API (spiegelt de oude Express-API) en de bestanden die slides laden |

**Beveiliging.** Alles behalve `/login`, `/wachtwoord-vergeten`, `/auth/*`, de logo's en de
shell-bestanden zit achter de login. `proxy.ts` stuurt niet-ingelogde bezoekers naar
`/login` (de API's van social, agenda en mail krijgen een echte 401), en **elke** pagina en
API-route controleert daarnaast zelf de sessie. Nieuwe tabellen hebben RLS. Mail-HTML wordt
op de server gesaneerd en in een gesandboxte iframe zonder scripts getoond.

## Controleren

```bash
npx tsc --noEmit && npm run lint && npm run build
node scripts/rooktest-shell.mjs --alleen-statisch     # React-rail en social-rail gelijk
npx next start -p 3107 &                              # (na de build)
node scripts/rooktest-shell.mjs http://localhost:3107 # alle pagina's -> /login, alle API's weigeren
node scripts/test-snelinvoer.mjs                      # snelinvoer agenda (incl. zomer-/wintertijd)
node scripts/test-brand-guard-parity.mjs              # social-port gelijk aan het origineel
node scripts/genereer-sql-editor.mjs --controleer     # SQL-bestand actueel
node --experimental-strip-types scripts/rooktest-render.mjs   # social-renderer (lokale Chrome nodig)
```

## Een module toevoegen

1. Voeg één entry toe aan `MODULES` in `lib/modules.ts` (id, naam, kort label, `href`, icoon,
   `actief: true`, eventueel een `snelactie`). De rail (ook in social) en de snelle acties op
   het dashboard nemen hem automatisch over. Een nieuw icoon voeg je toe in `lib/shell/iconen.ts`.
2. Maak de pagina's in `app/(app)/<module>/`; dan staan ze vanzelf in de shell.
3. Eventueel API-routes in `app/api/<module>/`. Begin elke route met een sessiecheck, zoals de
   bestaande routes, en geef zonder sessie een 401 (zet het pad ook in de 401-lijst in `proxy.ts`).
4. Eventueel een migratie `supabase/migrations/00NN_<module>.sql` met RLS aan, idempotent
   geschreven. Voeg hem toe aan `MIGRATIES` in `scripts/genereer-sql-editor.mjs` en genereer
   `UITVOEREN_IN_SQL_EDITOR.sql` opnieuw.

## Deployen op Vercel

1. Zet de code op GitHub (zie "Nieuwe git-remote toevoegen") en importeer de repo in Vercel,
   of koppel hem aan het bestaande project (en domein) van de facturentool. Oude bookmarks
   blijven werken via de redirects.
2. Zet de omgevingsvariabelen hierboven (Production én Preview).
3. Deploy. Vercel herkent Next.js automatisch.
4. Domein: voeg in Vercel bij "Domains" bv. `facturen.studio-levant.nl` (of een nieuw
   subdomein) toe en volg de DNS-instructie (meestal een CNAME bij je DNS-beheerder).

Instellingen:

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
- Mail-routes hebben `maxDuration` 30 (`vercel.json`); er blijft geen IMAP-verbinding open.

**Let op — een gratis Supabase-project pauzeert na 1 week inactiviteit.** Zet het dan eerst
weer aan in het Supabase-dashboard.

## Nieuwe git-remote toevoegen


Deze map is gekopieerd uit de facturen-repo; de oude `origin` is bewust verwijderd,
zodat een push nooit per ongeluk in de facturen-repo belandt. Maak een nieuwe (lege)
repo aan, bijvoorbeeld op GitHub, en koppel die:

```bash
git remote add origin git@github.com:<account>/studio-levant-dashboard.git
git push -u origin dashboard
```

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
- **Mail:** de link in een taak die met "Taak maken" uit een mail is gemaakt werkt niet meer
  zodra die mail naar een andere map is verplaatst (het uid verandert dan).
- **Agenda:** geen herhalende afspraken (bewust, voor nu).
- **Social op de telefoon** is net als het origineel niet geoptimaliseerd voor kleine schermen.
