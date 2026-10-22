import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { valideerProfiel } from '@/lib/account/types';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });

// PATCH /api/account/profiel  { naam, initialen, kleur } → { profiel }
// Met de gebruikerscliënt: RLS (0021) laat alleen je eigen profiel en alleen deze drie
// kolommen wijzigen. Rol en lidmaatschap staan in team_members en zijn hier niet te raken.
export const PATCH = teamlidRoute(
  async (request, _ctx, lid) => {
    if (lid.overgang) {
      return json({ error: 'Je profiel aanpassen kan pas als de teambeveiliging actief is (migratie 0021).' }, 409);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const v = valideerProfiel(body);
    if (!v.ok) return json({ error: v.fout }, 400);

    const { data, error } = await lid.sb
      .from('profiles')
      .update(v.waarde)
      .eq('id', lid.userId)
      .select('naam, initialen, kleur')
      .maybeSingle();
    if (error) {
      if (tabelOntbreekt(error)) return json({ error: 'Profielen bestaan nog niet: voer migratie 0021 uit.' }, 409);
      console.error('[account] profiel opslaan mislukt', error.code ?? '', error.message);
      return json({ error: 'Opslaan is niet gelukt. Probeer het opnieuw.' }, 500);
    }
    if (!data) return json({ error: 'Je profiel is niet gevonden. Vraag de eigenaar je opnieuw toe te voegen.' }, 404);
    return json({ profiel: data });
  },
  { label: 'account/profiel' }
);
