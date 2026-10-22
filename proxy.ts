import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { veiligVervolg } from '@/lib/vervolg';

// In Next.js 16 heet dit bestand "proxy.ts" (was "middleware.ts"). Ververst de
// Supabase-sessie op elk request en stuurt niet-ingelogde bezoekers naar /login.
// Elke API-route controleert daarnaast zelf ook de sessie — deze proxy is de eerste
// linie, niet de enige (zie Supabase-docs advies hierover).
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

  const { data: { user } } = await supabase.auth.getUser();

  const pad = request.nextUrl.pathname;
  const isLoginPath = pad.startsWith('/login');
  // Wachtwoord herstellen moet zonder sessie kunnen; /nieuw-wachtwoord niet (die
  // vereist de sessie die /auth/callback opent).
  // /auth/uitloggen handelt zelf af (ook met een al verlopen sessie: dan gewoon naar /login).
  const isPubliekPad =
    isLoginPath || pad === '/wachtwoord-vergeten' || pad === '/auth/callback' || pad === '/auth/uitloggen';

  if (!user && !isPubliekPad) {
    // Social is een statische frontend die fetch() gebruikt: een redirect naar de
    // loginpagina zou daar als HTML met status 200 binnenkomen. Geef de API en de
    // slide-bestanden daarom een echte 401; app.js stuurt dan zelf door naar /login.
    // (Alleen voor social en de nieuwe modules, zodat de facturen-API zich exact gedraagt
    // als voorheen.) De agenda-API gebruikt fetch() vanuit de agenda en het dashboard.
    if (
      pad.startsWith('/api/social') ||
      pad.startsWith('/social-files') ||
      pad === '/api/agenda' ||
      pad.startsWith('/api/taken') ||
      pad.startsWith('/api/afspraken')
    ) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
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
    return NextResponse.redirect(url);
  }

  if (user && isLoginPath) {
    return NextResponse.redirect(new URL(veiligVervolg(request.nextUrl.searchParams.get('next')), request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // shell/ (shell.css, shell.js) en brand/ (logo's) zijn openbare, statische bestanden.
    '/((?!_next/static|_next/image|favicon.ico|shell/|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
