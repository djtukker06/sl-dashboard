import { NextResponse, type NextRequest } from 'next/server';
import { controleerRoute } from '@/lib/auth/team';
import { controleerState } from '@/lib/drive/state';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { KoppelFout, slaKoppelingenOp } from '@/lib/social/koppeling';
import { ontbrekendeEnv, sleutel } from '@/lib/social/meta/config';
import { MetaFout, MINIMALE_SCOPES, verlooptOp } from '@/lib/social/meta/kern';
import { debugToken, haalPaginas, langlevend, toegekendeScopes, wisselCode } from '@/lib/social/meta/oauth';
import { CALLBACK_PAD, STATE_COOKIE, stateGeheim } from '@/lib/social/meta/state';
import { logAudit } from '@/lib/audit';
import { logFout, logWaarschuwing } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/social/meta/callback?code=…&state=…  — Meta stuurt je hierheen terug.
//   1. teamlid (dezelfde centrale controle als elke route);
//   2. state = de nonce uit de ondertekende cookie van DEZE gebruiker, niet verlopen;
//   3. code → kortlevend → langlevend user token (met precies dezelfde redirect-URI);
//   4. de toegekende permissies controleren;
//   5. de pagina's (met hun page token) en de Instagram-accounts eraan ophalen en versleuteld
//      opslaan (lib/social/koppeling.ts). Het user token zelf wordt niet bewaard.
// Altijd terug naar /social/koppelingen met ?gekoppeld=<aantal> of ?fout=<code>; nooit tokens
// in de URL of in logs.
export async function GET(request: NextRequest) {
  const terug = (param: string) => {
    const res = NextResponse.redirect(new URL(`/social/koppelingen?${param}`, request.url));
    res.cookies.set(STATE_COOKIE, '', { path: CALLBACK_PAD, maxAge: 0 });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };
  const fout = (code: string) => terug(`fout=${code}`);

  const c = await controleerRoute(request);
  if ('antwoord' in c) {
    if (c.antwoord.status === 401) return NextResponse.redirect(new URL('/login?next=/social/koppelingen', request.url));
    if (c.antwoord.status === 403) return NextResponse.redirect(new URL('/geen-toegang', request.url));
    return fout('fout');
  }
  const lid = c.lid;

  const k = sleutel();
  if (ontbrekendeEnv().length || !k) return fout('niet_ingericht');

  const p = request.nextUrl.searchParams;
  if (p.get('error')) return fout(p.get('error') === 'access_denied' ? 'geweigerd' : 'fout');
  const st = controleerState(stateGeheim(k), request.cookies.get(STATE_COOKIE)?.value, p.get('state'), lid.userId);
  if (!st.ok) return fout('ongeldig');
  const code = p.get('code');
  if (!code || code.length > 2000) return fout('ongeldig');

  try {
    const kort = await wisselCode(code, st.redirectUri);
    const lang = await langlevend(kort.access_token);
    const userToken = lang.access_token || kort.access_token;

    const scopes = await toegekendeScopes(userToken).catch(() => [] as string[]);
    if (scopes.length && MINIMALE_SCOPES.some((s) => !scopes.includes(s))) return fout('scope');

    const paginas = await haalPaginas(userToken);
    if (!paginas.length) return fout('geen_paginas');

    // Wanneer de toegang verloopt (page tokens: nooit; de "data access" na 90 dagen).
    let verloopt: Date | null = null;
    const eerste = paginas.find((x) => x.access_token)?.access_token;
    if (eerste) {
      try {
        verloopt = verlooptOp(await debugToken(eerste));
      } catch (e) {
        logWaarschuwing('[social] tokeninfo na koppelen', e instanceof MetaFout ? e.detail : e);
      }
    }

    const r = await slaKoppelingenOp(createServiceRoleClient(lid.bewijs), { paginas, userId: lid.userId, scopes, verlooptOp: verloopt });
    const aantal = r.facebook + r.instagram;
    if (!aantal) return fout('geen_rechten');
    await logAudit('social_gekoppeld', { lid, details: { aantal, soort: `facebook:${r.facebook},instagram:${r.instagram}` } }, request);
    return terug(`gekoppeld=${aantal}`);
  } catch (e) {
    if (e instanceof KoppelFout) return fout(e.code === 'tabel_ontbreekt' ? 'tabel_ontbreekt' : e.code === 'niet_ingericht' ? 'niet_ingericht' : 'fout');
    if (e instanceof MetaFout) {
      logWaarschuwing('[social] koppelen', e.detail);
      if (e.soort === 'opnieuw_koppelen' || e.soort === 'ongeldig') return fout('ongeldig');
      if (e.soort === 'geen_rechten') return fout('geen_rechten');
      return fout('meta');
    }
    logFout('[social] koppelen mislukt', e);
    return fout('fout');
  }
}
