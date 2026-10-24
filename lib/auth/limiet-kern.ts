// Pure rekenregels voor pogingenlimieten (inloggen, 2FA-codes, wachtwoord-vergeten, dure
// AI-routes). Zonder imports met @/, zodat scripts/test-beveiliging.mjs dit kan laden.

export interface Limiet {
  /** Bv. 'e:<hash>' (e-mail), 'i:<hash>' (IP), 't:<hash>' (2FA-codes van één gebruiker). */
  sleutel: string;
  /** Zoveel MISLUKTE pogingen binnen het venster mag; daarna geblokkeerd. */
  max: number;
  vensterMs: number;
}

export const MIN = 60_000;

/** De standaardlimieten. */
export const LIMIETEN = {
  inloggenEmail: { max: 5, vensterMs: 15 * MIN },
  inloggenIp: { max: 20, vensterMs: 15 * MIN },
  tfaCode: { max: 5, vensterMs: 5 * MIN },
  wachtwoordVergeten: { max: 3, vensterMs: 60 * MIN }
} as const;

/**
 * Geblokkeerd? `tijden` zijn de tijdstippen (ms) van mislukte pogingen. Wachttijd: tot de
 * oudste poging die nog meetelt uit het venster valt.
 */
export function beoordeel(tijden: number[], max: number, vensterMs: number, nu: number): { geblokkeerd: boolean; wachtMs: number } {
  const binnen = tijden.filter((t) => t > nu - vensterMs && t <= nu).sort((a, b) => a - b);
  if (binnen.length < max) return { geblokkeerd: false, wachtMs: 0 };
  // De (n - max + 1)-de nieuwste moet uit het venster vallen voordat er weer ruimte is.
  const sleutelTijd = binnen[binnen.length - max];
  return { geblokkeerd: true, wachtMs: Math.max(1000, sleutelTijd + vensterMs - nu) };
}

/** "over 4 minuten" / "over een minuut". */
export function wachtTekst(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / MIN));
  return min === 1 ? 'over een minuut' : `over ${min} minuten`;
}
