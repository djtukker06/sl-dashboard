#!/usr/bin/env node
/**
 * Boekt de bankmutaties van 2026 (RegioBank, met de tegenboeking op Revolut bij interne
 * overboekingen) en een correctie op 2025 in de bk_*-tabellen, en controleert daarna met de
 * rekenkern van het systeem (zelfde laadroute als de app: SupabaseRepo → laadAlles →
 * journaalVan) of alles klopt.
 *
 * Invoer (map, NIET in de repo: financiële gegevens van de eigenaar):
 *   boekingen-2026.json   per bankmutatie een boekingsvoorstel (soort, btw-code, categorie,
 *                         vennoot, koppeling aan een factuur, zekerheid, reden), de saldi per
 *                         maandeinde volgens de bank, de 2025-correctie, nieuwe
 *                         grootboekrekeningen en verfijningen van facturen (bk_bron_extra).
 *
 * Gebruik:
 *   # 1. Lokaal, zonder netwerk: PGlite (migraties 0001–0027) gevuld met een read-only export
 *   #    van productie (alle bk-tabellen + clients/invoices/expenses + eigenaar), twee runs
 *   #    (de tweede moet niets meer schrijven).
 *   node scripts/boekhouding-2026-boeken.mjs --bron=<map> --doel=pglite --export=<dump.json> [--rapport=<controle.md>]
 *
 *   # 2. Productie, DROOG (standaard): leest productie alleen, zet een kopie in PGlite, boekt
 *   #    daar en controleert. Er wordt niets geschreven.
 *   node --env-file=.env.local scripts/boekhouding-2026-boeken.mjs --bron=<map> [--rapport=<controle.md>]
 *
 *   # 3. Productie, ECHT: eerst stap 2 (moet foutloos zijn), dan de host typen, dan schrijven
 *   #    met de service-role en daarna dezelfde controle op productie.
 *   node --env-file=.env.local scripts/boekhouding-2026-boeken.mjs --bron=<map> --uitvoeren [--rapport=<controle.md>]
 *
 * Opties: --zonder-correctie-2025 (alleen 2026), --alleen-zeker (twijfelgevallen niet boeken).
 *
 * Eigenschappen:
 *   - Idempotent: elke bankregel heeft een vaste import_sleutel ('rb2026:<datum>:<bedrag>:<volgnr>',
 *     op Revolut met ':revolut' erachter; de 2025-correctie 'rb2025:…'). Wat er al staat wordt
 *     vergeleken: gelijk = overslaan, anders = stoppen (conflict). Een regel die er al los staat
 *     (zelfde rekening, datum en bedrag, bv. handmatig of via een CSV-import) wordt niet nog eens
 *     geboekt maar gemeld.
 *   - import_id blijft leeg, zodat een latere CSV-import van RegioBank of Revolut deze regels als
 *     "dubbel" herkent (losGeboekteRegels).
 *   - Elke regel gaat door de invoercontrole van de app (parseBoekingInvoer); factuurkoppelingen
 *     door koppelFout (bedrag, open saldo, vergrendeling).
 *   - Vergrendelde perioden (ingediende aangifte, afgesloten jaar) worden niet gewijzigd. Enige
 *     uitzondering: de 2025-correctie (vergrendeld_toegestaan), en alleen btw-loze regels: een
 *     overboeking/privé, of regels zonder btw die per kwartaal, soort en grootboekrekening per saldo
 *     0 zijn (bv. een per abuis ontvangen en in hetzelfde kwartaal terugbetaald bedrag). De controle eist dat elke ingediende aangifte exact gelijk
 *     herberekent als vóór de run en dat er in vergrendelde perioden niets anders verandert.
 *   - Facturen (invoices) en bonnetjes (expenses) worden alleen gelezen, nooit gewijzigd.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pgliteCliënt, maakPglite, kopieerNaarPglite, leesProductie, KOPIE_VOLGORDE, pgTx } from "./boekhouding-gemeen.mjs";

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
const ZONDER_2025 = optie("zonder-correctie-2025") === true;
const ALLEEN_ZEKER = optie("alleen-zeker") === true;

function stop(msg, code = 1) {
  console.error(`\nFout: ${msg}`);
  process.exit(code);
}
if (!BRON || BRON === true) stop("geef de map met boekingen-2026.json op: --bron=<map>");
if (!["pglite", "productie"].includes(DOEL)) stop("--doel moet pglite of productie zijn");
if (UITVOEREN && DOEL !== "productie") stop("--uitvoeren hoort bij --doel=productie (PGlite schrijft altijd, in het geheugen)");
if (DOEL === "pglite" && (!EXPORT || EXPORT === true)) stop("--doel=pglite heeft --export=<dump.json> nodig (read-only export van productie)");

// ------------------------------------------------------------------------------- TS laden
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
  const [model, aangifte, rapporten, periode, types, afletteren, repo] = await Promise.all(
    ["model.ts", "kern/aangifte.ts", "kern/rapporten.ts", "kern/periode.ts", "repo/types.ts", "kern/afletteren.ts", "repo/supabase.ts"].map(laadTs),
  );
  K = { model, aangifte, rapporten, periode, types, afletteren, repo };
} catch (err) {
  if (process.env.BK_2026_CHILD) throw err;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...ARGS], {
    stdio: "inherit",
    env: { ...process.env, BK_2026_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}

const log = (...a) => console.log(...a);
const euro = (c) => (c === null || c === undefined || Number.isNaN(c) ? "—" : `${c < 0 ? "−" : ""}€ ${(Math.abs(c) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const VANDAAG = K.periode.vandaagNL();

// ------------------------------------------------------------------------------- invoer
const bestand = path.join(path.resolve(BRON), "boekingen-2026.json");
if (!fs.existsSync(bestand)) stop(`boekingen-2026.json ontbreekt in ${BRON}`);
const P = JSON.parse(fs.readFileSync(bestand, "utf8"));
if (P.versie !== 1) stop("onbekende versie van boekingen-2026.json");
const CORRECTIES = ZONDER_2025 ? [] : P.correctie_2025 ?? [];
const VOORSTELLEN = P.boekingen.filter((v) => v.actie !== "bestaat_al");
const TE_BOEKEN = ALLEEN_ZEKER ? VOORSTELLEN.filter((v) => v.zekerheid === "zeker") : VOORSTELLEN;

// =============================================================================== boeken
class Conflict extends Error {}
const ok = (r, wat) => {
  if (r.error) throw new Error(`${wat}: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  return r.data;
};
const DOOR = (eigenaar) => (eigenaar ? { created_by: eigenaar, updated_by: eigenaar } : {});

async function laad(sb, eigenaar) {
  const repo = new K.repo.SupabaseRepo(sb, eigenaar ?? "00000000-0000-4000-8000-000000000000");
  const data = await K.types.laadAlles(repo);
  return { data, posten: K.types.journaalVan(data) };
}

/** Bankmutatie zoals op het afschrift: + bij, − af. */
const mutatie = (r) => (r.richting === "bij" ? 1 : -1) * Number(r.bedrag_centen);

/** Een regel (voorstel, correctie of tegenboeking) als invoer voor parseBoekingInvoer. */
function invoerVan(v, rekeningId, ven) {
  return {
    rekeningId,
    datum: v.datum,
    omschrijving: v.omschrijving,
    tegenpartij: v.tegenpartij ?? null,
    soort: v.soort,
    richting: v.richting,
    bedragCenten: v.bedrag_centen,
    isExcl: false,
    btwCode: v.btw_code,
    btwHandmatig: null,
    grootboek: v.grootboek ?? null,
    vennootId: v.vennoot ? ven.get(v.vennoot)?.id ?? "?" : null,
    status: v.status,
    notities: notitieVan(v),
  };
}
function notitieVan(v) {
  const delen = [];
  if (v.zekerheid === "twijfel") delen.push("TWIJFEL — voorstel, controleren:");
  if (v.reden) delen.push(v.reden);
  if (v.vraag) delen.push(`Vraag: ${v.vraag}`);
  if (v.bank_id) delen.push(`Bank-id ${v.bank_id}.`);
  return delen.join(" ").slice(0, 2000) || null;
}

/**
 * Alles boeken op een supabase-achtige cliënt (PGlite of productie). Geeft per onderdeel het
 * aantal nieuw/aanwezig terug, plus de regels die al los in de boekhouding stonden.
 */
async function boek(sb, { eigenaar, tx }) {
  const stats = [];
  const tel = (onderdeel, nieuw, aanwezig, detail = "") => stats.push({ onderdeel, nieuw, aanwezig, detail });
  const door = DOOR(eigenaar);
  const los = [];

  // ------------------------------------------------------------ inrichting
  await tx("inrichting", async () => {
    const { data } = await laad(sb, eigenaar);
    let n = 0;
    for (const g of P.grootboek_nieuw ?? []) {
      const er = data.stam.grootboek.find((x) => x.code === g.code);
      if (er) {
        if (er.soort !== g.soort || er.rubriek !== g.rubriek) throw new Conflict(`grootboek ${g.code} bestaat al als ${er.naam} (${er.soort}/${er.rubriek})`);
        continue;
      }
      ok(await sb.from("bk_grootboek").insert({ code: g.code, naam: g.naam, soort: g.soort, rubriek: g.rubriek, rgs_code: g.rgs ?? null, btw_standaard: g.btw ?? null, hint: g.hint ?? null, systeem: false, actief: true, volgorde: Number(g.code), ...door }).select("code"), `grootboek ${g.code}`);
      n++;
    }
    tel("grootboek (nieuwe rekeningen)", n, (P.grootboek_nieuw ?? []).length - n);

    const { data: d2 } = await laad(sb, eigenaar);
    n = 0;
    for (const e of P.bron_extra ?? []) {
      const f = d2.facturen.find((x) => x.id === e.bron_id && x.nummer === e.factuurnummer);
      if (!f) throw new Conflict(`factuur ${e.factuurnummer} (${e.bron_id}) niet gevonden`);
      const g = d2.stam.grootboek.find((x) => x.code === e.grootboek);
      if (e.grootboek && !K.model.kiesbareFactuurRekeningen(d2.stam.grootboek).some((x) => x.code === e.grootboek)) throw new Error(`verfijning ${e.factuurnummer}: rekening ${e.grootboek} is niet kiesbaar voor een factuur`);
      if (e.btw_code === "geen" && !(g && K.model.isFactuurBalansrekening(g))) throw new Error(`verfijning ${e.factuurnummer}: zonder btw kan alleen naar een vordering/schuld`);
      const er = d2.bronExtra.find((x) => x.bron === "factuur" && x.bronId === f.id);
      if (er) {
        if ((er.grootboek ?? null) !== (e.grootboek ?? null) || (er.btwCode ?? null) !== (e.btw_code ?? null)) throw new Conflict(`factuur ${e.factuurnummer} heeft al een andere verfijning (${er.grootboek}/${er.btwCode})`);
        continue;
      }
      const slot = K.periode.vergrendeldReden(f.datum, d2.stam.vergrendeling);
      if (slot) throw new Conflict(`verfijning ${e.factuurnummer}: ${slot}`);
      ok(await sb.from("bk_bron_extra").insert({ bron: "factuur", bron_id: f.id, btw_code: e.btw_code ?? null, grootboek_code: e.grootboek ?? null, vennoot_id: null, notitie: e.notitie ?? null, ...door }).select("bron_id"), `verfijning ${e.factuurnummer}`);
      n++;
    }
    tel("verfijning facturen (bk_bron_extra)", n, (P.bron_extra ?? []).length - n);
  });

  // ------------------------------------------------------------ bankregels
  const bankregels = async (naam, lijst, magVergrendeld) => {
    await tx(naam, async () => {
      const { data } = await laad(sb, eigenaar);
      const stam = data.stam;
      const rek = new Map(stam.rekeningen.map((r) => [r.naam.toLowerCase(), r]));
      const ven = new Map(stam.vennoten.map((v) => [v.naam, v]));
      // Alle rijen (ook verwijderde: een sleutel wordt nooit opnieuw gebruikt).
      const alle = [];
      for (const r of stam.rekeningen) {
        const d = ok(await sb.from("bk_boekingen").select("id, rekening_id, import_sleutel, datum, bedrag_centen, soort, richting, btw_code, btw_centen, grootboek_code, vennoot_id, verwijderd_op").eq("rekening_id", r.id).limit(50000), "boekingen");
        alle.push(...d);
      }
      const opSleutel = new Map(alle.filter((x) => x.import_sleutel).map((x) => [`${x.rekening_id}|${x.import_sleutel}`, x]));
      // Regels die er al los staan (niet van dit script): per rekening|datum|mutatie geteld.
      const bekend = new Set(P.boekingen.filter((v) => v.actie === "bestaat_al").map((v) => v.bestaande_id));
      const teller = new Map();
      for (const x of alle) {
        if (x.verwijderd_op || bekend.has(x.id)) continue;
        if (x.import_sleutel && /^rb20\d\d:/.test(x.import_sleutel)) continue;
        const k = `${x.rekening_id}|${x.datum}|${mutatie(x)}`;
        teller.set(k, (teller.get(k) ?? 0) + 1);
      }
      const groepVan = (x) => `${K.periode.jaarVan(x.datum)}-Q${K.periode.kwartaalVan(x.datum)}|${x.soort}|${x.grootboek ?? ""}|${x.vennoot ?? ""}`;
      const nulGroep = new Map();
      for (const x of lijst) if (x.vergrendeld_toegestaan && x.btw_code === "geen") nulGroep.set(groepVan(x), (nulGroep.get(groepVan(x)) ?? 0) + mutatie(x));
      const nieuw = [];
      let aanwezig = 0;
      for (const v of lijst) {
        const regels = [{ ...v, rekening: v.rekening }];
        if (v.tegenboeking) regels.push({ ...v, ...v.tegenboeking, grootboek: null, vennoot: null, btw_code: "geen", zekerheid: v.zekerheid, reden: `Tegenboeking van RegioBank ${v.datum} (${v.bank_id}).`, vraag: null });
        for (const r0 of regels) {
          const r = rek.get(r0.rekening.toLowerCase());
          if (!r) throw new Conflict(`rekening ${r0.rekening} ontbreekt (${r0.import_sleutel})`);
          const p = K.model.parseBoekingInvoer(invoerVan(r0, r.id, ven), stam, { vandaag: VANDAAG });
          if (!p.ok) throw new Error(`${r0.import_sleutel}: ${p.fout} (${p.veld})`);
          const w = p.waarde;
          const er = opSleutel.get(`${r.id}|${r0.import_sleutel}`);
          if (er) {
            const zelfde = er.datum === w.datum && Number(er.bedrag_centen) === w.bedrag && er.soort === w.soort && er.richting === w.richting && er.btw_code === w.btwCode && Number(er.btw_centen) === w.btw && (er.grootboek_code ?? null) === (w.grootboek ?? null) && (er.vennoot_id ?? null) === (w.vennootId ?? null);
            if (!zelfde) throw new Conflict(`${r0.import_sleutel} staat al in de database met andere waarden`);
            if (er.verwijderd_op) throw new Conflict(`${r0.import_sleutel} is in de app verwijderd; niet opnieuw boeken (eerst uitzoeken)`);
            aanwezig++;
            continue;
          }
          const k = `${r.id}|${w.datum}|${(w.richting === "bij" ? 1 : -1) * w.bedrag}`;
          if ((teller.get(k) ?? 0) > 0) {
            teller.set(k, teller.get(k) - 1);
            los.push({ sleutel: r0.import_sleutel, rekening: r0.rekening, datum: w.datum, bedrag: (w.richting === "bij" ? 1 : -1) * w.bedrag, omschrijving: w.omschrijving });
            continue;
          }
          const slot = K.periode.vergrendeldReden(w.datum, stam.vergrendeling);
          if (slot) {
            // Btw-loos: een overboeking/privé, of een regel zonder btw waarvan de groep (kwartaal, soort,
            // grootboek, vennoot) in deze lijst per saldo 0 is (bv. een per abuis ontvangen en in hetzelfde
            // kwartaal terugbetaald bedrag). Resultaat en aangifte van het kwartaal veranderen dan niet; de
            // controle 'aangifte … herberekent gelijk' blijft de borg.
            const btwLoos = w.btw === 0 && w.btwCode === "geen" && (["overboeking", "prive"].includes(w.soort) || (nulGroep.get(groepVan(r0)) ?? 1) === 0);
            if (!(magVergrendeld && r0.vergrendeld_toegestaan && btwLoos)) throw new Conflict(`${r0.import_sleutel}: ${slot}`);
            if (stam.vergrendeling.boekjaren.includes(Number(w.datum.slice(0, 4)))) throw new Conflict(`${r0.import_sleutel}: boekjaar ${w.datum.slice(0, 4)} is afgesloten`);
          }
          nieuw.push({
            rekening_id: w.rekeningId,
            datum: w.datum,
            omschrijving: w.omschrijving,
            tegenpartij: w.tegenpartij,
            tegenrekening: r0.rekening === v.rekening ? v.tegenrekening ?? null : null,
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
            kenmerk: v.kenmerk ?? null,
            notities: w.notities,
            import_sleutel: r0.import_sleutel,
            ...door,
          });
        }
      }
      for (let i = 0; i < nieuw.length; i += 200) ok(await sb.from("bk_boekingen").insert(nieuw.slice(i, i + 200)).select("id"), naam);
      tel(naam, nieuw.length, aanwezig, los.length ? `${los.length} al los aanwezig` : "");
    });
  };
  if (CORRECTIES.length) await bankregels("bankregels correctie 2025", CORRECTIES, true);
  await bankregels("bankregels 2026 (RegioBank + tegenboeking Revolut)", TE_BOEKEN, false);

  // ------------------------------------------------------------ factuurkoppelingen
  await tx("koppelingen", async () => {
    const { data } = await laad(sb, eigenaar);
    const sleutels = new Map();
    for (const r of data.stam.rekeningen) {
      const d = ok(await sb.from("bk_boekingen").select("id, import_sleutel").eq("rekening_id", r.id).not("import_sleutel", "is", null).limit(50000), "sleutels");
      for (const x of d) sleutels.set(x.import_sleutel, x.id);
    }
    let n = 0;
    let aanwezig = 0;
    let koppelingen = [...data.koppelingen];
    for (const v of TE_BOEKEN.filter((x) => x.koppeling?.bron === "factuur")) {
      const b = data.boekingen.find((x) => x.id === sleutels.get(v.import_sleutel));
      if (!b) {
        if (los.some((l) => l.sleutel === v.import_sleutel)) continue;
        throw new Error(`${v.import_sleutel}: bankregel niet gevonden`);
      }
      const f = data.facturen.find((x) => x.id === v.koppeling.factuur_id);
      if (!f || f.nummer !== v.koppeling.factuurnummer) throw new Conflict(`factuur ${v.koppeling.factuurnummer} niet gevonden`);
      if (koppelingen.some((k) => k.boekingId === b.id && k.bronId === f.id)) {
        aanwezig++;
        continue;
      }
      const post = K.afletteren.factuurPosten([f], koppelingen, VANDAAG)[0];
      const fout = K.afletteren.koppelFout(b, { bron: "factuur", id: f.id, totaal: post.totaal, open: post.open }, v.koppeling.bedrag_centen, koppelingen, data.stam.vergrendeling);
      if (fout) throw new Conflict(`${v.import_sleutel} ↔ ${f.nummer}: ${fout}`);
      ok(await sb.from("bk_koppelingen").insert({ boeking_id: b.id, bron: "factuur", bron_id: f.id, bedrag_centen: v.koppeling.bedrag_centen, ...(eigenaar ? { created_by: eigenaar } : {}) }).select("id"), "koppeling");
      koppelingen.push({ id: `nieuw-${n}`, boekingId: b.id, bron: "factuur", bronId: f.id, bedrag: v.koppeling.bedrag_centen, aangemaakt: "" });
      n++;
    }
    tel("koppelingen betaling ↔ factuur", n, aanwezig);
  });

  log("\nWat er is (of zou worden) geschreven");
  for (const s of stats) log(`  ${s.onderdeel.padEnd(58)} nieuw ${String(s.nieuw).padStart(3)}   al aanwezig ${String(s.aanwezig).padStart(3)}${s.detail ? `   (${s.detail})` : ""}`);
  if (los.length) {
    log("  Al los in de boekhouding (niet opnieuw geboekt; classificatie zelf controleren):");
    for (const l of los) log(`    ${l.rekening} ${l.datum} ${euro(l.bedrag)} ${l.omschrijving} (${l.sleutel})`);
  }
  return { stats, los };
}

// =============================================================================== controle
/** Ingediende aangiften + alles in vergrendelde perioden, om vóór/na te vergelijken. */
function slotafdruk(data, posten) {
  const v = data.stam.vergrendeling;
  const aangiften = Object.fromEntries(data.aangiften.map((a) => [`${a.jaar}-Q${a.kwartaal}`, JSON.stringify(K.aangifte.aangifteRubrieken(posten, a.jaar, a.kwartaal))]));
  const vergrendeld = new Map();
  for (const p of posten) if (K.periode.vergrendeldReden(p.datum, v)) vergrendeld.set(p.id, JSON.stringify(p.regels));
  const wv2025 = JSON.stringify(K.rapporten.winstEnVerlies(posten, data.stam.grootboek, 2025).resultaat);
  return { aangiften, vergrendeld, wv2025 };
}

async function controle(sb, eigenaar, voor) {
  const { data, posten } = await laad(sb, eigenaar);
  const R = K.rapporten;
  const gb = data.stam.grootboek;
  const rijen = [];
  const rij = (onderdeel, post, verwacht, systeem, status = verwacht === systeem ? "gelijk" : "AFWIJKING", verklaring = "") => rijen.push({ onderdeel, post, verwacht, systeem, verschil: typeof verwacht === "number" && typeof systeem === "number" ? systeem - verwacht : null, status, verklaring });
  const rek = (naam) => data.stam.rekeningen.find((r) => r.naam.toLowerCase() === naam);
  const regio = rek("regiobank");
  const revolut = rek("revolut");
  const saldo = (code, datum) => R.mutaties(posten, null, datum).get(code) ?? 0;

  // 1. RegioBank-saldo per maandeinde = bank
  for (const [datum, bank] of Object.entries(P.saldi)) {
    const sys = saldo(regio.grootboek, datum);
    // Bewust niet geboekt (--zonder-correctie-2025 / --alleen-zeker): dat verschil is verklaard.
    const zonder = ZONDER_2025 ? (P.correctie_2025 ?? []).filter((c) => c.datum <= datum).reduce((t, c) => t + (c.richting === "bij" ? 1 : -1) * c.bedrag_centen, 0) : 0;
    const overgeslagen = VOORSTELLEN.filter((v) => !TE_BOEKEN.includes(v) && v.datum <= datum).reduce((t, v) => t + (v.richting === "bij" ? 1 : -1) * v.bedrag_centen, 0);
    if (zonder || overgeslagen) rij("Banksaldo RegioBank", `Saldo ${datum}`, bank, sys, sys + zonder + overgeslagen === bank ? "verklaard" : "AFWIJKING", `niet geboekt: ${[zonder ? `2025-correctie ${euro(zonder)}` : "", overgeslagen ? `twijfelgevallen ${euro(overgeslagen)}` : ""].filter(Boolean).join(", ")}`);
    else rij("Banksaldo RegioBank", `Saldo ${datum}`, bank, sys);
  }

  // 2. Elke mutatie precies één keer
  const sleutelRijen = [];
  for (const r of data.stam.rekeningen) {
    const d = ok(await sb.from("bk_boekingen").select("id, rekening_id, import_sleutel, datum, bedrag_centen, richting, status, verwijderd_op").eq("rekening_id", r.id).limit(50000), "boekingen");
    sleutelRijen.push(...d);
  }
  const actief = sleutelRijen.filter((x) => !x.verwijderd_op);
  const perSleutel = (rekId, s) => actief.filter((x) => x.rekening_id === rekId && x.import_sleutel === s).length;
  let eenmaal = 0;
  const fout = [];
  for (const v of P.boekingen) {
    if (v.actie === "bestaat_al") {
      const n = actief.filter((x) => x.id === v.bestaande_id).length;
      if (n === 1) eenmaal++;
      else fout.push(`${v.bank_id}: bestaande regel ${n}×`);
      continue;
    }
    if (!TE_BOEKEN.includes(v)) continue;
    const n = perSleutel(regio.id, v.import_sleutel);
    if (n === 1) eenmaal++;
    else fout.push(`${v.bank_id}: ${n}×`);
    if (v.tegenboeking && perSleutel(revolut.id, v.tegenboeking.import_sleutel) !== 1) fout.push(`${v.bank_id} (Revolut): ${perSleutel(revolut.id, v.tegenboeking.import_sleutel)}×`);
  }
  const verwachtAantal = P.boekingen.filter((v) => v.actie === "bestaat_al" || TE_BOEKEN.includes(v)).length;
  rij("Bankmutaties", "Mutaties 2026 met precies één boeking (sleutel of bestaande regel)", verwachtAantal, eenmaal, eenmaal === verwachtAantal && !fout.length ? "gelijk" : "AFWIJKING", fout.slice(0, 10).join("; "));
  // Multiset (datum, bedrag) op RegioBank 1-1 t/m 30-9 = bank.
  const bankSet = P.boekingen.filter((v) => v.actie === "bestaat_al" || TE_BOEKEN.includes(v)).map((v) => `${v.datum}|${(v.richting === "bij" ? 1 : -1) * v.bedrag_centen}`).sort();
  const sysSet = actief.filter((x) => x.rekening_id === regio.id && x.datum >= "2026-01-01" && x.datum <= "2026-09-30").map((x) => `${x.datum}|${mutatie(x)}`).sort();
  const extra = sysSet.filter((x, i, a) => a.indexOf(x) === i && a.filter((y) => y === x).length > bankSet.filter((y) => y === x).length);
  const mist = bankSet.filter((x, i, a) => a.indexOf(x) === i && a.filter((y) => y === x).length > sysSet.filter((y) => y === x).length);
  rij("Bankmutaties", "RegioBank-regels 1-1 t/m 30-9-2026 (datum + bedrag) = afschrift", bankSet.length, sysSet.length, !extra.length && !mist.length && bankSet.length === sysSet.length ? "gelijk" : "AFWIJKING", [extra.length ? `te veel: ${extra.join(", ")}` : "", mist.length ? `ontbreekt: ${mist.join(", ")}` : ""].filter(Boolean).join("; "));
  for (const c of CORRECTIES) rij("Bankmutaties", `Correctie 2025 ${c.datum} ${euro(mutatie(c))} ${c.tegenpartij ?? ""} precies één keer`, 1, perSleutel(regio.id, c.import_sleutel));
  const tegen = TE_BOEKEN.filter((v) => v.tegenboeking);
  const kruis2026 = [...R.mutaties(posten, "2026-01-01", "2026-09-30").entries()].find(([c]) => c === "2000")?.[1] ?? 0;
  rij("Bankmutaties", `Overboekingen RegioBank → Revolut (${tegen.length}): kruisposten 2026 per saldo nul`, 0, kruis2026);
  const revSom = tegen.reduce((t, v) => t + v.bedrag_centen, 0);
  rij("Bankmutaties", "Revolut: ontvangen van RegioBank 2026 (som tegenboekingen)", revSom, R.mutaties(posten, "2026-01-01", "2026-09-30").get(revolut.grootboek) ?? 0, undefined, "Revolut-uitgaven ontbreken nog (komen met de Revolut-import)");

  // 3. Btw per kwartaal 2026: kern ↔ onafhankelijke optelling uit facturen + voorstellen
  for (const kw of [1, 2, 3]) {
    const ber = K.aangifte.aangifteRubrieken(posten, 2026, kw);
    const { van, tot } = K.periode.kwartaalGrenzen(2026, kw);
    const inKw = (d) => d >= van && d <= tot;
    const extraVan = new Map(data.bronExtra.filter((e) => e.bron === "factuur").map((e) => [e.bronId, e]));
    const fBtw = data.facturen.filter((f) => inKw(f.datum)).reduce((t, f) => {
      const code = extraVan.get(f.id)?.btwCode ?? (f.verlegd ? "verlegd" : "21");
      return t + (code === "21" || code === "9" ? f.btw : 0);
    }, 0);
    let bVerschuldigd = 0;
    let bVoor = 0;
    for (const b of data.boekingen) {
      if (!inKw(b.datum) || !["inkomst", "uitgave"].includes(b.soort)) continue;
      if (data.koppelingen.some((k) => k.boekingId === b.id)) continue;
      const teken = (b.soort === "inkomst") === (b.richting === "bij") ? 1 : -1;
      if (b.soort === "inkomst" && (b.btwCode === "21" || b.btwCode === "9")) bVerschuldigd += teken * b.btw;
      if (b.soort === "uitgave" && (b.btwCode === "21" || b.btwCode === "9")) bVoor += teken * b.btw;
    }
    const uitgaven = data.uitgaven.filter((u) => u.status === "verwerkt" && u.datum && inKw(u.datum)).length;
    const onafh = fBtw + bVerschuldigd - bVoor;
    rij(`Btw Q${kw} 2026`, "Saldo (centen): kern ↔ eigen optelling facturen + bankregels", onafh, ber.saldo.centen, uitgaven ? "AFWIJKING" : undefined, uitgaven ? `${uitgaven} verwerkte bonnetjes in dit kwartaal: optelling onvolledig` : "");
    rij(`Btw Q${kw} 2026`, "1a omzet / btw (centen)", null, ber.rubrieken["1a"].btw.centen, "info", `grondslag ${euro(ber.rubrieken["1a"].grondslag.centen)}`);
    rij(`Btw Q${kw} 2026`, "3b (EU) grondslag; buiten-EU niet in de aangifte", null, ber.rubrieken["3b"].grondslag.centen, ber.rubrieken["3b"].grondslag.centen === 0 ? "gelijk" : "AFWIJKING", `1e ${euro(ber.rubrieken["1e"].grondslag.centen)}; 3b hoort 0 te zijn (geen EU-klanten). SeamX (buiten de EU) staat niet in de aangifte.`);
    rij(`Btw Q${kw} 2026`, "5b voorbelasting (centen)", null, ber.voorbelasting.centen, "info");
    rij(`Btw Q${kw} 2026`, "Te betalen volgens het systeem (formulier)", null, K.aangifte.teBetalenCenten(ber), "info");
  }
  // Q1 2026 is betaald (€ 28): verschil verklaren.
  const q1 = K.aangifte.teBetalenCenten(K.aangifte.aangifteRubrieken(posten, 2026, 1));
  const btwBetaald = P.boekingen.filter((v) => v.soort === "btw" && v.koppeling?.aangifte === "2026-1").reduce((t, v) => t + v.bedrag_centen, 0);
  if (btwBetaald) {
    // De eigenaar gaf Q1 kennelijk op kasbasis aan (zoals de hele Excel-administratie 2025): in Q1 ontvangen
    // van Paus 25-023 (17-01), 26-001 (18-02) en 26-002 (04-03) = 3 × btw € 10,50 = € 31,50, min voorbelasting
    // klantonderzoek ≈ € 3,15 → € 28. Het systeem werkt met het factuurstelsel en telt daarnaast 26-003
    // (24-03) en 26-004 (factuurdatum Q1) mee, die pas in april binnenkwamen, en de voorbelasting van Reconi.
    const f003 = data.facturen.find((f) => f.nummer === "26-003");
    const f004 = data.facturen.find((f) => f.nummer === "26-004");
    const b25 = data.boekingen.find((b) => b.kenmerk === "25-023");
    const reconi = data.boekingen.find((b) => b.datum.startsWith("2026-01") && /reconi/i.test(b.omschrijving));
    const inQ1 = (f) => !!f && f.datum >= "2026-01-01" && f.datum <= "2026-03-31";
    const verklaard = (inQ1(f003) ? f003.btw : 0) + (inQ1(f004) ? f004.btw : 0) - (reconi?.btw ?? 0);
    const exact = K.aangifte.aangifteRubrieken(posten, 2026, 1).saldo.centen;
    const rest = exact - verklaard - btwBetaald;
    rij("Btw Q1 2026", "Betaald (28-04-2026) ↔ systeem", btwBetaald, q1, inQ1(f003) && inQ1(f004) && rest >= 0 && rest < 100 ? "verklaard" : "AFWIJKING", `Systeem (factuurstelsel) ${euro(exact)} exact. Betaald ${euro(btwBetaald)}: past bij een aangifte op kasbasis met de 3 Paus-betalingen die in Q1 binnenkwamen (25-023, 26-001, 26-002: btw € 31,50) − voorbelasting klantonderzoek (€ 3,15) = € 28,35. Verschil ${euro(exact - btwBetaald)} = 26-003 (btw ${euro(f003?.btw)}) + 26-004 (btw ${euro(f004?.btw)}; beide factuurdatum Q1, pas in april ontvangen) − voorbelasting Reconi ${euro(reconi?.btw)} = ${euro(verklaard)}, plus ${euro(rest)} afronding op hele euro's. 25-023 (btw ${euro(b25?.btw)}) zit waarschijnlijk al in de ${euro(btwBetaald)}. Laten bevestigen met de ingediende rubrieken 1a/5b; 26-003/26-004 bij Q2 NIET nog eens op kasbasis meenemen (het systeem telt ze al in Q1).`);
  }

  // 4. Omzet 2026 ↔ facturen
  const wv = R.winstEnVerlies(posten, gb, 2026);
  const omzetGroep = wv.groepen.find((g) => g.id === "omzet")?.jaar ?? 0;
  const omzetCodes = new Set(gb.filter((g) => g.rubriek === "omzet").map((g) => g.code));
  const bankOmzet = posten.filter((p) => p.bron === "boeking" && p.datum.startsWith("2026")).reduce((t, p) => t + p.regels.filter((r) => omzetCodes.has(r.grootboek)).reduce((x, r) => x + r.credit - r.debet, 0), 0);
  const facturenOmzet = data.facturen.filter((f) => f.datum.startsWith("2026")).reduce((t, f) => t + f.omzet, 0);
  rij("Omzet 2026", "W&V groep omzet − omzet uit bankregels zonder factuur ↔ facturenpagina (som omzet-vinkje)", facturenOmzet, omzetGroep - bankOmzet, undefined, `W&V omzet ${euro(omzetGroep)}, waarvan bankregels zonder factuur ${euro(bankOmzet)} (25-023)`);
  rij("Omzet 2026", "8090 Doorberekende kosten 2026", 0, wv.groepen.flatMap((g) => g.regels).find((r) => r.code === "8090")?.jaar ?? 0);

  // 5. Vergrendelde perioden: niets veranderd behalve de btw-loze 2025-correctie
  const na = slotafdruk(data, posten);
  for (const [k, v] of Object.entries(voor.aangiften)) rij("Vergrendeld", `Aangifte ${k} herberekent gelijk aan vóór de run`, 1, na.aangiften[k] === v ? 1 : 0);
  const correctieIds = new Set(actief.filter((x) => CORRECTIES.some((c) => c.import_sleutel === x.import_sleutel)).map((x) => `boeking:${x.id}`));
  const anders = [];
  for (const [id, r] of voor.vergrendeld) if (na.vergrendeld.get(id) !== r) anders.push(`gewijzigd/weg: ${id}`);
  for (const [id] of na.vergrendeld) if (!voor.vergrendeld.has(id) && !correctieIds.has(id)) anders.push(`nieuw: ${id}`);
  rij("Vergrendeld", "Resultaat (W&V) 2025 gelijk aan vóór de run (2025-correctie per saldo zonder resultaateffect)", 1, na.wv2025 === voor.wv2025 ? 1 : 0);
  rij("Vergrendeld", `Journaalposten in vergrendelde perioden ongewijzigd (alleen ${correctieIds.size} correctie(s) erbij)`, 0, anders.length, undefined, anders.slice(0, 5).join("; "));

  // 6. Samenhang
  let maanden = 0;
  for (const d of Object.keys(P.saldi)) {
    const b = R.balans(posten, gb, d);
    if (b.verschil !== 0) rij("Samenhang", `balans ${d}`, 0, b.verschil);
    maanden++;
  }
  rij("Samenhang", `Balans sluit op ${maanden} maandeinden`, 0, rijen.filter((r) => r.onderdeel === "Samenhang" && r.status === "AFWIJKING").length);

  // Info
  const twijfel = data.boekingen.filter((b) => b.status === "te_verwerken" && b.datum >= "2026-01-01").length;
  rij("Info", "Bankregels 2026 op 'te verwerken' (twijfel, gemarkeerd)", null, twijfel, "info");
  rij("Info", "Kruisposten 31-12-2025 (PayPal-ontvangsten € 20 + € 25 ontbreken)", null, saldo("2000", "2025-12-31"), "info");
  rij("Info", "Revolut-saldo 30-09-2026 volgens het systeem (zonder Revolut-uitgaven)", null, saldo(revolut.grootboek, "2026-09-30"), "info");
  rij("Info", "Debiteuren 30-09-2026 (open facturen)", null, saldo("1300", "2026-09-30"), "info");
  return { rijen, kern: { omzet2026: omzetGroep, regio3009: saldo(regio.grootboek, "2026-09-30"), q: [1, 2, 3].map((kw) => K.aangifte.teBetalenCenten(K.aangifte.aangifteRubrieken(posten, 2026, kw))) } };
}

function toon(rapport, titel) {
  const tel = (st) => rapport.rijen.filter((r) => r.status === st).length;
  const afw = tel("AFWIJKING");
  log(`\n${titel}: ${tel("gelijk")} gelijk, ${tel("verklaard")} verklaard, ${afw} afwijking(en)`);
  let deel = "";
  for (const r of rapport.rijen) {
    if (r.onderdeel !== deel) log(`  ${(deel = r.onderdeel)}`);
    const f = (v) => (typeof v === "number" && !/precies|Mutaties|regels|Aangifte|Resultaat|perioden|Balans sluit|te verwerken|tegenboekingen\)$/i.test(r.post) ? euro(v) : v ?? "—");
    log(`    ${r.status.padEnd(10)} ${r.post.padEnd(84)} verwacht ${String(f(r.verwacht)).padStart(12)}  systeem ${String(f(r.systeem)).padStart(12)}${r.verklaring ? `\n${" ".repeat(16)}→ ${r.verklaring}` : ""}`);
  }
  return afw;
}

function schrijfRapport(file, titel, run, rapport, idem) {
  const regels = [
    `# Controle boekingen 2026 (RegioBank) + correctie 2025`,
    ``,
    `Vertrouwelijk (financiële gegevens). scripts/boekhouding-2026-boeken.mjs, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — ${titel}.`,
    ``,
    `| Onderdeel | Nieuw | Al aanwezig | Toelichting |`,
    `|---|---:|---:|---|`,
    ...run.stats.map((s) => `| ${s.onderdeel} | ${s.nieuw} | ${s.aanwezig} | ${s.detail} |`),
    ``,
    idem ? `**Idempotent:** tweede run → ${idem.nieuw} nieuw; controle ${idem.gelijk ? "identiek" : "VERSCHILLEND"}.` : "",
    ``,
    `| Status | Onderdeel | Post | Verwacht | Systeem | Verklaring |`,
    `|---|---|---|---:|---:|---|`,
    ...rapport.rijen.map((r) => `| ${r.status} | ${r.onderdeel} | ${r.post} | ${r.verwacht ?? "—"} | ${r.systeem ?? "—"} | ${(r.verklaring || "").replace(/\|/g, "/")} |`),
    ``,
    `Bedragen in centen.`,
  ];
  fs.writeFileSync(path.resolve(file), regels.join("\n"));
  log(`\nControlerapport: ${path.resolve(file)}`);
}

// =============================================================================== hoofdprogramma
async function draaiPglite(db, eigenaar) {
  const sb = pgliteCliënt(db);
  await db.exec("set role service_role");
  const v = await laad(sb, eigenaar);
  const voor = slotafdruk(v.data, v.posten);
  await db.exec("reset role");
  const run = await boek(sb, { eigenaar, tx: pgTx(db) });
  await db.exec("set role service_role");
  const rapport = await controle(sb, eigenaar, voor);
  await db.exec("reset role");
  return { run, rapport, voor };
}

async function vulPglite(tabellen) {
  const db = await maakPglite();
  for (const t of ["clients", "invoices", "expenses"]) await kopieerNaarPglite(db, t, tabellen[t] ?? []);
  for (const t of KOPIE_VOLGORDE) if (Array.isArray(tabellen[t])) await kopieerNaarPglite(db, t, tabellen[t], { leegEerst: true });
  return db;
}

log(`Invoer: ${VOORSTELLEN.length} voorstellen (${VOORSTELLEN.filter((v) => v.zekerheid === "zeker").length} zeker, ${VOORSTELLEN.filter((v) => v.zekerheid === "twijfel").length} twijfel), ${P.boekingen.length - VOORSTELLEN.length} al aanwezig, ${CORRECTIES.length} correctie(s) 2025${ALLEEN_ZEKER ? "; alleen de zekere worden geboekt" : ""}.`);
try {
  if (DOEL === "pglite") {
    const ex = JSON.parse(fs.readFileSync(path.resolve(EXPORT), "utf8"));
    log("PGlite: migraties 0001–0026 + UITVOEREN_0027.sql, export van productie …");
    const db = await vulPglite(ex);
    const een = await draaiPglite(db, ex.eigenaar ?? null);
    const afw = toon(een.rapport, "Controle (PGlite, run 1)");
    log("\nRun 2 (idempotentie) …");
    const twee = await draaiPglite(db, ex.eigenaar ?? null);
    const idem = { nieuw: twee.run.stats.reduce((t, s) => t + s.nieuw, 0), gelijk: JSON.stringify(een.rapport.rijen.filter((r) => r.onderdeel !== "Vergrendeld")) === JSON.stringify(twee.rapport.rijen.filter((r) => r.onderdeel !== "Vergrendeld")) };
    log(`Run 2: ${idem.nieuw} nieuw; controle ${idem.gelijk ? "identiek" : "VERSCHILLEND"}`);
    if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, "doel: PGlite (export van productie)", een.run, een.rapport, idem);
    process.exit(afw || idem.nieuw || !idem.gelijk ? 2 : 0);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) stop("SUPABASE_URL (of NEXT_PUBLIC_SUPABASE_URL) en SUPABASE_SERVICE_ROLE_KEY ontbreken in de omgeving (gebruik node --env-file=.env.local).");
  const host = new URL(url).host;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  log(`Productie (${host}): alleen lezen …`);
  const prod = await leesProductie(sb);
  if (!prod.bk) stop("migratie 0027 is in productie niet uitgevoerd; er is niets geschreven.");
  log(`  bk_boekingen ${prod.tabellen.bk_boekingen.length}, facturen ${prod.tabellen.invoices.length}, aangiften ${prod.tabellen.bk_aangiften.length}`);

  log("\nDroog: kopie van productie in PGlite …");
  const db = await vulPglite(prod.tabellen);
  const droog = await draaiPglite(db, prod.eigenaar);
  const afwDroog = toon(droog.rapport, "Controle droog (kopie van productie)");
  const nieuw = droog.run.stats.reduce((t, s) => t + s.nieuw, 0);
  if (!UITVOEREN) {
    if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, `productie ${host}, DROOG (niets geschreven)`, droog.run, droog.rapport);
    log(`\nDROOG: er is niets naar productie geschreven. ${nieuw} rij(en) zouden worden geschreven.`);
    log(afwDroog ? `Let op: ${afwDroog} afwijking(en); los die eerst op.` : "Alles klopt. Echt boeken: voeg --uitvoeren toe.");
    process.exit(afwDroog ? 2 : 0);
  }
  if (afwDroog) stop(`de droge run heeft ${afwDroog} afwijking(en); er is niets geschreven.`);
  if (!nieuw) log("\nAlles staat al in productie; er valt niets te schrijven.");
  else {
    log(`\nDoel: Supabase-project op ${host}. Er worden ${nieuw} rijen geschreven (zie hierboven).`);
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
    };
    await boek(sb, { eigenaar: prod.eigenaar, tx: prodTx });
  }
  const echt = await controle(sb, prod.eigenaar, droog.voor);
  const afwEcht = toon(echt, "Controle productie (na het boeken)");
  const gelijk = JSON.stringify(echt.kern) === JSON.stringify(droog.rapport.kern);
  log(`\nProductie ↔ droge run: ${gelijk ? "identieke uitkomsten" : "VERSCHILLEND (controleer het rapport)"}`);
  if (RAPPORT && RAPPORT !== true) schrijfRapport(RAPPORT, `productie ${host}, UITGEVOERD`, droog.run, echt);
  process.exit(afwEcht || !gelijk ? 2 : 0);
} catch (e) {
  if (e instanceof Conflict) stop(`conflict met wat er al staat${e.batch ? ` (batch ${e.batch})` : ""}: ${e.message}. Er is in deze batch niets (verder) geschreven.`);
  stop(`${e.batch ? `batch ${e.batch}: ` : ""}${e.message}`);
}
