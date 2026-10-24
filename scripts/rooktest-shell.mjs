// Rooktest voor de gedeelde shell en de toegangscontrole, zonder in te loggen en zonder
// iets te schrijven.
//
// 1. Statisch: de React-rail (components/shell/Rail.tsx + RailNav.tsx) en de HTML-rail
//    voor social (railHtml in lib/shell/rail.ts) gebruiken dezelfde items, classes, links
//    en logo.
// 2. Statisch: de teamtoegang (lib/auth/team.ts) zit overal vóór:
//    - elke API-route gebruikt de helper of een wrapper die hem aanroept;
//    - elke pagina in app/(app) begint met vereisTeamlidPagina();
//    - createServiceRoleClient() krijgt altijd een bewijs; nergens signUp(; getClaims alleen in
//      proxy.ts (eerste linie) — de echte teamcheck (lib/auth/team.ts) gebruikt getUser;
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
// 8. Statisch, team van twee — stap 2 (wie ziet welke taak):
//    - geen teamweergave meer (WieFilter, "Heel team", ?wie=); de API kent geen wie-parameter;
//    - tab "Uitgezet" (anti-join in SQL), dashboard alleen met het aantal uitgezet;
//    - 0022: leesregels op taken/toewijzingen/subtaken/afspraken/deelnemers, met teamcheck.
// Live: /agenda?wie=team zonder sessie -> /login; /api/taken?filter=uitgezet -> 401.
// 9. Statisch, team van twee — stap 3 (klanten & projecten):
//    - één rail-tab "Klanten" (/klanten + /projecten), toen 6 items (nu 7, met Bestanden); /agenda/projecten stuurt door;
//    - nieuwe routes via de teamcheck; 0022: clients-kolommen, client_notes, project_eigenaren
//      met RLS (is_teamlid), projectstatus gepland/bezig/afgerond.
// Live: /klanten, /projecten, /klanten/<id>, /projecten/<id> en /agenda/projecten zonder
//       sessie -> /login; /api/klanten* -> 401.
// 11. Statisch, projectenbord (0023): bord + lijst, stappenbalk, dashboardkaart, oude
//     statussen nergens meer als keuze; UITVOEREN_0023.sql in één transactie.
// Live: /projecten?weergave=bord|lijst zonder sessie -> /login; PATCH /api/projecten/<id> -> 401.
// 12. Statisch, Bestanden (Google Drive, 0024): module in de rail (7 items), elke /api/drive-
//     route via de teamcheck, koppelen/ontkoppelen/kopiëren alleen voor de eigenaar, tokens
//     alleen server-side, upload rechtstreeks naar Google, kopieën na het antwoord (after),
//     blok op klant- en projectpagina; UITVOEREN_0024.sql in één transactie.
// Live: /bestanden (ook ?map=…) zonder sessie -> /login; /api/drive/* (ook de callback en
//       het koppelen) -> 401.
// 13. Statisch, meerdere inboxen (0026): tabel mailboxen alleen in lib/mail/mailboxen.ts en
//     beheer.ts, wijzigen/ontkoppelen alleen eigen rijen, ontsleutelen met eigenaar_id,
//     IMAP/SMTP via het gecontroleerde openbare IP, de koppelroutes via lib/mail/beheer.ts.
// Live: /api/mail/inboxen en /api/account/mailboxen(/<id>) zonder sessie -> 401 (automatisch).
// 14. Beveiliging (0026 deel 2): elke /api/beveiliging-route via eigenaarRoute/tfaRoute; de
//     proxy zet de CSP (nonce) en het sessiebeleid.
// Live: CSP met nonce op pagina's (en de nonce op elk script), HSTS, COOP en CORP; de openbare
//       logo's zonder CORP; API's met Cache-Control no-store; /login/2fa, /beveiliging en
//       /beveiliging/instellen zonder sessie -> /login; /login?reden=verlopen toont uitleg.
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
  // eigenaarRoute = teamlidRoute + eigenaar + aal2; tfaRoute = sessie van een teamlid (ook
  // vóór de 2FA-code), alleen voor de 2FA-routes zelf (geen service-role).
  const WRAPPERS = /\b(teamlidRoute|controleerRoute|metSessie|mailRoute|uitgavenRoute|driveRoute|eigenaarRoute|tfaRoute|route)(?:<\w+>)?\(/;
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
  check(/(controleerLid|toegangStatus)\(/.test(lees("app/actions/login.ts")), "inloggen controleert het lidmaatschap");
  check(/(controleerLid|toegangStatus)\(/.test(lees("app/auth/callback/route.ts")), "/auth/callback controleert het lidmaatschap");
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
    if (/\bgetClaims\(/.test(src) && f !== "proxy.ts") claims.push(f);
  }
  check(zonderBewijs.length === 0, "createServiceRoleClient() altijd met bewijs", zonderBewijs.join(", "));
  check(signUp.length === 0, "nergens signUp( (geen registratie in de app)", signUp.join(", "));
  check(claims.length === 0, "getClaims() alleen in proxy.ts (de teamcheck zelf gebruikt getUser)", claims.join(", "));
  check(/sb\.auth\.getUser\(\)/.test(lees("lib/auth/team.ts")), "lib/auth/team.ts controleert de sessie met getUser()");
  check(/^import 'server-only';/m.test(lees("lib/supabase/service-role.ts")), "service-role.ts is server-only");
  check(/^import 'server-only';/m.test(lees("lib/auth/team.ts")), "lib/auth/team.ts is server-only");
  check(/createServiceRoleClient\(bewijs: TeamlidBewijs\)/.test(lees("lib/supabase/service-role.ts")), "service-role vraagt een TeamlidBewijs");
  check(fs.existsSync(path.join(ROOT, "app/geen-toegang/page.tsx")), "app/geen-toegang/page.tsx bestaat (buiten de shell)");

  const proxy = lees("proxy.ts");
  check(/'\/geen-toegang'/.test(proxy), "proxy kent /geen-toegang");
  check(/(controleerLid|toegangStatus)\(/.test(proxy) && /signOut\(/.test(proxy), "proxy logt niet-teamleden uit");
  check(!/svg\|png\|jpg/.test(proxy), "proxy-matcher zonder algemene beeld-uitzondering");

  const m21 = lees("supabase/migrations/0021_team_en_taken.sql").replace(/--[^\n]*/g, ""); // zonder commentaar
  check(!/auth\.uid\(\)\)?\s+is not null/i.test(m21), "0021 maakt geen policy 'auth.uid() is not null'");
  check(/create or replace function public\.is_teamlid\(\)/.test(m21), "0021 definieert is_teamlid()");
  check(/revoke all on function %s from public, anon, authenticated/.test(m21), "0021 sluit create_invoice/update_invoice af");
  check(/revoke all on all tables in schema public from anon/.test(m21), "0021 ontneemt anon alle rechten");
  for (const f of ["UITVOEREN_IN_SQL_EDITOR.sql", "UITVOEREN_0020_UITGAVEN.sql", "UITVOEREN_0021_TEAM.sql", "UITVOEREN_0022.sql"]) {
    const sql = lees(`supabase/${f}`);
    const delen = [...sql.matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].map((m) => m[1]);
    // 0021 (alleen teamleden) en daarna 0022 (taken alleen voor betrokkenen) sluiten af;
    // in de grote bestanden volgen alleen nog 0023 (projectstatus, geen policies), 0024
    // (nieuwe Drive-tabellen, policies met teamcheck) en 0025 (kolommen, geen policies).
    const ok =
      f === "UITVOEREN_0022.sql"
        ? delen.join(",") === "0022_team_crm.sql"
        : delen.slice(-5).join(",") === "0021_team_en_taken.sql,0022_team_crm.sql,0023_projectstatus.sql,0024_drive.sql,0025_crm_opvolging.sql";
    check(ok, `${f} eindigt met 0021 + 0022 (+ 0023 + 0024 + 0025)`, delen.slice(-5).join(", ") || "geen");
  }
  {
    const delen = [...lees("supabase/UITVOEREN_0023.sql").matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].map((m) => m[1]);
    check(delen.join(",") === "0023_projectstatus.sql", "UITVOEREN_0023.sql bevat alleen 0023", delen.join(", "));
    const m23 = lees("supabase/migrations/0023_projectstatus.sql").replace(/--[^\n]*/g, "");
    check(!/create policy|drop policy|grant /i.test(m23), "0023 raakt geen policies of rechten (RLS is_teamlid blijft)");
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

  // Facturen inhoudelijk ongewijzigd t.o.v. stap 1 (alleen de layout mag anders, en op de
  // facturen-klantpagina staat alleen een extra link naar Klanten & projecten).
  const { spawnSync } = await import("node:child_process");
  const KLANT = "app/(app)/facturen/klanten/[clientId]/page.tsx";
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "4765da6", "--", "components/InvoiceForm.tsx", "components/InvoicesTable.tsx", "components/QuotesTable.tsx", "lib/invoice", "app/(app)/facturen", ":(exclude)app/(app)/facturen/layout.tsx", `:(exclude)${KLANT}`],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (diff.status === 0) {
    check(diff.stdout.trim() === "", "facturenschermen, -componenten en lib/invoice ongewijzigd", diff.stdout.trim().replace(/\n/g, ", "));
    const k = spawnSync("git", ["diff", "-U0", "4765da6", "--", KLANT], { cwd: ROOT, encoding: "utf8" });
    const regels = k.stdout.split("\n").filter((r) => /^[+-](?![+-])/.test(r));
    const weg = regels.filter((r) => r.startsWith("-"));
    const erbij = regels.filter((r) => r.startsWith("+")).join("\n");
    check(
      weg.length === 0 && /href=\{`\/klanten\/\$\{klant\.id\}`\}/.test(erbij) && !/supabase|from\(|await /.test(erbij),
      "facturen-klantpagina: alleen een link naar de klantpagina toegevoegd",
      regels.join(" | ")
    );
  } else console.log("  (git niet beschikbaar: facturen-diff overgeslagen)");

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
  check(/doSTARTTLS/.test(lees("lib/mail/imap.ts")) && /openbaarAdres/.test(lees("lib/mail/koppelen.ts")) && /isPubliekAdres/.test(lees("lib/mail/dns.ts")), "IMAP zonder TLS geweigerd; koppelen alleen naar openbare adressen");
  check(/openbaarAdres\(cfg\.imapHost\)/.test(lees("lib/mail/imap.ts")) && /openbaarAdres\(cfg\.smtpHost\)/.test(lees("lib/mail/smtp.ts")), "IMAP en SMTP ook na het koppelen via het gecontroleerde openbare IP (geen DNS-rebinding)");
  // Meerdere inboxen (0026): mailboxen alleen via de server; wijzigen/ontkoppelen alleen eigen rijen.
  const beheer = lees("lib/mail/beheer.ts");
  const wijzigMb = [...beheer.matchAll(/from\('mailboxen'\)\s*\.(update|delete)\([^)]*\)([^;]*);/g)];
  check(wijzigMb.length >= 4 && wijzigMb.every((w) => /\.eq\('eigenaar_id', lid\.userId\)/.test(w[2])), "mailboxen: wijzigen en ontkoppelen alleen eigen rijen", `${wijzigMb.length}`);
  check(/ontsleutelMailbox\(rij\.wachtwoord_enc, rij\.eigenaar_id, rij\.id\)/.test(lees("lib/mail/mailboxen.ts")) && /isZichtbaar\(/.test(lees("lib/mail/mailboxen.ts")), "mailboxen: ontsleutelen met eigenaar_id + mailbox-id (v2) of eigenaar_id (v1), zichtbaarheid server-side");
  const metMailboxen = [...bestandenIn("app", (n) => /\.tsx?$/.test(n)), ...bestandenIn("lib", (n) => /\.tsx?$/.test(n)), ...bestandenIn("components", (n) => /\.tsx?$/.test(n))].filter((f) => /from\('mailboxen'\)/.test(lees(f)));
  check(metMailboxen.every((f) => f === "lib/mail/mailboxen.ts" || f === "lib/mail/beheer.ts"), "tabel mailboxen alleen in lib/mail/mailboxen.ts en beheer.ts", metMailboxen.join(", "));
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
  {
    const dp = repo.slice(repo.indexOf("export async function dashboardPlanning"), repo.indexOf("export async function dashboardPlanning") + 1600);
    check(/const persoon = persoonVoor\(bron\)/.test(dp) && /tq = tq\.eq\('wie\.user_id', persoon\)/.test(dp) && /aq = aq\.eq\('wie\.user_id', persoon\)/.test(dp) && /export function persoonVoor\(bron: AgendaBron\)/.test(repo), "dashboard toont alleen je eigen taken en afspraken");
  }
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
  check(/MAIL_ENCRYPTION_KEY/.test(readme) && /Boekhouding/.test(readme) && /\/projecten/.test(readme) && /Klanten &amp; projecten|Klanten & projecten/.test(readme), "README: mailsleutel, Boekhouding en Klanten & projecten");
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
  // Sinds 2FA: /welkom leest de status zelf (ook de 2FA-stap vóór de code) en stuurt anoniem,
  // geen-lid en storing net zo door als vereisTeamlidPagina().
  check(
    /vereisTeamlidPagina\('\/welkom'\)/.test(welkom) ||
      (/huidigTeamlid\(\)/.test(welkom) && /'anoniem'\) redirect\('\/login/.test(welkom) && /'geen_toegang'\) redirect\('\/geen-toegang'\)/.test(welkom)),
    "/welkom controleert sessie en lidmaatschap"
  );
  check(/if \(lid\.welkomKlaar\) redirect\('\/'\)/.test(welkom), "/welkom stuurt door als de flow al klaar is");
  const layout = lees("app/(app)/layout.tsx");
  check(/if \(!lid\.welkomKlaar\) redirect\('\/welkom'\)/.test(layout), "layout stuurt een nieuw teamlid naar /welkom");
  const team = lees("lib/auth/team.ts");
  check(/welkomKlaar: true,\s*overgang: true/.test(team) && /welkomKlaar = welkomKlaarVan\(|welkomKlaar: welkomKlaarVan\(/.test(team), "team.ts: welkomKlaar (overgang = klaar)");
  const api = lees("app/api/account/welkom/route.ts");
  check(/teamlidRoute\(/.test(api) && /\.eq\('id', lid\.userId\)/.test(api) && !/createServiceRoleClient/.test(api), "/api/account/welkom: teamcheck, eigen profiel, geen service-role");
  const mb = lees("lib/mail/beheer.ts");
  check(/koppelMailbox\(lid, o, request\)/.test(lees("app/api/account/mailbox/route.ts")) && /koppelMailbox\(lid, /.test(lees("app/api/account/mailboxen/route.ts")), "mailbox-routes koppelen via lib/mail/beheer.ts");
  check(/instellingenVoor\(invoer\.email, zoekMx\)/.test(mb), "mailbox: servers afgeleid uit het adres");
  check(/provider_microsoft/.test(mb) && /provider_onbekend/.test(mb), "mailbox: Outlook en onbekende provider netjes geweigerd");
  check(/magProberen\(lid\.userId\)/.test(mb) && /testMailbox\(invoer, hint\)/.test(mb) && /versleutel\(invoer\.wachtwoord, lid\.userId\)/.test(mb), "mailbox: rate limit, test en versleuteling blijven");
  const koppel = lees("lib/mail/koppelen.ts");
  check(/openbaarAdres\(m\.imapHost\)/.test(koppel) && /servername: m\.imapHost/.test(koppel) && /isPubliekAdres/.test(lees("lib/mail/dns.ts")), "koppelen: SSRF-controle ongewijzigd (openbaar IP + SNI)");
  check(!/from '\.\/|from "@\//.test(lees("lib/mail/providers.ts")), "providers.ts zonder imports (ook in de browser)");
  check(/import 'server-only'/.test(lees("lib/mail/mx.ts")), "MX-lookup alleen op de server");
  for (const f of ["components/welkom/WelkomFlow.tsx", "components/mail/NietGekoppeld.tsx", "components/account/Mailboxen.tsx"]) {
    check(/MailboxSnelKoppelen/.test(lees(f)), `${f} gebruikt MailboxSnelKoppelen`);
  }
  check(!/wachtwoord_enc|MAIL_ENCRYPTION_KEY/.test(lees("components/account/MailboxSnelKoppelen.tsx")), "koppelcomponent kent geen versleuteld wachtwoord of sleutel");
  const m22 = lees("supabase/migrations/0022_team_crm.sql");
  check(/add column if not exists welkom_klaar_op/.test(m22) && /grant update \(welkom_klaar_op\) on public\.profiles to authenticated/.test(m22), "0022: kolom en grant voor welkom_klaar_op");
  check(!/grant update on public\.profiles|grant all/i.test(m22), "0022: geen brede grant op profiles");
}

// ---------------------------------------------------------------------------------
// 8. Team van twee, stap 2: wie ziet welke taak (statisch)
// ---------------------------------------------------------------------------------
console.log("Team van twee, stap 2 (wie ziet welke taak)");
{
  check(!fs.existsSync(path.join(ROOT, "components/agenda/WieFilter.tsx")), "WieFilter ('Heel team') verwijderd");
  const agenda = lees("components/agenda/AgendaApp.tsx").replace(/\/\/[^\n]*/g, "");
  check(!/Heel team|setWie|\bWIE_SLEUTEL\b/.test(agenda), "agenda: geen teamweergave of onthouden keuze meer");
  const page = lees("app/(app)/agenda/page.tsx");
  check(/if \(sp\.wie !== undefined\)[\s\S]*?redirect\(/.test(page), "/agenda?wie=… stuurt door zonder wie");
  check(/sp\.lijst === 'uitgezet'/.test(page), "/agenda?lijst=uitgezet opent de tab Uitgezet");
  for (const f of ["app/api/agenda/route.ts", "app/api/taken/route.ts"]) {
    check(!/get\('wie'\)|leesWie/.test(lees(f).replace(/\/\/[^\n]*/g, "")), `${f}: geen wie-parameter`);
  }
  const lijst = lees("components/agenda/Takenlijst.tsx");
  check(/\{ id: 'uitgezet', label: 'Uitgezet' \}/.test(lijst), "takenlijst: tab Uitgezet");
  const repo = lees("lib/agenda/repo.ts");
  check(/\.is\('mij', null\)/.test(repo) && /export async function uitgezetAantal/.test(repo), "Uitgezet: anti-join in SQL + teller");
  const planning = lees("components/dashboard/Planning.tsx");
  check(!/UitgedeeldKaart/.test(planning) && /\/agenda\?lijst=uitgezet/.test(planning), "dashboard: geen 'Uitgedeeld door jou'-rijen, wel de link");
  const m22 = lees("supabase/migrations/0022_team_crm.sql");
  for (const [tabel, naam] of [["tasks", "betrokkenen lezen taken"], ["task_assignees", "betrokkenen lezen toewijzingen"], ["task_subtasks", "betrokkenen lezen subtaken"], ["calendar_events", "betrokkenen lezen afspraken"], ["event_attendees", "betrokkenen lezen deelnemers"]]) {
    const re = new RegExp(`create policy "${naam}" on public\\.${tabel}[\\s\\S]*?is_teamlid\\(\\)`);
    check(re.test(m22), `0022: ${tabel} alleen voor betrokkenen (met teamcheck)`);
  }
  check(/create or replace function public\.taak_zichtbaar\(p_task uuid\)[\s\S]*?security definer/.test(m22), "0022: taak_zichtbaar() (security definer, geen recursie)");
  check(/create index if not exists tasks_maker_open_idx/.test(m22), "0022: index voor Uitgezet");
}

// ---------------------------------------------------------------------------------
// 9. Team van twee, stap 3: klanten & projecten (statisch)
// ---------------------------------------------------------------------------------
console.log("Team van twee, stap 3 (klanten & projecten)");
{
  const modules = lees("lib/modules.ts");
  const ids = [...modules.matchAll(/^\s{4}id: '([a-z]+)'/gm)].map((m) => m[1]);
  check(ids.length === 7 && ids.includes("klanten") && ids.includes("bestanden"), "rail: 7 items, waaronder Klanten en Bestanden", ids.join(","));
  check(/paden: \['\/klanten', '\/projecten'\]/.test(modules), "Klanten is actief op /klanten en /projecten");
  check(/redirect\('\/projecten'\)/.test(lees("app/(app)/agenda/projecten/page.tsx")), "/agenda/projecten stuurt door naar /projecten");
  for (const f of ["app/(app)/klanten/page.tsx", "app/(app)/klanten/[id]/page.tsx", "app/(app)/projecten/page.tsx", "app/(app)/projecten/[id]/page.tsx"]) {
    check(/vereisTeamlidPagina\(/.test(lees(f)), `${f}: teamcheck`);
  }
  for (const f of ["app/api/klanten/route.ts", "app/api/klanten/[id]/route.ts", "app/api/klanten/[id]/notities/route.ts", "app/api/klanten/[id]/notities/[notitieId]/route.ts"]) {
    check(/await metSessie\(request\)/.test(lees(f)), `${f}: teamcheck`);
  }
  const m22 = lees("supabase/migrations/0022_team_crm.sql");
  for (const t of ["client_notes", "project_eigenaren"]) {
    check(new RegExp(`alter table public\\.${t} enable row level security`).test(m22), `0022: RLS aan op ${t}`);
  }
  check(/check \(status in \('gepland', 'bezig', 'afgerond'\)\)/.test(m22) && /status = 'bezig' where status = 'actief'/.test(m22), "0022: projectstatus omgezet");
  check(/add column if not exists status text not null default 'actief'/.test(m22), "0022: klantstatus standaard 'actief' (facturen ongewijzigd)");
}

// ---------------------------------------------------------------------------------
// 10. Team van twee, stap 4: snelheid, SQL, README (statisch)
// ---------------------------------------------------------------------------------
console.log("Snelheid, UITVOEREN_0022.sql en README");
{
  const sql = lees("supabase/UITVOEREN_0022.sql");
  const tx = sql.slice(0, sql.lastIndexOf("-- Controle:"));
  check((tx.match(/^begin;$/gm) || []).length === 1 && (tx.match(/^commit;$/gm) || []).length === 1, "UITVOEREN_0022.sql: alles in één transactie");
  for (const regel of ["taken alleen voor betrokkenen", "geen open leesregels voor taken", "projectstatus omgezet", "eigenaren slaan de welkomstflow over", "functie taak_tellingen", "tellingen dicht voor anon", "indexen 0022"]) {
    check(sql.includes(`('${regel}'`), `controletabel 0022: '${regel}'`);
  }
  check(/teamlid: /.test(sql), "UITVOEREN_0022.sql toont wie er toegang heeft");
  const m22 = lees("supabase/migrations/0022_team_crm.sql");
  check(/function public\.taak_tellingen[\s\S]*?security invoker/.test(m22) && /function public\.project_taak_tellingen[\s\S]*?security invoker/.test(m22), "0022: tellingen als security invoker (RLS geldt)");
  check(/revoke all on function public\.taak_tellingen\(date, uuid, uuid\) from public, anon/.test(m22), "0022: taak_tellingen dicht voor anon");
  const proxy = lees("proxy.ts");
  check(/auth\.getClaims\(\)/.test(proxy) && !/auth\.getUser\(\)/.test(proxy), "proxy: token lokaal controleren (getClaims)");
  check(/const controleertZelf = isApi \|\| isRsc;/.test(proxy) && /!\/\\\.\[a-z0-9\]\+\$\/i\.test\(pad\)/.test(proxy), "proxy: lidcheck alleen overslaan voor API's en RSC zonder bestandsextensie");
  const dash = lees("app/(app)/page.tsx");
  check(!/await (mailConfigVoor|magEnvMailbox|mailboxVoor)/.test(dash) && /<InboxKaart lid=\{lid\} \/>/.test(dash), "dashboard wacht niet op de mailcheck");
  check(/agendaApi\.dashboard\(\)/.test(lees("components/dashboard/Planning.tsx")), "dashboard ververst met één verzoek");
  check((lees("lib/mail/beheer.ts").match(/vergeetMailboxen\(\)/g) || []).length >= 4, "mailbox-cache wordt gewist bij koppelen/wijzigen/ontkoppelen");
  check(!/teamProfielen\(lid\)[\s\S]{0,40}from\('profiles'\)/.test(lees("app/(app)/layout.tsx")), "layout vraagt geen profielen extra op");
  const readme = lees("README.md");
  check(/### Bram toevoegen in 3 stappen/.test(readme) && /UITVOEREN_0022\.sql/.test(readme), "README: Bram toevoegen in 3 stappen en UITVOEREN_0022.sql");
  check(/## Snelheid/.test(readme), "README: sectie Snelheid");
}

// ---------------------------------------------------------------------------------
// 11. Projectenbord (0023, statisch)
// ---------------------------------------------------------------------------------
console.log("Projectenbord (0023)");
{
  const sql = lees("supabase/UITVOEREN_0023.sql");
  const tx = sql.slice(0, sql.lastIndexOf("-- Controle:"));
  check((tx.match(/^begin;$/gm) || []).length === 1 && (tx.match(/^commit;$/gm) || []).length === 1, "UITVOEREN_0023.sql: alles in één transactie");
  check(/teamlid: /.test(sql) && /'ok'/.test(sql), "UITVOEREN_0023.sql: controletabel en wie er toegang heeft");
  const pagina = lees("app/(app)/projecten/page.tsx");
  check(pagina.indexOf("vereisTeamlidPagina(") > 0 && pagina.indexOf("vereisTeamlidPagina(") < pagina.indexOf("projectenLijst("), "/projecten: teamcheck vóór de data");
  check(/<ProjectenBord/.test(pagina), "/projecten toont het bord");
  check(/<ProjectInhoud /.test(lees("app/(app)/projecten/[id]/page.tsx")) && /<StatusStappen/.test(lees("components/crm/ProjectInhoud.tsx")), "projectpagina: stappenbalk");
  check(/<ProjectenWidget lid=\{lid\} \/>/.test(lees("app/(app)/page.tsx")), "dashboard: kaart Projecten");
  const ui = ["components/crm/NieuwProject.tsx", "components/crm/ProjectKop.tsx", "components/crm/ProjectenBord.tsx", "components/crm/StatusStappen.tsx"].map(lees).join("\n");
  check(!/'gepland'|"gepland"/.test(ui), "UI biedt 'gepland' nergens meer als keuze");
  check(/Wachten op goedkeuring/.test(lees("lib/crm/projectstatus.ts")), "label 'Wachten op goedkeuring'");
}

// ---------------------------------------------------------------------------------
// 12. Bestanden (Google Drive, 0024, statisch)
// ---------------------------------------------------------------------------------
console.log("Bestanden (Google Drive, 0024)");
{
  const sql = lees("supabase/UITVOEREN_0024.sql");
  const tx = sql.slice(0, sql.lastIndexOf("-- Controle:"));
  check((tx.match(/^begin;$/gm) || []).length === 1 && (tx.match(/^commit;$/gm) || []).length === 1, "UITVOEREN_0024.sql: alles in één transactie");
  const delen = [...sql.matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].map((m) => m[1]);
  check(delen.join(",") === "0024_drive.sql", "UITVOEREN_0024.sql bevat alleen 0024", delen.join(", "));
  for (const regel of ["drive_koppeling zonder policies", "drive_koppeling onleesbaar voor de app", "drive-tabellen alleen voor teamleden"]) {
    check(sql.includes(`('${regel}'`), `controletabel 0024: '${regel}'`);
  }
  const modules = lees("lib/modules.ts");
  check(/id: 'bestanden',[\s\S]*?href: '\/bestanden',[\s\S]*?icoon: 'bestanden'/.test(modules), "module Bestanden in het register (eigen icoon)");
  check(/bestanden:/.test(lees("lib/shell/iconen.ts")), "icoon 'bestanden' bestaat");
  const pagina = lees("app/(app)/bestanden/page.tsx");
  check(pagina.indexOf("vereisTeamlidPagina(") > 0 && pagina.indexOf("vereisTeamlidPagina(") < pagina.indexOf("driveStatus("), "/bestanden: teamcheck vóór de koppeling");
  for (const f of ["components/crm/KlantInhoud.tsx", "components/crm/ProjectInhoud.tsx"]) {
    check(/<BestandenBlok /.test(lees(f)), `${f}: blok Bestanden`);
  }
  for (const f of bestandenIn("app/api/drive", (n) => n === "route.ts")) {
    check(/\b(driveRoute|controleerRoute)\(/.test(lees(f)), `${f}: teamcheck`);
  }
  for (const f of ["app/api/drive/koppelen/route.ts", "app/api/drive/ontkoppelen/route.ts", "app/api/drive/kopieer-bestaande/route.ts"]) {
    check(/alleenEigenaar: true/.test(lees(f)), `${f}: alleen de eigenaar`);
  }
  check(/lid\.rol !== 'eigenaar'/.test(lees("app/api/drive/callback/route.ts")), "callback: alleen de eigenaar");
  check(/httpOnly: true/.test(lees("app/api/drive/koppelen/route.ts")) && /createHmac\('sha256'/.test(lees("lib/drive/state.ts")), "state: ondertekende httpOnly-cookie");
  check(/^import 'server-only';/m.test(lees("lib/drive/config.ts")) && /^import 'server-only';/m.test(lees("lib/drive/koppeling.ts")), "Drive-config en -koppeling zijn server-only");
  const clientCode = [...bestandenIn("components", (n) => /\.tsx?$/.test(n)), ...bestandenIn("app", (n) => /\.tsx?$/.test(n))].filter((f) => /^['"]use client['"]/m.test(lees(f)));
  const lek = clientCode.filter((f) => /refresh_token|GOOGLE_CLIENT|DRIVE_ENCRYPTION_KEY|drive\/config|drive\/koppeling/.test(lees(f)));
  check(lek.length === 0, "geen client-code met Drive-tokens of -sleutels", lek.join(", "));
  check(/xhr\.open\('PUT', uploadUrl\)/.test(lees("components/bestanden/driveApi.ts")), "upload gaat rechtstreeks naar Google (niet via Vercel)");
  check(/uploadType=resumable/.test(lees("lib/drive/kern.ts")), "resumable upload-sessie");
  check(/naDrive\(lid, 'factuur', resultaat\.id\)/.test(lees("app/api/invoices/route.ts")), "nieuwe factuur → kopie naar Drive (na het antwoord)");
  check(/import \{ after \} from 'next\/server'/.test(lees("lib/drive/kopieen.ts")) && /after\((taak|async)/.test(lees("lib/drive/kopieen.ts")), "kopieën via next/server after()");
  check(/\[drive\] \$\{label\}: MISLUKT/.test(lees("lib/drive/kopieen.ts")), "mislukte Drive-kopie gelogd met prefix [drive]");
  check(/alleenEigenaar: true/.test(lees("app/api/drive/diagnose/route.ts")), "Test Drive-koppeling alleen voor de eigenaar");
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
  for (const url of ["/api/taken?filter=uitgezet", "/api/taken?wie=team", "/api/agenda?van=2026-01-01&tot=2026-01-07&wie=team", "/api/projecten?status=alle", "/api/projecten?status=afgerond", "/api/team"]) {
    const res = await vraag(url);
    check(res.status === 401, `GET ${url} zonder sessie -> 401`, `status ${res.status}`);
  }
  const patch = await vraag("/api/projecten/00000000-0000-4000-8000-000000000000", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "wachten" }) });
  check(patch.status === 401, "PATCH /api/projecten/<id> (status) zonder sessie -> 401", `status ${patch.status}`);
  const res = await vraag("/agenda?wie=team&project=00000000-0000-0000-0000-000000000000");
  check(naarLogin(res), "/agenda?wie=team -> /login", `status ${res.status}`);
}
{
  // Bestanden (Google Drive): geen enkele Drive-route zonder sessie, ook niet de callback.
  for (const url of [
    "/api/drive/status",
    "/api/drive/map",
    "/api/drive/map?id=1AbCdEfGh",
    "/api/drive/map?klant=00000000-0000-4000-8000-000000000000",
    "/api/drive/map?project=00000000-0000-4000-8000-000000000000",
    "/api/drive/zoeken?q=offerte",
    "/api/drive/callback?code=x&state=y",
    "/api/drive/bestanden/1AbCdEfGh/inhoud",
    "/api/drive/bestanden/1AbCdEfGh/inhoud?download=1",
  ]) {
    const res = await vraag(url);
    check(res.status === 401, `GET ${url} zonder sessie -> 401`, `status ${res.status}`);
  }
  for (const [m, url] of [
    ["POST", "/api/drive/koppelen"],
    ["POST", "/api/drive/ontkoppelen"],
    ["POST", "/api/drive/upload"],
    ["POST", "/api/drive/kopieer-bestaande"],
    ["DELETE", "/api/drive/bestanden/1AbCdEfGh"],
  ]) {
    const res = await vraag(url, { method: m, headers: { origin: BASIS, "content-type": "application/json" }, body: m === "DELETE" ? undefined : "{}" });
    check(res.status === 401, `${m} ${url} zonder sessie -> 401`, `status ${res.status}`);
  }
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
for (const url of ["/", "/boekhouding", "/boekhouding/bonnetjes", "/account", "/facturen", "/agenda/projecten", "/welkom", "/klanten", "/klanten?nieuw=1", "/projecten", "/projecten?weergave=bord", "/projecten?weergave=lijst", "/klanten/00000000-0000-4000-8000-000000000000", "/projecten/00000000-0000-4000-8000-000000000000", "/bestanden", "/bestanden?map=1AbCdEfGh", "/bestanden?drive=gekoppeld"]) {
  const res = await vraag(url);
  check(res.status === 307 && naarLogin(res), url, `status ${res.status} ${res.headers.get("location") || ""}`);
}

console.log("RSC-verzoeken van de router (proxy slaat alleen de lidcheck over, nooit de sessiecheck)");
for (const [url, verwacht] of [["/", "login"], ["/klanten", "login"], ["/api/dashboard", 401], ["/api/taken?filter=vandaag", 401]]) {
  const res = await vraag(url, { headers: { rsc: "1", "next-router-prefetch": "1" } });
  const ok = verwacht === "login" ? naarLogin(res) : res.status === verwacht;
  check(ok, `${url} met rsc-header zonder sessie -> ${verwacht}`, `status ${res.status}`);
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

console.log("Beveiliging: CSP, HSTS, COOP/CORP, no-store, 2FA-pagina's");
{
  const res = await vraag("/login");
  const csp = res.headers.get("content-security-policy") || "";
  const tekst = res.status === 200 ? await res.text() : "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  check(Boolean(nonce), "/login: CSP met nonce", csp.slice(0, 120) || "ontbreekt");
  check(/frame-ancestors 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), "/login: CSP frame-ancestors/object-src/base-uri");
  check(!/script-src[^;]*'unsafe-inline'/.test(csp), "/login: geen unsafe-inline in script-src");
  const scripts = [...tekst.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  check(scripts.length > 0 && scripts.every((t) => t.includes(`nonce="${nonce}"`) || /\ssrc="\/_next\//.test(t)), "/login: elk inline script heeft de nonce", scripts.filter((t) => !t.includes("nonce")).slice(0, 2).join(" "));
  const tweede = await vraag("/login");
  check(/'nonce-([A-Za-z0-9+/=]+)'/.exec(tweede.headers.get("content-security-policy") || "")?.[1] !== nonce, "/login: nieuwe nonce per verzoek");
  for (const url of ["/login", "/api/taken", "/shell/shell.js"]) {
    const r = url === "/login" ? res : await vraag(url);
    check(/max-age=\d{8,}/.test(r.headers.get("strict-transport-security") || ""), `${url}: HSTS`, r.headers.get("strict-transport-security") || "ontbreekt");
    check(r.headers.get("cross-origin-opener-policy") === "same-origin", `${url}: COOP`);
    check(r.headers.get("cross-origin-resource-policy") === "same-origin", `${url}: CORP`);
  }
  const logo = await vraag("/brand/beeldmerk-licht.png");
  check(!logo.headers.get("cross-origin-resource-policy"), "/brand/: geen CORP (logo in mailhandtekening)");
  const api = await vraag("/api/taken");
  check(/no-store/.test(api.headers.get("cache-control") || ""), "/api/taken: Cache-Control no-store", api.headers.get("cache-control") || "");
  for (const url of ["/login/2fa", "/login/2fa?next=/facturen", "/beveiliging", "/beveiliging/instellen"]) {
    const r = await vraag(url);
    check(naarLogin(r), `${url} zonder sessie -> /login`, `status ${r.status} ${r.headers.get("location") || ""}`);
  }
  const verlopen = await vraag("/login?reden=verlopen");
  check(/automatisch uitgelogd/.test(await verlopen.text()), "/login?reden=verlopen legt uit waarom");
  const tfa = await vraag("/api/beveiliging/2fa/uitdagen", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: '{"code":"123456"}' });
  check(tfa.status === 401, "POST /api/beveiliging/2fa/uitdagen zonder sessie -> 401", `status ${tfa.status}`);
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
