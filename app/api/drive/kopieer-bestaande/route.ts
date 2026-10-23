import { driveRoute, json } from '@/lib/drive/api';
import { kopieerBestaande } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/drive/kopieer-bestaande (alleen de eigenaar)
// → { gekopieerd, overgeslagen, mislukt, resterend, klaar }
// Kopieert bestaande facturen, prijsopgaven en bonnetjes naar Boekhouding/…/<jaar>.
// Idempotent (drive_kopieen); werkt per ronde ±40 s, de knop vraagt zo nodig een volgende ronde.
export const POST = driveRoute(async (_request, _ctx, lid) => json(await kopieerBestaande(lid.bewijs)), { alleenEigenaar: true });
