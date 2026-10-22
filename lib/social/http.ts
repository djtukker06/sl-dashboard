import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { safe } from "./ids";

export const BUCKET = "social-assets";

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
  return NextResponse.json({ error: message }, { status });
}

/**
 * Eerste regel van élke social-route: controleert de Supabase-sessie (net als de
 * facturen-API). Zonder ingelogde gebruiker volgt een 401 `{ error: 'Niet ingelogd.' }`.
 * Pas daarna mag de route de service-role client gebruiken.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "Niet ingelogd.");
  return user;
}

/** Service-role client; alleen aanroepen ná `requireUser()`. */
export function db() {
  return createServiceRoleClient();
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
 * Wikkelt een route-handler: HttpErrors worden `{ error }` met de juiste status,
 * onverwachte fouten een 500 (zoals server.js:445-450). Database-details gaan
 * alleen naar de serverlog, niet naar de browser.
 */
export function route<C>(fn: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error(err);
        return jsonError(err.status, err.message || "Er ging iets mis.");
      }
      console.error(err);
      return jsonError(500, (err instanceof Error && err.message) || "Er ging iets mis.");
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
  const objectPath = `exports/${projectId}/${Date.now()}-${name}`;
  const { error: upErr } = await storage.upload(objectPath, bytes, { contentType, upsert: true });
  if (upErr) {
    console.error(upErr);
    throw new HttpError(500, "Kon de export niet klaarzetten.");
  }
  const { data, error } = await storage.createSignedUrl(objectPath, 300, { download: name });
  if (error || !data?.signedUrl) {
    console.error(error);
    throw new HttpError(500, "Kon de export niet klaarzetten.");
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
