import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { controleerLid } from '@/lib/auth/lidcheck';
import { veiligVervolg } from '@/lib/vervolg';

// In Next.js 16 heet dit bestand "proxy.ts" (was "middleware.ts"). Eerste linie van de
// toegangscontrole (elke pagina, server action en API-route controleert daarnaast zelf,
// via lib/auth/team.ts):
//   1. ververst de Supabase-sessie op elk request;
//   2. geen sessie: API's en bestanden krijgen een 401 (JSON), pagina's gaan naar /login;
//   3. wel een sessie maar geen actief teamlid (migratie 0021): uitloggen, pagina's naar
//      /geen-toegang, API's een 403 (JSON). Zo komt een account dat zich ondanks alles
//      heeft kunnen registreren nergens bij.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  // Een eigen antwoord (redirect/JSON) moet de cookies van supabaseResponse meekrijgen,
  // anders gaan een verversing of het uitloggen verloren.
  const metCookies = (res: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  const { data: { user } } = await supabase.auth.getUser();

  const pad = request.nextUrl.pathname;
  const isLoginPath = pad === '/login' || pad.startsWith('/login/');
  // fetch()-clients (alle API's, social-bestanden) krijgen JSON i.p.v. een HTML-redirect.
  const isApi = pad.startsWith('/api/') || pad === '/api' || pad.startsWith('/social-files/');
  // Wachtwoord herstellen moet zonder sessie kunnen; /nieuw-wachtwoord niet (die
  // vereist de sessie die /auth/callback opent). /auth/uitloggen en /auth/callback
  // handelen zelf af. /geen-toegang toont alleen tekst.
  const isPubliekPad =
    isLoginPath ||
    pad === '/wachtwoord-vergeten' ||
    pad === '/auth/callback' ||
    pad === '/auth/uitloggen' ||
    pad === '/geen-toegang';

  if (!user && !isPubliekPad) {
    if (isApi) {
      return metCookies(NextResponse.json({ error: 'Niet ingelogd.', code: 'niet_ingelogd' }, { status: 401 }));
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Na het inloggen terug naar waar je was (bv. een bladwijzer naar /social).
    // De hash (#p=…) neemt de loginpagina zelf mee (components/VervolgVeld.tsx).
    // Alleen voor pagina's (niet voor losse bestanden zoals /social/app.js).
    if (veiligVervolg(pad) !== '/' && !/\.[a-z0-9]+$/i.test(pad)) {
      url.searchParams.set('next', pad + request.nextUrl.search);
    }
    return metCookies(NextResponse.redirect(url));
  }

  // Wel ingelogd: is dit een actief teamlid? (/auth/* controleert zelf.)
  if (user && pad !== '/auth/uitloggen' && pad !== '/auth/callback') {
    const lid = await controleerLid(supabase);

    if (lid === 'geen') {
      await supabase.auth.signOut();
      if (isApi) {
        return metCookies(NextResponse.json({ error: 'Geen toegang.', code: 'geen_toegang' }, { status: 403 }));
      }
      if (pad === '/geen-toegang') return metCookies(supabaseResponse);
      return metCookies(NextResponse.redirect(new URL('/geen-toegang', request.url)));
    }

    if (lid === 'storing') {
      // Fail closed, maar niet uitloggen: de database is (even) niet bereikbaar.
      if (isApi) {
        return metCookies(
          NextResponse.json(
            { error: 'De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.', code: 'storing' },
            { status: 503 }
          )
        );
      }
      // Pagina's controleren zelf nog eens (lib/auth/team.ts) en tonen dan een foutmelding.
      return supabaseResponse;
    }

    // Een teamlid hoeft niet op /geen-toegang of /login te blijven.
    if (pad === '/geen-toegang') return metCookies(NextResponse.redirect(new URL('/', request.url)));
  }

  if (user && isLoginPath) {
    return metCookies(
      NextResponse.redirect(new URL(veiligVervolg(request.nextUrl.searchParams.get('next')), request.url))
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Alleen echte statische, openbare bestanden slaan de proxy over: shell/ (shell.css,
    // shell.js), brand/ (logo's), het app-icoon en Next' eigen bestanden. GEEN algemene
    // uitzondering op .png/.jpg/…: dan zouden dynamische routes die zo eindigen
    // (bv. /social-files/…/foto.png) zonder controle en sessieverversing blijven.
    '/((?!_next/static|_next/image|favicon\\.ico$|icon\\.png$|shell/|brand/).*)'
  ]
};
