import 'server-only';
import { createHash } from 'node:crypto';

// Is dit wachtwoord bekend uit datalekken? Via de k-anonimiteit-API van Have I Been Pwned:
// alleen de eerste 5 tekens van de SHA-1-hash gaan naar buiten, nooit het wachtwoord of de
// hele hash. (Supabase heeft dit alleen in het betaalde plan.) Bij een storing of na 3 s:
// niet blokkeren (de lengte-eis blijft gelden).
export async function wachtwoordGelekt(wachtwoord: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const hash = createHash('sha1').update(wachtwoord, 'utf8').digest('hex').toUpperCase();
  const voor = hash.slice(0, 5);
  const rest = hash.slice(5);
  try {
    const res = await fetcher(`https://api.pwnedpasswords.com/range/${voor}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'studio-levant-backoffice' },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store'
    });
    if (!res.ok) return false;
    const tekst = await res.text();
    return tekst.split('\n').some((regel) => {
      const [suffix, aantal] = regel.trim().split(':');
      return suffix === rest && Number(aantal) > 0;
    });
  } catch {
    return false;
  }
}
