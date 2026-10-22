import { NextResponse } from "next/server";
import { checkFile, requireUser, route } from "@/lib/social/http";
import { id as randomId } from "@/lib/social/ids";
import { getProject, readSlide, refreshChrome, saveProject } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

// server.js:272-279: kopie direct na het origineel.
export const POST = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  const html = await readSlide(p, file);
  const copy = `slide-${randomId()}.html`;
  p.slides.splice(p.slides.indexOf(file) + 1, 0, copy);
  await refreshChrome(p, new Map([[copy, html]]));
  return NextResponse.json(await saveProject(p));
});
