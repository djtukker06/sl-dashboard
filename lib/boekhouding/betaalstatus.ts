import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { metTeamlid } from '@/lib/auth/team';
import { logFout } from '@/lib/log';
import { boekhoudModus, kiesRepo, NIET_INGERICHT } from './modus';
import { BoekhoudFout } from './repo/types';
import { factuurPosten } from './kern/afletteren';
import { betaalInfoVan, type BetaalInfo } from './kern/betaalcheck';
import { vandaagNL, type Datum } from './kern/periode';
import type { FactuurBron } from './kern/bronnen';

// Alleen lezen: de betaalstatus van alle facturen voor het facturenoverzicht en de betaalcheck.
// Fail closed en stil: zonder vinkje Boekhouding, in de demo (andere facturen), vóór 0027 of
// bij een storing → null, en dan toont de app geen betaalstatus.

export interface BankKeuze {
  id: string;
  naam: string;
  standaard: boolean;
}

export interface BetaalOverzicht {
  info: Map<string, BetaalInfo>;
  facturen: FactuurBron[];
  rekeningen: BankKeuze[];
  vandaag: Datum;
}

export async function betaalOverzicht(lid: Teamlid): Promise<BetaalOverzicht | null> {
  if (!lid.boekhouding || lid.overgang) return null;
  try {
    return await metTeamlid(lid, async () => {
      if ((await boekhoudModus(lid)) === 'demo') return null;
      const repo = await kiesRepo(lid);
      const [stam, boekingen, koppelingen, bronnen] = await Promise.all([repo.stamdata(), repo.boekingen(), repo.koppelingen(), repo.bronnen()]);
      // Net als laadAlles: alleen koppelingen van bestaande (niet-verwijderde) boekingen.
      const datum = new Map(boekingen.map((b) => [b.id, b.datum]));
      const vandaag = vandaagNL();
      const posten = factuurPosten(bronnen.facturen, koppelingen.filter((k) => datum.has(k.boekingId)), vandaag);
      return {
        info: new Map(posten.map((p) => [p.doc.id, betaalInfoVan(p, datum)])),
        facturen: bronnen.facturen,
        rekeningen: stam.rekeningen.filter((r) => r.actief).map((r) => ({ id: r.id, naam: r.naam, standaard: r.standaard })),
        vandaag
      };
    });
  } catch (e) {
    if (!(e instanceof BoekhoudFout && e.code === NIET_INGERICHT)) logFout('[betaalstatus]', e);
    return null;
  }
}
