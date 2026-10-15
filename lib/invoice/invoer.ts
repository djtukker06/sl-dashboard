import { parseBedrag } from '@/lib/format';
import type { FactuurRegelInvoer } from './calculations';
import { standaardNaam, type BtwVerlegdAls } from './formulier';

// Wat het formulier verstuurt, zowel bij het aanmaken (POST) als bij het bewerken (PUT)
// van een factuur. Beide routes controleren het op precies dezelfde manier, zodat een
// bewerkte factuur nooit door iets heen glipt wat bij aanmaken wel geweigerd wordt.
export interface FactuurInvoerBody {
  factuurnummer?: string;
  naamFactuur?: string;
  datum?: string;
  klantBedrijfsnaam?: string;
  klantTav?: string;
  klantAdres?: string;
  klantPostcode?: string;
  middenKolomLabel?: string;
  btwVerlegd?: boolean;
  btwVerlegdAls?: string;
  btwVerlegdReden?: string;
  aanbetaling?: boolean;
  aanbetalingPercentage?: number;
  regels?: { beschrijving?: string; midden?: string; totaal?: string; teltMeeInOmzet?: boolean }[];
}

export interface FactuurInvoer {
  factuurnummer: string;
  jaar: number;
  volgnummer: number;
  issuedAt: string;
  naamFactuur: string;
  klant: { bedrijfsnaam: string; tav: string; adres: string; postcode: string };
  middenKolomLabel: string;
  btwVerlegd: boolean;
  btwVerlegdAls: BtwVerlegdAls;
  btwVerlegdReden: string;
  // Null bij een reguliere factuur; anders 5 t/m 95, per 5%.
  aanbetalingPercentage: number | null;
  regels: FactuurRegelInvoer[];
}

export type ParseResultaat =
  | { ok: false; fout: string }
  | { ok: true; invoer: FactuurInvoer };

export function parseFactuurInvoer(body: FactuurInvoerBody): ParseResultaat {
  const factuurnummer = (body.factuurnummer || '').trim();
  const nummerMatch = factuurnummer.match(/^(\d{2})-(\d{3})$/);
  if (!nummerMatch) {
    return { ok: false, fout: 'Ongeldig factuurnummer. Gebruik het formaat JJ-NNN, bijvoorbeeld 26-009.' };
  }
  const jaar = 2000 + Number(nummerMatch[1]);
  const volgnummer = Number(nummerMatch[2]);

  const datum = (body.datum || '').trim();
  const datumMatch = datum.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!datumMatch || Number.isNaN(Date.parse(`${datum}T12:00:00Z`))) {
    return { ok: false, fout: 'Ongeldige factuurdatum.' };
  }
  if (Number(datumMatch[1]) !== jaar) {
    return {
      ok: false,
      fout: `Het jaartal in factuurnummer ${factuurnummer} hoort bij ${jaar}, maar de factuurdatum valt in ${datumMatch[1]}. Pas een van beide aan.`
    };
  }

  const klantBedrijfsnaam = (body.klantBedrijfsnaam || '').trim();
  const regels = parseRegels(body);

  if (!klantBedrijfsnaam || regels.length === 0) {
    return { ok: false, fout: 'Vul een klantnaam in en voeg minimaal 1 factuurregel toe.' };
  }

  let aanbetalingPercentage: number | null = null;
  if (body.aanbetaling === true) {
    const pct = Number(body.aanbetalingPercentage);
    if (!Number.isInteger(pct) || pct < 5 || pct > 95 || pct % 5 !== 0) {
      return { ok: false, fout: 'Kies een aanbetalingspercentage tussen 5% en 95%, per 5%.' };
    }
    aanbetalingPercentage = pct;
  }

  return {
    ok: true,
    invoer: {
      factuurnummer,
      jaar,
      volgnummer,
      // Middag UTC: zo valt de factuurdatum in elke tijdzone op dezelfde kalenderdag.
      issuedAt: `${datum}T12:00:00Z`,
      naamFactuur: (body.naamFactuur || '').trim() || `Factuur ${factuurnummer}`,
      klant: {
        bedrijfsnaam: klantBedrijfsnaam,
        tav: (body.klantTav || '').trim(),
        adres: (body.klantAdres || '').trim(),
        postcode: (body.klantPostcode || '').trim()
      },
      middenKolomLabel: (body.middenKolomLabel || '').trim(),
      ...parseBtw(body),
      aanbetalingPercentage,
      regels
    }
  };
}

// Een prijsopgave: dezelfde velden als een factuur, maar bijna alles mag leeg — een
// nummer, klantnaam, t.a.v., adres en postcode zijn allemaal optioneel. Alleen een
// geldige datum en minimaal één regel zijn nodig.
export interface PrijsopgaveInvoer {
  nummer: string;
  issuedAt: string;
  naam: string;
  klant: FactuurInvoer['klant'];
  middenKolomLabel: string;
  btwVerlegd: boolean;
  btwVerlegdAls: BtwVerlegdAls;
  btwVerlegdReden: string;
  regels: FactuurRegelInvoer[];
}

export function parsePrijsopgaveInvoer(
  body: FactuurInvoerBody
): { ok: false; fout: string } | { ok: true; invoer: PrijsopgaveInvoer } {
  const nummer = (body.factuurnummer || '').trim();

  const datum = (body.datum || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(`${datum}T12:00:00Z`))) {
    return { ok: false, fout: 'Ongeldige datum.' };
  }

  const regels = parseRegels(body);
  if (regels.length === 0) {
    return { ok: false, fout: 'Voeg minimaal 1 regel toe.' };
  }

  return {
    ok: true,
    invoer: {
      nummer,
      // Middag UTC: zo valt de datum in elke tijdzone op dezelfde kalenderdag.
      issuedAt: `${datum}T12:00:00Z`,
      naam: (body.naamFactuur || '').trim() || standaardNaam('prijsopgave', nummer),
      klant: {
        bedrijfsnaam: (body.klantBedrijfsnaam || '').trim(),
        tav: (body.klantTav || '').trim(),
        adres: (body.klantAdres || '').trim(),
        postcode: (body.klantPostcode || '').trim()
      },
      middenKolomLabel: (body.middenKolomLabel || '').trim(),
      ...parseBtw(body),
      regels
    }
  };
}

function parseRegels(body: FactuurInvoerBody): FactuurRegelInvoer[] {
  return (body.regels || [])
    .map((r) => ({
      beschrijving: (r.beschrijving || '').trim(),
      midden: (r.midden || '').trim(),
      totaal: parseBedrag(r.totaal || '0'),
      teltMeeInOmzet: r.teltMeeInOmzet !== false
    }))
    .filter((r) => r.beschrijving !== '');
}

function parseBtw(body: FactuurInvoerBody) {
  const btwVerlegd = body.btwVerlegd === true;
  return {
    btwVerlegd,
    // Alles wat geen 'nvt' is, wordt 'verlegd' — zo was het vóór deze keuze ook.
    btwVerlegdAls: (body.btwVerlegdAls === 'nvt' ? 'nvt' : 'verlegd') as BtwVerlegdAls,
    // Zonder verlegde btw hoort er ook geen toelichting op het document te staan.
    btwVerlegdReden: btwVerlegd ? (body.btwVerlegdReden || '').trim() : ''
  };
}
