#!/usr/bin/env node
/**
 * Importeert de boekhouding van eerdere jaren (uit de Excel-jaarrekeningen) in de bk_*-tabellen
 * van migratie 0027, en controleert daarna met de eigen rekenkern van het systeem
 * (lib/boekhouding/kern, via dezelfde laadroute als de app: SupabaseRepo → laadAlles →
 * journaalVan) of elk getal gelijk is aan de Excel.
 *
 * Invoer (map met drie JSON-bestanden, NIET in de repo: financiële gegevens van de eigenaar):
 *   excel-2024.json, excel-2025.json  de uitgelezen Excel-jaarrekeningen (alle tabbladen)
 *   mapping.json                      instellingen, rekeningen, grootboek, boekingen,
 *                                     memoriaal, activa, aangiften, jaarafsluiting
 *   verklaringen.json (optioneel)     verklaarde verschillen met de Excel: { "<post-id>":
 *                                     { "verschil": <centen>, "verklaring": "..." } } of
 *                                     { "som": ["<post-id>", ...], "verklaring": "..." }
 *
 * Gebruik:
 *   # 1. Lokaal, zonder netwerk: alles in een PGlite-database (migraties 0001–0027, nagebootste
 *   #    auth/storage); facturen/bonnetjes uit een read-only export van productie.
 *   node scripts/boekhouding-importeren.mjs --bron=<map> --doel=pglite [--export=<supabase-export.json>] [--rapport=<controle.md>]
 *
 *   # 2. Productie, DROOG (standaard): leest productie alleen, zet een kopie in PGlite en voert
 *   #    daar de import + volledige controle uit. Er wordt niets geschreven.
 *   node --env-file=.env.local scripts/boekhouding-importeren.mjs --bron=<map> [--rapport=<controle.md>]
 *
 *   # 3. Productie, ECHT: eerst stap 2 (moet foutloos zijn), dan bevestigen door de host te
 *   #    typen, dan schrijven met de service-role, en daarna dezelfde controle op productie.
 *   node --env-file=.env.local scripts/boekhouding-importeren.mjs --bron=<map> --uitvoeren [--rapport=<controle.md>]
 *
 * Eigenschappen:
 *   - Idempotent: boekingen hebben een vaste import_sleutel (bk_boekingen, uniek per rekening);
 *     memoriaal op (datum, soort, omschrijving), activa op (omschrijving, aanschafdatum),
 *     aangiften op (jaar, kwartaal), koppelingen op (boeking, bron, bron_id), boekjaren op jaar.
 *     Wat er al staat wordt vergeleken: gelijk = overslaan, anders = stoppen (conflict).
 *   - Eén logische batch per jaar: "2024" (inrichting, activa, memoriaal, aangifte Q4,
 *     jaarafsluiting) en "2025" (bankregels, memoriaal, aangiften Q1–Q4, btw-betalingen).
 *     In PGlite is elke batch één transactie. Op productie (PostgREST) is elke tabel één
 *     verzoek; gaat er halverwege iets mis, dan is opnieuw draaien veilig (idempotent).
 *   - Elke regel gaat door de invoercontrole van de app (parseBoekingInvoer,
 *     parseMemoriaalInvoer, parseActivumInvoer, betalingFout); aangiften en de jaarafsluiting
 *     worden berekend zoals de app dat doet (aangifteRubrieken/naarSnapshot, afsluitStatus,
 *     jaarafsluitingVoorstel, jaarSamenvatting).
 *   - De Supabase-URL en service-role-key komen uit de omgeving (SUPABASE_URL of
 *     NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). De key wordt nooit getoond.
 *   - Facturen (invoices) en bonnetjes (expenses) worden alleen gelezen, nooit gewijzigd.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------------------- argumenten
const ARGS = process.argv.slice(2);
const optie = (naam) => {
  const a = ARGS.find((x) => x === `--${naam}` || x.startsWith(`--${naam}=`));
  if (!a) return null;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : true;
};
const BRON = optie("bron");
const DOEL = optie("doel") || "productie";
const UITVOEREN = optie("uitvoeren") === true;
const EXPORT = optie("export");
const RAPPORT = optie("rapport");
const STIL = optie("stil") === true;
const DUMP = optie("dump");

function stop(msg, code = 1) {
  console.error(`\nFout: ${msg}`);
  process.exit(code);
}
if (!BRON || BRON === true) stop("geef de map met excel-2024.json, excel-2025.json en mapping.json op: --bron=<map>");
if (!["pglite", "productie"].includes(DOEL)) stop("--doel moet pglite of productie zijn");
if (UITVOEREN && DOEL !== "productie") stop("--uitvoeren hoort bij --doel=productie (PGlite schrijft altijd, in het geheugen)");

// ------------------------------------------------------------------------------- TS laden
// De rekenkern en de repo zijn TypeScript; Node strip de types. '@/…' wijst naar de repo,
// 'server-only' is buiten Next een lege module. Zo nodig opnieuw starten met de vlag.
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + "/").href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'server-only') return { url: 'data:text/javascript,export%20%7B%7D', shortCircuit: true };
  if (spec.startsWith('@/')) spec = new URL(spec.slice(2), ROOT).href;
  if ((spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.endsWith('.ts')) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
  import.meta.url,
);
const laadTs = (p) => import(pathToFileURL(path.join(ROOT, "lib", "boekhouding", p)).href);
let K;
try {
  const [model, journaal, aangifte, rapporten, afschrijving, memoriaal, periode, types, jaarwerk, repo] = await Promise.all(
    ["model.ts", "kern/journaal.ts", "kern/aangifte.ts", "kern/rapporten.ts", "kern/afschrijving.ts", "kern/memoriaal.ts", "kern/periode.ts", "repo/types.ts", "jaarwerk.ts", "repo/supabase.ts"].map(laadTs),
  );
  K = { model, journaal, aangifte, rapporten, afschrijving, memoriaal, periode, types, jaarwerk, repo };
} catch (err) {
  if (process.env.BK_IMPORT_CHILD) throw err;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...ARGS], {
    stdio: "inherit",
    env: { ...process.env, BK_IMPORT_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}

const log = (...a) => {
  if (!STIL) console.log(...a);
};
const euro = (c) => (c === null || c === undefined ? "—" : `${c < 0 ? "−" : ""}€ ${(Math.abs(c) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
/** Euro (float uit de Excel) → hele centen, half weg van nul. */
const cent = (x) => (x === null || x === undefined ? null : Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7));
const VANDAAG = K.periode.vandaagNL();

// ------------------------------------------------------------------------------- invoer
const leesJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const bronPad = (f) => path.join(path.resolve(BRON), f);
for (const f of ["excel-2024.json", "excel-2025.json", "mapping.json"]) if (!fs.existsSync(bronPad(f))) stop(`${f} ontbreekt in ${BRON}`);
const X24 = leesJson(bronPad("excel-2024.json"));
const X25 = leesJson(bronPad("excel-2025.json"));
const M = leesJson(bronPad("mapping.json"));
const VERKL = fs.existsSync(bronPad("verklaringen.json")) ? leesJson(bronPad("verklaringen.json")) : {};
if (M.versie !== 1) stop("onbekende versie van mapping.json");

// =============================================================================== databases
// Een minimale supabase-js-achtige cliënt bovenop PGlite (alleen wat de repo en deze tool
// gebruiken): from().select/insert/update/delete + eq/neq/is/not/in/gte/lte/order/limit/
// range/single/maybeSingle, embeds als "bk_memoriaal_regels(...)", en rpc().
function splitsKolommen(s) {
  const uit = [];
  let diepte = 0;
  let huidig = "";
  for (const ch of s) {
    if (ch === "(") diepte++;
    if (ch === ")") diepte--;
    if (ch === "," && diepte === 0) {
      uit.push(huidig.trim());
      huidig = "";
    } else huidig += ch;
  }
  if (huidig.trim()) uit.push(huidig.trim());
  return uit;
}
const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
const param = (v) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

class PgQuery {
  constructor(db, tabel) {
    this.db = db;
    this.tabel = tabel;
    this.op = "select";
    this.kolommen = "*";
    this.terug = null;
    this.filters = [];
    this.volgorde = [];
    this.max = null;
    this.vanaf = 0;
    this.een = null;
  }
  select(k = "*") {
    if (this.op === "select") this.kolommen = k;
    else this.terug = k;
    return this;
  }
  insert(rijen) {
    this.op = "insert";
    this.rijen = Array.isArray(rijen) ? rijen : [rijen];
    return this;
  }
  update(w) {
    this.op = "update";
    this.waarden = w;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(k, v) { this.filters.push([k, "=", v]); return this; }
  neq(k, v) { this.filters.push([k, "<>", v]); return this; }
  gte(k, v) { this.filters.push([k, ">=", v]); return this; }
  lte(k, v) { this.filters.push([k, "<=", v]); return this; }
  is(k, v) { this.filters.push([k, v === null ? "is null" : `is ${v}`]); return this; }
  not(k, op, v) {
    if (op === "is" && v === null) this.filters.push([k, "is not null"]);
    else throw new Error(`not(${op}) niet ondersteund`);
    return this;
  }
  in(k, lijst) { this.filters.push([k, "in", lijst]); return this; }
  order(k, o = {}) { this.volgorde.push(`${q(k)} ${o.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n) { this.max = n; return this; }
  range(a, b) { this.vanaf = a; this.max = b - a + 1; return this; }
  single() { this.een = "single"; return this; }
  maybeSingle() { this.een = "maybe"; return this; }
  then(ok, nok) { return this.uitvoeren().then(ok, nok); }

  waar(params) {
    const delen = this.filters.map(([k, op, v]) => {
      if (op === "is null" || op === "is not null" || op.startsWith("is ")) return `${q(k)} ${op}`;
      if (op === "in") {
        if (!v.length) return "false";
        return `${q(k)} in (${v.map((x) => (params.push(param(x)), `$${params.length}`)).join(", ")})`;
      }
      params.push(param(v));
      return `${q(k)} ${op} $${params.length}`;
    });
    return delen.length ? ` where ${delen.join(" and ")}` : "";
  }

  async embeds(rijen, kolommen) {
    for (const k of kolommen.filter((x) => x.includes("("))) {
      const naam = k.slice(0, k.indexOf("(")).trim();
      const sub = splitsKolommen(k.slice(k.indexOf("(") + 1, k.lastIndexOf(")")));
      const fk = (
        await this.db.query(
          `select a.attname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.conrelid = $1::regclass and c.confrelid = $2::regclass limit 1`,
          [`public.${naam}`, `public.${this.tabel}`],
        )
      ).rows[0]?.attname;
      if (!fk) throw new Error(`geen relatie ${this.tabel} → ${naam}`);
      const ids = rijen.map((r) => r.id);
      const kids = ids.length
        ? (await this.db.query(`select *, ${q(fk)} as "__ouder" from public.${q(naam)} where ${q(fk)} in (${ids.map((_, i) => `$${i + 1}`).join(", ")})`, ids)).rows
        : [];
      for (const r of rijen) {
        r[naam] = kids
          .filter((c) => c.__ouder === r.id)
          .map((c) => (sub.includes("*") ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== "__ouder")) : Object.fromEntries(sub.map((s) => [s, c[s] ?? null]))));
      }
    }
  }

  projecteer(rijen, spec) {
    const kolommen = splitsKolommen(spec);
    if (kolommen.includes("*")) return rijen;
    const plat = kolommen.filter((k) => !k.includes("("));
    const emb = kolommen.filter((k) => k.includes("(")).map((k) => k.slice(0, k.indexOf("(")).trim());
    return rijen.map((r) => Object.fromEntries([...plat, ...emb].map((k) => [k, r[k] ?? null])));
  }

  async uitvoeren() {
    try {
      const params = [];
      let rijen;
      if (this.op === "select") {
        const kolommen = splitsKolommen(this.kolommen);
        const plat = kolommen.filter((k) => !k.includes("("));
        const nodigId = kolommen.some((k) => k.includes("(")) && !plat.includes("id") && !plat.includes("*");
        const lijst = plat.includes("*") ? "*" : [...plat, ...(nodigId ? ["id"] : [])].map(q).join(", ");
        let sql = `select ${lijst} from public.${q(this.tabel)}${this.waar(params)}`;
        if (this.volgorde.length) sql += ` order by ${this.volgorde.join(", ")}`;
        if (this.max !== null) sql += ` limit ${Number(this.max)}`;
        if (this.vanaf) sql += ` offset ${Number(this.vanaf)}`;
        rijen = (await this.db.query(sql, params)).rows;
        await this.embeds(rijen, kolommen);
        rijen = this.projecteer(rijen, this.kolommen);
      } else if (this.op === "insert") {
        const kolommen = [...new Set(this.rijen.flatMap((r) => Object.keys(r)))];
        const waarden = this.rijen.map((r) => `(${kolommen.map((k) => (params.push(param(r[k] === undefined ? null : r[k])), `$${params.length}`)).join(", ")})`);
        const sql = `insert into public.${q(this.tabel)} (${kolommen.map(q).join(", ")}) values ${waarden.join(", ")} returning *`;
        rijen = (await this.db.query(sql, params)).rows;
        if (this.terug === null) return { data: null, error: null };
        rijen = this.projecteer(rijen, this.terug);
      } else if (this.op === "update") {
        const set = Object.entries(this.waarden).map(([k, v]) => (params.push(param(v)), `${q(k)} = $${params.length}`));
        rijen = (await this.db.query(`update public.${q(this.tabel)} set ${set.join(", ")}${this.waar(params)} returning *`, params)).rows;
        if (this.terug === null) return { data: null, error: null };
        rijen = this.projecteer(rijen, this.terug);
      } else {
        rijen = (await this.db.query(`delete from public.${q(this.tabel)}${this.waar(params)} returning *`, params)).rows;
        if (this.terug === null) return { data: null, error: null };
        rijen = this.projecteer(rijen, this.terug);
      }
      if (this.een) {
        if (rijen.length > 1 || (this.een === "single" && rijen.length === 0)) return { data: null, error: { code: "PGRST116", message: `${rijen.length} rijen` } };
        return { data: rijen[0] ?? null, error: null };
      }
      return { data: rijen, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code ?? "XX000", message: e.message } };
    }
  }
}

function pgliteCliënt(db) {
  return {
    from: (t) => new PgQuery(db, t),
    async rpc(fn, args) {
      try {
        const namen = Object.keys(args ?? {});
        const r = await db.query(`select public.${q(fn)}(${namen.map((n, i) => `${q(n)} => $${i + 1}`).join(", ")}) as uit`, namen.map((n) => param(args[n])));
        return { data: r.rows[0]?.uit ?? null, error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    },
  };
}

// timestamptz zoals PostgREST (ISO), bigint/numeric als getal, date als tekst.
function isoTijd(v) {
  let s = String(v).replace(" ", "T");
  if (/[+-]\d\d$/.test(s)) s += ":00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
const PARSERS = { 20: (v) => Number(v), 1700: (v) => Number(v), 1082: (v) => v, 1184: isoTijd, 1114: isoTijd };

const SUPABASE_BASIS = (() => {
  const rls = fs.readFileSync(path.join(ROOT, "scripts", "test-rls.mjs"), "utf8");
  const i = rls.indexOf("const SUPABASE_BASIS = `") + "const SUPABASE_BASIS = `".length;
  return rls.slice(i, rls.indexOf("`;", i));
})();
const EIGENAAR_PGLITE = "0e1e0000-0000-4000-8000-00000000000e";

/** Lokale Postgres met het Supabase-fundament, migraties 0001–0026 en UITVOEREN_0027.sql. */
async function maakPglite() {
  let PGlite, pgcrypto;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
    ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
  } catch {
    stop("@electric-sql/pglite ontbreekt: draai eerst npm install (devDependency).");
  }
  const db = new PGlite({ extensions: { pgcrypto }, parsers: PARSERS });
  await db.exec(SUPABASE_BASIS);
  const migraties = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < "0027").sort();
  const voer = async (f) => {
    try {
      await db.exec(fs.readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  };
  for (const f of migraties.filter((f) => f < "0021")) await voer(f);
  // Zoals in productie: de eerste gebruiker wordt bij 0021 de eigenaar.
  await db.query("insert into auth.users (id, email, created_at, email_confirmed_at) values ($1, 'eigenaar@pglite.test', now() - interval '1 year', now())", [EIGENAAR_PGLITE]);
  for (const f of migraties.filter((f) => f >= "0021")) await voer(f);
  const res = await db.exec(fs.readFileSync(path.join(ROOT, "supabase", "UITVOEREN_0027.sql"), "utf8"));
  const controle = res[res.length - 1]?.rows ?? [];
  const mis = controle.filter((r) => !["ok", "actief", "gedeactiveerd"].includes(r.status));
  if (!controle.length || mis.length) throw new Error(`UITVOEREN_0027.sql: controle niet ok (${mis.map((r) => `${r.onderdeel}=${r.status}`).join(", ")})`);
  return db;
}

/** Rijen (uit productie of een export) in PGlite zetten, als postgres, zonder triggers/FK-controles. */
async function kopieerNaarPglite(db, tabel, rijen, { leegEerst = false } = {}) {
  const info = (
    await db.query(
      `select column_name as naam, data_type as type, is_nullable = 'NO' as verplicht, column_default is not null as standaard, is_generated = 'ALWAYS' or is_identity = 'YES' as gegenereerd
       from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [tabel],
    )
  ).rows;
  if (!info.length) return 0;
  await db.exec("set session_replication_role = replica");
  try {
    if (leegEerst) await db.exec(`delete from public.${q(tabel)}`);
    let n = 0;
    for (const r of rijen) {
      const rij = {};
      for (const c of info) {
        if (c.gegenereerd) continue;
        let v = r[c.naam];
        if (v === undefined) {
          if (!c.verplicht || c.standaard) continue;
          v = c.type.includes("char") || c.type === "text" ? "(export)" : c.type === "uuid" ? randomUUID() : c.type === "boolean" ? false : c.type.startsWith("timestamp") ? new Date().toISOString() : c.type === "date" ? "2000-01-01" : c.type === "jsonb" || c.type === "json" ? {} : c.type === "ARRAY" ? "{}" : 0;
        }
        // text[] e.d.: een Postgres-arrayliteral (jsonb blijft JSON).
        if (c.type === "ARRAY" && Array.isArray(v)) v = `{${v.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
        rij[c.naam] = v;
      }
      const k = Object.keys(rij);
      await db.query(`insert into public.${q(tabel)} (${k.map(q).join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")})`, k.map((x) => param(rij[x])));
      n++;
    }
    return n;
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

const BK_TABELLEN = ["bk_instellingen", "bk_grootboek", "bk_rekeningen", "bk_vennoten", "bk_imports", "bk_boekingen", "bk_koppelingen", "bk_activa", "bk_bron_extra", "bk_memoriaal", "bk_memoriaal_regels", "bk_aangiften", "bk_boekjaren"];
// Volgorde voor het kopiëren (ouders eerst).
const KOPIE_VOLGORDE = ["bk_instellingen", "bk_grootboek", "bk_rekeningen", "bk_vennoten", "bk_imports", "bk_boekingen", "bk_activa", "bk_memoriaal", "bk_memoriaal_regels", "bk_aangiften", "bk_koppelingen", "bk_bron_extra", "bk_boekjaren"];

/** Productie alleen lezen: facturen, bonnetjes, de bk-tabellen (als 0027 er is) en de eigenaar. */
async function leesProductie(sb) {
  const alles = async (tabel) => {
    const uit = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await sb.from(tabel).select("*").range(i, i + 999);
      if (error) return { error };
      uit.push(...data);
      if (data.length < 1000) return { data: uit };
    }
  };
  const res = { tabellen: {}, bk: false, eigenaar: null };
  for (const t of ["clients", "invoices", "expenses"]) {
    const r = await alles(t);
    if (r.error) stop(`productie: ${t} lezen mislukt (${r.error.code ?? ""} ${r.error.message ?? ""})`);
    res.tabellen[t] = r.data;
  }
  const probe = await sb.from("bk_instellingen").select("id").limit(1);
  if (!probe.error) {
    res.bk = true;
    for (const t of BK_TABELLEN) {
      const r = await alles(t);
      if (r.error) stop(`productie: ${t} lezen mislukt (${r.error.message})`);
      res.tabellen[t] = r.data;
    }
  } else if (!["PGRST205", "42P01"].includes(probe.error.code)) stop(`productie: bk_instellingen lezen mislukt (${probe.error.message})`);
  const tm = await sb.from("team_members").select("user_id, rol").eq("rol", "eigenaar").limit(1);
  res.eigenaar = tm.error ? null : tm.data?.[0]?.user_id ?? null;
  return res;
}

// =============================================================================== plan + schrijven
class Conflict extends Error {}
const ok = (r, wat) => {
  if (r.error) throw new Error(`${wat}: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  return r.data;
};

/** Alles wat de app ook laadt, via de echte SupabaseRepo (live-modus). */
async function laad(sb, eigenaar) {
  const repo = new K.repo.SupabaseRepo(sb, eigenaar ?? "00000000-0000-4000-8000-000000000000");
  const data = await K.types.laadAlles(repo);
  return { repo, data, posten: K.types.journaalVan(data) };
}

const VELD_DOOR = (eigenaar) => (eigenaar ? { created_by: eigenaar, updated_by: eigenaar } : {});

/**
 * Voert de import uit op een supabase-achtige cliënt (PGlite of productie). `tx` regelt de
 * batch (PGlite: begin/commit; productie: geen). Geeft per onderdeel nieuw/aanwezig terug.
 */
async function importeer(sb, { eigenaar, tx, label }) {
  const stats = [];
  const tel = (onderdeel, nieuw, aanwezig, detail = "") => stats.push({ onderdeel, nieuw, aanwezig, detail });
  const door = VELD_DOOR(eigenaar);

  // -------------------------------------------------------------- batch 2024 (inrichting + 2024)
  await tx("2024", async () => {
    let { data } = await laad(sb, eigenaar);
    const stam = data.stam;

    // Instellingen
    const inst = M.instellingen;
    const wijz = {};
    if (stam.instellingen.startdatum !== inst.startdatum) {
      if (stam.instellingen.startdatum && stam.instellingen.startdatum !== inst.startdatum) throw new Conflict(`startdatum staat al op ${stam.instellingen.startdatum} (mapping: ${inst.startdatum})`);
      wijz.startdatum = inst.startdatum;
    }
    for (const [veld, kolom] of [["kvk", "kvk"], ["btw_nummer", "btw_nummer"]]) {
      const huidig = veld === "kvk" ? stam.instellingen.kvk : stam.instellingen.btwNummer;
      if (inst[veld] && huidig !== inst[veld]) {
        if (huidig) throw new Conflict(`${veld} staat al op ${huidig}`);
        wijz[kolom] = inst[veld];
      }
    }
    if (inst.bedrijfsnaam && stam.instellingen.bedrijfsnaam !== inst.bedrijfsnaam) wijz.bedrijfsnaam = inst.bedrijfsnaam;
    if (inst.rechtsvorm && stam.instellingen.rechtsvorm !== inst.rechtsvorm) wijz.rechtsvorm = inst.rechtsvorm;
    if (Object.keys(wijz).length) ok(await sb.from("bk_instellingen").update({ ...wijz, ...(eigenaar ? { updated_by: eigenaar } : {}) }).eq("id", 1).select("id"), "instellingen");
    tel("instellingen", Object.keys(wijz).length ? 1 : 0, Object.keys(wijz).length ? 0 : 1, Object.keys(wijz).join(", "));

    // Grootboek: eigen rekeningen
    let n = 0;
    for (const g of M.grootboek_nieuw) {
      const er = stam.grootboek.find((x) => x.code === g.code);
      if (er) {
        if (er.soort !== g.soort) throw new Conflict(`grootboek ${g.code} bestaat al als ${er.naam} (${er.soort})`);
        continue;
      }
      ok(await sb.from("bk_grootboek").insert({ code: g.code, naam: g.naam, soort: g.soort, rubriek: g.rubriek, rgs_code: g.rgs, btw_standaard: g.btw, hint: g.hint ?? null, systeem: false, actief: true, volgorde: Number(g.code), ...door }).select("code"), `grootboek ${g.code}`);
      n++;
    }
    tel("grootboek (eigen rekeningen)", n, M.grootboek_nieuw.length - n);

    // Bankrekeningen (+ beginsaldo)
    n = 0;
    let bijgewerkt = 0;
    for (const r of M.rekeningen) {
      const er = stam.rekeningen.find((x) => x.grootboek === r.grootboek || x.naam.toLowerCase() === r.naam.toLowerCase());
      if (er) {
        if (er.grootboek !== r.grootboek || er.naam.toLowerCase() !== r.naam.toLowerCase()) throw new Conflict(`rekening ${r.naam}/${r.grootboek} botst met ${er.naam}/${er.grootboek}`);
        if (r.standaard && !er.standaard) throw new Conflict(`${r.naam} is niet de standaardrekening`);
        if (er.beginsaldo !== r.beginsaldo_centen || er.begindatum !== r.beginsaldo_datum) {
          if (er.begindatum && (er.begindatum !== r.beginsaldo_datum || er.beginsaldo !== r.beginsaldo_centen)) throw new Conflict(`${r.naam}: beginsaldo staat al op ${euro(er.beginsaldo)} per ${er.begindatum}`);
          ok(await sb.from("bk_rekeningen").update({ beginsaldo_centen: r.beginsaldo_centen, beginsaldo_datum: r.beginsaldo_datum, ...(eigenaar ? { updated_by: eigenaar } : {}) }).eq("id", er.id).select("id"), `rekening ${r.naam}`);
          bijgewerkt++;
        }
        continue;
      }
      // Zoals bk_rekening_toevoegen: de eerste vrije 11x0-code.
      const vrij = Array.from({ length: 10 }, (_, i) => String(1100 + 10 * i)).find((c) => !stam.grootboek.some((g) => g.code === c));
      if (vrij !== r.grootboek) throw new Conflict(`nieuwe rekening ${r.naam}: eerste vrije grootboekcode is ${vrij}, mapping verwacht ${r.grootboek}`);
      ok(await sb.from("bk_grootboek").insert({ code: vrij, naam: `Bank ${r.naam}`.slice(0, 120), soort: "activa", rubriek: "liquide_middelen", rgs_code: "BLim", systeem: false, volgorde: Number(vrij), ...door }).select("code"), `grootboek ${vrij}`);
      const volgorde = Math.max(0, ...stam.rekeningen.map((x) => x.volgorde)) + 1;
      ok(await sb.from("bk_rekeningen").insert({ naam: r.naam, grootboek_code: vrij, import_formaat: r.import_formaat, beginsaldo_centen: r.beginsaldo_centen, beginsaldo_datum: r.beginsaldo_datum, volgorde, ...door }).select("id"), `rekening ${r.naam}`);
      n++;
    }
    tel("bankrekeningen", n, M.rekeningen.length - n, bijgewerkt ? `${bijgewerkt} beginsaldo ingesteld` : "");

    // Vennoten (alleen controleren; de seed van 0027 maakt ze aan)
    ({ data } = await laad(sb, eigenaar));
    for (const v of M.vennoten) {
      const er = data.stam.vennoten.find((x) => x.naam === v.naam);
      if (!er) throw new Conflict(`vennoot ${v.naam} ontbreekt`);
      if (er.grootboekKapitaal !== v.kapitaal || er.grootboekPrive !== v.prive || er.aandeel !== v.winstaandeel) throw new Conflict(`vennoot ${v.naam}: ${er.grootboekKapitaal}/${er.grootboekPrive}/${er.aandeel}% wijkt af van de mapping`);
    }
    tel("vennoten (controle)", 0, M.vennoten.length);

    // Activa
    n = 0;
    for (const a of M.activa) {
      const er = data.activa.find((x) => x.omschrijving === a.omschrijving && x.aanschafdatum === a.aanschafdatum);
      const invoer = { omschrijving: a.omschrijving, categorie: a.categorie, aanschafdatum: a.aanschafdatum, ingebruikname: a.ingebruikname, aanschaf: a.aanschaf_centen, restwaarde: a.restwaarde_centen, looptijdMaanden: a.looptijd_maanden, notities: a.notities ?? null };
      if (er) {
        if (er.aanschaf !== a.aanschaf_centen || er.looptijdMaanden !== a.looptijd_maanden || er.ingebruikname !== a.ingebruikname || er.categorie !== a.categorie || er.restwaarde !== a.restwaarde_centen) throw new Conflict(`activum ${a.omschrijving} bestaat al met andere waarden`);
        continue;
      }
      const p = K.afschrijving.parseActivumInvoer(invoer, { vandaag: VANDAAG });
      if (!p.ok) throw new Error(`activum ${a.omschrijving}: ${p.fout}`);
      const w = p.waarde;
      ok(
        await sb.from("bk_activa").insert({ omschrijving: w.omschrijving, categorie_grootboek: w.categorie, aanschafdatum: w.aanschafdatum, ingebruikname: w.ingebruikname, aanschaf_centen: w.aanschaf, restwaarde_centen: w.restwaarde, looptijd_maanden: w.looptijdMaanden, uitgave_id: null, boeking_id: null, notities: w.notities, ...door }).select("id"),
        `activum ${a.omschrijving}`,
      );
      n++;
    }
    tel("activa", n, M.activa.length - n);

    // Memoriaal 2024
    await memoriaalPosten(sb, eigenaar, (m) => m.datum.startsWith("2024"), tel, "memoriaal 2024");

    // Btw-aangifte(n) 2024
    await aangiften(sb, eigenaar, 2024, tel);

    // Jaarafsluiting 2024
    await jaarafsluiting(sb, eigenaar, 2024, tel);
  });

  // -------------------------------------------------------------- batch 2025
  await tx("2025", async () => {
    let { data } = await laad(sb, eigenaar);
    const stam = data.stam;
    const rek = new Map(stam.rekeningen.map((r) => [r.naam.toLowerCase(), r]));
    const ven = new Map(stam.vennoten.map((v) => [v.naam, v]));
    // Bestaande sleutels per rekening (ook van verwijderde regels: nooit opnieuw).
    const bestaand = new Map();
    for (const r of stam.rekeningen) {
      const d = ok(await sb.from("bk_boekingen").select("import_sleutel, datum, bedrag_centen, soort, richting, btw_code, btw_centen, grootboek_code").eq("rekening_id", r.id).not("import_sleutel", "is", null).limit(50000), "sleutels");
      for (const x of d) bestaand.set(`${r.id}|${x.import_sleutel}`, x);
    }
    const nieuw = [];
    let aanwezig = 0;
    for (const b of M.boekingen) {
      const r = rek.get(b.rekening.toLowerCase());
      if (!r) throw new Conflict(`rekening ${b.rekening} ontbreekt (${b.import_sleutel})`);
      const body = {
        rekeningId: r.id,
        datum: b.datum,
        omschrijving: b.omschrijving,
        tegenpartij: b.tegenpartij ?? null,
        soort: b.soort,
        richting: b.richting,
        bedragCenten: b.bedrag_centen,
        isExcl: b.bedrag_is_excl === true,
        btwCode: b.btw_code,
        btwHandmatig: b.btw_handmatig ? b.btw_centen : null,
        grootboek: b.grootboek,
        vennootId: b.vennoot ? ven.get(b.vennoot)?.id ?? "?" : null,
        status: b.status ?? "geboekt",
        notities: b.notities ?? null,
      };
      const p = K.model.parseBoekingInvoer(body, stam, { vandaag: VANDAAG });
      if (!p.ok) throw new Error(`${b.import_sleutel}: ${p.fout} (${p.veld})`);
      const w = p.waarde;
      const er = bestaand.get(`${r.id}|${b.import_sleutel}`);
      if (er) {
        const zelfde = er.datum === w.datum && Number(er.bedrag_centen) === w.bedrag && er.soort === w.soort && er.richting === w.richting && er.btw_code === w.btwCode && Number(er.btw_centen) === w.btw && (er.grootboek_code ?? null) === (w.grootboek ?? null);
        if (!zelfde) throw new Conflict(`${b.import_sleutel} staat al in de database met andere waarden`);
        aanwezig++;
        continue;
      }
      const slot = K.periode.vergrendeldReden(w.datum, stam.vergrendeling);
      if (slot) throw new Conflict(`${b.import_sleutel}: ${slot}`);
      nieuw.push({
        rekening_id: w.rekeningId,
        datum: w.datum,
        omschrijving: w.omschrijving,
        tegenpartij: w.tegenpartij,
        soort: w.soort,
        richting: w.richting,
        bedrag_centen: w.bedrag,
        bedrag_is_excl: w.isExcl,
        btw_code: w.btwCode,
        btw_centen: w.btw,
        btw_handmatig: w.btwHandmatig,
        grootboek_code: w.grootboek,
        vennoot_id: w.vennootId,
        status: w.status,
        kenmerk: b.kenmerk ?? null,
        notities: w.notities,
        import_sleutel: b.import_sleutel,
        ...door,
      });
    }
    if (nieuw.length) ok(await sb.from("bk_boekingen").insert(nieuw).select("id"), "bankregels");
    tel("bankregels (2025, incl. btw-betaling Q4 op 29-01-2026)", nieuw.length, aanwezig);

    await memoriaalPosten(sb, eigenaar, (m) => m.datum.startsWith("2025"), tel, "memoriaal 2025");
    await aangiften(sb, eigenaar, 2025, tel);
    await koppelingen(sb, eigenaar, tel);
    ({ data } = await laad(sb, eigenaar));
    if (M.jaarafsluiting?.["2025"]?.afsluiten) await jaarafsluiting(sb, eigenaar, 2025, tel);
    else tel("jaarafsluiting 2025", 0, 0, "niet afgesloten (zie mapping: eigenaar sluit zelf af in de app)");
  });

  if (!STIL) {
    log(`\n${label}: wat er is (of zou worden) geschreven`);
    for (const s of stats) log(`  ${s.onderdeel.padEnd(58)} nieuw ${String(s.nieuw).padStart(3)}   al aanwezig ${String(s.aanwezig).padStart(3)}${s.detail ? `   (${s.detail})` : ""}`);
  }
  return stats;
}

async function memoriaalPosten(sb, eigenaar, filter, tel, label) {
  const { data } = await laad(sb, eigenaar);
  const ven = new Map(data.stam.vennoten.map((v) => [v.naam, v.id]));
  let n = 0;
  const lijst = M.memoriaal.filter(filter);
  for (const m of lijst) {
    const regels = m.regels.map((r) => ({ grootboek: r.grootboek, debet: r.debet, credit: r.credit, vennootId: r.vennoot ? ven.get(r.vennoot) : null, omschrijving: r.omschrijving ?? null }));
    const er = data.memoriaal.find((x) => x.datum === m.datum && x.soort === m.soort && x.omschrijving === m.omschrijving);
    if (er) {
      const sleutel = (rs) => rs.map((r) => `${r.grootboek}:${r.debet}:${r.credit}:${r.vennootId ?? ""}`).sort().join("|");
      if (sleutel(er.regels) !== sleutel(regels)) throw new Conflict(`memoriaal "${m.omschrijving}" bestaat al met andere regels`);
      continue;
    }
    const p = K.memoriaal.parseMemoriaalInvoer({ datum: m.datum, omschrijving: m.omschrijving, soort: m.soort, regels }, data.stam, { vandaag: VANDAAG });
    if (!p.ok) throw new Error(`memoriaal "${m.omschrijving}": ${p.fout}`);
    const w = p.waarde;
    const kop = ok(await sb.from("bk_memoriaal").insert({ datum: w.datum, omschrijving: w.omschrijving, soort: w.soort, ...VELD_DOOR(eigenaar) }).select("id").single(), "memoriaal");
    ok(
      await sb.from("bk_memoriaal_regels").insert(w.regels.map((r) => ({ memoriaal_id: kop.id, grootboek_code: r.grootboek, debet_centen: r.debet, credit_centen: r.credit, vennoot_id: r.vennootId ?? null, omschrijving: r.omschrijving ?? null }))),
      "memoriaalregels",
    );
    n++;
  }
  tel(label, n, lijst.length - n);
}

/** Ingediende aangiften zoals indienenActie: herberekening uit het journaal als snapshot. */
async function aangiften(sb, eigenaar, jaar, tel) {
  let n = 0;
  const lijst = M.aangiften.filter((a) => a.jaar === jaar).sort((a, b) => a.kwartaal - b.kwartaal);
  const afwijkend = [];
  for (const a of lijst) {
    const { data, posten } = await laad(sb, eigenaar);
    const { tot } = K.periode.kwartaalGrenzen(a.jaar, a.kwartaal);
    if (VANDAAG <= tot) throw new Error(`Q${a.kwartaal} ${a.jaar} loopt nog`);
    const ber = K.aangifte.aangifteRubrieken(posten, a.jaar, a.kwartaal);
    const snap = K.aangifte.naarSnapshot(ber);
    let teBetalen = K.aangifte.teBetalenCenten(ber);
    if (a.te_betalen_centen !== teBetalen) {
      // Ingediend volgens de werkelijke betaling: het verschil zit in 5b (zie de mapping).
      const saldoEuro = a.te_betalen_centen / 100;
      if (!Number.isInteger(saldoEuro)) throw new Error(`aangifte ${a.jaar}-Q${a.kwartaal}: te betalen moet in hele euro's`);
      snap.saldo.euro = saldoEuro;
      snap.voorbelasting.euro = snap.verschuldigd.euro - saldoEuro;
      afwijkend.push(`Q${a.kwartaal}: berekend ${euro(teBetalen)}, ingediend ${euro(a.te_betalen_centen)} (5b ${snap.voorbelasting.euro})`);
      teBetalen = a.te_betalen_centen;
    }
    const er = data.aangiften.find((x) => x.jaar === a.jaar && x.kwartaal === a.kwartaal);
    if (er) {
      if (er.teBetalen !== teBetalen) throw new Conflict(`aangifte ${a.jaar}-Q${a.kwartaal} is al ingediend met ${euro(er.teBetalen)} (mapping ${euro(teBetalen)})`);
      continue;
    }
    if (data.stam.vergrendeling.boekjaren.includes(a.jaar)) throw new Conflict(`boekjaar ${a.jaar} is al afgesloten`);
    const betaling = M.boekingen.find((b) => b.koppeling?.bron === "aangifte" && b.koppeling.aangifte === `${a.jaar}-${a.kwartaal}`);
    const ingediendOp = `${betaling ? betaling.datum : K.periode.aangifteDeadline(a.jaar, a.kwartaal)}T12:00:00Z`;
    ok(
      await sb
        .from("bk_aangiften")
        .insert({ jaar: a.jaar, kwartaal: a.kwartaal, rubrieken: snap, te_betalen_centen: teBetalen, ingediend_op: ingediendOp, kenmerk: null, opmerking: `Overgenomen uit de Excel-boekhouding ${a.jaar}. ${a.opmerking ?? ""}`.trim().slice(0, 2000), ...(eigenaar ? { ingediend_door: eigenaar, ...VELD_DOOR(eigenaar) } : {}) })
        .select("id"),
      `aangifte ${a.jaar}-Q${a.kwartaal}`,
    );
    n++;
  }
  tel(`btw-aangiften ${jaar} (ingediend)`, n, lijst.length - n, afwijkend.join("; "));
}

/** Btw-betalingen aan hun aangifte, zoals aangifteBetalingActie; plus eventuele factuur/bonnetje-koppelingen. */
async function koppelingen(sb, eigenaar, tel) {
  const { data } = await laad(sb, eigenaar);
  const sleutels = new Map();
  for (const r of data.stam.rekeningen) {
    const d = ok(await sb.from("bk_boekingen").select("id, import_sleutel").eq("rekening_id", r.id).not("import_sleutel", "is", null).limit(50000), "sleutels");
    for (const x of d) sleutels.set(x.import_sleutel, x.id);
  }
  let n = 0;
  let aanwezig = 0;
  const lijst = M.boekingen.filter((b) => b.koppeling);
  for (const b of lijst) {
    const id = sleutels.get(b.import_sleutel);
    const boeking = data.boekingen.find((x) => x.id === id);
    if (!boeking) throw new Error(`${b.import_sleutel}: bankregel niet gevonden`);
    if (b.koppeling.bron === "aangifte") {
      const [j, kw] = b.koppeling.aangifte.split("-").map(Number);
      const a = data.aangiften.find((x) => x.jaar === j && x.kwartaal === kw);
      if (!a) throw new Error(`${b.import_sleutel}: aangifte ${b.koppeling.aangifte} ontbreekt`);
      if (data.aangifteBetalingen.some((x) => x.boekingId === boeking.id && x.aangifteId === a.id)) {
        aanwezig++;
        continue;
      }
      const alGekoppeld = data.aangifteBetalingen.filter((x) => x.boekingId === boeking.id).reduce((t, x) => t + Math.abs(x.bedrag), 0);
      const betaald = data.aangifteBetalingen.filter((x) => x.aangifteId === a.id).reduce((t, x) => t + x.bedrag, 0);
      const teken = a.teBetalen < 0 ? -1 : 1;
      const bedrag = b.koppeling.bedrag_centen ?? teken * Math.min(boeking.bedrag - alGekoppeld, Math.max(0, Math.abs(a.teBetalen) - Math.abs(betaald)));
      const f = K.aangifte.betalingFout({ soort: boeking.soort, richting: boeking.richting, bankBedrag: boeking.bedrag, alGekoppeld, aangifte: a, bedrag });
      if (f) throw new Error(`${b.import_sleutel}: ${f}`);
      ok(await sb.from("bk_koppelingen").insert({ boeking_id: boeking.id, bron: "aangifte", bron_id: a.id, bedrag_centen: bedrag, ...(eigenaar ? { created_by: eigenaar } : {}) }).select("id"), "koppeling");
      n++;
    } else if (b.koppeling.bron === "factuur" || b.koppeling.bron === "uitgave") {
      const doc = b.koppeling.bron === "factuur" ? data.facturen.find((f) => f.id === b.koppeling.id || f.nummer === b.koppeling.factuurnummer) : data.uitgaven.find((u) => u.id === b.koppeling.id);
      if (!doc) throw new Error(`${b.import_sleutel}: ${b.koppeling.bron} niet gevonden`);
      if (data.koppelingen.some((k) => k.boekingId === boeking.id && k.bronId === doc.id)) {
        aanwezig++;
        continue;
      }
      ok(await sb.from("bk_koppelingen").insert({ boeking_id: boeking.id, bron: b.koppeling.bron, bron_id: doc.id, bedrag_centen: b.koppeling.bedrag_centen ?? boeking.bedrag, ...(eigenaar ? { created_by: eigenaar } : {}) }).select("id"), "koppeling");
      n++;
    } else throw new Error(`${b.import_sleutel}: onbekende koppeling ${b.koppeling.bron}`);
  }
  tel("koppelingen (btw-betaling ↔ aangifte)", n, aanwezig);
}

/** Jaarafsluiting zoals jaarAfsluitenActie (checklist + voorstel + samenvatting), als systeemrol. */
async function jaarafsluiting(sb, eigenaar, jaar, tel) {
  const instel = M.jaarafsluiting?.[String(jaar)];
  if (!instel?.afsluiten) return;
  const { data, posten } = await laad(sb, eigenaar);
  const banksaldi = {};
  for (const r of data.stam.rekeningen) banksaldi[r.id] = instel.banksaldi_31_12?.[r.naam] ?? null;
  const st = K.jaarwerk.afsluitStatus(data, posten, jaar, VANDAAG, banksaldi);
  if (st.afgesloten) {
    const bj = data.boekjaren.find((b) => b.jaar === jaar);
    const mem = data.memoriaal.find((m) => m.id === bj?.memoriaalId);
    const voorstel = K.rapporten.jaarafsluitingVoorstel(posten.filter((p) => !(K.rapporten.isAfsluiting(p) && p.datum.startsWith(String(jaar)))), data.stam, jaar);
    const sleutel = (rs) => rs.map((r) => `${r.grootboek}:${r.debet}:${r.credit}`).sort().join("|");
    if (mem && sleutel(mem.regels) !== sleutel(voorstel.regels)) throw new Conflict(`boekjaar ${jaar} is al afgesloten met een andere afsluitpost (heropen het eerst in de app)`);
    tel(`jaarafsluiting ${jaar}`, 0, 1);
    return;
  }
  if (st.fout || !st.voorstel) throw new Error(`jaarafsluiting ${jaar}: ${st.fout ?? "geen voorstel"}`);
  const open = st.controles.filter((c) => c.blokkeert && !c.ok);
  if (open.length) throw new Error(`jaarafsluiting ${jaar}: checklist niet in orde: ${open.map((c) => `${c.titel} (${c.uitleg})`).join("; ")}`);
  const samenvatting = K.jaarwerk.jaarSamenvatting(data, posten, jaar, st.voorstel, st.banksaldi);
  const kop = ok(await sb.from("bk_memoriaal").insert({ datum: `${jaar}-12-31`, omschrijving: `Jaarafsluiting ${jaar}: resultaat en privé naar kapitaal`, soort: "jaarafsluiting", ...VELD_DOOR(eigenaar) }).select("id").single(), "afsluitpost");
  ok(
    await sb.from("bk_memoriaal_regels").insert(st.voorstel.regels.map((r) => ({ memoriaal_id: kop.id, grootboek_code: r.grootboek, debet_centen: r.debet, credit_centen: r.credit, vennoot_id: r.vennootId ?? null, omschrijving: r.omschrijving ?? null }))),
    "afsluitregels",
  );
  ok(await sb.from("bk_boekjaren").insert({ jaar, memoriaal_id: kop.id, samenvatting, ...(eigenaar ? { afgesloten_door: eigenaar, ...VELD_DOOR(eigenaar) } : {}) }).select("jaar"), "boekjaar");
  tel(`jaarafsluiting ${jaar}`, 1, 0, `resultaat ${euro(st.voorstel.resultaat)} → ${st.voorstel.verdeling.map((v) => `${v.naam} ${euro(v.bedrag)}`).join(", ")}`);
}

// =============================================================================== controle
/**
 * Rekent met de kern van het systeem (zoals de schermen) de jaarcijfers uit en vergelijkt elk
 * getal met de Excel. Status: gelijk | verklaard (verschil exact gelijk aan een bekende,
 * benoemde oorzaak) | AFWIJKING.
 */
async function controle(sb, eigenaar) {
  const { data, posten } = await laad(sb, eigenaar);
  const R = K.rapporten;
  const gb = data.stam.grootboek;
  const rijen = [];
  const per = new Map();
  const vergelijk = (id, onderdeel, post, excel, systeem, bereken = null) => {
    const verschil = excel === null || excel === undefined ? null : systeem - excel;
    let status = verschil === 0 ? "gelijk" : "AFWIJKING";
    let verklaring = "";
    if (verschil !== 0 && verschil !== null) {
      const b = bereken?.(verschil);
      const v = VERKL[id];
      if (b) {
        status = "verklaard";
        verklaring = b;
      } else if (v && v.verschil === verschil) {
        status = "verklaard";
        verklaring = v.verklaring;
      } else if (v && Array.isArray(v.som)) {
        const s = v.som.reduce((t, k) => t + (per.get(k)?.verschil ?? NaN), 0);
        if (s === verschil && v.som.every((k) => ["gelijk", "verklaard"].includes(per.get(k)?.status))) {
          status = "verklaard";
          verklaring = `${v.verklaring} (som van: ${v.som.join(", ")})`;
        }
      }
      if (status === "AFWIJKING" && v) verklaring = `verwacht verschil ${v.verschil ?? "som"} klopt niet: ${v.verklaring}`;
    }
    if (excel === null || excel === undefined) status = "alleen systeem";
    const r = { id, onderdeel, post, excel, systeem, verschil, status, verklaring };
    rijen.push(r);
    per.set(id, r);
  };

  const saldo = (datum) => R.mutaties(posten, null, datum);
  const s = (m, ...codes) => codes.reduce((t, c) => t + (m.get(c) ?? 0), 0);
  const wv = (j) => R.winstEnVerlies(posten, gb, j);
  const wvRegel = (w, code) => w.groepen.flatMap((g) => g.regels).find((r) => r.code === code)?.jaar ?? 0;
  const groep = (w, id) => w.groepen.find((g) => g.id === id)?.jaar ?? 0;
  const rekVan = (naam) => data.stam.rekeningen.find((r) => r.naam.toLowerCase() === naam.toLowerCase());
  const act = (deel) => data.activa.find((a) => a.omschrijving.toLowerCase().includes(deel));
  const daniel = act("daniël") ?? act("daniel");
  const bram = act("bram");
  const vennoot = (k, naam) => k.regels.find((r) => r.naam === naam);
  // Voorbelasting per kostenrekening in een jaar (uit het journaal; Excel toont kosten incl. btw).
  const voorbelastingOp = (jaar, codes) => {
    let t = 0;
    for (const p of posten) {
      if (p.bron !== "boeking" || !p.datum.startsWith(String(jaar))) continue;
      if (!p.regels.some((r) => codes.includes(r.grootboek))) continue;
      t += p.regels.filter((r) => r.grootboek === "1520").reduce((x, r) => x + r.debet - r.credit, 0);
    }
    return t;
  };

  // ------------------------------------------------------------------ 2024
  const w24 = wv(2024);
  const n24 = X24.normalized;
  const k24 = n24.winstEnVerlies.kosten;
  const x24 = (post) => cent(k24.find((k) => k.post === post)?.eur);
  vergelijk("w24.omzet", "W&V 2024", "Omzet / opbrengsten", cent(n24.winstEnVerlies.totaalOmzetEur), groep(w24, "omzet") + groep(w24, "overige_opbrengsten"));
  vergelijk("w24.alg", "W&V 2024", "Algemene kosten (4990)", x24("Alg kst"), wvRegel(w24, "4990"));
  vergelijk("w24.project", "W&V 2024", "Projectkosten (4610)", x24("Project kst"), wvRegel(w24, "4610"));
  vergelijk("w24.website", "W&V 2024", "Website (4050)", x24("Website"), wvRegel(w24, "4050"));
  vergelijk("w24.afschrijving", "W&V 2024", "Afschrijving (4800)", x24("Afschrijving"), wvRegel(w24, "4800"));
  vergelijk("w24.rente", "W&V 2024", "Rente kapitaal (4950)", x24("Rente kapitaal"), wvRegel(w24, "4950"));
  vergelijk("w24.kosten", "W&V 2024", "Totaal kosten", cent(n24.winstEnVerlies.totaalKostenEur), groep(w24, "kosten") + groep(w24, "afschrijvingen"));
  vergelijk("w24.resultaat", "W&V 2024", "Resultaat", n24.winstEnVerlies.resultaatCent, w24.resultaat.jaar);

  const b24 = R.balans(posten, gb, "2024-12-31");
  const s24 = saldo("2024-12-31");
  const bb24 = n24.balans31122024;
  vergelijk("b24.inventaris", "Balans 31-12-2024", "Inventaris (0200 − 0209)", cent(bb24.activa.inventarisBoekwaardeEur), s(s24, "0200", "0209"));
  vergelijk("b24.liquide", "Balans 31-12-2024", "Liquide middelen", cent(bb24.activa.liquideMiddelenEur), b24.activa.find((g) => g.id === "liquide_middelen")?.totaal ?? 0);
  vergelijk("b24.vorderingen", "Balans 31-12-2024", "Vorderingen (debiteuren, btw)", 0, b24.activa.find((g) => g.id === "vorderingen")?.totaal ?? 0);
  vergelijk("b24.kap.daniel", "Balans 31-12-2024", "Kapitaal Daniel (0500 + 0600)", cent(bb24.passiva.eigenVermogen.Daniel.kapitaalEindEur), -s(s24, "0500", "0600"));
  vergelijk("b24.kap.bram", "Balans 31-12-2024", "Kapitaal Bram (0510 + 0610)", cent(bb24.passiva.eigenVermogen.Bram.kapitaalEindEur), -s(s24, "0510", "0610"));
  vergelijk("b24.schulden", "Balans 31-12-2024", "Kortlopende schulden (incl. btw)", 0, b24.passiva.find((g) => g.id === "schulden")?.totaal ?? 0);
  vergelijk("b24.activa", "Balans 31-12-2024", "Totaal activa", cent(bb24.activa.totaalEur), b24.totaalActiva);
  vergelijk("b24.passiva", "Balans 31-12-2024", "Totaal passiva", cent(bb24.passiva.totaalEur), b24.totaalPassiva);
  vergelijk("b24.sluit", "Balans 31-12-2024", "Activa − passiva (sluit)", cent(bb24.verschilActivaPassivaEur), b24.verschil);

  const ag = (j, kw) => data.aangiften.find((a) => a.jaar === j && a.kwartaal === kw);
  const a244 = ag(2024, 4);
  vergelijk("btw24.q4", "Btw Q4 2024", "Te betalen (ingediend)", 0, a244 ? a244.teBetalen : NaN);
  vergelijk("btw24.q4.berekend", "Btw Q4 2024", "Saldo herberekend (centen)", 0, K.aangifte.aangifteRubrieken(posten, 2024, 4).saldo.centen);

  const st24 = K.afschrijving.activastaat(data.activa, 2024);
  const st25 = K.afschrijving.activastaat(data.activa, 2025);
  const regelVan = (st, a) => st.regels.find((r) => r.activum.id === a?.id);
  const xa = X25.genormaliseerd.b_activa_afschrijvingen.activa.filter((a) => a.zakelijk);
  const xd = xa.find((a) => /dani/i.test(a.omschrijving));
  const xb = xa.find((a) => /bram/i.test(a.omschrijving));
  const xa24 = n24.activa.filter((a) => a.fase?.startsWith("zakelijk"));
  for (const [naam, sys, x, x24a] of [["Daniel", daniel, xd, xa24.find((a) => /dani/i.test(a.omschrijving))], ["Bram", bram, xb, xa24.find((a) => /bram/i.test(a.omschrijving))]]) {
    const r24 = regelVan(st24, sys);
    vergelijk(`a24.${naam}`, "Afschrijving 2024", `MacBook ${naam} (activastaat 2025, t/m 2024)`, cent(x?.afschrijving_tm_2024), r24?.afschrijving ?? NaN);
    vergelijk(`a24.${naam}.jr2024`, "Afschrijving 2024", `MacBook ${naam} (jaarrekening 2024, op inbrengwaarde)`, x24a?.afschrijving2024Cent ?? null, r24?.afschrijving ?? NaN);
    vergelijk(`a24.${naam}.bw`, "Afschrijving 2024", `MacBook ${naam} boekwaarde 31-12-2024`, cent(x?.boekwaarde_begin_2025), r24?.eind ?? NaN);
  }

  const kv24 = R.kapitaalVergelijking(posten, data.stam, 2024);
  const ev24 = bb24.passiva.eigenVermogen;
  for (const naam of ["Daniel", "Bram"]) {
    const r = vennoot(kv24, naam);
    const x = ev24[naam];
    vergelijk(`k24.${naam}.inbreng`, "Vennoten 2024", `${naam}: inbreng MacBook + rente kapitaal`, cent(x.inbrengEur) + cent(x.renteKapitaalEur), r?.inbreng ?? NaN);
    vergelijk(`k24.${naam}.stortingen`, "Vennoten 2024", `${naam}: privé voorgeschoten kosten`, cent(x.mutatieKapitaalEur), r?.stortingen ?? NaN);
    vergelijk(`k24.${naam}.opnamen`, "Vennoten 2024", `${naam}: privé-opnamen`, 0, r?.opnamen ?? NaN);
    vergelijk(`k24.${naam}.winst`, "Vennoten 2024", `${naam}: aandeel resultaat`, cent(x.resultaataandeelEur), r?.winstaandeel ?? NaN);
    vergelijk(`k24.${naam}.eind`, "Vennoten 2024", `${naam}: kapitaal 31-12-2024`, cent(x.kapitaalEindEur), r?.eind ?? NaN);
    vergelijk(`k24.${naam}.grootboek`, "Vennoten 2024", `${naam}: kapitaal volgens grootboek = vergelijking`, r?.eind ?? NaN, r?.grootboek ?? NaN);
  }

  // ------------------------------------------------------------------ 2025
  const w25 = wv(2025);
  const g25 = X25.genormaliseerd;
  const xw = (post) => g25.d_winst_en_verlies.posten.find((p) => p.post.startsWith(post))?.bedrag;
  const vb25 = voorbelastingOp(2025, gb.filter((g) => g.soort === "kosten").map((g) => g.code));
  const opbrengst25 = groep(w25, "omzet") + groep(w25, "overige_opbrengsten");
  vergelijk("w25.netto_omzet", "W&V 2025", "Netto-omzet (Excel: omzet incl. − betaalde btw) ↔ opbrengsten excl. btw", cent(xw("Netto-omzet")), opbrengst25, (v) =>
    v === -vb25 ? `De Excel boekt kosten incl. btw en trekt alleen de betaalde btw van de omzet af; het systeem boekt excl. btw. Verschil = −voorbelasting 2025 (${euro(vb25)}).` : null,
  );
  const subs = [
    ["Project", "Kostprijs van de omzet (Project", ["4610"]],
    ["Algemeen", "Algemene kosten", ["4400", "4990"]],
    ["Abonnement", "Abonnement kosten", ["4000"]],
    ["Website", "Beheer kosten (Website)", ["4050"]],
    ["Bank", "Bank kosten", ["4900"]],
  ];
  for (const [sub, post, codes] of subs) {
    const sys = codes.reduce((t, c) => t + wvRegel(w25, c), 0);
    const vb = voorbelastingOp(2025, codes);
    vergelijk(`w25.${sub}`, "W&V 2025", `${post.replace(" (Project", " (Project kosten)")} (${codes.join("+")}), Excel incl. btw`, cent(xw(post)), sys, (v) => (v === -vb ? `Excel incl. btw, systeem excl. btw; verschil = voorbelasting op deze kosten (${euro(vb)}).` : null));
  }
  vergelijk("w25.afschrijving", "W&V 2025", "Afschrijving (W&V, ingetypt)", cent(xw("Afschrijving")), wvRegel(w25, "4800"));
  vergelijk("w25.afschrijving.staat", "W&V 2025", "Afschrijving (activastaat Excel, berekend)", cent(g25.b_activa_afschrijvingen.totalen.inventaris.boekjaar), wvRegel(w25, "4800"));
  vergelijk("w25.rente", "W&V 2025", "Rentelasten / rentevergoeding kapitaal (4950)", cent(xw("Rentelasten")), wvRegel(w25, "4950"));
  vergelijk("w25.resultaat", "W&V 2025", "Resultaat", cent(xw("Resultaat na belasting")), w25.resultaat.jaar);

  const b25 = R.balans(posten, gb, "2025-12-31");
  const s25 = saldo("2025-12-31");
  const xbal = g25.d_balans;
  const xpost = (lijst, deel) => lijst.find((p) => p.post.includes(deel))?.bedrag;
  vergelijk("b25.laptop.daniel", "Balans 31-12-2025", "Laptop Daniel (boekwaarde)", cent(xpost(xbal.activa, "Laptop Dani")), K.afschrijving.boekwaardeOp(daniel, "2025-12-31"));
  vergelijk("b25.laptop.bram", "Balans 31-12-2025", "Laptop Bram (boekwaarde)", cent(xpost(xbal.activa, "Laptop Bram")), K.afschrijving.boekwaardeOp(bram, "2025-12-31"));
  vergelijk("b25.inventaris", "Balans 31-12-2025", "Inventaris totaal (0200 − 0209)", cent(xpost(xbal.activa, "Laptop Dani") + xpost(xbal.activa, "Laptop Bram")), s(s25, "0200", "0209"));
  vergelijk("b25.debiteuren", "Balans 31-12-2025", "Debiteuren (1300)", cent(xpost(xbal.activa, "Debiteuren")), s(s25, "1300"));
  const bankCodes = data.stam.rekeningen.map((r) => r.grootboek);
  for (const [naam, xnaam] of [["RegioBank", "Regiobank"], ["Revolut", "Revolut"], ["PayPal", "Paypal"]]) {
    const r = rekVan(naam);
    vergelijk(`b25.bank.${naam}`, "Balans 31-12-2025", `Bank ${naam} (som van de regels in de Excel)`, cent(g25.f_saldi.bankmutaties_2025_uit_boekingen_t_m_31_12[xnaam]), r ? s(s25, r.grootboek) : NaN);
  }
  vergelijk("b25.bank", "Balans 31-12-2025", "Liquide middelen bank (Excel D14, ingetypt)", cent(xpost(xbal.activa, "Bank")), s(s25, ...bankCodes));
  vergelijk("b25.kruisposten", "Balans 31-12-2025", "Kruisposten (2000)", 0, s(s25, "2000"));
  const kv25 = R.kapitaalVergelijking(posten, data.stam, 2025);
  for (const naam of ["Daniel", "Bram"]) {
    const r = vennoot(kv25, naam);
    vergelijk(`b25.ev.${naam}`, "Balans 31-12-2025", `EV ${naam} vóór resultaat (kapitaal + privé)`, cent(xpost(xbal.passiva, naam === "Daniel" ? "EV Dani" : "EV Bram")), r ? r.begin + r.inbreng + r.stortingen - r.opnamen : NaN);
  }
  vergelijk("b25.resultaat", "Balans 31-12-2025", "Resultaat boekjaar", cent(xpost(xbal.passiva, "Resultaat boekjaar")), b25.passiva.flatMap((g) => g.regels).find((r) => r.naam === "Resultaat boekjaar")?.bedrag ?? 0);
  vergelijk("b25.btw", "Balans 31-12-2025", "Te betalen btw (per saldo)", cent(xpost(xbal.passiva, "btw")), -s(s25, "1500", "1505", "1510", "1520", "1530"));
  vergelijk("b25.activa", "Balans 31-12-2025", "Totaal activa", cent(xbal.totaal_activa), b25.totaalActiva);
  vergelijk("b25.passiva", "Balans 31-12-2025", "Totaal passiva", cent(xbal.totaal_passiva), b25.totaalPassiva);
  vergelijk("b25.sluit", "Balans 31-12-2025", "Activa − passiva (sluit)", cent(xbal.totaal_activa) - cent(xbal.totaal_passiva), b25.verschil);

  for (const x of g25.c_btw_per_kwartaal) {
    const kw = Number(x.kwartaal.slice(-1));
    const ber = K.aangifte.aangifteRubrieken(posten, 2025, kw);
    const a = ag(2025, kw);
    const o = `Btw Q${kw} 2025`;
    vergelijk(`btw25.q${kw}.1a.omzet`, o, "1a omzet (formulier, hele euro's)", x.rubriek_1a_omzet_excl_afgerond * 100, ber.rubrieken["1a"].grondslag.euro * 100, () =>
      Math.round(ber.rubrieken["1a"].grondslag.centen / 100) === x.rubriek_1a_omzet_excl_afgerond ? `Excel rondt ${euro(ber.rubrieken["1a"].grondslag.centen)} gewoon af; het formulier rondt omzet omlaag af (in je voordeel). Geen invloed op de te betalen btw.` : null,
    );
    vergelijk(`btw25.q${kw}.1a.btw`, o, "1a btw (som per regel, kolom H)", cent(x.som_kolom_H_af_te_dragen_eigen), ber.rubrieken["1a"].btw.centen);
    const vb1e = Math.round(x.omzet_niet_belast * 100);
    const geenBtw = posten
      .filter((p) => p.bron === "boeking" && p.btw && p.btw.rubriek === null && p.datum >= `2025-${String(kw * 3 - 2).padStart(2, "0")}-01` && p.datum <= K.periode.kwartaalGrenzen(2025, kw).tot)
      .filter((p) => p.regels.some((r) => gb.find((g) => g.code === r.grootboek)?.soort === "opbrengst"))
      .reduce((t, p) => t + p.btw.grondslag, 0);
    vergelijk(`btw25.q${kw}.1e`, o, "1e omzet 0% / niet belast (centen)", vb1e, ber.rubrieken["1e"].grondslag.centen, (v) =>
      v === -geenBtw ? `Creditrente en de PayPal-cent (${euro(geenBtw)}) staan in de Excel bij 0%-omzet; in het systeem op 8900 zonder btw (horen niet in de aangifte).` : null,
    );
    vergelijk(`btw25.q${kw}.5b`, o, "5b voorbelasting (centen)", cent(x.voorbelasting), ber.voorbelasting.centen);
    vergelijk(`btw25.q${kw}.saldo`, o, "Saldo berekend (centen, vóór afronding)", cent(x.af_te_dragen_berekend), ber.saldo.centen, (v) => {
      const d = cent(x.som_kolom_H_af_te_dragen_eigen) - cent(x.rubriek_1a_btw);
      return d !== 0 && v === d ? `De Excel rekent hier 21% over het kwartaaltotaal (${euro(cent(x.rubriek_1a_btw))}); kolom H en het systeem tellen de btw per regel op (${euro(cent(x.som_kolom_H_af_te_dragen_eigen))}).` : null;
    });
    vergelijk(`btw25.q${kw}.herberekend`, o, "Te betalen volgens herberekening (formulier)", cent(x.werkelijk_betaald), K.aangifte.teBetalenCenten(ber));
    vergelijk(`btw25.q${kw}.ingediend`, o, "Te betalen volgens ingediende aangifte", cent(x.werkelijk_betaald), a ? a.teBetalen : NaN);
    const betaald = data.aangifteBetalingen.filter((b) => b.aangifteId === a?.id).reduce((t, b) => t + b.bedrag, 0);
    vergelijk(`btw25.q${kw}.betaald`, o, "Betaald (gekoppelde bankregel)", cent(x.werkelijk_betaald), betaald);
    const afronding = a?.snapshot ? K.aangifte.afrondingsverschil(a.snapshot) : 0;
    vergelijk(`btw25.q${kw}.afronding`, o, "Afronding naar 8900 (ingediend − exact)", null, afronding);
  }
  vergelijk("btw25.totaal", "Btw 2025", "Totaal betaald 2025 (Excel: omzetbelasting)", cent(X25.totalen.omzetbelasting_betaald_aftrek), data.aangiften.filter((a) => a.jaar === 2025).reduce((t, a) => t + a.teBetalen, 0));

  for (const [naam, sys, x] of [["Daniel", daniel, xd], ["Bram", bram, xb]]) {
    const r = regelVan(st25, sys);
    vergelijk(`a25.${naam}`, "Afschrijving 2025", `MacBook ${naam}: afschrijving 2025`, cent(x?.afschrijving_2025), r?.afschrijving ?? NaN);
    vergelijk(`a25.${naam}.cum`, "Afschrijving 2025", `MacBook ${naam}: cumulatief t/m 2025`, cent(x?.cumulatief_tm_2025), r?.cumulatief ?? NaN);
    vergelijk(`a25.${naam}.bw`, "Afschrijving 2025", `MacBook ${naam}: boekwaarde 31-12-2025`, cent(x?.boekwaarde_eind_2025), r?.eind ?? NaN);
  }
  vergelijk("a25.totaal", "Afschrijving 2025", "Totaal inventaris 2025", cent(g25.b_activa_afschrijvingen.totalen.inventaris.boekjaar), st25.totaal.afschrijving);

  const wvx = g25.e_prive_en_winstverdeling.winstverdeling.per_vennoot;
  for (const naam of ["Daniel", "Bram"]) {
    const r = vennoot(kv25, naam);
    const x = wvx[naam];
    vergelijk(`k25.${naam}.begin`, "Vennoten 2025", `${naam}: kapitaal 1-1-2025`, cent(x.kapitaal_begin_2025_N), r?.begin ?? NaN);
    vergelijk(`k25.${naam}.rente`, "Vennoten 2025", `${naam}: rentevergoeding kapitaal (inbreng/correctie)`, cent(x.verschil_H_vs_eigen), r?.inbreng ?? NaN);
    vergelijk(`k25.${naam}.stortingen`, "Vennoten 2025", `${naam}: privé-stortingen`, cent(x["privé_stortingen_2025"]), r?.stortingen ?? NaN);
    vergelijk(`k25.${naam}.opnamen`, "Vennoten 2025", `${naam}: privé-opnamen`, cent(x["privé_opnamen_2025"]), r?.opnamen ?? NaN);
    vergelijk(`k25.${naam}.winst`, "Vennoten 2025", `${naam}: aandeel resultaat (50%)`, cent(x.aandeel_resultaat), r?.winstaandeel ?? NaN);
    vergelijk(`k25.${naam}.eind`, "Vennoten 2025", `${naam}: kapitaal 31-12-2025 na winstverdeling`, cent(x.kapitaal_eind_M), r?.eind ?? NaN);
  }

  // Alle regels van het tabblad Boekingen staan erin, met hetzelfde bedrag en dezelfde btw.
  const xregels = g25.a_boekingsregels.regels;
  const sleutels = new Map();
  for (const r of data.stam.rekeningen) {
    const d = ok(await sb.from("bk_boekingen").select("id, import_sleutel, datum, bedrag_centen, btw_centen, verwijderd_op").eq("rekening_id", r.id).not("import_sleutel", "is", null).limit(50000), "sleutels");
    for (const x of d) sleutels.set(x.import_sleutel, { ...x, rekening: r.naam });
  }
  let regelsGelijk = 0;
  const regelsAnders = [];
  for (const x of xregels) {
    const m = M.boekingen.find((b) => b.import_sleutel === `excel-2025:boekingen:${x.rij}`);
    const d = m ? sleutels.get(m.import_sleutel) : null;
    const fouten = [];
    if (!d || d.verwijderd_op) fouten.push("ontbreekt");
    else {
      if (Number(d.bedrag_centen) !== x.bedrag_incl_centen) fouten.push(`bedrag ${euro(Number(d.bedrag_centen))} ≠ ${euro(x.bedrag_incl_centen)}`);
      if (Number(d.btw_centen) !== (x.btw_bedrag_centen ?? 0)) fouten.push(`btw ${euro(Number(d.btw_centen))} ≠ ${euro(x.btw_bedrag_centen ?? 0)}`);
      if (d.rekening.toLowerCase() !== String(x.rekening).toLowerCase()) fouten.push(`rekening ${d.rekening} ≠ ${x.rekening}`);
      if (d.datum !== x.datum) fouten.push(`datum ${d.datum} ≠ ${x.datum}`);
    }
    if (fouten.length) regelsAnders.push({ rij: x.rij, fouten });
    else regelsGelijk++;
  }
  vergelijk("regels.aantal", "Boekingen 2025", "Aantal regels Excel ↔ bankregels met importsleutel", xregels.length, [...sleutels.keys()].filter((k) => k.startsWith("excel-2025:")).length);
  for (const r of regelsAnders) {
    const id = `regel.${r.rij}`;
    const v = VERKL[id];
    const tekst = r.fouten.join("; ");
    const verklaard = v && v.fouten === tekst;
    rijen.push({ id, onderdeel: "Boekingen 2025", post: `Rij ${r.rij}`, excel: null, systeem: null, verschil: null, status: verklaard ? "verklaard" : "AFWIJKING", verklaring: verklaard ? `${tekst}: ${v.verklaring}` : tekst });
  }
  rijen.push({ id: "regels.gelijk", onderdeel: "Boekingen 2025", post: `Regels met gelijk bedrag, btw, rekening en datum`, excel: xregels.length, systeem: regelsGelijk, verschil: null, status: "info", verklaring: "" });

  // Interne samenhang (moet altijd): journaal sluit, balans sluit op elk maandeinde.
  for (const p of posten) {
    const d = p.regels.reduce((t, r) => t + r.debet, 0);
    const c = p.regels.reduce((t, r) => t + r.credit, 0);
    if (d !== c) rijen.push({ id: `sluit.${p.id}`, onderdeel: "Samenhang", post: p.id, excel: 0, systeem: d - c, verschil: d - c, status: "AFWIJKING", verklaring: "journaalpost sluit niet" });
  }
  let maanden = 0;
  for (let j = 2024; j <= 2025; j++)
    for (let mnd = 1; mnd <= 12; mnd++) {
      const d = K.periode.maakDatum(j, mnd, K.periode.dagenInMaand(j, mnd));
      const b = R.balans(posten, gb, d);
      if (b.verschil !== 0) rijen.push({ id: `sluit.${d}`, onderdeel: "Samenhang", post: `balans ${d}`, excel: 0, systeem: b.verschil, verschil: b.verschil, status: "AFWIJKING", verklaring: "balans sluit niet" });
      maanden++;
    }
  rijen.push({ id: "samenhang", onderdeel: "Samenhang", post: `Journaal sluit (${posten.length} posten) en balans sluit op ${maanden} maandeinden`, excel: null, systeem: null, verschil: null, status: rijen.some((r) => r.onderdeel === "Samenhang" && r.status === "AFWIJKING") ? "AFWIJKING" : "gelijk", verklaring: "" });

  // Kwartalen 2026 (buiten de Excel): status ter informatie.
  const rapport = {
    rijen,
    kerncijfers: {
      resultaat2024: w24.resultaat.jaar,
      resultaat2025: w25.resultaat.jaar,
      balans2024: b24.totaalActiva,
      balans2025: b25.totaalActiva,
      banksaldi2025: Object.fromEntries(data.stam.rekeningen.map((r) => [r.naam, s(s25, r.grootboek)])),
      afschrijving2025: st25.totaal.afschrijving,
      aangiften: data.aangiften.map((a) => `${a.jaar}-Q${a.kwartaal}:${a.teBetalen}`).join(","),
      boekjaren: data.boekjaren.map((b) => b.jaar).join(","),
      aantalBoekingen: data.boekingen.length,
      aantalMemoriaal: data.memoriaal.length,
      aantalActiva: data.activa.length,
      facturen: data.facturen.length,
      uitgaven: data.uitgaven.length,
    },
    afsluiten2025: K.jaarwerk.afsluitStatus(data, posten, 2025, VANDAAG, {}).controles.map((c) => ({ titel: c.titel, ok: c.ok, blokkeert: c.blokkeert, uitleg: c.uitleg })),
  };
  return rapport;
}

/** Aantallen als getal, de rest als bedrag. */
const fmt = (r, v) => (r.id.startsWith("regels.") ? (v === null || v === undefined ? "—" : String(v)) : euro(v));

function toonControle(rapport, titel) {
  const tel = (st) => rapport.rijen.filter((r) => r.status === st).length;
  const afw = rapport.rijen.filter((r) => r.status === "AFWIJKING");
  log(`\n${titel}: ${tel("gelijk")} gelijk, ${tel("verklaard")} verklaard, ${afw.length} afwijking(en)`);
  if (!STIL) {
    let deel = "";
    for (const r of rapport.rijen) {
      if (r.onderdeel !== deel) {
        deel = r.onderdeel;
        log(`  ${deel}`);
      }
      const f = (v) => fmt(r, v);
      const cijfers = r.excel !== null || r.systeem !== null ? `Excel ${f(r.excel).padStart(13)}  systeem ${f(r.systeem).padStart(13)}${r.verschil ? `  verschil ${f(r.verschil)}` : ""}` : "";
      log(`    ${r.status.padEnd(14)} ${r.post.padEnd(66)} ${cijfers}${r.verklaring ? `\n${" ".repeat(20)}→ ${r.verklaring}` : ""}`);
    }
  }
  return afw.length;
}

function schrijfRapport(bestand, { titel, stats, rapporten, idem }) {
  const rij = (r) => `| ${r.status} | ${r.post.replace(/\|/g, "/")} | ${r.excel === null ? "—" : fmt(r, r.excel)} | ${r.systeem === null ? "—" : fmt(r, r.systeem)} | ${r.verschil ? fmt(r, r.verschil) : r.verschil === 0 ? "0" : "—"} | ${(r.verklaring || "").replace(/\|/g, "/")} |`;
  const r = rapporten[rapporten.length - 1];
  const tel = (st) => r.rijen.filter((x) => x.status === st).length;
  const delen = [
    `# Controle import boekhouding 2024–2025`,
    ``,
    `Vertrouwelijk (financiële gegevens). Gemaakt door scripts/boekhouding-importeren.mjs op ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — ${titel}.`,
    `Elk getal is berekend met de rekenkern van het systeem (lib/boekhouding/kern) via dezelfde laadroute als de app (SupabaseRepo → laadAlles → journaalVan) en vergeleken met de Excel, tolerantie 0 cent.`,
    ``,
    `**Uitkomst:** ${tel("gelijk")} gelijk · ${tel("verklaard")} verklaard · **${tel("AFWIJKING")} onverklaarde afwijking(en)**.`,
    ``,
    `## Kerncijfers (systeem)`,
    ``,
    ...Object.entries(r.kerncijfers).map(([k, v]) => `- ${k}: ${typeof v === "number" && /resultaat|balans|afschrijving/.test(k) ? euro(v) : typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} ${euro(b)}`).join(", ") : v}`),
    ``,
    `## Wat er is geschreven`,
    ``,
    `| Onderdeel | Nieuw | Al aanwezig | Toelichting |`,
    `|---|---:|---:|---|`,
    ...stats.map((s) => `| ${s.onderdeel} | ${s.nieuw} | ${s.aanwezig} | ${s.detail || ""} |`),
    ``,
    idem ? `**Idempotent:** tweede run → ${idem.nieuw} nieuw, ${idem.aanwezig} al aanwezig; kerncijfers ${idem.gelijk ? "identiek" : "VERSCHILLEND"}.` : "",
    ``,
  ];
  let deel = "";
  for (const x of r.rijen) {
    if (x.onderdeel !== deel) {
      deel = x.onderdeel;
      delen.push(``, `## ${deel}`, ``, `| Status | Post | Excel | Systeem | Verschil | Verklaring |`, `|---|---|---:|---:|---:|---|`);
    }
    delen.push(rij(x));
  }
  const open = r.rijen.filter((x) => /OPEN VRAAG/.test(x.verklaring));
  if (open.length) delen.push(``, `## Open punten voor de eigenaar (uit de verklaringen)`, ``, ...open.map((x) => `- **${x.onderdeel} · ${x.post}** (verschil ${fmt(x, x.verschil)}): ${x.verklaring}`));
  delen.push(``, `## Checklist jaarafsluiting 2025 (ter informatie; niet afgesloten)`, ``, ...r.afsluiten2025.map((c) => `- ${c.ok ? "[x]" : "[ ]"} ${c.titel}${c.blokkeert ? "" : " (waarschuwing)"}: ${c.uitleg}`), ``);
  fs.mkdirSync(path.dirname(path.resolve(bestand)), { recursive: true });
  fs.writeFileSync(path.resolve(bestand), delen.join("\n"));
  log(`\nControlerapport: ${path.resolve(bestand)}`);
}

// =============================================================================== hoofdprogramma
const pgTx = (db) => async (naam, fn) => {
  await db.exec("begin");
  await db.exec("set local role service_role");
  try {
    await fn();
    await db.exec("commit");
  } catch (e) {
    await db.exec("rollback");
    throw Object.assign(e, { batch: naam });
  }
};

async function draaiInPglite(db, eigenaar, label) {
  const sb = pgliteCliënt(db);
  const stats = await importeer(sb, { eigenaar, tx: pgTx(db), label });
  await db.exec("set role service_role");
  const rapport = await controle(sb, eigenaar);
  await db.exec("reset role");
  return { stats, rapport, sb };
}

function zelfde(a, b) {
  return JSON.stringify(a.kerncijfers) === JSON.stringify(b.kerncijfers) && JSON.stringify(a.rijen.map((r) => [r.id, r.systeem, r.status])) === JSON.stringify(b.rijen.map((r) => [r.id, r.systeem, r.status]));
}

try {
  if (DOEL === "pglite") {
    log(`PGlite: migraties 0001–0026 + UITVOEREN_0027.sql …`);
    const db = await maakPglite();
    let eigenaar = (await db.query("select user_id from public.team_members where rol = 'eigenaar' limit 1")).rows[0]?.user_id ?? null;
    if (EXPORT && EXPORT !== true) {
      const ex = leesJson(path.resolve(EXPORT));
      for (const t of ["clients", "invoices", "expenses"]) {
        if (Array.isArray(ex[t])) log(`  export → ${t}: ${await kopieerNaarPglite(db, t, ex[t])} rijen`);
        else if (ex[t]?.error) log(`  export ${t}: ${ex[t].error}`);
      }
      // Een export mét boekhoudtabellen (bv. een --dump) vervangt de seed van 0027, zoals de droge run op productie.
      if (BK_TABELLEN.some((t) => Array.isArray(ex[t]))) {
        for (const t of KOPIE_VOLGORDE) if (Array.isArray(ex[t])) await kopieerNaarPglite(db, t, ex[t], { leegEerst: true });
        log(`  export → bk-tabellen: ${BK_TABELLEN.filter((t) => Array.isArray(ex[t])).map((t) => `${t.replace("bk_", "")} ${ex[t].length}`).join(", ")}`);
      }
      if (ex.eigenaar) eigenaar = ex.eigenaar;
    } else log("  geen --export: geen facturen/bonnetjes (alleen de boekhouding)");
    const een = await draaiInPglite(db, eigenaar, "Run 1");
    const afw = toonControle(een.rapport, "Controle (PGlite, run 1)");
    log("\nRun 2 (idempotentie) …");
    const twee = await draaiInPglite(db, eigenaar, "Run 2");
    const idem = { nieuw: twee.stats.reduce((t, s) => t + s.nieuw, 0), aanwezig: twee.stats.reduce((t, s) => t + s.aanwezig, 0), gelijk: zelfde(een.rapport, twee.rapport) };
    log(`Run 2: ${idem.nieuw} nieuw, ${idem.aanwezig} al aanwezig; controle ${idem.gelijk ? "identiek" : "VERSCHILLEND"}`);
    if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, { titel: "doel: PGlite (lokaal, in het geheugen)", stats: een.stats, rapporten: [een.rapport], idem });
    if (DUMP && DUMP !== true) {
      // De database na de import als export (voor een test van de droge run op een al gevulde database).
      const uit = { eigenaar };
      for (const t of ["clients", "invoices", "expenses", ...BK_TABELLEN]) uit[t] = (await db.query(`select * from public.${q(t)}`)).rows;
      fs.writeFileSync(path.resolve(DUMP), JSON.stringify(uit));
      log(`Dump: ${path.resolve(DUMP)}`);
    }
    process.exit(afw || idem.nieuw || !idem.gelijk ? 2 : 0);
  }

  // ---------------------------------------------------------------- productie
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) stop("SUPABASE_URL (of NEXT_PUBLIC_SUPABASE_URL) en SUPABASE_SERVICE_ROLE_KEY ontbreken in de omgeving (gebruik node --env-file=.env.local).");
  const host = new URL(url).host;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  log(`Productie (${host}): alleen lezen …`);
  const prod = await leesProductie(sb);
  log(`  facturen ${prod.tabellen.invoices.length}, bonnetjes ${prod.tabellen.expenses.length}, klanten ${prod.tabellen.clients.length}; boekhoudtabellen (0027): ${prod.bk ? "aanwezig" : "ONTBREKEN"}`);
  if (prod.bk) log(`  bk: ${BK_TABELLEN.map((t) => `${t.replace("bk_", "")} ${prod.tabellen[t].length}`).join(", ")}`);
  if (!prod.bk && UITVOEREN) stop("migratie 0027 is in productie nog niet uitgevoerd (supabase/UITVOEREN_0027.sql). Er is niets geschreven.");

  // DROOG: een kopie van productie in PGlite, daar importeren en controleren.
  log(`\nDroog: kopie van productie in PGlite …`);
  const db = await maakPglite();
  for (const t of ["clients", "invoices", "expenses"]) await kopieerNaarPglite(db, t, prod.tabellen[t]);
  if (prod.bk) for (const t of KOPIE_VOLGORDE) await kopieerNaarPglite(db, t, prod.tabellen[t], { leegEerst: true });
  const eigenaar = prod.eigenaar;
  const droog = await draaiInPglite(db, eigenaar, "Droog (kopie van productie)");
  const afwDroog = toonControle(droog.rapport, "Controle droog (kopie van productie)");
  const nieuwDroog = droog.stats.reduce((t, s) => t + s.nieuw, 0);
  if (!UITVOEREN) {
    if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, { titel: `doel: productie ${host}, DROOG (kopie in PGlite; niets geschreven)`, stats: droog.stats, rapporten: [droog.rapport] });
    log(`\nDROOG: er is niets naar productie geschreven. ${nieuwDroog} nieuwe rij(en)/onderdelen zouden worden geschreven.`);
    log(afwDroog ? `Let op: ${afwDroog} onverklaarde afwijking(en); los die eerst op.` : `Alles klopt of is verklaard. Echt importeren: voeg --uitvoeren toe.`);
    process.exit(afwDroog ? 2 : 0);
  }
  if (afwDroog) stop(`de droge run heeft ${afwDroog} onverklaarde afwijking(en); er is niets geschreven.`);
  if (!nieuwDroog) log("\nAlles staat al in productie; er valt niets te schrijven.");
  else {
    log(`\nDoel: Supabase-project op ${host}. Er worden ${nieuwDroog} onderdelen geschreven (zie hierboven), in twee batches (2024, 2025).`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const antwoord = (await rl.question(`Typ de host (${host}) om te bevestigen dat je hiernaar wilt schrijven: `)).trim();
    rl.close();
    if (antwoord !== host) stop("niet bevestigd; er is niets geschreven.");
    const prodTx = async (naam, fn) => {
      log(`  batch ${naam} …`);
      try {
        await fn();
      } catch (e) {
        throw Object.assign(e, { batch: naam });
      }
      log(`  batch ${naam} klaar`);
    };
    await importeer(sb, { eigenaar, tx: prodTx, label: "Productie" });
  }
  const echt = await controle(sb, eigenaar);
  const afwEcht = toonControle(echt, "Controle productie (na import)");
  const gelijk = zelfde(droog.rapport, echt);
  log(`\nProductie ↔ droge run: ${gelijk ? "identieke uitkomsten" : "VERSCHILLEND (controleer het rapport)"}`);
  if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, { titel: `doel: productie ${host}, UITGEVOERD`, stats: droog.stats, rapporten: [droog.rapport, echt] });
  process.exit(afwEcht || !gelijk ? 2 : 0);
} catch (e) {
  if (e instanceof Conflict) stop(`conflict met wat er al staat${e.batch ? ` (batch ${e.batch})` : ""}: ${e.message}. Er is in deze batch niets (verder) geschreven.`);
  stop(`${e.batch ? `batch ${e.batch}: ` : ""}${e.message}`);
}
