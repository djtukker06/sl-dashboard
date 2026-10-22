import { checkFile, checkProjectId, httpError, requireUser, route } from "@/lib/social/http";
import { getProject, readSlideRow } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// Vervangt de statische map /projects/<id>/slides/ van de oude Express-server. De slide
// wordt in een iframe getoond; de CSP zorgt dat scripts in slide-HTML nooit draaien.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkProjectId(id);
  checkFile(file);
  await getProject(id);
  const html = await readSlideRow(id, file);
  if (html === null) throw httpError(404, "Slide niet gevonden");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "script-src 'none'; object-src 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
