import { afspraakAlsInvoer, parseAfspraak, parsePersonen } from '@/lib/agenda/invoer';
import { dagenTussen, inAmsterdam, isDag, plusDagen } from '@/lib/agenda/datum';
import { isHerhaling, splitsAfspraakId, voorkomenId } from '@/lib/agenda/herhaling';
import {
  afspraakOphalen,
  afspraakRij,
  afspraakUitRij,
  AgendaFout,
  controleerTeamleden,
  dbFout,
  GEEN_RECHT,
  herhaalKolomOntbreekt,
  magAfspraakWijzigen,
  schrijfAfspraak,
  zetPersonen
} from '@/lib/agenda/repo';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// [id] is de rij-id, of bij een herhalende afspraak een voorkomen: "<rij-id>~YYYY-MM-DD"
// (de oorspronkelijke datum van dat voorkomen, zie lib/agenda/herhaling.ts).

// GET /api/afspraken/[id] → { event }
export async function GET(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!splitsAfspraakId(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    const afspraak = await afspraakOphalen(s.bron, id);
    if (!afspraak) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: afspraak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

/** Datums sorteren en ontdubbelen (voor herhaal_uitzonderingen). */
function datumSet(d: string[]): string[] {
  return [...new Set(d.filter(isDag))].sort();
}

// PATCH /api/afspraken/[id]  (velden als bij POST, allemaal optioneel; deelnemers vervangt de set)
// → { event }. Alleen de maker of een deelnemer (anders 403).
// Bij een voorkomen van een reeks: toepassen 'reeks' (standaard) wijzigt de hele reeks (een
// andere datum verschuift de reeks evenveel); 'deze' maakt van dit voorkomen een losse
// afspraak (herhaal_van = de reeks) en zet de datum bij de uitzonderingen van de reeks.
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const { bron } = s;

  const { id } = await ctx.params;
  const delen = splitsAfspraakId(id);
  if (!delen) return fout(404, 'Afspraak niet gevonden.');
  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const { toepassen, ...invoer } = body;

  try {
    const { rij } = await afspraakRij(bron, delen.id);
    if (!rij) return fout(404, 'Afspraak niet gevonden.');
    if (!(await magAfspraakWijzigen(bron, delen.id))) return fout(403, GEEN_RECHT, 'geen_recht');
    const reeks = isHerhaling(rij.herhaling);

    let personen: string[] | null = null;
    if ('deelnemers' in invoer) {
      const r = parsePersonen(invoer.deelnemers, 'deelnemer');
      if (!r.ok) return fout(400, r.fout);
      const teamFout = await controleerTeamleden(bron, r.waarde);
      if (teamFout) return fout(400, teamFout);
      personen = bron.team ? r.waarde : null;
    }

    // ---------- alleen dit voorkomen ----------
    if (reeks && delen.voorkomen && toepassen === 'deze') {
      const occ = afspraakUitRij(rij, delen.voorkomen);
      if (!occ) return fout(404, 'Dit voorkomen bestaat niet (meer).');
      // Een los voorkomen herhaalt zelf niet.
      const los: AfspraakInvoer = { ...invoer };
      delete los.herhaling;
      delete los.herhaalTot;
      const p = parseAfspraak(los, afspraakAlsInvoer({ starts_at: occ.start, ends_at: occ.eind, all_day: occ.heleDag }));
      if (!p.ok) return fout(400, p.fout);
      const nieuweRij = {
        title: rij.title,
        notes: rij.notes ?? '',
        location: rij.location ?? '',
        client_id: rij.client_id,
        all_day: occ.heleDag,
        starts_at: occ.start,
        ends_at: occ.eind,
        ...p.waarde,
        herhaal_van: rij.id
      };
      const data = await schrijfAfspraak(nieuweRij, (r) => s.sb.from('calendar_events').insert(r).select('id').single());
      if (!data) throw new AgendaFout(500, 'De afspraak kon niet worden opgeslagen.');
      const nieuwId = (data as { id: string }).id;
      try {
        if (bron.team) await zetPersonen(bron, 'afspraak', nieuwId, personen ?? occ.deelnemers);
        const { error } = await s.sb
          .from('calendar_events')
          .update({ herhaal_uitzonderingen: datumSet([...(rij.herhaal_uitzonderingen ?? []), delen.voorkomen]) })
          .eq('id', rij.id);
        if (error) throw dbFout(error);
      } catch (e) {
        // Geen dubbel voorkomen achterlaten.
        await s.sb.from('calendar_events').delete().eq('id', nieuwId);
        throw e;
      }
      const afspraak = await afspraakOphalen(bron, nieuwId);
      if (!afspraak) return fout(404, 'Afspraak niet gevonden.');
      return json({ event: afspraak });
    }

    // ---------- de hele reeks (of een gewone afspraak) ----------
    let b: AfspraakInvoer = invoer;
    let verschuiving = 0;
    const eerste = inAmsterdam(rij.starts_at).dag;
    if (reeks && delen.voorkomen && isDag(invoer.datum)) {
      // De datums in de body gaan over dit voorkomen: vertaal ze naar de eerste dag van de reeks.
      verschuiving = dagenTussen(delen.voorkomen, invoer.datum);
      const terug = dagenTussen(delen.voorkomen, eerste);
      b = { ...invoer, datum: plusDagen(invoer.datum, terug) };
      if (isDag(invoer.eindDatum)) b.eindDatum = plusDagen(invoer.eindDatum, terug);
    }
    const p = parseAfspraak(b, afspraakAlsInvoer(rij));
    if (!p.ok) return fout(400, p.fout);
    const wijziging: Record<string, unknown> = { ...p.waarde };
    if (reeks && verschuiving && rij.herhaal_uitzonderingen?.length) {
      // De reeks schuift op: de overgeslagen voorkomens schuiven mee.
      wijziging.herhaal_uitzonderingen = datumSet(rij.herhaal_uitzonderingen.map((d) => plusDagen(d, verschuiving)));
    }
    if ('herhaling' in p.waarde && !p.waarde.herhaling && rij.herhaal_uitzonderingen?.length) {
      wijziging.herhaal_uitzonderingen = [];
    }

    if (Object.keys(wijziging).length) {
      const data = await schrijfAfspraak(wijziging, (r) =>
        s.sb.from('calendar_events').update(r).eq('id', rij.id).select('id').maybeSingle()
      );
      if (data === null) return fout(404, 'Afspraak niet gevonden.');
    }
    if (personen) await zetPersonen(bron, 'afspraak', rij.id, personen);

    // Terug: hetzelfde voorkomen (op de nieuwe datum) als dat nog bestaat, anders het eerste.
    const terugDag = delen.voorkomen ? plusDagen(delen.voorkomen, verschuiving) : null;
    const afspraak =
      (terugDag ? await afspraakOphalen(bron, voorkomenId(rij.id, terugDag)) : null) ?? (await afspraakOphalen(bron, rij.id));
    if (!afspraak) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: afspraak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/afspraken/[id][?toepassen=deze] → { ok: true }. Alleen de maker of een deelnemer.
// Bij een voorkomen met ?toepassen=deze: alleen dat voorkomen overslaan (uitzondering);
// anders de hele reeks, met de losgemaakte voorkomens (herhaal_van) erbij.
export async function DELETE(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  const delen = splitsAfspraakId(id);
  if (!delen) return fout(404, 'Afspraak niet gevonden.');
  const alleenDeze = new URL(request.url).searchParams.get('toepassen') === 'deze';
  try {
    const { rij, herhaling: klaar } = await afspraakRij(s.bron, delen.id);
    if (!rij) return fout(404, 'Afspraak niet gevonden.');
    if (!(await magAfspraakWijzigen(s.bron, delen.id))) return fout(403, GEEN_RECHT, 'geen_recht');

    if (alleenDeze && delen.voorkomen && isHerhaling(rij.herhaling)) {
      if (!afspraakUitRij(rij, delen.voorkomen)) return fout(404, 'Dit voorkomen bestaat niet (meer).');
      const { data, error } = await s.sb
        .from('calendar_events')
        .update({ herhaal_uitzonderingen: datumSet([...(rij.herhaal_uitzonderingen ?? []), delen.voorkomen]) })
        .eq('id', rij.id)
        .select('id');
      if (error) throw dbFout(error);
      if (!data?.length) return fout(404, 'Afspraak niet gevonden.');
      return json({ ok: true });
    }

    const { data, error } = await s.sb.from('calendar_events').delete().eq('id', rij.id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Afspraak niet gevonden.');
    if (klaar && isHerhaling(rij.herhaling)) {
      // Losgemaakte voorkomens horen bij de reeks: die gaan mee (voor zover je ze mag verwijderen).
      const los = await s.sb.from('calendar_events').delete().eq('herhaal_van', rij.id);
      if (los.error && !herhaalKolomOntbreekt(los.error)) throw dbFout(los.error);
    }
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
