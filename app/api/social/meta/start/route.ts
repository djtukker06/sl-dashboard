import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/auth/site';
import { teamlidRoute } from '@/lib/auth/team';
import { maakState, STATE_GELDIG_SEC } from '@/lib/drive/state';
import { metaAppId, metaConfigId, ontbrekendeEnv, sleutel, versie } from '@/lib/social/meta/config';
import { loginUrl } from '@/lib/social/meta/kern';
import { CALLBACK_PAD, STATE_COOKIE, stateGeheim } from '@/lib/social/meta/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/social/meta/start → 303 naar de Meta-login (Facebook Login for Business).
// Zelfde CSRF-bescherming als Drive en Google Agenda (lib/drive/state.ts): een willekeurige
// nonce als state, en dezelfde nonce met user-id, redirect-URI en verlooptijd in een
// ondertekende httpOnly-cookie die alleen naar de callback gaat. Redirect-URI: exact
// `${siteUrl}/api/social/meta/callback` (zie README "Social: koppelen met Meta").
export const GET = teamlidRoute(async (request, _ctx, lid) => {
  const terug = (code: string) => NextResponse.redirect(new URL(`/social/koppelingen?fout=${code}`, request.url), 303);
  const k = sleutel();
  if (ontbrekendeEnv().length || !k) return terug('niet_ingericht');

  const basis = siteUrl(new URL(request.url).origin);
  if (!basis) return terug('site_url');
  const redirectUri = `${basis}${CALLBACK_PAD}`;

  const { state, cookie } = maakState(stateGeheim(k), lid.userId, redirectUri);
  const res = NextResponse.redirect(loginUrl({ versie: versie(), appId: metaAppId(), redirectUri, state, configId: metaConfigId() }), 303);
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: CALLBACK_PAD,
    maxAge: STATE_GELDIG_SEC
  });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}, { label: 'social-meta-start' });
