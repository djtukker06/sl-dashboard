import { NextResponse } from "next/server";
import { isFormat } from "@/lib/social/formats";
import { readBody, requireUser, route } from "@/lib/social/http";
import { newProjectId } from "@/lib/social/ids";
import { listProjects, markeerMaker, saveProject, type Project } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// server.js:131-139: { id, name, format, slides, updatedAt }, nieuwste eerst, zonder prullenbak.
export const GET = route(async () => {
  await requireUser();
  return NextResponse.json(await listProjects());
});

// server.js:141-158
export const POST = route(async (request: Request) => {
  const gebruiker = await requireUser();
  const body = await readBody(request);
  const now = new Date().toISOString();
  const p: Project = {
    id: newProjectId(now),
    name: String(body.name || "Nieuwe post").slice(0, 120),
    format: isFormat(body.format) ? body.format : "ig-portrait",
    brief: { topic: "", text: "", explanation: "", audience: "", cta: "", slideCount: "" },
    links: [],
    assets: [],
    caption: "",
    slides: [],
    brandChrome: true,
    createdAt: now,
    updatedAt: now,
  };
  const opgeslagen = await saveProject(p);
  await markeerMaker(p.id, gebruiker.id);
  return NextResponse.json(opgeslagen);
});
