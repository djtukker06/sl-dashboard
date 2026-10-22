import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { fout, isUuid, json, uitgavenRoute } from '@/lib/uitgaven/api';
import { leesUitgaveUit } from '@/lib/uitgaven/uitlezen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/uitgaven/[id]/uitlezen → { uitgave }
// Leest de bestanden met Claude uit en vult alleen de lege velden. Mislukt het (geen key,
// onleesbaar, fout), dan is het antwoord gewoon 200 met aiStatus 'mislukt' en een melding.
export const POST = uitgavenRoute(async (_request, ctx: Ctx, sb) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  const uitgave = await leesUitgaveUit(sb, id, vandaagNL());
  return json({ uitgave });
});
