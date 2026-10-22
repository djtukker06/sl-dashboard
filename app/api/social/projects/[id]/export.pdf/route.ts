import { httpError, redirectToSigned, requireUser, route } from "@/lib/social/http";
import { renderPdf } from "@/lib/social/export";
import { slug } from "@/lib/social/ids";
import { getProject } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// server.js:432-441: PDF met een pagina per slide, via Storage-redirect (K7).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  if (!p.slides.length) throw httpError(400, "Nog geen slides om te exporteren.");
  return redirectToSigned(p.id, `${slug(p.name)}.pdf`, await renderPdf(p), "application/pdf");
});
