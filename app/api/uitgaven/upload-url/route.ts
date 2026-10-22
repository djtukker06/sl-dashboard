import { randomUUID } from 'node:crypto';
import { fout, isUuid, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import { isBestandsType, MAX_BESTAND_BYTES } from '@/lib/uitgaven/model';
import { nieuwPad, uploadUrl } from '@/lib/uitgaven/opslag';
import { moetUitgave } from '@/lib/uitgaven/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stap 1 van een upload (zelfde patroon als social): de server kiest het pad en geeft een
// signed upload-URL. De browser zet het bestand rechtstreeks in Storage (buiten de 4,5 MB-
// limiet van Vercel om) en meldt het daarna aan via POST /api/uitgaven/[id]/bestanden.
//
// POST /api/uitgaven/upload-url  { naam, type, grootte, uitgaveId? } → { uitgaveId, pad, signedUrl }
// Zonder uitgaveId hoort het bestand bij een nieuwe uitgave (die ontstaat bij het aanmelden).
export const POST = uitgavenRoute(async (request, _ctx, sb) => {
  const b = await leesJson(request);
  const type = String(b.type || '');
  if (!isBestandsType(type)) return fout(400, 'Alleen foto’s (jpg, png, webp, heic) en PDF’s zijn toegestaan.');
  const grootte = Number(b.grootte);
  if (Number.isFinite(grootte) && grootte > MAX_BESTAND_BYTES) return fout(400, 'Dit bestand is te groot (max. 25 MB).');

  let uitgaveId: string;
  if (b.uitgaveId !== undefined && b.uitgaveId !== null) {
    if (!isUuid(b.uitgaveId)) return fout(400, 'Ongeldige uitgave.');
    await moetUitgave(sb, b.uitgaveId);
    uitgaveId = b.uitgaveId;
  } else {
    uitgaveId = randomUUID();
  }

  const pad = nieuwPad(uitgaveId, String(b.naam || 'bonnetje'), type);
  const signedUrl = await uploadUrl(pad);
  return json({ uitgaveId, pad, signedUrl });
});
