# Beveiliging — Studio Levant backoffice

Stand: oktober 2026 (migratie 0026). Eerlijk overzicht voor de eigenaar: wat er nu is, wat er
is verbeterd, wat er nog openstaat en wat je zelf moet doen. Technische details staan in de
README ("Team & toegang", "Tweestapsverificatie (2FA)", "Back-ups en keep-alive").

> **Belangrijk:** veel hiervan werkt pas na drie handelingen van jou: de env-variabelen in
> Vercel zetten, `supabase/UITVOEREN_0026.sql` uitvoeren en 2FA voor jezelf instellen. Zie
> "Uitrol in 7 stappen" onderaan. Tot dan werkt de app zoals voorheen; niemand wordt
> buitengesloten.

---

## 1. Wat er al goed was

- **Alleen het team.** Elke pagina, API-route en server action loopt via één centrale
  teamcheck (`lib/auth/team.ts`). De service-role (die RLS overslaat) is alleen bruikbaar
  met een "bewijs" van die check. Er is geen registratie in de app.
- **RLS op elke tabel** met `is_teamlid()`. Een account zonder actief lidmaatschap ziet via
  de database-API niets, ook niet met een geldige sessie. `anon` heeft nergens rechten.
- **Geheimen alleen op de server.** Mailbox-wachtwoorden en het Drive-token staan versleuteld
  (AES-256-GCM) in tabellen zonder policies. Ze gaan nooit naar de browser.
- **Herkomstcheck (CSRF)** op alle wijzigende verzoeken, **SSRF-controle** bij het koppelen
  van een mailbox, gesaneerde mail-HTML in een sandbox-iframe, vaste lijsten met toegestane
  bestandstypen en korte signed URL's (60–600 s).

## 2. Wat er is verbeterd (migratie 0026 en de code erbij)

| Onderwerp | Wat er nu is |
|---|---|
| **Next.js-lekken** | Next.js 16.2.10 had kritieke lekken (proxy-omzeiling, RCE via beeldoptimalisatie). Bijgewerkt naar 16.4.3. `/_next/image` staat helemaal uit (`images.unoptimized`). |
| **Tweestapsverificatie (2FA)** | Verplicht voor alle teamleden, met een authenticator-app (TOTP via Supabase Auth). Inschrijven gebeurt in de welkomstflow, op `/beveiliging/instellen` en via Account › Beveiliging (maximaal 2 apparaten). Bij het inloggen volgt `/login/2fa`. |
| **2FA ook in de database** | `is_teamlid()` eist een sessie ná de code (aal2) van iedereen die een 2FA-apparaat heeft. Iemand met alleen een gestolen wachtwoord ziet dus ook via de Supabase-API niets: geen facturen, geen bonnetjes, geen bestanden. |
| **Niemand buitensluiten** | Zonder 0026 of met `MFA_AFDWINGEN=uit` hoeft niemand 2FA in te stellen. Wie nog geen apparaat heeft, valt in de database niet buiten. De "strenge" stand (ook zonder apparaat geen data) zet je pas aan als iedereen 2FA heeft; het script weigert hem eerder. |
| **Herstel bij een kwijtgeraakte telefoon** | De eigenaar reset de 2FA van een lid op `/beveiliging`, met een reden die in de audit-log komt. Voor jezelf: `scripts/2fa-herstel.mjs --reset <email>`. |
| **Inlogpogingen beperken** | Op het loginformulier van de app: per e-mailadres+IP 5 en per IP 20 mislukte pogingen per 15 minuten (bewust niet per e-mailadres alleen, anders kan een vreemde de eigenaar buitensluiten). Veel mislukte pogingen op één adres vanaf allerlei IP's (30 per uur) blokkeren niet, maar geven `inlog_verdacht` in de audit-log. 2FA-codes: 5 per 5 minuten. Wachtwoord vergeten: 3 per uur. De melding is generiek. Let op: dit geldt alleen voor de app. Met de (openbare) anon-key kan iemand rechtstreeks bij Supabase Auth inloggen of 2FA-codes proberen; daar gelden alleen de limieten van Supabase zelf (zie checklist). |
| **Wachtwoorden** | Minstens 12 tekens, plus een check op bekende datalekken via Have I Been Pwned (k-anonimiteit: alleen 5 tekens van een hash gaan naar buiten). |
| **Sessies** | Automatisch uitloggen na 12 uur zonder activiteit of na 14 dagen. Dat gebeurt met een eigen ondertekende httpOnly-cookie, want Supabase gratis heeft dit niet. Ontbreekt die cookie (gewist, of na lange afwezigheid door de browser weggegooid), dan krijg je alleen een nieuwe als je de laatste 10 minuten echt hebt ingelogd; anders word je uitgelogd. Bij de uitrol logt daardoor iedereen één keer uit. |
| **Strenge headers** | CSP met nonce per verzoek (scripts alleen van de eigen site), HSTS (2 jaar), COOP, CORP, `X-Frame-Options`, `nosniff`, een strikte `Permissions-Policy` en geen `X-Powered-By`. API's sturen `Cache-Control: no-store`. Social-slides krijgen een sandbox-CSP. |
| **Audit-log** | Inloggen (ook mislukt en geblokkeerd), uitloggen, 2FA (inschrijven, verwijderen, reset, fouten), wachtwoord, teamwijzigingen (ook via de scripts), mailbox koppelen, wijzigen en ontkoppelen, exports, verwijderen, Drive, back-ups en cron. Alleen de eigenaar met 2FA-sessie leest hem, op `/beveiliging`. Via de app en de API kan niemand regels wijzigen of verwijderen (ook niet met de service-role); wie de database-eigenaar is (SQL Editor / DB-wachtwoord) kan dat wel. Bewaar dat wachtwoord dus net zo zorgvuldig als de service-role-key. De audit-log gaat mee in de dagelijkse versleutelde back-up, zodat wissen achteraf zichtbaar wordt. Na 400 dagen wordt er opgeruimd. IP-adressen staan er alleen gehasht in. |
| **Logs** | Logs bevatten geen foutobjecten, e-mailadressen, onderwerpen of tokens meer, alleen codes en id's (`lib/log.ts`). |
| **Mailservers** | Elke IMAP/SMTP-verbinding gaat via een gecontroleerd openbaar IP. DNS-rebinding naar interne adressen werkt dus ook na het koppelen niet meer. Het mailbox-wachtwoord is gebonden aan eigenaar én mailbox. |
| **Fail closed** | Ontbreekt de tabel `team_members`, dan geldt dat als storing. Vroeger kreeg dan iedereen toegang. |
| **Dure AI-routes** | Bonnetjes uitlezen en social genereren hebben een limiet per gebruiker per uur. |
| **Back-ups alleen voor de eigenaar** | De map `Back-ups` in Drive (met alles eronder) is onbereikbaar via de Drive-module van de app: niet te zien, te zoeken, te downloaden, te hernoemen, te verwijderen of te vullen. Downloaden kan alleen via `/beveiliging` (eigenaar met 2FA-sessie). |
| **Back-ups** | Eens per 3 dagen een volledige export van alle eigen tabellen, versleuteld met AES-256-GCM (`BACKUP_ENCRYPTION_KEY`), naar Google Drive (`Studio Levant/Back-ups/<jaar>/<datum>.slbak`). Alleen de nieuwste 3 blijven staan (de oudste gaat weg bij een nieuwe). Daarnaast eens per 3 dagen de nieuwe bestanden (facturen-PDF's, bonnetjes, social), elk apart versleuteld. Er zijn scripts om te controleren en terug te zetten (standaard droog). De status staat op `/beveiliging`; de eigenaar ziet een waarschuwing op het dashboard. |
| **Keep-alive** | Vercel Cron roept elke nacht `/api/cron/dagelijks` aan; die schrijft een heartbeat, zodat Supabase gratis nooit pauzeert. GitHub Actions doet hetzelfde elke 3 dagen als reserve. De route werkt alleen met `CRON_SECRET` (zonder het secret 401; staat het secret niet ingesteld, dan 503). |

### Boekhouding (migratie 0027)

- **RLS**: alle 13 `bk_*`-tabellen alleen voor actieve teamleden via `is_teamlid()` (dus ook
  met de 2FA-eis: aal1 met een geverifieerde factor ziet niets); anon heeft geen rechten.
  Getest in `scripts/test-boekhouding-db.mjs` en scenario D van `scripts/test-rls.mjs`.
- **Rechten van de eigenaar** (database én route, sessie op aal2): een ingediende btw-aangifte
  intrekken, een boekjaar afsluiten of heropenen (`bk_jaar_afsluiten`/`bk_jaar_heropenen`,
  policies op `bk_boekjaren`, een jaarafsluiting in `bk_memoriaal`) en de winstverdeling
  wijzigen (`bk_vennoten_aandelen`, update-policy op `bk_vennoten`). Overige boekingen doet elk
  teamlid (gedeelde administratie).
- **Vergrendeling en bewaarplicht**: triggers weigeren wijzigingen in een kwartaal met een
  ingediende aangifte of een afgesloten jaar; bankregels zijn niet te verwijderen (alleen
  markeren met reden); memoriaalposten moeten sluiten (deferred trigger).
- **Alleen lezen** van facturen en bonnetjes: de boekhouding schrijft nooit naar `invoices`,
  `expenses`, `quotes` of `clients` (rooktest). Nooit de service-role; altijd de RLS-cliënt
  van het teamlid. Exports: `Cache-Control: private, no-store`, `nosniff`, CSV zonder
  formule-injectie.
- **Demo-modus** schrijft niets naar de database en kiest alleen de demo bij een ontbrekende
  tabel of `BOEKHOUDING_DEMO=1`; elke andere fout is een foutmelding (fail closed).

## 3. Resterende risico's (eerlijk)

1. **Supabase gratis heeft geen eigen back-ups en geen point-in-time-herstel (PITR).** Onze
   back-up is één keer per dag: wat er tussen twee back-ups verandert, kan verloren gaan.
   Er is ook nog geen echte back-up gemaakt of teruggezet. Dat kan pas na de uitrol (stap 5).
2. **Drive is de enige plek buiten Supabase.** Valt het Google-account weg (blokkade, hack,
   verwijderd), dan zijn de back-ups ook weg. Download af en toe een back-up naar een eigen
   versleutelde schijf (knop "Download laatste (versleuteld)" op `/beveiliging`).
3. **Sleutelbeheer.** Zonder `BACKUP_ENCRYPTION_KEY` zijn alle back-ups onbruikbaar. Zonder
   `MAIL_ENCRYPTION_KEY` moet iedereen zijn inboxen opnieuw koppelen. Wie de service-role-key
   heeft, kan álles, ook de 2FA-controle uitschakelen. Bewaar ze dus goed (zie checklist).
4. **TOTP zonder herstelcodes.** Supabase heeft geen herstelcodes. Ben je je enige apparaat
   kwijt, dan heb je het script en de service-role-key nodig. Stel daarom twee apparaten in
   (telefoon + wachtwoordmanager).
5. **Drive-toegang is breed.** De koppeling heeft toegang tot de hele Drive van
   daniel@studio-levant.nl, want zoeken en kopiëren hebben dat nodig. Een gelekt token plus
   sleutel geeft dus toegang tot meer dan alleen de map Studio Levant.
6. **Inloglimieten gelden alleen voor het formulier.** De anon-key staat (zoals bedoeld) in
   de browser. Wie hem gebruikt, kan rechtstreeks bij Supabase Auth wachtwoorden en 2FA-codes
   proberen, buiten de limieten van de app om. De echte bescherming tegen raden zit dus in de
   rate limits van Supabase Auth (zet ze laag, zie checklist), een sterk wachtwoord en 2FA.
   De limiet op koppelpogingen voor mailboxen en een paar caches staan bovendien in het
   geheugen; op Vercel met meerdere instanties zijn die "zacht".
7. **Sessies in Supabase zelf.** Het uitloggen na 12 uur of 14 dagen doet de app, en geldt
   alleen voor verkeer via de app. Een Supabase-refresh-token blijft geldig tot er wordt
   uitgelogd. Wie een refresh-token van een aal2-sessie steelt, houdt aal2 en kan via de
   Supabase-API data lezen, los van het sessiebeleid van de app. Advies: bij Supabase Pro
   "Time-box user sessions" en "Inactivity timeout" instellen, en bij verdenking uitloggen op
   alle apparaten (wachtwoord wijzigen).
8. **CSP met `'unsafe-inline'` voor stijlen.** Scripts zijn wel streng (alleen met nonce).
   Pagina's achter de login zijn niet live op CSP-fouten gecontroleerd, alleen `/login` en
   `/wachtwoord-vergeten` (zie "Wat er niet getest is").
9. **npm audit: 4× high in puppeteer → chromium-bidi → zod** (geheugen uitputten bij
   validatie). Dit draait alleen op de server bij de PDF/PNG-render, met eigen invoer. De
   versie met de fix verwacht Chrome 157, terwijl de factuur-PDF Chromium 149 gebruikt; die
   upgrade is bewust niet gedaan om de facturen niet te raken. Opnieuw bekijken bij de
   volgende update van `@sparticuz/chromium`.
10. **Factuur-PDF-render** zonder extra afscherming van netwerkverzoeken (alle velden worden
    wel ge-escaped). Niet gewijzigd, omdat de PDF exact gelijk moet blijven.
11. **GitHub-reserve van de keep-alive** valt stil als de repository 60 dagen geen activiteit
    heeft (zo werkt GitHub). Vercel Cron blijft de hoofdroute.

### Wat er niet getest is (kon niet zonder inloggen of echte diensten)

- Inschrijven, de code invoeren en de reset van 2FA in de echte app.
- Een echte back-up naar Drive, `backup-controleren.mjs --drive` en een herstel.
- De cron met het juiste secret, en de GitHub-workflow.
- Twee of meer echte inboxen tegelijk.

De logica is wel getest: `scripts/test-rls.mjs` (database op PGlite, inclusief 2FA op aal1/aal2,
audit-log, gedeelde inbox en back-uptabellen), `test-beveiliging.mjs`, `test-backup.mjs`,
`test-account.mjs` en `rooktest-shell.mjs` (headers, 401 op alle API's en de cron-route).
Controleer de punten hierboven daarom zelf in stap 4 en 5 van de uitrol.

## 4. Checklist voor de eigenaar

**Accounts (2FA met een app of passkey, geen sms):**
- [ ] Google-account daniel@studio-levant.nl
- [ ] Supabase (account én organisatie)
- [ ] Vercel
- [ ] GitHub (djtukker06)
- [ ] Namecheap (account én Private Email-webmail)
- [ ] Anthropic Console
- [ ] De wachtwoordmanager zelf

**Sleutels in de wachtwoordmanager** (met een offline kopie, bv. op papier in een kluis):
- [ ] `BACKUP_ENCRYPTION_KEY`: zonder deze sleutel zijn de back-ups waardeloos
- [ ] `MAIL_ENCRYPTION_KEY` en `DRIVE_ENCRYPTION_KEY` (als die apart is gezet)
- [ ] `CRON_SECRET`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` en het databasewachtwoord
- [ ] Optioneel `SESSIE_GEHEIM` en `AUDIT_PEPPER`

**Vercel**
- [ ] `BACKUP_ENCRYPTION_KEY` en `CRON_SECRET` zetten (`openssl rand -base64 32`), alleen voor Production, op "Sensitive".
- [ ] Alle andere geheimen ook op "Sensitive".
- [ ] `MFA_AFDWINGEN` leeg laten (betekent: aan). Alleen in een noodgeval `uit`.
- [ ] Deployment Protection voor previews aan laten.

**GitHub** (Settings › Secrets and variables › Actions)
- [ ] `SL_CRON_URL` = `https://sl-dashboard-delta.vercel.app` (zonder `/` aan het eind)
- [ ] `SL_CRON_SECRET` = dezelfde waarde als `CRON_SECRET`
- [ ] Repository privé laten, branch-protection op `main`, Dependabot-alerts aan.

**Supabase** (Authentication)
- [ ] "Allow new users to sign up" UIT, anonieme sign-ins UIT, "Confirm email" AAN.
- [ ] Redirect URLs alleen productie en `http://localhost:3000/**`.
- [ ] Multi-Factor Authentication: TOTP **aan** (standaard aan; controleer het).
- [ ] Authentication › Rate Limits: de limieten voor sign-in/token en "Token verifications" (ook MFA-verify) zo laag als werkbaar. Dit is de echte bescherming tegen raden; de limiet van de app geldt alleen voor het formulier.
- [ ] "Leaked password protection" aan als je Pro neemt (de app checkt het nu zelf).
- [ ] **Supabase Pro overwegen** (ongeveer $25 per maand): officiële dagelijkse back-ups, optioneel PITR, nooit pauzeren, sessie-timeouts in Supabase zelf. Onze back-ups blijven dan nuttig als tweede kopie buiten Supabase.

**Google**
- [ ] De OAuth-client alleen de productie-redirect-URI geven.
- [ ] Af en toe nagaan wie er toegang heeft tot de map `Studio Levant/Back-ups` (alleen jij).
- [ ] Liefst later: een aparte Shared Drive of een apart account voor de backoffice (zie risico 5).

**Namecheap**
- [ ] Per gekoppelde mailbox een sterk, uniek wachtwoord.
- [ ] Vertrekt er een teamlid: de wachtwoorden van de gedeelde inboxen wijzigen en daarna opnieuw koppelen.

**Vast ritme**
- [ ] Maandelijks: `node --env-file=.env.local scripts/backup-controleren.mjs --drive`.
- [ ] Per kwartaal: een droge hersteltest: download een back-up en draai `scripts/backup-herstellen.mjs --bestand <bestand>` (zonder `--schrijven`).
- [ ] Af en toe op `/beveiliging` de audit-log en de heartbeat bekijken.
- [ ] Na vertrek van een teamlid: `scripts/teamlid-verwijderen.mjs`, in Supabase "Sign out user", en gedeelde wachtwoorden en sleutels roteren.
- [ ] Laptop en telefoon: schijfversleuteling (FileVault), automatische schermvergrendeling, systeem en browser up-to-date.

## 5. Uitrol in 7 stappen

1. **Deployen** met `MFA_AFDWINGEN` niet gezet. Zolang 0026 ontbreekt dwingt de app niets af;
   Mail werkt met de ene inbox van nu en de keep-alive (een kleine leesquery) loopt al.
2. **Geheimen zetten:** in Vercel `BACKUP_ENCRYPTION_KEY` en `CRON_SECRET`, in GitHub
   `SL_CRON_URL` en `SL_CRON_SECRET`, en alles in je wachtwoordmanager. Daarna opnieuw deployen.
3. **SQL:** voer `supabase/UITVOEREN_0026.sql` uit in de SQL Editor en controleer dat elke
   regel `ok` is. De bestaande inbox wordt automatisch overgezet.
4. **2FA voor jezelf:** log in. Je komt op `/beveiliging/instellen`; stel twee apparaten in
   (telefoon + wachtwoordmanager). Log uit en weer in, en controleer dat om de code wordt
   gevraagd.
5. **Back-up testen:** op `/beveiliging` › "Nu back-up maken", daarna lokaal
   `node --env-file=.env.local scripts/backup-controleren.mjs --drive`. Draai de GitHub-workflow
   één keer handmatig (Actions › Keep-alive › Run workflow) en kijk de volgende dag of er een
   heartbeat "via Vercel Cron" staat.
6. **Bram uitnodigen** (`scripts/teamlid-toevoegen.mjs`). Zijn welkomstflow begint met 2FA.
   Hebben alle teamleden 2FA? Dan kan `scripts/2fa-herstel.mjs --streng aan`.
7. **Klaar.** Bewaar deze checklist.

## 6. Noodgevallen

| Situatie | Wat te doen |
|---|---|
| Een lid is zijn telefoon kwijt | Eigenaar: `/beveiliging` › Team & 2FA › "Reset 2FA" (met reden). Het lid stelt bij de volgende login opnieuw 2FA in. |
| Je bent zelf je enige 2FA-apparaat kwijt | `node --env-file=.env.local scripts/2fa-herstel.mjs --reset daniel@studio-levant.nl` (bevestigen door het adres te typen). |
| 2FA werkt voor niemand meer (storing) | 1) In Vercel `MFA_AFDWINGEN=uit` en opnieuw deployen (dan hoeft niemand 2FA opnieuw in te stellen). 2) Per teamlid: `node --env-file=.env.local scripts/2fa-herstel.mjs --reset <email>`. Wie al een apparaat heeft, moet anders nog steeds een code invullen, en dat lukt tijdens de storing niet; `MFA_AFDWINGEN=uit` en `--rls uit` alleen helpen daar niet. 3) Na de storing de variabele weer leegmaken; iedereen stelt bij de volgende login 2FA opnieuw in. Alles komt in de audit-log. |
| Je vermoedt dat een wachtwoord is gelekt | Wachtwoord wijzigen (Account). Met 2FA is het wachtwoord alleen niet genoeg. Bekijk de audit-log op `inloggen_mislukt`/`inlog_geblokkeerd`. |
| Je vermoedt dat de service-role-key is gelekt | In Supabase de API-sleutels roteren (JWT secret / API keys), de nieuwe key in Vercel en `.env.local` zetten, opnieuw deployen. Daarna de audit-log en de data controleren. |
| Data kwijt of beschadigd | `scripts/backup-herstellen.mjs --bestand <laatste.slbak>` eerst droog, dan met `--schrijven` (het script maakt eerst zelf een veiligheidskopie). Zie de README. |
| Supabase toch gepauzeerd | In het Supabase-dashboard "Restore". Controleer daarna op `/beveiliging` de heartbeat en in Vercel › Cron Jobs of de cron draait. |

**Let op:** voer na 0026 nooit meer de *losse* migratie `0021_team_en_taken.sql` uit; die zet
de 2FA-controle in de database terug. De `UITVOEREN_*`-bestanden zijn veilig: de grote eindigen
met 0026. Opnieuw `UITVOEREN_0026.sql` uitvoeren herstelt het altijd.
