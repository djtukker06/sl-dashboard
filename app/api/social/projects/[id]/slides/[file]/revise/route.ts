import { checkFile, requireUser, route } from "@/lib/social/http";
import { runGeneration } from "@/lib/social/generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; file: string }> };

// server.js:388-391: één slide aanpassen (SSE).
export const POST = route(async (request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  return runGeneration(request, { projectId: id, mode: "revise-one", targetFile: file });
});
