// Regels voor gebruikersbeheer (/gebruikers): invoer controleren en de admin-regels
// (minstens één actieve admin, jezelf niet buitensluiten). Geen imports: de browser, de
// server en scripts/test-gebruikers.mjs gebruiken dit bestand alle drie.

export const MIN_WACHTWOORD = 12;
export const MAX_WACHTWOORD = 200;

export type GebruikerRol = 'admin' | 'gebruiker';

/** Wat /api/beveiliging/gebruikers per gebruiker teruggeeft. Bevat NOOIT een wachtwoord. */
export interface Gebruiker {
  userId: string;
  naam: string;
  email: string;
  initialen: string;
  kleur: string;
  rol: GebruikerRol;
  boekhouding: boolean;
  actief: boolean;
  /** Moet bij de volgende login een eigen wachtwoord kiezen. */
  wachtwoordWijzigen: boolean;
  factoren: number;
  laatstIngelogd: string | null;
  aangemaakt: string | null;
  zelf: boolean;
}

export interface NieuweGebruiker {
  naam: string;
  email: string;
  initialen: string;
  kleur: string;
  rol: GebruikerRol;
  boekhouding: boolean;
  wachtwoord: string;
}

export interface GebruikerWijziging {
  naam?: string;
  email?: string;
  initialen?: string;
  kleur?: string;
  rol?: GebruikerRol;
  boekhouding?: boolean;
  actief?: boolean;
  /** Nieuw tijdelijk wachtwoord; de gebruiker moet het bij de volgende login vervangen. */
  wachtwoord?: string;
}

type Uitkomst<T> = { ok: true; waarde: T } | { ok: false; fout: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function tekst(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function rolVan(dbRol: string | null | undefined): GebruikerRol {
  return dbRol === 'eigenaar' ? 'admin' : 'gebruiker';
}

export function dbRolVan(rol: GebruikerRol): 'eigenaar' | 'lid' {
  return rol === 'admin' ? 'eigenaar' : 'lid';
}

/** Voorgestelde initialen uit een naam: "Bram Huiskes" → "BH". */
export function initialenVoorstel(naam: string): string {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  return ((delen[0]?.[0] ?? '') + (delen.length > 1 ? delen[delen.length - 1][0] : '')).toUpperCase();
}

function naamFout(naam: string): string | null {
  if (!naam) return 'Vul een naam in.';
  if (naam.length > 80) return 'De naam mag maximaal 80 tekens zijn.';
  return null;
}

function emailFout(email: string): string | null {
  if (!email) return 'Vul een e-mailadres in.';
  if (email.length > 320 || !EMAIL.test(email)) return 'Dit is geen geldig e-mailadres.';
  return null;
}

function initialenFout(i: string): string | null {
  return /^\p{L}{1,3}$/u.test(i) ? null : 'Initialen zijn 1 tot 3 letters.';
}

function kleurFout(k: string): string | null {
  return /^#[0-9a-f]{6}$/.test(k) ? null : 'Kies een kleur.';
}

export function wachtwoordFout(w: string): string | null {
  if (w.length < MIN_WACHTWOORD) return `Kies een wachtwoord van minstens ${MIN_WACHTWOORD} tekens.`;
  if (w.length > MAX_WACHTWOORD) return `Kies een wachtwoord van hooguit ${MAX_WACHTWOORD} tekens.`;
  return null;
}

const schoneNaam = (v: unknown) => tekst(v).replace(/\s+/g, ' ').trim();
const schoneEmail = (v: unknown) => tekst(v).trim().toLowerCase();
const schoneInitialen = (v: unknown) => tekst(v).replace(/[\s.]/g, '').toUpperCase();
const schoneKleur = (v: unknown) => tekst(v).trim().toLowerCase();

export function valideerNieuweGebruiker(b: unknown): Uitkomst<NieuweGebruiker> {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const naam = schoneNaam(o.naam);
  const email = schoneEmail(o.email);
  const initialen = schoneInitialen(o.initialen) || initialenVoorstel(naam);
  const kleur = schoneKleur(o.kleur) || '#c8a97e';
  const wachtwoord = tekst(o.wachtwoord);
  const fout = naamFout(naam) ?? emailFout(email) ?? initialenFout(initialen) ?? kleurFout(kleur) ?? wachtwoordFout(wachtwoord);
  if (fout) return { ok: false, fout };
  if (o.rol !== 'admin' && o.rol !== 'gebruiker') return { ok: false, fout: 'Kies een rol.' };
  const rol = o.rol;
  // Een admin ziet altijd alles, ook de boekhouding.
  const boekhouding = rol === 'admin' ? true : o.boekhouding === true;
  return { ok: true, waarde: { naam, email, initialen, kleur, rol, boekhouding, wachtwoord } };
}

export function valideerWijziging(b: unknown): Uitkomst<GebruikerWijziging> {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const w: GebruikerWijziging = {};
  if ('naam' in o) {
    w.naam = schoneNaam(o.naam);
    const f = naamFout(w.naam);
    if (f) return { ok: false, fout: f };
  }
  if ('email' in o) {
    w.email = schoneEmail(o.email);
    const f = emailFout(w.email);
    if (f) return { ok: false, fout: f };
  }
  if ('initialen' in o) {
    w.initialen = schoneInitialen(o.initialen);
    const f = initialenFout(w.initialen);
    if (f) return { ok: false, fout: f };
  }
  if ('kleur' in o) {
    w.kleur = schoneKleur(o.kleur);
    const f = kleurFout(w.kleur);
    if (f) return { ok: false, fout: f };
  }
  if ('rol' in o) {
    if (o.rol !== 'admin' && o.rol !== 'gebruiker') return { ok: false, fout: 'Kies een rol.' };
    w.rol = o.rol;
  }
  if ('boekhouding' in o) {
    if (typeof o.boekhouding !== 'boolean') return { ok: false, fout: 'Ongeldige waarde voor boekhouding.' };
    w.boekhouding = o.boekhouding;
  }
  if ('actief' in o) {
    if (typeof o.actief !== 'boolean') return { ok: false, fout: 'Ongeldige waarde voor actief.' };
    w.actief = o.actief;
  }
  if ('wachtwoord' in o && o.wachtwoord !== '' && o.wachtwoord !== null && o.wachtwoord !== undefined) {
    w.wachtwoord = tekst(o.wachtwoord);
    const f = wachtwoordFout(w.wachtwoord);
    if (f) return { ok: false, fout: f };
  }
  if (Object.keys(w).length === 0) return { ok: false, fout: 'Er is niets om op te slaan.' };
  if (w.rol === 'admin') w.boekhouding = true;
  return { ok: true, waarde: w };
}

/**
 * Mag deze wijziging (of verwijdering, wijziging = null)? Regels:
 *   - je eigen account kun je niet deactiveren, verwijderen of je eigen admin-rol afnemen;
 *   - er blijft altijd minstens één actieve admin over.
 * `leden` = alle teamleden zoals ze nu zijn.
 */
export function beheerFout(
  o: { doelId: string; zelfId: string; leden: readonly { userId: string; rol: GebruikerRol; actief: boolean }[] },
  wijziging: GebruikerWijziging | null
): string | null {
  const doel = o.leden.find((l) => l.userId === o.doelId);
  if (!doel) return 'Deze gebruiker bestaat niet (meer).';
  const zelf = o.doelId === o.zelfId;
  if (zelf && wijziging === null) return 'Je kunt je eigen account niet verwijderen.';
  if (zelf && wijziging?.actief === false) return 'Je kunt je eigen account niet deactiveren.';
  if (zelf && wijziging?.rol === 'gebruiker') return 'Je kunt je eigen admin-rol niet afnemen.';
  const blijftAdmin = (l: { userId: string; rol: GebruikerRol; actief: boolean }) => {
    if (l.userId !== o.doelId) return l.rol === 'admin' && l.actief;
    if (wijziging === null) return false;
    return (wijziging.rol ?? l.rol) === 'admin' && (wijziging.actief ?? l.actief);
  };
  if (!o.leden.some(blijftAdmin)) return 'Er moet altijd minstens één actieve admin zijn.';
  return null;
}
