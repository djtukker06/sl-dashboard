// Rooktest voor de gedeelde shell en de toegangscontrole, zonder in te loggen en zonder
// iets te schrijven.
//
// 1. Statisch: de React-rail (components/shell/Rail.tsx + RailNav.tsx) en de HTML-rail
//    voor social (railHtml in lib/shell/rail.ts) gebruiken dezelfde items, classes, links
//    en logo.
// 2. Statisch: de teamtoegang (lib/auth/team.ts) zit overal vóór:
//    - elke API-route gebruikt de helper of een wrapper die hem aanroept;
//    - elke pagina in app/(app) begint met vereisTeamlidPagina();
//    - createServiceRoleClient() krijgt altijd een bewijs; nergens signUp( of getClaims;
//    - migratie 0021 maakt geen open policy ("auth.uid() is not null") en elk SQL-Editor-
//      bestand eindigt met 0021; de proxy-matcher heeft geen algemene .png/.jpg-uitzondering.
// 3. Tegen een draaiende server (`npm run build && npx next start -p 3107`):
//    - elke pagina (automatisch gevonden in app/) stuurt zonder sessie door naar /login;
//    - elke API-route en elk social-bestand weigert met een JSON-401 — voor elke
//      geëxporteerde methode, ook paden die op .png eindigen;
//    - /login, /wachtwoord-vergeten en /geen-toegang laden, met het echte logo en zonder rail;
//    - logo, shell.css en shell.js zijn openbaar; de social-frontend (app.js/app.css) niet;
//    - beveiligingskoppen (X-Frame-Options, Referrer-Policy, nosniff) staan op elk antwoord;
//    - uitloggen weigert een ander domein (403) en werkt vanaf het eigen domein (303);
//    - /uitgaven (met query) stuurt door naar /boekhouding/bonnetjes.
// 4. Statisch, Boekhouding en Account & mail (stap 2):
//    - één module "boekhouding" (actief op /boekhouding, /facturen en /uitgaven), geen losse
//      facturen/uitgaven meer; beide rails linken naar /account;
//    - de facturenschermen, -componenten en lib/invoice zijn ongewijzigd t.o.v. stap 1;
//    - mailbox-wachtwoorden: AES-256-GCM met AAD, nooit in client-code of in de status-respons,
//      user_mailboxes alleen met het eigen user-id.
// 5. Statisch, taken op naam (stap 3):
//    - geen snelinvoer-tekstveld meer bovenaan dashboard en agenda; de taak-popup
//      (TaakDialoog, role=dialog + aria-modal) via TakenProvider op beide plekken;
//    - nieuwe taak in één transactie (rpc taak_aanmaken); wijzigen/verwijderen van taken,
//      subtaken en afspraken alleen als maker of toegewezene/deelnemer (403);
//    - "mijn" lijsten filteren op task_assignees/event_attendees; het dashboard toont
//      alleen eigen taken; projecten-, team- en subtaken-routes en /agenda/projecten bestaan.
//
// 6. Statisch, afronding (stap 4):
//    - UITVOEREN_0021_TEAM.sql: één transactie, controle op open policies, policies zonder
//      teamcheck en openbare buckets; SQL-bestanden actueel t.o.v. de migraties;
//    - "aangemaakt door"-trigger blokkeert het verwijderen van een account niet;
//    - de RLS-test op lokale Postgres (scripts/test-rls.mjs) bestaat en PGlite is een
//      devDependency (geen runtime-dependency);
//    - README: aanmelden uit in Supabase, teamlid-scripts, rollen, controletabel, test-rls;
//      .env.local.example: MAIL_ENCRYPTION_KEY met uitleg, nergens een ingevulde waarde.
// Live (stap 4): /, /boekhouding en /account geven precies 307 naar /login.
// 7. Statisch, team van twee — stap 1 (welkomstflow en mailbox met één knop):
//    - /welkom controleert het lidmaatschap, de layout stuurt alleen bij welkomKlaar=false door;
//    - /api/account/welkom via teamlidRoute, alleen het eigen profiel;
//    - POST /api/account/mailbox leidt servers af (providers + MX), houdt SSRF-controle,
//      rate limit en versleuteling; één koppelcomponent op welkom, /mail, dashboard en /account;
//    - migratie 0022: alleen kolom + grant voor welkom_klaar_op (idempotent).
// Live: /welkom zonder sessie -> 307 naar /login.
//
// Gebruik:  node scripts/rooktest-shell.mjs [http://localhost:3107]
//           node scripts/rooktest-shell.mjs --alleen-statisch
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const args = process.argv.slice(2);
const ALLEEN_STATISCH = args.includes("--alleen-statisch");
const BASIS = (args.find((a) => /^https?:\/\//.test(a)) || "http://localhost:3107").replace(/\/$/, "");

let fouten = 0;
let goed = 0;
function check(ok, label, detail = "") {
  if (ok) goed++;
  else {
    fouten++;
    console.log(`  FOUT  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// ---------------------------------------------------------------------------------
// 1. Statische pariteit van de twee rails
// ---------------------------------------------------------------------------------
console.log("Rail: React en HTML gelijk");
{
  const html = lees("lib/shell/rail.ts");
  const react = lees("components/shell/Rail.tsx") + lees("components/shell/RailNav.tsx");
  const klassen = (src, re) => new Set([...src.matchAll(re)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  const htmlKlassen = klassen(html, /class="([^"$]+)"/g);
  const reactKlassen = klassen(react, /className="([^"]+)"/g);
  const verschil = [...htmlKlassen].filter((k) => !reactKlassen.has(k)).concat([...reactKlassen].filter((k) => !htmlKlassen.has(k)));
  check(verschil.length === 0, "zelfde classes", verschil.join(", "));
  for (const href of ["/", "/account", "/nieuw-wachtwoord", "/auth/uitloggen"]) {
    check(html.includes(`"${href}"`) && react.includes(`"${href}"`), `link ${href} in beide rails`);
  }
  check(/railItems\(\)/.test(html) && /railItems\(\)/.test(react), "beide rails lezen railItems() uit lib/modules.ts");
  check(/LOGO_SRC/.test(react) && /export const LOGO_SRC = '\/brand\/beeldmerk-licht\.png'/.test(html), "zelfde logo");
  check(fs.existsSync(path.join(ROOT, "public/brand/beeldmerk-licht.png")), "public/brand/beeldmerk-licht.png bestaat");
  check(/railHtml\(/.test(lees("app/social/route.ts")), "social krijgt railHtml()");
  check(/<Rail\b/.test(lees("app/(app)/layout.tsx")), "app/(app)/layout.tsx rendert <Rail>");
}

// ---------------------------------------------------------------------------------
// 2. Teamtoegang (statisch)
// ---------------------------------------------------------------------------------
console.log("Teamtoegang: overal de centrale controle");
function bestandenIn(map, filter) {
  const uit = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (filter(e.name)) uit.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, map));
  return uit;
}
{
  const WRAPPERS = /\b(teamlidRoute|controleerRoute|metSessie|mailRoute|uitgavenRoute|route)\(/;
  for (const f of bestandenIn("app/api", (n) => n === "route.ts")) {
    check(WRAPPERS.test(lees(f)), `${f} gebruikt de teamlidcontrole`);
  }
  for (const f of bestandenIn("app/social-files", (n) => n === "route.ts")) {
    check(/\broute\(/.test(lees(f)), `${f} gebruikt route() (teamlidcontrole)`);
  }
  for (const f of bestandenIn("app/(app)", (n) => n === "page.tsx")) {
    check(/vereisTeamlidPagina\(/.test(lees(f)), `${f} begint met vereisTeamlidPagina()`);
  }
  check(/vereisTeamlidPagina\(/.test(lees("app/(app)/layout.tsx")), "app/(app)/layout.tsx controleert het lidmaatschap");
  check(/huidigTeamlid\(/.test(lees("app/social/route.ts")), "/social controleert het lidmaatschap");
  for (const f of ["app/actions/invoices.ts", "app/actions/quotes.ts", "app/actions/clients.ts"]) {
    check(/vereisTeamlid\(/.test(lees(f)), `${f} controleert het lidmaatschap`);
  }
  check(/controleerLid\(/.test(lees("app/actions/login.ts")), "inloggen controleert het lidmaatschap");
  check(/controleerLid\(/.test(lees("app/auth/callback/route.ts")), "/auth/callback controleert het lidmaatschap");
  check(/veiligVervolg\(/.test(lees("app/auth/callback/route.ts")), "/auth/callback gebruikt veiligVervolg");
  check(!/x-forwarded-host|h\.get\('host'\)/.test(lees("app/actions/wachtwoord.ts")), "herstellink niet uit de Host-kop");

  const code = [...bestandenIn("app", (n) => /\.tsx?$/.test(n)), ...bestandenIn("lib", (n) => /\.tsx?$/.test(n)), ...bestandenIn("components", (n) => /\.tsx?$/.test(n)), "proxy.ts"];
  const zonderBewijs = [];
  const signUp = [];
  const claims = [];
  for (const f of code) {
    const src = lees(f);
    if (/createServiceRoleClient\(\s*\)/.test(src)) zonderBewijs.push(f);
    if (/\bsignUp\(/.test(src)) signUp.push(f);
    if (/\bgetClaims\(/.test(src)) claims.push(f);
  }
  check(zonderBewijs.length === 0, "createServiceRoleClient() altijd met bewijs", zonderBewijs.join(", "));
  check(signUp.length === 0, "nergens signUp( (geen registratie in de app)", signUp.join(", "));
  check(claims.length === 0, "nergens alleen getClaims() als toegangscontrole", claims.join(", "));
  check(/^import 'server-only';/m.test(lees("lib/supabase/service-role.ts")), "service-role.ts is server-only");
  check(/^import 'server-only';/m.test(lees("lib/auth/team.ts")), "lib/auth/team.ts is server-only");
  check(/createServiceRoleClient\(bewijs: TeamlidBewijs\)/.test(lees("lib/supabase/service-role.ts")), "service-role vraagt een TeamlidBewijs");
  check(fs.existsSync(path.join(ROOT, "app/geen-toegang/page.tsx")), "app/geen-toegang/page.tsx bestaat (buiten de shell)");

  const proxy = lees("proxy.ts");
  check(/'\/geen-toegang'/.test(proxy), "proxy kent /geen-toegang");
  check(/controleerLid\(/.test(proxy) && /signOut\(/.test(proxy), "proxy logt niet-teamleden uit");
  check(!/svg\|png\|jpg/.test(proxy), "proxy-matcher zonder algemene beeld-uitzondering");

  const m21 = lees("supabase/migrations/0021_team_en_taken.sql").replace(/--[^\n]*/g, ""); // zonder commentaar
  check(!/auth\.uid\(\)\)?\s+is not null/i.test(m21), "0021 maakt geen policy 'auth.uid() is not null'");
  check(/create or replace function public\.is_teamlid\(\)/.test(m21), "0021 definieert is_teamlid()");
  check(/revoke all on function %s from public, anon, authenticated/.test(m21), "0021 sluit create_invoice/update_invoice af");
  check(/revoke all on all tables in schema public from anon/.test(m21), "0021 ontneemt anon alle rechten");
  for (const f of ["UITVOEREN_IN_SQL_EDITOR.sql", "UITVOEREN_0020_UITGAVEN.sql", "UITVOEREN_0021_TEAM.sql"]) {
    const sql = lees(`supabase/${f}`);
    const laatste = [...sql.matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].pop()?.[1];
    check(laatste === "0021_team_en_taken.sql", `${f} eindigt met 0021`, laatste || "geen");
  }

  const headers = lees("next.config.ts");
  for (const k of ["X-Frame-Options", "Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy"]) {
    check(headers.includes(`'${k}'`), `next.config.ts zet ${k}`);
  }
}

// ---------------------------------------------------------------------------------
// 4. Boekhouding en Account & mail (statisch)
// ---------------------------------------------------------------------------------
console.log("Boekhouding en Account & mail");
{
  const modules = lees("lib/modules.ts");
  check(/id: 'boekhouding'/.test(modules) && /href: '\/boekhouding'/.test(modules), "module boekhouding met href /boekhouding");
  check(/paden: \['\/boekhouding', '\/facturen', '\/uitgaven'\]/.test(modules), "boekhouding is actief op /facturen en /uitgaven");
  check(!/id: '(facturen|uitgaven)'/.test(modules), "geen losse modules facturen/uitgaven meer");
  check(/paden \?\? \[m\.href\]/.test(modules), "moduleVoorPad kijkt naar paden");
  check(!fs.existsSync(path.join(ROOT, "app/(app)/uitgaven")), "app/(app)/uitgaven bestaat niet meer");
  check(fs.existsSync(path.join(ROOT, "app/(app)/boekhouding/page.tsx")) && fs.existsSync(path.join(ROOT, "app/(app)/boekhouding/bonnetjes/page.tsx")), "/boekhouding en /boekhouding/bonnetjes bestaan");
  check(/source: '\/uitgaven', destination: '\/boekhouding\/bonnetjes'/.test(lees("next.config.ts")), "next.config.ts: /uitgaven → /boekhouding/bonnetjes");
  check(/BoekhoudingKop/.test(lees("app/(app)/facturen/layout.tsx")), "facturen-layout toont de Boekhouding-kop met subnavigatie");

  // Facturen inhoudelijk ongewijzigd t.o.v. stap 1 (alleen de layout mag anders).
  const { spawnSync } = await import("node:child_process");
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "4765da6", "--", "components/InvoiceForm.tsx", "components/InvoicesTable.tsx", "components/QuotesTable.tsx", "lib/invoice", "app/(app)/facturen", ":(exclude)app/(app)/facturen/layout.tsx"],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (diff.status === 0) check(diff.stdout.trim() === "", "facturenschermen, -componenten en lib/invoice ongewijzigd", diff.stdout.trim().replace(/\n/g, ", "));
  else console.log("  (git niet beschikbaar: facturen-diff overgeslagen)");

  const kern = lees("lib/mail/kluis-kern.ts");
  check(/'aes-256-gcm'/.test(kern) && /setAAD\(/.test(kern) && /randomBytes\(12\)/.test(kern), "kluis: AES-256-GCM, AAD en een nieuwe IV per keer");
  check(/^import 'server-only';/m.test(lees("lib/mail/kluis.ts")), "lib/mail/kluis.ts is server-only");
  check(/process\.env\.MAIL_ENCRYPTION_KEY/.test(lees("lib/mail/kluis.ts")), "kluis-sleutel komt uit MAIL_ENCRYPTION_KEY");
  check(!/\bwachtwoord(_enc)?\s*:/.test(lees("lib/account/mailbox.ts")), "mailboxstatus bevat geen wachtwoord");

  const clientBestanden = [...bestandenIn("app", (n) => /\.tsx?$/.test(n)), ...bestandenIn("lib", (n) => /\.tsx?$/.test(n)), ...bestandenIn("components", (n) => /\.tsx?$/.test(n))].filter((f) =>
    /^['"]use client['"]/m.test(lees(f))
  );
  const lek = clientBestanden.filter((f) => /wachtwoord_enc|process\.env\.MAIL_ENCRYPTION_KEY|mail\/kluis|SERVICE_ROLE_KEY|supabase\/service-role/.test(lees(f)));
  check(lek.length === 0, "geen client-code met wachtwoord_enc, kluis of sleutels", lek.join(", "));
  const mailboxCode = [...bestandenIn("app", (n) => /\.tsx?$/.test(n)), ...bestandenIn("lib", (n) => /\.tsx?$/.test(n))].filter((f) => /from\('user_mailboxes'\)/.test(lees(f)));
  check(mailboxCode.length > 0, "user_mailboxes wordt gebruikt");
  for (const f of mailboxCode) {
    const src = lees(f);
    const aantal = (src.match(/from\('user_mailboxes'\)/g) || []).length;
    const eigen = (src.match(/(eq\('user_id', lid\.userId\)|user_id: lid\.userId)/g) || []).length;
    check(eigen >= aantal, `${f}: user_mailboxes alleen met het eigen user-id`);
  }
  check(/doSTARTTLS/.test(lees("lib/mail/imap.ts")) && /isPubliekAdres/.test(lees("lib/mail/koppelen.ts")), "IMAP zonder TLS geweigerd; koppelen alleen naar openbare adressen");
}

// ---------------------------------------------------------------------------------
// 5. Taken op naam (statisch)
// ---------------------------------------------------------------------------------
console.log("Taken op naam");
{
  const planning = lees("components/dashboard/Planning.tsx");
  const agenda = lees("components/agenda/AgendaApp.tsx");
  check(!/<SnelInvoer\b/.test(planning) && !/<SnelInvoer\b/.test(agenda), "geen snelinvoer-tekstveld meer op dashboard en agenda");
  check(!fs.existsSync(path.join(ROOT, "components/agenda/SnelInvoer.tsx")), "SnelInvoer-component verwijderd (parser + test blijven)");
  check(fs.existsSync(path.join(ROOT, "lib/agenda/snelinvoer.ts")), "lib/agenda/snelinvoer.ts blijft (slim titelveld in de popup)");
  check(/<TakenProvider>/.test(agenda), "agenda gebruikt de taak-popup (TakenProvider)");
  check(/<DashboardTaken>/.test(lees("app/(app)/page.tsx")), "dashboard gebruikt de taak-popup (DashboardTaken)");
  check(/<TakenProvider>/.test(lees("components/taken/DashboardTaken.tsx")), "DashboardTaken bevat de TakenProvider");
  check(/useTaakDialoog\(\)/.test(lees("components/dashboard/TaakKnop.tsx")), "+ Taak opent de popup");
  const dialoog = lees("components/taken/TaakDialoog.tsx");
  check(/role="dialog"/.test(dialoog) && /aria-modal="true"/.test(dialoog), "taak-popup is een toegankelijke dialog (aria-modal)");
  check(/e\.key !== 'Tab'/.test(dialoog), "taak-popup houdt de focus binnen het venster");
  check(/Wijzigingen weggooien\?/.test(dialoog), "taak-popup vraagt bij Esc of wijzigingen weg mogen");
  check(/Opslaan en nog een/.test(dialoog), "taak-popup heeft 'Opslaan en nog een'");
  for (const c of ["VoorWieKiezer", "ProjectKiezer", "SubtakenLijst"]) check(fs.existsSync(path.join(ROOT, `components/taken/${c}.tsx`)), `components/taken/${c}.tsx bestaat`);

  const takenPost = lees("app/api/taken/route.ts");
  check(/rpc\('taak_aanmaken'/.test(takenPost), "nieuwe taak via rpc taak_aanmaken (één transactie)");
  check(/controleerTeamleden\(/.test(takenPost), "toegewezenen worden gecontroleerd (actieve teamleden)");
  for (const f of ["app/api/taken/[id]/route.ts", "app/api/taken/[id]/subtaken/route.ts", "app/api/taken/[id]/subtaken/[sid]/route.ts"]) {
    const src = lees(f);
    const muterend = (src.match(/export async function (PATCH|DELETE|POST)/g) || []).length;
    const gecontroleerd = (src.match(/magTaakWijzigen\(/g) || []).length;
    check(muterend > 0 && gecontroleerd >= muterend, `${f}: wijzigen alleen als maker of toegewezene`);
  }
  {
    const src = lees("app/api/afspraken/[id]/route.ts");
    check((src.match(/magAfspraakWijzigen\(/g) || []).length >= 2, "afspraken: wijzigen/verwijderen alleen als maker of deelnemer");
  }
  const repo = lees("lib/agenda/repo.ts");
  check(/wie:task_assignees!inner\(user_id\)/.test(repo) && /wie:event_attendees!inner\(user_id\)/.test(repo), "'mijn' lijsten filteren op toewijzing/deelname");
  check(/agendaBereik\(bron, vandaag, plusDagen\(vandaag, 6\), 'ik'\)/.test(repo) && /takenVoorFilter\(bron, 'telaat', vandaag, \{ wie: 'ik' \}\)/.test(repo), "dashboard toont alleen je eigen taken en afspraken");
  check(/rpc\('taak_betrokken'/.test(repo) && /rpc\('afspraak_betrokken'/.test(repo), "rechtencontrole gebruikt dezelfde functies als de RLS");
  check(/bronVan\(lid\)/.test(lees("components/dashboard/PlanningWidgets.tsx")), "dashboardplanning per ingelogd teamlid");
  for (const f of ["app/api/projecten/route.ts", "app/api/projecten/[id]/route.ts", "app/api/team/route.ts", "app/(app)/agenda/projecten/page.tsx"]) {
    check(fs.existsSync(path.join(ROOT, f)), `${f} bestaat`);
  }
  check(!/email/.test(lees("app/api/team/route.ts").replace(/\/\/[^\n]*/g, "")), "/api/team geeft geen e-mailadressen");
  const m21 = lees("supabase/migrations/0021_team_en_taken.sql");
  check(/create policy "betrokkenen wijzigen taken"[\s\S]*?taak_betrokken\(id\)/.test(m21), "0021: taak wijzigen alleen door betrokkenen (RLS)");
  check(/is_actief_teamlid\(user_id\)/.test(m21), "0021: toewijzen alleen aan actieve teamleden (RLS)");
}

// ---------------------------------------------------------------------------------
// 6. Afronding: SQL-bestand, documentatie en RLS-test (statisch)
// ---------------------------------------------------------------------------------
console.log("Afronding (SQL, documentatie, RLS-test)");
{
  const team = lees("supabase/UITVOEREN_0021_TEAM.sql");
  const tx = team.slice(0, team.lastIndexOf("-- Controle:"));
  check((tx.match(/^begin;$/gm) || []).length === 1 && (tx.match(/^commit;$/gm) || []).length === 1, "UITVOEREN_0021_TEAM.sql: alles in één transactie");
  for (const regel of ["geen open policies (public)", "geen open policies (storage)", "elke policy vereist teamlid", "storage alleen teamleden", "geen openbare buckets", "user_mailboxes zonder policies", "factuurfuncties dicht voor app-rollen"]) {
    check(team.includes(`('${regel}'`), `controletabel 0021: '${regel}'`);
  }
  for (const f of ["supabase/UITVOEREN_IN_SQL_EDITOR.sql", "supabase/UITVOEREN_0020_UITGAVEN.sql"]) {
    check(lees(f).includes("('elke policy vereist teamlid'"), `${f}: ook de teamcontrole`);
  }
  {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/genereer-sql-editor.mjs"), "--controleer"], { encoding: "utf8" });
    check(r.status === 0, "SQL-bestanden actueel (genereer-sql-editor --controleer)", (r.stderr || "").trim());
  }
  const m21 = lees("supabase/migrations/0021_team_en_taken.sql");
  check(/function public\.behoud_created_by\(\)[\s\S]*?not exists \(select 1 from auth\.users/.test(m21), "0021: 'aangemaakt door'-trigger laat 'on delete set null' toe");
  check(fs.existsSync(path.join(ROOT, "scripts/test-rls.mjs")), "scripts/test-rls.mjs bestaat");
  const pkg = JSON.parse(lees("package.json"));
  check(!!pkg.devDependencies?.["@electric-sql/pglite"] && !pkg.dependencies?.["@electric-sql/pglite"], "PGlite alleen als devDependency");
  const readme = lees("README.md");
  check(/"Allow new users to sign up" UIT/.test(readme), "README: aanmelden uitzetten in Supabase");
  check(/teamlid-toevoegen\.mjs/.test(readme) && /teamlid-verwijderen\.mjs/.test(readme), "README: teamlid-scripts");
  check(/\*\*Rollen\*\*/.test(readme) && /`eigenaar`/.test(readme), "README: rollen uitgelegd");
  check(/test-rls\.mjs/.test(readme) && /elke policy vraagt om teamlidmaatschap/.test(readme), "README: RLS-test en controletabel");
  check(/MAIL_ENCRYPTION_KEY/.test(readme) && /Boekhouding/.test(readme) && /\/agenda\/projecten/.test(readme), "README: mailsleutel, Boekhouding en projecten");
  const env = lees(".env.local.example");
  check(/^MAIL_ENCRYPTION_KEY=$/m.test(env) && /openssl rand -base64 32/.test(env), ".env.local.example: MAIL_ENCRYPTION_KEY met uitleg");
  check(!/^[A-Z_]+=\S/m.test(env), ".env.local.example: geen ingevulde waarden");
}

// ---------------------------------------------------------------------------------
// 7. Team van twee, stap 1: welkomstflow en mailbox met één knop (statisch)
// ---------------------------------------------------------------------------------
console.log("Welkomstflow en mailbox met één knop");
{
  const welkom = lees("app/welkom/page.tsx");
  check(/vereisTeamlidPagina\('\/welkom'\)/.test(welkom), "/welkom begint met vereisTeamlidPagina()");
  check(/if \(lid\.welkomKlaar\) redirect\('\/'\)/.test(welkom), "/welkom stuurt door als de flow al klaar is");
  const layout = lees("app/(app)/layout.tsx");
  check(/if \(!lid\.welkomKlaar\) redirect\('\/welkom'\)/.test(layout), "layout stuurt een nieuw teamlid naar /welkom");
  const team = lees("lib/auth/team.ts");
  check(/welkomKlaar: true,\s*overgang: true/.test(team) && /welkomKlaar: welkomKlaarVan\(/.test(team), "team.ts: welkomKlaar (overgang = klaar)");
  const api = lees("app/api/account/welkom/route.ts");
  check(/teamlidRoute\(/.test(api) && /\.eq\('id', lid\.userId\)/.test(api) && !/createServiceRoleClient/.test(api), "/api/account/welkom: teamcheck, eigen profiel, geen service-role");
  const mb = lees("app/api/account/mailbox/route.ts");
  check(/instellingenVoor\(invoer\.email, zoekMx\)/.test(mb), "mailbox: servers afgeleid uit het adres");
  check(/provider_microsoft/.test(mb) && /provider_onbekend/.test(mb), "mailbox: Outlook en onbekende provider netjes geweigerd");
  check(/magProberen\(lid\.userId\)/.test(mb) && /testMailbox\(invoer, hint\)/.test(mb) && /versleutel\(invoer\.wachtwoord, lid\.userId\)/.test(mb), "mailbox: rate limit, test en versleuteling blijven");
  const koppel = lees("lib/mail/koppelen.ts");
  check(/isPubliekAdres/.test(koppel) && /servername: m\.imapHost/.test(koppel), "koppelen: SSRF-controle ongewijzigd (openbaar IP + SNI)");
  check(!/from '\.\/|from "@\//.test(lees("lib/mail/providers.ts")), "providers.ts zonder imports (ook in de browser)");
  check(/import 'server-only'/.test(lees("lib/mail/mx.ts")), "MX-lookup alleen op de server");
  for (const f of ["components/welkom/WelkomFlow.tsx", "components/mail/NietGekoppeld.tsx", "components/account/AccountApp.tsx"]) {
    check(/MailboxSnelKoppelen/.test(lees(f)), `${f} gebruikt MailboxSnelKoppelen`);
  }
  check(!/wachtwoord_enc|MAIL_ENCRYPTION_KEY/.test(lees("components/account/MailboxSnelKoppelen.tsx")), "koppelcomponent kent geen versleuteld wachtwoord of sleutel");
  const m22 = lees("supabase/migrations/0022_team_crm.sql");
  check(/add column if not exists welkom_klaar_op/.test(m22) && /grant update \(welkom_klaar_op\) on public\.profiles to authenticated/.test(m22), "0022: kolom en grant voor welkom_klaar_op");
  check(!/grant update on public\.profiles|grant all/i.test(m22), "0022: geen brede grant op profiles");
}

if (ALLEEN_STATISCH) eindig();

// ---------------------------------------------------------------------------------
// 3. Routes zoeken in app/
// ---------------------------------------------------------------------------------
const DUMMY = {
  id: "00000000-0000-0000-0000-000000000000",
  clientId: "00000000-0000-0000-0000-000000000000",
  file: "rooktest.html",
  uid: "1",
  deel: "1",
  sid: "00000000-0000-0000-0000-000000000000",
};
function routesIn(map) {
  const uit = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (e.name === "page.tsx" || e.name === "route.ts") uit.push(p);
    }
  })(path.join(ROOT, map));
  return uit.map((bestand) => {
    const rel = path.relative(path.join(ROOT, "app"), path.dirname(bestand));
    const url =
      "/" +
      rel
        .split(path.sep)
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .map((s) => s.replace(/^\[(.+)\]$/, (_m, n) => DUMMY[n] ?? "x"))
        .join("/");
    const src = fs.readFileSync(bestand, "utf8");
    const methoden = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    return { bestand: path.relative(ROOT, bestand), url: url === "/" ? "/" : url.replace(/\/$/, ""), pagina: bestand.endsWith("page.tsx"), methoden };
  });
}
const alles = routesIn("app");
const PUBLIEK = new Set(["/login", "/wachtwoord-vergeten", "/auth/callback", "/auth/uitloggen", "/geen-toegang"]);

async function vraag(url, init = {}) {
  return fetch(BASIS + url, { redirect: "manual", ...init });
}
const naarLogin = (r) => r.status >= 300 && r.status < 400 && new URL(r.headers.get("location") || "/", BASIS).pathname === "/login";

try {
  await fetch(BASIS + "/login", { redirect: "manual" });
} catch {
  console.log(`\nGeen server op ${BASIS}. Start eerst: npm run build && npx next start -p 3107`);
  process.exit(2);
}

console.log(`\nPagina's zonder sessie -> /login  (${BASIS})`);
for (const r of alles.filter((r) => (r.pagina || r.url === "/social") && !PUBLIEK.has(r.url))) {
  const res = await vraag(r.url);
  check(naarLogin(res), `${r.url}`, `status ${res.status} ${res.headers.get("location") || ""}`);
}
{
  const res = await vraag("/social/index.html");
  check(res.status >= 300 && res.status < 400, "/social/index.html stuurt door", `status ${res.status}`);
}

console.log("API's en bestanden zonder sessie -> JSON-401");
for (const r of alles.filter((r) => !r.pagina && !PUBLIEK.has(r.url) && r.url !== "/social")) {
  for (const m of r.methoden) {
    const init = { method: m, headers: { origin: BASIS } };
    if (m !== "GET" && m !== "DELETE") {
      init.headers["content-type"] = "application/json";
      init.body = "{}";
    }
    const res = await vraag(r.url, init);
    const type = res.headers.get("content-type") || "";
    check(res.status === 401 && type.includes("application/json"), `${m} ${r.url}`, `status ${res.status} ${type}`);
  }
}
// Paden die op een afbeelding eindigen gaan ook door de proxy (en de route weigert zelf).
for (const url of ["/social-files/brand/logo-licht.png", "/social-files/projects/x/assets/foto.png", "/api/taken/x.png", "/api/invoices/x.jpg/pdf"]) {
  const res = await vraag(url);
  check(res.status === 401, `GET ${url} (eindigt op een beeldextensie)`, `status ${res.status}`);
}
{
  // Een POST van een ander domein zonder sessie: ook 401 (eerst de sessie, dan de herkomst).
  const res = await vraag("/api/taken", { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
  check(res.status === 401, "cross-site POST zonder sessie -> 401", `status ${res.status}`);
}

{
  // Taken op naam: ook met parameters geen gegevens zonder sessie.
  for (const url of ["/api/taken?filter=uitgedeeld", "/api/taken?wie=team", "/api/agenda?van=2026-01-01&tot=2026-01-07&wie=team", "/api/projecten?status=alle", "/api/team"]) {
    const res = await vraag(url);
    check(res.status === 401, `GET ${url} zonder sessie -> 401`, `status ${res.status}`);
  }
  const res = await vraag("/agenda?wie=team&project=00000000-0000-0000-0000-000000000000");
  check(naarLogin(res), "/agenda?wie=team -> /login", `status ${res.status}`);
}

console.log("Openbare pagina's en bestanden");
for (const url of ["/login", "/wachtwoord-vergeten", "/geen-toegang"]) {
  const res = await vraag(url);
  const tekst = res.status === 200 ? await res.text() : "";
  check(res.status === 200, `${url} laadt`, `status ${res.status}`);
  check(/\/brand\/banner-licht\.png/.test(tekst), `${url} toont het Studio Levant-logo`);
  check(!/sl-rail"/.test(tekst), `${url} heeft geen rail`);
}
for (const url of ["/brand/beeldmerk-licht.png", "/brand/banner-licht.png", "/shell/shell.css", "/shell/shell.js", "/icon.png"]) {
  const res = await vraag(url);
  check(res.status === 200, `${url} openbaar`, `status ${res.status}`);
}
// De social-frontend zelf blijft achter de login.
for (const url of ["/social/app.js", "/social/app.css"]) {
  const res = await vraag(url);
  check(naarLogin(res), `${url} achter login`, `status ${res.status}`);
}

console.log("Beveiligingskoppen");
for (const url of ["/login", "/geen-toegang", "/api/taken"]) {
  const res = await vraag(url);
  check(res.headers.get("x-frame-options") === "SAMEORIGIN", `${url}: X-Frame-Options`, res.headers.get("x-frame-options") || "ontbreekt");
  check(res.headers.get("referrer-policy") === "same-origin", `${url}: Referrer-Policy`, res.headers.get("referrer-policy") || "ontbreekt");
  check(res.headers.get("x-content-type-options") === "nosniff", `${url}: nosniff`);
}
{
  const res = await vraag("/geen-toegang");
  const tekst = res.status === 200 ? await res.text() : "";
  check(/Geen toegang/.test(tekst) && /href="\/login"/.test(tekst), "/geen-toegang toont uitleg en link naar /login");
}

console.log("Kernpagina's: precies 307 naar /login");
for (const url of ["/", "/boekhouding", "/boekhouding/bonnetjes", "/account", "/facturen", "/agenda/projecten", "/welkom"]) {
  const res = await vraag(url);
  check(res.status === 307 && naarLogin(res), url, `status ${res.status} ${res.headers.get("location") || ""}`);
}

console.log("Oude adressen");
for (const [van, naar] of [
  ["/uitgaven", "/boekhouding/bonnetjes"],
  ["/uitgaven?toevoegen=1", "/boekhouding/bonnetjes?toevoegen=1"],
  ["/uitgaven?uitgave=00000000-0000-0000-0000-000000000000", "/boekhouding/bonnetjes?uitgave=00000000-0000-0000-0000-000000000000"],
]) {
  const res = await vraag(van);
  const loc = new URL(res.headers.get("location") || "/", BASIS);
  check(res.status === 307 && loc.pathname + loc.search === naar, `${van} -> ${naar}`, `status ${res.status} ${res.headers.get("location") || ""}`);
}

console.log("Uitloggen");
{
  const vreemd = await vraag("/auth/uitloggen", { method: "POST", headers: { origin: "https://evil.example" } });
  check(vreemd.status === 403, "ander domein -> 403", `status ${vreemd.status}`);
  const eigen = await vraag("/auth/uitloggen", { method: "POST", headers: { origin: BASIS } });
  check(eigen.status === 303 && naarLogin(eigen), "eigen domein -> 303 /login", `status ${eigen.status}`);
}

eindig();

function eindig() {
  console.log(`\n${goed} geslaagd, ${fouten} mislukt`);
  process.exit(fouten ? 1 : 0);
}
