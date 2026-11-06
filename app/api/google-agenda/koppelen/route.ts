import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/auth/site';
import { teamlidRoute } from '@/lib/auth/team';
import { clientId, ontbrekendeEnv, sleutel } from '@/lib/drive/config';
import { maakState, STATE_GELDIG_SEC } from '@/lib/drive/state';
import { autorisatieUrl } from '@/lib/google-agenda/kern';
import { STATE_COOKIE, stateGeheim } from '@/lib/google-agenda/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/google-agenda/koppelen (formulier, elk teamlid voor zichzelf) → 303 naar Google.
// Zelfde CSRF-bescherming als Drive (lib/drive/state.ts): een willekeurige nonce als state,
// en dezelfde nonce met user-id, redirect-URI en verlooptijd in een ondertekende
// httpOnly-cookie die alleen naar de callback gaat. Redirect-URI: exact
// `${siteUrl}/api/google-agenda/callback` (zie README "Google Agenda").
export const POST = teamlidRoute(async (request, _ctx, lid) => {
  const terug = (code: string) => NextResponse.redirect(new URL(`/agenda?google=${code}`, request.url), 303);
  const k = sleutel();
  if (ontbrekendeEnv().length || !k) return terug('niet_ingericht');

  const basis = siteUrl(request.headers.get('origin') ?? new URL(request.url).origin);
  if (!basis) return terug('site_url');
  const redirectUri = `${basis}/api/google-agenda/callback`;

  const { state, cookie } = maakState(stateGeheim(k), lid.userId, redirectUri);
  const res = NextResponse.redirect(autorisatieUrl({ clientId: clientId(), redirectUri, state }), 303);
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: '/api/google-agenda/callback',
    maxAge: STATE_GELDIG_SEC
  });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}, { label: 'google-agenda-koppelen' });
