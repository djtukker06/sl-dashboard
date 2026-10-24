// Gedeelde stukken voor scripts/teamlid-toevoegen.mjs en scripts/teamlid-verwijderen.mjs.
// Sleutels komen UITSLUITEND uit de procesomgeving (bv. node --env-file=.env.local …); dit
// bestand leest zelf geen .env-bestanden en print nooit een sleutel of token.
import { createClient } from "@supabase/supabase-js";

export const KLEUREN = ["#c8a97e", "#8f6b4a", "#6e7b5b", "#b5654a", "#5b6b7b", "#9a7fa0"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function fout(melding, code = 1) {
  console.error(`Fout: ${melding}`);
  process.exit(code);
}

/** --sleutel waarde / --vlag → { sleutel: 'waarde', vlag: true } */
export function leesArgumenten(argv, { vlaggen = [], waarden = [] }) {
  const uit = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fout(`onbekend argument "${a}" (zie --help)`);
    const [naam, inline] = a.slice(2).split(/=(.*)/s);
    if (vlaggen.includes(naam)) {
      uit[naam] = true;
    } else if (waarden.includes(naam)) {
      const w = inline ?? argv[++i];
      if (w === undefined || w.startsWith("--")) fout(`--${naam} heeft een waarde nodig`);
      uit[naam] = w;
    } else {
      fout(`onbekende optie --${naam} (zie --help)`);
    }
  }
  return uit;
}

export function controleerEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 320) fout("geef een geldig e-mailadres op met --email");
  return e;
}

export function initialenVan(naam) {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  return ((delen[0]?.[0] ?? "S") + (delen[1]?.[0] ?? "")).toUpperCase().slice(0, 3);
}

/** Service-role client uit de omgeving; null als de variabelen ontbreken. */
export function adminClient({ verplicht = true } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sleutel = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !sleutel) {
    if (!verplicht) return null;
    fout(
      "NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY ontbreken in de omgeving.\n" +
        "       Start zo:  node --env-file=.env.local scripts/<script>.mjs …",
    );
  }
  return createClient(url, sleutel, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Zoekt een gebruiker op e-mailadres (met paginering door alle gebruikers). */
export async function vindGebruiker(sb, email) {
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fout(`gebruikers ophalen mislukt: ${error.message}`);
    const users = data?.users ?? [];
    const gevonden = users.find((u) => (u.email || "").toLowerCase() === email);
    if (gevonden) return gevonden;
    if (users.length < 200) return null;
  }
  return null;
}

export function tabelFout(error) {
  return error && ["PGRST205", "42P01"].includes(error.code);
}

/**
 * Regel in de audit-log (migratie 0026) met bron 'script'. Best effort: zonder tabel of bij
 * een fout alleen een waarschuwing. Nooit wachtwoorden, tokens of codes in details.
 */
export async function auditScript(sb, actie, { userId = null, doel = null, details = {} } = {}) {
  try {
    const { error } = await sb.from("audit_log").insert({
      user_id: userId,
      actie,
      doel: doel ? String(doel).slice(0, 200) : null,
      details,
      ua: "script",
      bron: "script",
    });
    if (error && !tabelFout(error) && error.code !== "PGRST204") console.error(`Waarschuwing: audit-log niet bijgewerkt (${error.code ?? "fout"}).`);
  } catch {
    console.error("Waarschuwing: audit-log niet bijgewerkt.");
  }
}
