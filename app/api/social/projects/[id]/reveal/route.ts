import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/social/http";
import { getProject } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Vervangt server.js:209-217 ("toon map in Finder"): online is er geen Finder, dus
// verwijzen we naar de ZIP met de HTML-bestanden van het project.
export const POST = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  return NextResponse.json({ ok: true, url: `/api/social/projects/${encodeURIComponent(p.id)}/source.zip` });
});
