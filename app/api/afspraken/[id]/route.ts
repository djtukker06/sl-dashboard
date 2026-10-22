import { afspraakAlsInvoer, isUuid, parseAfspraak, parsePersonen } from '@/lib/agenda/invoer';
import {
  afspraakOphalen,
  controleerTeamleden,
  dbFout,
  GEEN_RECHT,
  magAfspraakWijzigen,
  zetPersonen
} from '@/lib/agenda/repo';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/afspraken/[id] → { event }
export async function GET(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    const afspraak = await afspraakOphalen(s.bron, id);
    if (!afspraak) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: afspraak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// PATCH /api/afspraken/[id]  (velden als bij POST, allemaal optioneel; deelnemers vervangt de set)
// → { event }. Alleen de maker of een deelnemer (anders 403).
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const { bron } = s;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');

  try {
    const huidig = await s.sb.from('calendar_events').select('starts_at,ends_at,all_day').eq('id', id).maybeSingle();
    if (huidig.error) throw dbFout(huidig.error);
    if (!huidig.data) return fout(404, 'Afspraak niet gevonden.');
    if (!(await magAfspraakWijzigen(bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');

    const p = parseAfspraak(body, afspraakAlsInvoer(huidig.data));
    if (!p.ok) return fout(400, p.fout);

    let personen: string[] | null = null;
    if ('deelnemers' in body) {
      const r = parsePersonen(body.deelnemers, 'deelnemer');
      if (!r.ok) return fout(400, r.fout);
      const teamFout = await controleerTeamleden(bron, r.waarde);
      if (teamFout) return fout(400, teamFout);
      personen = bron.team ? r.waarde : null;
    }

    if (Object.keys(p.waarde).length) {
      const { data, error } = await s.sb.from('calendar_events').update(p.waarde).eq('id', id).select('id').maybeSingle();
      if (error) throw dbFout(error);
      if (!data) return fout(404, 'Afspraak niet gevonden.');
    }
    if (personen) await zetPersonen(bron, 'afspraak', id, personen);

    const afspraak = await afspraakOphalen(bron, id);
    if (!afspraak) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: afspraak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/afspraken/[id] → { ok: true }. Alleen de maker of een deelnemer.
export async function DELETE(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    const bestaat = await s.sb.from('calendar_events').select('id').eq('id', id).maybeSingle();
    if (bestaat.error) throw dbFout(bestaat.error);
    if (!bestaat.data) return fout(404, 'Afspraak niet gevonden.');
    if (!(await magAfspraakWijzigen(s.bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');

    const { data, error } = await s.sb.from('calendar_events').delete().eq('id', id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Afspraak niet gevonden.');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
