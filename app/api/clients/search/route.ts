import { NextResponse } from 'next/server';
import { controleerRoute } from '@/lib/auth/team';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: Request) {
  // Sessie + teamlidmaatschap (lib/auth/team.ts); daarna de gebruikerscliënt (RLS).
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const supabase = toegang.lid.sb;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, 100);

  if (q.length === 0) {
    return NextResponse.json([], { headers: GEEN_CACHE });
  }

  // % en _ zijn jokertekens in ilike: letterlijk zoeken op wat er getypt is.
  const patroon = q.replace(/[\\%_]/g, (t) => `\\${t}`);
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, address, postal_code')
    .ilike('company_name', `%${patroon}%`)
    .order('company_name')
    .limit(8);

  if (error) {
    console.error('[klanten] zoeken mislukt', error.code ?? '', error.message);
    return NextResponse.json({ error: 'Zoeken is mislukt. Probeer het opnieuw.' }, { status: 500, headers: GEEN_CACHE });
  }

  return NextResponse.json(data, { headers: GEEN_CACHE });
}
