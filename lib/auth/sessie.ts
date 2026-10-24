import { maakSessieWaarde, sessieSleutel, SESSIE_COOKIE, SESSIE_COOKIE_OPTIES } from './sessie-kern';

// Server-kant van het sessiebeleid (lib/auth/sessie-kern.ts): het geheim en een verse cookie
// bij inloggen. Geheim: SESSIE_GEHEIM, anders de service-role-sleutel (via HKDF; de sleutel
// zelf komt nooit in de cookie). Zonder geheim (bv. een lokale omgeving zonder service-role)
// geldt er geen sessiebeleid: nooit iemand buitensluiten.

export function sessieGeheim(): string | null {
  return process.env.SESSIE_GEHEIM || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** Een verse sessiecookie (bij inloggen). Geeft null zonder geheim. */
export async function verseSessieCookie(nu = Date.now()) {
  const geheim = sessieGeheim();
  if (!geheim) return null;
  const waarde = await maakSessieWaarde(await sessieSleutel(geheim), { start: nu, laatst: nu });
  return { name: SESSIE_COOKIE, value: waarde, ...SESSIE_COOKIE_OPTIES };
}
