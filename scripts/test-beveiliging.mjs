// Tests voor de beveiliging (stap 2): 2FA-beslisregels, pogingenlimiet, sessiecookie,
// Content-Security-Policy, log-maskering, en een paar vaste controles op de code
// (wie de systeem-service-role mag gebruiken, eigenaarsroutes, headers, migratie).
// Geen netwerk, geen database, geen .env.
//
// Gebruik:  node scripts/test-beveiliging.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);
const lees = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let tfa, limiet, sessie, csp, log;
try {
  tfa = await laad("lib", "auth", "tfa-kern.ts");
  limiet = await laad("lib", "auth", "limiet-kern.ts");
  sessie = await laad("lib", "auth", "sessie-kern.ts");
  csp = await laad("lib", "auth", "csp-kern.ts");
  log = await laad("lib", "log.ts");
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
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

// ---------- 2FA-beslisregels ----------
await test("MFA_AFDWINGEN: standaard aan, alleen 'uit' (e.d.) zet uit", () => {
  for (const v of [undefined, null, "", "aan", "1", "true", "ja", "  "]) assert.equal(tfa.afdwingenUitEnv(v), true, String(v));
  for (const v of ["uit", "UIT", " uit ", "off", "false", "0", "nee"]) assert.equal(tfa.afdwingenUitEnv(v), false, String(v));
});
await test("tfaStap: factor + aal1 = altijd uitdaging (ook met afdwingen uit of zonder migratie)", () => {
  for (const afdwingen of [true, false]) for (const migratie of [true, false]) {
    assert.equal(tfa.tfaStap({ heeftFactor: true, aal: "aal1", afdwingen, migratie }), "uitdaging");
    assert.equal(tfa.tfaStap({ heeftFactor: true, aal: "aal2", afdwingen, migratie }), "ok");
  }
});
await test("tfaStap: zonder factor alleen verplicht instellen met afdwingen én migratie (nooit buitensluiten)", () => {
  assert.equal(tfa.tfaStap({ heeftFactor: false, aal: "aal1", afdwingen: true, migratie: true }), "instellen");
  assert.equal(tfa.tfaStap({ heeftFactor: false, aal: "aal1", afdwingen: false, migratie: true }), "ok");
  assert.equal(tfa.tfaStap({ heeftFactor: false, aal: "aal1", afdwingen: true, migratie: false }), "ok");
  assert.equal(tfa.tfaStap({ heeftFactor: false, aal: "aal1", afdwingen: false, migratie: false }), "ok");
});
await test("alsAal: alleen 'aal2' telt als aal2", () => {
  assert.equal(tfa.alsAal("aal2"), "aal2");
  for (const v of ["aal1", "AAL2", null, undefined, 2, "aal3"]) assert.equal(tfa.alsAal(v), "aal1");
});
await test("schoneCode: 6 cijfers, spaties/streepjes mogen", () => {
  assert.equal(tfa.schoneCode("123456"), "123456");
  assert.equal(tfa.schoneCode("123 456"), "123456");
  assert.equal(tfa.schoneCode("123-456"), "123456");
  for (const v of ["12345", "1234567", "abcdef", "", null, 123456, "12 34 5a"]) assert.equal(tfa.schoneCode(v), null, String(v));
});
await test("apparaatNaam: standaard, uniek, zonder HTML of stuurtekens", () => {
  assert.equal(tfa.apparaatNaam("", []), "Telefoon");
  assert.equal(tfa.apparaatNaam(undefined, ["Telefoon"]), "Tweede apparaat");
  assert.equal(tfa.apparaatNaam("Telefoon", ["Telefoon"]), "Telefoon 2");
  assert.equal(tfa.apparaatNaam("<b>1Password</b>\n", []), "b1Password/b");
  assert.ok(tfa.apparaatNaam("x".repeat(100), []).length <= 40);
});
await test("veiligeQr: alleen een SVG-data-URI", () => {
  assert.ok(tfa.veiligeQr("data:image/svg+xml;utf-8,<svg></svg>"));
  for (const v of ["https://evil.example/qr.svg", "javascript:alert(1)", "data:text/html,<script>", null, 1]) assert.equal(tfa.veiligeQr(v), null, String(v));
});
await test("MAX_FACTOREN = 2", () => assert.equal(tfa.MAX_FACTOREN, 2));

// ---------- pogingenlimiet ----------
await test("beoordeel: 4 fout = door, 5 fout = geblokkeerd; oude pogingen tellen niet", () => {
  const nu = 1_000_000_000;
  const v = 15 * 60_000;
  const t = (minGeleden) => nu - minGeleden * 60_000;
  assert.equal(limiet.beoordeel([t(1), t(2), t(3), t(4)], 5, v, nu).geblokkeerd, false);
  const b = limiet.beoordeel([t(1), t(2), t(3), t(4), t(10)], 5, v, nu);
  assert.equal(b.geblokkeerd, true);
  // De oudste meetellende (10 min geleden) valt over 5 minuten uit het venster.
  assert.ok(Math.abs(b.wachtMs - 5 * 60_000) < 1000, String(b.wachtMs));
  assert.equal(limiet.beoordeel([t(1), t(2), t(3), t(4), t(16)], 5, v, nu).geblokkeerd, false);
  assert.equal(limiet.beoordeel([], 5, v, nu).geblokkeerd, false);
});
await test("standaardlimieten: inloggen 5/15 min per e-mail, 20 per IP; 2FA 5/5 min; herstel 3/uur", () => {
  assert.deepEqual(limiet.LIMIETEN.inloggenEmail, { max: 5, vensterMs: 15 * 60_000 });
  assert.deepEqual(limiet.LIMIETEN.inloggenIp, { max: 20, vensterMs: 15 * 60_000 });
  assert.deepEqual(limiet.LIMIETEN.tfaCode, { max: 5, vensterMs: 5 * 60_000 });
  assert.deepEqual(limiet.LIMIETEN.wachtwoordVergeten, { max: 3, vensterMs: 60 * 60_000 });
});
await test("na 6 foute inlogpogingen geblokkeerd (acceptatie)", () => {
  const nu = Date.now();
  const tijden = [];
  let geblokkeerd = false;
  for (let i = 0; i < 6; i++) {
    geblokkeerd = limiet.beoordeel(tijden, 5, 15 * 60_000, nu).geblokkeerd;
    if (!geblokkeerd) tijden.push(nu - (6 - i) * 1000);
  }
  assert.equal(geblokkeerd, true);
});
await test("wachtTekst", () => {
  assert.equal(limiet.wachtTekst(30_000), "over een minuut");
  assert.equal(limiet.wachtTekst(4 * 60_000 + 1), "over 5 minuten");
});

// ---------- sessiecookie ----------
await test("sessie: heen en terug, geknoei en verkeerde sleutel falen", async () => {
  const k = await sessie.sessieSleutel("geheim-1");
  const k2 = await sessie.sessieSleutel("geheim-2");
  const w = await sessie.maakSessieWaarde(k, { start: 1_700_000_000_000, laatst: 1_700_000_100_000 });
  assert.deepEqual(await sessie.leesSessieWaarde(k, w), { start: 1_700_000_000_000, laatst: 1_700_000_100_000 });
  assert.equal(await sessie.leesSessieWaarde(k2, w), null);
  const delen = w.split(".");
  const verlengd = [delen[0], delen[1], String(Number(delen[2]) + 99999999), delen[3]].join(".");
  assert.equal(await sessie.leesSessieWaarde(k, verlengd), null);
  for (const v of ["", null, undefined, "v1.1.2", "x".repeat(500), w + "a"]) assert.equal(await sessie.leesSessieWaarde(k, v), null, String(v));
  assert.equal(await sessie.leesSessieWaarde(k, await sessie.maakSessieWaarde(k, { start: 10, laatst: 5 })), null, "laatst < start");
});
await test("sessie: 12 uur inactief of 14 dagen = verlopen; ververs na 5 min; geen cookie = nieuw", () => {
  const nu = 2_000_000_000_000;
  const u = 3_600_000;
  assert.deepEqual(sessie.sessieBeslissing(null, nu), { soort: "nieuw" });
  assert.deepEqual(sessie.sessieBeslissing({ start: nu - u, laatst: nu - 60_000 }, nu), { soort: "ok", verversen: false });
  assert.deepEqual(sessie.sessieBeslissing({ start: nu - u, laatst: nu - 6 * 60_000 }, nu), { soort: "ok", verversen: true });
  assert.deepEqual(sessie.sessieBeslissing({ start: nu - 13 * u, laatst: nu - 12 * u - 1000 }, nu), { soort: "verlopen", reden: "inactief" });
  assert.deepEqual(sessie.sessieBeslissing({ start: nu - 14 * 24 * u - 1000, laatst: nu - 1000 }, nu), { soort: "verlopen", reden: "max" });
  assert.deepEqual(sessie.sessieBeslissing({ start: nu + 10 * u, laatst: nu + 10 * u }, nu), { soort: "nieuw" });
});
await test("sessie: zonder cookie alleen een nieuwe bij een recent inlogmoment (amr)", () => {
  const nu = 2_000_000_000_000;
  const s = (ms) => Math.floor(ms / 1000);
  assert.equal(sessie.inlogMoment(null), 0);
  assert.equal(sessie.inlogMoment({}), 0);
  assert.equal(sessie.inlogMoment({ amr: "x" }), 0);
  assert.equal(sessie.inlogMoment({ amr: [{ method: "password", timestamp: s(nu - 60_000) }, { method: "totp", timestamp: s(nu - 30_000) }] }), s(nu - 30_000) * 1000);
  assert.equal(sessie.nieuwToegestaan(nu - 5 * 60_000, nu), true);
  assert.equal(sessie.nieuwToegestaan(nu - 11 * 60_000, nu), false, "laptop 16 dagen dicht: uitloggen");
  assert.equal(sessie.nieuwToegestaan(0, nu), false, "onbekend inlogmoment: uitloggen");
  assert.equal(sessie.nieuwToegestaan(nu + 10 * 60_000, nu), false);
  const p = lees("proxy.ts");
  assert.ok(/nieuwToegestaan\(/.test(p) && /inlogMoment\(claims\)/.test(p));
});
await test("sessiecookie: httpOnly, secure, SameSite=Lax", () => {
  assert.equal(sessie.SESSIE_COOKIE_OPTIES.httpOnly, true);
  assert.equal(sessie.SESSIE_COOKIE_OPTIES.secure, true);
  assert.equal(sessie.SESSIE_COOKIE_OPTIES.sameSite, "lax");
});

// ---------- CSP ----------
await test("CSP: nonce, geen unsafe-inline/eval in script-src, frame-ancestors, Supabase in connect-src", () => {
  const n = csp.maakNonce();
  assert.match(n, /^[A-Za-z0-9+/=]{20,}$/);
  assert.notEqual(n, csp.maakNonce());
  const c = csp.bouwCsp({ nonce: n, supabaseUrl: "https://abcd.supabase.co" });
  const delen = Object.fromEntries(c.split("; ").map((d) => [d.split(" ")[0], d]));
  assert.ok(delen["script-src"].includes(`'nonce-${n}'`));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(delen["script-src"]));
  assert.equal(delen["frame-ancestors"], "frame-ancestors 'self'");
  assert.equal(delen["object-src"], "object-src 'none'");
  assert.equal(delen["base-uri"], "base-uri 'none'");
  assert.ok(delen["connect-src"].includes("https://abcd.supabase.co") && delen["connect-src"].includes("wss://abcd.supabase.co"));
  assert.ok(delen["upgrade-insecure-requests"]);
  assert.ok(delen["style-src"].includes("https://fonts.googleapis.com") && delen["font-src"].includes("https://fonts.gstatic.com"));
});
await test("CSP: development mag eval (React-debug), geen upgrade-insecure; rare URL genegeerd", () => {
  const c = csp.bouwCsp({ nonce: "abc", supabaseUrl: "javascript:alert(1)", dev: true });
  assert.ok(c.includes("'unsafe-eval'"));
  assert.ok(!c.includes("upgrade-insecure-requests"));
  assert.ok(!c.includes("javascript:"));
});

// ---------- logs ----------
await test("logs: e-mailadressen, tokens, JWT's en sleutels gemaskeerd", () => {
  const s = log.maskeer("fout voor jan@example.com bij https://x.supabase.co/storage/v1/object/sign/a.pdf?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij&x=1 Bearer abc.def sk-ant-1234567890abcdef");
  assert.ok(!s.includes("jan@example.com"));
  assert.ok(!s.includes("eyJhbGci"));
  assert.ok(!s.includes("abc.def"));
  assert.ok(!s.includes("sk-ant-1234567890abcdef"));
  assert.ok(s.includes("token=***"));
});
await test("foutSamenvatting: alleen naam/code/status/melding, nooit het hele object", () => {
  const e = Object.assign(new Error("kapot voor a@b.nl"), { code: "PGRST301", status: 500, details: "geheime query", hint: "x" });
  const s = log.foutSamenvatting(e);
  assert.ok(s.includes("PGRST301") && s.includes("500"));
  assert.ok(!s.includes("geheime query") && !s.includes("a@b.nl"));
  assert.equal(log.foutSamenvatting(null), "onbekend");
});

// ---------- vaste controles op de code ----------
function bestanden(dir, filter = /\.(ts|tsx|mjs|js)$/) {
  const uit = [];
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(d.name)) continue;
      uit.push(...bestanden(rel, filter));
    } else if (filter.test(d.name)) uit.push(rel);
  }
  return uit;
}
const code = [...bestanden("app"), ...bestanden("lib"), ...bestanden("components"), "proxy.ts"];

await test("systeemBewijs alleen in lib/supabase/systeem.ts; systeemClient alleen via de allowlist", () => {
  const bewijs = code.filter((f) => /\bsysteemBewijs\b/.test(lees(f)) && f !== path.join("lib", "auth", "team.ts"));
  assert.deepEqual(bewijs, [path.join("lib", "supabase", "systeem.ts")]);
  const toegestaan = new Set([
    path.join("lib", "supabase", "systeem.ts"),
    path.join("lib", "audit.ts"),
    path.join("lib", "auth", "inlogpogingen.ts"),
    path.join("lib", "auth", "cron.ts")
  ]);
  const gebruikers = code.filter((f) => /from ['"]@\/lib\/supabase\/systeem['"]/.test(lees(f)) || /\bsysteemClient\(/.test(lees(f)));
  const fout = gebruikers.filter((f) => !toegestaan.has(f));
  assert.deepEqual(fout, [], fout.join(", "));
});
await test("eigenaarsroutes: elke /api/beveiliging-route via eigenaarRoute of tfaRoute", () => {
  const routes = bestanden(path.join("app", "api", "beveiliging"), /^route\.ts$/);
  assert.ok(routes.length >= 7, routes.join(","));
  for (const r of routes) {
    const s = lees(r);
    assert.ok(/eigenaarRoute|tfaRoute|cronRoute/.test(s), r);
  }
});
await test("proxy: /api/beveiliging en /login/2fa niet als vrij API-pad; CSP en sessiebeleid aanwezig", () => {
  const p = lees("proxy.ts");
  assert.ok(!/['"]\/api\/beveiliging/.test(p));
  assert.ok(/bouwCsp\(/.test(p) && /sessieBeslissing\(/.test(p) && /toegangStatus\(/.test(p));
  assert.ok(/signOut\(\{ scope: 'local' \}\)/.test(p), "verlopen sessie: alleen dit apparaat uitloggen");
});
await test("next.config: HSTS, COOP, CORP, nosniff, geen beeldoptimalisatie", () => {
  const n = lees("next.config.ts");
  for (const k of ["Strict-Transport-Security", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "X-Content-Type-Options", "X-Frame-Options"]) assert.ok(n.includes(k), k);
  assert.ok(/images:\s*\{\s*unoptimized:\s*true/.test(n));
});
await test("Next.js en eslint-config-next gepatcht (>= 16.4.3)", () => {
  const pkg = JSON.parse(lees("package.json"));
  const v = (s) => s.replace(/^[^\d]*/, "").split(".").map(Number);
  for (const naam of ["next", "eslint-config-next"]) {
    const [a, b, c] = v(pkg.dependencies[naam] ?? pkg.devDependencies[naam]);
    assert.ok(a > 16 || (a === 16 && (b > 4 || (b === 4 && c >= 3))), `${naam} ${pkg.dependencies[naam] ?? pkg.devDependencies[naam]}`);
  }
});
await test("server-logs: geen ruwe foutobjecten (logFout gebruiken)", () => {
  const server = code.filter((f) => !/client\.ts$|components[\\/]/.test(f));
  const fout = [];
  for (const f of server) {
    lees(f)
      .split("\n")
      .forEach((regel, i) => {
        if (/console\.(error|warn)\((e|err|error)\)|console\.(error|warn)\([^)]*,\s*(e|err|error|upErr)\s*\)/.test(regel)) fout.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(fout, [], fout.join(", "));
});
await test("migratie 0026: is_teamlid met aal2 + factoren + noodstop, audit-log alleen-toevoegen", () => {
  const m = lees("supabase", "migrations", "0026_beveiliging_mailboxen_backups.sql");
  assert.ok(/create or replace function public\.is_teamlid\(\)[\s\S]*?auth\.jwt\(\)\) ->> 'aal'[\s\S]*?auth\.mfa_factors[\s\S]*?\$\$;/.test(m));
  assert.ok(/security definer\s+set search_path = ''/.test(m));
  assert.ok(/before update or delete on public\.audit_log/.test(m) && /before truncate on public\.audit_log/.test(m));
  assert.ok(/revoke update, delete, truncate on public\.audit_log from service_role/.test(m));
});
await test(".env.local.example: alleen namen voor de nieuwe variabelen", () => {
  const e = lees(".env.local.example");
  for (const k of ["MFA_AFDWINGEN", "SESSIE_GEHEIM", "AUDIT_PEPPER", "TEAM_VEREIST"]) assert.match(e, new RegExp(`^${k}=$`, "m"), k);
});
await test("audit-details: alleen een vaste lijst sleutels (geen wachtwoord/token/code)", () => {
  const a = lees("lib", "audit.ts");
  const lijst = /const TOEGESTAAN = new Set\(\[([\s\S]*?)\]\)/.exec(a)?.[1] ?? "";
  for (const verboden of ["wachtwoord", "password", "token", "code", "secret", "geheim", "inhoud", "body"]) assert.ok(!new RegExp(`'${verboden}'`).test(lijst), verboden);
});

console.log(`\n${goed} geslaagd${process.exitCode ? ", met fouten" : ", 0 mislukt"}`);
