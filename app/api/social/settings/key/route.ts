import { requireUser, route, jsonError } from "@/lib/social/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vervangt server.js:105-114. Online kan de key niet vanuit de app in een .env-bestand
// worden gezet; hij staat als omgevingsvariabele in Vercel.
export const POST = route(async () => {
  await requireUser();
  return jsonError(400, "De API-key wordt beheerd via de serveromgeving (Vercel env var ANTHROPIC_API_KEY).");
});
