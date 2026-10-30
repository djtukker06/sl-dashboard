// De publieke basis-URL van de backoffice, voor links in mails (wachtwoord herstellen,
// uitnodigingen). Nooit blind uit de Host-/X-Forwarded-Host-kop: die kan een aanvaller
// meesturen (host-header-injectie). Volgorde:
//   1. NEXT_PUBLIC_SITE_URL (bv. https://backoffice.studio-levant.nl) — aanbevolen;
//   2. de Origin van het formulier, maar alleen als die in een vaste lijst staat
//      (productie-URL van Vercel en de lokale ontwikkelpoorten);
//   3. anders null: dan gebruikt Supabase zijn eigen "Site URL".
// Supabase controleert de link daarnaast tegen de Redirect-URL-allowlist (zie README).

function origin(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : null;
  } catch {
    return null;
  }
}

export function toegestaneOrigins(): string[] {
  return [
    origin(process.env.NEXT_PUBLIC_SITE_URL),
    origin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    'http://localhost:3000',
    'http://localhost:3107'
  ].filter((o): o is string => Boolean(o));
}

export function siteUrl(formOrigin: string | null): string | null {
  const vast = origin(process.env.NEXT_PUBLIC_SITE_URL);
  if (vast) return vast;
  const o = origin(formOrigin);
  return o && toegestaneOrigins().includes(o) ? o : null;
}
