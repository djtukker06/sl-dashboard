// Tests voor stap 2 (Account & mail, Bonnetjes), zonder database en zonder netwerk:
//   - lib/mail/kluis-kern.ts: AES-256-GCM heen en terug; een andere gebruiker (AAD), een
//     andere sleutel of één veranderd teken laat ontsleutelen falen; elke keer een nieuwe IV;
//   - lib/mail/netwerk.ts: alleen openbare adressen (geen loopback, privé, link-local, …);
//   - lib/account/types.ts: profiel- en mailbox-invoer (geen wachtwoord in de status-vorm);
//   - lib/uitgaven/model.ts: zoekwoorden (tekst + bedrag), periode uit jaar/maand, soort;
//   - welkomstflow en mailbox met één knop (0022): providers uit het adres (vaste lijst + MX),
//     meldingen in gewone taal, rate limit, de env-mailbox nooit voor een lid, welkom-vlag.
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
let kluis, netwerk, account, model, providers, fout, pogingen, envkeuze;
try {
  providers = await laad("lib", "mail", "providers.ts");
  fout = await laad("lib", "mail", "fout.ts");
  pogingen = await laad("lib", "mail", "pogingen.ts");
  envkeuze = await laad("lib", "mail", "envkeuze.ts");
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

// ---------- welkomstflow en mailbox met één knop ----------
test("providers: vaste lijst", () => {
  const sl = providers.vasteInstellingen("Bram@Studio-Levant.nl");
  assert.equal(sl.soort, "bekend");
  assert.deepEqual([sl.imapHost, sl.imapPort, sl.smtpHost, sl.smtpPort], ["mail.privateemail.com", 993, "mail.privateemail.com", 465]);
  assert.equal(sl.appWachtwoord, false);
  const g = providers.vasteInstellingen("iemand@gmail.com");
  assert.deepEqual([g.imapHost, g.smtpHost, g.smtpPort, g.appWachtwoord], ["imap.gmail.com", "smtp.gmail.com", 465, true]);
  assert.equal(providers.vasteInstellingen("x@googlemail.com").provider, "gmail");
  const i = providers.vasteInstellingen("x@icloud.com");
  assert.deepEqual([i.imapHost, i.smtpHost, i.smtpPort, i.appWachtwoord], ["imap.mail.me.com", "smtp.mail.me.com", 587, true]);
  assert.equal(providers.vasteInstellingen("x@me.com").provider, "icloud");
  for (const a of ["x@outlook.com", "x@hotmail.com", "x@live.nl", "x@hotmail.nl", "x@outlook.be"]) {
    assert.equal(providers.vasteInstellingen(a).soort, "microsoft", a);
  }
  assert.equal(providers.vasteInstellingen("x@klant.nl").soort, "onbekend");
  assert.equal(providers.vasteInstellingen("geen-adres").soort, "onbekend");
});
await (async () => {
  try {
    let gevraagd = [];
    const mx = (hosts) => async (d) => {
      gevraagd.push(d);
      return hosts;
    };
    // Bekend domein: geen MX-lookup.
    let r = await providers.instellingenVoor("bram@studio-levant.nl", mx([]));
    assert.equal(r.provider, "privateemail");
    assert.deepEqual(gevraagd, []);
    // Onbekend domein met Private Email-MX.
    r = await providers.instellingenVoor("info@klant.nl", mx(["mx1.privateemail.com", "mx2.privateemail.com."]));
    assert.equal(r.soort, "bekend");
    assert.equal(r.imapHost, "mail.privateemail.com");
    assert.deepEqual(gevraagd, ["klant.nl"]);
    // Andere MX (of geen): onbekend; nooit de MX-host zelf als server.
    r = await providers.instellingenVoor("info@klant.nl", mx(["aspmx.l.google.com"]));
    assert.equal(r.soort, "onbekend");
    r = await providers.instellingenVoor("info@klant.nl", mx(["evilprivateemail.com", "privateemail.com.evil.nl"]));
    assert.equal(r.soort, "onbekend");
    r = await providers.instellingenVoor("info@klant.nl", mx([]));
    assert.equal(r.soort, "onbekend");
    // Ongeldig domein: geen lookup.
    gevraagd = [];
    r = await providers.instellingenVoor("x@localhost", mx(["mx.privateemail.com"]));
    assert.equal(r.soort, "onbekend");
    assert.deepEqual(gevraagd, []);
    r = await providers.instellingenVoor("x@outlook.com", mx(["mx.privateemail.com"]));
    assert.equal(r.soort, "microsoft");
    goed++;
  } catch (e) {
    console.log(`  FOUT  providers: MX\n        ${e.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
})();

const SCHOON = (t) => !/(error|exception|stack|\bat\s|\.ts:|EAUTH|ETIMEDOUT|ECONN|undefined|null)/i.test(t);
test("koppelfouten: meldingen uit de tabel, zonder technische details", () => {
  const authImap = Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "AUTHENTICATIONFAILED Invalid credentials" });
  let f = fout.koppelFout(authImap, "imap");
  assert.equal(f.code, "inloggen_mislukt");
  assert.equal(f.message, fout.KOPPEL_MELDING.inloggen);
  assert.match(f.message, /wachtwoord van je mailbox, niet van het dashboard/);
  f = fout.koppelFout(authImap, "imap", "gmail");
  assert.match(f.message, /app-wachtwoord/);
  assert.ok(f.message.startsWith(fout.KOPPEL_MELDING.inloggen));
  f = fout.koppelFout(Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:993"), { code: "ETIMEDOUT" }), "imap");
  assert.equal(f.code, "onbereikbaar");
  assert.equal(f.message, fout.KOPPEL_MELDING.onbereikbaar);
  f = fout.koppelFout(Object.assign(new Error("Invalid login: 535"), { code: "EAUTH", responseCode: 535 }), "smtp");
  assert.equal(f.code, "verzenden_mislukt");
  assert.equal(f.message, fout.KOPPEL_MELDING.verzenden);
  f = fout.koppelFout(new Error("rare fout met stack"), "imap");
  assert.equal(f.message, fout.KOPPEL_MELDING.onbereikbaar);
  for (const m of [
    fout.KOPPEL_MELDING.inloggen, fout.KOPPEL_MELDING.onbekend, fout.KOPPEL_MELDING.microsoft, fout.KOPPEL_MELDING.onbereikbaar,
    fout.KOPPEL_MELDING.verzenden, fout.KOPPEL_MELDING.teVaak, fout.KOPPEL_MELDING.appWachtwoord.gmail,
  ]) {
    assert.ok(SCHOON(m), m);
  }
  assert.match(fout.KOPPEL_MELDING.teVaak, /10 minuten/);
  assert.match(fout.KOPPEL_MELDING.microsoft, /Outlook en Hotmail/);
  assert.match(fout.KOPPEL_MELDING.onbekend, /servergegevens/);
});
test("rate limit: 5 pogingen per gebruiker, daarna geweigerd", () => {
  const a = "aaaaaaaa-1111-4111-8111-" + Date.now().toString().padStart(12, "0").slice(-12);
  for (let i = 0; i < 5; i++) assert.equal(pogingen.magProberen(a), true, `poging ${i + 1}`);
  assert.equal(pogingen.magProberen(a), false);
  assert.equal(pogingen.magProberen(a), false);
  assert.equal(pogingen.magProberen(a + "-ander"), true);
});
test("env-mailbox: een lid krijgt hem nooit", () => {
  const env = { mailUser: "info@studio-levant.nl", vastId: "" };
  const bram = { userId: mark, email: "bram@studio-levant.nl", rol: "lid", overgang: false };
  assert.equal(envkeuze.envMailboxKeuze(env, bram), "nee");
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "info@studio-levant.nl", vastId: daniel }, bram), "nee");
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "", vastId: "" }, bram), "nee");
  // Alleen als het echt zijn adres of zijn id is.
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "Bram@Studio-Levant.nl" }, bram), "ja");
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "info@studio-levant.nl", vastId: mark }, bram), "ja");
  // De eigenaar: via MAIL_ENV_USER_ID of als oudste eigenaar (route controleert).
  const dan = { userId: daniel, email: "daniel@studio-levant.nl", rol: "eigenaar", overgang: false };
  assert.equal(envkeuze.envMailboxKeuze(env, dan), "oudste_eigenaar");
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "info@studio-levant.nl", vastId: daniel }, dan), "ja");
  assert.equal(envkeuze.envMailboxKeuze({ mailUser: "info@studio-levant.nl", vastId: mark }, dan), "nee");
});
test("welkom-vlag: alleen een profiel met lege kolom gaat naar /welkom", () => {
  assert.equal(account.welkomKlaarVan({ naam: "Bram", welkom_klaar_op: null }), false);
  assert.equal(account.welkomKlaarVan({ naam: "Bram", welkom_klaar_op: "2026-10-23T10:00:00Z" }), true);
  assert.equal(account.welkomKlaarVan({ naam: "Daniel" }), true); // 0022 nog niet uitgevoerd
  assert.equal(account.welkomKlaarVan(null), true); // geen profiel: geen lus
});

console.log(`${goed} tests geslaagd${process.exitCode ? ", met fouten" : ""}`);
