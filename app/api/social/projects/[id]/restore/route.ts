import { NextResponse } from "next/server";
import { httpError, requireUser, route } from "@/lib/social/http";
import { getProject, restoreLatest } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// server.js:290-302: nieuwste versie terugzetten en die versie verwijderen, in één
// transactie via de RPC social_restore_latest (migratie 0014).
export const POST = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const restored = await restoreLatest(p.id);
  if (!restored) throw httpError(400, "Er is geen eerdere versie.");
  return NextResponse.json(restored);
});
