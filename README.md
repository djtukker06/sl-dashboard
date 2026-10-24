# Studio Levant — backoffice

Eén backoffice voor Studio Levant: een dashboard voor elke dag, met mail, agenda & taken,
boekhouding (facturen, bonnetjes en inkoopfacturen) en social media in dezelfde omgeving. Na het inloggen (Supabase Auth) zie je links
altijd dezelfde navigatierail met het Studio Levant-beeldmerk; een klik op het logo brengt
je vanuit elke module terug naar het dashboard.

**Stack**: Next.js 16 (App Router) · Supabase (Postgres, Storage, Auth) · Vercel.

| Module | Route | Wat |
|---|---|---|
| Dashboard | `/` | Jouw eigen "Vandaag": begroeting, snelle acties, jouw dagplanning, taken en week, wat je uitdeelde, je eigen inbox; gedeeld: facturen, laatste bonnetjes en recente posts (met wie ze maakte) |
| Mail | `/mail` | Je eigen mailbox (Private Email): lezen, beantwoorden, doorsturen, nieuwe mail, mail → taak |
| Agenda | `/agenda` | Taken op naam (popup: voor wie, deadline, urgentie, klant, project, subtaken) en afspraken in één agenda (week/maand), alleen wat op jouw naam staat; tab Uitgezet voor wat je bij een ander hebt uitgezet |
| Klanten & projecten | `/klanten`, `/projecten` | Simpel CRM/PM: klanten (lead/actief/afgerond) met contact, notities, projecten, open taken, facturen en prijsopgaven; projecten als bord of lijst (voorbereiding/bezig/wachten op goedkeuring/afgerond) met klant, deadline, eigenaar(s), taken met voortgang en een notitieveld |
| Bestanden | `/bestanden` | De gedeelde Google Drive van Studio Levant: bladeren, slepen-uploaden (ook grote bestanden), mappen, hernoemen, prullenbak, zoeken, voorbeeld; een blok "Bestanden" op elke klant- en projectpagina; facturen, prijsopgaven en bonnetjes gaan er automatisch heen (zie "Google Drive") |
| Boekhouding | `/boekhouding` | Keuze tussen **Facturen** (`/facturen`: facturen, prijsopgaven, klanten en PDF's, ongewijzigd) en **Bonnetjes & inkoopfacturen** (`/boekhouding/bonnetjes`: foto/PDF uploaden en snel terugvinden) |
| Account & mail | `/account` | Je profiel (naam, initialen, kleur), je eigen mailbox koppelen, wachtwoord wijzigen |
| Social | `/social` | De social-media-tool (voorheen lokaal), met dezelfde schermen en werking |

## Eerste keer inrichten (checklist)

1. **Eerst: Supabase-instellingen voor teamtoegang** (zie "Team & toegang"): aanmelden en
   anonieme sign-ins UIT, "Confirm email" AAN, Redirect URLs strak, uitnodigingsmail
   aanpassen. Kijk bij *Authentication → Users* of er alleen accounts staan die je kent.
   Doe dit **vóór** de SQL: zo kan niemand zich nog registreren terwijl het team wordt
   ingericht.
2. **SQL uitvoeren** in Supabase: `supabase/UITVOEREN_IN_SQL_EDITOR.sql` (zie hieronder).
   Tot dan tonen social, de agenda en uitgaven een nette melding "nog niet ingericht".
   Al eerder uitgevoerd (0014–0019)? Dan `supabase/UITVOEREN_0020_UITGAVEN.sql`.
   Al eerder uitgevoerd (0014–0020)? Dan `supabase/UITVOEREN_0021_TEAM.sql`.
   Al eerder uitgevoerd (0014–0021)? Dan alleen `supabase/UITVOEREN_0022.sql` en daarna
   `supabase/UITVOEREN_0023.sql`. Al eerder uitgevoerd (0014–0022)? Dan
   `supabase/UITVOEREN_0023.sql` (projectstatus voor het bord) en daarna
   `supabase/UITVOEREN_0024.sql` (Google Drive). Al eerder uitgevoerd (0014–0023)? Dan alleen
   `supabase/UITVOEREN_0024.sql`.
   Alleen de oudste bestaande gebruiker (Daniel) wordt automatisch lid (eigenaar); controleer
   onderaan het aantal leden en wie het zijn.
3. **Oude social-posts importeren** met `scripts/importeer-social-projecten.mjs`
   (zie "Social-projecten importeren").
4. **Omgevingsvariabelen** zetten in `.env.local` en in Vercel (zie "Omgevingsvariabelen"),
   inclusief `MAIL_ENCRYPTION_KEY` (eigen mailboxen koppelen via `/account`), eventueel
   `MAIL_USER`/`MAIL_PASSWORD` (standaard-mailbox van de eigenaar) en `NEXT_PUBLIC_SITE_URL`.
5. Deployen op Vercel (zie "Deployen op Vercel").
6. **Google Drive koppelen** (module Bestanden): Google Cloud-project, env-vars en één keer
   koppelen als eigenaar (zie "Google Drive").
7. **Compagnon toevoegen** met `scripts/teamlid-toevoegen.mjs` (zie "Bram toevoegen in 3 stappen").

## Lokaal draaien

1. Zorg dat Node.js (≥ 22.17) beschikbaar is (`export PATH="$HOME/.local/node/bin:$PATH"` als het niet gevonden wordt).
2. `npm install`
3. Kopieer `.env.local.example` naar `.env.local` en vul de waarden in (zie "Omgevingsvariabelen").
4. Draai de database-SQL (zie "Database inrichten").
5. Er is geen registratie in de app. Accounts komen er alleen "aan de achterkant" bij, met
   `scripts/teamlid-toevoegen.mjs` (zie "Team & toegang"). Na migratie 0021 komt alleen een
   **actief teamlid** binnen; de naam in de begroeting komt uit zijn profiel.
6. `npm run dev` en ga naar `http://localhost:3000`.

## Database inrichten: één SQL-bestand

Alles wat de nieuwe modules nodig hebben staat in **`supabase/UITVOEREN_IN_SQL_EDITOR.sql`**:
de migraties 0014–0025 achter elkaar, in één transactie. Wie 0014–0019 al heeft uitgevoerd,
draait **`supabase/UITVOEREN_0020_UITGAVEN.sql`** (uitgaven + team); wie 0014–0020 al heeft,
**`supabase/UITVOEREN_0021_TEAM.sql`**; wie 0014–0021 al heeft, **`supabase/UITVOEREN_0022.sql`**
en daarna **`supabase/UITVOEREN_0023.sql`**; wie 0014–0022 al heeft (de huidige situatie: 0023
is nog niet uitgevoerd), **`supabase/UITVOEREN_0023.sql`** en daarna
**`supabase/UITVOEREN_0024.sql`**; wie 0014–0023 al heeft, **`supabase/UITVOEREN_0024.sql`** en daarna **`supabase/UITVOEREN_0025.sql`**;
wie 0014–0024 al heeft, alleen **`supabase/UITVOEREN_0025.sql`** (opvolgen van leads en klanten). Elk groot bestand eindigt met 0021 + 0022 (+ 0023,
alleen de projectstatus, 0024, alleen nieuwe Drive-tabellen met teamcheck, en 0025, alleen kolommen), zodat opnieuw uitvoeren nooit de oude open policies of de open
leesregels voor taken terugzet. 0022 opnieuw uitvoeren na 0023 laat de nieuwe projectstatussen
staan. Onderaan elk
bestand staat een controletabel (elke regel `ok`) en wie er toegang heeft.

| Migratie | Inhoud |
|---|---|
| `0014_social.sql` | tabellen `social_projects`, `social_slides`, `social_versions`, `social_brand` (RLS) en functie `social_restore_latest` |
| `0015_social_storage.sql` | privé-bucket `social-assets` met policies |
| `0016_social_brand_seed.sql` | de huisstijl (`brand.css` en `huisstijl.md`) als startwaarde |
| `0017_social_storage_limieten.sql` | max. 50 MB en alleen beeld/ZIP/PDF in `social-assets` |
| `0018_agenda_taken.sql` | tabellen `tasks` en `calendar_events` (RLS, `updated_at`-trigger) |
| `0019_mail_opslag.sql` | privé-bucket `mail-tmp` voor grote mailbijlagen |
| `0020_uitgaven.sql` | tabellen `expenses` en `expense_files` (RLS, `updated_at`-trigger), privé-buckets `uitgaven` (25 MB, jpeg/png/webp/heic/pdf) en `uitgaven-export` (50 MB, ZIP) |
| `0021_team_en_taken.sql` | `team_members` (allowlist) + `profiles`, `is_teamlid()` in **alle** policies (ook facturen en Storage), `create_invoice`/`update_invoice` alleen nog voor de service-role, `projects`, `task_assignees`, `task_subtasks`, `event_attendees`, `user_mailboxes`; zaait het lidmaatschap van de oudste bestaande gebruiker (Daniel, eigenaar); andere bestaande accounts worden niet automatisch lid |
| `0022_team_crm.sql` | team van twee: `profiles.welkom_klaar_op` (welkomstflow), taken/afspraken alleen leesbaar voor betrokkenen (`taak_zichtbaar()`), klanten (`email`, `telefoon`, `status`, `client_notes`), projecten (status gepland/bezig/afgerond, `deadline`, `project_eigenaren`), tellers in één query (`taak_tellingen`, `project_taak_tellingen`) en indexen. Alleen toevoegend; de facturen werken ongewijzigd |
| `0024_drive.sql` | Google Drive (module Bestanden): `drive_koppeling` (één rij: Google-account, versleuteld refresh token, rootmap; RLS aan, **geen policies en geen rechten** voor `anon`/`authenticated`, alleen de server), `drive_mappen` (cache van map-id's; teamleden lezen, alleen de server schrijft), `drive_bestanden` (wie wat uploadde; teamleden), `drive_kopieen` (welke factuur/prijsopgave/bonnetje al in Drive staat; teamleden lezen, alleen de server schrijft). Alleen nieuwe tabellen |
| `0025_crm_opvolging.sql` | opvolgen: `clients.volgende_stap` (max. 200 tekens) en `clients.opvolgen_op` (datum), `client_notes.soort` (`notitie`/`status`, bestaande notities worden `notitie`) en index `clients_opvolgen_idx`. Alleen kolommen; RLS en facturen ongewijzigd. De app werkt ook vóór 0025 (opvolgen verborgen) |
| `0023_projectstatus.sql` | projectenbord: status `voorbereiding`/`bezig`/`wachten`/`afgerond` (`gepland` → `voorbereiding`, standaard `voorbereiding`), kolom `status_sinds` met trigger (zet "nu" bij elke statuswijziging; bestaande projecten krijgen hun laatste wijziging), indexen op status + status_sinds en deadline. RLS ongewijzigd |

**Uitvoeren:** Supabase-dashboard → je project → **SQL Editor** → *New query* → plak het hele
bestand → **Run**. Onderaan verschijnt een controletabel; elke regel moet `ok` tonen.
Daaronder staan het aantal actieve teamleden en wie er toegang heeft
(`teamlid: Naam <adres> (rol)`): controleer dat lijstje. Bestaande accounts die niet
automatisch lid zijn geworden, staan als *NOTICE* in de uitvoer.

De controletabel van 0021 test onder meer:

- alle nieuwe tabellen en `is_teamlid()`/`taak_aanmaken()` bestaan en RLS staat op **elke**
  tabel in `public` aan;
- er is minstens één actief teamlid en één eigenaar, en elke taak heeft een toegewezene;
- **geen enkele policy** (tabellen én Storage) gebruikt nog `auth.uid() is not null`, en
  elke policy vraagt om teamlidmaatschap (`is_teamlid`, `taak_betrokken` of `afspraak_betrokken`);
- de Storage-policies voor `invoices` en `social-assets` vragen om teamlidmaatschap en
  **geen enkele bucket is openbaar**;
- `create_invoice`, `update_invoice` en `social_restore_latest` zijn niet uit te voeren door
  `anon`/`authenticated`, `anon` leest geen facturen en `user_mailboxes` heeft geen policies.

Toont een regel `ONTBREEKT`? Dan is er iets mis (bijvoorbeeld een later met de hand
toegevoegde policy of een bucket die op "public" is gezet). Alles draait in één transactie,
dus er is dan niets half doorgevoerd aan de migratie zelf; zoek de oorzaak en voer opnieuw uit.

- Het bestand is **veilig om nogmaals uit te voeren** (`if not exists`, `drop policy if exists`,
  `on conflict do nothing`): bestaande posts, taken en een aangepaste huisstijl blijven staan.
  `node scripts/test-rls.mjs` draait alle migraties op een lokale Postgres in het geheugen
  (PGlite, met nagebootste `auth`/`storage`-schema's en de Supabase-rollen), voert de drie
  SQL-bestanden meermaals uit en test daarna per tabel en per bucket wie wat mag (zie
  "Controleren"). Het echte Supabase-project blijft daarbij onaangeroerd.
- Van de facturen-tabellen (0001–0013) veranderen alleen de toegangsregels (0021): lezen
  alleen voor teamleden, en "aangemaakt door" wordt leeg als een oud-teamlid wordt verwijderd.
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
| `NEXT_PUBLIC_SITE_URL` | aanbevolen | Publieke adres van de backoffice (bv. `https://backoffice.studio-levant.nl`). Basis voor links in herstel- en uitnodigingsmails; zonder deze waarde alleen de Vercel-productie-URL of localhost |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ja | Publieke anon-key (login in de browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | ja | Geheime service-role key, alleen op de server |
| `ANTHROPIC_API_KEY` | voor social en uitgaven | Anthropic-key voor het genereren van social posts en het uitlezen van bonnetjes (zonder key: uitgaven handmatig invullen) |
| `MAIL_ENCRYPTION_KEY` | voor eigen mailboxen | 32 bytes, base64 (`openssl rand -base64 32`). Versleutelt de mailbox-wachtwoorden die teamleden via `/account` koppelen (AES-256-GCM). Geheim; niet wijzigen zonder dat iedereen opnieuw koppelt (zie "Mail per gebruiker") |
| `MAIL_USER`, `MAIL_PASSWORD` | nee | Standaard-mailbox van Daniel (zie "Mail koppelen"). Voor precies één account: hetzelfde adres als `MAIL_USER`, anders `MAIL_ENV_USER_ID`, anders de oudste eigenaar; alleen zolang die geen eigen mailbox heeft gekoppeld |
| `MAIL_ENV_USER_ID` | nee | User-id (uuid) van het account dat de standaard-mailbox krijgt, als dat niet het account met het adres uit `MAIL_USER` is. Leeg = de oudste actieve eigenaar |
| `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | nee | Standaard `mail.privateemail.com`, 993 en 465 |
| `MAIL_FROM_NAME`, `MAIL_HANDTEKENING` | nee | Afzendernaam (standaard "Studio Levant") en handtekening (`\n` = nieuwe regel) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | voor Bestanden | OAuth-client (type "Web application") uit Google Cloud Console, voor de koppeling met de Google Drive van Studio Levant (zie "Google Drive"). Het secret is geheim |
| `DRIVE_ENCRYPTION_KEY` | nee | Eigen sleutel (32 bytes, base64) voor het Drive-refresh token. Leeg = `MAIL_ENCRYPTION_KEY` wordt gebruikt. Wijzigen = Drive opnieuw koppelen |
| `CHROME_PATH` | nee, alleen lokaal | Eigen Chrome/Chromium voor social-exports tijdens `npm run dev` |

Na het wijzigen van een variabele in Vercel: opnieuw deployen (Deployments → … → Redeploy),
anders gebruikt de site nog de oude waarden. De API-key kan niet in de social-tool zelf
worden ingevuld; de instellingen-dialoog laat alleen zien of er een key op de server staat.

## Team & toegang

De backoffice is van en voor het team. **Alleen actieve teamleden** zien iets: facturen,
klanten, bonnetjes, social, agenda — alles. Er is geen registratie in de app; accounts
komen er alleen bij via een script met de service-role key ("aan de achterkant").

**Hoe het werkt**

- `team_members` (migratie 0021) is de allowlist; `is_teamlid()` staat in **elke** policy
  (tabellen en Storage). Een account dat niet (meer) actief lid is, ziet via de database
  niets, ook niet met de anon key en een geldige sessie. De anonieme rol (alleen de anon
  key) heeft in `public` helemaal geen rechten meer.
- In de app gaat alles langs één helper, `lib/auth/team.ts`: `vereisTeamlidPagina()` voor
  pagina's, `teamlidRoute()`/`controleerRoute()` voor API's (401 zonder sessie, 403 zonder
  lidmaatschap, 403 bij een wijzigend verzoek van een ander domein) en `vereisTeamlid()` voor
  server actions. De service-role client (`createServiceRoleClient(bewijs)`) vraagt het bewijs
  van die controle: code die hem zonder controle gebruikt, compileert niet.
- `proxy.ts` controleert het toegangstoken (`getClaims()`) en logt bij het openen van een
  pagina een ingelogd account zonder lidmaatschap direct uit en stuurt het naar
  `/geen-toegang`. API's, `/social-files` en de RSC-verzoeken van de router slaan die extra
  lidcheck in de proxy over: ze doen zelf altijd de volledige controle (403/`/geen-toegang`,
  fail closed). Ook inloggen en `/auth/callback` controleren het lidmaatschap.
- Gedeelde bedrijfsdata (facturen, prijsopgaven, klanten, bonnetjes, social, projecten) ziet
  iedereen in het team. Taken en afspraken zijn persoonlijk (0022): je leest alleen wat je
  maakte, wat voor jou is, of (taken) wat bij een project hoort; **wijzigen** kan alleen de
  maker of een toegewezene/deelnemer (RLS). Mail is persoonlijk:
  ieder ziet alleen zijn eigen mailbox. Wachtwoorden van gekoppelde mailboxen staan
  versleuteld in `user_mailboxes` (geen policies; alleen de server leest ze).
- **Overgangsmodus:** zolang 0021 niet is uitgevoerd, werkt de app zoals voorheen (elk
  ingelogd account) en toont de shell een rode banner. Voer 0021 dus zo snel mogelijk uit.

**Rollen**

| Rol | Wat |
|---|---|
| `eigenaar` | Wat een lid mag; de laatste actieve eigenaar kan niet worden gedeactiveerd. Bij het uitvoeren van 0021 wordt de oudste bestaande gebruiker (Daniel) eigenaar. De standaard-mailbox (`MAIL_USER`/`MAIL_PASSWORD`) is van **één** account: hetzelfde adres als `MAIL_USER`, anders `MAIL_ENV_USER_ID`, anders de **oudste** eigenaar. Een tweede eigenaar (bv. de compagnon) krijgt hem niet. |
| `lid` | Ziet en maakt alle gedeelde bedrijfsdata; eigen taken, agenda en mailbox. |

Rechten op data zijn verder gelijk: facturen en prijsopgaven maakt iedereen in het team via
de app. Teamleden beheren (toevoegen, rol, deactiveren) gaat **alleen** met de scripts
hieronder; in de app en via de database-API kan niemand zijn eigen lidmaatschap of rol
veranderen.

**Supabase-instellingen (eenmalig, in het dashboard)**

1. *Authentication → Sign In / Providers → Email*: **"Allow new users to sign up" UIT**,
   **"Confirm email" AAN**. *Anonymous sign-ins*: **UIT**. (Uitnodigen werkt ook met
   aanmelden uit: dat gaat via de service-role.)
2. *Authentication → URL Configuration*: **Site URL** = het productiedomein (bv.
   `https://backoffice.studio-levant.nl`). **Redirect URLs**: alleen
   `https://backoffice.studio-levant.nl/**` en `http://localhost:3000/**` — geen
   `*.vercel.app`-wildcard.
3. *Authentication → Emails → "Invite user"*: zet de link op
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/nieuw-wachtwoord`
   (en "Reset password" op `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/nieuw-wachtwoord`
   als die nog de standaardlink gebruikt). Zo opent de link de sessie op de server en kiest
   het nieuwe lid meteen een wachtwoord.

**Teamlid toevoegen** (de compagnon, of iemand opnieuw toegang geven):

```bash
node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email mark@studio-levant.nl --naam "Mark" --dry-run
node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email mark@studio-levant.nl --naam "Mark"
```

Nodigt het account uit (als het nog niet bestaat) en zet profiel (naam, initialen, kleur) en
een actief lidmaatschap. Een oud-teamlid (gedeactiveerd) krijgt zijn toegang terug (blokkade
opgeheven). Een **bestaand account dat nooit lid was** wordt niet vertrouwd (iemand anders kan
het met een eigen wachtwoord hebben aangemaakt): het script verwijdert het, met zijn sessies,
en stuurt een nieuwe uitnodiging. Heb je het account zelf aangemaakt, gebruik dan
`--bestaand-account-vertrouwen`. `--dry-run` toont van een gevonden account wanneer het is
aangemaakt, bevestigd en laatst ingelogd. Opties: `--initialen`, `--kleur #rrggbb`,
`--rol lid|eigenaar` (eigenaar geeft géén toegang tot de standaard-mailbox), `--site https://…`,
`--bestaand-account-vertrouwen`, `--dry-run`, `--help`.

**Eerste login: de welkomstflow** (migratie `0022_team_crm.sql`). Na het kiezen van een
wachtwoord komt een nieuw teamlid op `/welkom`: 1. naam, initialen en kleur bevestigen (al
ingevuld door het script), 2. inbox koppelen met alleen e-mailadres + wachtwoord (*Later doen*
kan), 3. klaar. Daarna verschijnt de flow nooit meer (`profiles.welkom_klaar_op`). Bestaande
eigenaren slaan hem over; zolang 0022 niet is uitgevoerd slaat iedereen hem over. Facturen,
prijsopgaven, klanten, bonnetjes en social posts zijn al gedeeld; daarvoor hoeft niemand iets
in te stellen.

### Bram toevoegen in 3 stappen

1. **Eenmalig klaarzetten** (als dat nog niet gedaan is): in Supabase `supabase/UITVOEREN_0022.sql`
   uitvoeren (onderaan alles `ok`) en bij *Authentication → Emails → "Invite user"* de link op
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/nieuw-wachtwoord`
   zetten. Zonder die link komt Bram uit op "link verlopen".
2. **Uitnodigen** (aan de achterkant, eerst met `--dry-run` kijken wat er gebeurt):

   ```bash
   node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email bram@studio-levant.nl --naam "Bram" --dry-run
   node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email bram@studio-levant.nl --naam "Bram"
   ```

   Optioneel `--kleur #rrggbb` en `--initialen`. Als mede-oprichter kan hij `--rol eigenaar`
   krijgen (de standaard-mailbox uit de env blijft dan van Daniel); `lid` is ook prima.
3. **Bram opent de mail**, kiest een wachtwoord en komt op `/welkom`: naam bevestigen, inbox
   koppelen met alleen `bram@studio-levant.nl` + het wachtwoord van zijn mailbox (servers
   gaan vanzelf), klaar. Facturen, prijsopgaven, klanten, projecten, bonnetjes en social
   posts staan er meteen; taken die Daniel voor hem maakt staan in zijn dashboard, takenlijst
   en agenda.

**Teamlid de toegang ontnemen:**

```bash
node --env-file=.env.local scripts/teamlid-verwijderen.mjs --email mark@studio-levant.nl            # deactiveren
node --env-file=.env.local scripts/teamlid-verwijderen.mjs --email mark@studio-levant.nl --definitief --ja
```

Deactiveren zet het lidmaatschap uit (database en app sluiten hem direct buiten), blokkeert
het account (ook verversen van de sessie lukt niet meer) en ontkoppelt zijn mailbox.
`--definitief --ja` verwijdert daarna ook het account; "aangemaakt door" wordt dan leeg.
De laatste actieve eigenaar kan niet worden gedeactiveerd.

De scripts lezen de sleutels alleen uit de procesomgeving (`--env-file`), lezen zelf geen
`.env`-bestanden en printen nooit een sleutel.

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
- **Breedte van de inhoud** (onderaan `app/(app)/app.css`): werkpagina's met veel kolommen
  (mail, agenda, projectenbord) vullen de volle breedte naast de rail; overzichtspagina's
  staan gecentreerd met gelijke marges: dashboard, bonnetjes en bestanden max. 1440 px,
  klant-/projectpagina, klantenlijst en boekhouding-overzicht 1280 px, account 940 px
  (formulieren), facturen hun eigen 980 px (`.wrap`, ongewijzigd). De kop (`sl-kop`) en de
  subnavigatie lopen over de hele breedte maar hun inhoud lijnt uit met de container
  (`--sl-inhoud`, `--sl-gutter`: 40 px, 16 px op ≤ 760 px). Per pagina gekozen met
  `.sl-main:has(<container>)`, zonder pagina-componenten aan te passen.

## Dashboard

`app/(app)/page.tsx`: elk teamlid heeft een eigen dashboard. Kop met dag, weeknummer en
begroeting met je eigen voornaam; snelle acties (+ Taak opent de taak-popup, sneltoets `n`;
Nieuwe factuur, Nieuwe prijsopgave, + Bonnetje, Nieuwe post, Nieuwe mail).

- **Alleen van jou:** Vandaag, Deze week en Taken tonen alleen taken die aan jou zijn
  toegewezen en afspraken waar jij bij hoort; de Inbox is je eigen mailbox. Taken die je voor
  een ander maakte staan er niet; onder de takenkaart staat alleen "N uitgezet bij anderen →"
  (naar de tab Uitgezet).
- **Gedeeld met het team:** Facturen, Laatste bonnetjes en Recente posts, met een avatar van
  wie ze maakte/uploadde.
- Het dashboard ververst je planning elke 2 minuten met één verzoek (`GET /api/dashboard`) en
  als je terugkomt naar het venster ook de gedeelde widgets, zodat werk van je compagnon
  vanzelf verschijnt. De mailcheck staat in een eigen laadblok: de rest van het dashboard
  wacht er niet op.

Elke widget laadt los (eigen laad-, leeg- en foutstaat), zodat één
trage of nog niet ingerichte bron de rest niet blokkeert. De facturen-widget is alleen-lezen
en rekent met dezelfde regels als het facturenoverzicht (omzet excl. btw per jaar; open =
aanbetaling zonder restfactuur).

## Snelheid

Twee dagelijkse gebruikers, dus vooral: weinig rondgangen per klik.

- **Per verzoek één teamcheck.** `proxy.ts` controleert het token alleen lokaal (`getClaims()`;
  zonder asymmetrische JWT-sleutel in Supabase doet Supabase dat zelf bij de Auth-server) en
  doet de lidcheck alleen bij het openen van een pagina; API's en de router-verzoeken
  controleren zelf. `lib/auth/team.ts` houdt `getUser()` (uitloggen werkt meteen, ook voor
  mail) maar vraagt die tegelijk met de lidmaatschappen en profielen van het team op: één
  ronde. De shell (avatars, kiezers) vraagt daarna niets meer.
  Rondgangen na elkaar per verzoek (auth- of databasevraag die op een vorige wacht):
  pagina openen van 5 naar 3 (proxy: token + lidcheck; pagina: één parallelle ronde),
  navigeren binnen de app en API-verzoeken van 4 naar 1–2. In aantallen: van 2 auth + 5
  database naar 1–2 auth + 3 database per pagina, en van 2 auth + 3 database naar 1–2 auth
  + 2 database per API-verzoek.
- **Dashboard:** de mailcheck staat in Suspense (en is 30 s per gebruiker gecachet; koppelen
  of ontkoppelen wist de cache); de planning komt uit 3 queries (waren 5) en ververst met
  één verzoek (waren 4) en zonder volledige `router.refresh()` elke 2 minuten.
- **Tellers** van de takenlijst in één query (`taak_tellingen`, waren 5) en de voortgang van
  projecten met een `group by` (`project_taak_tellingen`). Vóór 0022 valt de app terug op
  de oude losse queries.
- **Rail-badge:** zonder gekoppelde mailbox vraagt de rail de mailstatus nog maar eens per
  kwartier op.
- **Indexen** (0022): taken op datum (ook afgerond), op maker, op klant; afspraken op klant
  en maker; klanten en projecten op status; notities per klant; projecteigenaren per persoon.

## Agenda & taken

- `supabase/migrations/0018_agenda_taken.sql`: tabellen `tasks` en `calendar_events`
  (idempotent, met RLS en `set_updated_at`-trigger). Tot deze migratie is uitgevoerd tonen
  de agenda en de dashboard-widgets een nette melding "nog niet ingericht".
- **Taken op naam** (migratie 0021): een taak is voor één of meer teamleden
  (`task_assignees`), heeft optioneel een klant en/of project (`projects`) en afvinkbare
  subtaken (`task_subtasks`, max. 50). Een taak voor Daniel staat alleen in Daniels lijsten
  en op zijn dashboard; een taak voor meerdere mensen bij ieder van hen. Afronden is gedeeld:
  één persoon rondt hem voor iedereen af ("afgerond door …").
- **De taak-popup** (`components/taken/TaakDialoog.tsx`), via **+ Taak** of `n` op dashboard,
  agenda en projecten: omschrijving (+ toelichting), voor wie (standaard jijzelf,
  "Iedereen"), deadline (datum + optionele tijd/duur, snelknoppen), urgentie (Laag/Normaal/
  Hoog, `alt+1/2/3`), klant, project ("+ Nieuw project ‘X’" maakt het direct aan; een project
  bij een klant vult de klant in) en subtaken. `Enter` of `⌘/Ctrl+Enter` slaat op,
  `⇧⌘Enter` = opslaan en nog een (voor wie/klant/project blijven staan), `Esc` vraagt of
  wijzigingen weg mogen. Herkent de omschrijving een datum/tijd/urgentie/`@klant` (zoals de
  oude snelinvoer, `lib/agenda/snelinvoer.ts`), dan kun je die met één klik toepassen. Een
  bestaande taak opent in dezelfde popup (afronden, subtaken direct afvinken, verwijderen,
  "aangemaakt door").
- **Wie ziet welke taak** (migratie 0022, stap 2): "mijn taak" = ik sta erop (voor wie).
  Maakt Daniel een taak voor alleen Bram, dan staat die bij Bram op het dashboard, in zijn
  takenlijst en in zijn agenda — en bij Daniel nergens, behalve onder de tab **Uitgezet** in
  de takenlijst (`/agenda?lijst=uitgezet`: open taken per persoon, verlopen deadline in rood,
  plus wat de laatste 14 dagen is afgerond, "afgerond door Bram"). Een taak voor meerdere
  mensen staat bij ieder van hen en niet onder Uitgezet. Taken die iemand anders voor jou
  maakte hebben het label "van Daniel". Er is geen teamweergave ("Heel team" is weg; een
  oude link met `?wie=` gaat naar de gewone agenda).
- **De database dwingt dit af** (RLS 0022): een taak lezen mag alleen de maker, wie hem
  gekregen heeft, of — bij een taak in een project — het hele team (voortgang op de
  projectpagina; zo'n taak staat nooit in iemands eigen lijst). Een losse taak die Bram voor
  zichzelf maakt bestaat voor Daniel dus niet, ook niet via de API. Afspraken: alleen de
  maker en de deelnemers. Wijzigen, afvinken en verwijderen kan de maker of iemand voor wie
  het is (`taak_betrokken`/`afspraak_betrokken`; de API geeft anders 403). Toewijzen kan
  alleen aan actieve teamleden. Geef je in de popup een taak helemaal aan een ander, dan
  verdwijnt hij uit jouw lijsten ("Taak overgedragen"). Alle verzamelbestanden
  (`UITVOEREN_*.sql`) eindigen met 0022, dus opnieuw uitvoeren zet de open leesregels van
  0021 niet terug.
- **Agenda:** alleen jouw taken met een datum en de afspraken waar jij bij hoort.
  **+ Afspraak** (of `a`) opent het
  afsprakenpaneel met "Wie" (deelnemers, standaard jij). Klik op een leeg vak: kies
  afspraak of taak op die dag/tijd.
- **Projecten** staan onder **Klanten & projecten** (`/projecten`, zie hieronder);
  `/agenda/projecten` stuurt daarheen door. In de agenda filtert `?project=<id>` je eigen
  takenlijst op een project.
- Zolang 0021 niet is uitgevoerd werkt de agenda zoals voorheen (alle taken van iedereen,
  zonder toewijzing, subtaken of projecten).
- Tests: `node scripts/test-taken.mjs` (toewijzing, subtaken, projecten, rechten) en
  `node scripts/test-snelinvoer.mjs` (herkenning, ook zomer-/wintertijd rond 25 okt 2026).

## Klanten & projecten

Eén tab in de rail (**Klanten**), met bovenin de schakelaar **Klanten | Projecten**. Een
project hangt aan een klant, dus ze staan bij elkaar; de rail blijft op zes items. Alles
hier is gedeeld met het team (RLS `is_teamlid()`), behalve losse taken: op de klant- en
projectpagina zie je de taken die jij mag zien (projecttaken ziet het hele team, een losse
taak alleen de maker en wie hem kreeg). Bewust simpel: geen pipeline, geen uren, geen
tientallen velden.

- **Klanten** (`/klanten`): drie tabs **Leads · Actief · Afgerond** met tellers (de tab Leads
  toont ook hoeveel er vandaag of te laat op te volgen zijn). Zoeken (`/`) telt over alle tabs:
  vind je niets in de huidige tab, dan wijst de lege staat naar de tab waar het wél staat
  (afgeronde klanten blijven dus altijd vindbaar). Sorteren: Leads op opvolgdatum (te laat
  bovenaan), Actief op laatst actief, verder op naam of omzet. **Snel toevoegen**: één veld
  bovenaan, naam + Enter (`n` of **+ Klant** zet de cursor erin; `/klanten?nieuw=1` ook);
  in de tab Actief wordt het een actieve klant, anders een lead; details vul je later aan.
  `?tab=leads|actief|afgerond` kiest de tab (anders de laatst gekozen tab, onthouden).
  - *Leads*: per lead een rustige rij met contact, **volgende stap** en **opvolgen op**
    (direct bewerkbaar; rood = te laat, zand = vandaag, oker = binnen 7 dagen) en
    **Gewonnen** (→ Actief, met de optie meteen een project aan te maken) of **Afgewezen**
    (→ Afgerond, met "Ongedaan maken").
  - *Actief/Afgerond*: een tabel met klant + contact, lopende projecten (aantal + de
    belangrijkste status: wachten > bezig > voorbereiding), omzet excl. btw (alleen gelezen
    uit de facturen; "1 open" = aanbetaling zonder restfactuur), laatste contact (laatste
    notitie) en opvolgen. Op een telefoon gestapelde rijen.
- **Klantpagina** (`/klanten/<id>`): de naam is de titel (klik om te hernoemen), met in de kop
  **Mailen** (eigen mail-module) en **Bellen** (`tel:`) en de status Lead · Actief · Afgerond.
  Een lead krijgt bovenaan een blok **Lead opvolgen** (volgende stap, datum met snelknoppen
  Morgen / Over een week / Over 2 weken, Gewonnen / Afgewezen); een actieve klant heeft
  dezelfde velden opzij onder **Opvolgen**. Kerncijfers: omzet excl. btw (totaal en dit jaar),
  facturen, open aanbetalingen (bedrag) en lopende projecten (bij een lead zonder facturen of
  projecten weggelaten). Daaronder projecten (status, deadline, voortgang, eigenaren),
  open taken en de **tijdlijn**: notities (Enter = opslaan), statuswijzigingen ("Lead →
  Actief", automatisch na 0025), facturen en wanneer de klant is aangemaakt. Opzij: contact
  (elk veld inline te bewerken: potlood of "+ Telefoonnummer"), facturen & prijsopgaven
  (laatste 5, links naar Boekhouding) en bestanden. Is de klant afgerond, dan staat bovenaan
  een rustige melding met **+ Nieuw project** (zet de klant weer op Actief). Prijsopgaven
  hebben geen klantkoppeling (0011); ze worden op klantnaam gevonden. Een klant verwijderen
  kan alleen in Facturen (met de bestaande controle).
- **Projecten** (`/projecten`): een **bord** met vier kolommen (Voorbereiding, Bezig, Wachten
  op goedkeuring, Afgerond; per kolom een kleurstip, het aantal en "x te laat") of een
  **lijst**, gegroepeerd op status (wachten eerst) of op klant (schakelaar Bord | Lijst en de
  groepering worden onthouden). Filters: **Iedereen | Mijn projecten** (eigenaar = jij,
  onthouden), klant, en zoeken (`/`). Rustige kaarten: naam, klant, deadline-badge (rood = te
  laat, oker = binnen 7 dagen; zonder deadline niets), voortgang en eigenaren; "34 dagen stil"
  verschijnt pas na 14 dagen in dezelfde status. Status wijzigen: kaart slepen, de statuskeuze
  (verschijnt bij aanwijzen; op een telefoon altijd), of **Alt + ←/→** op een kaart.
  Afgerond toont standaard de laatste 30 dagen ("Toon alle …"). Op een telefoon scrolt het
  bord horizontaal, één kolom per keer. `?weergave=bord|lijst` kiest de weergave (het
  dashboard linkt zo naar een kolom, bv. `/projecten?weergave=bord#kolom-wachten`).
  **+ Project**: naam, klant, status (standaard Voorbereiding), deadline en eigenaar(s)
  (standaard jij). Ook vanuit de taak-popup kun je een project maken.
- **Projectpagina** (`/projecten/<id>`): de naam is de titel (klik om te hernoemen), met de
  klant erboven als link; een stappenbalk Voorbereiding → Bezig → Wachten op goedkeuring →
  Afgerond (één klik, direct opgeslagen) met "Bezig sinds 12 okt (11 dagen)"; op één regel
  klant, deadline (met badge), voortgang en eigenaren, allemaal direct bewerkbaar; alle taken
  (afgeronde ingeklapt) met **+ Taak** (project al ingevuld, "voor wie" standaard jij); één
  notitieveld dat vanzelf opslaat; bestanden.
- **Statuskleuren** zijn overal gelijk (klanten.css): blauw = nog niet begonnen (lead,
  voorbereiding), groen = loopt (actief, bezig), oker = wacht op een ander, grijs = klaar;
  rood is alleen voor te laat. Er staat altijd een label bij de kleur.
- **Migratie 0025** (`supabase/UITVOEREN_0025.sql`, alleen kolommen): volgende stap,
  opvolgdatum en de soort van een klantnotitie. **Werkt ook vóór 0025**: de queries vallen
  terug op de kolommen van 0022, "volgende stap" en "opvolgen op" zijn dan verborgen (op de
  klantpagina van een lead staat een korte uitleg), statuswijzigingen komen niet in de
  tijdlijn en de dashboardkaart "Opvolgen" verschijnt niet; de API geeft bij opslaan een nette
  503 `kolom_ontbreekt`.
- **Migratie 0022** (stap 3, alleen toevoegend): `clients.email`, `clients.telefoon`,
  `clients.status` (standaard `actief`), tabel `client_notes`, `projects.deadline`, langere
  `projects.notitie` (5000), status `gepland`/`bezig`/`afgerond` (oude waarden worden
  omgezet: `actief` → `bezig`, `gearchiveerd` → `afgerond`) en tabel `project_eigenaren`
  (bestaande projecten krijgen hun maker als eigenaar). Zolang 0022 niet is uitgevoerd
  tonen `/klanten` en `/projecten` "nog niet ingericht"; de taak-popup en de facturen
  werken gewoon.
- **Dashboard**: kaart **Opvolgen** (alleen als er iets is: leads en klanten met een
  opvolgdatum van vandaag of eerder, max. 5, met de volgende stap) en kaart **Projecten** met tellers Voorbereiding · Bezig · Wachten · Afgerond
  (laatste 30 dagen) en hoeveel lopende projecten over de deadline zijn; elke teller opent die
  kolom op het bord.
- **Migratie 0023** (`supabase/UITVOEREN_0023.sql`): zie de tabel bij "Database inrichten".
  **Werkt ook vóór 0023**: de app leest 'gepland' als Voorbereiding en schrijft dan 'gepland'
  zodra de database 'voorbereiding' weigert; "Wachten op goedkeuring" geeft vóór 0023 een
  nette melding; "x dagen in deze status" en het 30-dagenfilter verschijnen pas na 0023
  (tot dan staan alle afgeronde projecten in de kolom).
- Tests: `node scripts/test-crm.mjs` (invoer, projectstatus- en opvolghulpjes, terugval vóór
  0025 en bronbewaking) en `node scripts/test-rls.mjs` (RLS van notities en eigenaren,
  omzetting van de status in 0022 en 0023, de status_sinds-trigger, 0025 en opnieuw uitvoeren).

## Boekhouding

De tab **Boekhouding** in de rail (`/boekhouding`) is het keuzescherm met twee tegels, en
daaronder staat op elk scherm de subnavigatie **Overzicht · Facturen · Bonnetjes &
inkoopfacturen**. De tab is ook actief op `/facturen/…` en (via een redirect) `/uitgaven`.

- **Facturen** (`/facturen/…`): de facturentool, inhoudelijk ongewijzigd (zie "Facturen").
  Alleen de kop is nu die van Boekhouding. Op het keuzescherm: omzet en aantal facturen van
  dit jaar, open aanbetalingen, de laatste drie facturen (met wie ze maakte) en de knoppen
  *Nieuwe factuur* en *Nieuwe prijsopgave*.
- **Bonnetjes & inkoopfacturen** (`/boekhouding/bonnetjes`, voorheen `/uitgaven`): uploaden
  en terugvinden, zie hieronder. Op het keuzescherm: *Bonnetje uploaden* en de laatste vier
  uploads met wie ze uploadde.

Alles in Boekhouding is gedeeld met het hele team: wat de één maakt of uploadt, ziet de ander
meteen (na verversen; de pagina ververst ook vanzelf als je terugkomt).

### Bonnetjes & inkoopfacturen

Uploaden en makkelijk terugvinden staat voorop; het is geen boekhoudpakket. **Leverancier,
datum en bedrag** zijn de drie vaste gegevens: Claude leest ze uit en vult ze in. Lukt dat
niet, dan vraagt de app je ze zelf in te vullen; de overige velden zijn optioneel. Op het dashboard: de knop **+ Bonnetje** en de kaart *Laatste
bonnetjes*; in mail: **Bij bonnetjes** naast een PDF- of fotobijlage.

- **Uploaden.** Sleep foto's/PDF's op de pagina, kies ze met **Kies bestanden** (sneltoets
  `n`), maak op de telefoon een **Foto maken** (camera), of plak een screenshot met `⌘V`.
  Meerdere tegelijk kan; elk bestand wordt een eigen upload en verschijnt meteen (met
  "Wordt uitgelezen…"). Een PDF krijgt de soort *inkoopfactuur*, een foto *bonnetje* (aan te
  passen). Foto's worden in de browser rechtop gezet (EXIF) en verkleind (max. 2400 px,
  een lange smalle bon tot 4000 px; JPEG). Uploads gaan via een signed upload-URL direct naar
  de privé-bucket `uitgaven` (buiten de 4,5 MB-limiet van Vercel om; max. 25 MB per bestand).
- **HEIC (iPhone-foto's).** Safari leest HEIC zelf; in Chrome/Firefox/Edge zet de browser de
  foto eerst om met `libheif-js` (wasm, pas geladen als het nodig is, "Foto omzetten…").
  Lukt dat niet, dan gaat het origineel en zet de server hem bij het uitlezen om
  (`lib/uitgaven/beeld.ts`, ook voor HEIC-bijlagen uit mail): de JPEG vervangt het origineel
  in de opslag, zodat elke browser hem toont. Onleesbaar bestand: een melding in gewone taal.
- **Automatisch uitlezen** (`lib/uitgaven/claude.ts`, model `claude-haiku-5-5`, gestructureerde
  JSON-uitvoer; blijft leverancier, datum of totaal leeg of onzeker, dan één tweede poging met
  `claude-sonnet-5-5`, zelfde schema; logregels `[uitgaven]` zeggen welk model wat vond, zonder
  bedragen). De leverancier wordt ook aan logo/huisstijl en bekende ketens herkend, het totaal
  is de regel Totaal/Te betalen/PIN (niet subtotaal of wisselgeld), datums in NL-notatie
  (24-10-26, 24 okt 2026). Een lange smalle bon gaat als geheel plus twee vergrote helften
  naar Claude. Velden: leverancier, datum, bedrag incl. btw, btw-bedrag (ook uit de
  btw-specificatie per tarief) en -tarief, valuta,
  factuurnummer, korte omschrijving, categorie en (als zichtbaar) betaalwijze. Het vult
  alleen lege velden; automatisch ingevulde velden krijgen een zandkleurige stip tot je ze
  aanpast. Bij een bekende leverancier gaat de laatst gebruikte categorie/betaalwijze voor.
  Zonder `ANTHROPIC_API_KEY`, bij een onleesbaar bestand of bij een fout blijft het een
  concept dat je zelf invult.
- **Leverancier, datum, bedrag: ontbreekt of onzeker.** De prompt vraagt de datum in ISO
  (`JJJJ-MM-DD`), het bedrag als totaal incl. btw in euro en de bedrijfsnaam zoals op de bon
  zonder rechtsvorm ("Albert Heijn", niet "Albert Heijn B.V."; de app haalt restjes ook
  zelf weg), en expliciet `null` bij twijfel in plaats van gokken. Per veld geeft Claude
  `zeker`/`onzeker` terug (`zekerheid` in het schema). Wat dan:
  - **ontbreekt** (null): het veld krijgt een rode rand en de tekst "Kon de datum niet lezen —
    vul hem zelf in", de gegevens klappen open, het eerste ontbrekende veld krijgt de focus,
    en in de lijst staat het bonnetje als **Aanvullen** tot alle drie er zijn. De
    upload-melding (ook bij **Als uitgave** uit mail) zegt het meteen.
  - **onzeker**: het veld is wel ingevuld maar krijgt een okerkleurige rand, "Controleer
    dit" met een knop **Klopt**, en in de lijst **Controleren**. Aanpassen of *Klopt* haalt
    de markering weg. Een bedrag in een andere valuta dan EUR is altijd "onzeker"; een
    bekende leverancier (eerder gebruikte schrijfwijze) geldt als zeker.
  - Opslag zonder migratie: onzekere velden staan als `onzeker:<veld>` in `expenses.ai_fields`.
    "Aanvullen"/"Controleren" is afgeleid (`aandachtVoor()` in `lib/uitgaven/model.ts`),
    naast de bestaande status concept/verwerkt.
- **Terugvinden.** Eén groot zoekveld (`/`) zoekt in het hele archief: leverancier,
  omschrijving, notitie, factuurnummer en bestandsnaam; een bedrag (`12,50`, `12.5`, `€12`)
  vindt ook het totaalbedrag. Filters als chips: periode (alles, een jaar, daarna een maand),
  soort (bonnetjes/inkoopfacturen) en geüpload door (iedereen, ik, een teamlid). Weergave als
  **galerij** (thumbnails per maand, signed URL's van 10 minuten) of **lijst**; de keuze wordt
  per browser onthouden. Max. 200 resultaten per zoekopdracht, nieuwste eerst.
- **Bekijken.** Klik op een upload: groot voorbeeld (foto of PDF via een signed URL van 5
  minuten), downloaden, een pagina toevoegen, verwijderen (met bevestiging; haalt ook de
  bestanden uit de opslag) en "Geüpload door … · datum". **Gegevens (optioneel)** is
  ingeklapt: soort, leverancier, omschrijving, datum, factuurnummer, bedrag en btw, klant en
  notitie (`⌘ Enter` = opslaan, `Esc` = sluiten). De database-kolommen `status`, `category` en
  `payment_method` blijven bestaan maar staan niet meer in de schermen.
- **Meer ▾ → Btw-overzicht per kwartaal** (`?tab=btw`). Per kwartaal de voorbelasting (btw op uitgaven, verlegd telt als 0)
  tegenover de btw op verstuurde facturen (alleen gelezen uit `invoices`: `vat_amount` per
  factuurdatum; aanbetaling en restfactuur zijn elk een eigen factuur, verlegd = 0; omzet =
  `revenue_subtotal` zoals het facturenoverzicht), met een **indicatie** te betalen/terug te
  vragen, en uitgaven per categorie. Geen fiscaal advies.
- **Meer ▾ → Exporteren voor de boekhouder** (per maand, kwartaal of jaar):
  CSV (puntkomma, Nederlandse decimalen, opent in Excel) en een ZIP met alle bonnetjes als
  `JJJJ-MM-DD_leverancier_bedrag.ext` plus de CSV. De ZIP gaat via de bucket
  `uitgaven-export` en een signed URL (5 min); boven ±45 MB in delen.
- **Code:** `lib/uitgaven/` (model en pure functies, repo, opslag, Claude, btw, export,
  client), `app/api/uitgaven/**`, `components/uitgaven/`, `app/(app)/uitgaven.css`.
  Tests zonder database/netwerk: `node scripts/test-uitgaven.mjs`; één echte Claude-aanroep
  met een gegenereerd testbonnetje: `ANTHROPIC_API_KEY=… node scripts/test-uitgaven.mjs --claude`.
  HEIC en foto's: `node scripts/test-bonnetje-heic.mjs` maakt een realistische Action-kassabon
  (puppeteer, scheef gefotografeerd, via macOS `sips` naar HEIC) en test de omzetting op de
  server en in headless Chrome; met `--claude` ook échte uitleesacties (Sonnet en Opus).

## Google Drive (Bestanden)

Eén gratis Google-account van Studio Levant (15 GB) is de gezamenlijke bestandsopslag. De
eigenaar koppelt het **één keer**; daarna ziet en gebruikt iedereen in het team de bestanden
via het dashboard. Teamleden hebben zelf **geen** Google-account of -toegang nodig.

**Eenmalig in Google Cloud** (ingelogd met het Google-account van Studio Levant):

1. [console.cloud.google.com](https://console.cloud.google.com) → nieuw project, bv.
   "Studio Levant backoffice".
2. *APIs & Services → Library* → **Google Drive API** → *Enable*.
3. *APIs & Services → OAuth consent screen* (Google Auth Platform): type **External**,
   app-naam "Studio Levant backoffice", support-e-mail; bij *Audience* het Google-account
   van Studio Levant als **test user** toevoegen. Bij *Data access* de scope
   `https://www.googleapis.com/auth/drive` toevoegen.
   *Let op:* zolang de app in "Testing" staat, verloopt de toestemming na **7 dagen** (dan
   vraagt Bestanden om "Drive opnieuw koppelen"). Zet de app daarom op **In production**
   ("Publish app"); voor één eigen account is geen Google-verificatie nodig, je klikt bij het
   koppelen eenmalig door de melding "Google heeft deze app niet geverifieerd".
4. *APIs & Services → Credentials → Create credentials → OAuth client ID*, type
   **Web application**. *Authorized redirect URIs* (exact zo):
   - `http://localhost:3000/api/drive/callback` (lokaal)
   - `https://<jouw domein>/api/drive/callback` (bv.
     `https://backoffice.studio-levant.nl/api/drive/callback`; gelijk aan
     `NEXT_PUBLIC_SITE_URL` + `/api/drive/callback`)
5. Kopieer *Client ID* en *Client secret* naar `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET`
   in `.env.local` en in Vercel (Production en Preview), en deploy opnieuw.

**Sleutel.** Het refresh token wordt versleuteld opgeslagen (AES-256-GCM, dezelfde kluis als
de mailboxen, `lib/mail/kluis-kern.ts`, met een eigen AAD `drive-koppeling`). Standaard met
`MAIL_ENCRYPTION_KEY`; wil je de sleutels scheiden, zet dan `DRIVE_ENCRYPTION_KEY` (staat die
er, dan wordt alleen die gebruikt). Een andere sleutel = Drive opnieuw koppelen.

**Koppelen.** Voer eerst `supabase/UITVOEREN_0024.sql` uit. Ga als **eigenaar** naar
**Bestanden** → *Google Drive koppelen* → log in met het Google-account van Studio Levant →
geef toegang tot "alle bestanden in Google Drive". De volledige `drive`-scope is bewust: zo
zie je in het dashboard ook bestanden die iemand rechtstreeks in Drive zet. Terug in
Bestanden staat de map klaar. Onderaan Bestanden staan het gekoppelde account,
**Bestaande facturen, prijsopgaven en bonnetjes naar Drive kopiëren** (veilig om vaker te
gebruiken: wat er al staat wordt overgeslagen) en **Ontkoppelen** (trekt de toestemming in;
de bestanden in Drive blijven staan). Een lid ziet alleen uitleg, geen knoppen.

- Beveiliging: `state` is een willekeurige nonce die ook in een ondertekende (HMAC),
  httpOnly-cookie van 10 minuten staat, samen met het user-id en de redirect-URI
  (`lib/drive/state.ts`); de callback controleert die en of je eigenaar bent. Redirect-URI:
  `${NEXT_PUBLIC_SITE_URL of localhost}/api/drive/callback`.
- Het access token blijft in het geheugen van de server tot vlak voor het verlopen. Trekt
  iemand de toegang in (of verloopt die), dan toont Bestanden "Drive opnieuw koppelen".
- Alle Drive-aanroepen gaan rechtstreeks via `fetch` naar de Drive REST API v3
  (`lib/drive/kern.ts`), zonder extra dependency.

**Mappenstructuur** (wordt vanzelf aangemaakt; een map die al bestaat wordt hergebruikt):

```
Studio Levant/
  Boekhouding/
    Facturen/<jaar>/       automatisch: elke nieuwe of bijgewerkte factuur (PDF, naam = download)
    Prijsopgaven/<jaar>/   automatisch: elke prijsopgave
    Bonnetjes/<jaar>/      automatisch: elk bonnetje of inkoopfactuur, na het uitlezen ("JJJJ-MM-DD_leverancier_bedrag.ext")
  Klanten/
    <klantnaam>/           blok "Bestanden" op de klantpagina
      <projectnaam>/       blok "Bestanden" op de projectpagina (zonder klant: Klanten/Zonder klant/…)
  Algemeen/
```

- Map-id's staan in `drive_mappen`, per rootmap. Een klant of project hernoemen (of een
  project bij een andere klant zetten) hernoemt/verplaatst de map in Drive mee (na het
  opslaan, best effort; anders bij het volgende gebruik). De map van een klant/project
  ontstaat pas bij de eerste upload (of met "Map nu aanmaken").
- **Automatisch naar Drive:** na het aanmaken of bewerken van een factuur (ook een
  restfactuur) of prijsopgave, en na het uploaden van een bonnetje (ook "uit mail"), plant de
  route met `next/server` `after()` een kopie, **ná** het antwoord. De factuurflow wacht er
  nooit op en kan er niet door mislukken; zonder koppeling gebeurt er niets. De
  facturenlogica (`lib/invoice`) is niet aangepast. `drive_kopieen` onthoudt per bron welk
  PDF-pad er staat: een bewerkte factuur vervangt de inhoud van hetzelfde Drive-bestand.
  Naam in Drive: de naam van de download, met het factuur-/offertenummer ervoor als het er
  nog niet in staat (`2026-014 Website.pdf`); jaar = factuurdatum (Europe/Amsterdam). Lege
  `drive_mappen` (net gekoppeld) is geen probleem: Boekhouding/Facturen/<jaar> wordt bij de
  eerste kopie gezocht of aangemaakt en onthouden.
- **Controleren zonder factuur te maken:** Bestanden → **Test Drive-koppeling** (alleen de
  eigenaar, `POST /api/drive/diagnose`). Controleert de server-instellingen, de koppeling
  (token verversen, account, opslag), de hoofdmap en de vaste mappen
  (Boekhouding/Facturen|Prijsopgaven|Bonnetjes/<dit jaar>, Klanten, Algemeen; ontbrekende
  worden aangemaakt) en toont per stap OK of de fout met de oorzaak van Google, plus of de
  laatste factuur al in Drive staat. Er wordt niets geüpload.
- **Logs (Vercel → Logs, zoek op `[drive]`):** per kopie `[drive] kopie factuur <id>: gestart`
  en daarna `gekopieerd → Boekhouding/Facturen/2026/<naam>`, `overgeslagen, …` (niet
  gekoppeld) of `MISLUKT na … s, <code>: <melding> (<oorzaak van Google>)`. Een startregel
  zonder eindregel betekent dat de functie stopte (maxDuration 60 s van de factuurroutes,
  inclusief het maken van de PDF); na 40 s volgt een waarschuwing. Een verlopen toestemming
  (Google-app in "Testing": na 7 dagen `invalid_grant`) staat er als `opnieuw_koppelen`.
- Een bonnetje gaat naar Drive nadat het uitlezen klaar is, als
  `JJJJ-MM-DD_leverancier_bedrag.ext` in de map van het jaar van de bon (zoals de ZIP-export).
  Pas je daarna datum, leverancier of bedrag aan (of vul je ze zelf in), dan wordt het
  Drive-bestand hernoemd en zo nodig naar de juiste jaarmap verplaatst. Is er nog geen
  datum, dan de uploaddatum en de bestandsnaam. Een extra bestand bij een bestaande uitgave
  gaat meteen. Alles na het antwoord en best effort (`naDriveUitgave` in
  `lib/drive/kopieen.ts`).
- **Uploaden** gaat niet via de server (Vercel laat maximaal 4,5 MB per verzoek door): de
  server maakt bij Google een *resumable upload-sessie* voor precies dat ene bestand in die
  map, en de browser zet het bestand daar rechtstreeks neer (met voortgang). Daarna legt de
  server vast wie het uploadde (`drive_bestanden`: "door <naam>"). Max. 5 GB per bestand.
- **Bekijken en downloaden** gaat via een proxy-route met de teamcheck
  (`/api/drive/bestanden/<id>/inhoud`), zodat niemand een Google-account nodig heeft.
  Inline alleen afbeeldingen en PDF (Google Docs/Sheets/Slides als PDF); al het andere,
  ook SVG/HTML, als download. "Open in Google Drive" werkt alleen voor wie met het
  Google-account van Studio Levant is ingelogd.
- **Alleen binnen "Studio Levant":** elke route die een bestand- of map-id krijgt, loopt de
  parents-keten na tot de rootmap; iets daarbuiten bestaat voor het dashboard niet. Zoeken
  gebeurt met een Drive-zoekopdracht en toont alleen wat binnen de rootmap ligt. De vaste
  mappen (root, Boekhouding, …) kun je niet hernoemen of verwijderen; verwijderen gaat
  altijd naar de prullenbak van Drive (30 dagen terug te halen).
- **Vóór 0024 of zonder env-vars** tonen Bestanden en de blokken een nette melding (welke
  variabelen ontbreken, of welk SQL-bestand nog moet); facturen en bonnetjes werken gewoon.

## Back-ups en keep-alive (migratie 0026)

**Wat er automatisch gebeurt**
- **Keep-alive.** Elke nacht om 03:00 UTC roept Vercel Cron `/api/cron/dagelijks` aan. Die route schrijft eerst een kleine heartbeat-rij, zodat het gratis Supabase-project nooit pauzeert (dat gebeurt na 7 dagen zonder activiteit). Vóór migratie 0026 doet hij een kleine leesquery.
- **Tweede vangnet.** Een GitHub Actions-workflow (`.github/workflows/keepalive.yml`) roept dezelfde route elke 3 dagen aan.
- **Database-back-up.** Dezelfde nachtelijke taak maakt een volledige export van alle eigen tabellen, plus de gebruikers (zonder wachtwoorden) en een overzicht van de storage-bestanden. De export wordt met AES-256-GCM versleuteld (`BACKUP_ENCRYPTION_KEY`) en komt in Google Drive onder `Studio Levant/Back-ups/<jaar>/<datum>.slbak`. Was er de afgelopen 20 uur al een geslaagde back-up, dan wordt hij overgeslagen, dus GitHub en Vercel samen geven geen dubbele.
- **Bewaren.** 14 dagen elke dag, 8 weken elke week en 12 maanden elke maand. De nieuwste 3 blijven altijd staan; opgeruimde back-ups gaan naar de prullenbak van Drive.
- **Bestanden.** Facturen-PDF's, bonnetjes en social-assets gaan wekelijks via `/api/cron/bestanden` naar Drive (04:30 UTC). Alleen nieuwe en gewijzigde bestanden worden gekopieerd, elk apart versleuteld, naar `Studio Levant/Back-ups/Bestanden/<bucket>/`. Een ronde die niet in één keer af komt, gaat de volgende nacht verder.

**Status en knoppen.** Op `/beveiliging` › Back-ups (alleen de eigenaar, met 2FA-sessie) zie je:
- de laatste back-up, de laatste bestandensync en de laatste heartbeat;
- de laatste 20 runs;
- de knoppen "Nu back-up maken", "Bestanden nu bijwerken" en "Download (versleuteld)".

Is de laatste back-up mislukt, de laatste geslaagde ouder dan 2 dagen of de heartbeat ouder dan 3 dagen, dan ziet de eigenaar dat op het dashboard.

**Inrichten (eenmalig)**
1. Maak twee geheimen aan met `openssl rand -base64 32`. Zet ze in Vercel (Production) als `BACKUP_ENCRYPTION_KEY` en `CRON_SECRET`, en bewaar ze ook in je wachtwoordmanager. Zonder `BACKUP_ENCRYPTION_KEY` zijn de back-ups onbruikbaar.
2. Zet in GitHub (Settings › Secrets and variables › Actions) twee secrets:
   - `SL_CRON_URL`: `https://sl-dashboard-delta.vercel.app`
   - `SL_CRON_SECRET`: dezelfde waarde als `CRON_SECRET`
3. Deploy opnieuw en voer `supabase/UITVOEREN_0026.sql` uit.
4. Klik op `/beveiliging` op "Nu back-up maken". Controleer daarna lokaal:
   `node --env-file=.env.local scripts/backup-controleren.mjs --drive`
5. Draai de workflow één keer handmatig: Actions › Keep-alive › Run workflow.

Let op: GitHub zet geplande workflows uit na 60 dagen zonder activiteit in de repository. Vercel Cron is daarom de hoofdroute.

**Controleren en terugzetten**
- **Controleren.** `node --env-file=.env.local scripts/backup-controleren.mjs --drive` ontsleutelt de nieuwste back-up en controleert hem; het script print alleen tellingen. Met `--bestand x.slbak` controleer je een gedownload bestand; dat werkt alleen met `BACKUP_ENCRYPTION_KEY`.
- **Droog terugzetten.** `node --env-file=.env.local scripts/backup-herstellen.mjs --bestand x.slbak` is standaard droog: het toont per tabel wat nieuw, gewijzigd en ontbrekend is ten opzichte van de huidige database.
- **Echt terugzetten.** Voeg `--schrijven` toe. Het script maakt dan eerst een versleutelde veiligheidskopie van de huidige stand en vraagt je `HERSTEL <project>` te typen.
- **Extra opties.**
  - `--tabellen a,b`: alleen deze tabellen
  - `--gebruikers`: ontbrekende accounts aanmaken, zonder wachtwoord
  - `--bestanden <map met .slenc>`: storage-bestanden terugzetten
  - `--ook-verwijderen`: rijen die niet in de back-up staan verwijderen
  - `--ander-project`: een back-up van een ander Supabase-project terugzetten

## Mail per gebruiker (Account & mail)

### Meerdere inboxen (migratie 0026)

Je kunt **meerdere inboxen** koppelen (max. 10). In Mail staan ze links onder elkaar, elk met
een eigen kleur, naam en adres, een eigen teller en eigen mappen (openklappen). Bovenaan staat
**Alle inboxen**: de inbox van alle inboxen samen, op datum, met per bericht een kleurstreep
en de naam van de inbox. Bij beantwoorden staat **Van** op de inbox waar het bericht binnenkwam;
bij een nieuwe mail op de inbox die je bekijkt (anders de laatst gebruikte). De rail-badge en
de inbox op het dashboard tellen alle inboxen op.

- **Koppelen**: Account & mail → *Inboxen* → **+ Inbox koppelen**: e-mailadres + wachtwoord
  (servers worden herkend), een naam ("Info") en een kleur. Hetzelfde adres opnieuw koppelen
  werkt de bestaande inbox bij (bv. nieuw wachtwoord).
- **Gedeelde inbox** (bv. `info@studio-levant.nl`): zet hem op **Hele team**. Alle actieve
  teamleden zien hem dan in Mail en kunnen er vanaf mailen; op *Alleen ik* ziet alleen jij
  hem. Het wachtwoord blijft versleuteld op de server; anderen krijgen nooit wachtwoord of
  servers te zien. Wordt de koppelaar gedeactiveerd, dan verdwijnt zijn gedeelde inbox voor
  iedereen. Een adres dat een ander al met het team deelt, kun je niet nog eens koppelen.
- Wie welke inbox ziet, bepaalt de server (`lib/mail/zichtbaarheid.ts`, `lib/mail/mailboxen.ts`);
  elke mail-API krijgt `?mb=<inbox>` en geeft 404 bij een inbox die je niet mag zien.
- Tabel `mailboxen` (0026): RLS aan, géén policies, geen rechten voor `anon`/`authenticated`.
  Wachtwoord: AES-256-GCM met `MAIL_ENCRYPTION_KEY` en het user-id van de koppelaar als AAD
  (zo blijven bestaande koppelingen geldig: 0026 zet `user_mailboxes` één keer over).
- **Vóór 0026** werkt alles zoals eerder: één eigen inbox (`user_mailboxes`), of anders (alleen
  voor Daniel) de standaard-mailbox uit de env. Na 0026 staat die standaard-mailbox als extra
  inbox naast je eigen inboxen (tenzij je hetzelfde adres zelf hebt gekoppeld).
- Elke verbinding met een mailserver gaat via een gecontroleerd openbaar IP-adres (ook na het
  koppelen: geen DNS-rebinding naar interne adressen; `lib/mail/dns.ts`).

### Welke inboxen je ziet

Welke inboxen de app voor je gebruikt (`lib/mail/mailboxen.ts`):

1. **Je eigen mailbox**, gekoppeld met één knop: alleen e-mailadres + wachtwoord, in de
   welkomstflow, op `/mail`, in de inbox-kaart van het dashboard of op **Account & mail**
   (`/account`). De server kiest servers en poorten uit het adres (`lib/mail/providers.ts`):
   `@studio-levant.nl` → Private Email; Gmail en iCloud (met app-wachtwoord); Outlook/Hotmail
   wordt netjes geweigerd (alleen wachtwoord kan daar niet meer); een onbekend domein met een
   MX bij `privateemail.com` → Private Email; anders vul je zelf de servers in (*Andere
   provider?*). **Koppelen** logt eerst echt in met IMAP en SMTP; pas als dat lukt wordt het
   wachtwoord opgeslagen. Afzendernaam (standaard je naam) en handtekening pas je aan op
   `/account`. *Ontkoppelen* verwijdert het record (en het wachtwoord).
2. Anders, voor precies één account: hetzelfde adres als `MAIL_USER`, anders het account uit
   `MAIL_ENV_USER_ID`, anders de **oudste** actieve eigenaar (Daniel): de standaard-mailbox
   uit de omgevingsvariabelen (zie hieronder). Een tweede eigenaar krijgt hem nooit.
3. Anders: "niet gekoppeld", met meteen het koppelformulier. Een gewoon teamlid (`lid`) valt
   nooit terug op de standaard-mailbox (getest in `scripts/test-account.mjs`).
4. Daarnaast (0026): de inboxen die een ander actief teamlid op *Hele team* heeft gezet.

**Zo is het beveiligd.**
- Het wachtwoord staat versleuteld in `user_mailboxes.wachtwoord_enc` (migratie 0021):
  AES-256-GCM met de server-sleutel `MAIL_ENCRYPTION_KEY`, een nieuwe willekeurige IV per keer
  en het user-id als AAD (een gekopieerde ciphertext werkt niet bij een ander account). Het
  wachtwoord komt nooit terug naar de browser: het veld is alleen-schrijven ("•••••••• (opgeslagen)";
  leeg laten = behouden). Leeg laten mag alleen als adres, servers én poorten gelijk blijven;
  wijzig je daar iets, dan moet het wachtwoord opnieuw (anders zou een gestolen sessie het
  bewaarde wachtwoord naar een andere server kunnen laten sturen).
- De tabel heeft RLS aan en géén policies, en `anon`/`authenticated` hebben er geen rechten op:
  alleen de server leest hem (service-role, altijd met het eigen user-id).
- Servers worden eerst opgezocht; interne adressen (loopback, privé-netwerk, link-local,
  cloud-metadata) worden geweigerd en de test verbindt met het gecontroleerde adres. Alleen
  poorten 993/143 (IMAP, 143 alleen met STARTTLS) en 465/587 (SMTP). Max. 5 pogingen per 10
  minuten per gebruiker.
- De korte mailcache in de browser (badge, dashboard) heeft een sleutel per gebruiker en
  wordt geleegd bij uitloggen.

**Sleutel instellen** (eenmalig, eigenaar): `openssl rand -base64 32`, en de uitkomst als
`MAIL_ENCRYPTION_KEY` in Vercel (Production en Preview) en in `.env.local`; daarna opnieuw
deployen. Zonder sleutel staat koppelen uit (de pagina zegt dat). Verander je de sleutel,
dan zijn de opgeslagen wachtwoorden onleesbaar: iedereen ziet dan op `/account` "vul het
opnieuw in". (`sleutel_versie` is er voor een latere rotatie.)

## Mail koppelen (Namecheap Private Email)

De standaard-mailbox hieronder (env) is die van Daniel en is alleen bruikbaar voor één
account: hetzelfde adres als `MAIL_USER`, anders `MAIL_ENV_USER_ID`, anders de oudste
eigenaar, en alleen zolang die geen eigen mailbox heeft gekoppeld. Andere teamleden koppelen hun eigen mailbox via
`/account` (zie hierboven).

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

Zonder `MAIL_USER`/`MAIL_PASSWORD` (en zonder eigen mailbox) tonen `/mail` en het dashboard
een nette uitleg met een link naar `/account`; er komt geen foutmelding. Het wachtwoord
blijft op de server.

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
`/prijsopgaven/…` en `/?jaar=…` gaan naar dezelfde pagina onder `/facturen`. `/klanten/…` is
sinds Klanten & projecten de nieuwe klantpagina (met een link naar de facturen van die klant).


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
| `/geen-toegang` | Openbaar, zonder data: voor een account zonder (actief) teamlidmaatschap |
| `/nieuw-wachtwoord`, `/auth/callback`, `POST /auth/uitloggen` | Wachtwoord instellen, inlog-callback, uitloggen |
| `/facturen…` | Facturen, prijsopgaven, klanten |
| `/api/invoices…`, `/api/quotes…`, `/api/clients/search` | Facturen-API (inhoudelijk ongewijzigd; nu met teamlid- en herkomstcontrole) |
| `/agenda` | Agenda & taken (`?dag=`, `?weergave=maand`, `?taak=`, `?afspraak=`, `?lijst=uitgezet`, `?project=<id>`) |
| `/agenda/projecten` | Oud adres: doorverwijzing naar `/projecten` |
| `/klanten`, `/klanten/<id>` | Klanten (`?tab=leads\|actief\|afgerond`, `?nieuw=1` zet de cursor in "Nieuwe klant") en de klantpagina |
| `/projecten`, `/projecten/<id>` | Projecten en de projectpagina |
| `/api/klanten`, `/api/klanten/<id>`, `/api/klanten/<id>/notities…` | Klant maken/wijzigen (niet verwijderen; ook `volgendeStap`/`opvolgenOp`, een statuswijziging komt in de tijdlijn) en klantnotities (503 `tabel_ontbreekt` vóór 0022, `kolom_ontbreekt` voor opvolgen vóór 0025) |
| `/api/dashboard` | Jouw planning voor het dashboard in één verzoek (zelfde gegevens als bij het laden) |
| `/api/agenda`, `/api/taken…` (incl. `?filter=uitgezet`, `/[id]/subtaken…`), `/api/afspraken…` | Agenda-API; alleen jouw taken/afspraken (geen parameter voor die van een ander) (503 `tabel_ontbreekt` vóór de SQL, 403 als je iets van een ander wilt wijzigen) |
| `/api/projecten…`, `/api/team` | Projecten (gedeeld; `?status=lopend\|afgerond\|alle`, met deadline en eigenaren) en de actieve teamleden (alleen naam, initialen, kleur) |
| `/mail` | Mail (`?map=`, `?uid=`, `?nieuw=1`) |
| `/api/mail/…` | Mail-API (503 `niet_gekoppeld` zonder mail-variabelen) |
| `/boekhouding` | Boekhouding: keuze tussen Facturen en Bonnetjes & inkoopfacturen |
| `/boekhouding/bonnetjes` | Bonnetjes & inkoopfacturen (`?uitgave=<id>` opent het paneel, `?toevoegen=1`, `?tab=btw`) |
| `/uitgaven` | Oud adres: tijdelijke redirect naar `/boekhouding/bonnetjes` (query gaat mee) |
| `/api/uitgaven/…` | Bonnetjes-API, o.a. `GET ?q=&jaar=&maand=&soort=&door=` (503 `tabel_ontbreekt`/`opslag_ontbreekt` vóór de SQL) |
| `/bestanden` | Bestanden (Google Drive; `?map=<id>` opent een map, `?drive=<uitkomst>` na het koppelen) |
| `/api/drive/…` | Drive-API: `status`, `map` (GET `?id=`/`?klant=`/`?project=`, POST maakt een klant-/projectmap), `mappen`, `bestanden/<id>` (PATCH hernoemen, DELETE prullenbak), `bestanden/<id>/inhoud` (proxy), `upload` + `upload/klaar`, `zoeken?q=`, en voor de eigenaar `koppelen`, `callback`, `ontkoppelen`, `kopieer-bestaande`, `diagnose` (POST: "Test Drive-koppeling") (503 `tabel_ontbreekt`/`niet_ingericht`, 409 `niet_gekoppeld`/`opnieuw_koppelen`) |
| `/account` | Account & mail |
| `/api/account/profiel`, `/api/account/mailbox` | Eigen profiel wijzigen; eigen mailbox ophalen/koppelen/ontkoppelen (nooit het wachtwoord terug) |
| `/social` | Social-media-tool (`#p=<id>` opent een project, `#nieuw` een nieuwe post) |
| `/api/social/…`, `/social-files/…` | Social-API (spiegelt de oude Express-API) en de bestanden die slides laden |

**Beveiliging.** Alles behalve `/login`, `/wachtwoord-vergeten`, `/geen-toegang`, `/auth/*`,
de logo's en de shell-bestanden zit achter de login én het teamlidmaatschap (zie "Team &
toegang"). `proxy.ts` stuurt niet-ingelogde bezoekers naar `/login` (alle API's en
`/social-files` krijgen een JSON-401) en niet-teamleden naar `/geen-toegang`; **elke** pagina,
server action en API-route controleert daarnaast zelf (`lib/auth/team.ts`). Wijzigende
API-verzoeken van een ander domein worden geweigerd. Elke tabel heeft RLS met `is_teamlid()`.
Mail-HTML wordt op de server gesaneerd en in een gesandboxte iframe zonder scripts getoond.
Elk antwoord krijgt `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`,
`X-Content-Type-Options: nosniff` en een strikte `Permissions-Policy` (`next.config.ts`).

## Controleren

```bash
npx tsc --noEmit && npm run lint && npm run build
node scripts/rooktest-shell.mjs --alleen-statisch     # rails gelijk + teamtoegang overal (statisch)
npx next start -p 3107 &                              # (na de build)
node scripts/rooktest-shell.mjs http://localhost:3107 # alle pagina's -> /login, alle API's JSON-401, koppen
node scripts/test-snelinvoer.mjs                      # herkenning datum/tijd in de taak-popup (incl. zomer-/wintertijd)
node scripts/test-taken.mjs                           # taken op naam: toewijzing, subtaken, projecten, rechten
node scripts/test-uitgaven.mjs                        # uitgaven: bedragen, btw, CSV, uitlezen (nagebootst), ontbrekend/onzeker
node scripts/test-bonnetje-heic.mjs [--claude]        # HEIC → JPEG (server + headless Chrome), foto's voor Claude; --claude: échte testbon
node scripts/test-team.mjs                            # herkomst (CSRF), basis-URL voor mails, teambeheer-scripts
node scripts/test-account.mjs                         # mailkluis (AES-GCM), SSRF-controle, profiel/mailbox-invoer, zoeken
node scripts/test-brand-guard-parity.mjs              # social-port gelijk aan het origineel
node scripts/test-rls.mjs                             # RLS van 0021 op lokale Postgres (PGlite): per tabel/bucket wie wat mag
node scripts/test-drive.mjs                           # Google Drive: paden, namen, state (CSRF), token-kluis, Drive-API (nagebootst)
node scripts/test-externals.mjs                       # serverExternalPackages (ook libheif-js) laden zonder require(esm); gebouwde mail-/uitgavenroutes (na build)
node scripts/genereer-sql-editor.mjs --controleer     # SQL-bestanden actueel
node scripts/teamlid-toevoegen.mjs --help             # teambeheer (niet uitvoeren zonder reden)
node --experimental-strip-types scripts/rooktest-render.mjs   # social-renderer (lokale Chrome nodig)
```

`scripts/test-rls.mjs` (devDependency `@electric-sql/pglite`, geen netwerk, geen Supabase):

- voert 0001–0021 uit met testdata (Daniel, een bevestigde tweede gebruiker, een
  onbevestigd en een anoniem account) — de situatie zoals in Supabase nu — en een tweede
  teamlid met projecten in de oude statussen; daarna `UITVOEREN_0022.sql` twee keer, een
  gepland project en `UITVOEREN_0023.sql` twee keer, en
  `UITVOEREN_0021_TEAM.sql` (2x), `UITVOEREN_IN_SQL_EDITOR.sql` en `UITVOEREN_0020_UITGAVEN.sql`
  opnieuw: elke controleregel `ok`, niets heropend (ook de leesregels voor taken niet), geen
  extra leden. Ook het pad "0021 vóór 0020" wordt getest;
- 0022: welkom-vlag (alleen de eigen, alleen die kolom), wie welke taak/afspraak ziet
  (taak voor een ander, voor twee, privé, projecttaak), klanten/notities/projecteigenaren,
  de omzetting van projectstatussen (ook 0023: gepland → voorbereiding, `status_sinds` en de
  trigger, 0022/0023 opnieuw uitvoeren laat statussen staan), en dat `taak_tellingen`/`project_taak_tellingen`
  precies tellen wat de lijsten tonen (niets van een ander, niets voor niet-teamleden);
- zaaien: alleen bevestigde, niet-anonieme accounts; de oudste wordt eigenaar; bestaande
  taken en afspraken gaan naar hun maker of de eigenaar;
- **niet-teamleden** (ingelogd zonder lidmaatschap, onbevestigd, anoniem, gedeactiveerd, en
  `anon` zonder sessie): op elke tabel in `public` en in elke bucket niets lezen, invoegen,
  wijzigen of verwijderen; de RPC's geweigerd. Enige uitzondering: een gedeactiveerd lid ziet
  zijn eigen (inactieve) regel in `team_members`, voor de melding "geen toegang";
- **teamleden**: alles lezen behalve `user_mailboxes`; gedeelde data schrijven; facturen
  alleen lezen; taken/afspraken van een ander niet wijzigen; niet toewijzen aan
  niet-teamleden; alleen het eigen profiel (niet het e-mailadres), nooit de eigen rol;
  `uitgaven`, `uitgaven-export` en `mail-tmp` alleen via de service-role; na deactiveren
  direct niets meer; een account verwijderen laat facturen staan (maker wordt leeg);
- 0024 (Google Drive): `drive_koppeling` voor niemand behalve de service-role (ook niet voor
  de eigenaar), `drive_mappen`/`drive_kopieen` alleen door de server te schrijven,
  `drive_bestanden` alleen teamleden;
- de controletabel slaat alarm bij een policy zonder teamcheck of een openbare bucket.

## Een module toevoegen

1. Voeg één entry toe aan `MODULES` in `lib/modules.ts` (id, naam, kort label, `href`, icoon,
   `actief: true`, eventueel een `snelactie`). De rail (ook in social) en de snelle acties op
   het dashboard nemen hem automatisch over. Een nieuw icoon voeg je toe in `lib/shell/iconen.ts`.
2. Maak de pagina's in `app/(app)/<module>/`; dan staan ze vanzelf in de shell.
3. Eventueel API-routes in `app/api/<module>/`. Wikkel elke route in `teamlidRoute()` uit
   `lib/auth/team.ts` (of begin met `controleerRoute()`); begin elke pagina met
   `vereisTeamlidPagina()`. De proxy geeft alle `/api/…` zonder sessie al een JSON-401.
4. Eventueel een migratie `supabase/migrations/00NN_<module>.sql` met RLS aan en policies op
   `(select public.is_teamlid())` (nooit `auth.uid() is not null`), idempotent
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
- **Node-versie:** `package.json` → `"engines": { "node": ">=22.17.0 <25" }`. Vercel kiest
  daarmee de nieuwste toegestane major (24.x); lokaal werkt ook Node 22.
  `@sparticuz/chromium` vraagt `^22.17.0 || >=24`. De bovengrens voorkomt dat een nieuwe
  major (26) vanzelf meekomt.
- **sanitize-html wordt gebundeld, niet als external geladen.** sanitize-html 2.18 is
  CommonJS maar require't htmlparser2 12, dat alleen ESM is. Als `serverExternalPackages`
  faalde dat op Vercel met `Failed to load external module sanitize-html…: ERR_REQUIRE_ESM`
  (alle mailroutes). Turbopack bundelt hem nu en lost dat zelf op, ongeacht de Node-versie.
  imapflow, mailparser en nodemailer blijven external: die laadt Turbopack met `import()`
  (eigen ESM-build) en ze laden ook zonder require(esm). `node scripts/test-externals.mjs`
  controleert dit (na `npm run build` ook de gebouwde mailroutes, zonder require(esm)).
  `libheif-js` (HEIC voor bonnetjes) is ook external: CommonJS zonder ESM-afhankelijkheden,
  de wasm zit als base64 in `wasm-bundle.js` (geen los bestand om mee te tracen). De
  prebuilt `sharp` kan geen HEIC lezen (geen HEVC-decoder) en wordt daarom niet gebruikt.

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
- **Bonnetjes:** een HEIC die al vóór deze versie is geüpload, wordt pas omgezet (en
  getoond) na **Opnieuw automatisch uitlezen**. Bedragen in andere valuta worden niet
  omgerekend. Het btw-overzicht is een indicatie.
- **Social op de telefoon** is net als het origineel niet geoptimaliseerd voor kleine schermen.
- **Bestanden:** bekijken/downloaden loopt via de server (gestreamd); heel grote downloads
  kunnen tegen de tijdslimiet van een Vercel-functie (60 s) aanlopen. Uploaden heeft die
  grens niet (rechtstreeks naar Google). Mappen slepen (een hele map uploaden) en bestanden
  verplaatsen tussen mappen kan (nog) niet in het dashboard; doe dat in Google Drive zelf.
