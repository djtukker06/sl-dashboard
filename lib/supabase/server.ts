import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Sessie-gebonden client voor Server Components / Route Handlers / Server Actions.
// Respecteert RLS — gebruik deze voor gewone reads, niet voor bevoorrechte writes.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Genegeerd wanneer dit vanuit een Server Component wordt aangeroepen —
            // proxy.ts ververst de sessie sowieso al bij elk request.
          }
        }
      }
    }
  );
}
