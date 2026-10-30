import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { toegangStatus } from '@/lib/auth/lidcheck';
import { veiligVervolg } from '@/lib/vervolg';
import { bouwCsp, maakNonce } from '@/lib/auth/csp-kern';
import { sessieGeheim } from '@/lib/auth/sessie';
import {
  inlogMoment,
  leesSessieWaarde,
  maakSessieWaarde,
  nieuwToegestaan,
  sessieBeslissing,
  sessieSleutel,
  SESSIE_COOKIE,
  SESSIE_COOKIE_OPTIES
} from '@/lib/auth/sessie-kern';

// In Next.js 16 heet dit bestand "proxy.ts" (was "middleware.ts"). Eerste linie van de
// toegangscontrole (elke pagina, server action en API-route controleert daarnaast zelf,
// via lib/auth/team.ts):
//   1. Content-Security-Policy met een nonce per verzoek (lib/auth/csp-kern.ts); Next.js zet
//      die nonce zelf op zijn scripts (x-nonce + de CSP-kop op het verzoek);
//   2. ververst de Supabase-sessie op elk request en controleert het toegangstoken met
//      getClaims() (handtekening lokaal tegen de JWKS van Supabase; zonder asymmetrische
//      sleutel valt Supabase zelf terug op een controle bij de Auth-server);
//   3. geen sessie: API's en bestanden krijgen een 401 (JSON), pagina's gaan naar /login;
//   4. sessiebeleid (lib/auth/sessie-kern.ts): 12 uur niets gedaan of 14 dagen ingelogd →
//      uitloggen (Supabase gratis kent geen time-box of inactiviteits-timeout). Ontbreekt de
//      sessiecookie en is het inlogmoment (amr) niet recent: ook uitloggen;
//   5. wel een sessie maar geen actief teamlid (migratie 0021): uitloggen, pagina's naar
//      /geen-toegang, API's een 403 (JSON). Zo komt een account dat zich ondanks alles
//      heeft kunnen registreren nergens bij;
//   6. tweestapsverificatie (migratie 0026): wie een 2FA-factor heeft maar alleen met zijn
//      wachtwoord is ingelogd (aal1), gaat eerst naar /login/2fa. (Verplicht instellen
//      regelen de pagina's zelf, lib/auth/team.ts.)
//
// Snelheid: stap 5/6 (een database-rondgang) doen we alleen bij het openen van een pagina
// of bestand. API-routes, /social-files en de RSC-verzoeken van de router (navigeren en
// prefetchen binnen de app) slaan hem over: die doen ALTIJD zelf de volledige controle
// (teamlidRoute / route() / vereisTeamlidPagina in lib/auth/team.ts, fail closed). Een
// nagemaakte rsc-header helpt een buitenstaander dus niets: de pagina weigert hem zelf; voor
// losse bestanden (met extensie) geldt de header niet.
export async function proxy(request: NextRequest) {
  const pad = request.nextUrl.pathname;
  // fetch()-clients (alle API's, social-bestanden) krijgen JSON i.p.v. een HTML-redirect.
  const isApi = pad.startsWith('/api/') || pad === '/api' || pad.startsWith('/social-files/');

  // CSP alleen voor documenten (pagina's en /social); API's en bestanden zetten zelf een
  // strengere (bv. sandbox) of hebben er geen nodig.
  const nonce = maakNonce();
  const csp = isApi
    ? null
    : bouwCsp({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV === 'development' });

  const volgende = () => {
    if (!csp) return NextResponse.next({ request });
    const h = new Headers(request.headers);
    h.set('x-nonce', nonce);
    h.set('Content-Security-Policy', csp);
    return NextResponse.next({ request: { headers: h } });
  };

  let supabaseResponse = volgende();

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
          supabaseResponse = volgende();
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        }
      }
    }
  );

  // Een nieuwe/ververste sessiecookie (stap 4), voor elk antwoord.
  let sessieCookie: string | null = null;
  let sessieWissen = false;

  const afwerken = (res: NextResponse) => {
    if (sessieCookie) res.cookies.set(SESSIE_COOKIE, sessieCookie, SESSIE_COOKIE_OPTIES);
    if (sessieWissen) res.cookies.set(SESSIE_COOKIE, '', { ...SESSIE_COOKIE_OPTIES, maxAge: 0 });
    if (csp) res.headers.set('Content-Security-Policy', csp);
    if (pad.startsWith('/api/')) res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  // Een eigen antwoord (redirect/JSON) moet de cookies van supabaseResponse meekrijgen,
  // anders gaan een verversing of het uitloggen verloren.
  const metCookies = (res: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    res.headers.set('Cache-Control', 'private, no-store');
    return afwerken(res);
  };

  const { data: claimData } = await supabase.auth.getClaims();
  const claims = claimData?.claims ?? null;
  const user = claims?.sub ? { id: claims.sub } : null;

  const isTfaPad = pad === '/login/2fa';
  const isLoginPath = (pad === '/login' || pad.startsWith('/login/')) && !isTfaPad;
  // Wachtwoord herstellen moet zonder sessie kunnen; /nieuw-wachtwoord niet (die
  // vereist de sessie die /auth/callback opent). /auth/uitloggen en /auth/callback
  // handelen zelf af. /geen-toegang toont alleen tekst. /login/2fa stuurt zonder sessie
  // zelf door naar /login.
  // De cron-routes (Vercel Cron, GitHub Actions) hebben geen sessie; ze controleren zelf
  // CRON_SECRET (lib/auth/cron.ts, fail closed). Exact deze paden, geen voorvoegsel.
  const isCronPad = pad === '/api/cron/dagelijks' || pad === '/api/cron/bestanden';
  // Het agenda-abonnement (Apple/Google Agenda haalt het zonder sessie op); de route
  // controleert zelf het geheime token (lib/agenda/feed.ts, fail closed).
  const isAgendaFeed = /^\/api\/agenda-feed\/[A-Za-z0-9_-]{40,64}(\.ics)?$/.test(pad);
  const isPubliekPad =
    isLoginPath ||
    isTfaPad ||
    pad === '/wachtwoord-vergeten' ||
    pad === '/auth/callback' ||
    pad === '/auth/uitloggen' ||
    pad === '/geen-toegang' ||
    isCronPad ||
    isAgendaFeed;

  const naarLogin = (extra?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    // Na het inloggen terug naar waar je was (bv. een bladwijzer naar /social).
    // De hash (#p=…) neemt de loginpagina zelf mee (components/VervolgVeld.tsx).
    // Alleen voor pagina's (niet voor losse bestanden zoals /social/app.js).
    if (veiligVervolg(pad) !== '/' && !/\.[a-z0-9]+$/i.test(pad)) {
      url.searchParams.set('next', pad + request.nextUrl.search);
    }
    return url;
  };

  if (!user && !isPubliekPad) {
    if (isApi) {
      return metCookies(NextResponse.json({ error: 'Niet ingelogd.', code: 'niet_ingelogd' }, { status: 401 }));
    }
    return metCookies(NextResponse.redirect(naarLogin()));
  }

  // Sessiebeleid (stap 4). Ontbreekt de cookie of klopt hij niet: alleen een nieuwe zetten
  // als het echte inlogmoment (amr in het token) van de laatste minuten is; anders uitloggen.
  // (Inloggen, /auth/callback en de 2FA-stap zetten de cookie al zelf.)
  const geheim = user ? sessieGeheim() : null;
  if (user && geheim && pad !== '/auth/uitloggen') {
    try {
      const sleutel = await sessieSleutel(geheim);
      const nu = Date.now();
      const t = await leesSessieWaarde(sleutel, request.cookies.get(SESSIE_COOKIE)?.value);
      const b = sessieBeslissing(t, nu);
      const authMs = b.soort === 'nieuw' ? inlogMoment(claims) : 0;
      if (b.soort === 'verlopen' || (b.soort === 'nieuw' && !nieuwToegestaan(authMs, nu))) {
        // Alleen deze sessie (dit apparaat) beëindigen, niet alle apparaten.
        await supabase.auth.signOut({ scope: 'local' });
        sessieWissen = true;
        if (isApi) {
          return metCookies(
            NextResponse.json({ error: 'Je sessie is verlopen. Log opnieuw in.', code: 'niet_ingelogd', reden: 'sessie_verlopen' }, { status: 401 })
          );
        }
        return metCookies(NextResponse.redirect(naarLogin({ reden: 'verlopen' })));
      }
      if (b.soort === 'nieuw') sessieCookie = await maakSessieWaarde(sleutel, { start: Math.min(authMs, nu), laatst: nu });
      else if (b.verversen && t) sessieCookie = await maakSessieWaarde(sleutel, { start: t.start, laatst: nu });
    } catch {
      // Het sessiebeleid mag nooit de toegang breken.
    }
  }

  // Verzoeken die zelf de volledige teamcheck doen (zie boven).
  const isRsc =
    (request.headers.has('rsc') || request.headers.has('next-router-prefetch') || request.headers.has('next-action')) &&
    !/\.[a-z0-9]+$/i.test(pad);
  const controleertZelf = isApi || isRsc;

  // Wel ingelogd: is dit een actief teamlid? (/auth/* controleert zelf.)
  if (user && !controleertZelf && pad !== '/auth/uitloggen' && pad !== '/auth/callback') {
    const toegang = await toegangStatus(supabase);
    const lid = toegang.lid;

    if (lid === 'geen') {
      await supabase.auth.signOut();
      sessieWissen = true;
      sessieCookie = null;
      if (pad === '/geen-toegang') return afwerken(supabaseResponse);
      return metCookies(NextResponse.redirect(new URL('/geen-toegang', request.url)));
    }

    if (lid === 'storing') {
      // Fail closed, maar niet uitloggen: de database is (even) niet bereikbaar.
      // Pagina's controleren zelf nog eens (lib/auth/team.ts) en tonen dan een foutmelding.
      return afwerken(supabaseResponse);
    }

    // 2FA-factor, maar nog alleen met het wachtwoord ingelogd: eerst de code.
    if (toegang.heeftFactor && toegang.aal !== 'aal2' && !isTfaPad && pad !== '/geen-toegang') {
      const url = request.nextUrl.clone();
      url.pathname = '/login/2fa';
      url.search = '';
      const vervolg = veiligVervolg(pad + request.nextUrl.search);
      if (vervolg !== '/' && !/\.[a-z0-9]+$/i.test(pad)) url.searchParams.set('next', vervolg);
      return metCookies(NextResponse.redirect(url));
    }

    // Een teamlid hoeft niet op /geen-toegang of /login te blijven.
    if (pad === '/geen-toegang') return metCookies(NextResponse.redirect(new URL('/', request.url)));
  }

  if (user && isLoginPath) {
    return metCookies(
      NextResponse.redirect(new URL(veiligVervolg(request.nextUrl.searchParams.get('next')), request.url))
    );
  }

  return afwerken(supabaseResponse);
}

export const config = {
  matcher: [
    // Alleen echte statische, openbare bestanden slaan de proxy over: shell/ (shell.css,
    // shell.js), brand/ (logo's), het app-icoon, het web-app-manifest (browsers halen dat
    // zonder cookies op) en Next' eigen bestanden. GEEN algemene
    // uitzondering op .png/.jpg/…: dan zouden dynamische routes die zo eindigen
    // (bv. /social-files/…/foto.png) zonder controle en sessieverversing blijven.
    // /_next/image staat uit (next.config.ts: images.unoptimized), dus geen uitzondering nodig.
    '/((?!_next/static|favicon\\.ico$|icon\\.png$|manifest\\.webmanifest$|shell/|brand/).*)'
  ]
};
