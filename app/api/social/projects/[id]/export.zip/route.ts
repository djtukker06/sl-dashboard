import { httpError, redirectToSigned, requireUser, route } from "@/lib/social/http";
import { renderAll } from "@/lib/social/export";
import { slug } from "@/lib/social/ids";
import { getProject } from "@/lib/social/repo";
import { zipBuffer, type ZipEntry } from "@/lib/social/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// server.js:417-430: PNG's + caption.txt als ZIP, via Storage-redirect (K7).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  if (!p.slides.length) throw httpError(400, "Nog geen slides om te exporteren.");
  const pngs = await renderAll(p);
  const entries: ZipEntry[] = pngs.map((buf, i) => ({
    name: `${slug(p.name)}-${String(i + 1).padStart(2, "0")}.png`,
    data: buf,
  }));
  if (p.caption) entries.push({ name: "caption.txt", data: p.caption });
  return redirectToSigned(p.id, `${slug(p.name)}.zip`, await zipBuffer(entries), "application/zip");
});
