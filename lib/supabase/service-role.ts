import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Server-only client die RLS omzeilt. UITSLUITEND gebruiken binnen app/api/*-routes,
// en alleen NA een expliciete auth.getUser()-check in diezelfde route — deze client
// biedt zelf geen enkele beveiliging, dat moet de aanroepende route regelen.
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
