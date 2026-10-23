// Wie ziet welke taak (stap 2 van 0022). Pure functies zonder imports (alleen types), zodat
// scripts/test-taken.mjs dit bestand direct laadt. De database dwingt dit zelf af (RLS van
// 0022); dit is de regel zoals de schermen hem gebruiken:
//   - "mijn taak" = ik sta erop (toegewezen). De maker is niet automatisch betrokken.
//   - "uitgezet"  = ik maakte hem en sta er zelf niet op. Alleen in de tab Uitgezet (en
//                   als aantal op het dashboard), nooit in mijn eigen lijst of agenda.

import type { Taak } from './types';

type Wie = Pick<Taak, 'aangemaaktDoor' | 'toegewezen'>;

/** Staat de taak op mijn naam? (Vóór 0021 — overgang — is alles van iedereen.) */
export function opMijnNaam(t: Pick<Taak, 'toegewezen'>, mijnId: string, overgang = false): boolean {
  return overgang || t.toegewezen.includes(mijnId);
}

/** Heb ik deze taak voor een ander gemaakt (en sta ik er zelf niet op)? */
export function isUitgezet(t: Wie, mijnId: string): boolean {
  return t.aangemaaktDoor === mijnId && !t.toegewezen.includes(mijnId);
}

export interface UitgezetGroep<T> {
  sleutel: string;
  /** Bij wie (zonder mijzelf), gesorteerd; leeg bij de groep "klaar". */
  personen: string[];
  klaar: boolean;
  taken: T[];
}

/**
 * De tab Uitgezet: open taken per persoon (of combinatie van personen), in de volgorde
 * waarin ze binnenkomen (de server sorteert op deadline); afgeronde taken samen onderaan.
 */
export function groepeerUitgezet<T extends Wie & Pick<Taak, 'afgerond'>>(taken: T[], mijnId: string): UitgezetGroep<T>[] {
  const groepen = new Map<string, UitgezetGroep<T>>();
  for (const t of taken) {
    const personen = t.afgerond ? [] : t.toegewezen.filter((id) => id !== mijnId).sort();
    const sleutel = t.afgerond ? '~klaar' : `p:${personen.join(',')}`;
    let g = groepen.get(sleutel);
    if (!g) {
      g = { sleutel, personen, klaar: t.afgerond, taken: [] };
      groepen.set(sleutel, g);
    }
    g.taken.push(t);
  }
  return [...groepen.values()].sort((a, b) => Number(a.klaar) - Number(b.klaar));
}
