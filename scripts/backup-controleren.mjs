// Controleert een back-up: ontsleutelen en valideren, zonder iets te schrijven. Print alleen
// tellingen (rijen per tabel, aantal gebruikers en bestanden), nooit inhoud.
//
//   node --env-file=.env.local scripts/backup-controleren.mjs --drive
//        de nieuwste geslaagde database-back-up uit Google Drive (via backup_runs en de
//        Drive-koppeling), en vergelijkt grootte, sha256 en tellingen met backup_runs
//   node --env-file=.env.local scripts/backup-controleren.mjs --bestand 2026-10-24.slbak
//        een gedownload bestand (.slbak of een los storage-bestand .slenc); werkt ook
//        zonder database, alleen met BACKUP_ENCRYPTION_KEY
//   … --opslaan <pad>   (alleen met --drive) het versleutelde bestand ook lokaal bewaren
//
// Gecontroleerd: formaat en versie, sleutel-id, de GCM-tag (dus ook geknoei aan de header),
// sha256, de structuur van de export en de tellingen per tabel. Exitcode 0 = in orde.
// Advies: eens per maand draaien (zie docs/BEVEILIGING.md).
import fs from "node:fs";
import { adminClient, fout, leesArgumenten } from "./teamlid-gemeen.mjs";
import { backupSleutel, driveClient, grootteTekst, laadKernen } from "./backup-gemeen.mjs";

const HELP = `Gebruik: node --env-file=.env.local scripts/backup-controleren.mjs (--drive [--opslaan <pad>] | --bestand <pad>)`;
const args = leesArgumenten(process.argv.slice(2), { vlaggen: ["help", "drive"], waarden: ["bestand", "opslaan"] });
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (!args.drive && !args.bestand) fout(`kies --drive of --bestand <pad>\n${HELP}`);
if (args.drive && args.bestand) fout("kies --drive óf --bestand, niet allebei");

const { formaat } = await laadKernen(import.meta.url);
const sleutel = backupSleutel(formaat, fout);

let bytes;
let run = null;
if (args.bestand) {
  try {
    bytes = fs.readFileSync(args.bestand);
  } catch {
    fout(`bestand niet gevonden: ${args.bestand}`);
  }
} else {
  const sb = adminClient();
  const { data, error } = await sb
    .from("backup_runs")
    .select("id, bestand, drive_id, grootte, sha256, sleutel_id, tellingen, gestart")
    .eq("soort", "db")
    .eq("status", "ok")
    .order("gestart", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fout(error.code === "PGRST205" || error.code === "42P01" ? "migratie 0026 is nog niet uitgevoerd" : `backup_runs lezen mislukt (${error.code ?? "fout"})`);
  if (!data?.drive_id) fout("er is nog geen geslaagde database-back-up");
  run = data;
  const { client } = await driveClient(sb, fout);
  console.log(`Ophalen uit Google Drive: ${run.bestand} …`);
  const res = await client.inhoud(run.drive_id);
  bytes = Buffer.from(await res.arrayBuffer());
  if (args.opslaan) {
    fs.writeFileSync(args.opslaan, bytes, { mode: 0o600 });
    console.log(`Versleuteld bewaard in ${args.opslaan}`);
  }
}

const problemen = [];
let header;
try {
  ({ header } = formaat.leesHeader(bytes));
} catch (e) {
  fout(`FOUT: ${e.message}`);
}
console.log(`Soort: ${header.soort === "db" ? "database" : "bestand"} · gemaakt ${header.gemaakt} · project ${header.bron} · sleutel-id ${header.sleutelId} · ${grootteTekst(bytes.length)}`);

if (run) {
  if (run.grootte !== bytes.length) problemen.push(`grootte wijkt af van backup_runs (${run.grootte} ≠ ${bytes.length})`);
  if (run.sha256 && run.sha256 !== formaat.sha256Hex(bytes)) problemen.push("sha256 wijkt af van backup_runs");
  if (run.sleutel_id && run.sleutel_id !== header.sleutelId) problemen.push("sleutel-id wijkt af van backup_runs");
}

let plaintext;
try {
  ({ plaintext } = formaat.ontsleutel(sleutel, bytes));
} catch (e) {
  console.error(`FOUT: ${e.message}`);
  process.exit(2);
}

if (header.soort === "bestand") {
  console.log(`Bestand: ${header.pad ?? "?"} · ${grootteTekst(plaintext.length)} · ontsleutelen en controlesom in orde.`);
} else {
  let data;
  try {
    data = JSON.parse(plaintext.toString("utf8"));
  } catch {
    fout("FOUT: de inhoud is geen geldige JSON");
  }
  const c = formaat.controleerExport(data);
  problemen.push(...c.problemen);
  if (run?.tellingen?.tabellen) {
    for (const [t, n] of Object.entries(run.tellingen.tabellen)) {
      if (c.tellingen[t] !== n) problemen.push(`${t}: ${c.tellingen[t] ?? 0} rijen in het bestand, ${n} volgens backup_runs`);
    }
  }
  console.log("\nRijen per tabel:");
  for (const [t, n] of Object.entries(c.tellingen)) console.log(`  ${t.padEnd(22)} ${String(n).padStart(7)}`);
  if (c.export?.ontbrekend?.length) console.log(`  (niet aanwezig bij het maken: ${c.export.ontbrekend.join(", ")})`);
  console.log(`\nGebruikers: ${c.export?.gebruikers?.length ?? 0}`);
  for (const [b, l] of Object.entries(c.export?.storage ?? {})) console.log(`Storage ${b}: ${l.length} bestanden`);
}

if (problemen.length) {
  console.error(`\nNIET IN ORDE (${problemen.length}):`);
  for (const p of problemen) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nIn orde: de back-up is te ontsleutelen en compleet.");
