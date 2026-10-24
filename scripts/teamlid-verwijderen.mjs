// Een teamlid de toegang ontnemen.
//
//   Standaard (deactiveren, omkeerbaar met teamlid-toevoegen.mjs):
//     - team_members.actief = false → de database (RLS via is_teamlid()) en de app laten
//       hem direct nergens meer bij, ook niet met een nog geldige sessie;
//     - het account wordt geblokkeerd (ban), zodat ook verversen van de sessie niet meer lukt;
//     - zijn gekoppelde inboxen (mailboxen, 0026; en user_mailboxes) worden verwijderd —
//       ook inboxen die hij met het team deelde (die verdwijnen voor iedereen).
//   --definitief --ja: daarna ook het account zelf verwijderen. Toewijzingen verdwijnen mee;
//     bij facturen, taken enz. wordt "aangemaakt door" leeg. Niet terug te draaien.
//
// Weigert de laatste actieve eigenaar te deactiveren. Sleutels alleen uit de omgeving:
//   node --env-file=.env.local scripts/teamlid-verwijderen.mjs --email mark@studio-levant.nl
//
// Opties: --email <adres> (verplicht), --definitief --ja, --dry-run, --help
import { adminClient, controleerEmail, fout, leesArgumenten, tabelFout, vindGebruiker } from "./teamlid-gemeen.mjs";

const HELP = `Gebruik: node --env-file=.env.local scripts/teamlid-verwijderen.mjs --email <adres> [--definitief --ja] [--dry-run]

Deactiveert een teamlid (lidmaatschap uit, account geblokkeerd, mailbox ontkoppeld).
Met --definitief --ja wordt het account daarna ook verwijderd (niet terug te draaien).`;

const args = leesArgumenten(process.argv.slice(2), {
  vlaggen: ["definitief", "ja", "dry-run", "help"],
  waarden: ["email"],
});
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
const email = controleerEmail(args.email);
const DRY = Boolean(args["dry-run"]);
if (args.definitief && !args.ja && !DRY) fout("definitief verwijderen kan niet ongedaan worden gemaakt: bevestig met --definitief --ja");

const sb = adminClient({ verplicht: !DRY });
if (!sb) {
  console.log("[dry-run] Geen Supabase-sleutels in de omgeving: alleen het plan.");
  console.log(`[dry-run] Zou ${email} deactiveren (lidmaatschap uit, account geblokkeerd, mailbox ontkoppeld)` +
    (args.definitief ? " en daarna het account definitief verwijderen." : "."));
  process.exit(0);
}

const gebruiker = await vindGebruiker(sb, email);
if (!gebruiker) fout(`geen account gevonden voor ${email}`);

const leden = await sb.from("team_members").select("user_id, actief, rol");
if (leden.error) {
  if (tabelFout(leden.error)) fout("tabel team_members bestaat niet: voer eerst supabase/UITVOEREN_0021_TEAM.sql uit.");
  fout(`team_members lezen mislukt: ${leden.error.message}`);
}
const rij = (leden.data ?? []).find((l) => l.user_id === gebruiker.id);
const andereEigenaren = (leden.data ?? []).filter((l) => l.rol === "eigenaar" && l.actief && l.user_id !== gebruiker.id);
if (rij?.rol === "eigenaar" && rij.actief && andereEigenaren.length === 0) {
  fout("dit is de laatste actieve eigenaar. Maak eerst iemand anders eigenaar (teamlid-toevoegen.mjs --rol eigenaar).");
}

if (DRY) {
  console.log(`[dry-run] Account ${gebruiker.id}: lidmaatschap ${rij ? (rij.actief ? "actief" : "al gedeactiveerd") : "ontbreekt"}.`);
  console.log("[dry-run] Zou deactiveren, blokkeren en de mailbox ontkoppelen" + (args.definitief ? ", en daarna het account verwijderen." : "."));
  console.log("[dry-run] Er is niets gewijzigd.");
  process.exit(0);
}

// 1. Lidmaatschap uit — dit sluit hem direct overal buiten.
const uit = await sb
  .from("team_members")
  .upsert({ user_id: gebruiker.id, actief: false, rol: rij?.rol ?? "lid", gedeactiveerd_op: new Date().toISOString() }, { onConflict: "user_id" });
if (uit.error) fout(`deactiveren mislukt: ${uit.error.message}`);
console.log("Lidmaatschap gedeactiveerd.");

// 2. Account blokkeren (geen nieuwe sessies en geen verversing van bestaande).
const ban = await sb.auth.admin.updateUserById(gebruiker.id, { ban_duration: "876000h" });
if (ban.error) console.error(`Waarschuwing: blokkeren mislukt (${ban.error.message}); het lidmaatschap staat wel uit.`);
else console.log("Account geblokkeerd.");

// 3. Eigen inboxen ontkoppelen (versleutelde wachtwoorden weg). Gedeelde inboxen van hem
//    verdwijnen daarmee ook voor de rest van het team (de app toont ze al niet meer zodra
//    hij gedeactiveerd is). Wijzig daarna het wachtwoord van zo'n gedeelde inbox en koppel
//    hem opnieuw vanaf een actief account.
const mbs = await sb.from("mailboxen").delete().eq("eigenaar_id", gebruiker.id).select("email");
if (mbs.error && !tabelFout(mbs.error)) console.error(`Waarschuwing: inboxen ontkoppelen mislukt (${mbs.error.message}).`);
else if (!mbs.error && mbs.data?.length) console.log(`${mbs.data.length} inbox(en) ontkoppeld.`);
const mb = await sb.from("user_mailboxes").delete().eq("user_id", gebruiker.id);
if (mb.error && !tabelFout(mb.error)) console.error(`Waarschuwing: mailbox ontkoppelen mislukt (${mb.error.message}).`);

if (args.definitief) {
  const weg = await sb.auth.admin.deleteUser(gebruiker.id);
  if (weg.error) fout(`account verwijderen mislukt: ${weg.error.message} (het lid is wel gedeactiveerd en geblokkeerd)`);
  console.log(`Account ${email} definitief verwijderd.`);
} else {
  console.log(`Klaar: ${email} heeft geen toegang meer. Terugdraaien: scripts/teamlid-toevoegen.mjs --email ${email} --naam "…"`);
}
