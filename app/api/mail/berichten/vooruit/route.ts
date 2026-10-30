import { mailRoute, json } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';
import { haalBerichten } from '@/lib/mail/berichten';
import type { Bericht } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UIDS = 10;
/** Alleen berichten tot deze grootte vooruit ophalen; grotere laden pas bij openen. */
const MAX_GROOTTE = 512 * 1024;
/** Vercel weigert antwoorden boven 4,5 MB: ruim eronder blijven. */
const BUDGET = 3 * 1024 * 1024;

// GET /api/mail/berichten/vooruit?mb=<inbox>&map=INBOX&uids=12,11,10 → { berichten: Bericht[] }
// Haalt de berichten op die je waarschijnlijk zo opent (bovenaan de lijst, de volgende, waar
// je muis op staat), zodat openen direct is. Met PEEK: niets wordt op gelezen gezet. Wat
// te groot is, niet (meer) bestaat of niet meer in het budget past, ontbreekt gewoon.
export const GET = mailRoute(async (request: Request, _ctx: unknown, mail) => {
  const sp = new URL(request.url).searchParams;
  const uids = [...new Set((sp.get('uids') || '').split(',').filter(Boolean).map((u) => parseUid(u)))];
  if (!uids.length || uids.length > MAX_UIDS) throw new MailFout(400, 'ongeldig', 'Ongeldige berichten.');

  const alle = await metImap(mail.cfg, async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return haalBerichten(c, map.pad, uids, MAX_GROOTTE);
  });

  // In de gevraagde volgorde (belangrijkste eerst) tot het budget op is.
  const opUid = new Map(alle.map((b) => [b.uid, b]));
  const berichten: Bericht[] = [];
  let totaal = 0;
  for (const uid of uids) {
    const b = opUid.get(uid);
    if (!b) continue;
    totaal += Buffer.byteLength(JSON.stringify(b), 'utf8');
    if (totaal > BUDGET) break;
    berichten.push(b);
  }
  return json({ berichten });
});
