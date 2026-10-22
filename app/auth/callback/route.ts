import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { controleerLid } from '@/lib/auth/lidcheck';
import { veiligVervolg } from '@/lib/vervolg';

export const dynamic = 'force-dynamic';

const TOEGESTANE_TYPES = new Set<EmailOtpType>(['recovery', 'invite', 'magiclink', 'email']);

// Landingsplek van links uit Supabase-mails (wachtwoord herstellen, uitnodiging van een
// nieuw teamlid). Opent de sessie, controleert het teamlidmaatschap en stuurt door naar
// `next` (alleen interne paden, via veiligVervolg). Geen lid: direct weer uitloggen.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const typeParam = searchParams.get('type') as EmailOtpType | null;
  const type = typeParam && TOEGESTANE_TYPES.has(typeParam) ? typeParam : null;
  const next = veiligVervolg(searchParams.get('next'));

  const supabase = await createClient();
  let gelukt = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    gelukt = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    gelukt = !error;
  }

  if (!gelukt) {
    const fout = encodeURIComponent(
      'Deze link is verlopen of al gebruikt. Vraag een nieuwe link aan (via "Wachtwoord vergeten", of vraag de eigenaar om een nieuwe uitnodiging) en open hem in dezelfde browser.'
    );
    return NextResponse.redirect(`${origin}/wachtwoord-vergeten?error=${fout}`);
  }

  const lid = await controleerLid(supabase);
  if (lid === 'geen' || lid === 'storing') {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/geen-toegang`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
