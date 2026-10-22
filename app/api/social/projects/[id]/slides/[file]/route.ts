import { NextResponse } from "next/server";
import { checkFile, httpError, readBody, requireUser, route } from "@/lib/social/http";
import { checkSlide, getProject, readSlide, refreshChrome, saveProject, snapshot } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// server.js:257-260: ruwe HTML als text/plain.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  return new NextResponse(await readSlide(p, file), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
});

// server.js:262-270: { html, snapshot? }, zonder enforceBrand (zoals de bron).
export const PUT = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  checkSlide(p, file);
  const body = await readBody(request);
  if (typeof body.html !== "string") throw httpError(400, "Geen HTML ontvangen");
  if (body.snapshot !== false) await snapshot(p, "handmatige bewerking");
  await refreshChrome(p, new Map([[file, body.html]]));
  return NextResponse.json(await saveProject(p));
});

// server.js:281-288
export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  checkSlide(p, file);
  await snapshot(p, "slide verwijderd");
  p.slides = p.slides.filter((s) => s !== file);
  await refreshChrome(p);
  return NextResponse.json(await saveProject(p));
});
