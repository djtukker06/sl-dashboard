import { bkRoute } from '@/lib/boekhouding/api';
import { importActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/import
//   { rekeningId, bestandsnaam, tekst, formaat?, mapping?, bevestig?, onthoudMapping? }
//   Zonder bevestig: voorbeeld (per regel nieuw/dubbel/vergrendeld + voorstel voor soort, btw en
//   categorie). Met bevestig: de nieuwe regels worden toegevoegd met status "te verwerken".
//   Een onbekend formaat geeft mappingNodig + kolommen; stuur dan een kolomkeuze (mapping) mee.
export const POST = bkRoute((request, _ctx, { repo }) => importActie(request, repo));
