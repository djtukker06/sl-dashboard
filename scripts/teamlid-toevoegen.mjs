// Een teamlid toevoegen (of een gedeactiveerd lid opnieuw toegang geven). Zelf registreren
// kan in de backoffice NIET: accounts komen er alleen via dit script ("aan de achterkant").
//
//   1. Bestaat er nog geen account: Supabase stuurt een uitnodiging (inviteUserByEmail).
//      De link komt binnen op /auth/callback en gaat door naar /nieuw-wachtwoord.
//      Bestaat het account al en was het ooit lid (gedeactiveerd): een eventuele blokkade
//      wordt opgeheven en het wordt weer actief.
//      Bestaat het account al maar was het NOOIT lid: dan is het mogelijk door een ander
//      aangemaakt (zelf registreren, met een wachtwoord dat hij kent). Zo'n account wordt
//      NIET vertrouwd: het wordt verwijderd (met al zijn sessies) en er volgt een nieuwe
//      uitnodiging, zodat het lid zelf een wachtwoord kiest. Alleen met
//      --bestaand-account-vertrouwen (als je het account zelf hebt aangemaakt) blijft het staan.
//   2. Profiel (naam, initialen, kleur) en lidmaatschap (team_members, actief) worden gezet.
//
// Vereist migratie 0021 (supabase/UITVOEREN_0021_TEAM.sql). Sleutels alleen uit de omgeving:
//   node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email mark@studio-levant.nl --naam "Mark"
//
// Opties:
//   --email <adres>        verplicht
//   --naam "<naam>"        verplicht (1–80 tekens; voornaam komt in de begroeting)
//   --initialen <XY>       optioneel (1–3 tekens; standaard uit de naam)
//   --kleur <#rrggbb>      optioneel (standaard een tint uit het huisstijlpalet)
//   --rol lid|eigenaar     optioneel (standaard: lid; een bestaande rol blijft anders staan).
//                          'eigenaar' geeft GEEN toegang tot de standaard-mailbox (MAIL_USER):
//                          die is alleen van het account met dat adres / de oudste eigenaar.
//   --bestaand-account-vertrouwen
//                          een bestaand account dat nog nooit lid was NIET verwijderen maar
//                          zo lid maken (alleen als je zeker weet dat jij het hebt aangemaakt)
//   --site <https://…>     basis-URL voor de uitnodigingslink (standaard NEXT_PUBLIC_SITE_URL)
//   --dry-run              alleen laten zien wat er zou gebeuren; niets wijzigen
//   --help
import {
  adminClient,
  controleerEmail,
  fout,
  initialenVan,
  KLEUREN,
  leesArgumenten,
  tabelFout,
  vindGebruiker,
} from "./teamlid-gemeen.mjs";

const HELP = `Gebruik: node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email <adres> --naam "<naam>"
                [--initialen XY] [--kleur #rrggbb] [--rol lid|eigenaar] [--site https://…]
                [--bestaand-account-vertrouwen] [--dry-run]

Voegt een teamlid toe aan de Studio Levant-backoffice: nodigt het account uit (als het nog
niet bestaat) en zet profiel + actief lidmaatschap. Leest sleutels alleen uit de omgeving.

Een bestaand account dat nog nooit lid was, wordt uit voorzorg verwijderd en opnieuw
uitgenodigd (iemand anders kan het met een eigen wachtwoord hebben aangemaakt), tenzij
--bestaand-account-vertrouwen. Zet in Supabase "Allow new users to sign up" UIT vóór je
dit script gebruikt.

--rol eigenaar geeft geen toegang tot de standaard-mailbox (MAIL_USER/MAIL_PASSWORD).`;

const args = leesArgumenten(process.argv.slice(2), {
  vlaggen: ["dry-run", "help", "bestaand-account-vertrouwen"],
  waarden: ["email", "naam", "initialen", "kleur", "rol", "site"],
});
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const email = controleerEmail(args.email);
const naam = String(args.naam || "").trim().replace(/\s+/g, " ");
if (naam.length < 1 || naam.length > 80) fout('geef een naam op met --naam "Voornaam Achternaam" (1–80 tekens)');
const initialen = String(args.initialen || initialenVan(naam)).trim().toUpperCase();
if (initialen.length < 1 || initialen.length > 3) fout("--initialen moet 1 tot 3 tekens zijn");
if (args.kleur !== undefined && !/^#[0-9a-f]{6}$/i.test(args.kleur)) fout("--kleur moet een kleur als #c8a97e zijn");
if (args.rol !== undefined && !["lid", "eigenaar"].includes(args.rol)) fout("--rol moet lid of eigenaar zijn");
const DRY = Boolean(args["dry-run"]);

let site = String(args.site || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
if (site) {
  try {
    const u = new URL(site);
    if (u.protocol !== "https:" && u.hostname !== "localhost") fout("--site moet met https:// beginnen (of localhost zijn)");
    site = u.origin;
  } catch {
    fout("--site is geen geldige URL");
  }
}

const sb = adminClient({ verplicht: !DRY });
if (!sb) {
  console.log("[dry-run] Geen Supabase-sleutels in de omgeving: alleen het plan.");
  console.log(`[dry-run] Zou ${email} uitnodigen (als het account nog niet bestaat) met redirect`);
  console.log(`          ${site || "<NEXT_PUBLIC_SITE_URL>"}/auth/callback?next=/nieuw-wachtwoord`);
  console.log(`[dry-run] Zou profiel zetten: ${naam} (${initialen}${args.kleur ? `, ${args.kleur}` : ""}) en lidmaatschap actief, rol ${args.rol || "lid"}.`);
  process.exit(0);
}

// Migratie 0021 aanwezig?
const proef = await sb.from("team_members").select("user_id, actief, rol");
if (proef.error) {
  if (tabelFout(proef.error)) fout("tabel team_members bestaat niet: voer eerst supabase/UITVOEREN_0021_TEAM.sql uit.");
  fout(`team_members lezen mislukt: ${proef.error.message}`);
}
const leden = proef.data ?? [];
const kleur = (args.kleur || KLEUREN[leden.length % KLEUREN.length]).toLowerCase();

let gebruiker = await vindGebruiker(sb, email);
const bestaand = gebruiker ? leden.find((l) => l.user_id === gebruiker.id) : null;
const rol = args.rol || bestaand?.rol || "lid";
const VERTROUWEN = Boolean(args["bestaand-account-vertrouwen"]);
// Een bestaand account dat nooit lid was: niet vertrouwen (zie boven).
const onbekendAccount = Boolean(gebruiker && !bestaand);

if (DRY) {
  console.log(`[dry-run] Account: ${gebruiker ? `bestaat (${gebruiker.id})` : "bestaat nog niet → uitnodiging"}`);
  if (gebruiker) {
    console.log(`[dry-run]   aangemaakt:   ${gebruiker.created_at ?? "?"}`);
    console.log(`[dry-run]   bevestigd:    ${gebruiker.email_confirmed_at ?? "nee"}`);
    console.log(`[dry-run]   laatst in:    ${gebruiker.last_sign_in_at ?? "nooit"}`);
    console.log(`[dry-run]   lidmaatschap: ${bestaand ? (bestaand.actief ? "actief" : "gedeactiveerd") : "nooit lid geweest"}`);
  }
  if (onbekendAccount && !VERTROUWEN) {
    console.log("[dry-run] Dit account was nooit lid: het zou worden VERWIJDERD (met zijn sessies) en opnieuw uitgenodigd.");
    console.log("          Zelf aangemaakt? Gebruik dan --bestaand-account-vertrouwen.");
  } else if (onbekendAccount) {
    console.log("[dry-run] --bestaand-account-vertrouwen: het bestaande account zou zonder uitnodiging lid worden.");
  }
  if (!gebruiker || (onbekendAccount && !VERTROUWEN)) console.log(`[dry-run] Uitnodigingslink → ${site || "<Site URL van Supabase>"}/auth/callback?next=/nieuw-wachtwoord`);
  if (gebruiker?.banned_until && new Date(gebruiker.banned_until) > new Date()) console.log("[dry-run] Blokkade zou worden opgeheven.");
  console.log(`[dry-run] Profiel: ${naam} (${initialen}, ${kleur}); lidmaatschap: actief, rol ${rol}${bestaand ? ` (was ${bestaand.actief ? "actief" : "gedeactiveerd"}, ${bestaand.rol})` : ""}.`);
  console.log("[dry-run] Er is niets gewijzigd.");
  process.exit(0);
}

if (onbekendAccount && !VERTROUWEN) {
  // Nooit lid geweest: mogelijk door een ander geregistreerd. Weggooien (dat beëindigt ook
  // zijn sessies) en hieronder opnieuw uitnodigen, zodat het lid zelf een wachtwoord kiest.
  if (!site) fout("geen basis-URL voor de uitnodiging: geef --site https://… op of zet NEXT_PUBLIC_SITE_URL.");
  const weg = await sb.auth.admin.deleteUser(gebruiker.id);
  if (weg.error) fout(`bestaand account (nooit lid) kon niet worden verwijderd: ${weg.error.message}`);
  console.log("Bestaand account zonder lidmaatschap verwijderd (het was niet door dit script aangemaakt); er volgt een nieuwe uitnodiging.");
  gebruiker = null;
}

if (!gebruiker) {
  if (!site) fout("geen basis-URL voor de uitnodiging: geef --site https://… op of zet NEXT_PUBLIC_SITE_URL.");
  const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/callback?next=/nieuw-wachtwoord`,
    data: { naam },
  });
  if (error || !data?.user) fout(`uitnodigen mislukt: ${error?.message ?? "onbekende fout"}`);
  gebruiker = data.user;
  console.log(`Uitnodiging verstuurd naar ${email}.`);
} else if (gebruiker.banned_until && new Date(gebruiker.banned_until) > new Date()) {
  const { error } = await sb.auth.admin.updateUserById(gebruiker.id, { ban_duration: "none" });
  if (error) fout(`blokkade opheffen mislukt: ${error.message}`);
  console.log("Blokkade van het account opgeheven.");
}

const profiel = await sb
  .from("profiles")
  .upsert({ id: gebruiker.id, naam, initialen, kleur, email }, { onConflict: "id" });
if (profiel.error) fout(`profiel opslaan mislukt: ${profiel.error.message}`);

const lid = await sb
  .from("team_members")
  .upsert({ user_id: gebruiker.id, actief: true, rol, gedeactiveerd_op: null }, { onConflict: "user_id" });
if (lid.error) fout(`lidmaatschap opslaan mislukt: ${lid.error.message}`);

console.log(`Klaar: ${naam} <${email}> is actief teamlid (rol: ${rol}).`);
if (bestaand && !bestaand.actief) console.log("Let op: dit lid was gedeactiveerd en heeft nu weer toegang.");
