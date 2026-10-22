// Tests voor stap 2 (Account & mail, Bonnetjes), zonder database en zonder netwerk:
//   - lib/mail/kluis-kern.ts: AES-256-GCM heen en terug; een andere gebruiker (AAD), een
//     andere sleutel of één veranderd teken laat ontsleutelen falen; elke keer een nieuwe IV;
//   - lib/mail/netwerk.ts: alleen openbare adressen (geen loopback, privé, link-local, …);
//   - lib/account/types.ts: profiel- en mailbox-invoer (geen wachtwoord in de status-vorm);
//   - lib/uitgaven/model.ts: zoekwoorden (tekst + bedrag), periode uit jaar/maand, soort.
//
// Gebruik:  node scripts/test-account.mjs
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let kluis, netwerk, account, model;
try {
  kluis = await laad("lib", "mail", "kluis-kern.ts");
  netwerk = await laad("lib", "mail", "netwerk.ts");
  account = await laad("lib", "account", "types.ts");
  model = await laad("lib", "uitgaven", "model.ts");
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

let goed = 0;
function test(naam, fn) {
  try {
    fn();
    goed++;
  } catch (e) {
    console.log(`  FOUT  ${naam}\n        ${e.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

// ---------- kluis ----------
const sleutel = randomBytes(32);
const daniel = "11111111-1111-4111-8111-111111111111";
const mark = "22222222-2222-4222-8222-222222222222";

test("heen en terug", () => {
  const enc = kluis.versleutelMet(sleutel, "geheim wachtwoord €", daniel);
  assert.match(enc, /^v1:[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!enc.includes("geheim"));
  assert.equal(kluis.ontsleutelMet(sleutel, enc, daniel), "geheim wachtwoord €");
});
test("elke keer een andere IV/ciphertext", () => {
  assert.notEqual(kluis.versleutelMet(sleutel, "x", daniel), kluis.versleutelMet(sleutel, "x", daniel));
});
test("andere gebruiker (AAD) faalt", () => {
  const enc = kluis.versleutelMet(sleutel, "geheim", daniel);
  assert.throws(() => kluis.ontsleutelMet(sleutel, enc, mark));
});
test("andere sleutel faalt", () => {
  const enc = kluis.versleutelMet(sleutel, "geheim", daniel);
  assert.throws(() => kluis.ontsleutelMet(randomBytes(32), enc, daniel));
});
test("geknoei met ciphertext of tag faalt", () => {
  const enc = kluis.versleutelMet(sleutel, "geheim wachtwoord", daniel);
  const [kop, rest] = enc.split(":");
  const [iv, tag, ct] = rest.split(".");
  const flip = (b64) => {
    const b = Buffer.from(b64, "base64");
    b[0] ^= 1;
    return b.toString("base64");
  };
  assert.throws(() => kluis.ontsleutelMet(sleutel, `${kop}:${iv}.${tag}.${flip(ct)}`, daniel));
  assert.throws(() => kluis.ontsleutelMet(sleutel, `${kop}:${iv}.${flip(tag)}.${ct}`, daniel));
  assert.throws(() => kluis.ontsleutelMet(sleutel, `${kop}:${flip(iv)}.${tag}.${ct}`, daniel));
  assert.throws(() => kluis.ontsleutelMet(sleutel, "platte tekst", daniel));
});
test("sleutel: alleen 32 bytes base64", () => {
  assert.equal(kluis.leesSleutel(randomBytes(32).toString("base64")).length, 32);
  assert.equal(kluis.leesSleutel(randomBytes(16).toString("base64")), null);
  assert.equal(kluis.leesSleutel(""), null);
  assert.equal(kluis.leesSleutel(undefined), null);
  assert.equal(kluis.leesSleutel("geen base64 !!"), null);
});

// ---------- netwerk (SSRF) ----------
test("openbare adressen toegestaan", () => {
  for (const ip of ["198.54.122.135", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.ok(netwerk.isPubliekAdres(ip), ip);
});
test("interne adressen geweigerd", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "ff02::1", "geen-ip",
  ]) {
    assert.equal(netwerk.isPubliekAdres(ip), false, ip);
  }
  assert.ok(netwerk.isPubliekAdres("172.32.0.1"));
});
test("hostnamen", () => {
  assert.ok(netwerk.isHostnaam("mail.privateemail.com"));
  for (const h of ["localhost", "127.0.0.1", "mail.privateemail.com:993", "-x.nl", "http://a.nl", ""]) assert.equal(netwerk.isHostnaam(h), false, h);
});

// ---------- account-invoer ----------
test("profiel: geldig en genormaliseerd", () => {
  const r = account.valideerProfiel({ naam: "  Mark   de Vries ", initialen: "m.d", kleur: "#C8A97E" });
  assert.deepEqual(r, { ok: true, waarde: { naam: "Mark de Vries", initialen: "MD", kleur: "#c8a97e" } });
});
test("profiel: ongeldig", () => {
  assert.equal(account.valideerProfiel({ naam: "", initialen: "D", kleur: "#c8a97e" }).ok, false);
  assert.equal(account.valideerProfiel({ naam: "Daniel", initialen: "D1", kleur: "#c8a97e" }).ok, false);
  assert.equal(account.valideerProfiel({ naam: "Daniel", initialen: "ABCD", kleur: "#c8a97e" }).ok, false);
  assert.equal(account.valideerProfiel({ naam: "Daniel", initialen: "D", kleur: "red" }).ok, false);
  assert.equal(account.valideerProfiel({ naam: "x".repeat(81), initialen: "D", kleur: "#c8a97e" }).ok, false);
});
test("initialen uit naam", () => {
  assert.equal(account.initialenUit("Daniel Tukker"), "DT");
  assert.equal(account.initialenUit("Mark"), "M");
});
test("mailbox: standaardwaarden en normaliseren", () => {
  const r = account.valideerMailbox({ email: " Mark@Studio-Levant.nl ", wachtwoord: "x" });
  assert.ok(r.ok);
  assert.equal(r.waarde.email, "mark@studio-levant.nl");
  assert.equal(r.waarde.imapHost, "mail.privateemail.com");
  assert.equal(r.waarde.imapPort, 993);
  assert.equal(r.waarde.smtpPort, 465);
});
test("mailbox: weigert interne/ongeldige servers en poorten", () => {
  const basis = { email: "a@b.nl", wachtwoord: "x" };
  assert.equal(account.valideerMailbox({ ...basis, imapHost: "localhost" }).ok, false);
  assert.equal(account.valideerMailbox({ ...basis, imapHost: "10.0.0.1" }).ok, false);
  assert.equal(account.valideerMailbox({ ...basis, smtpHost: "mail.x.nl:25" }).ok, false);
  assert.equal(account.valideerMailbox({ ...basis, imapPort: 22 }).ok, false);
  assert.equal(account.valideerMailbox({ ...basis, smtpPort: 25 }).ok, false);
  assert.equal(account.valideerMailbox({ email: "geen-adres", wachtwoord: "x" }).ok, false);
  assert.equal(account.valideerMailbox({ ...basis, fromName: "a\r\nBcc: x@y.nl" }).waarde.fromName.includes("\n"), false);
});

// ---------- bonnetjes: zoeken ----------
test("zoekwoorden: tekst en bedragen", () => {
  assert.deepEqual(model.zoekWoorden("albert heijn"), [
    { tekst: "albert", bedrag: null },
    { tekst: "heijn", bedrag: null },
  ]);
  assert.equal(model.zoekWoorden("12,50")[0].bedrag, 12.5);
  assert.equal(model.zoekWoorden("12.5")[0].bedrag, 12.5);
  assert.equal(model.zoekWoorden("€12")[0].bedrag, 12);
  assert.equal(model.zoekWoorden("adobe")[0].bedrag, null);
});
test("zoekwoorden: geen filter-injectie", () => {
  const w = model.zoekWoorden('a,b),or(id.neq.0 "x" 100%_*');
  for (const x of w) assert.ok(!/[,()"\\*%_]/.test(x.tekst), x.tekst);
  assert.ok(model.zoekWoorden("a b c d e f g h").length <= 6);
  assert.deepEqual(model.zoekWoorden(""), []);
  assert.deepEqual(model.zoekWoorden(null), []);
});
test("periode uit jaar/maand", () => {
  assert.deepEqual(model.periodeVan(2026, null), { van: "2026-01-01", tot: "2026-12-31" });
  assert.deepEqual(model.periodeVan(2024, 2), { van: "2024-02-01", tot: "2024-02-29" });
  assert.equal(model.periodeVan(null, 3), null);
  assert.equal(model.periodeVan(1999, null), null);
});
test("soort afleiden uit bestanden", () => {
  assert.equal(model.afgeleideSoort([{ type: "application/pdf" }]), "inkoopfactuur");
  assert.equal(model.afgeleideSoort([{ type: "image/jpeg" }]), "bonnetje");
  assert.equal(model.afgeleideSoort([]), null);
  assert.ok(model.isSoort("bonnetje") && !model.isSoort("factuur"));
});

console.log(`${goed} tests geslaagd${process.exitCode ? ", met fouten" : ""}`);
