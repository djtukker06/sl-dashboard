import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Uitloggen vanuit het accountmenu in de rail. Een gewoon <form method="post">, zodat
// het ook werkt in de statische social-pagina (zonder React/server actions).
// Alleen POST en alleen vanaf de eigen site (Origin-check tegen CSRF-uitlogpogingen).
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const eigen = new URL(request.url).origin;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  let toegestaan = !origin || origin === eigen;
  if (!toegestaan && origin && host) {
    try {
      toegestaan = new URL(origin).host === host;
    } catch {
      toegestaan = false; // bv. Origin: null
    }
  }
  if (!toegestaan) {
    return NextResponse.json({ error: 'Ongeldige herkomst.' }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) await supabase.auth.signOut();

  // 303: na een POST met GET naar de loginpagina.
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
