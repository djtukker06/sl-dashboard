import { NextResponse } from "next/server";
import { httpError, readBody, requireUser, route } from "@/lib/social/http";
import { getProject, removeAssetObject, saveProject, statAsset } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Het origineel had geen uploadlimiet. Dit is alleen een vangnet tegen extreem grote
// bestanden (de bucket zelf staat 50 MB toe, zie 0017_social_storage_limieten.sql).
// Beelden boven de 5 MB van Anthropic blijven bruikbaar in de slides; ze worden alleen
// niet als afbeelding naar Claude gestuurd (zie mediaBlocks in lib/social/claude.ts).
const MAX_BYTES = 25 * 1024 * 1024;
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
  if (stat.size > MAX_BYTES) {
    await removeAssetObject(p.id, file); // niet laten rondslingeren in Storage (en in source.zip)
    throw httpError(400, "Afbeelding te groot (max 25 MB)");
  }
  if (!p.assets.some((a) => a.file === file)) {
    p.assets.push({ file, kind: kind === "beeld" ? "beeld" : "inspiratie", note: String(note || "") });
  }
  return NextResponse.json(await saveProject(p));
});
