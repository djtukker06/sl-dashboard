import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { amsterdamNaarMoment } from '@/lib/agenda/datum';
import { exclBtw, kwartaalVan, opCenten } from './model';
import { uitgavenInPeriode } from './repo';

// Btw-indicatie per kwartaal: voorbelasting (btw op uitgaven) tegenover de btw op de
// verstuurde facturen. ALLEEN-LEZEN op invoices, met dezelfde regels als het facturen-
// overzicht en de dashboard-widget (lib/dashboard/facturen.ts):
//   - omzet = revenue_subtotal (excl. btw);
//   - btw = vat_amount zoals gefactureerd: aanbetaling en restfactuur zijn elk een eigen
//     factuur met hun eigen bedragen, dus niets dubbel; bij "btw verlegd" is vat_amount 0;
//   - het kwartaal volgt de factuurdatum (issued_at) in Nederlandse tijd.
// Dit is een indicatie, geen aangifte.

export interface KwartaalCijfers {
  kwartaal: number;
  van: string;
  tot: string;
  /** Btw op uitgaven in EUR (alle statussen). */
  voorbelasting: number;
  /** Waarvan nog in concept (niet gecontroleerd). */
  voorbelastingConcept: number;
  uitgavenExcl: number;
  aantalUitgaven: number;
  /** Uitgaven in een andere valuta (niet meegeteld). */
  andereValuta: number;
  /** Btw op verstuurde facturen. */
  btwFacturen: number;
  omzetExcl: number;
  aantalFacturen: number;
  /** Facturen met btw verlegd (geen btw, wel omzet). */
  aantalVerlegd: number;
  /** btwFacturen − voorbelasting: positief = betalen, negatief = terugvragen. */
  saldo: number;
}

export interface BtwOverzicht {
  jaar: number;
  kwartalen: KwartaalCijfers[];
  /** null als de facturen-tabel niet leesbaar is (dan alleen voorbelasting). */
  facturenBeschikbaar: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function kwartaalGrenzen(jaar: number, q: number) {
  const eerste = (q - 1) * 3 + 1;
  const laatsteDag = new Date(Date.UTC(jaar, eerste + 2, 0)).getUTCDate();
  return { van: `${jaar}-${pad2(eerste)}-01`, tot: `${jaar}-${pad2(eerste + 2)}-${laatsteDag}` };
}

type FactuurRij = {
  issued_at: string | null;
  vat_amount: number | string | null;
  revenue_subtotal: number | string | null;
  vat_reverse_charged?: boolean | null;
};

/** Kwartaal (1-4) van een moment in Nederlandse tijd. */
function kwartaalNL(iso: string): { jaar: number; q: number } {
  const dag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date(iso));
  return { jaar: Number(dag.slice(0, 4)), q: kwartaalVan(dag) };
}

export async function btwOverzicht(sb: SupabaseClient, jaar: number): Promise<BtwOverzicht> {
  const uitgaven = await uitgavenInPeriode(sb, `${jaar}-01-01`, `${jaar}-12-31`, false);

  // Facturen van het jaar (ruim genomen in UTC; daarna precies op Amsterdamse dag).
  const start = amsterdamNaarMoment(`${jaar}-01-01`).toISOString();
  const eind = amsterdamNaarMoment(`${jaar + 1}-01-01`).toISOString();
  const f = await sb.from('invoices').select('*').gte('issued_at', start).lt('issued_at', eind).limit(5000);
  let facturen: FactuurRij[] = [];
  let facturenBeschikbaar = true;
  if (f.error) {
    if (!tabelOntbreekt(f.error)) console.error('[uitgaven] facturen lezen', f.error.message);
    facturenBeschikbaar = false;
  } else {
    facturen = (f.data ?? []) as FactuurRij[];
  }

  const kwartalen: KwartaalCijfers[] = [1, 2, 3, 4].map((q) => ({
    kwartaal: q,
    ...kwartaalGrenzen(jaar, q),
    voorbelasting: 0,
    voorbelastingConcept: 0,
    uitgavenExcl: 0,
    aantalUitgaven: 0,
    andereValuta: 0,
    btwFacturen: 0,
    omzetExcl: 0,
    aantalFacturen: 0,
    aantalVerlegd: 0,
    saldo: 0
  }));

  for (const u of uitgaven) {
    if (!u.datum) continue;
    const k = kwartalen[kwartaalVan(u.datum) - 1];
    k.aantalUitgaven++;
    if (u.valuta !== 'EUR') {
      k.andereValuta++;
      continue;
    }
    // Verlegde btw op inkopen: je draagt af én trekt af, per saldo nul. Telt dus niet mee.
    const btw = u.btwTarief === 'verlegd' ? 0 : u.btwBedrag ?? 0;
    k.voorbelasting += btw;
    if (u.status === 'concept') k.voorbelastingConcept += btw;
    k.uitgavenExcl += exclBtw(u);
  }

  for (const r of facturen) {
    if (!r.issued_at) continue;
    const { jaar: j, q } = kwartaalNL(r.issued_at);
    if (j !== jaar) continue;
    const k = kwartalen[q - 1];
    k.aantalFacturen++;
    k.btwFacturen += Number(r.vat_amount || 0);
    k.omzetExcl += Number(r.revenue_subtotal || 0);
    if (r.vat_reverse_charged) k.aantalVerlegd++;
  }

  for (const k of kwartalen) {
    k.voorbelasting = opCenten(k.voorbelasting);
    k.voorbelastingConcept = opCenten(k.voorbelastingConcept);
    k.uitgavenExcl = opCenten(k.uitgavenExcl);
    k.btwFacturen = opCenten(k.btwFacturen);
    k.omzetExcl = opCenten(k.omzetExcl);
    k.saldo = opCenten(k.btwFacturen - k.voorbelasting);
  }
  return { jaar, kwartalen, facturenBeschikbaar };
}
