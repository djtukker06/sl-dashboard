import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
  const isPubliekPad = isLoginPath || pad === '/wachtwoord-vergeten' || pad === '/auth/callback';

  if (!user && !isPubliekPad) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isLoginPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
