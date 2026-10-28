import 'server-only';
import { systeemClient } from '@/lib/supabase/systeem';

// De vlag wachtwoord_wijzigen (app_metadata, gezet door de admin bij aanmaken of resetten)
// weghalen nadat de gebruiker zelf een nieuw wachtwoord heeft gekozen. Alleen aan te roepen
// ná een geslaagde updateUser() met de eigen sessie van die gebruiker (app/actions/wachtwoord.ts):
// die sessie is tot dan bewust geen teamlid met bewijs, vandaar de systeem-service-role.
export async function wachtwoordVlagWeg(userId: string): Promise<void> {
  const sb = systeemClient('wachtwoord');
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error) throw error;
  const meta = { ...(data.user?.app_metadata ?? {}) } as Record<string, unknown>;
  if (meta.wachtwoord_wijzigen !== true) return;
  // Een sleutel op null zetten haalt hem weg (app_metadata wordt samengevoegd).
  const r = await sb.auth.admin.updateUserById(userId, { app_metadata: { wachtwoord_wijzigen: null } });
  if (r.error) throw r.error;
}
