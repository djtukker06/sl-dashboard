import { NextResponse } from "next/server";
import { setCanvas } from "@/lib/social/brand-guard";
import { getFormat, isFormat } from "@/lib/social/formats";
import { checkProjectId, readBody, requireUser, route } from "@/lib/social/http";
import { getProject, readSlides, refreshChrome, saveProject, softDeleteProject, versionCount } from "@/lib/social/repo";
import { logAudit } from "@/lib/audit";
import { teamlidUitContext } from "@/lib/auth/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// server.js:160-165: project + versionCount.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  p.versionCount = await versionCount(p.id);
  return NextResponse.json(p);
});

// server.js:167-189: dezelfde merge-regels.
export const PUT = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const { name, brief, links, caption, slides, format, brandChrome } = await readBody(request);
  if (typeof name === "string") p.name = name.slice(0, 120);
  if (brief && typeof brief === "object") p.brief = { ...p.brief, ...(brief as Record<string, unknown>) };
  if (Array.isArray(links)) p.links = links.map(String);
  if (typeof caption === "string") p.caption = caption;
  if (
    Array.isArray(slides) &&
    slides.length === p.slides.length &&
    new Set(slides).size === slides.length &&
    slides.every((s) => p.slides.includes(s))
  ) {
    p.slides = slides as string[];
  }
  const pending = new Map<string, string>();
  if (format && isFormat(format) && format !== p.format) {
    p.format = format;
    for (const s of await readSlides(p)) pending.set(s.file, setCanvas(s.html, getFormat(format), format));
  }
  if (typeof brandChrome === "boolean") p.brandChrome = brandChrome;
  await refreshChrome(p, pending);
  return NextResponse.json(await saveProject(p));
});

// server.js:191-196: naar de prullenbak (zacht verwijderen via deleted_at).
export const DELETE = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  checkProjectId(id);
  await getProject(id);
  await softDeleteProject(id);
  await logAudit("verwijderd_social_project", { lid: teamlidUitContext(), doel: id }, request);
  return NextResponse.json({ ok: true });
});
