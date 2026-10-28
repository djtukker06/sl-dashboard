import { NextResponse } from "next/server";
import { huidigTeamlid, metTeamlid, teamlidUitContext, weigering } from "@/lib/auth/team";
import { logFout } from "@/lib/log";
import { logAudit } from "@/lib/audit";
import { eigenHerkomst, isWijzigend } from "@/lib/auth/herkomst";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bucketOntbreekt } from "@/lib/db/ontbreekt";
import { safe } from "./ids";

export const BUCKET = "social-assets";

/** Melding zolang de social-tabellen niet bestaan (migraties nog niet uitgevoerd). */
export const NIET_INGERICHT =
  "De social-module is nog niet ingericht: voer in Supabase de migraties 0014–0017 uit en importeer daarna de bestaande posts.";
/** Melding zolang de Storage-bucket social-assets niet bestaat. */
export const BUCKET_NIET_INGERICHT =
  "De opslag voor social (bucket social-assets) bestaat nog niet: voer in Supabase migratie 0015 uit.";

/** Fout met HTTP-status, zoals `httpError()` in Social-media-tool/server.js:93-95. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

/** Foutvorm `{ error }` met status, zoals de foutafhandeling in server.js:445-450. */
export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Eerste regel van élke social-route (naast de controle die `route()` al doet):
 * sessie + actief teamlidmaatschap (lib/auth/team.ts). Zonder sessie een 401
 * `{ error: 'Niet ingelogd.' }`, zonder lidmaatschap een 403. Pas daarna mag de route de
 * service-role client gebruiken. Binnen `route()` komt het teamlid uit de context van het
 * verzoek (geen tweede controle per bestand).
 */
export async function requireUser(): Promise<{ id: string; email: string | null }> {
  try {
    const lid = teamlidUitContext();
    return { id: lid.userId, email: lid.email || null };
  } catch {
    // Buiten route(): zelf controleren.
  }
  const s = await huidigTeamlid();
  if (s.soort === "anoniem") throw new HttpError(401, "Niet ingelogd.");
  if (s.soort === "geen_toegang") throw new HttpError(403, "Geen toegang.");
  if (s.soort === "storing") throw new HttpError(503, "De toegangscontrole is tijdelijk niet beschikbaar.");
  if (s.soort === "tfa") throw new HttpError(401, "Vul eerst je 2FA-code in.");
  if (s.soort === "wachtwoord") throw new HttpError(401, "Kies eerst een nieuw wachtwoord.");
  return { id: s.lid.userId, email: s.lid.email || null };
}

/** Service-role client; alleen binnen `route()` (ná de teamlidcontrole) te gebruiken. */
export function db() {
  return createServiceRoleClient(teamlidUitContext().bewijs);
}

/** Controleert een project-id uit de URL (server.js:43). */
export function checkProjectId(pid: string): string {
  if (!safe(pid)) throw new HttpError(400, "Ongeldig project");
  return pid;
}

/** Controleert een bestandsnaam uit de URL tegen dezelfde `safe()`-regel. */
export function checkFile(file: string): string {
  if (!safe(file)) throw new HttpError(400, "Ongeldige bestandsnaam");
  return file;
}

/** Leest de JSON-body; een lege of ongeldige body telt als `{}` (zoals express.json). */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const data = await request.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/**
 * Wikkelt een route-handler: eerst sessie + teamlidmaatschap (401/403), bij wijzigende
 * verzoeken de herkomst (403), daarna de handler met het teamlid in de context van het
 * verzoek (voor db()). HttpErrors worden `{ error }` met de juiste status, onverwachte
 * fouten een 500 met een algemene melding; details gaan alleen naar de serverlog.
 */
export function route<C>(fn: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    const s = await huidigTeamlid();
    if (s.soort !== "lid") return weigering(s);
    if (isWijzigend(request.method) && !eigenHerkomst(request)) return jsonError(403, "Ongeldige herkomst.");
    try {
      return await metTeamlid(s.lid, () => fn(request, context));
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) logFout("[social]", err);
        return jsonError(err.status, err.message || "Er ging iets mis.");
      }
      logFout("[social]", err);
      return jsonError(500, "Er ging iets mis. Probeer het opnieuw.");
    }
  };
}

/** Content-Disposition zoals Express' `res.attachment(naam)`. */
export function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "?").replace(/["\\]/g, "\\$&");
  return ascii === name
    ? `attachment; filename="${ascii}"`
    : `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Exports ouder dan dit zijn al gedownload (de signed URL leeft 5 minuten). */
const EXPORT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Ruimt eerdere exports van dit project op (best effort): elke nieuwe export van een
 * project gooit de oude weg, zodat exports/<id>/ niet blijft groeien.
 */
async function removeOldExports(projectId: string) {
  try {
    const storage = db().storage.from(BUCKET);
    const { data, error } = await storage.list(`exports/${projectId}`, { limit: 1000 });
    if (error) throw error;
    const cutoff = Date.now() - EXPORT_MAX_AGE_MS;
    const old = (data ?? [])
      .filter((o) => o.id !== null && Number(o.name.split("-")[0]) < cutoff)
      .map((o) => `exports/${projectId}/${o.name}`);
    if (old.length) {
      const { error: rmErr } = await storage.remove(old);
      if (rmErr) throw rmErr;
    }
  } catch (err) {
    logFout("[social] oude exports opruimen", err);
  }
}

/**
 * Responses op Vercel mogen maximaal 4,5 MB zijn. Exports gaan daarom eerst naar de
 * privé-bucket (`exports/<id>/<ts>-<naam>`), waarna de browser met een 302 naar een
 * signed URL van 5 minuten gaat die het bestand onder de originele naam downloadt.
 */
export async function redirectToSigned(
  projectId: string,
  name: string,
  bytes: Buffer,
  contentType: string,
): Promise<Response> {
  const storage = db().storage.from(BUCKET);
  await removeOldExports(projectId);
  const objectPath = `exports/${projectId}/${Date.now()}-${name}`;
  const { error: upErr } = await storage.upload(objectPath, bytes, { contentType, upsert: true });
  if (upErr) {
    logFout("[social] export klaarzetten", upErr);
    if (bucketOntbreekt(upErr)) throw new HttpError(503, BUCKET_NIET_INGERICHT);
    throw new HttpError(500, "Kon de export niet klaarzetten.");
  }
  const { data, error } = await storage.createSignedUrl(objectPath, 300, { download: name });
  if (error || !data?.signedUrl) {
    logFout("[social] export klaarzetten", error);
    throw new HttpError(500, "Kon de export niet klaarzetten.");
  }
  const lid = teamlidUitContext();
  await logAudit("export_social", { lid, doel: projectId, details: { soort: name.split(".").pop() ?? "", naam: name } });
  return NextResponse.redirect(data.signedUrl, 302);
}
