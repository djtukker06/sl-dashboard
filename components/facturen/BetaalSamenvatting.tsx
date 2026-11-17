import type { Teamlid } from '@/lib/auth/team';
import { betaalOverzicht } from '@/lib/boekhouding/betaalstatus';
import { omzetOverzicht, type BetaalInfo } from '@/lib/boekhouding/kern/betaalcheck';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { korteDatum } from '@/lib/boekhouding/kern/periode';
import type { FactuurSnapshot } from '@/lib/dashboard/facturen';

// Betaalstatus in de korte facturenoverzichten (Boekhouding → Overzicht en de Facturen-kaart op
// het dashboard), met dezelfde regel als /facturen: omzet telt alleen volledig betaalde facturen.
// Zonder vinkje Boekhouding (of bij een storing) null: dan blijft het overzicht zoals het was.

export interface Betaling {
  /** Omzet (betaald) excl. btw, in euro's. */
  omzet: number;
  /** Nog te ontvangen incl. btw, in euro's, en hoeveel facturen. */
  teOntvangen: number;
  aantalOpen: number;
  info: ReadonlyMap<string, BetaalInfo>;
}

export async function betalingVoor(lid: Teamlid, f: FactuurSnapshot): Promise<Betaling | null> {
  const overzicht = await betaalOverzicht(lid);
  if (!overzicht) return null;
  const o = omzetOverzicht(f.vanJaar, overzicht.info);
  return { omzet: o.betaaldeOmzet / 100, teOntvangen: o.teOntvangen / 100, aantalOpen: o.aantalOpen, info: overzicht.info };
}

/** Het label in een factuurregel (alleen tonen, de regel zelf is al een link). */
export function BetaalLabel({ info }: { info: BetaalInfo | undefined }) {
  if (!info || info.totaal === 0) return null;
  if (info.stand === 'betaald') return <span className="betaal-pill is-betaald db-betaal">{info.betaaldOp ? `Betaald ${korteDatum(info.betaaldOp, false)}` : 'Betaald'}</span>;
  if (info.stand === 'deels') return <span className="betaal-pill is-deels db-betaal">Nog {formatCenten(Math.abs(info.open))}</span>;
  return <span className="betaal-pill is-open db-betaal">{info.open < 0 ? 'Niet terugbetaald' : 'Niet betaald'}</span>;
}
