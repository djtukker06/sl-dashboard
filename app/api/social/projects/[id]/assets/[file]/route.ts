import { NextResponse } from "next/server";
import { checkFile, httpError, readBody, requireUser, route } from "@/lib/social/http";
import { getProject, saveProject } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// server.js:239-246: alleen metadata (notitie, soort).
export const PUT = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  const a = p.assets.find((x) => x.file === file);
  if (!a) throw httpError(404, "Bestand niet gevonden");
  const body = await readBody(request);
  if (typeof body.note === "string") a.note = body.note;
  if (body.kind === "beeld" || body.kind === "inspiratie") a.kind = body.kind;
  return NextResponse.json(await saveProject(p));
});

// server.js:248-253: alleen uit de lijst; het bestand zelf blijft staan omdat een
// slide er nog naar kan verwijzen.
export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  p.assets = p.assets.filter((x) => x.file !== file);
  return NextResponse.json(await saveProject(p));
});
