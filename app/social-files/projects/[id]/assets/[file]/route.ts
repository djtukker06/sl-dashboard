import { checkFile, checkProjectId, httpError, requireUser, route } from "@/lib/social/http";
import { downloadAsset, getProject, mediaType } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// Beeldmateriaal uit de privé-bucket "social-assets" (<id>/<bestand>). Let op: paden op
// route() controleert zelf sessie + teamlidmaatschap (ook als de proxy is overgeslagen).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkProjectId(id);
  checkFile(file);
  await getProject(id); // verwijderde projecten (prullenbak) geven 404
  const bytes = await downloadAsset(id, file);
  if (!bytes) throw httpError(404, "Bestand niet gevonden");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mediaType(file),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
