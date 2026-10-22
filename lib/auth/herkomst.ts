// Herkomstcontrole (CSRF) voor wijzigende verzoeken: alleen de eigen site mag POST/PUT/
// PATCH/DELETE doen. SameSite=Lax-cookies houden al veel tegen, maar een cross-site
// "simple request" (bv. text/plain) zou anders met cookies binnenkomen.
//
// - Sec-Fetch-Site "cross-site" wordt altijd geweigerd (moderne browsers zetten die).
// - Origin moet gelijk zijn aan de eigen origin (of de host waarop het verzoek binnenkwam).
// - Zonder Origin- én Sec-Fetch-Site-kop (geen browser, of een heel oude) laten we het
//   verzoek door: CSRF vereist een browser, en die stuurt bij wijzigende verzoeken Origin mee.

const VEILIGE_METHODEN = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isWijzigend(method: string): boolean {
  return !VEILIGE_METHODEN.has(method.toUpperCase());
}

export function eigenHerkomst(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  let eigen: string;
  try {
    eigen = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin === eigen) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
