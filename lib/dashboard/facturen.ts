import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

// Alleen-lezen-snapshot van de facturen voor het dashboard. Gebruikt exact dezelfde
// regels als het facturenoverzicht (app/(app)/facturen/page.tsx):
//   - omzet = som van revenue_subtotal (excl. btw) van de facturen van het jaar;
//   - "huidig jaar" in Nederlandse tijd;
//   - een aanbetaling staat open zolang er geen factuur is met remainder_of_invoice_id = id.
// Het facturenoverzicht zelf blijft ongewijzigd.

export type FactuurSnapshot = {
  jaar: number;
  omzet: number;
  aantal: number;
  openAanbetalingen: number;
  laatste: { id: string; nummer: string; klant: string; totaal: number; datum: string; door: string | null }[];
};

type Rij = {
  id: string;
  invoice_number: string;
  client_company_name: string | null;
  issued_at: string | null;
  total: number | null;
  year: number;
  revenue_subtotal: number | null;
  deposit_percentage?: number | null;
  remainder_of_invoice_id?: string | null;
  created_by?: string | null;
};

export function huidigJaarNL(nu = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(nu).slice(0, 4));
}

export async function factuurSnapshot(
  supabase: SupabaseClient
): Promise<{ ok: true; data: FactuurSnapshot } | { ok: false; reden: 'niet-ingericht' | 'fout' }> {
  // Alle kolommen (zoals het overzicht), zodat een ontbrekende restfactuur-kolom niets breekt.
  const { data, error } = await supabase.from('invoices').select('*').order('invoice_number', { ascending: false });
  if (error) {
    console.error(error);
    return { ok: false, reden: tabelOntbreekt(error) ? 'niet-ingericht' : 'fout' };
  }
  const rijen = (data ?? []) as Rij[];
  const jaar = huidigJaarNL();
  const vanJaar = rijen.filter((f) => f.year === jaar);
  const heeftRest = new Set(rijen.map((f) => f.remainder_of_invoice_id).filter(Boolean));
  return {
    ok: true,
    data: {
      jaar,
      omzet: vanJaar.reduce((som, f) => som + Number(f.revenue_subtotal || 0), 0),
      aantal: vanJaar.length,
      openAanbetalingen: rijen.filter((f) => typeof f.deposit_percentage === 'number' && !heeftRest.has(f.id)).length,
      laatste: rijen.slice(0, 3).map((f) => ({
        id: f.id,
        nummer: f.invoice_number,
        klant: f.client_company_name || '—',
        totaal: Number(f.total || 0),
        datum: f.issued_at || '',
        door: f.created_by ?? null
      }))
    }
  };
}
