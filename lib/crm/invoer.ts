// Validatie voor klanten en klantnotities. Pure functies zonder imports (alleen types),
// zodat scripts/test-crm.mjs dit bestand direct laadt. De API vertrouwt niets van de
// client; de database controleert daarnaast zelf (RLS, check-constraints).

import type { KlantInvoer, KlantStatus } from './types';

export type Resultaat<T> = { ok: true; waarde: T } | { ok: false; fout: string };

/** Kolommen van public.clients die de klantpagina mag schrijven. */
export interface KlantRij {
  company_name?: string;
  contact_name?: string | null;
  email?: string;
  telefoon?: string;
  address?: string | null;
  postal_code?: string | null;
  status?: KlantStatus;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFOON = /^[0-9+()\-.\s]*$/;

function tekst(v: unknown, max: number, naam: string): Resultaat<string> {
  if (v === null || v === undefined) return { ok: true, waarde: '' };
  if (typeof v !== 'string') return { ok: false, fout: `Ongeldige ${naam}.` };
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > max) return { ok: false, fout: `De ${naam} is te lang (maximaal ${max} tekens).` };
  return { ok: true, waarde: t };
}

export function isKlantStatus(v: unknown): v is KlantStatus {
  return v === 'lead' || v === 'actief' || v === 'afgerond';
}

/**
 * Klant aanmaken (nieuw: bedrijfsnaam verplicht, status standaard 'lead') of wijzigen
 * (alleen de meegestuurde velden). Lege contactpersoon/adres/postcode → null, zoals in
 * de facturen; e-mail en telefoon → ''.
 */
export function parseKlant(body: KlantInvoer, nieuw: boolean): Resultaat<KlantRij> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fout: 'Ongeldige invoer.' };
  const rij: KlantRij = {};
  if (nieuw || 'naam' in body) {
    const n = tekst(body.naam, 200, 'bedrijfsnaam');
    if (!n.ok) return n;
    if (!n.waarde) return { ok: false, fout: 'Vul de bedrijfsnaam in.' };
    rij.company_name = n.waarde;
  }
  if ('contactpersoon' in body) {
    const c = tekst(body.contactpersoon, 200, 'contactpersoon');
    if (!c.ok) return c;
    rij.contact_name = c.waarde || null;
  }
  if ('email' in body) {
    const e = tekst(body.email, 320, 'e-mail');
    if (!e.ok) return e;
    if (e.waarde && !EMAIL.test(e.waarde)) return { ok: false, fout: 'Dat e-mailadres klopt niet.' };
    rij.email = e.waarde.toLowerCase();
  }
  if ('telefoon' in body) {
    const t = tekst(body.telefoon, 40, 'telefoon');
    if (!t.ok) return t;
    if (!TELEFOON.test(t.waarde)) return { ok: false, fout: 'Een telefoonnummer bevat alleen cijfers, spaties en + ( ) -.' };
    rij.telefoon = t.waarde;
  }
  if ('adres' in body) {
    const a = tekst(body.adres, 300, 'adres');
    if (!a.ok) return a;
    rij.address = a.waarde || null;
  }
  if ('postcode' in body) {
    const p = tekst(body.postcode, 20, 'postcode');
    if (!p.ok) return p;
    rij.postal_code = p.waarde ? p.waarde.toUpperCase() : null;
  }
  if ('status' in body) {
    if (!isKlantStatus(body.status)) return { ok: false, fout: 'Ongeldige status.' };
    rij.status = body.status;
  } else if (nieuw) {
    rij.status = 'lead';
  }
  if (!nieuw && !Object.keys(rij).length) return { ok: false, fout: 'Niets om te wijzigen.' };
  return { ok: true, waarde: rij };
}

/** Tekst van een klantnotitie: 1–2000 tekens (regels blijven behouden). */
export function parseNotitie(v: unknown): Resultaat<string> {
  if (typeof v !== 'string') return { ok: false, fout: 'Schrijf eerst een notitie.' };
  const t = v.replace(/\r\n/g, '\n').trim();
  if (!t) return { ok: false, fout: 'Schrijf eerst een notitie.' };
  if (t.length > 2000) return { ok: false, fout: 'Een notitie is maximaal 2000 tekens.' };
  return { ok: true, waarde: t };
}

/** Escapet % _ en \ voor een ilike-vergelijking op exacte tekst. */
export function likeLetterlijk(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
