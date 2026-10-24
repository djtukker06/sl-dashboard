import { checkFile, checkProjectId, httpError, requireUser, route } from "@/lib/social/http";
import { getProject, readSlideRow } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// Vervangt de statische map /projects/<id>/slides/ van de oude Express-server. De slide
// wordt in een iframe getoond. De slide-HTML komt van de AI of is met de hand bewerkt, dus
// streng: geen scripts, geen formulieren, geen <base>, geen plug-ins, en "sandbox" (ook
// als iemand de slide los in een tabblad opent). allow-same-origin is nodig voor de
// thumbnails/editor (die al met sandbox="allow-same-origin" laden) en de eigen stylesheets.
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
      "Content-Security-Policy":
        "sandbox allow-same-origin; default-src 'none'; script-src 'none'; img-src 'self' data: https:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; " +
        "form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
