import { NextResponse } from "next/server";
import { httpError, readBody, requireUser, route } from "@/lib/social/http";
import { getProject, saveProject, statAsset } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024; // Anthropic accepteert afbeeldingen tot 5 MB
// Zoals upload-url de naam maakt: `<slug≤40>-<8 hex>.<ext>`.
const UPLOAD_NAME = /^[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{8}\.(png|jpg|webp|gif)$/;

/**
 * Stap 3 van een upload: het bestand staat al in Storage (via de signed upload-URL);
 * nu wordt het aan het project toegevoegd. Zelfde respons als server.js:221-237
 * (het bijgewerkte project).
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const { file, kind, note } = await readBody(request);
  if (typeof file !== "string" || !UPLOAD_NAME.test(file)) {
    throw httpError(400, "Alleen afbeeldingen (png, jpg, webp, gif) zijn toegestaan.");
  }
  const stat = await statAsset(p.id, file);
  if (!stat) throw httpError(400, "Het bestand is niet (volledig) geüpload. Probeer het opnieuw.");
  if (stat.size > MAX_BYTES) throw httpError(400, "Afbeelding te groot (max 5 MB)");
  if (!p.assets.some((a) => a.file === file)) {
    p.assets.push({ file, kind: kind === "beeld" ? "beeld" : "inspiratie", note: String(note || "") });
  }
  return NextResponse.json(await saveProject(p));
});
