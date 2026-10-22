import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Landingsplek van links uit Supabase-mails (wachtwoord herstellen). Opent de
// sessie en stuurt door naar `next` (alleen interne paden).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next') || '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

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
      'Deze link is verlopen of al gebruikt. Vraag een nieuwe herstelmail aan (open hem in dezelfde browser).'
    );
    return NextResponse.redirect(`${origin}/wachtwoord-vergeten?error=${fout}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
