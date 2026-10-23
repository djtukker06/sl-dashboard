import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });

// POST /api/account/welkom → { klaar: true }
// Markeert de welkomstflow (/welkom) als doorlopen: profiles.welkom_klaar_op = now(), alleen
// voor je EIGEN profiel. Met de gebruikerscliënt: RLS (0021, "eigen profiel aanpassen") en de
// kolom-grant uit 0022 laten niets anders toe. Zonder kolom (0022 nog niet uitgevoerd) is er
// niets te doen: de app slaat de flow dan toch al over.
export const POST = teamlidRoute(
  async (_request, _ctx, lid) => {
    if (lid.overgang) return json({ klaar: true });
    const { error } = await lid.sb
      .from('profiles')
      .update({ welkom_klaar_op: new Date().toISOString() })
      .eq('id', lid.userId)
      .is('welkom_klaar_op', null);
    if (error) {
      // 42703 / PGRST204: kolom bestaat (nog) niet.
      if (error.code === '42703' || error.code === 'PGRST204') return json({ klaar: true });
      console.error('[account] welkom afronden mislukt', error.code ?? '', error.message);
      return json({ error: 'Opslaan is niet gelukt. Probeer het opnieuw.' }, 500);
    }
    return json({ klaar: true });
  },
  { label: 'account/welkom' }
);
