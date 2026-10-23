import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/auth/site';
import { driveRoute } from '@/lib/drive/api';
import { clientId, ontbrekendeEnv, sleutel } from '@/lib/drive/config';
import { autorisatieUrl } from '@/lib/drive/kern';
import { maakState, STATE_COOKIE, STATE_GELDIG_SEC, stateGeheim } from '@/lib/drive/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/drive/koppelen (formulier, alleen de eigenaar) → 303 naar Google.
// De state is een willekeurige nonce; dezelfde nonce zit (met user-id, redirect-URI en
// verlooptijd) in een ondertekende httpOnly-cookie die alleen naar de callback gaat
// (lib/drive/state.ts). Redirect-URI: exact `${siteUrl}/api/drive/callback`.
export const POST = driveRoute(
  async (request, _ctx, lid) => {
    const mist = ontbrekendeEnv();
    const k = sleutel();
    // Een formulier: fouten als melding terug op /bestanden (geen kale JSON in de browser).
    const terug = (code: string) => NextResponse.redirect(new URL(`/bestanden?drive=${code}`, request.url), 303);
    if (mist.length || !k) return terug('niet_ingericht');

    const basis = siteUrl(request.headers.get('origin') ?? new URL(request.url).origin);
    if (!basis) return terug('site_url');
    const redirectUri = `${basis}/api/drive/callback`;

    const { state, cookie } = maakState(stateGeheim(k), lid.userId, redirectUri);
    const res = NextResponse.redirect(autorisatieUrl({ clientId: clientId(), redirectUri, state }), 303);
    res.cookies.set(STATE_COOKIE, cookie, {
      httpOnly: true,
      // lax: de cookie gaat mee met de top-level terugkeer van Google (GET), niet met
      // verzoeken van andere sites op de achtergrond.
      sameSite: 'lax',
      secure: redirectUri.startsWith('https://'),
      path: '/api/drive/callback',
      maxAge: STATE_GELDIG_SEC
    });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  },
  { alleenEigenaar: true }
);
