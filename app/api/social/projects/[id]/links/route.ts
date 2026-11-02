import { NextResponse } from "next/server";
import { jsonError, readBody, requireUser, route } from "@/lib/social/http";
import { haalLinkOp, nogOpTeHalen, verwerkResultaten } from "@/lib/social/links";
import { MAX_LINKS } from "@/lib/social/links-kern";
import { getProject, saveProject } from "@/lib/social/repo";
import { binnenGebruikslimiet } from "@/lib/auth/inlogpogingen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pagina (max 12 s) + beelden (max 3 rondes van 10 s) per link; links lopen parallel.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Haalt de links van een project op (lib/social/links.ts): titel, beschrijving, tekst en
 * foto's. Body: `{ urls?: string[] }`; zonder urls alle links die nog niet zijn
 * opgehaald, met urls precies die (opnieuw ophalen). Een link die mislukt breekt de rest
 * niet: hij krijgt status "fout" met een melding. Respons: het bijgewerkte project.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const gebruiker = await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  const { urls } = await readBody(request);
  const gevraagd = Array.isArray(urls)
    ? [...new Set(urls.map(String))].filter((u) => p.links.includes(u)).slice(0, MAX_LINKS)
    : nogOpTeHalen(p);
  if (!gevraagd.length) return NextResponse.json(p);
  // Elke aanroep doet tientallen uitgaande verzoeken: hooguit 60 keer per uur per persoon.
  if (!binnenGebruikslimiet(`social-links:${gebruiker.id}`, 60)) {
    return jsonError(429, "Je hebt het afgelopen uur veel links laten ophalen. Probeer het straks opnieuw.");
  }
  const resultaten = await Promise.all(gevraagd.map((u) => haalLinkOp(p.id, u, request.signal)));
  // Het ophalen duurt even; ondertussen kan de briefing zijn opgeslagen. Dus vers lezen.
  const vers = await getProject(id);
  verwerkResultaten(vers, resultaten);
  return NextResponse.json(await saveProject(vers));
});
