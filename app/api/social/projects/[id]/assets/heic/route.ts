import { NextResponse } from "next/server";
import { BUCKET, db, httpError, requireUser, route } from "@/lib/social/http";
import { id as randomId } from "@/lib/social/ids";
import { assetPath, getProject, saveProject } from "@/lib/social/repo";
import { BeeldFout, heicNaarJpeg, MELDING_HEIC_ONLEESBAAR } from "@/lib/uitgaven/beeld";
import { logFout } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// HEIC decoderen (libheif-wasm) kan bij een grote foto een paar seconden duren.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// Vercel weigert request-bodies boven ~4,5 MB; iets eronder blijven.
const MAX_BYTES = 4.4 * 1024 * 1024;

/**
 * Vangnet voor iPhone-foto's (HEIC/HEIF) in een browser die ze zelf niet kan lezen
 * (Chrome, Firefox, Edge; Safari zet ze in de browser al om naar JPEG). De bucket
 * accepteert geen HEIC (0017_social_storage_limieten.sql), dus de server zet de foto om
 * naar JPEG (lib/uitgaven/beeld.ts, zelfde als bij bonnetjes), slaat hem op en koppelt
 * hem aan het project. Body: het ruwe bestand; ?name=…&kind=inspiratie|beeld.
 * Respons: het bijgewerkte project, net als POST /assets.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "beeld" ? "beeld" : "inspiratie";
  const lengte = Number(request.headers.get("content-length") || 0);
  if (lengte > MAX_BYTES) {
    throw httpError(413, "Deze iPhone-foto (HEIC) is te groot om om te zetten. Exporteer hem als JPEG of open de pagina in Safari.");
  }
  const inhoud = new Uint8Array(await request.arrayBuffer());
  if (!inhoud.length) throw httpError(400, "Leeg bestand ontvangen.");
  if (inhoud.length > MAX_BYTES) {
    throw httpError(413, "Deze iPhone-foto (HEIC) is te groot om om te zetten. Exporteer hem als JPEG of open de pagina in Safari.");
  }

  let jpeg: Buffer;
  try {
    ({ jpeg } = await heicNaarJpeg(inhoud));
  } catch (err) {
    if (!(err instanceof BeeldFout)) logFout("[social] heic", err);
    throw httpError(400, MELDING_HEIC_ONLEESBAAR);
  }

  const base =
    String(url.searchParams.get("name") || "beeld")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "beeld";
  const file = `${base}-${randomId()}.jpg`;
  const { error } = await db()
    .storage.from(BUCKET)
    .upload(assetPath(p.id, file), jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) {
    logFout("[social] heic-opslaan", error);
    throw httpError(500, "Kon de omgezette foto niet opslaan. Probeer het opnieuw.");
  }
  p.assets.push({ file, kind, note: "" });
  return NextResponse.json(await saveProject(p));
});
