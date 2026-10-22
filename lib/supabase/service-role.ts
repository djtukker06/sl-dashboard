import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { isGeldigBewijs, type TeamlidBewijs } from '@/lib/auth/team';

// Server-only client die RLS omzeilt. Vraagt een bewijs van de teamlidcontrole
// (lib/auth/team.ts: vereisTeamlid()/teamlidRoute()), zodat code die de service-role
// zonder controle gebruikt niet compileert. Een nagemaakt bewijs wordt geweigerd.
// Scripts (scripts/*.mjs) maken hun eigen client.
export function createServiceRoleClient(bewijs: TeamlidBewijs) {
  if (!isGeldigBewijs(bewijs)) {
    throw new Error('Service-role geweigerd: geen geldige teamlidcontrole.');
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
