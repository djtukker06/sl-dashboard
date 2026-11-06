import { plusDagen, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { afsprakenInBereik } from '@/lib/agenda/repo';
import { foutAntwoord, json, metSessie } from '@/lib/agenda/api';
import { metGoogleAfspraken } from '@/lib/google-agenda/afspraken';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agenda/komend → { afspraken }
// Je afspraken met een tijd die in de komende 26 uur beginnen (eigen + zichtbare Google-
// agenda's), voor de meldingen 10 en 1 minuut vooraf (components/agenda/AfspraakMeldingen).
// Klein gehouden: de browser vraagt dit elke paar minuten op.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const vandaag = vandaagNL();
  try {
    const { afspraken: eigen } = await afsprakenInBereik(s.bron, vandaag, plusDagen(vandaag, 1));
    const alle = await metGoogleAfspraken(createServiceRoleClient(s.lid.bewijs), s.lid.userId, vandaag, eigen);
    const nu = Date.now();
    const tot = nu + 26 * 3_600_000;
    const afspraken = alle
      .filter((a) => !a.heleDag && Date.parse(a.start) > nu - 120_000 && Date.parse(a.start) < tot)
      .map((a) => ({
        id: a.id,
        titel: a.titel,
        start: a.start,
        eind: a.eind,
        locatie: a.locatie,
        notitie: a.notitie.slice(0, 2000),
        google: a.google ? { meetLink: a.google.meetLink, vergaderDienst: a.google.vergaderDienst, agendaNaam: a.google.agendaNaam } : undefined
      }));
    return json({ afspraken });
  } catch (e) {
    return foutAntwoord(e);
  }
}
