// Tweestapsverificatie (2FA, TOTP via Supabase Auth MFA): de pure beslisregels. Zonder
// imports met @/ en zonder env, zodat scripts/test-beveiliging.mjs dit direct kan laden.
//
// Wanneer moet iemand iets met 2FA doen?
//   - Heeft hij een geverifieerde factor en zit zijn sessie nog op aal1 (alleen wachtwoord)?
//     Dan ALTIJD eerst de code ("uitdaging"), ook als afdwingen uit staat: anders zou het
//     wachtwoord alleen al genoeg zijn voor de routes die met de service-role werken.
//   - Geen factor, afdwingen aan (MFA_AFDWINGEN niet 'uit') én migratie 0026 uitgevoerd?
//     Dan eerst instellen. Zonder 0026 of met afdwingen uit: nooit verplicht instellen, zodat
//     niemand wordt buitengesloten.

export type Aal = 'aal1' | 'aal2';
export type TfaStap = 'ok' | 'uitdaging' | 'instellen';

/** Maximaal aantal geverifieerde TOTP-factoren per persoon (telefoon + reserve). */
export const MAX_FACTOREN = 2;

/** MFA_AFDWINGEN: standaard aan; alleen 'uit' (of off/false/0/nee) zet het uit. */
export function afdwingenUitEnv(waarde: string | undefined | null): boolean {
  const v = String(waarde ?? '').trim().toLowerCase();
  return !['uit', 'off', 'false', '0', 'nee'].includes(v);
}

export function alsAal(v: unknown): Aal {
  return v === 'aal2' ? 'aal2' : 'aal1';
}

export function tfaStap(i: { heeftFactor: boolean; aal: Aal; afdwingen: boolean; migratie: boolean }): TfaStap {
  if (i.heeftFactor) return i.aal === 'aal2' ? 'ok' : 'uitdaging';
  if (i.afdwingen && i.migratie) return 'instellen';
  return 'ok';
}

/** Een ingetypte code: spaties en streepjes eruit; precies 6 cijfers, anders null. */
export function schoneCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(c) ? c : null;
}

/** Naam voor een nieuw apparaat (uniek per persoon, max. 40 tekens). */
export function apparaatNaam(invoer: unknown, bestaand: string[]): string {
  const basis =
    (typeof invoer === 'string' ? invoer : '')
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 32) || (bestaand.length ? 'Tweede apparaat' : 'Telefoon');
  if (!bestaand.includes(basis)) return basis;
  for (let i = 2; i < 50; i++) {
    const n = `${basis} ${i}`;
    if (!bestaand.includes(n)) return n;
  }
  return `${basis} ${Date.now().toString(36)}`.slice(0, 40);
}

/**
 * Alleen een QR-code als SVG-data-URI doorgeven (nooit een willekeurige URL). Supabase levert
 * `totp.qr_code` meestal als kale SVG-tekst (`<svg …>`); die zetten we zelf om naar een
 * data-URI. Als <img src> voert de browser in een SVG nooit scripts uit.
 */
export function veiligeQr(v: unknown): string | null {
  if (typeof v !== 'string' || v.length >= 200_000) return null;
  const s = v.trim();
  if (/^data:image\/svg\+xml[;,]/i.test(s)) return s;
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s) && /<\/svg>\s*$/i.test(s)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  }
  return null;
}
