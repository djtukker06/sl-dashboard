import { NextResponse, type NextRequest } from 'next/server';
import { controleerRoute } from '@/lib/auth/team';
import { clientId, clientSecret, ontbrekendeEnv, sleutel, versleutelToken } from '@/lib/drive/config';
import { DriveClient, DriveFout, heeftDriveScope, ROOT_NAAM, VASTE_MAPPEN, wisselCode } from '@/lib/drive/kern';
import { onthoudToken, vergeetToken } from '@/lib/drive/koppeling';
import { vergeetMappen } from '@/lib/drive/mappen';
import { controleerState, STATE_COOKIE, stateGeheim } from '@/lib/drive/state';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logAudit } from '@/lib/audit';
import { logFout } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/drive/callback?code=…&state=…  — Google stuurt de eigenaar hierheen terug.
//   1. teamlid én eigenaar (dezelfde centrale controle als elke route);
//   2. state = de nonce uit de ondertekende cookie van DEZE gebruiker, niet verlopen;
//   3. code inwisselen (met precies dezelfde redirect-URI), scope controleren;
//   4. e-mailadres van het Google-account en de rootmap "Studio Levant" (zoeken of maken),
//      met de vaste mappen Boekhouding, Klanten en Algemeen;
//   5. refresh token versleuteld opslaan (drive_koppeling, alleen service-role).
// Altijd terug naar /bestanden met ?drive=<uitkomst>; nooit tokens in de URL of logs.
export async function GET(request: NextRequest) {
  const terug = (code: string) => {
    const res = NextResponse.redirect(new URL(`/bestanden?drive=${code}`, request.url));
    res.cookies.set(STATE_COOKIE, '', { path: '/api/drive/callback', maxAge: 0 });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  const c = await controleerRoute(request);
  if ('antwoord' in c) {
    if (c.antwoord.status === 401) return NextResponse.redirect(new URL('/login?next=/bestanden', request.url));
    if (c.antwoord.status === 403) return NextResponse.redirect(new URL('/geen-toegang', request.url));
    return terug('fout');
  }
  const lid = c.lid;
  if (lid.rol !== 'eigenaar') return terug('geen_eigenaar');

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
    if (t.scope && !heeftDriveScope(t.scope)) return terug('scope');

    const client = new DriveClient(fetch, async () => t.accessToken);
    const over = await client.over();
    const root = await client.zorgVoorMap('root', ROOT_NAAM);
    // De vaste mappen meteen klaarzetten (best effort; anders bij eerste gebruik).
    for (const naam of VASTE_MAPPEN) {
      try {
        await client.zorgVoorMap(root.id, naam);
      } catch {
        /* later opnieuw */
      }
    }

    const enc = versleutelToken(t.refreshToken);
    const service = createServiceRoleClient(lid.bewijs);
    const { error } = await service.from('drive_koppeling').upsert(
      {
        id: 1,
        google_email: (over.user?.emailAddress ?? '').slice(0, 320),
        refresh_token_enc: enc,
        root_id: root.id,
        scope: t.scope.slice(0, 1000),
        gekoppeld_door: lid.userId,
        gekoppeld_op: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
    if (error) {
      if (tabelOntbreekt(error)) return terug('tabel_ontbreekt');
      console.error('[drive] koppeling opslaan', error.code ?? '');
      return terug('fout');
    }
    vergeetToken();
    vergeetMappen();
    onthoudToken(enc, t.accessToken, t.verlooptOver);
    await logAudit('drive_gekoppeld', { lid }, request);
    return terug('gekoppeld');
  } catch (e) {
    if (e instanceof DriveFout) {
      if (e.code === 'opnieuw_koppelen') return terug('ongeldig');
      if (e.code === 'niet_ingericht') return terug('client');
    }
    logFout('[drive] koppelen mislukt', e);
    return terug('fout');
  }
}
