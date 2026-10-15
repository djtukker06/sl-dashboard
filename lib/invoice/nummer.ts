import type { SupabaseClient } from '@supabase/supabase-js';

// Datum van vandaag in Nederlandse tijd, als YYYY-MM-DD (en-CA levert dat formaat). De
// server draait in UTC, dus zonder tijdzone zou je 's nachts de verkeerde dag — en rond
// de jaarwisseling het verkeerde jaar — krijgen.
export function vandaagNL(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}

// Het eerstvolgende factuurnummer van een jaar: hoogste bestaande factuur + 1. Verwijder
// je de laatste factuur, dan komt dat nummer dus weer vrij. invoice_counters dient alleen
// nog als ondergrens voor nummers die buiten dit systeem om zijn uitgegeven (zie
// migratie 0005).
export async function volgendFactuurnummer(supabase: SupabaseClient, jaar: number) {
  const [{ data: counter }, { data: hoogste }] = await Promise.all([
    supabase.from('invoice_counters').select('last_number').eq('year', jaar).maybeSingle(),
    supabase
      .from('invoices')
      .select('sequence_number')
      .eq('year', jaar)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const volgnummer = Math.max(counter?.last_number || 0, hoogste?.sequence_number || 0) + 1;
  return {
    jaar,
    volgnummer,
    factuurnummer: `${String(jaar).slice(-2)}-${String(volgnummer).padStart(3, '0')}`
  };
}
