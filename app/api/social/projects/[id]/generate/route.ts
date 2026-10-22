import { requireUser, route } from "@/lib/social/http";
import { runGeneration } from "@/lib/social/generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// server.js:386: nieuw ontwerp, of met feedback de hele post aanpassen (SSE).
export const POST = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  return runGeneration(request, { projectId: id });
});
