import { checkFile, jsonError, requireUser, route } from "@/lib/social/http";
import { runGeneration } from "@/lib/social/generation";
import { binnenGebruikslimiet } from "@/lib/auth/inlogpogingen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; file: string }> };

// server.js:388-391: één slide aanpassen (SSE).
export const POST = route(async (request: Request, { params }: Ctx) => {
  const gebruiker = await requireUser();
  // Dure AI-aanroep: hooguit 30 per uur per persoon.
  if (!binnenGebruikslimiet(`ai-social:${gebruiker.id}`, 30)) {
    return jsonError(429, "Je hebt het afgelopen uur veel posts laten maken of aanpassen. Probeer het straks opnieuw.");
  }
  const { id, file } = await params;
  checkFile(file);
  return runGeneration(request, { projectId: id, mode: "revise-one", targetFile: file });
});
