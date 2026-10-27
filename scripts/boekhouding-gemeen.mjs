/**
 * Gedeelde hulpmiddelen voor de boekhoudscripts (boekhouding-importeren.mjs,
 * boekhouding-2026-boeken.mjs): een minimale supabase-js-achtige cliënt bovenop PGlite, een
 * lokale PGlite-database met alle migraties (zoals productie), rijen kopiëren en productie
 * alleen lezen. Geen eigen invoer of uitvoer; fouten worden gegooid (de scripts melden ze).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stop = (msg) => {
  throw new Error(msg);
};

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

/** Eén batch als transactie in PGlite, als service_role (zoals de schrijvende scripts op productie). */
export const pgTx = (db) => async (naam, fn) => {
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

export { q, pgliteCliënt, maakPglite, kopieerNaarPglite, leesProductie, BK_TABELLEN, KOPIE_VOLGORDE, EIGENAAR_PGLITE };
