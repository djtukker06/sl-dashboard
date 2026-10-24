import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { fout, isUuid, json, uitgavenRoute } from '@/lib/uitgaven/api';
import { leesUitgaveUit } from '@/lib/uitgaven/uitlezen';
import { naDriveUitgave } from '@/lib/drive/kopieen';
import { binnenGebruikslimiet } from '@/lib/auth/inlogpogingen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// HEIC omzetten + Sonnet + zo nodig een tweede poging met Opus.
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/uitgaven/[id]/uitlezen → { uitgave }
// Leest de bestanden met Claude uit en vult alleen de lege velden. Mislukt het (geen key,
// onleesbaar, fout), dan is het antwoord gewoon 200 met aiStatus 'mislukt' en een melding.
// Daarna (na het antwoord, best effort) de kopie naar Drive met datum/leverancier/bedrag in de naam.
export const POST = uitgavenRoute(async (_request, ctx: Ctx, sb, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  // Dure AI-aanroep: hooguit 60 per uur per persoon.
  if (!binnenGebruikslimiet(`ai-bon:${lid.userId}`, 60)) return fout(429, 'Je hebt het afgelopen uur veel bonnetjes laten uitlezen. Probeer het straks opnieuw.');
  const uitgave = await leesUitgaveUit(sb, id, vandaagNL());
  naDriveUitgave(lid, id);
  return json({ uitgave });
});
