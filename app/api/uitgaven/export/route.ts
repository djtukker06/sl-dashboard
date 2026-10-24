import { contentDisposition, fout, json, uitgavenRoute } from '@/lib/uitgaven/api';
import { maakZipExport, exportNamen } from '@/lib/uitgaven/export';
import { filterUitgaven, isDatum, maakCsv } from '@/lib/uitgaven/model';
import { uitgavenInPeriode } from '@/lib/uitgaven/repo';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Export voor de boekhouder, voor een periode (en eventueel dezelfde filters als de lijst):
//   GET /api/uitgaven/export?formaat=csv&van=…&tot=…[&status=&categorie=&leverancier=&betaaldVia=&zoek=]
//       → CSV-bestand (puntkomma, NL-decimalen)
//   GET /api/uitgaven/export?formaat=zip&van=…&tot=…[…]
//       → { delen: [{ naam, url, aantal }] }  ZIP('s) met bonnetjes + CSV via een signed URL
// Uitgaven zonder datum tellen niet mee (die horen bij geen enkele periode).
export const GET = uitgavenRoute(async (request, _ctx, sb, lid) => {
  const sp = new URL(request.url).searchParams;
  const van = sp.get('van');
  const tot = sp.get('tot');
  const formaat = sp.get('formaat');
  if (!isDatum(van) || !isDatum(tot) || van > tot) return fout(400, 'Ongeldige periode.');
  if (formaat !== 'csv' && formaat !== 'zip') return fout(400, 'Onbekend formaat.');

  const alle = await uitgavenInPeriode(sb, van, tot, false);
  const uitgaven = filterUitgaven(alle, {
    zoek: sp.get('zoek') ?? undefined,
    categorie: sp.get('categorie') ?? undefined,
    leverancier: sp.get('leverancier') ?? undefined,
    status: sp.get('status') ?? undefined,
    betaaldVia: sp.get('betaaldVia') ?? undefined
  }).sort((a, b) => ((a.datum ?? '') < (b.datum ?? '') ? -1 : (a.datum ?? '') > (b.datum ?? '') ? 1 : 0));
  if (!uitgaven.length) return fout(404, 'Er zijn geen uitgaven in deze periode om te exporteren.');

  const basisNaam = `uitgaven_${van}_${tot}`;
  await logAudit('export_bonnetjes', { lid, doel: `${van} t/m ${tot}`, details: { soort: formaat, aantal: uitgaven.length } }, request);
  if (formaat === 'csv') {
    const { namen } = await exportNamen(sb, uitgaven);
    const csv = maakCsv(uitgaven, namen);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition(`${basisNaam}.csv`),
        'Cache-Control': 'private, no-store'
      }
    });
  }
  return json({ delen: await maakZipExport(sb, uitgaven, basisNaam) });
});
