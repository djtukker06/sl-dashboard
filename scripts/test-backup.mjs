// Tests voor de back-ups en de keep-alive (stap 3), zonder netwerk, database of .env:
//   - lib/backup/formaat-kern.ts: versleutelen en ontsleutelen heen en terug; geknoei aan
//     magic, versie, header, ciphertext of tag, een verkeerde sleutel en afkappen falen;
//     controle van een export (tellingen, controlesommen, ontbrekende tabellen);
//     bestandsnamen (Europe/Amsterdam) en foutmeldingen zonder e-mail/tokens;
//   - lib/backup/retentie-kern.ts: het bewaarbeleid op een gesimuleerd jaar dagelijkse
//     back-ups (14 dagelijks, 8 wekelijks, 12 maandelijks, altijd de nieuwste 3);
//   - lib/backup/herstel-kern.ts: vergelijken en het schrijfplan (zelfverwijzing, gegenereerde
//     kolommen);
//   - lib/auth/cron-kern.ts: CRON_SECRET (fail closed, constante tijd, bron);
//   - een "Drive"-upload via de echte DriveClient met een nagebootste fetch: wat naar Google
//     gaat is versleuteld en daarna weer te ontsleutelen;
//   - scripts/backup-controleren.mjs en backup-herstellen.mjs op een lokaal gemaakte
//     nep-back-up (zonder databaseverbinding): controleren slaagt, geknoei faalt, herstellen
//     schrijft niets zonder --schrijven en weigert --schrijven zonder database;
//   - statisch: cron-routes via cronRoute, exacte paden in proxy.ts, vercel.json-crons,
//     GitHub-workflow, eigenaarsroutes, migratie.
//
// Gebruik:  node scripts/test-backup.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);
const lees = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

let F, R, H, C, D;
try {
  F = await laad("lib", "backup", "formaat-kern.ts");
  R = await laad("lib", "backup", "retentie-kern.ts");
  H = await laad("lib", "backup", "herstel-kern.ts");
  C = await laad("lib", "auth", "cron-kern.ts");
  D = await laad("lib", "drive", "kern.ts");
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

let goed = 0;
async function test(naam, fn) {
  try {
    await fn();
    goed++;
  } catch (e) {
    console.log(`  FOUT  ${naam}\n        ${String(e.message).split("\n")[0]}`);
    process.exitCode = 1;
  }
}
const faaltMet = (fn, code) => {
  try {
    fn();
  } catch (e) {
    if (code && e.code !== code) throw new Error(`verwacht ${code}, kreeg ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error("verwachtte een fout");
};

const SLEUTEL = randomBytes(32);
const ANDERE = randomBytes(32);

// Een nep-export met de vaste tabellen (een paar rijen), gebruikers en storage.
function nepExport() {
  const tabellen = {};
  for (const t of F.TABELLEN) tabellen[t.naam] = { pk: t.pk, rijen: [], aantal: 0, sha256: F.rijenHash([]) };
  const klanten = [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", company_name: "Klant Één BV", company_name_normalized: "klant één bv" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", company_name: "Twee & Co", company_name_normalized: "twee & co" },
  ];
  const facturen = [
    { id: "bbbbbbbb-0000-4000-8000-000000000001", client_id: klanten[0].id, total: 1210, remainder_of_invoice_id: null },
    { id: "bbbbbbbb-0000-4000-8000-000000000002", client_id: klanten[0].id, total: 605, remainder_of_invoice_id: "bbbbbbbb-0000-4000-8000-000000000001" },
  ];
  tabellen.clients = { pk: ["id"], rijen: klanten, aantal: 2, sha256: F.rijenHash(klanten) };
  tabellen.invoices = { pk: ["id"], rijen: facturen, aantal: 2, sha256: F.rijenHash(facturen) };
  return {
    formaat: "sl-db-export",
    versie: 1,
    gemaakt: "2026-10-24T03:00:00.000Z",
    migratie: "0026",
    tabellen,
    ontbrekend: [],
    gebruikers: [{ id: "cccccccc-0000-4000-8000-000000000001", email: "test@example.com", created_at: null, email_confirmed_at: null }],
    storage: { invoices: [{ pad: "2026/F-001.pdf", grootte: 1000, bijgewerkt: null, mime: "application/pdf", etag: "x" }], uitgaven: [], "social-assets": [] },
  };
}

// ---------- formaat ----------
await test("sleutel: alleen 32 bytes base64; sleutel-id stabiel en lekt de sleutel niet", () => {
  assert.equal(F.leesBackupSleutel(SLEUTEL.toString("base64")).length, 32);
  assert.equal(F.leesBackupSleutel(randomBytes(16).toString("base64")), null);
  assert.equal(F.leesBackupSleutel("geen base64!"), null);
  assert.equal(F.leesBackupSleutel(""), null);
  assert.match(F.sleutelIdVan(SLEUTEL), /^[0-9a-f]{16}$/);
  assert.equal(F.sleutelIdVan(SLEUTEL), F.sleutelIdVan(Buffer.from(SLEUTEL)));
  assert.notEqual(F.sleutelIdVan(SLEUTEL), F.sleutelIdVan(ANDERE));
  assert.ok(!SLEUTEL.toString("hex").startsWith(F.sleutelIdVan(SLEUTEL)));
});

const exp = nepExport();
const plain = F.exportNaarBytes(exp);
const { bestand: BAK, header: KOP } = F.versleutel(SLEUTEL, plain, { soort: "db", bron: "abcd.supabase.co", gemaakt: new Date("2026-10-24T03:00:00Z") });

await test("heen en terug: database-export", () => {
  assert.equal(BAK.subarray(0, 5).toString(), "SLBAK");
  assert.equal(BAK[5], 1);
  const { header, plaintext } = F.ontsleutel(SLEUTEL, BAK);
  assert.deepEqual(plaintext, plain);
  assert.equal(header.soort, "db");
  assert.equal(header.bron, "abcd.supabase.co");
  assert.equal(header.sleutelId, F.sleutelIdVan(SLEUTEL));
  assert.equal(header.grootte, plain.length);
  assert.deepEqual(KOP, header);
});
await test("versleuteld: geen klantnamen, e-mail of JSON leesbaar in het bestand", () => {
  const s = BAK.toString("latin1");
  for (const t of ["Klant", "Twee & Co", "test@example.com", "sl-db-export", "company_name"]) assert.ok(!s.includes(t), t);
});
await test("elke keer een nieuwe iv (zelfde inhoud, ander bestand)", () => {
  const b = F.versleutel(SLEUTEL, plain, { soort: "db", bron: "abcd.supabase.co" }).bestand;
  assert.notEqual(F.leesHeader(b).header.iv, KOP.iv);
});
await test("heen en terug: los bestand met pad in de (beveiligde) header", () => {
  const pdf = randomBytes(5000);
  const { bestand } = F.versleutel(SLEUTEL, pdf, { soort: "bestand", bron: "abcd.supabase.co", pad: "invoices/2026/F-001.pdf" });
  const r = F.ontsleutel(SLEUTEL, bestand);
  assert.deepEqual(r.plaintext, pdf);
  assert.equal(r.header.pad, "invoices/2026/F-001.pdf");
});
await test("geknoei aan ciphertext, tag of header faalt", () => {
  const { start } = F.leesHeader(BAK);
  for (const i of [start + 3, Math.floor((start + BAK.length) / 2), BAK.length - 1, BAK.length - 16]) {
    const b = Buffer.from(BAK);
    b[i] ^= 0x01;
    faaltMet(() => F.ontsleutel(SLEUTEL, b), "geknoeid");
  }
  // Een cijfer in "gemaakt" wijzigen: geldige JSON, maar de AAD klopt niet meer.
  const b = Buffer.from(BAK);
  const j = b.indexOf(Buffer.from("2026-10-24T03"));
  assert.ok(j > 0);
  b[j + 3] = "7".charCodeAt(0);
  faaltMet(() => F.ontsleutel(SLEUTEL, b), "geknoeid");
  // Het pad van een los bestand omzetten naar een ander pad: faalt.
  const los = F.versleutel(SLEUTEL, Buffer.from("x"), { soort: "bestand", bron: "h", pad: "invoices/a.pdf" }).bestand;
  const k = los.indexOf(Buffer.from("invoices/a.pdf"));
  los[k + 9] = "b".charCodeAt(0);
  faaltMet(() => F.ontsleutel(SLEUTEL, los), "geknoeid");
});
await test("verkeerde sleutel, ander magic, andere versie, afgekapt of leeg: geweigerd", () => {
  faaltMet(() => F.ontsleutel(ANDERE, BAK), "verkeerde_sleutel");
  const m = Buffer.from(BAK);
  m[0] = 0x58;
  faaltMet(() => F.ontsleutel(SLEUTEL, m), "formaat");
  const v = Buffer.from(BAK);
  v[5] = 2;
  faaltMet(() => F.ontsleutel(SLEUTEL, v), "versie");
  faaltMet(() => F.ontsleutel(SLEUTEL, BAK.subarray(0, 40)), "formaat");
  faaltMet(() => F.ontsleutel(SLEUTEL, Buffer.alloc(0)), "formaat");
  // Sleutel-id in de header vervalsen helpt niet (AAD).
  const s = Buffer.from(BAK);
  const p = s.indexOf(Buffer.from(KOP.sleutelId));
  Buffer.from(F.sleutelIdVan(ANDERE)).copy(s, p);
  faaltMet(() => F.ontsleutel(ANDERE, s), "geknoeid");
});
await test("controleerExport: in orde; gewijzigde rij, telling of ontbrekende tabel valt op", () => {
  const ok = F.controleerExport(JSON.parse(plain.toString()));
  assert.deepEqual(ok.problemen, []);
  assert.equal(ok.tellingen.clients, 2);
  const kapot = JSON.parse(plain.toString());
  kapot.tabellen.clients.rijen[0].company_name = "Gewijzigd";
  assert.ok(F.controleerExport(kapot).problemen.some((p) => p.startsWith("clients: controlesom")));
  const tel = JSON.parse(plain.toString());
  tel.tabellen.invoices.aantal = 5;
  assert.ok(F.controleerExport(tel).problemen.some((p) => p.startsWith("invoices: aantal")));
  const mist = JSON.parse(plain.toString());
  delete mist.tabellen.quotes;
  assert.ok(F.controleerExport(mist).problemen.some((p) => p.startsWith("quotes: ontbreekt")));
  mist.ontbrekend = ["quotes"];
  assert.deepEqual(F.controleerExport(mist).problemen, []);
  assert.deepEqual(F.controleerExport({ formaat: "iets anders" }).problemen, ["geen database-export"]);
});
await test("tabellenlijst: alle tabellen uit de migraties (behalve inlog_pogingen), unieke namen, pk overal", () => {
  const sql = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).map((f) => lees("supabase", "migrations", f)).join("\n");
  const inSql = new Set([...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]));
  const lijst = F.TABELLEN.map((t) => t.naam);
  assert.equal(new Set(lijst).size, lijst.length);
  for (const t of inSql) assert.ok(lijst.includes(t) || F.NIET_EXPORTEREN.has(t), `${t} staat niet in TABELLEN`);
  for (const t of lijst) assert.ok(inSql.has(t), `${t} bestaat niet in de migraties`);
  for (const t of F.TABELLEN) assert.ok(t.pk.length > 0, t.naam);
  // FK-volgorde: ouders vóór kinderen.
  const plek = (n) => lijst.indexOf(n);
  for (const [ouder, kind] of [["clients", "projects"], ["clients", "invoices"], ["projects", "tasks"], ["tasks", "task_assignees"], ["expenses", "expense_files"], ["social_projects", "social_slides"], ["calendar_events", "event_attendees"], ["projects", "drive_bestanden"], ["clients", "notities"], ["projects", "notities"], ["bk_grootboek", "bk_rekeningen"], ["bk_rekeningen", "bk_boekingen"], ["bk_vennoten", "bk_boekingen"], ["bk_imports", "bk_boekingen"], ["bk_boekingen", "bk_koppelingen"], ["bk_boekingen", "bk_activa"], ["bk_activa", "bk_bron_extra"], ["bk_memoriaal", "bk_memoriaal_regels"], ["bk_memoriaal", "bk_boekjaren"]]) {
    assert.ok(plek(ouder) < plek(kind), `${ouder} vóór ${kind}`);
  }
  assert.deepEqual([...F.BUCKETS], ["invoices", "uitgaven", "social-assets"]);
});
await test("bestandsnamen: datum in Europe/Amsterdam, handmatig met tijd, plat pad voor Drive", () => {
  assert.equal(F.backupNaam(new Date("2026-10-24T03:00:00Z"), false), "2026-10-24.slbak");
  assert.equal(F.backupNaam(new Date("2026-10-24T23:30:00Z"), false), "2026-10-25.slbak");
  assert.equal(F.backupNaam(new Date("2026-01-05T13:07:00Z"), true), "2026-01-05-handmatig-1407.slbak");
  assert.equal(F.bestandNaamInDrive("uitgaven/abc/bon 1.jpg"), "uitgaven__abc__bon 1.jpg.slenc");
  assert.equal(F.bestandNaamInDrive("/2026/F.pdf"), "2026__F.pdf.slenc");
  assert.equal(F.bronVan("https://abcd.supabase.co"), "abcd.supabase.co");
  assert.equal(F.bronVan(undefined), "onbekend");
});
await test("korteFout: geen e-mailadressen, tokens of Bearer-waarden", () => {
  const t = F.korteFout(new Error("mislukt voor jan@example.com met token=abc123 en Bearer eyJhbGciOi.xyz"));
  assert.ok(!t.includes("jan@example.com") && !t.includes("abc123") && !t.includes("eyJhbGciOi"), t);
  assert.ok(F.korteFout("x".repeat(1000)).length <= 300);
});

// ---------- retentie ----------
await test("retentie: een jaar lang elke 3 dagen een back-up, er blijven er altijd precies 3", () => {
  const DAG = 86_400_000;
  const begin = Date.UTC(2025, 9, 1, 3);
  let drive = [];
  let n = 0;
  for (let d = 0; d < 400; d += 3) {
    const nu = begin + d * DAG;
    const datum = new Date(nu).toISOString().slice(0, 10);
    drive.push({ id: `id${n++}`, naam: `${datum}.slbak` });
    const weg = new Set(R.teVerwijderen(drive, nu + 3_600_000).map((b) => b.id));
    drive = drive.filter((b) => !weg.has(b.id));
    assert.ok(drive.length <= R.BEWAAR_AANTAL, `${drive.length} back-ups op dag ${d}`);
  }
  assert.equal(drive.length, 3);
  // Het zijn de nieuwste drie.
  const namen = drive.map((b) => b.naam).sort();
  const laatste = begin + 399 * DAG;
  assert.equal(namen[2], `${new Date(laatste).toISOString().slice(0, 10)}.slbak`);
  // Een handmatige tussendoor telt gewoon mee: de oudste gaat weg.
  drive.push({ id: "h", naam: `${new Date(laatste + DAG).toISOString().slice(0, 10)}-handmatig-1415.slbak` });
  const weg = R.teVerwijderen(drive, laatste + 2 * DAG).map((b) => b.naam);
  assert.deepEqual(weg, [namen[0]]);
});
await test("retentie: nooit de nieuwste 3, nooit iets bij ≤ 3 bestanden, onbekende namen blijven", () => {
  const oud = [
    { id: "a", naam: "2020-01-01.slbak" },
    { id: "b", naam: "2020-02-01.slbak" },
    { id: "c", naam: "2020-03-01.slbak" },
  ];
  assert.deepEqual(R.teVerwijderen(oud, Date.UTC(2026, 0, 1)), []);
  const meer = [...oud, { id: "d", naam: "2019-01-01.slbak" }, { id: "e", naam: "notities.txt.slbak" }, { id: "f", naam: "2018-05-05-handmatig-0900.slbak" }];
  const weg = R.teVerwijderen(meer, Date.UTC(2026, 0, 1)).map((b) => b.id).sort();
  assert.deepEqual(weg, ["d", "f"]);
  assert.equal(R.datumUitNaam("2026-13-01.slbak"), null);
  assert.equal(R.isoWeekSleutel(Date.UTC(2026, 0, 1)), "2026-W01");
  assert.equal(R.isoWeekSleutel(Date.UTC(2027, 0, 1)), "2026-W53");
  assert.equal(R.isoWeekSleutel(Date.UTC(2025, 11, 29)), "2026-W01");
});

// ---------- herstel ----------
await test("herstel: vergelijken (nieuw/gewijzigd/gelijk/ontbrekend), gegenereerde kolom telt niet", () => {
  const t = { naam: "clients", pk: ["id"], zonder: ["company_name_normalized"] };
  const backup = [
    { id: "1", company_name: "A", company_name_normalized: "a" },
    { id: "2", company_name: "B", company_name_normalized: "b" },
    { id: "3", company_name: "C", company_name_normalized: "c" },
  ];
  const huidig = [
    { company_name: "A", id: "1", company_name_normalized: "anders" },
    { id: "2", company_name: "B gewijzigd", company_name_normalized: "b" },
    { id: "9", company_name: "Nieuw sinds back-up", company_name_normalized: "x" },
  ];
  const v = H.vergelijkTabel(backup, huidig, t);
  assert.deepEqual(v.nieuw.map((r) => r.id), ["3"]);
  assert.deepEqual(v.gewijzigd.map((r) => r.id), ["2"]);
  assert.equal(v.gelijk, 1);
  assert.deepEqual(v.ontbrekend.map((r) => r.id), ["9"]);
  const samengesteld = H.vergelijkTabel([{ a: 1, b: 2, x: 1 }], [{ b: 2, a: 1, x: 1 }], { naam: "t", pk: ["a", "b"] });
  assert.equal(samengesteld.gelijk, 1);
});
await test("herstel: schrijfplan zonder gegenereerde kolom, zelfverwijzing in twee stappen, niets zonder pk", () => {
  const def = F.TABELLEN.find((t) => t.naam === "invoices");
  const p = H.schrijfPlan(exp.tabellen.invoices.rijen, def);
  assert.equal(p.upsert.length, 2);
  assert.ok(p.upsert.every((r) => r.remainder_of_invoice_id === null));
  assert.deepEqual(p.daarna, [{ id: "bbbbbbbb-0000-4000-8000-000000000002", remainder_of_invoice_id: "bbbbbbbb-0000-4000-8000-000000000001" }]);
  const k = H.schrijfPlan(exp.tabellen.clients.rijen, F.TABELLEN.find((t) => t.naam === "clients"));
  assert.ok(k.upsert.every((r) => !("company_name_normalized" in r)));
  assert.deepEqual(H.schrijfPlan([{ a: 1 }], { naam: "x", pk: [] }), { upsert: [], daarna: [] });
  assert.equal(H.projectRef("abcd.supabase.co"), "abcd");
});

// ---------- cron ----------
await test("cron: zonder (geldig) secret altijd niet_ingericht; verkeerd/leeg = geweigerd; juist = ok", () => {
  const s = "een-lang-geheim-van-32-tekens-xx";
  assert.equal(C.geldigSecret(""), null);
  assert.equal(C.geldigSecret("kort"), null);
  assert.equal(C.geldigSecret(`  ${s}  `), s);
  assert.equal(C.cronToegestaan(`Bearer ${s}`, null), "niet_ingericht");
  assert.equal(C.cronToegestaan(null, s), "geweigerd");
  assert.equal(C.cronToegestaan("", s), "geweigerd");
  assert.equal(C.cronToegestaan(`Bearer ${s}x`, s), "geweigerd");
  assert.equal(C.cronToegestaan(`Bearer ${s.slice(0, -1)}`, s), "geweigerd");
  assert.equal(C.cronToegestaan(s, s), "geweigerd");
  assert.equal(C.cronToegestaan(`Basic ${s}`, s), "geweigerd");
  assert.equal(C.cronToegestaan(`Bearer ${s}`, s), "ok");
  assert.equal(C.cronBron("https://x/api/cron/dagelijks?bron=github"), "github");
  assert.equal(C.cronBron("https://x/api/cron/dagelijks?bron=handmatig"), "cron");
  assert.equal(C.cronBron("https://x/api/cron/dagelijks"), "cron");
});

// ---------- nagebootste Drive ----------
await test("Drive (nagebootst): upload bevat alleen versleutelde bytes en is terug te lezen", async () => {
  const opgeslagen = new Map();
  let volgnummer = 0;
  const nepFetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer nep-token");
    if (u.pathname.startsWith("/upload/drive/v3/files") && init.method === "POST") {
      const body = Buffer.from(init.body);
      const grens = /boundary=(.+)$/.exec(new Headers(init.headers).get("content-type"))[1];
      const delen = body.toString("latin1").split(`--${grens}`);
      const meta = JSON.parse(delen[1].split("\r\n\r\n")[1]);
      const inhoudStart = body.indexOf(Buffer.from("\r\n\r\n", "latin1"), body.indexOf(Buffer.from("Content-Type: application/octet-stream"))) + 4;
      const inhoudEind = body.lastIndexOf(Buffer.from(`\r\n--${grens}--`, "latin1"));
      const id = `bestand${++volgnummer}`;
      opgeslagen.set(id, { naam: meta.name, inhoud: body.subarray(inhoudStart, inhoudEind) });
      return new Response(JSON.stringify({ id, name: meta.name, size: String(inhoudEind - inhoudStart) }), { status: 200 });
    }
    if (u.pathname.startsWith("/drive/v3/files/") && u.searchParams.get("alt") === "media") {
      const id = decodeURIComponent(u.pathname.split("/").pop());
      return new Response(opgeslagen.get(id).inhoud, { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  const client = new D.DriveClient(nepFetch, async () => "nep-token");
  const b = await client.upload({ naam: "2026-10-24.slbak.tmp", mime: "application/octet-stream", inhoud: BAK, ouderId: "mapId12345" });
  const geupload = opgeslagen.get(b.id).inhoud;
  assert.deepEqual(Buffer.from(geupload), BAK, "Drive krijgt exact het versleutelde bestand");
  assert.ok(!geupload.toString("latin1").includes("Klant"), "geen leesbare inhoud naar Google");
  const terug = Buffer.from(await (await client.inhoud(b.id)).arrayBuffer());
  assert.deepEqual(F.ontsleutel(SLEUTEL, terug).plaintext, plain);
});

// ---------- scripts op een nep-back-up ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-backup-test-"));
const bakPad = path.join(tmp, "2026-10-24.slbak");
fs.writeFileSync(bakPad, BAK);
const kapotPad = path.join(tmp, "kapot.slbak");
const kapot = Buffer.from(BAK);
kapot[kapot.length - 20] ^= 0xff;
fs.writeFileSync(kapotPad, kapot);
const los = F.versleutel(SLEUTEL, Buffer.from("%PDF-1.4 nep"), { soort: "bestand", bron: "abcd.supabase.co", pad: "invoices/2026/F-001.pdf" }).bestand;
fs.writeFileSync(path.join(tmp, "F-001.pdf.slenc"), los);

function draai(script, argv, sleutel = SLEUTEL) {
  // Een schone omgeving: geen Supabase/Google-variabelen, alleen de testsleutel.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, BACKUP_ENCRYPTION_KEY: sleutel ? sleutel.toString("base64") : "" };
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(ROOT, "scripts", script), ...argv], { cwd: tmp, env, encoding: "utf8", input: "" });
}
const uit = (r) => `${r.stdout}\n${r.stderr}`;

await test("backup-controleren: nep-back-up in orde (exit 0), alleen tellingen", () => {
  const r = draai("backup-controleren.mjs", ["--bestand", bakPad]);
  assert.equal(r.status, 0, uit(r));
  assert.match(r.stdout, /In orde/);
  assert.match(r.stdout, /clients\s+2/);
  assert.ok(!uit(r).includes("Klant Één") && !uit(r).includes("test@example.com"), "geen inhoud in de uitvoer");
});
await test("backup-controleren: los .slenc-bestand in orde", () => {
  const r = draai("backup-controleren.mjs", ["--bestand", path.join(tmp, "F-001.pdf.slenc")]);
  assert.equal(r.status, 0, uit(r));
  assert.match(r.stdout, /invoices\/2026\/F-001\.pdf/);
});
await test("backup-controleren: geknoeid, verkeerde sleutel of geen sleutel → exit ≠ 0", () => {
  assert.notEqual(draai("backup-controleren.mjs", ["--bestand", kapotPad]).status, 0);
  const r = draai("backup-controleren.mjs", ["--bestand", bakPad], ANDERE);
  assert.notEqual(r.status, 0);
  assert.match(uit(r), /andere sleutel/);
  const z = draai("backup-controleren.mjs", ["--bestand", bakPad], null);
  assert.notEqual(z.status, 0);
  assert.match(uit(z), /BACKUP_ENCRYPTION_KEY ontbreekt/);
  assert.notEqual(draai("backup-controleren.mjs", []).status, 0, "zonder --drive/--bestand");
});
await test("backup-herstellen: standaard droog, schrijft niets (ook geen veiligheidskopie)", () => {
  const voor = fs.readdirSync(tmp).sort();
  const r = draai("backup-herstellen.mjs", ["--bestand", bakPad]);
  assert.equal(r.status, 0, uit(r));
  assert.match(r.stdout, /Droog gedraaid: er is niets geschreven/);
  assert.deepEqual(fs.readdirSync(tmp).sort(), voor);
});
await test("backup-herstellen: --schrijven zonder database geweigerd; --ook-verwijderen alleen met --schrijven", () => {
  const voor = fs.readdirSync(tmp).sort();
  const r = draai("backup-herstellen.mjs", ["--bestand", bakPad, "--schrijven", "--bevestig", "HERSTEL abcd"]);
  assert.notEqual(r.status, 0, uit(r));
  assert.match(uit(r), /--schrijven kan alleen met/);
  assert.notEqual(draai("backup-herstellen.mjs", ["--bestand", bakPad, "--ook-verwijderen"]).status, 0);
  assert.notEqual(draai("backup-herstellen.mjs", ["--bestand", kapotPad]).status, 0, "geknoeid bestand");
  assert.notEqual(draai("backup-herstellen.mjs", ["--bestand", bakPad, "--tabellen", "bestaat_niet"]).status, 0);
  assert.deepEqual(fs.readdirSync(tmp).sort(), voor);
});
await test("backup-herstellen: schrijven pas na veiligheidskopie en getypte bevestiging (statisch)", () => {
  const s = lees("scripts", "backup-herstellen.mjs");
  const iVeilig = s.indexOf("veiligheidskopie-");
  const iBevestig = s.indexOf("HERSTEL ${ref}");
  const iUpsert = s.indexOf(".upsert(");
  const iSchrijven = s.indexOf("if (!args.schrijven)");
  assert.ok(iSchrijven > 0 && iSchrijven < iVeilig && iVeilig < iUpsert && iBevestig < iUpsert, "volgorde: droog-stop → veiligheidskopie → bevestiging → schrijven");
  assert.ok(/header\.bron !== doelHost && !args\["ander-project"\]/.test(s), "ander project alleen met --ander-project");
  assert.ok(!/console\.log\([^)]*rijen\[/.test(s), "geen rij-inhoud printen");
});
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- statisch ----------
await test("cron-routes: via cronRoute, alleen GET, maxDuration 300", () => {
  for (const naam of ["dagelijks", "bestanden"]) {
    const s = lees("app", "api", "cron", naam, "route.ts");
    assert.ok(/export const GET = cronRoute\(/.test(s), naam);
    assert.ok(!/export (const|async function) (POST|PUT|PATCH|DELETE)/.test(s), naam);
    assert.ok(/maxDuration = 300/.test(s), naam);
  }
  const d = lees("app", "api", "cron", "dagelijks", "route.ts");
  assert.ok(d.indexOf("heartbeat(") < d.indexOf("maakDbBackup("), "heartbeat vóór de back-up");
  const c = lees("lib", "auth", "cron.ts");
  assert.ok(c.indexOf("cronToegestaan(request") < c.indexOf("= systeemClient("), "eerst het secret, dan de service-role");
});
await test("proxy: precies de twee cron-paden zonder sessie, geen voorvoegsel", () => {
  const p = lees("proxy.ts");
  assert.ok(p.includes("pad === '/api/cron/dagelijks' || pad === '/api/cron/bestanden'"));
  assert.ok(!/startsWith\(['"]\/api\/cron/.test(p));
});
await test("vercel.json: twee crons van hooguit 1× per dag (Hobby), maxDuration voor de cron-routes", () => {
  const v = JSON.parse(lees("vercel.json"));
  const paden = (v.crons ?? []).map((c) => c.path).sort();
  assert.deepEqual(paden, ["/api/cron/bestanden", "/api/cron/dagelijks"]);
  for (const c of v.crons) assert.match(c.schedule, /^\d{1,2} \d{1,2} (\*|\*\/\d+) \* \*$/, `${c.path}: hooguit 1× per dag`);
  // De keep-alive moet elke nacht draaien (Supabase pauzeert na 7 dagen).
  assert.equal(v.crons.find((c) => c.path === "/api/cron/dagelijks").schedule.split(" ")[2], "*");
  assert.equal(v.functions["app/api/cron/**/route.ts"].maxDuration, 300);
});
await test("GitHub Actions: elke 3 dagen, handmatig te starten, geen rechten, secrets niet in de code", () => {
  const y = lees(".github", "workflows", "keepalive.yml");
  assert.ok(/cron:\s*"17 6 \*\/3 \* \*"/.test(y));
  assert.ok(/workflow_dispatch:/.test(y));
  assert.ok(/permissions:\s*\{\}/.test(y));
  assert.ok(y.includes("secrets.SL_CRON_URL") && y.includes("secrets.SL_CRON_SECRET"));
  assert.ok(y.includes("/api/cron/dagelijks?bron=github"));
  assert.ok(!/Bearer [A-Za-z0-9+/]{16,}/.test(y), "geen echt secret in de workflow");
});
await test("back-uproutes alleen voor de eigenaar (eigenaarRoute); nooit onversleuteld naar Drive", () => {
  for (const r of [["app", "api", "beveiliging", "backup", "route.ts"], ["app", "api", "beveiliging", "backup", "[id]", "download", "route.ts"]]) {
    assert.ok(/eigenaarRoute/.test(lees(...r)), r.join("/"));
  }
  const run = lees("lib", "backup", "run.ts");
  assert.ok(run.indexOf("versleutel(sleutel, bytes") < run.indexOf("uploadDbBackup(v, naam, bestand)"));
  assert.ok(/uploadBestand\(v, \{[^}]*inhoud: bestand/.test(run), "storage-bestanden versleuteld");
  assert.ok(!/inhoud: (bytes|inhoud|plaintext)\b/.test(run), "nooit platte inhoud uploaden");
  const dl = lees("app", "api", "beveiliging", "backup", "[id]", "download", "route.ts");
  assert.ok(/application\/octet-stream/.test(dl) && !/ontsleutel/.test(dl), "download blijft versleuteld");
});
await test("migratie 0026 deel 3: tabellen, RLS, geen rechten voor anon, alleen eigenaar leest", () => {
  const m = lees("supabase", "migrations", "0026_beveiliging_mailboxen_backups.sql");
  for (const t of ["backup_runs", "backup_bestanden", "heartbeat"]) {
    assert.ok(m.includes(`create table if not exists public.${t}`), t);
    assert.ok(m.includes(`alter table public.${t} enable row level security`), t);
    assert.ok(m.includes(`revoke all on public.${t} from anon, authenticated`), t);
  }
  assert.ok(/create policy "eigenaar leest back-ups" on public\.backup_runs[\s\S]*?is_teamlid\(\)\) and \(select public\.is_eigenaar\(\)\)/.test(m));
  assert.ok(/create policy "eigenaar leest heartbeat" on public\.heartbeat[\s\S]*?is_eigenaar/.test(m));
  assert.ok(!/policy[^;]*on public\.backup_bestanden/.test(m), "backup_bestanden zonder policies");
  assert.ok(/revoke all on function public\.backup_tabellen\(\) from public, anon, authenticated/.test(m));
});
await test(".env.local.example: alleen de namen BACKUP_ENCRYPTION_KEY en CRON_SECRET (leeg)", () => {
  const e = lees(".env.local.example");
  assert.ok(/^BACKUP_ENCRYPTION_KEY=$/m.test(e));
  assert.ok(/^CRON_SECRET=$/m.test(e));
});

console.log(process.exitCode ? `test-backup: FOUTEN (${goed} geslaagd)` : `test-backup: ${goed} geslaagd`);
