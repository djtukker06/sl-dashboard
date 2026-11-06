import { NextResponse, type NextRequest } from 'next/server';
import { controleerRoute } from '@/lib/auth/team';
import { clientId, clientSecret, ontbrekendeEnv, sleutel } from '@/lib/drive/config';
import { DriveFout, wisselCode } from '@/lib/drive/kern';
import { controleerState } from '@/lib/drive/state';
import { heeftScopes, USERINFO_URL } from '@/lib/google-agenda/kern';
import { GoogleAgendaFout, feedInGoogle, onthoudToken, synchroniseerLijst, versleutelToken, type AccountRij } from '@/lib/google-agenda/koppeling';
import { STATE_COOKIE, stateGeheim } from '@/lib/google-agenda/state';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logAudit } from '@/lib/audit';
import { logFout } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/google-agenda/callback?code=…&state=…  — Google stuurt je hierheen terug.
//   1. teamlid (dezelfde centrale controle als elke route);
//   2. state = de nonce uit de ondertekende cookie van DEZE gebruiker, niet verlopen;
//   3. code inwisselen (met precies dezelfde redirect-URI), scopes controleren;
//   4. het e-mailadres van het Google-account (userinfo);
//   5. refresh token versleuteld opslaan (per gebruiker + e-mailadres: opnieuw koppelen van
//      hetzelfde account vervangt het token) en de agendalijst ophalen.
// Altijd terug naar /agenda met ?google=<uitkomst>; nooit tokens in de URL of logs.
export async function GET(request: NextRequest) {
  const terug = (code: string) => {
    const res = NextResponse.redirect(new URL(`/agenda?google=${code}`, request.url));
    res.cookies.set(STATE_COOKIE, '', { path: '/api/google-agenda/callback', maxAge: 0 });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  const c = await controleerRoute(request);
  if ('antwoord' in c) {
    if (c.antwoord.status === 401) return NextResponse.redirect(new URL('/login?next=/agenda', request.url));
    if (c.antwoord.status === 403) return NextResponse.redirect(new URL('/geen-toegang', request.url));
    return terug('fout');
  }
  const lid = c.lid;

  const k = sleutel();
  if (ontbrekendeEnv().length || !k) return terug('niet_ingericht');

  const p = request.nextUrl.searchParams;
  if (p.get('error')) return terug(p.get('error') === 'access_denied' ? 'geweigerd' : 'fout');
  const st = controleerState(stateGeheim(k), request.cookies.get(STATE_COOKIE)?.value, p.get('state'), lid.userId);
  if (!st.ok) return terug('ongeldig');
  const code = p.get('code');
  if (!code || code.length > 2000) return terug('ongeldig');

  try {
    const t = await wisselCode(fetch, { clientId: clientId(), clientSecret: clientSecret(), code, redirectUri: st.redirectUri });
    if (!t.refreshToken) return terug('geen_refresh');
    if (t.scope && !heeftScopes(t.scope)) return terug('scope');

    const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${t.accessToken}` }, cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ email?: string }>) : null))
      .catch(() => null);
    const email = String(info?.email ?? '').toLowerCase().slice(0, 320);
    if (!email) return terug('scope');

    const enc = versleutelToken(t.refreshToken);
    const service = createServiceRoleClient(lid.bewijs);
    const { data, error } = await service
      .from('google_agenda_accounts')
      .upsert(
        {
          user_id: lid.userId,
          google_email: email,
          refresh_token_enc: enc,
          scope: t.scope.slice(0, 1000),
          gekoppeld_op: new Date().toISOString(),
          fout: null
        },
        { onConflict: 'user_id,google_email' }
      )
      .select('id,user_id,google_email,refresh_token_enc,fout,lijst_bijgewerkt_op')
      .single();
    if (error) {
      if (tabelOntbreekt(error)) return terug('tabel_ontbreekt');
      console.error('[google-agenda] koppeling opslaan', error.code ?? '');
      return terug('fout');
    }
    onthoudToken(enc, t.accessToken, t.verlooptOver);
    await logAudit('google_agenda_gekoppeld', { lid, details: { account: email } }, request);
    try {
      await synchroniseerLijst({ account: data as AccountRij, service }, { feedInGoogle: await feedInGoogle(service, lid.userId) });
    } catch (e) {
      if (e instanceof GoogleAgendaFout && e.code === 'api_uit') return terug('api_uit');
      logFout('[google-agenda] agendalijst na koppelen', e);
      return terug('fout');
    }
    return terug('gekoppeld');
  } catch (e) {
    if (e instanceof DriveFout) {
      if (e.code === 'opnieuw_koppelen') return terug('ongeldig');
      if (e.code === 'niet_ingericht') return terug('niet_ingericht');
    }
    logFout('[google-agenda] koppelen mislukt', e);
    return terug('fout');
  }
}
