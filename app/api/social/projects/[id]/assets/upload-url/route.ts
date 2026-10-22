import { NextResponse } from "next/server";
import { bucketOntbreekt } from "@/lib/db/ontbreekt";
import { BUCKET, BUCKET_NIET_INGERICHT, db, httpError, readBody, requireUser, route } from "@/lib/social/http";
import { id as randomId } from "@/lib/social/ids";
import { assetPath, getProject } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Stap 1 van een upload (vervangt de dataUrl-upload uit server.js:221-237).
 * De server kiest de bestandsnaam op dezelfde manier (`<slug≤40>-<hex>.<ext>`, alleen
 * png/jpg/webp/gif) en geeft een signed upload-URL terug. De browser zet het bestand
 * daarna rechtstreeks in Supabase Storage (buiten de 4,5 MB-limiet van Vercel om).
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const { name, contentType } = await readBody(request);
  const m = String(contentType || "").match(/^image\/(png|jpe?g|webp|gif)$/);
  if (!m) throw httpError(400, "Alleen afbeeldingen (png, jpg, webp, gif) zijn toegestaan.");
  const base =
    String(name || "beeld")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "beeld";
  const file = `${base}-${randomId()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;

  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(assetPath(p.id, file));
  if (error || !data?.signedUrl) {
    console.error(error);
    if (bucketOntbreekt(error)) throw httpError(503, BUCKET_NIET_INGERICHT);
    throw httpError(500, "Kon de upload niet voorbereiden.");
  }
  return NextResponse.json({ file, signedUrl: data.signedUrl });
});
