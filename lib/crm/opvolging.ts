// Opvolgen van leads en klanten (migratie 0025) en het sorteren van het klantenoverzicht.
// Pure functies zonder imports (alleen types), zodat scripts/test-crm.mjs dit bestand
// direct laadt en het zowel op de server als in de browser werkt.

import type { ProjectStatus } from '@/lib/agenda/types';
import type { KlantRegel } from './types';

const DAG_MS = 86_400_000;
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function dagNummer(dag: string): number {
  const [j, m, d] = dag.split('-').map(Number);
  return Math.round(Date.UTC(j, m - 1, d) / DAG_MS);
}

export type OpvolgStand = 'telaat' | 'vandaag' | 'binnenkort' | 'later';

/** Stand van een opvolgdatum: te laat (verstreken), vandaag, binnenkort (≤ 7 dagen) of later. */
export function opvolgStand(datum: string | null, vandaag: string): OpvolgStand | null {
  if (!datum) return null;
  const v = dagNummer(datum) - dagNummer(vandaag);
  if (v < 0) return 'telaat';
  if (v === 0) return 'vandaag';
  if (v <= 7) return 'binnenkort';
  return 'later';
}

/** "vandaag", "morgen", "gisteren", "3 dagen te laat", "over 4 dagen", "12 nov". */
export function opvolgTekst(datum: string, vandaag: string): string {
  const v = dagNummer(datum) - dagNummer(vandaag);
  if (v === 0) return 'vandaag';
  if (v === 1) return 'morgen';
  if (v === -1) return 'gisteren';
  if (v < -1) return `${-v} dagen te laat`;
  if (v <= 7) return `over ${v} dagen`;
  const [j, m, d] = datum.split('-').map(Number);
  const jaar = vandaag.slice(0, 4) !== String(j) ? ` ${j}` : '';
  return `${d} ${MAANDEN[m - 1]}${jaar}`;
}

/** Hoeveel dagen geleden (0 = vandaag); voor "laatste contact". */
export function dagenGeleden(iso: string | null, nu: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nu.getTime() - t) / DAG_MS));
}

/** "vandaag", "gisteren", "5 d", "3 wk", "4 mnd", "1 jr". Kort, voor in een rij. */
export function geledenKort(iso: string | null, nu: Date = new Date()): string {
  const d = dagenGeleden(iso, nu);
  if (d === null) return '—';
  if (d === 0) return 'vandaag';
  if (d === 1) return 'gisteren';
  if (d < 14) return `${d} d`;
  if (d < 60) return `${Math.floor(d / 7)} wk`;
  if (d < 365) return `${Math.floor(d / 30)} mnd`;
  return `${Math.floor(d / 365)} jr`;
}

/** Opvolgdatum eerst (te laat bovenaan), zonder datum achteraan, daarna op naam. */
export function opOpvolgdatum<T extends { opvolgenOp: string | null; naam: string }>(a: T, b: T): number {
  const da = a.opvolgenOp ?? '9999-12-31';
  const db = b.opvolgenOp ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return a.naam.localeCompare(b.naam, 'nl');
}

export type KlantSortering = 'naam' | 'actief' | 'omzet' | 'opvolgen';

export const SORTERING_LABEL: Record<KlantSortering, string> = {
  naam: 'Naam',
  actief: 'Laatst actief',
  omzet: 'Omzet',
  opvolgen: 'Opvolgdatum'
};

export function sorteerKlanten(lijst: KlantRegel[], op: KlantSortering): KlantRegel[] {
  const kopie = [...lijst];
  const opNaam = (a: KlantRegel, b: KlantRegel) => a.naam.localeCompare(b.naam, 'nl');
  if (op === 'naam') return kopie.sort(opNaam);
  if (op === 'omzet') return kopie.sort((a, b) => b.omzet - a.omzet || opNaam(a, b));
  if (op === 'opvolgen') return kopie.sort(opOpvolgdatum);
  return kopie.sort((a, b) => (a.laatstActief === b.laatstActief ? opNaam(a, b) : a.laatstActief < b.laatstActief ? 1 : -1));
}

/** Zoeken op naam, contactpersoon, e-mail, telefoon en volgende stap (hoofdletterongevoelig). */
export function klantPast(k: Pick<KlantRegel, 'naam' | 'contactpersoon' | 'email' | 'telefoon' | 'volgendeStap'>, zoek: string): boolean {
  const z = zoek.trim().toLowerCase();
  if (!z) return true;
  return [k.naam, k.contactpersoon, k.email, k.telefoon, k.volgendeStap].some((v) => v.toLowerCase().includes(z));
}

/** Belangrijkste status van de lopende projecten: wat aandacht vraagt eerst. */
const GEWICHT: Record<ProjectStatus, number> = { wachten: 3, bezig: 2, voorbereiding: 1, afgerond: 0 };
export function belangrijksteStatus(statussen: ProjectStatus[]): ProjectStatus | null {
  let beste: ProjectStatus | null = null;
  for (const s of statussen) if (s !== 'afgerond' && (!beste || GEWICHT[s] > GEWICHT[beste])) beste = s;
  return beste;
}

/**
 * Hoort deze klant op de dashboardkaart "Opvolgen"? (niet afgerond en niet "op de radar",
 * datum vandaag of eerder). Op de radar (0033) vraagt bewust nog geen actie.
 */
export function moetOpvolgen(k: { status: string; opvolgenOp: string | null }, vandaag: string): boolean {
  return k.status !== 'afgerond' && k.status !== 'koud' && !!k.opvolgenOp && k.opvolgenOp <= vandaag;
}
