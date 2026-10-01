import { formatEuro } from '@/lib/format';

// De waarden zoals het factuurformulier ze in beeld heeft: bedragen als tekst, precies
// zoals je ze intypt. Bij het versturen worden ze weer omgezet naar getallen.
export interface RegelInvoer {
  beschrijving: string;
  midden: string;
  totaal: string;
  teltMeeInOmzet: boolean;
}

// Wat er bij een verlegde btw in het btw-vakje op de factuur staat.
export type BtwVerlegdAls = 'verlegd' | 'nvt';

export const BTW_VERLEGD_TEKST: Record<BtwVerlegdAls, string> = {
  verlegd: 'Verlegd',
  nvt: 'N.v.t.'
};

export interface FactuurBeginwaarden {
  factuurnummer: string;
  datum: string;
  naamFactuur: string;
  klantBedrijfsnaam: string;
  klantTav: string;
  klantAdres: string;
  klantPostcode: string;
  middenKolomLabel: string;
  btwVerlegd: boolean;
  btwVerlegdAls: BtwVerlegdAls;
  btwVerlegdReden: string;
  regels: RegelInvoer[];
}

export const LEGE_REGEL: RegelInvoer = {
  beschrijving: '',
  midden: '',
  totaal: '',
  teltMeeInOmzet: true
};

export function nieuweFactuurBeginwaarden(
  factuurnummer: string,
  datum: string
): FactuurBeginwaarden {
  return {
    factuurnummer,
    datum,
    naamFactuur: `Factuur ${factuurnummer}`,
    klantBedrijfsnaam: '',
    klantTav: '',
    klantAdres: '',
    klantPostcode: '',
    middenKolomLabel: '',
    btwVerlegd: false,
    btwVerlegdAls: 'verlegd',
    btwVerlegdReden: '',
    regels: [{ ...LEGE_REGEL }]
  };
}

// De kolommen van een factuur die het formulier nodig heeft om zichzelf mee te vullen.
export interface FactuurRecord {
  invoice_number: string;
  issued_at: string;
  name: string | null;
  client_company_name: string;
  client_contact_name: string | null;
  client_address: string | null;
  client_postal_code: string | null;
  mid_column_label: string | null;
  line_items: unknown;
  vat_reverse_charged?: boolean | null;
  vat_reverse_charge_reason?: string | null;
  vat_reverse_charge_display?: string | null;
}

interface OpgeslagenRegel {
  beschrijving?: unknown;
  midden?: unknown;
  totaal?: unknown;
  teltMeeInOmzet?: unknown;
}

// Zet een opgeslagen factuur terug om in formulierwaarden, zodat het bewerkscherm
// hetzelfde is als het aanmaakscherm — alleen dan al ingevuld.
export function beginwaardenVanFactuur(factuur: FactuurRecord): FactuurBeginwaarden {
  const regels = (Array.isArray(factuur.line_items) ? factuur.line_items : []) as OpgeslagenRegel[];

  return {
    factuurnummer: factuur.invoice_number,
    // De factuurdatum staat op 12:00 UTC; in Nederlandse tijd is dat gegarandeerd
    // dezelfde kalenderdag, en en-CA levert het YYYY-MM-DD dat een date-input verwacht.
    datum: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(
      new Date(factuur.issued_at)
    ),
    naamFactuur: factuur.name || `Factuur ${factuur.invoice_number}`,
    klantBedrijfsnaam: factuur.client_company_name || '',
    klantTav: factuur.client_contact_name || '',
    klantAdres: factuur.client_address || '',
    klantPostcode: factuur.client_postal_code || '',
    middenKolomLabel: factuur.mid_column_label || '',
    btwVerlegd: factuur.vat_reverse_charged === true,
    btwVerlegdAls: factuur.vat_reverse_charge_display === 'nvt' ? 'nvt' : 'verlegd',
    btwVerlegdReden: factuur.vat_reverse_charge_reason || '',
    regels:
      regels.length > 0
        ? regels.map((regel) => ({
            beschrijving: typeof regel.beschrijving === 'string' ? regel.beschrijving : '',
            midden: typeof regel.midden === 'string' ? regel.midden : '',
            totaal: formatEuro(typeof regel.totaal === 'number' ? regel.totaal : 0),
            // Facturen van vóór het omzetvinkje hadden geen veld: die telden allemaal mee.
            teltMeeInOmzet: regel.teltMeeInOmzet !== false
          }))
        : [{ ...LEGE_REGEL }]
  };
}
