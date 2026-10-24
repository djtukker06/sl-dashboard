// Een database-back-up (.slbak) terugzetten. STANDAARD DROOG: ontsleutelen, controleren en
// per tabel tonen wat er nieuw, gewijzigd of ontbrekend zou zijn ten opzichte van de huidige
// database. Er wordt pas iets geschreven met --schrijven én een getypte bevestiging.
//
//   node --env-file=.env.local scripts/backup-herstellen.mjs --bestand 2026-10-24.slbak
//   … --tabellen clients,invoices   alleen deze tabellen
//   … --gebruikers                  ontbrekende gebruikers (auth) aanmaken met hetzelfde id,
//                                   zonder wachtwoord (daarna "wachtwoord vergeten")
//   … --bestanden <map>             storage-bestanden terugzetten uit een map met .slenc-
//                                   bestanden (gedownload uit Drive › Back-ups › Bestanden)
//   … --schrijven                   ECHT schrijven (upsert in foreign-key-volgorde); maakt
//                                   eerst een versleutelde veiligheidskopie van de huidige
//                                   stand in de huidige map, en vraagt "HERSTEL <project>"
//   … --ook-verwijderen             (met --schrijven) rijen die niet in de back-up staan
//                                   verwijderen. Zonder: alleen toevoegen en bijwerken
//   … --ander-project               toestaan dat de back-up van een ander Supabase-project komt
//   … --bevestig "HERSTEL <ref>"    bevestigen zonder terminal
//
// Zonder NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY toont het alleen de inhoud
// (tellingen). Het script print nooit rij-inhoud, sleutels of tokens.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { adminClient, auditScript, fout, leesArgumenten } from "./teamlid-gemeen.mjs";
import { backupSleutel, grootteTekst, laadKernen } from "./backup-gemeen.mjs";

const HELP = `Gebruik: node --env-file=.env.local scripts/backup-herstellen.mjs --bestand <x.slbak> [--tabellen a,b] [--gebruikers] [--bestanden <map>] [--schrijven] [--ook-verwijderen] [--ander-project] [--bevestig <tekst>]

Standaard droog (er wordt niets geschreven). Zie de uitleg bovenin dit script.`;
const args = leesArgumenten(process.argv.slice(2), {
  vlaggen: ["help", "gebruikers", "schrijven", "ook-verwijderen", "ander-project"],
  waarden: ["bestand", "tabellen", "bestanden", "bevestig"],
});
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (!args.bestand) fout(`--bestand <pad naar .slbak> is verplicht\n${HELP}`);
if (args["ook-verwijderen"] && !args.schrijven) fout("--ook-verwijderen kan alleen samen met --schrijven");

const { formaat, herstel } = await laadKernen(import.meta.url);
const sleutel = backupSleutel(formaat, fout);

let bytes;
try {
  bytes = fs.readFileSync(args.bestand);
} catch {
  fout(`bestand niet gevonden: ${args.bestand}`);
}
let header, plaintext;
try {
  ({ header, plaintext } = formaat.ontsleutel(sleutel, bytes));
} catch (e) {
  fout(e.message, 2);
}
if (header.soort !== "db") fout("dit is geen database-back-up (.slbak); losse bestanden zet je terug met --bestanden <map>");
const c = formaat.controleerExport(JSON.parse(plaintext.toString("utf8")));
if (c.problemen.length) fout(`de back-up is niet in orde:\n  - ${c.problemen.join("\n  - ")}`);
const exp = c.export;
console.log(`Back-up van ${header.gemaakt} · project ${header.bron} · ${grootteTekst(bytes.length)} · in orde.`);

// Welke tabellen?
const defs = formaat.TABELLEN.filter((d) => exp.tabellen[d.naam]);
for (const naam of Object.keys(exp.tabellen)) {
  if (!defs.some((d) => d.naam === naam)) defs.push({ naam, pk: exp.tabellen[naam].pk ?? [] });
}
let gekozen = defs;
if (args.tabellen) {
  const lijst = args.tabellen.split(",").map((s) => s.trim()).filter(Boolean);
  const onbekend = lijst.filter((t) => !defs.some((d) => d.naam === t));
  if (onbekend.length) fout(`onbekende tabel(len): ${onbekend.join(", ")}`);
  gekozen = defs.filter((d) => lijst.includes(d.naam));
}

const sb = adminClient({ verplicht: false });
if (!sb) {
  console.log("\nGeen databaseverbinding in de omgeving: alleen de inhoud van de back-up.\n");
  for (const d of gekozen) console.log(`  ${d.naam.padEnd(22)} ${String(exp.tabellen[d.naam].aantal).padStart(7)} rijen`);
  console.log(`  gebruikers             ${String(exp.gebruikers.length).padStart(7)}`);
  if (args.schrijven) fout("--schrijven kan alleen met NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY (node --env-file=.env.local …)");
  console.log("\nDroog gedraaid: er is niets geschreven.");
  process.exit(0);
}

const doelHost = formaat.bronVan(process.env.NEXT_PUBLIC_SUPABASE_URL);

async function huidigeRijen(d) {
  const uit = [];
  for (let van = 0; ; van += 1000) {
    let q = sb.from(d.naam).select("*");
    for (const k of d.pk) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(van, van + 999);
    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") return null;
      fout(`${d.naam} lezen mislukt (${error.code ?? "fout"})`);
    }
    uit.push(...(data ?? []));
    if ((data ?? []).length < 1000) return uit;
  }
}

console.log(`\nVergelijking met de huidige database (${doelHost}):`);
console.log(`  ${"tabel".padEnd(22)} ${"back-up".padStart(8)} ${"nieuw".padStart(7)} ${"gewijzigd".padStart(10)} ${"ontbreekt".padStart(10)}`);
const plan = [];
const huidigPerTabel = {};
for (const d of gekozen) {
  const huidig = await huidigeRijen(d);
  if (huidig === null) {
    console.log(`  ${d.naam.padEnd(22)} tabel bestaat niet in de database (voer eerst de migraties uit) — overgeslagen`);
    continue;
  }
  huidigPerTabel[d.naam] = huidig;
  const v = herstel.vergelijkTabel(exp.tabellen[d.naam].rijen, huidig, d);
  plan.push({ d, v });
  console.log(
    `  ${d.naam.padEnd(22)} ${String(exp.tabellen[d.naam].aantal).padStart(8)} ${String(v.nieuw.length).padStart(7)} ${String(v.gewijzigd.length).padStart(10)} ${String(v.ontbrekend.length).padStart(10)}${d.pk.length ? "" : "  (geen pk bekend: niet herstelbaar)"}`,
  );
}

// Gebruikers
let ontbrekendeGebruikers = [];
if (args.gebruikers) {
  const bestaand = new Set();
  for (let page = 1; page < 100; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fout(`gebruikers ophalen mislukt (${error.code ?? error.status ?? "fout"})`);
    for (const u of data?.users ?? []) bestaand.add(u.id);
    if ((data?.users ?? []).length < 200) break;
  }
  ontbrekendeGebruikers = exp.gebruikers.filter((u) => !bestaand.has(u.id) && u.email);
  console.log(`\nGebruikers: ${exp.gebruikers.length} in de back-up, ${ontbrekendeGebruikers.length} ontbreken.`);
}

// Bestanden
let bestandenLijst = [];
if (args.bestanden) {
  const wandel = (map) =>
    fs.readdirSync(map, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? wandel(path.join(map, e.name)) : e.name.endsWith(formaat.EXTENSIE_BESTAND) ? [path.join(map, e.name)] : []));
  try {
    bestandenLijst = wandel(args.bestanden);
  } catch {
    fout(`map niet gevonden: ${args.bestanden}`);
  }
  console.log(`\nStorage: ${bestandenLijst.length} versleutelde bestanden in ${args.bestanden}.`);
}

if (!args.schrijven) {
  console.log("\nDroog gedraaid: er is niets geschreven. Terugzetten: voeg --schrijven toe.");
  process.exit(0);
}

// ---------------------------------------------------------------------------------
// Schrijven
// ---------------------------------------------------------------------------------
if (header.bron !== doelHost && !args["ander-project"]) {
  fout(`deze back-up komt van ${header.bron}, de omgeving wijst naar ${doelHost}. Bedoel je dit echt? Voeg --ander-project toe.`);
}
const ref = herstel.projectRef(doelHost);
const verwacht = `HERSTEL ${ref}`;

// Veiligheidskopie van de huidige stand (versleuteld, alleen de gekozen tabellen).
const veilig = {
  formaat: "sl-db-export",
  versie: 1,
  gemaakt: new Date().toISOString(),
  migratie: "veiligheidskopie",
  tabellen: Object.fromEntries(
    Object.entries(huidigPerTabel).map(([naam, rijen]) => [naam, { pk: gekozen.find((d) => d.naam === naam)?.pk ?? [], rijen, aantal: rijen.length, sha256: formaat.rijenHash(rijen) }]),
  ),
  ontbrekend: formaat.TABELLEN.map((t) => t.naam).filter((n) => !huidigPerTabel[n]),
  gebruikers: [],
  storage: {},
};
const veiligNaam = `veiligheidskopie-${new Date().toISOString().replace(/[:.]/g, "-")}${formaat.EXTENSIE_DB}`;
fs.writeFileSync(veiligNaam, formaat.versleutel(sleutel, formaat.exportNaarBytes(veilig), { soort: "db", bron: doelHost }).bestand, { mode: 0o600 });
console.log(`\nVeiligheidskopie van de huidige stand: ${veiligNaam} (versleuteld met dezelfde sleutel).`);

if (args.bevestig !== undefined) {
  if (args.bevestig.trim() !== verwacht) fout("bevestiging klopt niet; er is niets geschreven");
} else {
  if (!process.stdin.isTTY) fout(`geen terminal: bevestig met --bevestig "${verwacht}"`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`\nDit schrijft naar de database van ${doelHost}${args["ook-verwijderen"] ? " en VERWIJDERT rijen die niet in de back-up staan" : ""}.\nTyp ${JSON.stringify(verwacht)} om door te gaan: `);
  rl.close();
  if (a.trim() !== verwacht) fout("niet bevestigd; er is niets geschreven");
}

let geschreven = 0;
let verwijderd = 0;

for (const u of ontbrekendeGebruikers) {
  const { error } = await sb.auth.admin.createUser({ id: u.id, email: u.email, email_confirm: true });
  if (error) console.warn(`  gebruiker ${u.id.slice(0, 8)}… aanmaken mislukt (${error.code ?? error.status ?? "fout"})`);
  else console.log(`  gebruiker ${u.id.slice(0, 8)}… aangemaakt (zonder wachtwoord: "wachtwoord vergeten" gebruiken)`);
}

for (const { d, v } of plan) {
  if (!d.pk.length) continue;
  const rijen = [...v.nieuw, ...(d.alleenToevoegen ? [] : v.gewijzigd)];
  if (!rijen.length) continue;
  const { upsert, daarna } = herstel.schrijfPlan(rijen, d);
  for (let i = 0; i < upsert.length; i += 500) {
    const { error } = await sb.from(d.naam).upsert(upsert.slice(i, i + 500), { onConflict: d.pk.join(","), ignoreDuplicates: Boolean(d.alleenToevoegen) });
    if (error) fout(`${d.naam}: schrijven mislukt (${error.code ?? "fout"}: ${String(error.message ?? "").slice(0, 120)}). Eerder geschreven tabellen blijven staan; de veiligheidskopie staat in ${veiligNaam}.`);
  }
  for (const r of daarna) {
    const match = Object.fromEntries(d.pk.map((k) => [k, r[k]]));
    const { error } = await sb.from(d.naam).update({ [d.zelfVerwijzing]: r[d.zelfVerwijzing] }).match(match);
    if (error) fout(`${d.naam}: verwijzing bijwerken mislukt (${error.code ?? "fout"})`);
  }
  geschreven += upsert.length;
  console.log(`  ${d.naam}: ${upsert.length} rijen geschreven`);
}

if (args["ook-verwijderen"]) {
  for (const { d, v } of [...plan].reverse()) {
    if (!d.pk.length || d.alleenToevoegen || !v.ontbrekend.length) continue;
    for (const r of v.ontbrekend) {
      const match = Object.fromEntries(d.pk.map((k) => [k, r[k]]));
      const { error } = await sb.from(d.naam).delete().match(match);
      if (error) fout(`${d.naam}: verwijderen mislukt (${error.code ?? "fout"})`);
      verwijderd++;
    }
    console.log(`  ${d.naam}: ${v.ontbrekend.length} rijen verwijderd`);
  }
}

if (bestandenLijst.length) {
  const mime = new Map();
  for (const [bucket, lijst] of Object.entries(exp.storage ?? {})) for (const it of lijst) mime.set(`${bucket}/${it.pad}`, it.mime);
  let n = 0;
  for (const f of bestandenLijst) {
    let res;
    try {
      res = formaat.ontsleutel(sleutel, fs.readFileSync(f));
    } catch (e) {
      console.warn(`  ${path.basename(f)}: ${e.message}`);
      continue;
    }
    const pad = res.header.pad ?? "";
    const i = pad.indexOf("/");
    if (res.header.soort !== "bestand" || i < 1) continue;
    const bucket = pad.slice(0, i);
    if (!formaat.BUCKETS.includes(bucket)) continue;
    const { error } = await sb.storage.from(bucket).upload(pad.slice(i + 1), res.plaintext, { upsert: true, contentType: mime.get(pad) ?? "application/octet-stream" });
    if (error) console.warn(`  ${path.basename(f)}: terugzetten mislukt (${error.message?.slice(0, 80) ?? "fout"})`);
    else n++;
  }
  console.log(`  storage: ${n} bestanden teruggezet`);
}

await auditScript(sb, "backup_hersteld", { doel: path.basename(args.bestand), details: { aantal: geschreven, soort: verwijderd ? `ook ${verwijderd} verwijderd` : "toevoegen/bijwerken" } });
console.log(`\nKlaar: ${geschreven} rijen geschreven${verwijderd ? `, ${verwijderd} verwijderd` : ""}.`);
console.log("Tip: na herstel van audit_log, social_versions of heartbeat de reeksen bijwerken in de SQL Editor, bv.:");
console.log("  select setval('public.social_versions_id_seq', coalesce((select max(id) from public.social_versions), 1));");
