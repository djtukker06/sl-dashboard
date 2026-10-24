// Herstel en noodschakelaars voor tweestapsverificatie (2FA). Lokaal draaien, met de
// service-role uit de omgeving (dit script leest zelf geen .env-bestanden en print nooit een
// sleutel):
//
//   node --env-file=.env.local scripts/2fa-herstel.mjs                  status (wie heeft 2FA, schakelaars)
//   node --env-file=.env.local scripts/2fa-herstel.mjs --reset <email>  alle 2FA-apparaten van iemand weg
//                                                                        (bv. telefoon kwijt; ook voor jezelf)
//   node --env-file=.env.local scripts/2fa-herstel.mjs --rls uit        NOODSTOP database: 2FA telt in RLS
//                                                                        even niet mee (alleen het wachtwoord)
//   node --env-file=.env.local scripts/2fa-herstel.mjs --rls aan        noodstop weer uit (standaard)
//   node --env-file=.env.local scripts/2fa-herstel.mjs --streng aan     ook wie GEEN 2FA heeft, ziet geen data
//                                                                        (pas als iedereen 2FA heeft)
//   node --env-file=.env.local scripts/2fa-herstel.mjs --streng uit
//
// De noodstop van de app zelf is de Vercel-variabele MFA_AFDWINGEN=uit (dan hoeft niemand 2FA
// IN TE STELLEN; wie al een apparaat heeft, vult nog steeds zijn code in). Alles wat dit
// script wijzigt komt in de audit-log (bron "script"). Elke wijziging vraagt bevestiging:
// typ het e-mailadres (bij --reset) of het woord JA; zonder terminal: --bevestig <tekst>.
import readline from "node:readline/promises";
import { adminClient, auditScript, controleerEmail, fout, leesArgumenten, tabelFout, vindGebruiker } from "./teamlid-gemeen.mjs";

const HELP = `Gebruik: node --env-file=.env.local scripts/2fa-herstel.mjs [--reset <email> | --rls aan|uit | --streng aan|uit] [--bevestig <tekst>]

Zonder opties: toont de status. Zie de uitleg bovenin dit script en docs/BEVEILIGING.md.`;

const args = leesArgumenten(process.argv.slice(2), { vlaggen: ["help"], waarden: ["reset", "rls", "streng", "bevestig"] });
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
const acties = ["reset", "rls", "streng"].filter((k) => args[k] !== undefined);
if (acties.length > 1) fout("kies één actie tegelijk (--reset, --rls of --streng)");
for (const k of ["rls", "streng"]) {
  if (args[k] !== undefined && !["aan", "uit"].includes(args[k])) fout(`--${k} moet "aan" of "uit" zijn`);
}

const sb = adminClient();

async function bevestig(verwacht, vraag) {
  if (args.bevestig !== undefined) {
    if (args.bevestig.trim().toLowerCase() !== verwacht.toLowerCase()) fout("bevestiging klopt niet; er is niets gewijzigd");
    return;
  }
  if (!process.stdin.isTTY) fout(`geen terminal: bevestig met --bevestig "${verwacht}"`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const antwoord = await rl.question(`${vraag}\nTyp ${JSON.stringify(verwacht)} om door te gaan: `);
  rl.close();
  if (antwoord.trim().toLowerCase() !== verwacht.toLowerCase()) fout("niet bevestigd; er is niets gewijzigd");
}

async function leesInstellingen() {
  const { data, error } = await sb.from("app_instellingen").select("tfa_rls, tfa_rls_streng").eq("id", 1).maybeSingle();
  if (error) {
    if (tabelFout(error)) return null;
    fout(`instellingen lezen mislukt (${error.code ?? "fout"})`);
  }
  return data ?? { tfa_rls: true, tfa_rls_streng: false };
}

async function teamMetFactoren() {
  const { data: leden, error } = await sb.from("team_members").select("user_id, actief, rol");
  if (error) fout(`team_members lezen mislukt (${error.code ?? "fout"})`);
  const uit = [];
  for (const l of leden ?? []) {
    const { data: u } = await sb.auth.admin.getUserById(l.user_id);
    const factoren = (u?.user?.factors ?? []).filter((f) => f.status === "verified").length;
    uit.push({ ...l, email: u?.user?.email ?? "?", factoren });
  }
  return uit;
}

if (acties.length === 0) {
  const inst = await leesInstellingen();
  console.log(inst === null ? "Migratie 0026 is nog niet uitgevoerd: 2FA telt nog niet mee in de database." : `Database: 2FA in RLS ${inst.tfa_rls ? "AAN" : "UIT (noodstop actief!)"}, streng ${inst.tfa_rls_streng ? "AAN" : "uit"}.`);
  for (const l of await teamMetFactoren()) {
    console.log(`  ${l.actief ? "actief " : "inactief"}  ${l.rol.padEnd(8)}  ${l.email.padEnd(32)}  2FA: ${l.factoren ? `${l.factoren} apparaat/apparaten` : "nee"}`);
  }
  process.exit(0);
}

if (args.reset !== undefined) {
  const email = controleerEmail(args.reset);
  const gebruiker = await vindGebruiker(sb, email);
  if (!gebruiker) fout(`geen account gevonden voor ${email}`);
  const { data, error } = await sb.auth.admin.mfa.listFactors({ userId: gebruiker.id });
  if (error) fout(`factoren ophalen mislukt (${error.code ?? error.status ?? "fout"})`);
  const factoren = data?.factors ?? [];
  if (!factoren.length) {
    console.log(`${email} heeft geen 2FA-apparaten; er is niets te resetten.`);
    process.exit(0);
  }
  await bevestig(email, `Alle ${factoren.length} 2FA-apparaten van ${email} verwijderen? Bij de volgende keer inloggen stelt hij/zij 2FA opnieuw in.`);
  for (const f of factoren) {
    const r = await sb.auth.admin.mfa.deleteFactor({ id: f.id, userId: gebruiker.id });
    if (r.error) fout(`verwijderen mislukt (${r.error.code ?? r.error.status ?? "fout"})`);
  }
  await auditScript(sb, "2fa_reset_door_eigenaar", { doel: gebruiker.id, details: { aantal: factoren.length, bron: "script" } });
  console.log(`Klaar: ${factoren.length} apparaat/apparaten van ${email} verwijderd. Log opnieuw in en stel 2FA opnieuw in.`);
  process.exit(0);
}

const inst = await leesInstellingen();
if (inst === null) fout("migratie 0026 is nog niet uitgevoerd (tabel app_instellingen ontbreekt); er valt nog niets te schakelen.");

if (args.rls !== undefined) {
  const aan = args.rls === "aan";
  if (inst.tfa_rls === aan) {
    console.log(`2FA in RLS staat al ${args.rls}.`);
    process.exit(0);
  }
  await bevestig("JA", aan ? "2FA weer laten meetellen in de database (aanbevolen)?" : "NOODSTOP: 2FA in de database uitzetten? Dan geeft alleen het wachtwoord weer toegang tot de data.");
  const { error } = await sb.from("app_instellingen").update({ tfa_rls: aan }).eq("id", 1);
  if (error) fout(`opslaan mislukt (${error.code ?? "fout"})`);
  await auditScript(sb, "noodstop_2fa", { details: { status: aan ? "rls_aan" : "rls_uit", bron: "script" } });
  console.log(aan ? "2FA telt weer mee in de database." : "Noodstop actief. Zet hem zo snel mogelijk terug met --rls aan.");
  process.exit(0);
}

if (args.streng !== undefined) {
  const aan = args.streng === "aan";
  if (aan) {
    const zonder = (await teamMetFactoren()).filter((l) => l.actief && !l.factoren);
    if (zonder.length) fout(`nog niet iedereen heeft 2FA: ${zonder.map((l) => l.email).join(", ")}. Streng aanzetten zou hen buitensluiten.`);
  }
  await bevestig("JA", aan ? "Streng: wie geen 2FA heeft, ziet geen data meer. Doorgaan?" : "Streng uitzetten?");
  const { error } = await sb.from("app_instellingen").update({ tfa_rls_streng: aan }).eq("id", 1);
  if (error) fout(`opslaan mislukt (${error.code ?? "fout"})`);
  await auditScript(sb, "noodstop_2fa", { details: { status: aan ? "streng_aan" : "streng_uit", bron: "script" } });
  console.log(`Streng staat ${args.streng}.`);
}
