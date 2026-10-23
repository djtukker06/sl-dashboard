// Validatie voor taken op naam: wie (teamleden), subtaken en projecten. Pure functies
// zonder imports (alleen types), zodat scripts/test-taken.mjs dit bestand direct laadt.
// De API-routes vertrouwen niets van de client; de database controleert daarnaast zelf
// (RLS: alleen actieve teamleden, check-constraints op lengtes).

import type { ProjectInvoer, SubtaakInvoer } from './types';

export type Resultaat<T> = { ok: true; waarde: T } | { ok: false; fout: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

function klantVan(v: unknown): Resultaat<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, waarde: null };
  if (!isUuid(v)) return { ok: false, fout: 'Ongeldige klant.' };
  return { ok: true, waarde: v.toLowerCase() };
}

function tekstVan(v: unknown, max: number, naam: string): Resultaat<string> {
  if (v === null || v === undefined) return { ok: true, waarde: '' };
  if (typeof v !== 'string') return { ok: false, fout: `Ongeldige ${naam}.` };
  if (v.length > max) return { ok: false, fout: `De ${naam} is te lang (maximaal ${max} tekens).` };
  return { ok: true, waarde: v };
}

export const MAX_PERSONEN = 20;
export const MAX_SUBTAKEN = 50;

/** Een lijst teamleden (user-id's): minstens één, uniek, maximaal 20. */
export function parsePersonen(v: unknown, naam = 'persoon'): Resultaat<string[]> {
  if (!Array.isArray(v)) return { ok: false, fout: `Kies minstens één ${naam}.` };
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x.toLowerCase() : x)))];
  if (!ids.length) return { ok: false, fout: `Kies minstens één ${naam}.` };
  if (ids.length > MAX_PERSONEN) return { ok: false, fout: 'Te veel personen gekozen.' };
  if (!ids.every(isUuid)) return { ok: false, fout: 'Ongeldige persoon.' };
  return { ok: true, waarde: ids as string[] };
}

/** Titel van een subtaak: 1–200 tekens, witruimte samengevoegd. */
export function parseSubtaakTitel(v: unknown): Resultaat<string> {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!t) return { ok: false, fout: 'Geef de subtaak een titel.' };
  if (t.length > 200) return { ok: false, fout: 'Een subtaak is maximaal 200 tekens.' };
  return { ok: true, waarde: t };
}

/** Subtaken bij het aanmaken: lege regels vallen weg, maximaal 50. */
export function parseSubtaken(v: unknown): Resultaat<string[]> {
  if (v === undefined || v === null) return { ok: true, waarde: [] };
  if (!Array.isArray(v)) return { ok: false, fout: 'Ongeldige subtaken.' };
  const uit: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && !x.trim()) continue;
    const t = parseSubtaakTitel(x);
    if (!t.ok) return t;
    uit.push(t.waarde);
  }
  if (uit.length > MAX_SUBTAKEN) return { ok: false, fout: `Maximaal ${MAX_SUBTAKEN} subtaken per taak.` };
  return { ok: true, waarde: uit };
}

/** PATCH van een subtaak: titel, klaar en/of volgorde. */
export function parseSubtaakWijziging(
  body: SubtaakInvoer,
  userId: string
): Resultaat<{ titel?: string; klaar_op?: string | null; klaar_door?: string | null; sort_order?: number }> {
  if (!body || typeof body !== 'object') return { ok: false, fout: 'Ongeldige invoer.' };
  const rij: { titel?: string; klaar_op?: string | null; klaar_door?: string | null; sort_order?: number } = {};
  if ('titel' in body) {
    const t = parseSubtaakTitel(body.titel);
    if (!t.ok) return t;
    rij.titel = t.waarde;
  }
  if ('klaar' in body) {
    if (typeof body.klaar !== 'boolean') return { ok: false, fout: 'Ongeldige waarde voor klaar.' };
    rij.klaar_op = body.klaar ? new Date().toISOString() : null;
    rij.klaar_door = body.klaar ? userId : null;
  }
  if ('volgorde' in body) {
    const n = Number(body.volgorde);
    if (!Number.isInteger(n) || n < 0 || n > 10000) return { ok: false, fout: 'Ongeldige volgorde.' };
    rij.sort_order = n;
  }
  if (!Object.keys(rij).length) return { ok: false, fout: 'Niets om te wijzigen.' };
  return { ok: true, waarde: rij };
}

/** Kolommen van public.projects die de API mag schrijven. */
export interface ProjectRij {
  naam?: string;
  client_id?: string | null;
  /** Wat de app kiest; vóór 0023 schrijft de API 'gepland' i.p.v. 'voorbereiding'. */
  status?: 'voorbereiding' | 'bezig' | 'wachten' | 'afgerond' | 'gepland';
  notitie?: string;
  deadline?: string | null;
}

const DAG = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' die echt bestaat (geen 31 februari). */
export function isGeldigeDag(v: unknown): v is string {
  if (typeof v !== 'string' || !DAG.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Projectstatus (0023: voorbereiding / bezig / wachten / afgerond). Oudere waarden worden
 * omgezet: 'gepland' (0022) → voorbereiding, 'actief' → bezig, 'gearchiveerd' → afgerond.
 * Onbekend: null.
 */
export function projectStatusVan(v: unknown): 'voorbereiding' | 'bezig' | 'wachten' | 'afgerond' | null {
  if (v === 'voorbereiding' || v === 'bezig' || v === 'wachten' || v === 'afgerond') return v;
  if (v === 'gepland') return 'voorbereiding';
  if (v === 'actief') return 'bezig';
  if (v === 'gearchiveerd') return 'afgerond';
  return null;
}

/**
 * Dezelfde status in de waarden van vóór migratie 0023 (check gepland/bezig/afgerond),
 * voor als de database de nieuwe waarde nog weigert. 'wachten' bestaat dan nog niet: null.
 */
export function projectStatusVoor0023(s: string): 'gepland' | 'bezig' | 'afgerond' | null {
  if (s === 'voorbereiding' || s === 'gepland') return 'gepland';
  if (s === 'bezig' || s === 'afgerond') return s;
  return null;
}

/**
 * Project aanmaken of wijzigen. `eigenaren` staat apart (eigen tabel project_eigenaren):
 * undefined = niet wijzigen, anders de nieuwe set (mag leeg).
 */
export function parseProject(
  body: ProjectInvoer,
  nieuw: boolean
): Resultaat<ProjectRij> & { eigenaren?: string[] } {
  if (!body || typeof body !== 'object') return { ok: false, fout: 'Ongeldige invoer.' };
  const rij: ProjectRij = {};
  let eigenaren: string[] | undefined;
  if (nieuw || 'naam' in body) {
    const n = typeof body.naam === 'string' ? body.naam.replace(/\s+/g, ' ').trim() : '';
    if (!n) return { ok: false, fout: 'Geef het project een naam.' };
    if (n.length > 120) return { ok: false, fout: 'De naam is te lang (maximaal 120 tekens).' };
    rij.naam = n;
  }
  if ('klantId' in body) {
    const k = klantVan(body.klantId);
    if (!k.ok) return k;
    rij.client_id = k.waarde;
  }
  if ('status' in body) {
    const s = projectStatusVan(body.status);
    if (!s) return { ok: false, fout: 'Ongeldige status.' };
    rij.status = s;
  }
  if ('notitie' in body) {
    const n = tekstVan(body.notitie, 5000, 'notitie');
    if (!n.ok) return n;
    rij.notitie = n.waarde;
  }
  if ('deadline' in body) {
    if (body.deadline === null || body.deadline === '') rij.deadline = null;
    else if (isGeldigeDag(body.deadline)) rij.deadline = body.deadline;
    else return { ok: false, fout: 'Ongeldige deadline.' };
  }
  if ('eigenaren' in body) {
    const v = body.eigenaren;
    if (!Array.isArray(v)) return { ok: false, fout: 'Ongeldige eigenaren.' };
    if (v.length) {
      const p = parsePersonen(v, 'eigenaar');
      if (!p.ok) return p;
      eigenaren = p.waarde;
    } else eigenaren = [];
  }
  if (!nieuw && !Object.keys(rij).length && eigenaren === undefined) return { ok: false, fout: 'Niets om te wijzigen.' };
  return eigenaren === undefined ? { ok: true, waarde: rij } : { ok: true, waarde: rij, eigenaren };
}

/**
 * Klant en project consistent maken: een project bij een klant vult een lege klant in;
 * een project bij een andere klant is een fout. Een project zonder klant past overal bij.
 */
export function klantBijProject(
  klantId: string | null,
  project: { klantId: string | null } | null
): Resultaat<string | null> {
  if (!project || !project.klantId) return { ok: true, waarde: klantId };
  if (!klantId) return { ok: true, waarde: project.klantId };
  if (klantId !== project.klantId) return { ok: false, fout: 'Het project hoort bij een andere klant.' };
  return { ok: true, waarde: klantId };
}
