import { redirectToSigned, requireUser, route } from "@/lib/social/http";
import { slug } from "@/lib/social/ids";
import { sourceEntries } from "@/lib/social/export";
import { getProject } from "@/lib/social/repo";
import { zipBuffer } from "@/lib/social/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// Vervangt "toon map in Finder": de projectmap (slides, beeldmateriaal, project.json)
// plus de huisstijlbestanden als ZIP, via een signed Storage-URL (max 4,5 MB-respons).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const zip = await zipBuffer(await sourceEntries(p));
  return redirectToSigned(p.id, `${slug(p.name)}-html.zip`, zip, "application/zip");
});
