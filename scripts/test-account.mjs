// Tests voor stap 2 (Account & mail, Bonnetjes), zonder database en zonder netwerk:
//   - lib/mail/kluis-kern.ts: AES-256-GCM heen en terug; een andere gebruiker (AAD), een
//     andere sleutel of één veranderd teken laat ontsleutelen falen; elke keer een nieuwe IV;
//   - lib/mail/netwerk.ts: alleen openbare adressen (geen loopback, privé, link-local, …);
//   - lib/account/types.ts: profiel- en mailbox-invoer (geen wachtwoord in de status-vorm);
//   - lib/uitgaven/model.ts: zoekwoorden (tekst + bedrag), periode uit jaar/maand, soort;
//   - welkomstflow en mailbox met één knop (0022): providers uit het adres (vaste lijst + MX),
//     meldingen in gewone taal, rate limit, de env-mailbox nooit voor een lid, welkom-vlag;
//   - meerdere inboxen (0026, lib/mail/zichtbaarheid.ts): wie ziet welke inbox (eigen, gedeeld,
//     gedeactiveerde eigenaar), DTO zonder geheimen, samenvoegen op datum ("Alle inboxen"),
//     label/kleur/zichtbaarheid, volgorde, kleuren; statisch: geen geheimen naar de browser,
//     elke mail-API kent ?mb= en weigert een onbekende inbox, afzender kiezen.
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
let kluis, netwerk, account, model, providers, fout, pogingen, envkeuze, zicht;
try {
  zicht = await laad("lib", "mail", "zichtbaarheid.ts");
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

// ---------- meerdere inboxen (0026) ----------
const bram = mark;
const oud = "33333333-3333-4333-8333-333333333333";
test("zichtbaarheid: eigen altijd, gedeeld alleen van een actief teamlid, privé van een ander nooit", () => {
  const actief = new Set([daniel, bram]);
  const info = { eigenaar_id: daniel, zichtbaarheid: "team" };
  const prive = { eigenaar_id: daniel, zichtbaarheid: "prive" };
  assert.equal(zicht.isZichtbaar(prive, daniel, actief), true);
  assert.equal(zicht.isZichtbaar(info, daniel, actief), true);
  assert.equal(zicht.isZichtbaar(info, bram, actief), true);
  assert.equal(zicht.isZichtbaar(prive, bram, actief), false);
  // Gedeactiveerde eigenaar: zijn gedeelde inbox verdwijnt voor iedereen behalve hemzelf.
  const vanOud = { eigenaar_id: oud, zichtbaarheid: "team" };
  assert.equal(zicht.isZichtbaar(vanOud, bram, actief), false);
  assert.equal(zicht.isZichtbaar(vanOud, daniel, actief), false);
  // Een niet-actieve kijker ziet geen gedeelde inbox van een ander.
  assert.equal(zicht.isZichtbaar(info, oud, actief), false);
  // Onbekende zichtbaarheid = privé.
  assert.equal(zicht.isZichtbaar({ eigenaar_id: daniel, zichtbaarheid: "iedereen" }, bram, actief), false);
});
test("DTO naar de browser: geen wachtwoord, versleuteld wachtwoord, servers of cfg", () => {
  const intern = {
    id: "aaaaaaaa-0000-4000-8000-000000000001", label: "Info", email: "info@studio-levant.nl", kleur: "#c8a97e",
    zichtbaarheid: "team", vanMij: false, eigenaarNaam: "Daniel", standaard: false, fromName: "Studio Levant",
    handtekening: "Groet", leesbaar: true, eigenaarId: daniel, wachtwoord_enc: "v1:x.y.z", imapHost: "mail.privateemail.com",
    imapPort: 993, smtpHost: "mail.privateemail.com", smtpPort: 465, cfg: { password: "geheim", user: "info@studio-levant.nl" },
  };
  const dto = zicht.naarDto(intern);
  assert.deepEqual(Object.keys(dto).sort(), ["eigenaarNaam", "email", "fromName", "handtekening", "id", "kleur", "label", "leesbaar", "standaard", "vanMij", "zichtbaarheid"]);
  const tekst = JSON.stringify(dto);
  for (const geheim of ["geheim", "v1:", "privateemail", "993", "password", "eigenaarId"]) assert.ok(!tekst.includes(geheim), geheim);
});
test("samenvoegen op datum: nieuwste eerst, elk bericht met zijn inbox, geen dubbelen, max", () => {
  const a = [{ uid: 5, datum: "2026-10-20T10:00:00Z" }, { uid: 4, datum: "2026-10-18T10:00:00Z" }];
  const b = [{ uid: 5, datum: "2026-10-21T09:00:00Z" }, { uid: 1, datum: null }];
  const samen = zicht.voegSamenOpDatum([{ mb: "A", berichten: a }, { mb: "B", berichten: b }, { mb: "A", berichten: [a[0]] }]);
  assert.deepEqual(samen.map((e) => `${e.mb}:${e.uid}`), ["B:5", "A:5", "A:4", "B:1"]);
  assert.equal(zicht.voegSamenOpDatum([{ mb: "A", berichten: a }, { mb: "B", berichten: b }], 2).length, 2);
  // Zelfde uid in twee inboxen = twee verschillende berichten.
  assert.equal(samen.filter((e) => e.uid === 5).length, 2);
});
test("Alle inboxen: pagina's per inbox achter elkaar zonder gaten of dubbelen", () => {
  // Twee inboxen met elk 5 berichten, 2 per pagina: alle pagina's samen = alle 10, op datum.
  const maak = (mb, start) => Array.from({ length: 5 }, (_, i) => ({ uid: 100 - i, datum: new Date(Date.UTC(2026, 9, start - i * 2)).toISOString() }));
  const bron = { A: maak("A", 20), B: maak("B", 21) };
  const pagina = (mb, p) => bron[mb].slice((p - 1) * 2, p * 2);
  let alles = [];
  for (let p = 1; p <= 3; p++) {
    const deel = zicht.voegSamenOpDatum([{ mb: "A", berichten: pagina("A", p) }, { mb: "B", berichten: pagina("B", p) }]);
    alles = zicht.voegSamenOpDatum([{ mb: "_", berichten: [] }, ...[...alles, ...deel].map((e) => ({ mb: e.mb, berichten: [e] }))]);
  }
  assert.equal(alles.length, 10);
  assert.equal(new Set(alles.map((e) => `${e.mb}:${e.uid}`)).size, 10);
  for (let i = 1; i < alles.length; i++) assert.ok(Date.parse(alles[i - 1].datum) >= Date.parse(alles[i].datum));
});
test("label, kleur, zichtbaarheid, afzendernaam en handtekening controleren", () => {
  assert.deepEqual(zicht.valideerMailboxMeta({ label: "  Info  ", kleur: "#C8A97E", zichtbaarheid: "team" }), {
    ok: true,
    waarde: { label: "Info", kleur: "#c8a97e", zichtbaarheid: "team" },
  });
  assert.equal(zicht.valideerMailboxMeta({ label: "" }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ label: "x".repeat(41) }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ label: "a\u0000b" }).ok, true);
  assert.equal(zicht.valideerMailboxMeta({ label: "a\u0000b" }).waarde.label, "a b");
  assert.equal(zicht.valideerMailboxMeta({ kleur: "red" }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ kleur: "#c8a97e;x" }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ zichtbaarheid: "iedereen" }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ fromName: "x".repeat(121) }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ handtekening: "x".repeat(5001) }).ok, false);
  assert.equal(zicht.valideerMailboxMeta({ fromName: "A\r\nBcc: x" }).waarde.fromName, "A Bcc: x");
  // Alleen meegestuurde velden, onbekende velden tellen niet mee.
  assert.deepEqual(zicht.valideerMailboxMeta({ wachtwoord_enc: "v1:x", eigenaar_id: mark }), { ok: true, waarde: {} });
});
test("standaardlabel, kleuren en mailbox-id's", () => {
  assert.equal(zicht.standaardLabel("info@studio-levant.nl"), "Info");
  assert.equal(zicht.standaardLabel("daniel.tukker@x.nl"), "Daniel.tukker");
  assert.equal(zicht.standaardLabel("@x.nl"), "Inbox");
  assert.equal(zicht.volgendeKleur([]), zicht.MAILBOX_KLEUREN[0].kleur);
  assert.equal(zicht.volgendeKleur([zicht.MAILBOX_KLEUREN[0].kleur]), zicht.MAILBOX_KLEUREN[1].kleur);
  assert.match(zicht.volgendeKleur(zicht.MAILBOX_KLEUREN.map((k) => k.kleur)), /^#[0-9a-f]{6}$/);
  assert.equal(new Set(zicht.MAILBOX_KLEUREN.map((k) => k.kleur)).size, zicht.MAILBOX_KLEUREN.length);
  assert.ok(zicht.isMailboxId("aaaaaaaa-0000-4000-8000-000000000001"));
  assert.ok(zicht.isMailboxId("env") && zicht.isMailboxId("eigen"));
  for (const x of ["", "alle", "../x", "1; drop", null, 5]) assert.equal(zicht.isMailboxId(x), false, String(x));
  assert.equal(zicht.MAX_MAILBOXEN, 10);
});
test("volgorde: alleen alle eigen id's, elk één keer", () => {
  const eigen = ["a", "b", "c"];
  assert.deepEqual(zicht.valideerVolgorde(["c", "a", "b"], eigen), ["c", "a", "b"]);
  assert.equal(zicht.valideerVolgorde(["a", "b"], eigen), null);
  assert.equal(zicht.valideerVolgorde(["a", "a", "b"], eigen), null);
  assert.equal(zicht.valideerVolgorde(["a", "b", "x"], eigen), null);
  assert.equal(zicht.valideerVolgorde("a,b,c", eigen), null);
});
test("volgorde in Mail: eigen, dan standaard, dan gedeeld (op naam)", () => {
  const m = (id, vanMij, standaard, volgorde, eigenaarNaam = "Daniel") => ({ id, label: id, vanMij, standaard, volgorde, eigenaarNaam });
  const lijst = zicht.sorteerInboxen([m("g2", false, false, 0, "Zoë"), m("env", true, true, 0), m("e2", true, false, 1), m("g1", false, false, 0, "Bram"), m("e1", true, false, 0)]);
  assert.deepEqual(lijst.map((x) => x.id), ["e1", "e2", "env", "g1", "g2"]);
});

// ---------- statisch: meerdere inboxen ----------
{
  const fs = await import("node:fs");
  const lees = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
  const zonderCommentaar = (s) => s.replace(/\/\/[^\n]*/g, "");
  test("zichtbaarheid.ts zonder imports (browser, server en tests)", () => {
    assert.doesNotMatch(lees("lib", "mail", "zichtbaarheid.ts"), /^import /m);
  });
  test("mailRoute: gekozen inbox uit de zichtbare inboxen, onbekende inbox = 404", () => {
    const api = lees("lib", "mail", "api.ts");
    assert.match(api, /searchParams\.get\('mb'\)/);
    assert.match(api, /zichtbareMailboxen\(c\.lid\)/);
    assert.match(api, /fout\(404, MAILBOX_ONBEKEND, 'mailbox_onbekend'\)/);
  });
  test("inboxen-lijst en overzicht: alleen DTO's, nooit cfg/wachtwoord", () => {
    for (const f of ["inboxen", "status", "overzicht"]) {
      const src = zonderCommentaar(lees("app", "api", "mail", f, "route.ts"));
      assert.doesNotMatch(src, /wachtwoord|password|imapHost|smtpHost|\.\.\.m\b|json\(mail\.mailboxen\)/, f);
    }
    assert.match(lees("app", "api", "mail", "inboxen", "route.ts"), /inboxenDto\(mail\.mailboxen\)/);
  });
  test("zichtbare inboxen: ontsleutelen met eigenaar_id, team-inboxen alleen van actieve leden", () => {
    const src = lees("lib", "mail", "mailboxen.ts");
    assert.match(src, /ontsleutel\(rij\.wachtwoord_enc, rij\.eigenaar_id\)/);
    assert.match(src, /isZichtbaar\(r, lid\.userId, team\.actief\)/);
    assert.match(src, /^import 'server-only';/m);
  });
  test("beheer: alleen eigen rijen wijzigen/ontkoppelen, versleutelen met het eigen user-id", () => {
    const src = lees("lib", "mail", "beheer.ts");
    const wijzig = [...src.matchAll(/from\('mailboxen'\)\s*\.(update|delete)\([^)]*\)([^;]*);/g)];
    assert.ok(wijzig.length >= 4, `${wijzig.length}`);
    for (const w of wijzig) assert.match(w[2], /\.eq\('eigenaar_id', lid\.userId\)/, w[0].slice(0, 80));
    assert.match(src, /eigenaar_id: lid\.userId/);
    assert.match(src, /versleutel\(invoer\.wachtwoord, lid\.userId\)/);
    assert.match(src, /magProberen\(lid\.userId\)/);
    assert.match(src, /testMailbox\(invoer, hint\)/);
    assert.match(src, /logAudit\('mailbox_gekoppeld'/);
    assert.match(src, /logAudit\('mailbox_ontkoppeld'/);
  });
  test("verzenden: vanaf de gekozen inbox (?mb=), origineel alleen uit een zichtbare inbox", () => {
    const src = lees("app", "api", "mail", "verzenden", "route.ts");
    assert.match(src, /mail\.mailboxen\.find\(\(x\) => x\.id === origMb\)/);
    assert.match(src, /mailbox_onbekend/);
    assert.match(lees("lib", "mail", "client.ts"), /\/api\/mail\/verzenden\?\$\{q\(\{ mb: van \}\)\}/);
    assert.match(lees("components", "mail", "Opsteller.tsx"), /id="ml-van"/);
  });
  test("elke inbox-gebonden client-aanroep stuurt ?mb= mee", () => {
    const regels = lees("lib", "mail", "client.ts").split("\n").filter((r) => r.includes("`/api/mail/"));
    const gebonden = regels.filter((r) => !/\/api\/mail\/(inboxen|status|overzicht)'/.test(r) && !r.includes("alle: 1"));
    assert.ok(gebonden.length >= 7, `${gebonden.length}`);
    for (const r of gebonden) assert.match(r, /q\(\{ mb[,: ]/, r.trim());
  });
  test("IMAP en SMTP via het gecontroleerde openbare IP (geen DNS-rebinding)", () => {
    assert.match(lees("lib", "mail", "imap.ts"), /openbaarAdres\(cfg\.imapHost\)/);
    assert.match(lees("lib", "mail", "smtp.ts"), /openbaarAdres\(cfg\.smtpHost\)/);
    assert.match(lees("lib", "mail", "dns.ts"), /isPubliekAdres/);
  });
  test("migratie 0026 (mailboxen): idempotent, RLS zonder policies, geen rechten voor app-rollen", () => {
    const sql = lees("supabase", "migrations", "0026_beveiliging_mailboxen_backups.sql").replace(/--[^\n]*/g, "");
    assert.match(sql, /create table if not exists public\.mailboxen/);
    assert.match(sql, /create unique index if not exists mailboxen_eigenaar_email on public\.mailboxen \(eigenaar_id, lower\(email\)\)/);
    assert.match(sql, /alter table public\.mailboxen enable row level security/);
    assert.match(sql, /revoke all on public\.mailboxen from anon, authenticated/);
    assert.doesNotMatch(sql, /create policy[^;]*mailboxen/i);
    assert.match(sql, /on conflict \(eigenaar_id, lower\(email\)\) do nothing/);
    assert.match(sql, /check \(zichtbaarheid in \('prive', 'team'\)\)/);
  });
}

console.log(`${goed} tests geslaagd${process.exitCode ? ", met fouten" : ""}`);
